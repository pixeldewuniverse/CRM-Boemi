import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { DepartmentRowActions, NewDepartmentButton } from "@/components/forms/admin-forms";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { ROLE_LABEL } from "@/lib/roles";

export const metadata: Metadata = { title: "Departments & Teams" };
const HREF = "/settings/departments";

export default async function DepartmentsPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  const db = getDb();
  const [deps, users] = await Promise.all([
    db.select().from(schema.departments).orderBy(asc(schema.departments.name)),
    db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, departmentId: schema.users.departmentId, active: schema.users.active }).from(schema.users).where(eq(schema.users.active, true)).orderBy(asc(schema.users.name)),
  ]);
  const people = users.map((u) => ({ value: u.id, label: `${u.name} · ${ROLE_LABEL[u.role]}` }));
  const depOptions = deps.map((d) => ({ value: d.id, label: d.name }));
  const name = (id: string | null) => users.find((u) => u.id === id)?.name;
  // Top-level first, sub-departments right under their parent.
  const ordered = deps.filter((d) => !d.parentId).flatMap((d) => [d, ...deps.filter((c) => c.parentId === d.id)]);
  const orphans = deps.filter((d) => !ordered.includes(d));

  return (
    <>
      <PageHeader href={HREF} actions={<NewDepartmentButton people={people} departments={depOptions} />} />
      <Panel flush>
        {deps.length === 0 ? (
          <Empty>No departments yet.</Empty>
        ) : (
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Department</th>
                <th>Head</th>
                <th>People</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...ordered, ...orphans].map((d) => {
                const members = users.filter((u) => u.departmentId === d.id);
                return (
                  <tr key={d.id}>
                    <td className={d.parentId ? "pl-10" : ""}>
                      <p className="font-semibold">
                        {d.parentId && <span className="mr-1 text-muted">↳</span>}
                        {d.name}
                      </p>
                      <p className="font-mono text-xs text-muted">{d.code}</p>
                    </td>
                    <td>{name(d.headUserId) ?? <span className="text-muted">—</span>}</td>
                    <td className="max-w-md text-[13px]">
                      <span className="font-semibold tabular-nums">{members.length}</span>
                      {members.length > 0 && <span className="text-muted"> · {members.slice(0, 5).map((m) => m.name).join(", ")}{members.length > 5 ? "…" : ""}</span>}
                    </td>
                    <td>
                      <DepartmentRowActions d={{ id: d.id, name: d.name, code: d.code, headUserId: d.headUserId, parentId: d.parentId }} people={people} departments={depOptions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="text-[13px] text-muted">
        A Department Head / Manager sees the records of everyone in their department and its sub-departments, plus their direct reports. People are placed in a department from Users &amp; Roles.
      </p>
    </>
  );
}
