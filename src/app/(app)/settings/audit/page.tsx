import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { fdatetime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit Trail" };
const HREF = "/settings/audit";

function describe(changes: Record<string, unknown> | null) {
  if (!changes) return "";
  return Object.entries(changes)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" → ") : String(v)}`)
    .join(" · ");
}

export default async function AuditPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  const a = schema.auditLogs;
  const rows = await getDb()
    .select({ id: a.id, at: a.createdAt, action: a.action, entity: a.entity, entityId: a.entityId, changes: a.changes, who: schema.users.name })
    .from(a)
    .leftJoin(schema.users, eq(schema.users.id, a.actorId))
    .orderBy(desc(a.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader href={HREF} />
      <Panel title="Latest 200 changes" flush>
        {rows.length === 0 ? (
          <Empty>No changes recorded yet.</Empty>
        ) : (
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fdatetime(r.at)}</td>
                  <td>{r.who ?? "System"}</td>
                  <td className="font-semibold capitalize">{r.action}</td>
                  <td>
                    {r.entity.replace("_", " ")}
                    {r.entityId && !/^[0-9a-f-]{36}$/i.test(r.entityId) && <span className="text-muted"> · {r.entityId}</span>}
                  </td>
                  <td className="text-muted">{describe(r.changes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
