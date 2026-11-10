/**
 * Dependency rules (shared by server and browser). Dates are yyyy-mm-dd;
 * an item with only one date counts as a one-day item.
 *
 *   FS  successor starts after the predecessor finishes (+ lag days)
 *   SS  successor starts on/after the predecessor starts (+ lag)
 *   FF  successor finishes on/after the predecessor finishes (+ lag)
 *   SF  successor finishes on/after the predecessor starts (+ lag)
 */
export type DepType = "FS" | "SS" | "FF" | "SF";
export type Span = { start: string | null; due: string | null };

export const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
export const fromDay = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

const ends = (s: Span) => ({ start: s.start ?? s.due, due: s.due ?? s.start });

/** true = satisfied, false = broken, null = not enough dates to tell. */
export function dependencyHolds(type: DepType, lagDays: number, pred: Span, succ: Span): boolean | null {
  const p = ends(pred);
  const s = ends(succ);
  const [a, b, extra] =
    type === "FS" ? [p.due, s.start, 1] : type === "SS" ? [p.start, s.start, 0] : type === "FF" ? [p.due, s.due, 0] : [p.start, s.due, 0];
  if (!a || !b) return null;
  return dayNum(b) >= dayNum(a) + extra + lagDays;
}

export const DEP_TYPE_LABEL: Record<DepType, string> = { FS: "finish → start", SS: "start → start", FF: "finish → finish", SF: "start → finish" };
