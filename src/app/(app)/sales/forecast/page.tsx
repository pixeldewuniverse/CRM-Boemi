import type { Metadata } from "next";
import Link from "next/link";
import { DealProbabilityForm } from "@/components/forms/forecast-forms";
import { PageHeader } from "@/components/page/page-header";
import { ColumnChart } from "@/components/ui/column-chart";
import { ExportLink } from "@/components/ui/export-link";
import { FilterChips } from "@/components/ui/filter-chips";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getCurrentUser } from "@/lib/auth";
import { fdate, monthLabel, rp, rpk, ym } from "@/lib/format";
import { STAGE } from "@/lib/labels";
import { COMMIT_AT, projected, salesForecast } from "@/lib/reports/forecast";
import { now, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Sales Forecast" };
const HREF = "/sales/forecast";
const HORIZONS = [3, 6, 12];

export default async function ForecastPage({ searchParams }: PageProps<"/sales/forecast">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const months = HORIZONS.includes(Number(sp.months)) ? Number(sp.months) : 6;
  const from = ym(await now());
  const f = await salesForecast(user, from, months, typeof sp.rep === "string" ? sp.rep : undefined);
  const t = f.total;
  const proj = projected(t);
  const keep = { months: sp.months as string | undefined, rep: f.rep };
  const exportQs = new URLSearchParams(Object.entries({ months: String(months), rep: f.rep }).filter((e): e is [string, string] => Boolean(e[1])));
  const canEdit = (ownerId: string) => ownerId === user.id || user.role === "admin" || user.role === "sales_manager";

  return (
    <>
      <PageHeader href={HREF} actions={<ExportLink entity={`forecast?${exportQs}`} />} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips pathname={HREF} param="months" value={String(months)} keep={{ rep: f.rep }} options={HORIZONS.map((h) => ({ value: h === 6 ? undefined : String(h), label: `${h} months` }))} />
        {seesAll(user) && f.repOptions.length > 1 && (
          <FilterChips pathname={HREF} param="rep" value={f.rep} keep={{ months: keep.months }} options={[{ value: undefined, label: "All reps" }, ...f.repOptions.map((r) => ({ value: r.id, label: r.name.split(" ")[0] }))]} />
        )}
      </div>

      <Stats
        cols={5}
        items={[
          { label: `Target · ${months} months`, value: rpk(t.target), hint: t.target ? `${monthLabel(f.periods[0], true)} – ${monthLabel(f.periods[f.periods.length - 1], true)}` : "No revenue target set" },
          { label: "Actual (orders)", value: rpk(t.actual), hint: `${monthLabel(from, true)} to date` },
          { label: "Weighted pipeline", value: rpk(t.weighted), hint: `${t.deals} open deals × probability` },
          { label: `Commit (≥ ${COMMIT_AT}%)`, value: rpk(t.commit), hint: `Best case ${rpk(t.best)}` },
          { label: "Projected vs target", value: rpk(proj), hint: t.target ? <Meter value={proj} max={t.target} label="Projected vs target" /> : "Actual + weighted", tone: t.target && proj < t.target ? "warn" : "default" },
        ]}
      />

      {(f.overdue.n > 0 || f.noDate.n > 0) && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Not in the forecast: {f.overdue.n > 0 && `${f.overdue.n} open deal${f.overdue.n === 1 ? "" : "s"} (${rpk(f.overdue.value)}) with a close date in the past`}
          {f.overdue.n > 0 && f.noDate.n > 0 && " and "}
          {f.noDate.n > 0 && `${f.noDate.n} without a close date (${rpk(f.noDate.value)})`}. Update them in the{" "}
          <Link href="/sales/pipeline" className="font-semibold underline">
            pipeline
          </Link>
          .
        </p>
      )}

      <Panel title="Projected revenue per month" description="Actual orders plus the weighted value of open deals expected to close that month. Targets are in the table.">
        <ColumnChart
          categories={f.months.map((m) => monthLabel(m.period, true))}
          series={[
            { name: "Actual orders", color: "c1", values: f.months.map((m) => m.actual) },
            { name: "Weighted pipeline", color: "c2", values: f.months.map((m) => Math.round(m.weighted)) },
          ]}
          format={rpk}
          caption="Projected revenue per month: actual orders plus weighted pipeline"
        />
      </Panel>

      <Panel title="Forecast by month" flush>
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Target</th>
              <th className="num">Actual</th>
              <th className="num">Commit</th>
              <th className="num">Weighted</th>
              <th className="num">Best case</th>
              <th className="num">Projected</th>
              <th>vs target</th>
            </tr>
          </thead>
          <tbody>
            {f.months.map((m) => (
              <tr key={m.period}>
                <td className="font-semibold">{monthLabel(m.period)}</td>
                <td className="num">{m.target ? rp(m.target) : "—"}</td>
                <td className="num">{rp(m.actual)}</td>
                <td className="num">{rp(m.commit)}</td>
                <td className="num">{rp(Math.round(m.weighted))}</td>
                <td className="num">{rp(m.best)}</td>
                <td className="num font-semibold">{rp(Math.round(projected(m)))}</td>
                <td className="w-44">{m.target ? <Meter value={projected(m)} max={m.target} label={`${monthLabel(m.period)} projected vs target`} /> : <span className="text-muted">No target</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {seesAll(user) && (
        <Panel title={`By rep · ${months} months`} flush>
          {f.reps.length ? (
            <table className="tbl min-w-[860px]">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="num">Target</th>
                  <th className="num">Actual</th>
                  <th className="num">Commit</th>
                  <th className="num">Weighted</th>
                  <th className="num">Best case</th>
                  <th className="num">Projected</th>
                  <th>vs target</th>
                </tr>
              </thead>
              <tbody>
                {f.reps.map((r) => (
                  <tr key={r.id || "none"}>
                    <td className="font-semibold">{r.name}</td>
                    <td className="num">{r.target ? rp(r.target) : "—"}</td>
                    <td className="num">{rp(r.actual)}</td>
                    <td className="num">{rp(r.commit)}</td>
                    <td className="num">{rp(Math.round(r.weighted))}</td>
                    <td className="num">{rp(r.best)}</td>
                    <td className="num font-semibold">{rp(Math.round(projected(r)))}</td>
                    <td className="w-44">{r.target ? <Meter value={projected(r)} max={r.target} label={`${r.name} projected vs target`} /> : <span className="text-muted">No target</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No reps in your scope.</Empty>
          )}
        </Panel>
      )}

      <Panel title="Open deals in the forecast" description={`Probability comes from the stage default in Master Data unless it's set on the deal. Clear the box to go back to the default.`} flush>
        {f.deals.length ? (
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Owner</th>
                <th>Stage</th>
                <th>Close</th>
                <th className="num">Value</th>
                <th className="num">Probability</th>
                <th className="num">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {f.deals.map((d) => (
                <tr key={d.id}>
                  <td>
                    <p className="font-semibold">{d.title}</p>
                    <p className="text-xs text-muted">{d.account}</p>
                  </td>
                  <td>{d.owner}</td>
                  <td>{STAGE[d.stage]?.label ?? d.stage}</td>
                  <td className={d.bucket === "overdue" ? "font-semibold text-bad" : d.bucket === "none" ? "text-muted" : ""}>{d.closeOn ? fdate(d.closeOn) : "No date"}</td>
                  <td className="num">{rp(d.value)}</td>
                  <td className="num">
                    {canEdit(d.ownerId) ? (
                      <DealProbabilityForm dealId={d.id} value={d.probability} override={d.override} title={d.title} />
                    ) : (
                      <span>
                        {d.probability}%{d.override && <span className="text-xs text-muted"> · set</span>}
                      </span>
                    )}
                  </td>
                  <td className="num">{d.bucket === "overdue" || d.bucket === "none" ? <span className="text-muted">not counted</span> : rp(Math.round(d.weighted))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No open deals.</Empty>
        )}
      </Panel>
    </>
  );
}
