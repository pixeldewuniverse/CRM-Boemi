/**
 * Qualification engine — loads a lead/account, runs layer 1 (rules) and
 * optional layer 2 (AI on free text), computes the score in code, stores a
 * run and updates the record. No "server-only"/@ imports so the seed can use
 * it too; callers pass the database.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema";
import { aiSkipped, criteriaVersion, evaluateRule, finalScore, redact, regionOf, validateAi, type AiOutput, type Criterion, type CriterionResult, type Structured, type TextPart, type Thresholds } from "./core";
import { rubricOf, type QualificationAi } from "./providers";

export type Db = PostgresJsDatabase<typeof schema>;
export type SubjectType = "lead" | "account";

/** Interest keys that may be sent to the AI (never contact details). */
const SAFE_INTEREST_KEYS = new Set(["expectedVolume", "products", "productInterest", "timeline", "rooms", "outlets", "budget"]);

function safeInterests(i: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i ?? {})) {
    if (k === "journey" && v && typeof v === "object") {
      const j = v as { scent?: { name?: string; tagline?: string; pathway?: string } | null; takeHomePreference?: string };
      out.journey = { takeHomePreference: j.takeHomePreference ?? null, scent: j.scent ? { name: j.scent.name, tagline: j.scent.tagline, pathway: j.scent.pathway } : null };
    } else if (SAFE_INTEREST_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export type Subject = {
  type: SubjectType;
  id: string;
  ownerId: string | null;
  structured: Structured;
  /** Redacted free text for the AI. */
  texts: TextPart[];
  tierOverride: "hot" | "warm" | "cold" | null;
};

export async function loadSubject(db: Db, type: SubjectType, id: string): Promise<Subject | null> {
  if (type === "lead") {
    const [l] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    if (!l) return null;
    const names = { company: [l.company], people: [l.picName, l.company] };
    const texts: TextPart[] = [];
    if (l.note) texts.push({ label: "Lead note", text: redact(l.note, names) });
    const j = (l.interests as { journey?: { scent?: { name?: string; tagline?: string; pathway?: string } | null; takeHomePreference?: string } } | null)?.journey;
    if (j) texts.push({ label: "Aroma journey answers", text: [j.scent?.name && `Aroma result: ${j.scent.name}`, j.scent?.tagline, j.scent?.pathway && `Pathway: ${j.scent.pathway}`, j.takeHomePreference && `Take-home choice: ${j.takeHomePreference.replace("_", " ")}`].filter(Boolean).join(". ") });
    return {
      type,
      id,
      ownerId: l.ownerId,
      tierOverride: l.tierOverride,
      structured: { segment: l.segment, city: l.city, region: regionOf(l.city), source: l.source, marketingConsent: l.marketingConsent, interests: (l.interests as Record<string, unknown>) ?? {} },
      texts,
    };
  }
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  if (!c) return null;
  const [contacts, visits, acts, leads] = await Promise.all([
    db.select({ name: schema.contacts.name, dm: schema.contacts.isDecisionMaker }).from(schema.contacts).where(eq(schema.contacts.customerId, id)),
    db.select({ purpose: schema.visits.purpose, notes: schema.visits.notes }).from(schema.visits).where(eq(schema.visits.customerId, id)).orderBy(desc(schema.visits.createdAt)).limit(10),
    db.select({ type: schema.activities.type, notes: schema.activities.notes }).from(schema.activities).where(eq(schema.activities.customerId, id)).orderBy(desc(schema.activities.createdAt)).limit(15),
    db.select({ note: schema.leads.note, pic: schema.leads.picName }).from(schema.leads).where(eq(schema.leads.customerId, id)).orderBy(asc(schema.leads.createdAt)),
  ]);
  const names = { company: [c.name], people: [...contacts.map((x) => x.name), ...leads.map((x) => x.pic)] };
  const texts: TextPart[] = [
    ...leads.filter((x) => x.note).map((x) => ({ label: "Original lead note", text: redact(x.note!, names) })),
    ...visits.filter((v) => v.notes).map((v) => ({ label: `Visit notes${v.purpose ? ` (${v.purpose})` : ""}`, text: redact(v.notes!, names) })),
    ...acts.filter((a) => a.notes).map((a) => ({ label: `Activity (${a.type})`, text: redact(a.notes, names) })),
  ];
  return {
    type,
    id,
    ownerId: c.ownerId,
    tierOverride: c.tierOverride,
    structured: {
      segment: c.businessType,
      city: c.city,
      region: regionOf(c.city, c.region),
      source: c.source,
      marketingConsent: c.marketingConsent,
      interests: (c.interests as Record<string, unknown>) ?? {},
      contacts: { isDecisionMaker: contacts.some((x) => x.dm) },
    },
    texts,
  };
}

export async function activeCriteria(db: Db): Promise<Criterion[]> {
  const rows = await db.select().from(schema.qualificationCriteria).where(eq(schema.qualificationCriteria.active, true)).orderBy(asc(schema.qualificationCriteria.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, field: r.field, operator: r.operator, value: r.value, weight: r.weight, description: r.description }));
}

export type QualifyResult = { ok: true; score: number; tier: "hot" | "warm" | "cold"; aiUsed: boolean; aiError?: string } | { ok: false; error: string };

/** Scores one lead/account, stores the run and updates the record. */
export async function qualify(db: Db, type: SubjectType, id: string, opts: { trigger: string; actorId?: string | null; ai: QualificationAi | null; thresholds: Thresholds }): Promise<QualifyResult> {
  const subject = await loadSubject(db, type, id);
  if (!subject) return { ok: false, error: "Not found." };
  const criteria = await activeCriteria(db);
  const rules = criteria.filter((c) => c.kind === "rule");
  const aiCriteria = criteria.filter((c) => c.kind === "ai");
  const results: CriterionResult[] = rules.map((c) => evaluateRule(c, subject.structured));

  let ai: Record<string, unknown> | null = null;
  let aiOut: AiOutput | null = null;
  const sentText = subject.texts.map((t) => t.text).join("\n");
  if (aiCriteria.length && opts.ai && subject.texts.length) {
    const shortIds = aiCriteria.map((c, i) => ({ c, sid: `c${i + 1}` }));
    const facts = { segment: subject.structured.segment, city: subject.structured.city, region: subject.structured.region, source: subject.structured.source, marketingConsent: subject.structured.marketingConsent, interests: safeInterests(subject.structured.interests) };
    const started = Date.now();
    try {
      aiOut = await opts.ai.assess({ criteria: shortIds.map(({ c, sid }) => ({ id: sid, name: c.name, rubric: rubricOf(c) })), facts, texts: subject.texts });
      const byShort = new Map(aiOut.criteria.map((a) => [a.criterionId, a]));
      for (const { c, sid } of shortIds) results.push(validateAi(c, byShort.get(sid), sentText));
      ai = { provider: opts.ai.provider, model: opts.ai.model, ms: Date.now() - started, sentFields: [...Object.keys(facts), ...subject.texts.map((t) => t.label)], missingInfo: aiOut.missingInfo, suggestedNextAction: aiOut.suggestedNextAction, raw: aiOut.criteria };
    } catch (e) {
      // Fallback: layer 1 still scores; AI criteria are left out of the total.
      for (const c of aiCriteria) results.push(aiSkipped(c));
      ai = { provider: opts.ai.provider, model: opts.ai.model, ms: Date.now() - started, error: e instanceof Error ? e.message.slice(0, 300) : "AI failed" };
    }
  } else {
    for (const c of aiCriteria) results.push({ ...aiSkipped(c), detail: !opts.ai ? "AI off" : "No notes to read yet" });
    if (opts.ai && aiCriteria.length) ai = { provider: opts.ai.provider, model: opts.ai.model, skipped: "No free text yet" };
  }

  const { score, tier, reason } = finalScore(results, opts.thresholds);
  // Missing info: unknown AI criteria + empty rule fields the AI didn't mention.
  const missing = [...(aiOut?.missingInfo ?? []), ...results.filter((r) => r.kind === "ai" && r.unknown && !(aiOut?.missingInfo ?? []).length).map((r) => `Find out: ${r.name.toLowerCase()}`), ...results.filter((r) => r.kind === "rule" && r.applicable && r.detail === "not filled in").map((r) => `${r.name}: not filled in`)];
  if (ai) ai.missingInfo = [...new Set(missing)].slice(0, 8);
  else if (missing.length) ai = { missingInfo: missing.slice(0, 8) };

  const now = new Date();
  await db.insert(schema.qualificationRuns).values({ subjectType: type, subjectId: id, trigger: opts.trigger, criteriaVersion: criteriaVersion(criteria), criteria, results, ai, score, tier, reason, createdBy: opts.actorId ?? null });
  const effective = subject.tierOverride ?? tier;
  if (type === "lead") await db.update(schema.leads).set({ qualificationScore: score, qualificationTier: effective, qualificationReason: reason, qualifiedAt: now }).where(eq(schema.leads.id, id));
  else await db.update(schema.customers).set({ qualificationScore: score, qualificationTier: effective, qualificationReason: reason, qualifiedAt: now }).where(eq(schema.customers.id, id));
  const err = ai && typeof ai.error === "string" ? ai.error : undefined;
  return { ok: true, score, tier, aiUsed: Boolean(aiOut), ...(err ? { aiError: err } : {}) };
}

/** Latest runs for a set of subjects (for lists). */
export async function latestRuns(db: Db, type: SubjectType, ids: string[]) {
  if (!ids.length) return new Map<string, typeof schema.qualificationRuns.$inferSelect>();
  const rows = await db
    .select()
    .from(schema.qualificationRuns)
    .where(and(eq(schema.qualificationRuns.subjectType, type), inArray(schema.qualificationRuns.subjectId, ids)))
    .orderBy(desc(schema.qualificationRuns.createdAt));
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.subjectId)) map.set(r.subjectId, r);
  return map;
}
