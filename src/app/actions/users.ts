"use server";

import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { canManageUsers } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { ROLES, ROLE_LABEL } from "@/lib/roles";

const DENIED: FormState = { ok: false, error: "Only a Super Admin can manage users." };

const UserInput = z.object({
  name: z.string("Name is required.").min(2, "Name is required.").max(120),
  email: z.email("Enter a valid email.").max(254),
  role: z.enum(ROLES, "Choose a role."),
  departmentId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  position: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  joinedOn: z.iso.date("Pick a date.").optional(),
});

/** 12 characters without look-alikes (0/O, 1/l/I). */
function temporaryPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join("");
}

async function activeAdmins(exceptId?: string) {
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true), exceptId ? ne(schema.users.id, exceptId) : undefined));
  return n;
}

async function values(fd: FormData, exceptId?: string) {
  const parsed = UserInput.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  const email = d.email.toLowerCase();
  const db = getDb();
  const [taken] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(sql`lower(${schema.users.email}) = ${email}`, exceptId ? ne(schema.users.id, exceptId) : undefined));
  if (taken) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { email: "Another user already has this email." } } } as const;
  const phone = normalizePhone(d.phone);
  if (d.phone && !phone) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } } } as const;
  if (d.managerId && d.managerId === exceptId) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { managerId: "Someone can't report to themselves." } } } as const;
  if (d.managerId) {
    const [m] = await db.select({ id: schema.users.id, managerId: schema.users.managerId }).from(schema.users).where(eq(schema.users.id, d.managerId));
    if (!m) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { managerId: "Manager not found." } } } as const;
    if (exceptId && m.managerId === exceptId) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { managerId: "That person reports to this user — choose someone else." } } } as const;
  }
  let department: string | null = null;
  if (d.departmentId) {
    const [dep] = await db.select({ name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.id, d.departmentId));
    if (!dep) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { departmentId: "Department not found." } } } as const;
    department = dep.name;
  }
  return {
    values: {
      name: d.name,
      email,
      role: d.role,
      departmentId: d.departmentId ?? null,
      department, // legacy text column, kept in sync
      managerId: d.managerId ?? null,
      position: d.position ?? null,
      region: d.region ?? null,
      phone,
      joinedOn: d.joinedOn ?? null,
    },
  } as const;
}

/** Emails the temporary password. Returns false when SMTP isn't set (the admin passes it on). */
async function sendTemporaryPassword(to: string, name: string, password: string, reason: "new" | "reset") {
  const url = process.env.APP_URL ?? "";
  return sendEmail({
    to,
    subject: reason === "new" ? "Your BOEMI Sales & Marketing Tools account" : "Your BOEMI Sales & Marketing Tools password was reset",
    text: [
      `Hi ${name},`,
      "",
      reason === "new" ? "An account was created for you." : "An admin reset your password.",
      `Sign in at ${url || "the tools"}/login with this email and the temporary password:`,
      "",
      `    ${password}`,
      "",
      "You'll be asked to choose your own password right after signing in.",
    ].join("\n"),
  });
}

function shown(password: string, emailed: boolean) {
  return emailed
    ? `Temporary password emailed. Shown once in case it doesn't arrive: ${password}`
    : `Email isn't set up, so pass this temporary password on yourself (shown once): ${password}`;
}

export async function createUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await verifyUser();
  if (!canManageUsers(actor)) return DENIED;
  const v = await values(fd);
  if ("error" in v) return v.error as FormState;
  const password = temporaryPassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const [row] = await getDb()
    .insert(schema.users)
    .values({ ...v.values, passwordHash, mustChangePassword: true, active: true })
    .returning({ id: schema.users.id });
  await audit({ actorId: actor.id, action: "create", entity: "user", entityId: v.values.email, changes: { role: v.values.role, department: v.values.department } });
  const emailed = await sendTemporaryPassword(v.values.email, v.values.name, password, "new");
  refresh();
  void row;
  return { ok: true, message: `${v.values.name} added. ${shown(password, emailed)}` };
}

export async function updateUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await verifyUser();
  if (!canManageUsers(actor)) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid user." };
  const db = getDb();
  const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id.data));
  if (!before) return { ok: false, error: "User not found." };
  const v = await values(fd, id.data);
  if ("error" in v) return v.error as FormState;
  if (before.id === actor.id && v.values.role !== before.role) {
    return { ok: false, error: "You can't change your own role.", fieldErrors: { role: "Ask another Super Admin." } };
  }
  if (before.role === "admin" && v.values.role !== "admin" && before.active && (await activeAdmins(before.id)) === 0) {
    return { ok: false, error: "This is the last active Super Admin.", fieldErrors: { role: "Make someone else Super Admin first." } };
  }
  const roleChanged = before.role !== v.values.role;
  await db
    .update(schema.users)
    // A new role takes effect on the next request; bumping the session version signs them out to be safe.
    .set({ ...v.values, ...(roleChanged ? { sessionVersion: before.sessionVersion + 1 } : {}) })
    .where(eq(schema.users.id, id.data));
  const changes: Record<string, unknown> = {};
  for (const k of ["name", "email", "role", "departmentId", "managerId", "position", "region", "phone"] as const) {
    if (before[k] !== v.values[k]) changes[k] = [before[k], v.values[k]];
  }
  await audit({ actorId: actor.id, action: "update", entity: "user", entityId: v.values.email, changes });
  refresh();
  return { ok: true, message: roleChanged ? `Saved. ${v.values.name} is now ${ROLE_LABEL[v.values.role]} and must sign in again.` : "Saved." };
}

async function guardTarget(id: string) {
  const [u] = await getDb().select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) return { error: "User not found." } as const;
  return { u } as const;
}

/** Deactivate signs the user out at once (verifyUser checks `active`, and the session version changes). */
export async function setUserActive(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await verifyUser();
  if (!canManageUsers(actor)) return DENIED;
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const active = parsed.data.active === "true";
  const t = await guardTarget(parsed.data.id);
  if ("error" in t) return { ok: false, error: t.error };
  const u = t.u;
  if (!active && u.id === actor.id) return { ok: false, error: "You can't deactivate yourself." };
  if (!active && u.role === "admin" && (await activeAdmins(u.id)) === 0) return { ok: false, error: "This is the last active Super Admin." };
  let message = active ? `${u.name} can sign in again.` : `${u.name} is deactivated and signed out.`;
  const patch: Partial<typeof schema.users.$inferInsert> = { active, sessionVersion: u.sessionVersion + 1 };
  // Imported users have no password yet: activating = inviting.
  let password: string | null = null;
  if (active && !u.passwordHash && u.authProvider === "password") {
    password = temporaryPassword();
    Object.assign(patch, { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true });
  }
  await getDb().update(schema.users).set(patch).where(eq(schema.users.id, u.id));
  await audit({ actorId: actor.id, action: active ? (password ? "invite" : "activate") : "deactivate", entity: "user", entityId: u.email });
  if (password) message = `${u.name} is active. ${shown(password, await sendTemporaryPassword(u.email, u.name, password, "new"))}`;
  refresh();
  return { ok: true, message };
}

/** New temporary password, must be changed at the next sign-in; other sessions end. */
export async function resetUserPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await verifyUser();
  if (!canManageUsers(actor)) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid user." };
  const t = await guardTarget(id.data);
  if ("error" in t) return { ok: false, error: t.error };
  const u = t.u;
  if (u.id === actor.id) return { ok: false, error: "Change your own password in My profile." };
  if (u.authProvider === "google") return { ok: false, error: `${u.name} signs in with Google — there's no password to reset.` };
  const password = temporaryPassword();
  await getDb()
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, sessionVersion: u.sessionVersion + 1 })
    .where(eq(schema.users.id, u.id));
  await audit({ actorId: actor.id, action: "reset_password", entity: "user", entityId: u.email });
  const emailed = await sendTemporaryPassword(u.email, u.name, password, "reset");
  refresh();
  return { ok: true, message: shown(password, emailed) };
}
