"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { enqueueQualification } from "@/lib/qualification/queue";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { rp } from "@/lib/format";
import { VISIT_PURPOSES } from "@/lib/labels";
import { canSell } from "@/lib/permissions";
import { decide, pendingRequestFor, submitForApproval } from "@/lib/approvals";
import { sniffImage } from "@/lib/sniff-image";
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

  const feeId = await db.transaction(async (tx) => {
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
      const [f] = await tx.insert(schema.visitFees).values({ visitId: visit.id, amount: fee, description: "Transport & parking", status: "pending", requestedBy: user.id }).returning({ id: schema.visitFees.id });
      return f.id;
    }
    return null;
  });

  await enqueueQualification("account", account.id, "visit");
  await audit({ actorId: user.id, action: "check_in", entity: "visit", entityId: account.name, changes: { fee, gps: `${d.lat.toFixed(5)},${d.lng.toFixed(5)}` } });
  if (feeId) {
    // Approval engine (Settings → Approval Workflows); default flow: Manager or Finance.
    const res = await submitForApproval({ entityType: "visit_fee", entityId: feeId, amount: fee, title: `Visit fee · ${account.name} · ${user.name}`, link: "/sales/visits?fee=pending", requesterId: user.id });
    if (res.status === "approved") {
      await db.update(schema.visitFees).set({ status: "approved", decidedAt: new Date(), decisionNote: "No approval needed for this amount." }).where(eq(schema.visitFees.id, feeId));
    }
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
  const id = z.uuid().safeParse(feeId);
  if (!id.success) return { ok: false, error: "Invalid fee." };
  const fee = await loadFee(id.data);
  if (!fee || fee.status !== "pending") return { ok: false, error: "This fee is no longer pending." };
  const pending = await pendingRequestFor("visit_fee", fee.id);
  if (!pending) return { ok: false, error: "This fee is not waiting for approval." };
  const res = await decide(user, pending.req.id, "approved");
  if (!res.ok) return { ok: false, error: res.error };
  refresh();
  return { ok: true };
}

const Reject = z.object({ feeId: z.uuid(), note: z.string("Tell the rep why.").min(5, "Tell the rep why.").max(300) });

export async function rejectFee(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Reject.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const fee = await loadFee(parsed.data.feeId);
  if (!fee || fee.status !== "pending") return { ok: false, error: "This fee is no longer pending." };
  const pending = await pendingRequestFor("visit_fee", fee.id);
  if (!pending) return { ok: false, error: "This fee is not waiting for approval." };
  const res = await decide(user, pending.req.id, "rejected", parsed.data.note);
  if (!res.ok) return { ok: false, error: res.error };
  refresh();
  return { ok: true };
}
