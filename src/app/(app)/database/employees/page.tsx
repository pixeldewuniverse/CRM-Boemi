import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await getCurrentUser();
  const u = schema.users;
  const mgr = alias(schema.users, "mgr");
  const rows = await getDb()
    .select({
      id: u.id,
      name: u.name,
      position: u.position,
      department: u.department,
      region: u.region,
      joined: u.joinedOn,
      role: u.role,
      active: u.active,
      manager: mgr.name,
    })
    .from(u)
    .leftJoin(mgr, eq(mgr.id, u.managerId))
    .orderBy(asc(u.department), asc(u.name));

  return (
    <>
      <PageHeader href="/database/employees" />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No employees.</Empty>
        ) : (
          <table className="tbl min-w-[880px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Area</th>
                <th>Reports to</th>
                <th>Access role</th>
                <th className="num">Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted">{r.position ?? "—"}</p>
                  </td>
                  <td>{r.department ?? "—"}</td>
                  <td>{r.region ?? "—"}</td>
                  <td>{r.manager ?? "—"}</td>
                  <td>{ROLE_LABEL[r.role]}</td>
                  <td className="num">{fdate(r.joined)}</td>
                  <td>{r.active ? <Pill tone="ok">Active</Pill> : <Pill>Inactive</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
