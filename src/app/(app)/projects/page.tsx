import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { NewBoardButtons } from "@/components/forms/board-forms";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips, SearchBox } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill, StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { canCreateBoards, visibleBoardsWhere } from "@/lib/boards/access";
import { boardFormOptions } from "@/lib/boards/options";
import { fdate, rp } from "@/lib/format";
import { BOARD_VISIBILITY, PROJECT_STATUS } from "@/lib/labels";

export const metadata: Metadata = { title: "Boards & Projects" };
const HREF = "/projects";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const view = sp.view === "projects" || sp.view === "team" || sp.view === "archived" ? sp.view : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const db = getDb();
  const b = schema.boards;
  const it = schema.boardItems;
  const visible = await visibleBoardsWhere(user);
  const base = and(visible, sql`${b.kind} <> 'template'`, q ? sql`(${b.name} ilike ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} or ${b.code} ilike ${`%${q}%`})` : undefined);
  const where = and(
    base,
    view === "archived" ? isNotNull(b.archivedAt) : isNull(b.archivedAt),
    view === "projects" ? eq(b.kind, "project") : view === "team" ? eq(b.kind, "team") : undefined,
  );

  const [rows, counts, options] = await Promise.all([
    db
      .select({
        id: b.id,
        kind: b.kind,
        name: b.name,
        code: b.code,
        status: b.projectStatus,
        visibility: b.visibility,
        dueOn: b.dueOn,
        budget: b.budget,
        department: schema.departments.name,
        owner: schema.users.name,
        account: schema.customers.name,
        total: sql<number>`(select count(*)::int from ${it} where ${it.boardId} = ${b.id} and ${it.parentItemId} is null and ${it.archivedAt} is null)`,
        done: sql<number>`(select count(*)::int from ${it} where ${it.boardId} = ${b.id} and ${it.parentItemId} is null and ${it.archivedAt} is null and ${it.completedAt} is not null)`,
        members: sql<number>`(select count(*)::int from ${schema.boardMembers} m where m.board_id = ${b.id})`,
      })
      .from(b)
      .leftJoin(schema.departments, eq(schema.departments.id, b.departmentId))
      .leftJoin(schema.users, eq(schema.users.id, b.ownerId))
      .leftJoin(schema.customers, eq(schema.customers.id, b.customerId))
      .where(where)
      .orderBy(asc(schema.departments.name), desc(b.kind), asc(b.name)),
    db
      .select({ kind: b.kind, archived: sql<boolean>`${b.archivedAt} is not null`, n: sql<number>`count(*)::int` })
      .from(b)
      .where(base)
      .groupBy(b.kind, sql`${b.archivedAt} is not null`),
    canCreateBoards(user) ? boardFormOptions(user) : null,
  ]);
  const count = (kind?: string, archived = false) => counts.filter((c) => c.archived === archived && (!kind || c.kind === kind)).reduce((a, c) => a + c.n, 0);
  const byDept = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.department ?? "No department";
    byDept.set(k, [...(byDept.get(k) ?? []), r]);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader href={HREF} actions={options ? <NewBoardButtons o={options} /> : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          pathname={HREF}
          param="view"
          value={view}
          keep={{ q: q || undefined }}
          options={[
            { value: undefined, label: "All", count: count() },
            { value: "projects", label: "Projects", count: count("project") },
            { value: "team", label: "Team boards", count: count("team") },
            { value: "archived", label: "Archived", count: count(undefined, true) },
          ]}
        />
        <div className="ml-auto">
          <SearchBox action={HREF} value={q} placeholder="Search boards or PRJ code" keep={{ view }} />
        </div>
      </div>

      {!rows.length && (
        <Panel>
          <Empty>{q || view ? "No boards match." : options ? "No boards yet — create a project or a team board." : "No boards are shared with you yet."}</Empty>
        </Panel>
      )}

      {[...byDept.entries()].map(([dept, list]) => (
        <Panel key={dept} title={dept} description={`${list.length} board${list.length === 1 ? "" : "s"}`} flush>
          <ul className="divide-y divide-line">
            {list.map((r) => {
              const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
              return (
                <li key={r.id}>
                  <Link href={`/projects/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-surface-2/50">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="truncate font-semibold">{r.name}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        {r.code ? <span className="font-semibold text-fg">{r.code}</span> : <span>Team board</span>}
                        {r.owner && <span>· {r.owner}</span>}
                        {r.account && <span>· {r.account}</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.kind === "project" && <StatusPill map={PROJECT_STATUS} value={r.status} />}
                      {r.visibility !== "department" && <Pill tone={BOARD_VISIBILITY[r.visibility].tone}>{BOARD_VISIBILITY[r.visibility].label}</Pill>}
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-44" title={`${r.done} of ${r.total} items done`}>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-20 text-right text-xs tabular-nums text-muted">
                        {r.done}/{r.total} done
                      </span>
                    </div>
                    <div className="w-full text-xs text-muted sm:w-32 sm:text-right">
                      {r.dueOn ? `Due ${fdate(r.dueOn)}` : `${r.members} member${r.members === 1 ? "" : "s"}`}
                      {r.budget ? <span className="block">{rp(r.budget)}</span> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
