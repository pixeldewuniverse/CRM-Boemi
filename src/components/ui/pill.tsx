import type { Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>;
}

/** Status pill from a label map in lib/labels.ts. */
export function StatusPill({
  map,
  value,
}: {
  map: Record<string, { label: string; tone: Tone }>;
  value: string | null | undefined;
}) {
  if (!value) return <span className="text-muted">—</span>;
  const def = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <Pill tone={def.tone}>{def.label}</Pill>;
}
