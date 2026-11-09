import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { fdatetime } from "@/lib/format";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/roles";

export const metadata: Metadata = { title: "Users & Roles" };
const HREF = "/settings/users";

const MATRIX: { area: string; access: Partial<Record<Role, "full" | "own" | "view">> }[] = [
  { area: "Leads, accounts, deals", access: { admin: "full", sales_manager: "full", sales: "own", executive: "view", marketing: "view", finance: "view", designer: "view" } },
  { area: "Quotations & orders", access: { admin: "full", sales_manager: "full", sales: "own", executive: "view", finance: "view" } },
  { area: "Visits & visit fees", access: { admin: "full", sales_manager: "full", sales: "own", finance: "full", executive: "view" } },
  { area: "Approve visit fees", access: { admin: "full", sales_manager: "full", finance: "full" } },
  { area: "Targets", access: { admin: "full", sales_manager: "full", sales: "own", executive: "view" } },
  { area: "Campaigns, events, content", access: { admin: "full", sales_manager: "full", marketing: "full", designer: "full", executive: "view", sales: "view" } },
  { area: "Reports & dashboards", access: { admin: "full", sales_manager: "full", executive: "full", finance: "full", marketing: "full", sales: "own" } },
  { area: "Settings", access: { admin: "full", sales_manager: "full" } },
];
const CELL = { full: <Pill tone="ok">Full</Pill>, own: <Pill tone="accent">Own data</Pill>, view: <Pill tone="info">View</Pill> };

export default async function UsersPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  const users = await getDb().select().from(schema.users).orderBy(asc(schema.users.role), asc(schema.users.name));

  return (
    <>
      <PageHeader href={HREF} />
      <Panel title="Users" description="Demo accounts share the staging password. Google Workspace sign-in replaces passwords after go-live." flush>
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Sign-in</th>
              <th className="num">Last sign-in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-muted">{u.position ?? "—"}</p>
                </td>
                <td className="break-all">{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>{u.passwordHash ? "Password" : "Google only"}</td>
                <td className="num">{u.lastLoginAt ? fdatetime(u.lastLoginAt) : "Never"}</td>
                <td>{u.active ? <Pill tone="ok">Active</Pill> : <Pill>Disabled</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="What each role can do" flush>
        <table className="tbl min-w-[920px]">
          <thead>
            <tr>
              <th>Area</th>
              {ROLES.map((r) => (
                <th key={r}>{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((m) => (
              <tr key={m.area}>
                <td className="font-semibold">{m.area}</td>
                {ROLES.map((r) => (
                  <td key={r}>{m.access[r] ? CELL[m.access[r]!] : <span className="text-muted">—</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
