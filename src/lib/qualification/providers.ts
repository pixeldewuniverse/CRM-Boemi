/**
 * AI providers for layer 2. Plain fetch, no SDK.
 *
 *   QUALIFICATION_AI=on            turn layer 2 on (anything else = rules only)
 *   QUALIFICATION_AI_PROVIDER      gemini (staging, GEMINI_API_KEY) | vertex (production,
 *                                  Cloud Run service account via the metadata server — no key file)
 *                                  | mock (tests/demos: deterministic, no network)
 *   QUALIFICATION_MODEL            default gemini-2.5-flash-lite (Flash-Lite class)
 *   VERTEX_PROJECT, VERTEX_LOCATION (default asia-southeast1) for vertex
 */
import type { AiOutput, Criterion } from "./core";

export type AiRequest = {
  /** Short ids (c1, c2…) instead of database ids. */
  criteria: { id: string; name: string; rubric: string }[];
  /** Only the relevant, already-redacted fields. */
  facts: Record<string, unknown>;
  texts: { label: string; text: string }[];
};

export interface QualificationAi {
  provider: string;
  model: string;
  assess(req: AiRequest): Promise<AiOutput>;
}

export const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const TIMEOUT_MS = 20_000;

export function aiConfig() {
  const on = process.env.QUALIFICATION_AI === "on";
  const provider = (process.env.QUALIFICATION_AI_PROVIDER ?? (process.env.VERTEX_PROJECT ? "vertex" : "gemini")).toLowerCase();
  const model = process.env.QUALIFICATION_MODEL || DEFAULT_MODEL;
  return { on, provider, model };
}

/** The configured provider, or null when layer 2 is off. */
export function getAi(): QualificationAi | null {
  const { on, provider, model } = aiConfig();
  if (!on) return null;
  if (provider === "mock") return mockAi;
  if (provider === "vertex") return vertexAi(model);
  return geminiAi(model);
}

/* ── prompt + schema (shared by Gemini API and Vertex AI) ── */
const SYSTEM = `You assess B2B sales leads for an Indonesian natural personal-care brand (amenities, massage oils, gifts).
For EACH criterion, read only the given texts and facts and return:
- score 0–3 per the criterion's rubric,
- evidence: an EXACT quote (copied word for word) from the texts that supports the score,
- unknown: true when the texts don't say anything about it. Then score 0 and evidence "". Never guess.
Also list missingInfo (short questions sales should ask) and one suggestedNextAction.
Texts may be in Indonesian or English. Answer in English.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { criterionId: { type: "STRING" }, score: { type: "INTEGER" }, evidence: { type: "STRING" }, unknown: { type: "BOOLEAN" } },
        required: ["criterionId", "score", "evidence", "unknown"],
      },
    },
    missingInfo: { type: "ARRAY", items: { type: "STRING" } },
    suggestedNextAction: { type: "STRING" },
  },
  required: ["criteria", "missingInfo", "suggestedNextAction"],
};

function body(req: AiRequest) {
  const user = JSON.stringify({ criteria: req.criteria, facts: req.facts, texts: req.texts });
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 1024 },
  };
}

function parse(json: unknown): AiOutput {
  const text = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const out = JSON.parse(text) as AiOutput;
  if (!Array.isArray(out.criteria)) throw new Error("AI answer without criteria");
  return {
    criteria: out.criteria.map((c) => ({ criterionId: String(c.criterionId), score: Number(c.score), evidence: String(c.evidence ?? ""), unknown: Boolean(c.unknown) })),
    missingInfo: (Array.isArray(out.missingInfo) ? out.missingInfo : []).map(String).slice(0, 6),
    suggestedNextAction: String(out.suggestedNextAction ?? "").slice(0, 300),
  };
}

async function post(url: string, headers: Record<string, string>, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parse(await res.json());
}

function geminiAi(model: string): QualificationAi {
  return {
    provider: "gemini",
    model,
    async assess(req) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not set");
      return post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, body(req));
    },
  };
}

/** Vertex AI on Cloud Run: the service account token comes from the metadata server. */
function vertexAi(model: string): QualificationAi {
  return {
    provider: "vertex",
    model,
    async assess(req) {
      const project = process.env.VERTEX_PROJECT;
      const location = process.env.VERTEX_LOCATION || "asia-southeast1";
      if (!project) throw new Error("VERTEX_PROJECT is not set");
      const t = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) });
      if (!t.ok) throw new Error(`metadata token HTTP ${t.status}`);
      const { access_token } = (await t.json()) as { access_token: string };
      return post(`https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, { Authorization: `Bearer ${access_token}` }, body(req));
    },
  };
}

/**
 * Mock (tests and demo data only): finds sentences with the rubric's
 * "Keywords:" and quotes them. A text containing "#ai-error" makes it fail,
 * to exercise the fallback.
 */
export const mockAi: QualificationAi = {
  provider: "mock",
  model: "mock-keywords",
  async assess(req) {
    const all = req.texts.map((t) => t.text).join("\n");
    if (all.includes("#ai-error")) throw new Error("Simulated AI outage");
    const sentences = all.split(/(?<=[.!?\n·])\s+/).map((s) => s.trim()).filter(Boolean);
    const criteria = req.criteria.map((c) => {
      const kw = (/keywords:\s*(.+)$/im.exec(c.rubric)?.[1] ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
      const hits = sentences.filter((s) => kw.some((k) => s.toLowerCase().includes(k)));
      if (!hits.length) return { criterionId: c.id, score: 0, evidence: "", unknown: true };
      const n = kw.filter((k) => hits.join(" ").toLowerCase().includes(k)).length;
      return { criterionId: c.id, score: Math.min(3, 1 + n), evidence: hits[0].replace(/[.!?·]$/, ""), unknown: false };
    });
    const missing = req.criteria.filter((c) => criteria.find((x) => x.criterionId === c.id)?.unknown).map((c) => `Ask about: ${c.name.toLowerCase()}`);
    return { criteria, missingInfo: missing, suggestedNextAction: missing.length ? `Call and ${missing[0].toLowerCase()}.` : "Send a quotation." };
  },
};

/** Rubric text sent to the AI for one criterion. */
export const rubricOf = (c: Criterion) => c.description?.trim() || `Does the text show "${c.name}"? 0 = no, 1 = weak, 2 = clear, 3 = strong and specific.`;
