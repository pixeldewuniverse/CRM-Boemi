import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, fphone } from "@/lib/format";
import { EVENT_LEAD_STATUS } from "@/lib/labels";

export const metadata: Metadata = { title: "Lead Capture" };
const HREF = "/event/leads";
const STATUSES = ["new", "converted", "not_relevant"] as const;
type Status = (typeof STATUSES)[number];

export default async function EventLeadsPage({ searchParams }: PageProps<"/event/leads">) {
  await getCurrentUser();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const el = schema.eventLeads;
  const all = await getDb()
    .select({
      id: el.id,
      name: el.name,
      company: el.company,
      segment: el.segment,
      phone: el.phoneE164,
      interest: el.interest,
      status: el.status,
      event: schema.events.name,
      on: schema.events.heldOn,
    })
    .from(el)
    .innerJoin(schema.events, eq(schema.events.id, el.eventId))
    .orderBy(desc(schema.events.heldOn), el.name);
  const rows = status ? all.filter((r) => r.status === status) : all;

  return (
    <>
      <PageHeader href={HREF} />
      <FilterChips
        pathname={HREF}
        param="status"
        value={status}
        options={[
          { value: undefined, label: "All", count: all.length },
          ...STATUSES.map((s) => ({ value: s, label: EVENT_LEAD_STATUS[s].label, count: all.filter((r) => r.status === s).length })),
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No booth contacts.</Empty>
        ) : (
          <table className="tbl min-w-[880px]">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Segment</th>
                <th>Interest</th>
                <th>Event</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.company ?? "Individual"} · {fphone(r.phone)}
                    </p>
                  </td>
                  <td>{r.segment}</td>
                  <td>{r.interest}</td>
                  <td>
                    {r.event}
                    <p className="text-xs text-muted">{fdate(r.on)}</p>
                  </td>
                  <td>
                    <StatusPill map={EVENT_LEAD_STATUS} value={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
