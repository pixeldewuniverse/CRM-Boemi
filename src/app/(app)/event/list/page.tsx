import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate, num, rp } from "@/lib/format";
import { EVENT_STATUS } from "@/lib/labels";
import { now } from "@/lib/scope";

export const metadata: Metadata = { title: "Event List" };

export default async function EventListPage() {
  await getCurrentUser();
  const today = await now();
  const e = schema.events;
  const rows = await getDb()
    .select({
      id: e.id,
      name: e.name,
      type: e.type,
      on: e.heldOn,
      location: e.location,
      status: e.status,
      budget: e.budget,
      cost: e.actualCost,
      visitors: e.visitors,
      leads: e.leadsCount,
      captured: sql<number>`(select count(*)::int from ${schema.eventLeads} where ${schema.eventLeads.eventId} = ${e.id})`,
    })
    .from(e)
    .orderBy(desc(e.heldOn));
  const upcoming = rows.filter((r) => r.status === "scheduled");
  const next = upcoming.at(-1);

  return (
    <>
      <PageHeader href="/event/list" />
      <Stats
        items={[
          { label: "Upcoming", value: upcoming.length, hint: next ? `Next: ${next.name}, ${fdate(next.on)}` : undefined },
          { label: "Held this year", value: rows.filter((r) => r.status === "done").length },
          { label: "Visitors", value: num(rows.reduce((s, r) => s + r.visitors, 0)) },
          { label: "Leads collected", value: num(rows.reduce((s, r) => s + r.leads, 0)) },
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No events.</Empty>
        ) : (
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Event</th>
                <th className="num">Date</th>
                <th>Location</th>
                <th className="num">Budget</th>
                <th className="num">Spent</th>
                <th className="num">Visitors</th>
                <th className="num">Leads</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const inDays = daysBetween(today, r.on);
                return (
                  <tr key={r.id}>
                    <td>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted">{r.type}</p>
                    </td>
                    <td className="num">
                      {fdate(r.on)}
                      {r.status === "scheduled" && inDays >= 0 && (
                        <p className="text-xs text-accent">{inDays === 0 ? "today" : `in ${inDays} days`}</p>
                      )}
                    </td>
                    <td>{r.location}</td>
                    <td className="num">{rp(r.budget)}</td>
                    <td className="num">{r.cost ? rp(r.cost) : "—"}</td>
                    <td className="num">{r.visitors || "—"}</td>
                    <td className="num">
                      {r.leads || "—"}
                      {r.captured > 0 && <p className="text-xs text-muted">{r.captured} captured</p>}
                    </td>
                    <td>
                      <StatusPill map={EVENT_STATUS} value={r.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
