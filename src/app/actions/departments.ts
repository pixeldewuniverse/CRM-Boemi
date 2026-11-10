"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { canManageUsers } from "@/lib/permissions";

const DENIED: FormState = { ok: false, error: "Only a Super Admin can manage departments." };

const Department = z.object({
  name: z.string("Name is required.").min(2, "Name is required.").max(80),
  code: z
    .string("Code is required.")
    .min(2, "Code is required.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only.")
    .transform((v) => v.toUpperCase()),
  headUserId: z.uuid().optional(),
  parentId: z.uuid().optional(),
});

async function check(fd: FormData, exceptId?: string) {
  const parsed = Department.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  const db = getDb();
  const [dup] = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(and(sql`upper(${schema.departments.code}) = ${d.code}`, exceptId ? ne(schema.departments.id, exceptId) : undefined));
  if (dup) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { code: "This code is already used." } } } as const;
  if (d.parentId && exceptId) {
    // No loops: the parent can't be this department or one of its sub-departments.
    let cursor: string | null = d.parentId;
    for (let i = 0; cursor && i < 20; i++) {
      if (cursor === exceptId) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { parentId: "A department can't sit under itself." } } } as const;
      const [p] = await db.select({ parent: schema.departments.parentId }).from(schema.departments).where(eq(schema.departments.id, cursor));
      cursor = p?.parent ?? null;
    }
  }
  return { values: { name: d.name, code: d.code, headUserId: d.headUserId ?? null, parentId: d.parentId ?? null } } as const;
}

/** The head joins the department, so their data scope covers it. */
async function placeHead(headUserId: string | null, departmentId: string, name: string) {
  if (!headUserId) return;
  await getDb().update(schema.users).set({ departmentId, department: name }).where(eq(schema.users.id, headUserId));
}

export async function createDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return DENIED;
  const v = await check(fd);
  if ("error" in v) return v.error as FormState;
  const [row] = await getDb().insert(schema.departments).values(v.values).returning({ id: schema.departments.id });
  await placeHead(v.values.headUserId, row.id, v.values.name);
  await audit({ actorId: user.id, action: "create", entity: "department", entityId: v.values.code, changes: { name: v.values.name } });
  refresh();
  return { ok: true, message: `${v.values.name} added.` };
}

export async function updateDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid department." };
  const v = await check(fd, id.data);
  if ("error" in v) return v.error as FormState;
  const db = getDb();
  const [before] = await db.select().from(schema.departments).where(eq(schema.departments.id, id.data));
  if (!before) return { ok: false, error: "Department not found." };
  await db.update(schema.departments).set(v.values).where(eq(schema.departments.id, id.data));
  // Keep the legacy text column readable for exports.
  if (before.name !== v.values.name) await db.update(schema.users).set({ department: v.values.name }).where(eq(schema.users.departmentId, id.data));
  await placeHead(v.values.headUserId, id.data, v.values.name);
  const changes: Record<string, unknown> = {};
  for (const k of ["name", "code", "headUserId", "parentId"] as const) if (before[k] !== v.values[k]) changes[k] = [before[k], v.values[k]];
  await audit({ actorId: user.id, action: "update", entity: "department", entityId: v.values.code, changes });
  refresh();
  return { ok: true, message: "Department saved." };
}

export async function deleteDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid department." };
  const db = getDb();
  const [d] = await db.select().from(schema.departments).where(eq(schema.departments.id, id.data));
  if (!d) return { ok: false, error: "Department not found." };
  const [[members], [children]] = await Promise.all([
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.departmentId, d.id)),
    db.select({ n: count() }).from(schema.departments).where(eq(schema.departments.parentId, d.id)),
  ]);
  if (members.n || children.n) return { ok: false, error: `${d.name} still has ${members.n} people and ${children.n} sub-departments. Move them first.` };
  await db.delete(schema.departments).where(eq(schema.departments.id, d.id));
  await audit({ actorId: user.id, action: "delete", entity: "department", entityId: d.code });
  refresh();
  return { ok: true, message: `${d.name} deleted.` };
}
