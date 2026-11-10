/** Fractional ordering: a new position between two neighbours (no renumbering). */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1024;
  if (before == null) return after! - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

/** True when two neighbours are so close that the group should be renumbered. */
export const tooClose = (a: number, b: number) => Math.abs(b - a) < 1e-6;
