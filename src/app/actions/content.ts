"use server";

import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser, type CurrentUser } from "@/lib/auth";
import {
  CONTENT_CHANNELS,
  CONTENT_FORMATS,
  CONTENT_STEPS,
  MAX_CONTENT_FILE_MB,
  canComment,
  canDeleteContent,
  canEditBrief,
  canTakeStep,
  canUploadDesign,
  isWriter,
  type ContentStatus,
} from "@/lib/content-flow";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { CONTENT_STATUS } from "@/lib/labels";
import { notify } from "@/lib/notifications";
import { sniffImage } from "@/lib/sniff-image";
import { buildKey, getStorage } from "@/lib/storage";

const c = schema.contentItems;
const linkTo = (id: string) => `/marketing/content?open=${id}`;
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function log(db: Db | Tx, contentId: string, actorId: string, type: string, extra: { from?: string; to?: string; body?: string } = {}) {
  await db.insert(schema.contentActivity).values({ contentId, actorId, type, fromStatus: extra.from ?? null, toStatus: extra.to ?? null, body: extra.body ?? null });
}

async function load(id: string) {
  const [item] = await getDb().select().from(c).where(eq(c.id, id));
  return item ?? null;
}

/** Publish time from a WIB date + time. */
const wib = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const wibDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const wibTime = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });

/* ───────────── Brief: create / edit / delete / reschedule ───────────── */

const Brief = z.object({
  id: z.uuid().optional(),
  title: z.string("Enter a title.").min(3, "At least 3 characters.").max(160),
  date: z.iso.date("Pick a date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM."),
  channels: z.array(z.enum(CONTENT_CHANNELS)).min(1, "Pick at least one channel."),
  format: z.enum(CONTENT_FORMATS, "Pick a format."),
  campaignId: z.uuid().optional(),
  writerId: z.uuid().optional(),
  designerId: z.uuid().optional(),
  objective: z.string().max(300).optional(),
  keyMessage: z.string().max(500).optional(),
  guideline: z.string().max(2000).optional(),
  caption: z.string().max(2200).optional(),
  cta: z.string().max(200).optional(),
  hashtags: z.string().max(500).optional(),
  products: z.string().max(300).optional(),
  sendToDesign: z.literal("on").optional(),
});

const LABEL: Record<string, string> = {
  title: "Title", publishAt: "Publish time", channels: "Channels", format: "Format", campaignId: "Campaign", writerId: "Writer", designerId: "Designer",
  objective: "Objective", keyMessage: "Key message", guideline: "Guideline", caption: "Caption", cta: "CTA", hashtags: "Hashtags", products: "Products",
};

async function checkPeople(writerId: string | undefined, designerId: string | undefined): Promise<Record<string, string>> {
  const ids = [writerId, designerId].filter(Boolean) as string[];
  if (!ids.length) return {};
  const rows = await getDb().select({ id: schema.users.id, role: schema.users.role, active: schema.users.active }).from(schema.users).where(inArray(schema.users.id, ids));
  const get = (id?: string) => rows.find((r) => r.id === id);
  const errs: Record<string, string> = {};
  if (writerId && !(get(writerId)?.active && isWriter(get(writerId)!.role))) errs.writerId = "Pick a Marketing user or manager.";
  if (designerId && !(get(designerId)?.active && get(designerId)!.role === "designer")) errs.designerId = "Pick an active designer.";
  return errs;
}

/** Create a brief (Marketing / Sales Manager / Admin) or edit one that isn't published yet. */
export async function saveContent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!isWriter(user.role)) return { ok: false, error: "Only Marketing, sales managers and admins plan content." };
  const parsed = Brief.safeParse({ ...formObject(fd), channels: fd.getAll("channels").map(String) });
  if (!parsed.success) return fieldErrors(parsed.error);
  const v = parsed.data;
  const people = await checkPeople(v.writerId, v.designerId);
  if (Object.keys(people).length) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: people };
  if (v.sendToDesign && !v.designerId) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { designerId: "Pick a designer to send it to." } };

  const values = {
    title: v.title,
    publishAt: wib(v.date, v.time),
    channels: v.channels,
    format: v.format,
    campaignId: v.campaignId ?? null,
    writerId: v.writerId ?? (v.id ? null : user.id),
    designerId: v.designerId ?? null,
    objective: v.objective ?? null,
    keyMessage: v.keyMessage ?? null,
    guideline: v.guideline ?? null,
    caption: v.caption ?? null,
    cta: v.cta ?? null,
    hashtags: v.hashtags ?? null,
    products: v.products ?? null,
  };
  const db = getDb();

  if (!v.id) {
    const status: ContentStatus = v.sendToDesign ? "ready_for_design" : "draft_brief";
    const [row] = await db.transaction(async (tx) => {
      const ins = await tx.insert(c).values({ ...values, status }).returning({ id: c.id });
      await log(tx, ins[0].id, user.id, "created", { to: status });
      return ins;
    });
    await audit({ actorId: user.id, action: "create", entity: "content", entityId: v.title, changes: { publishAt: `${v.date} ${v.time}`, status } });
    if (status === "ready_for_design" && v.designerId && v.designerId !== user.id) {
      await notify({ userIds: [v.designerId], type: "content.your_turn", title: `Ready for design: ${v.title}`, body: `Brief from ${user.name}`, link: linkTo(row.id) });
    }
    refresh();
    return { ok: true, message: "Brief created." };
  }

  const before = await load(v.id);
  if (!before) return { ok: false, error: "Content not found." };
  if (!canEditBrief(user.role, before.status)) return { ok: false, error: "Published posts can't be edited." };
  if (!v.writerId) values.writerId = before.writerId;
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, after] of Object.entries(values)) {
    const was = (before as Record<string, unknown>)[k];
    const same = was instanceof Date ? was.getTime() === (after as Date).getTime() : JSON.stringify(was ?? null) === JSON.stringify(after ?? null);
    if (!same) changes[k] = [was instanceof Date ? `${wibDate(was)} ${wibTime(was)}` : was, after instanceof Date ? `${v.date} ${v.time}` : after];
  }
  if (!Object.keys(changes).length) return { ok: true, message: "No changes." };
  await db.transaction(async (tx) => {
    await tx.update(c).set(values).where(eq(c.id, before.id));
    if (changes.publishAt) await log(tx, before.id, user.id, "rescheduled", { body: `${changes.publishAt[0]} → ${changes.publishAt[1]}` });
    const rest = Object.keys(changes).filter((k) => k !== "publishAt");
    if (rest.length) await log(tx, before.id, user.id, "edited", { body: rest.map((k) => LABEL[k]).join(", ") });
  });
  await audit({ actorId: user.id, action: "update", entity: "content", entityId: before.title, changes });
  const inDesign = (["ready_for_design", "in_design", "revision"] as ContentStatus[]).includes(before.status);
  if (changes.designerId && values.designerId && inDesign && values.designerId !== user.id) {
    await notify({ userIds: [values.designerId], type: "content.your_turn", title: `Assigned to you: ${v.title}`, body: `From ${user.name}`, link: linkTo(before.id) });
  } else if (inDesign && before.designerId && before.designerId !== user.id && (changes.publishAt || briefChanged(changes))) {
    await notify({ userIds: [before.designerId], type: "content.update", title: `Brief updated: ${v.title}`, body: `By ${user.name}`, link: linkTo(before.id) });
  }
  refresh();
  return { ok: true, message: "Brief saved." };
}
const briefChanged = (ch: Record<string, unknown>) => Object.keys(ch).some((k) => ["guideline", "keyMessage", "objective", "format", "channels", "caption"].includes(k));

export type ContentResult = { ok: true } | { ok: false; error: string };

/** Drag on the calendar: same time of day, another date. */
export async function rescheduleContent(input: { id: string; date: string }): Promise<ContentResult> {
  const user = await verifyUser();
  const p = z.object({ id: z.uuid(), date: z.iso.date() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid date." };
  const item = await load(p.data.id);
  if (!item) return { ok: false, error: "Content not found." };
  if (!canEditBrief(user.role, item.status)) return { ok: false, error: isWriter(user.role) ? "Published posts can't be moved." : "Only Marketing can move posts." };
  const from = wibDate(item.publishAt);
  if (from === p.data.date) return { ok: true };
  const at = wib(p.data.date, wibTime(item.publishAt));
  await getDb().transaction(async (tx) => {
    await tx.update(c).set({ publishAt: at }).where(eq(c.id, item.id));
    await log(tx, item.id, user.id, "rescheduled", { body: `${from} → ${p.data.date}` });
  });
  await audit({ actorId: user.id, action: "update", entity: "content", entityId: item.title, changes: { publishAt: [from, p.data.date] } });
  if (item.designerId && item.designerId !== user.id && item.status !== "draft_brief") {
    await notify({ userIds: [item.designerId], type: "content.update", title: `Moved to ${p.data.date}: ${item.title}`, body: `By ${user.name}`, link: linkTo(item.id) });
  }
  refresh();
  return { ok: true };
}

export async function deleteContent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const item = await load(id.data);
  if (!item) return { ok: false, error: "Content not found." };
  if (!canDeleteContent(user.role, item.status)) return { ok: false, error: "Only draft briefs can be deleted." };
  const files = await getDb().select({ key: schema.contentAssets.fileKey }).from(schema.contentAssets).where(eq(schema.contentAssets.contentId, item.id));
  await getDb().delete(c).where(eq(c.id, item.id));
  await audit({ actorId: user.id, action: "delete", entity: "content", entityId: item.title });
  const storage = files.some((f) => f.key) ? await getStorage() : null;
  for (const f of files) if (f.key) await storage!.delete(f.key).catch(() => {});
  refresh();
  return { ok: true, message: "Deleted." };
}

/* ───────────── Workflow ───────────── */

const Move = z.object({
  contentId: z.uuid(),
  to: z.enum(Object.keys(CONTENT_STEPS) as [ContentStatus, ...ContentStatus[]]),
  note: z.string().max(500).optional(),
  publishedUrl: z.url("Enter a full link (https://…).").max(500).optional(),
});

/** Move a post one step through the workflow and tell whoever is next. */
export async function moveContent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Move.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const { contentId, to, note, publishedUrl } = parsed.data;

  const db = getDb();
  const item = await load(contentId);
  if (!item) return { ok: false, error: "Content not found." };
  const step = CONTENT_STEPS[item.status].find((s) => s.to === to);
  if (!step) return { ok: false, error: "This post has moved on — refresh the page." };
  if (!canTakeStep(step, user.role, user.id, item.designerId)) return { ok: false, error: "This step belongs to someone else." };
  if (step.needsNote && !note) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { note: "Tell the designer what to change." } };
  if (to === "ready_for_design" && !item.designerId) return { ok: false, error: "Assign a designer first (Edit brief)." };

  let designVersion = item.designVersion;
  if (to === "in_design" && designVersion === 0) designVersion = 1;
  if (to === "in_review") {
    const [has] = await db
      .select({ id: schema.contentAssets.id })
      .from(schema.contentAssets)
      .where(and(eq(schema.contentAssets.contentId, item.id), eq(schema.contentAssets.kind, "design"), eq(schema.contentAssets.version, Math.max(1, designVersion))))
      .limit(1);
    if (!has) return { ok: false, error: `Upload the design (v${Math.max(1, designVersion)}) before submitting it for review.` };
  }
  if (to === "revision") designVersion += 1;

  await db.transaction(async (tx) => {
    await tx
      .update(c)
      .set({ status: to, designVersion, ...(to === "published" ? { publishedUrl: publishedUrl ?? null } : {}) })
      .where(eq(c.id, item.id));
    await log(tx, item.id, user.id, "status", { from: item.status, to, body: note ?? (publishedUrl ? publishedUrl : undefined) });
  });
  await audit({ actorId: user.id, action: "update", entity: "content", entityId: item.title, changes: { status: [item.status, to], ...(note ? { note } : {}) } });

  const link = linkTo(item.id);
  const label = CONTENT_STATUS[to].label;
  if ((to === "ready_for_design" || to === "revision") && item.designerId && item.designerId !== user.id) {
    await notify({
      userIds: [item.designerId],
      type: "content.your_turn",
      title: to === "revision" ? `Revision needed: ${item.title}` : `Ready for design: ${item.title}`,
      body: note ?? `From ${user.name}`,
      link,
    });
  } else if (to === "in_review" && item.writerId && item.writerId !== user.id) {
    await notify({ userIds: [item.writerId], type: "content.your_turn", title: `Ready to review: ${item.title}`, body: `Design by ${user.name}`, link });
  } else if (to === "approved" && item.designerId && item.designerId !== user.id) {
    await notify({ userIds: [item.designerId], type: "content.update", title: `Approved: ${item.title}`, body: `By ${user.name}`, link });
  } else if (to === "published" && item.writerId && item.writerId !== user.id) {
    await notify({ userIds: [item.writerId], type: "content.update", title: `${label}: ${item.title}`, link });
  }
  refresh();
  return { ok: true };
}

/* ───────────── Files & links ───────────── */

const MAX = MAX_CONTENT_FILE_MB * 1024 * 1024;
const isMp4 = (b: Buffer) => b.length > 12 && b.subarray(4, 8).toString() === "ftyp";

export async function uploadContentAsset(fd: FormData): Promise<ContentResult> {
  const user = await verifyUser();
  const p = z
    .object({
      contentId: z.uuid(),
      kind: z.enum(["reference", "design"]),
      url: z.url("Enter a full link (https://…).").max(500).optional(),
      name: z.string().max(120).optional(),
    })
    .safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid upload." };
  const { contentId, kind, url } = p.data;
  const item = await load(contentId);
  if (!item) return { ok: false, error: "Content not found." };
  if (kind === "design" ? !canUploadDesign(user.role, user.id, item.designerId, item.status) : !canEditBrief(user.role, item.status)) {
    return { ok: false, error: kind === "design" ? "Only the assigned designer can upload while the post is with design." : "Only Marketing can add references." };
  }

  let fileKey: string | null = null;
  let mime: string | null = null;
  let size: number | null = null;
  let name = p.data.name?.trim() || "";
  if (url) {
    if (!/^https:\/\//i.test(url)) return { ok: false, error: "Links must start with https://" };
    name ||= new URL(url).hostname;
  } else {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file or paste a link." };
    if (file.size > MAX) return { ok: false, error: `Files up to ${MAX_CONTENT_FILE_MB} MB — paste a Canva / Google Drive link for larger files.` };
    const bytes = Buffer.from(await file.arrayBuffer());
    const img = sniffImage(bytes);
    const ext = img ?? (bytes.subarray(0, 5).toString() === "%PDF-" ? "pdf" : isMp4(bytes) ? "mp4" : null);
    if (!ext) return { ok: false, error: "Allowed: JPG, PNG, WebP, PDF, MP4 — or paste a link." };
    mime = ext === "jpg" ? "image/jpeg" : ext === "pdf" ? "application/pdf" : ext === "mp4" ? "video/mp4" : `image/${ext}`;
    fileKey = buildKey(`content/${item.id}`, ext);
    size = file.size;
    name ||= file.name.slice(0, 120);
    await (await getStorage()).put(fileKey, bytes, mime);
  }

  const version = kind === "design" ? Math.max(1, item.designVersion) : 0;
  const autoStart = kind === "design" && item.status === "ready_for_design";
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.contentAssets).values({ contentId: item.id, kind, version, name, fileKey, url: url ?? null, mime, size, uploadedBy: user.id });
    if (autoStart || (kind === "design" && item.designVersion === 0)) {
      await tx.update(c).set({ status: autoStart ? "in_design" : item.status, designVersion: version }).where(eq(c.id, item.id));
    }
    if (autoStart) await log(tx, item.id, user.id, "status", { from: "ready_for_design", to: "in_design" });
    await log(tx, item.id, user.id, "upload", { body: `${kind === "design" ? `Design v${version}` : "Reference"}: ${name}` });
  });
  await audit({ actorId: user.id, action: "upload", entity: "content", entityId: item.title, changes: { kind, version, name, ...(url ? { url } : {}) } });
  refresh();
  return { ok: true };
}

export async function removeContentAsset(input: { assetId: string }): Promise<ContentResult> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(input.assetId);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const db = getDb();
  const [asset] = await db.select().from(schema.contentAssets).where(eq(schema.contentAssets.id, id.data));
  if (!asset) return { ok: false, error: "File not found." };
  const item = await load(asset.contentId);
  if (!item) return { ok: false, error: "Content not found." };
  const allowed =
    asset.kind === "design"
      ? canUploadDesign(user.role, user.id, item.designerId, item.status) && asset.version === Math.max(1, item.designVersion)
      : canEditBrief(user.role, item.status);
  if (!allowed) return { ok: false, error: asset.kind === "design" ? "Submitted versions are kept for the record." : "You can't change this post." };
  await db.transaction(async (tx) => {
    await tx.delete(schema.contentAssets).where(eq(schema.contentAssets.id, asset.id));
    await log(tx, item.id, user.id, "removed", { body: asset.name });
  });
  await audit({ actorId: user.id, action: "delete", entity: "content_asset", entityId: `${item.title} · ${asset.name}` });
  if (asset.fileKey) await (await getStorage()).delete(asset.fileKey).catch(() => {});
  refresh();
  return { ok: true };
}

/* ───────────── Comments ───────────── */

export async function addContentComment(input: { contentId: string; body: string }): Promise<ContentResult> {
  const user = await verifyUser();
  const p = z.object({ contentId: z.uuid(), body: z.string().trim().min(1, "Write something first.").max(1000) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid comment." };
  const item = await load(p.data.contentId);
  if (!item) return { ok: false, error: "Content not found." };
  if (!canComment(user.role, user.id, item.designerId)) return { ok: false, error: "Only the writer side and the assigned designer can comment." };
  await log(getDb(), item.id, user.id, "comment", { body: p.data.body });
  const others = [item.writerId, item.designerId].filter((u): u is string => Boolean(u) && u !== user.id);
  if (others.length) await notify({ userIds: others, type: "content.update", title: `${user.name} commented: ${item.title}`, body: p.data.body.slice(0, 140), link: linkTo(item.id) });
  return { ok: true };
}

/* ───────────── Detail panel ───────────── */

export type ContentDetail = Awaited<ReturnType<typeof detailFor>>;

async function detailFor(user: CurrentUser, id: string) {
  const db = getDb();
  const item = await load(id);
  if (!item) return null;
  const [assets, activity, [latest]] = await Promise.all([
    db
      .select({ id: schema.contentAssets.id, kind: schema.contentAssets.kind, version: schema.contentAssets.version, name: schema.contentAssets.name, fileKey: schema.contentAssets.fileKey, url: schema.contentAssets.url, mime: schema.contentAssets.mime, size: schema.contentAssets.size, by: schema.users.name, at: schema.contentAssets.createdAt })
      .from(schema.contentAssets)
      .leftJoin(schema.users, eq(schema.users.id, schema.contentAssets.uploadedBy))
      .where(eq(schema.contentAssets.contentId, id))
      .orderBy(desc(schema.contentAssets.version), asc(schema.contentAssets.createdAt)),
    db
      .select({ id: schema.contentActivity.id, type: schema.contentActivity.type, from: schema.contentActivity.fromStatus, to: schema.contentActivity.toStatus, body: schema.contentActivity.body, by: schema.users.name, byId: schema.contentActivity.actorId, at: schema.contentActivity.createdAt })
      .from(schema.contentActivity)
      .leftJoin(schema.users, eq(schema.users.id, schema.contentActivity.actorId))
      .where(eq(schema.contentActivity.contentId, id))
      .orderBy(desc(schema.contentActivity.createdAt))
      .limit(100),
    db.select({ v: max(schema.contentAssets.version) }).from(schema.contentAssets).where(and(eq(schema.contentAssets.contentId, id), eq(schema.contentAssets.kind, "design"))),
  ]);
  const steps = CONTENT_STEPS[item.status].filter((s) => canTakeStep(s, user.role, user.id, item.designerId));
  return {
    item: {
      id: item.id,
      title: item.title,
      date: wibDate(item.publishAt),
      time: wibTime(item.publishAt),
      status: item.status,
      channels: item.channels,
      format: item.format,
      campaignId: item.campaignId,
      writerId: item.writerId,
      designerId: item.designerId,
      objective: item.objective,
      keyMessage: item.keyMessage,
      guideline: item.guideline,
      caption: item.caption,
      cta: item.cta,
      hashtags: item.hashtags,
      products: item.products,
      designVersion: Math.max(item.designVersion, latest?.v ?? 0),
      publishedUrl: item.publishedUrl,
    },
    assets: assets.map((a) => ({ ...a, at: a.at.toISOString() })),
    activity: activity.map((a) => ({ ...a, at: a.at.toISOString() })),
    can: {
      edit: canEditBrief(user.role, item.status),
      delete: canDeleteContent(user.role, item.status),
      upload: canUploadDesign(user.role, user.id, item.designerId, item.status),
      comment: canComment(user.role, user.id, item.designerId),
      steps,
    },
  };
}

/** Everything the detail panel shows. Everyone who can open the Content Calendar may read it. */
export async function loadContentDetail(id: string) {
  const user = await verifyUser();
  const p = z.uuid().safeParse(id);
  if (!p.success) return null;
  return detailFor(user, p.data);
}
