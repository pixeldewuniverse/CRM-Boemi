"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { rp } from "@/lib/format";
import { VISIT_PURPOSES } from "@/lib/labels";
import { notify } from "@/lib/notifications";
import { canApproveFees, canSell } from "@/lib/permissions";
import { buildKey, getStorage } from "@/lib/storage";

const MAX_PHOTO = 3.5 * 1024 * 1024;
const MAX_FEE = 1_000_000;

const CheckIn = z.object({
  accountId: z.uuid("Choose the account you're visiting."),
  purpose: z.enum(VISIT_PURPOSES).default("Account visit"),
  notes: z.string("Write a short note about the visit.").min(5, "Write a short note about the visit.").max(1000),
  lat: z.coerce.number("Get your location first.").min(-90).max(90),
  lng: z.coerce.number("Get your location first.").min(-180).max(180),
  fee: z.string().optional(),
});

/** Image type from the file's first bytes (not the browser-supplied name/type). */
function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

/** Check-in with GPS + photo, optionally claiming a visit fee for approval. */
export async function checkInVisit(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't check in visits." };
  const parsed = CheckIn.safeParse(formObject(fd));
  if (!parsed.success) {
    const res = fieldErrors(parsed.error);
    if (res.fieldErrors?.lat || res.fieldErrors?.lng) res.fieldErrors.location = "Tap “Get my location” before saving.";
    return res;
  }
  const d = parsed.data;
  const fee = parseRupiah(d.fee) ?? 0;
  if (fee > MAX_FEE) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { fee: `Maximum ${rp(MAX_FEE)} per visit.` } };

  const photo = fd.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { photo: "Take a photo at the location." } };
  if (photo.size > MAX_PHOTO) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { photo: "Photo is too large — try again." } };
  const bytes = Buffer.from(await photo.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { photo: "Use a JPG, PNG or WebP photo." } };

  const db = getDb();
  const [account] = await db
    .select({ id: schema.customers.id, name: schema.customers.name })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, d.accountId), customerScope(user)));
  if (!account) return { ok: false, error: "Account not found.", fieldErrors: { accountId: "Choose one of your accounts." } };

  const key = buildKey("visits", ext);
  await (await getStorage()).put(key, bytes, ext === "jpg" ? "image/jpeg" : `image/${ext}`);
  const now = new Date();

  await db.transaction(async (tx) => {
    const [visit] = await tx
      .insert(schema.visits)
      .values({
        customerId: account.id,
        salesId: user.id,
        status: "completed",
        scheduledAt: now,
        checkedInAt: now,
        latitude: d.lat,
        longitude: d.lng,
        photoKey: key,
        purpose: d.purpose,
        notes: d.notes,
      })
      .returning({ id: schema.visits.id });
    if (fee > 0) {
      await tx.insert(schema.visitFees).values({ visitId: visit.id, amount: fee, description: "Transport & parking", status: "pending", requestedBy: user.id });
    }
  });

  await audit({ actorId: user.id, action: "check_in", entity: "visit", entityId: account.name, changes: { fee, gps: `${d.lat.toFixed(5)},${d.lng.toFixed(5)}` } });
  if (fee > 0) {
    const approvers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["finance", "sales_manager"]), ne(schema.users.id, user.id)));
    await notify({
      userIds: approvers.map((a) => a.id),
      type: "visit_fee.pending",
      title: `Visit fee ${rp(fee)} to approve`,
      body: `${user.name} · ${account.name}`,
      link: "/sales/visits?fee=pending",
    });
  }
  refresh();
  return { ok: true, message: `Checked in at ${account.name}.` };
}

async function loadFee(feeId: string) {
  const [fee] = await getDb()
    .select({ id: schema.visitFees.id, status: schema.visitFees.status, amount: schema.visitFees.amount, requestedBy: schema.visitFees.requestedBy, account: schema.customers.name })
    .from(schema.visitFees)
    .innerJoin(schema.visits, eq(schema.visits.id, schema.visitFees.visitId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.visits.customerId))
    .where(eq(schema.visitFees.id, feeId));
  return fee;
}

export async function approveFee(feeId: string): Promise<FormState> {
  const user = await verifyUser();
  if (!canApproveFees(user)) return { ok: false, error: "Only Finance or a Sales Manager can approve." };
  const id = z.uuid().safeParse(feeId);
  if (!id.success) return { ok: false, error: "Invalid fee." };
  const fee = await loadFee(id.data);
  if (!fee || fee.status !== "pending") return { ok: false, error: "This fee is no longer pending." };
  if (fee.requestedBy === user.id) return { ok: false, error: "You can't approve your own fee." };
  await getDb()
    .update(schema.visitFees)
    .set({ status: "approved", decidedBy: user.id, decidedAt: new Date(), decisionNote: null })
    .where(and(eq(schema.visitFees.id, fee.id), eq(schema.visitFees.status, "pending")));
  await audit({ actorId: user.id, action: "approve", entity: "visit_fee", entityId: fee.account, changes: { amount: fee.amount } });
  await notify({ userIds: [fee.requestedBy], type: "visit_fee.decided", title: `Visit fee approved: ${rp(fee.amount)}`, body: `${fee.account} · by ${user.name}`, link: "/sales/visits" });
  refresh();
  return { ok: true };
}

const Reject = z.object({ feeId: z.uuid(), note: z.string("Tell the rep why.").min(5, "Tell the rep why.").max(300) });

export async function rejectFee(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canApproveFees(user)) return { ok: false, error: "Only Finance or a Sales Manager can reject." };
  const parsed = Reject.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const fee = await loadFee(parsed.data.feeId);
  if (!fee || fee.status !== "pending") return { ok: false, error: "This fee is no longer pending." };
  if (fee.requestedBy === user.id) return { ok: false, error: "You can't decide on your own fee." };
  await getDb()
    .update(schema.visitFees)
    .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date(), decisionNote: parsed.data.note })
    .where(and(eq(schema.visitFees.id, fee.id), eq(schema.visitFees.status, "pending")));
  await audit({ actorId: user.id, action: "reject", entity: "visit_fee", entityId: fee.account, changes: { reason: parsed.data.note } });
  await notify({ userIds: [fee.requestedBy], type: "visit_fee.decided", title: `Visit fee rejected: ${rp(fee.amount)}`, body: parsed.data.note, link: "/sales/visits" });
  refresh();
  return { ok: true };
}
