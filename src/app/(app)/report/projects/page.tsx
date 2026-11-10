import type { Metadata } from "next";
import Link from "next/link";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { ExportLink } from "@/components/ui/export-link";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill, StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { fdate, num, pct, rp, rpk, ymd } from "@/lib/format";
import { PROJECT_STATUS } from "@/lib/labels";
import { projectPerformance } from "@/lib/reports/projects";
import { now } from "@/lib/scope";

export const metadata: Metadata = { title: "Project Performance" };
const HREF = "/report/projects";

export default async function ProjectReportPage() {
  const { user, denied } = await guard(HREF);
  if (denied) return denied;
  const today = ymd(await now());
  const { rows, departments, totals } = await projectPerformance(user, today);

  return (
    <>
      <PageHeader href={HREF} actions={<ExportLink entity="projects" />} />
      <Stats
        cols={5}
        items={[
          { label: "Projects", value: num(totals.projects), hint: `${totals.open} open` },
          { label: "Late projects", value: num(totals.late), tone: totals.late ? "bad" : "ok", hint: "Open and past their due date" },
          { label: "Average progress", value: pct(totals.avgProgress), hint: "Items in the Done category" },
          { label: "On-time items", value: totals.onTimeRate == null ? "—" : pct(totals.onTimeRate), hint: "Done items finished by their due date" },
          { label: "Overdue items", value: num(totals.overdue), tone: totals.overdue ? "warn" : "default", hint: `Budget ${rpk(totals.budget)} · spent ${rpk(totals.actualCost)}` },
        ]}
      />

      {rows.length === 0 ? (
        <Panel>
          <Empty>No projects in your scope yet.</Empty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Average progress per department">
              <BarList rows={departments.map((d) => ({ label: d.department, value: d.avgProgress, hint: `${d.projects} project${d.projects === 1 ? "" : "s"}` }))} format={(n) => `${n}%`} />
            </Panel>
            <Panel title="Late projects & overdue items per department">
              <BarList color="c4" rows={departments.map((d) => ({ label: d.department, value: d.overdue, hint: `${d.late} late project${d.late === 1 ? "" : "s"}` }))} format={(n) => `${n} overdue`} />
            </Panel>
          </div>

          <Panel title="By department" flush>
            <table className="tbl min-w-[860px]">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="num">Projects</th>
                  <th className="num">Open</th>
                  <th className="num">Late</th>
                  <th>Avg. progress</th>
                  <th className="num">On-time</th>
                  <th className="num">Overdue items</th>
                  <th className="num">Budget</th>
                  <th className="num">Actual cost</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.departmentId ?? "none"}>
                    <td className="font-semibold">{d.department}</td>
                    <td className="num">{d.projects}</td>
                    <td className="num">{d.open}</td>
                    <td className={`num ${d.late ? "font-semibold text-bad" : ""}`}>{d.late}</td>
                    <td className="w-44">
                      <Meter value={d.avgProgress} max={100} label={`${d.department} average progress`} />
                    </td>
                    <td className="num">{d.onTimeRate == null ? "—" : pct(d.onTimeRate)}</td>
                    <td className="num">{d.overdue}</td>
                    <td className="num">{rp(d.budget)}</td>
                    <td className={`num ${d.budget && d.actualCost > d.budget ? "font-semibold text-bad" : ""}`}>{rp(d.actualCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Projects" flush>
            <table className="tbl min-w-[1000px]">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Progress</th>
                  <th className="num">On-time</th>
                  <th className="num">Overdue</th>
                  <th className="num">Budget</th>
                  <th>Spent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/projects/${r.id}`} className="font-semibold hover:text-accent">
                        {r.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {[r.code, r.department, r.owner].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <StatusPill map={PROJECT_STATUS} value={r.status} />
                        {r.late && <Pill tone="bad">Late</Pill>}
                      </span>
                    </td>
                    <td className={r.late ? "font-semibold text-bad" : ""}>{r.dueOn ? fdate(r.dueOn) : "—"}</td>
                    <td className="w-44">
                      <Meter value={r.done} max={r.items || 1} label={`${r.name} progress`} />
                      <span className="text-xs text-muted">
                        {r.done}/{r.items} items
                      </span>
                    </td>
                    <td className="num">{r.doneWithDue ? pct((r.doneOnTime / r.doneWithDue) * 100) : "—"}</td>
                    <td className={`num ${r.overdue ? "font-semibold text-warn" : ""}`}>{r.overdue}</td>
                    <td className="num">{r.budget ? rp(r.budget) : "—"}</td>
                    <td className="w-44">{r.budget ? <Meter kind="spend" value={r.actualCost} max={r.budget} label={`${r.name} spent vs budget`} /> : r.actualCost ? rp(r.actualCost) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <p className="text-xs text-muted">Progress and on-time use the Done category of each board&apos;s status labels. A project is late when it is still open and its due date has passed. Spent above 100% of budget is over budget.</p>
        </>
      )}
    </>
  );
}
