"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { NOTIFICATION_TYPES } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone";
import { getSession } from "@/lib/session";
import { sniffImage } from "@/lib/sniff-image";
import { buildKey, getStorage } from "@/lib/storage";

const Profile = z.object({
  name: z.string("Name is required.").min(2, "Name is required.").max(120),
  phone: z.string().max(40).optional(),
});

/** Every user edits their own name and phone. Role, department and manager stay with admins. */
export async function updateProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Profile.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const phone = normalizePhone(parsed.data.phone);
  if (parsed.data.phone && !phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } };
  const db = getDb();
  const [before] = await db.select({ name: schema.users.name, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, user.id));
  await db.update(schema.users).set({ name: parsed.data.name, phone }).where(eq(schema.users.id, user.id));
  const changes: Record<string, unknown> = {};
  if (before.name !== parsed.data.name) changes.name = [before.name, parsed.data.name];
  if (before.phone !== phone) changes.phone = [before.phone, phone];
  await audit({ actorId: user.id, action: "update", entity: "profile", entityId: user.email, changes });
  refresh();
  return { ok: true, message: "Profile saved." };
}

const MAX_AVATAR = 1024 * 1024; // already ~30 KB after the browser shrinks it

export async function uploadAvatar(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo." };
  if (file.size > MAX_AVATAR) return { ok: false, error: "Photo is too large." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return { ok: false, error: "Use a JPG, PNG or WebP photo." };
  const storage = await getStorage();
  const key = buildKey("avatars", ext);
  await storage.put(key, bytes, ext === "jpg" ? "image/jpeg" : `image/${ext}`);
  const db = getDb();
  const [before] = await db.select({ key: schema.users.avatarKey }).from(schema.users).where(eq(schema.users.id, user.id));
  await db.update(schema.users).set({ avatarKey: key }).where(eq(schema.users.id, user.id));
  if (before?.key) await storage.delete(before.key).catch(() => {});
  await audit({ actorId: user.id, action: "update", entity: "profile", entityId: user.email, changes: { photo: "changed" } });
  refresh();
  return { ok: true, message: "Photo updated." };
}

export async function removeAvatar(): Promise<FormState> {
  const user = await verifyUser();
  const db = getDb();
  const [before] = await db.select({ key: schema.users.avatarKey }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!before?.key) return { ok: true };
  await db.update(schema.users).set({ avatarKey: null }).where(eq(schema.users.id, user.id));
  await (await getStorage()).delete(before.key).catch(() => {});
  await audit({ actorId: user.id, action: "update", entity: "profile", entityId: user.email, changes: { photo: "removed" } });
  refresh();
  return { ok: true, message: "Photo removed." };
}

const Password = z
  .object({
    current: z.string("Enter your current password.").min(1, "Enter your current password.").max(200),
    next: z.string("Choose a new password.").min(10, "At least 10 characters.").max(200),
    confirm: z.string("Repeat the new password.").max(200),
  })
  .refine((d) => d.next === d.confirm, { path: ["confirm"], message: "The passwords don't match." })
  .refine((d) => d.next !== d.current, { path: ["next"], message: "Use a different password from the current one." });

/** Checks the old password, saves a new bcrypt hash and signs out every other session. */
export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Password.safeParse({ current: fd.get("current") ?? undefined, next: fd.get("next") ?? undefined, confirm: fd.get("confirm") ?? undefined });
  if (!parsed.success) return fieldErrors(parsed.error);
  const db = getDb();
  const [row] = await db.select({ hash: schema.users.passwordHash, forced: schema.users.mustChangePassword }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!row?.hash || !(await bcrypt.compare(parsed.data.current, row.hash))) {
    await audit({ actorId: user.id, action: "password_change_failed", entity: "profile", entityId: user.email });
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { current: "Current password is incorrect." } };
  }
  const hash = await bcrypt.hash(parsed.data.next, 12);
  const [updated] = await db
    .update(schema.users)
    .set({ passwordHash: hash, mustChangePassword: false, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, user.id))
    .returning({ v: schema.users.sessionVersion });
  // Keep this browser signed in with the new version; other devices are signed out.
  const session = await getSession();
  session.v = updated.v;
  await session.save();
  await audit({ actorId: user.id, action: "password_change", entity: "profile", entityId: user.email });
  // First sign-in with a temporary password: continue into the app.
  if (row.forced) redirect("/dashboard");
  return { ok: true, message: "Password changed. Other devices have been signed out." };
}

/** Per-type channels. Fields: <type>:inApp / <type>:email / <type>:push (checkboxes). */
export async function saveNotificationPreferences(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const types = Object.keys(NOTIFICATION_TYPES);
  const rows = types.map((type) => ({ userId: user.id, type, inApp: fd.has(`${type}:inApp`), email: fd.has(`${type}:email`), push: fd.has(`${type}:push`) }));
  await getDb().transaction(async (tx) => {
    for (const r of rows) {
      await tx
        .insert(schema.notificationPreferences)
        .values(r)
        .onConflictDoUpdate({ target: [schema.notificationPreferences.userId, schema.notificationPreferences.type], set: { inApp: r.inApp, email: r.email, push: r.push } });
    }
  });
  const off = rows.filter((r) => !r.inApp || !r.email || !r.push).map((r) => r.type);
  await audit({ actorId: user.id, action: "update", entity: "notification_preferences", entityId: user.email, changes: { customised: off } });
  refresh();
  return { ok: true, message: "Notification settings saved." };
}
