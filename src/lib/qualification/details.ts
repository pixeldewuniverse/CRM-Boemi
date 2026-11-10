import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CriterionResult, Tier } from "./core";
import { aiConfig } from "./providers";

export type RunView = {
  id: string;
  at: string;
  trigger: string;
  score: number;
  tier: Tier;
  reason: string | null;
  criteriaVersion: string;
  results: CriterionResult[];
  ai: { provider?: string; model?: string; error?: string; skipped?: string; missingInfo?: string[]; suggestedNextAction?: string; sentFields?: string[] } | null;
  by: string | null;
};

export type ScoreDetails = {
  type: "lead" | "account";
  id: string;
  name: string;
  score: number | null;
  tier: Tier | null;
  override: { tier: Tier; reason: string | null; by: string | null; at: string | null } | null;
  runs: RunView[];
  aiOn: boolean;
};

/** Latest runs + override for one lead/account (caller checks access). */
export async function scoreDetails(type: "lead" | "account", id: string): Promise<ScoreDetails | null> {
  const db = getDb();
  const t = type === "lead" ? schema.leads : schema.customers;
  const nameCol = type === "lead" ? schema.leads.company : schema.customers.name;
  const [row] = await db
    .select({ name: nameCol, score: t.qualificationScore, tier: t.qualificationTier, override: t.tierOverride, reason: t.tierOverrideReason, byId: t.tierOverrideBy, at: t.tierOverrideAt })
    .from(t)
    .where(eq(t.id, id));
  if (!row) return null;
  const r = schema.qualificationRuns;
  const [runs, by] = await Promise.all([
    db
      .select({ run: r, by: schema.users.name })
      .from(r)
      .leftJoin(schema.users, eq(schema.users.id, r.createdBy))
      .where(and(eq(r.subjectType, type), eq(r.subjectId, id)))
      .orderBy(desc(r.createdAt))
      .limit(6),
    row.byId ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, row.byId)).then((x) => x[0]?.name ?? null) : null,
  ]);
  return {
    type,
    id,
    name: row.name,
    score: row.score,
    tier: row.tier,
    override: row.override ? { tier: row.override, reason: row.reason, by, at: row.at?.toISOString() ?? null } : null,
    runs: runs.map(({ run, by: who }) => ({
      id: run.id,
      at: run.createdAt.toISOString(),
      trigger: run.trigger,
      score: run.score,
      tier: run.tier,
      reason: run.reason,
      criteriaVersion: run.criteriaVersion,
      results: run.results as CriterionResult[],
      ai: (run.ai as RunView["ai"]) ?? null,
      by: who,
    })),
    aiOn: aiConfig().on,
  };
}
