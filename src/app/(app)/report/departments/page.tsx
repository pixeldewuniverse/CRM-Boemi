import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { ExportLink } from "@/components/ui/export-link";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { num, pct, rp, rpk, ym, ymd } from "@/lib/format";
import { departmentKpis, RANGES, type Range } from "@/lib/reports/departments";
import { now } from "@/lib/scope";

export const metadata: Metadata = { title: "Department KPI" };
const HREF = "/report/departments";

export default async function DepartmentKpiPage({ searchParams }: PageProps<"/report/departments">) {
  const { user, denied } = await guard(HREF);
  if (denied) return denied;
  const sp = await searchParams;
  const range: Range = typeof sp.range === "string" && sp.range in RANGES ? (sp.range as Range) : "month";
  const today = await now();
  const k = await departmentKpis(user, range, ym(today), ymd(today), today);
  const m = k.marketing;
  const totalRevenue = k.rows.reduce((a, r) => a + r.revenue, 0);
  const won = k.rows.reduce((a, r) => a + r.won, 0);
  const lost = k.rows.reduce((a, r) => a + r.lost, 0);
  const overdue = k.rows.reduce((a, r) => a + r.overdueTasks + r.overdueItems, 0);

  return (
    <>
      <PageHeader href={HREF} actions={<ExportLink entity={`departments${range === "month" ? "" : `?range=${range}`}`} />} />
      <FilterChips pathname={HREF} param="range" value={range === "month" ? undefined : range} options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r === "month" ? undefined : r, label: RANGES[r] }))} />

      <Stats
        cols={5}
        items={[
          { label: `Revenue · ${k.label}`, value: rpk(totalRevenue), hint: "Orders by department members, excl. cancelled" },
          { label: "Win rate", value: won + lost ? pct((won / (won + lost)) * 100) : "—", hint: `${won} won · ${lost} lost` },
          { label: "Leads", value: num(m.leads), hint: `${m.qualified} qualified (${m.leads ? pct((m.qualified / m.leads) * 100) : "—"})` },
          { label: "Projects on time", value: k.projects.onTimeRate == null ? "—" : pct(k.projects.onTimeRate), hint: `${k.projects.late} late of ${k.projects.projects} projects` },
          { label: "Overdue work", value: num(overdue), tone: overdue ? "warn" : "ok", hint: "Sales tasks + project items past due" },
        ]}
      />

      <Panel title={`Departments · ${k.label}`} flush>
        {k.rows.length ? (
          <table className="tbl min-w-[1100px]">
            <thead>
              <tr>
                <th>Department</th>
                <th className="num">People</th>
                <th className="num">Revenue</th>
                <th className="num">Won / lost</th>
                <th className="num">Win rate</th>
                <th className="num">Leads</th>
                <th className="num">Lead → qualified</th>
                <th className="num">Projects</th>
                <th className="num">On-time</th>
                <th className="num">Overdue tasks</th>
                <th className="num">Overdue project items</th>
              </tr>
            </thead>
            <tbody>
              {k.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.name}</td>
                  <td className="num">{r.people}</td>
                  <td className="num">{r.revenue ? rp(r.revenue) : "—"}</td>
                  <td className="num">{r.won + r.lost ? `${r.won} / ${r.lost}` : "—"}</td>
                  <td className="num">{r.winRate == null ? "—" : pct(r.winRate)}</td>
                  <td className="num">{r.leads || "—"}</td>
                  <td className="num">{r.leadConversion == null ? "—" : pct(r.leadConversion)}</td>
                  <td className="num">{r.projects ? `${r.projects}${r.lateProjects ? ` · ${r.lateProjects} late` : ""}` : "—"}</td>
                  <td className="num">{r.projectOnTime == null ? "—" : pct(r.projectOnTime)}</td>
                  <td className={`num ${r.overdueTasks ? "font-semibold text-warn" : ""}`}>{r.overdueTasks}</td>
                  <td className={`num ${r.overdueItems ? "font-semibold text-warn" : ""}`}>{r.overdueItems}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No departments in your scope.</Empty>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Revenue per department">
          <BarList rows={k.rows.filter((r) => r.revenue).map((r) => ({ label: r.name, value: r.revenue, hint: r.winRate == null ? undefined : `win ${pct(r.winRate)}` }))} format={rpk} />
          {!k.rows.some((r) => r.revenue) && <p className="text-[13px] text-muted">No orders in this period.</p>}
        </Panel>
        <Panel title="Marketing · leads by source" description={m.costVisible ? `Cost = event actual costs (${m.events} events) + budgets of campaigns starting in the period (${m.campaigns}).` : "Leads you can see in this period."}>
          {m.costVisible && (
            <dl className="mb-4 grid grid-cols-3 gap-3 text-[13px]">
              <div>
                <dt className="text-muted">Marketing cost</dt>
                <dd className="text-lg font-bold tabular-nums">{rpk(m.cost)}</dd>
              </div>
              <div>
                <dt className="text-muted">Cost per lead</dt>
                <dd className="text-lg font-bold tabular-nums">{m.costPerLead == null ? "—" : rpk(m.costPerLead)}</dd>
              </div>
              <div>
                <dt className="text-muted">Per qualified lead</dt>
                <dd className="text-lg font-bold tabular-nums">{m.costPerQualified == null ? "—" : rpk(m.costPerQualified)}</dd>
              </div>
            </dl>
          )}
          {m.sources.length ? (
            <BarList color="c2" rows={m.sources.map((s) => ({ label: s.source, value: s.leads, hint: `${s.qualified} qualified` }))} format={num} />
          ) : (
            <p className="text-[13px] text-muted">No leads in this period.</p>
          )}
        </Panel>
      </div>
      <p className="text-xs text-muted">People count to their own department. Win rate uses deals closed (won or lost) in the period; lead conversion uses leads received in the period that are now qualified. Overdue counts are as of today.</p>
    </>
  );
}
