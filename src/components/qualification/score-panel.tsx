"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { loadScoreDetails, overrideTier, rescore } from "@/app/actions/qualification";
import { TierBadge } from "@/components/tier-badge";
import { initialFormState } from "@/lib/forms";
import type { ScoreDetails } from "@/lib/qualification/details";

type Details = ScoreDetails & { editable: boolean };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const TRIGGERS: Record<string, string> = {
  created: "created",
  manual: "re-scored by hand",
  visit: "new visit",
  activity: "new activity",
  import: "import",
  "account-updated": "account edited",
  "converted-from-lead": "converted from a lead",
  "criteria-changed": "criteria changed",
  "ai-retry": "AI retry",
  "journey-created": "aroma journey",
  "journey-updated": "aroma journey update",
  seed: "demo data",
};

/** Breakdown of the latest run: per criterion, missing info, next action, AI status. */
export function ScoreBreakdown({ d }: { d: ScoreDetails }) {
  const run = d.runs[0];
  if (!run) return <p className="text-[13px] text-muted">Not scored yet — it will be scored in the background shortly.</p>;
  const ai = run.ai;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold tabular-nums">{run.score}</span>
        <TierBadge tier={d.tier} />
        {d.override && <span className="pill bg-surface-2 text-muted">set by hand (computed: {run.tier})</span>}
        <span className="text-xs text-muted">
          {when(run.at)} · {TRIGGERS[run.trigger] ?? run.trigger}
          {run.by ? ` · ${run.by}` : ""}
        </span>
      </div>
      {d.override && (
        <p className="rounded-lg bg-surface-2 px-3 py-2">
          <strong className="capitalize">{d.override.tier}</strong> set by {d.override.by ?? "someone"}
          {d.override.at ? ` on ${when(d.override.at)}` : ""}: “{d.override.reason}”
        </p>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {run.results.map((r) => (
          <li key={r.criterionId} className={`flex gap-3 px-3 py-2 ${r.applicable ? "" : "opacity-60"}`}>
            <span className="w-10 flex-none text-right font-semibold tabular-nums">{r.applicable ? `+${Math.round(r.points)}` : "–"}</span>
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-semibold">{r.name}</span> <span className="text-xs text-muted">· weight {r.weight}</span>{" "}
                <span className={`pill ${r.kind === "ai" ? "bg-info-soft text-info" : "bg-surface-2 text-muted"}`}>{r.kind === "ai" ? "AI" : "rule"}</span>
              </p>
              <p className="text-xs text-muted">
                {r.kind === "rule" ? (r.applicable ? `Found: ${r.detail}` : "Doesn't apply here") : r.unknown ? "Unknown — no quote in the notes, not counted" : r.applicable ? `${r.detail}` : r.detail}
              </p>
              {r.evidence && <blockquote className="mt-1 border-l-2 border-accent pl-2 text-xs italic">“{r.evidence}”</blockquote>}
            </div>
          </li>
        ))}
      </ul>
      {ai?.missingInfo && ai.missingInfo.length > 0 && (
        <div>
          <p className="font-semibold">Ask next</p>
          <ul className="list-inside list-disc text-muted">
            {ai.missingInfo.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {ai?.suggestedNextAction && (
        <p>
          <span className="font-semibold">Suggested next step:</span> {ai.suggestedNextAction}
        </p>
      )}
      <p className="text-xs text-muted">
        {ai?.error
          ? `AI unavailable (${ai.error.slice(0, 80)}) — scored on rules only; it will retry.`
          : ai?.provider
            ? `Text judged by ${ai.provider === "mock" ? "demo AI (simulated)" : `${ai.provider} · ${ai.model}`}${ai.sentFields ? ` · sent: ${ai.sentFields.join(", ")}` : ""}. No names, phone numbers or e-mails are sent.`
            : d.aiOn
              ? "Rules only (no notes to read yet)."
              : "Rules only (AI is off)."}{" "}
        Criteria version {run.criteriaVersion}.
      </p>
      {d.runs.length > 1 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted">Earlier scores</summary>
          <ul className="mt-1 text-xs text-muted">
            {d.runs.slice(1).map((r) => (
              <li key={r.id}>
                {when(r.at)} · {r.score} {r.tier} · {TRIGGERS[r.trigger] ?? r.trigger}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RescoreButton({ type, id, onDone }: { type: "lead" | "account"; id: string; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rescore({ type, id });
            setMsg(r.ok ? (r.message ?? "Re-scored.") : (r.error ?? "Failed."));
            onDone?.();
          })
        }
      >
        {pending ? "Scoring…" : "Re-score"}
      </button>
      {msg && (
        <span role="status" className="text-xs text-muted">
          {msg}
        </span>
      )}
    </span>
  );
}

export function OverrideForm({ d, onDone }: { d: ScoreDetails; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: typeof initialFormState, fd: FormData) => {
    const r = await overrideTier(prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, initialFormState);
  return (
    <form
      // Submit by hand so React doesn't reset the fields when the server says "add a reason".
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="flex flex-col gap-2 rounded-lg border border-line p-3 text-[13px]"
    >
      <input type="hidden" name="type" value={d.type} />
      <input type="hidden" name="id" value={d.id} />
      <p className="font-semibold">Override the tier</p>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Tier</span>
          <select name="tier" defaultValue={d.override?.tier ?? ""} className="input w-auto py-1">
            <option value="">Use the computed tier</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Reason (required)</span>
          <input name="reason" className={`input py-1 ${state.fieldErrors?.reason ? "border-bad" : ""}`} placeholder="e.g. GM confirmed budget on the phone" maxLength={500} aria-invalid={Boolean(state.fieldErrors?.reason)} />
        </label>
      </div>
      {state.fieldErrors?.reason && <p className="text-xs text-bad">{state.fieldErrors.reason}</p>}
      {state.ok === false && !state.fieldErrors && <p className="text-xs text-bad">{state.error}</p>}
      {state.ok && <p className="text-xs text-ok">{state.message}</p>}
      <button className="btn self-start" disabled={pending}>
        {pending ? "Saving…" : "Save override"}
      </button>
      <p className="text-xs text-muted">Recorded in the audit trail. Re-scoring keeps your tier until you switch back to the computed one.</p>
    </form>
  );
}

/** Score cell button on the Leads list: opens the breakdown in a dialog. */
export function ScoreButton({ type, id, score, children }: { type: "lead" | "account"; id: string; score: number | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState<Details | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadScoreDetails({ type, id }).then((x) => live && setD(x));
    return () => {
      live = false;
    };
  }, [open, type, id, version]);
  return (
    <>
      <button
        type="button"
        className="flex items-center gap-2 text-left hover:text-accent"
        aria-label={`Score details${score != null ? ` (${score})` : ""}`}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
      >
        {children}
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-label="Score details" className="m-auto max-h-[92dvh] w-[min(94vw,40rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-lg font-bold">Score · {d?.name ?? "…"}</h2>
            <button type="button" className="btn px-2 py-1" aria-label="Close" onClick={() => ref.current?.close()}>
              ✕
            </button>
          </div>
          {!d ? (
            <p className="text-[13px] text-muted">Loading…</p>
          ) : (
            <>
              <ScoreBreakdown d={d} />
              <div className="flex flex-wrap gap-2">
                <RescoreButton type={type} id={id} onDone={() => setVersion((v) => v + 1)} />
              </div>
              {d.editable && <OverrideForm d={d} onDone={() => setVersion((v) => v + 1)} />}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
