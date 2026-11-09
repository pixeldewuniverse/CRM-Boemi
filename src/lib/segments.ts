import type { Series } from "@/components/ui/column-chart";
import { SEGMENTS } from "./labels";
import { monthLabel } from "./format";

export const SEGMENT_COLOR: Record<string, Series["color"]> = {
  "Hotel & Spa": "c1",
  "Retail Partner": "c2",
  "Corporate Gift": "c3",
  "Online & Event": "c4",
};

/** Turn grouped (month, segment, value) rows into chart series. */
export function segmentSeries(periods: string[], rows: { month: string; segment: string | null; value: number }[]) {
  return {
    categories: periods.map((p) => monthLabel(p, true)),
    series: SEGMENTS.map((seg) => ({
      name: seg,
      color: SEGMENT_COLOR[seg],
      values: periods.map((p) => rows.find((r) => r.month === p && r.segment === seg)?.value ?? 0),
    })),
  };
}
