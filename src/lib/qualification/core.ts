/**
 * Lead / account qualification — pure parts (no database, no network).
 *
 * Principle: rules are computed by code; AI only judges free text (0–3 per
 * criterion, with a quote as evidence); the final score is always computed
 * here. Every lead is still contacted — the score only sets the ORDER.
 */
import { createHash } from "node:crypto";

export type Tier = "hot" | "warm" | "cold";
export type Operator = "equals" | "not_equals" | "in" | "gte" | "lte" | "contains" | "exists";

export type Criterion = {
  id: string;
  name: string;
  kind: "rule" | "ai";
  field: string;
  operator: Operator;
  value: unknown;
  weight: number;
  description: string | null;
};

/** Structured fields the rule layer can read. */
export type Structured = {
  segment: string | null;
  city: string | null;
  region: string | null;
  source: string | null;
  marketingConsent: boolean;
  interests: Record<string, unknown>;
  /** Accounts only. */
  contacts?: { isDecisionMaker: boolean };
};

export type TextPart = { label: string; text: string };

export type CriterionResult = {
  criterionId: string;
  name: string;
  kind: "rule" | "ai";
  weight: number;
  applicable: boolean;
  /** 0–1 share of the weight earned. */
  ratio: number;
  points: number;
  /** Rules: the value found. AI: the 0–3 score. */
  detail: string;
  evidence?: string;
  unknown?: boolean;
};

export type AiAssessment = { criterionId: string; score: number; evidence: string; unknown: boolean };
export type AiOutput = { criteria: AiAssessment[]; missingInfo: string[]; suggestedNextAction: string };

export { OPERATORS, RULE_FIELDS } from "./fields";

/* ── region from city (leads only have a city) ── */
const CITY_REGION: [RegExp, string][] = [
  [/denpasar|badung|ubud|seminyak|canggu|kuta|sanur|nusa dua|jimbaran|gianyar|uluwatu|tabanan|bali|kerobokan|legian/, "Bali"],
  [/mataram|lombok|senggigi|gili|mandalika|ntb|sumbawa/, "NTB"],
  [/jakarta/, "Jakarta"],
  [/tangerang|bintaro|bsd|serang|cilegon|banten/, "Banten"],
  [/bekasi|bogor|depok|bandung|cirebon|jawa barat/, "Jawa Barat"],
  [/surabaya|malang|sidoarjo|jawa timur/, "Jawa Timur"],
  [/semarang|solo|surakarta|jawa tengah/, "Jawa Tengah"],
  [/yogyakarta|jogja|sleman|bantul/, "DI Yogyakarta"],
];
export function regionOf(city: string | null, region?: string | null): string | null {
  if (region) return region;
  const c = city?.toLowerCase() ?? "";
  return CITY_REGION.find(([re]) => re.test(c))?.[1] ?? null;
}

function read(s: Structured, field: string): { applicable: boolean; value: unknown } {
  if (field.startsWith("contacts.")) return s.contacts ? { applicable: true, value: (s.contacts as Record<string, unknown>)[field.slice(9)] } : { applicable: false, value: undefined };
  if (field.startsWith("interests.")) {
    let v: unknown = s.interests;
    for (const k of field.slice(10).split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    return { applicable: true, value: v };
  }
  if (field in s) return { applicable: true, value: (s as Record<string, unknown>)[field] };
  return { applicable: false, value: undefined };
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length);
const show = (v: unknown) => (empty(v) ? "not filled in" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

/** Layer 1: one rule on the structured fields. */
export function evaluateRule(c: Criterion, s: Structured): CriterionResult {
  const { applicable, value } = read(s, c.field);
  let hit = false;
  if (applicable && !(empty(value) && c.operator !== "exists" && c.operator !== "not_equals")) {
    const target = c.value;
    const list = Array.isArray(target) ? target.map(norm) : [norm(target)];
    switch (c.operator) {
      case "equals":
        hit = norm(value) === norm(target);
        break;
      case "not_equals":
        hit = norm(value) !== norm(target);
        break;
      case "in":
        hit = Array.isArray(value) ? value.some((v) => list.includes(norm(v))) : list.includes(norm(value));
        break;
      case "gte":
        hit = Number(value) >= Number(target);
        break;
      case "lte":
        hit = Number(value) <= Number(target);
        break;
      case "contains":
        hit = Array.isArray(value) ? value.map(norm).includes(norm(target)) : String(value).toLowerCase().includes(String(target).toLowerCase());
        break;
      case "exists":
        hit = !empty(value);
        break;
    }
  }
  return { criterionId: c.id, name: c.name, kind: "rule", weight: c.weight, applicable, ratio: hit ? 1 : 0, points: hit ? c.weight : 0, detail: show(value) };
}

/* ── privacy: what may leave the system ── */
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// Indonesian mobiles (+62 8…, 08…) and landlines (0361-…); not money amounts like 25.000.000.
const PHONE = /(?:\+?62[\s.-]?|\b0)(?:8\d{1,3}|\(?\d{2,3}\)?)[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/g;
const HANDLE = /(^|\s)@[\w.]{2,30}/g;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes e-mail addresses, phone numbers, @handles, the company name and
 * people's names (also their single first/last names) from free text.
 */
export function redact(text: string, names: { company?: (string | null | undefined)[]; people?: (string | null | undefined)[] }): string {
  let out = text.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(HANDLE, "$1[handle]");
  for (const n of names.company ?? []) if (n && n.trim().length >= 3) out = out.replace(new RegExp(esc(n.trim()), "gi"), "[company]");
  for (const n of names.people ?? []) {
    const name = n?.trim();
    if (!name || name.length < 3) continue;
    out = out.replace(new RegExp(esc(name), "gi"), "[name]");
    for (const part of name.split(/\s+/)) if (part.length >= 4 && !/^(ibu|bapak|pak|bu|mr|mrs|ms)\.?$/i.test(part)) out = out.replace(new RegExp(`\\b${esc(part)}\\b`, "gi"), "[name]");
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[“”"'`]/g, "").replace(/\s+/g, " ").trim();

/**
 * Layer 2 check: keep an AI score only when its evidence is a real quote from
 * the text we sent. No quote → unknown (never a guess).
 */
export function validateAi(c: Criterion, a: AiAssessment | undefined, sentText: string): CriterionResult {
  const base = { criterionId: c.id, name: c.name, kind: "ai" as const, weight: c.weight, applicable: true };
  const quote = a?.evidence?.trim() ?? "";
  const score = Number.isInteger(a?.score) ? Math.min(3, Math.max(0, a!.score)) : 0;
  const real = quote.length >= 4 && squash(sentText).includes(squash(quote));
  // Unknown is not a 0: it's left out of the total (like AI being off) and shows up as missing info.
  if (!a || a.unknown || !real) return { ...base, applicable: false, ratio: 0, points: 0, detail: "unknown", unknown: true };
  return { ...base, ratio: score / 3, points: (c.weight * score) / 3, detail: `${score}/3`, evidence: quote.slice(0, 300) };
}

/** AI criteria without AI (off or failed): unknown, not counted against the lead. */
export const aiSkipped = (c: Criterion): CriterionResult => ({ criterionId: c.id, name: c.name, kind: "ai", weight: c.weight, applicable: false, ratio: 0, points: 0, detail: "AI off" });

export type Thresholds = { hotAt: number; warmAt: number };

/** Final score (code): earned weight / applicable weight × 100. */
export function finalScore(results: CriterionResult[], t: Thresholds) {
  const counted = results.filter((r) => r.applicable);
  const total = counted.reduce((a, r) => a + r.weight, 0);
  const earned = counted.reduce((a, r) => a + r.points, 0);
  const score = total ? Math.round((earned / total) * 100) : 0;
  const warmAt = Math.min(t.warmAt, t.hotAt - 1);
  const tier: Tier = score >= t.hotAt ? "hot" : score >= warmAt ? "warm" : "cold";
  const top = counted
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((r) => (r.kind === "ai" && r.evidence ? `${r.name} (“${r.evidence.length > 60 ? `${r.evidence.slice(0, 57)}…` : r.evidence}”)` : r.name));
  const reason = top.length ? top.join(" · ") : "No criteria met yet";
  return { score, tier, reason };
}

/** Hash of the active criteria: stored with every run so a score can be traced to the rules used. */
export function criteriaVersion(criteria: Criterion[]): string {
  const body = criteria
    .map((c) => [c.id, c.kind, c.field, c.operator, JSON.stringify(c.value ?? null), c.weight, c.description ?? ""].join("|"))
    .sort()
    .join("\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

/* ── Contact Today ── */
export type SlaDays = { slaHot: number; slaWarm: number; slaCold: number };
export const slaFor = (tier: Tier | null, s: SlaDays) => (tier === "hot" ? s.slaHot : tier === "warm" ? s.slaWarm : s.slaCold);

/**
 * Queue order: score + aging boost (2 points per day waiting, max 30)
 * + 20 when the SLA has passed. Unscored leads count as score 0.
 */
export function contactPriority(input: { score: number | null; tier: Tier | null; since: Date; now: Date }, s: SlaDays) {
  const days = Math.max(0, Math.floor((input.now.getTime() - input.since.getTime()) / 86_400_000));
  const due = new Date(input.since.getTime() + slaFor(input.tier, s) * 86_400_000);
  const overdue = input.now.getTime() > due.getTime();
  const priority = (input.score ?? 0) + Math.min(30, days * 2) + (overdue ? 20 : 0);
  return { days, due, overdue, priority };
}
