"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { parseRupiah, type FormState } from "@/lib/forms";
import { TARGET_METRICS, type TargetMetric } from "@/lib/labels";
import { canManageTargets } from "@/lib/permissions";
import { prevPeriod } from "@/lib/queries/sales";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month.");
const METRICS = Object.keys(TARGET_METRICS) as TargetMetric[];

async function activeReps() {
  return getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["sales", "sales_manager"])));
}

/** Saves the whole month grid. Fields: t:<userId>:<metric>. Empty = no target. */
export async function saveTargets(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageTargets(user)) return { ok: false, error: "Only admins and sales managers can set targets." };
  const period = Period.safeParse(fd.get("period"));
  if (!period.success) return { ok: false, error: "Invalid month." };
  const reps = new Set((await activeReps()).map((r) => r.id));

  const upserts: { userId: string; metric: TargetMetric; period: string; target: number }[] = [];
  const clears: { userId: string; metric: TargetMetric }[] = [];
  const errors: Record<string, string> = {};
  for (const [key, raw] of fd.entries()) {
    const m = /^t:([0-9a-f-]{36}):([a-z_]+)$/.exec(key);
    if (!m || typeof raw !== "string") continue;
    const [, userId, metric] = m as unknown as [string, string, TargetMetric];
    if (!reps.has(userId) || !METRICS.includes(metric)) continue;
    const value = raw.trim() === "" ? undefined : parseRupiah(raw);
    if (raw.trim() !== "" && (value === undefined || value > 1e13)) {
      errors[key] = "Enter a number.";
      continue;
    }
    if (value === undefined || value === 0) clears.push({ userId, metric });
    else upserts.push({ userId, metric, period: period.data, target: value });
  }
  if (Object.keys(errors).length) return { ok: false, error: "Some cells aren't numbers.", fieldErrors: errors };

  let cleared = 0;
  await getDb().transaction(async (tx) => {
    for (const u of upserts) {
      await tx
        .insert(schema.kpiTargets)
        .values(u)
        .onConflictDoUpdate({ target: [schema.kpiTargets.userId, schema.kpiTargets.metric, schema.kpiTargets.period], set: { target: u.target } });
    }
    for (const c of clears) {
      const gone = await tx
        .delete(schema.kpiTargets)
        .where(and(eq(schema.kpiTargets.userId, c.userId), eq(schema.kpiTargets.metric, c.metric), eq(schema.kpiTargets.period, period.data)))
        .returning({ id: schema.kpiTargets.id });
      cleared += gone.length;
    }
  });
  await audit({ actorId: user.id, action: "update", entity: "kpi_target", entityId: period.data, changes: { set: upserts.length, cleared } });
  refresh();
  return { ok: true, message: "Targets saved." };
}

/** Fills this month's empty cells with last month's targets (never overwrites). */
export async function copyLastMonthTargets(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageTargets(user)) return { ok: false, error: "Only admins and sales managers can set targets." };
  const period = Period.safeParse(fd.get("period"));
  if (!period.success) return { ok: false, error: "Invalid month." };
  const from = prevPeriod(period.data);
  const reps = (await activeReps()).map((r) => r.id);
  if (!reps.length) return { ok: false, error: "No active sales reps." };
  const db = getDb();
  const source = await db
    .select()
    .from(schema.kpiTargets)
    .where(and(eq(schema.kpiTargets.period, from), inArray(schema.kpiTargets.userId, reps)));
  if (!source.length) return { ok: false, error: `No targets were set for ${from}.` };
  const inserted = await db
    .insert(schema.kpiTargets)
    .values(source.map((s) => ({ userId: s.userId, metric: s.metric, period: period.data, target: s.target })))
    .onConflictDoNothing()
    .returning({ id: schema.kpiTargets.id });
  await audit({ actorId: user.id, action: "copy", entity: "kpi_target", entityId: period.data, changes: { from, copied: inserted.length } });
  refresh();
  return { ok: true, message: inserted.length ? `Copied ${inserted.length} targets from ${from}.` : "Every cell already had a target — nothing copied." };
}
