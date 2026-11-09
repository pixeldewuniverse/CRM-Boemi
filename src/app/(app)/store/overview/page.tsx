import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { ColumnChart } from "@/components/ui/column-chart";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getCurrentUser } from "@/lib/auth";
import { fday, pct, rp, rpk } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Store Overview" };

export default async function StoreOverviewPage() {
  await getCurrentUser();
  const d = await previewData();
  const week = d.storeDays.slice(7);
  const prev = d.storeDays.slice(0, 7);
  const sum = (xs: typeof week) => xs.reduce((s, x) => s + x.revenue, 0);
  const today = d.storeDays.at(-1)!;
  const change = sum(prev) ? ((sum(week) - sum(prev)) / sum(prev)) * 100 : 0;

  return (
    <>
      <PageHeader href="/store/overview" />
      <PreviewNotice kind="Later" />
      <Stats
        items={[
          { label: "Today", value: rpk(today.revenue), hint: `${today.trx} transactions` },
          { label: "Last 7 days", value: rpk(sum(week)), hint: `${change >= 0 ? "+" : ""}${pct(change)} vs week before`, tone: change >= 0 ? "ok" : "warn" },
          { label: "Average basket", value: rp(Math.round(sum(week) / week.reduce((s, x) => s + x.trx, 0))) },
          { label: "Best seller today", value: <span className="text-base">{d.product(today.top)?.n}</span> },
        ]}
      />
      <Panel title="Daily sales · last 7 days" description="Main Store POS. Weekends are the busiest days.">
        <ColumnChart
          categories={week.map((x) => fday(x.date))}
          series={[{ name: "Sales", color: "c1", values: week.map((x) => x.revenue) }]}
          format={rpk}
          caption="Main Store daily sales, last 7 days"
        />
      </Panel>
    </>
  );
}
