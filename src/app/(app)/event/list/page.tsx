import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { EventRowActions, NewEventButton } from "@/components/forms/crm-forms";
import { canManageMarketing } from "@/lib/permissions";
import { allCampaignOptions, peopleOptions } from "@/lib/queries/options";
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
  const user = await getCurrentUser();
  const manage = canManageMarketing(user);
  const today = await now();
  const e = schema.events;
  const [rows, people, campaigns] = await Promise.all([getDb()
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
      deals: e.dealsCount,
      revenue: e.revenue,
      campaignId: e.campaignId,
      ownerId: e.ownerId,
      captured: sql<number>`(select count(*)::int from ${schema.eventLeads} where ${schema.eventLeads.eventId} = ${sql.identifier("events")}.${sql.identifier("id")})`,
    })
    .from(e)
    .orderBy(desc(e.heldOn)), manage ? peopleOptions() : Promise.resolve([]), manage ? allCampaignOptions() : Promise.resolve([])]);
  const upcoming = rows.filter((r) => r.status === "scheduled");
  const next = upcoming.at(-1);

  return (
    <>
      <PageHeader href="/event/list" actions={manage && <NewEventButton people={people} campaigns={campaigns} />} />
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
                {manage && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
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
                    {manage && (
                      <td>
                        <EventRowActions
                          people={people}
                          campaigns={campaigns}
                          e={{ id: r.id, name: r.name, type: r.type, heldOn: r.on, location: r.location, status: r.status, campaignId: r.campaignId, ownerId: r.ownerId, budget: r.budget, actualCost: r.cost, visitors: r.visitors, leadsCount: r.leads, dealsCount: r.deals, revenue: r.revenue }}
                        />
                      </td>
                    )}
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
