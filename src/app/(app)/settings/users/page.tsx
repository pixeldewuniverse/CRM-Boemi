import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NewUserButton, UserRowActions } from "@/components/forms/admin-forms";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { fdatetime } from "@/lib/format";
import { ROLE_LABEL, ROLE_ORDER, ROLE_SCOPE, type Role } from "@/lib/roles";

export const metadata: Metadata = { title: "Users & Roles" };
const HREF = "/settings/users";

type Access = "full" | "own" | "team" | "view" | "config";
/** Access Matrix v2.0 (Read & Execute; data scope from ROLE_SCOPE). */
const MATRIX: { area: string; access: (r: Role) => Access | null }[] = [
  { area: "Dashboard & workspace", access: (r) => (r === "admin" ? "config" : "full") },
  { area: "CRM & Sales", access: (r) => (r === "admin" ? "config" : ROLE_SCOPE[r] === "own" ? "own" : ROLE_SCOPE[r] === "team" ? "team" : "full") },
  { area: "Marketing & events", access: (r) => (r === "admin" ? "config" : "full") },
  { area: "Project management", access: (r) => (r === "admin" ? "config" : ROLE_SCOPE[r] === "own" ? "own" : "full") },
  { area: "Approvals", access: (r) => (r === "admin" ? "config" : ["sales_manager", "finance", "executive"].includes(r) ? "full" : "own") },
  { area: "Reporting", access: (r) => (r === "admin" ? "config" : ["executive", "sales_manager"].includes(r) ? (r === "sales_manager" ? "team" : "full") : r === "finance" ? "view" : null) },
  { area: "Administration", access: (r) => (r === "admin" ? "config" : r === "sales_manager" ? "view" : null) },
];
const CELL: Record<Access, React.ReactNode> = {
  config: <Pill tone="accent">Full + config</Pill>,
  full: <Pill tone="ok">Full</Pill>,
  team: <Pill tone="info">Department</Pill>,
  own: <Pill tone="warn">Own data</Pill>,
  view: <Pill>Limited</Pill>,
};

export default async function UsersPage({ searchParams }: PageProps<"/settings/users">) {
  const { user, denied } = await guard(HREF);
  if (denied) return denied;
  const params = await searchParams;
  const status = params.status === "inactive" ? "inactive" : params.status === "all" ? "all" : undefined;
  const role = ROLE_ORDER.includes(params.role as Role) ? (params.role as Role) : undefined;
  const db = getDb();
  const manager = alias(schema.users, "manager");
  const u = schema.users;
  const [rows, departments] = await Promise.all([
    db
      .select({ u, manager: manager.name, dept: schema.departments.name })
      .from(u)
      .leftJoin(manager, eq(manager.id, u.managerId))
      .leftJoin(schema.departments, eq(schema.departments.id, u.departmentId))
      .orderBy(asc(u.name)),
    db.select({ value: schema.departments.id, label: schema.departments.name }).from(schema.departments).orderBy(asc(schema.departments.name)),
  ]);
  const managers = rows.filter((r) => r.u.active).map((r) => ({ value: r.u.id, label: `${r.u.name} · ${ROLE_LABEL[r.u.role]}` }));
  const visible = rows.filter((r) => (status === "all" ? true : status === "inactive" ? !r.u.active : r.u.active)).filter((r) => !role || r.u.role === role);
  const keep = { status, role };

  return (
    <>
      <PageHeader href={HREF} actions={<NewUserButton departments={departments} managers={managers} />} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          pathname={HREF}
          param="status"
          value={status}
          keep={keep}
          options={[
            { value: undefined, label: "Active", count: rows.filter((r) => r.u.active).length },
            { value: "inactive", label: "Inactive", count: rows.filter((r) => !r.u.active).length },
            { value: "all", label: "All", count: rows.length },
          ]}
        />
        <FilterChips pathname={HREF} param="role" value={role} keep={keep} options={[{ value: undefined, label: "All roles" }, ...ROLE_ORDER.filter((r) => rows.some((x) => x.u.role === r)).map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
      </div>
      <Panel flush>
        {visible.length === 0 ? (
          <Empty>No users.</Empty>
        ) : (
          <table className="tbl min-w-[980px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department / reports to</th>
                <th>Sign-in</th>
                <th className="num">Last sign-in</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ u: r, manager: mgr, dept }) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">
                      {r.name} {r.id === user.id && <span className="text-xs font-normal text-muted">(you)</span>}
                    </p>
                    <p className="break-all text-xs text-muted">{r.email}</p>
                  </td>
                  <td>
                    {ROLE_LABEL[r.role]}
                    <p className="text-xs text-muted">{r.position ?? ""}</p>
                  </td>
                  <td>
                    {dept ?? "—"}
                    <p className="text-xs text-muted">{mgr ? `→ ${mgr}` : ""}</p>
                  </td>
                  <td>
                    {r.authProvider === "google" ? "Google" : r.passwordHash ? "Password" : <span className="text-muted">Not invited</span>}
                    {r.mustChangePassword && <p className="text-xs text-warn">Must change password</p>}
                  </td>
                  <td className="num">{r.lastLoginAt ? fdatetime(r.lastLoginAt) : "Never"}</td>
                  <td>{r.active ? <Pill tone="ok">Active</Pill> : <Pill>Inactive</Pill>}</td>
                  <td>
                    <UserRowActions
                      self={r.id === user.id}
                      departments={departments}
                      managers={managers}
                      u={{ id: r.id, name: r.name, email: r.email, role: r.role, departmentId: r.departmentId, managerId: r.managerId, position: r.position, region: r.region, phone: r.phone, joinedOn: r.joinedOn, active: r.active, hasPassword: Boolean(r.passwordHash), google: r.authProvider === "google" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Access matrix" description="Read & execute per module. Data scope: Department = everyone in the head's department and their reports; Own = only their records." flush>
        <table className="tbl min-w-[1100px] text-[13px]">
          <thead>
            <tr>
              <th>Module</th>
              {ROLE_ORDER.map((r) => (
                <th key={r}>{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((m) => (
              <tr key={m.area}>
                <td className="font-semibold">{m.area}</td>
                {ROLE_ORDER.map((r) => {
                  const a = m.access(r);
                  return <td key={r}>{a ? CELL[a] : <span className="text-muted">—</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="text-xs text-muted">Google Workspace sign-in: users get sign-in method “Google” and no password once it&apos;s switched on.</p>
    </>
  );
}
