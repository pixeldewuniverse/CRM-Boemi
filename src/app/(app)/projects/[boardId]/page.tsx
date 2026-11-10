import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { BoardTable } from "@/components/board-table/board-table";
import type { Column, GroupData, ItemRow, Person } from "@/components/board-table/types";
import { Toaster } from "@/components/board-table/ui";
import { ArchiveBoardButton, EditBoardButton, MembersButton, ProjectStatusActions } from "@/components/forms/board-forms";
import { Pill, StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { loadBoard } from "@/lib/boards/access";
import { DEFAULT_PRIORITY_LABELS, labelsOf } from "@/lib/boards/columns";
import { boardFormOptions } from "@/lib/boards/options";
import { PAGE_SIZE, groupSummaries, loadAllMatching, loadGroupItems, loadSubitems, parseBoardParams } from "@/lib/boards/queries";
import { fdate, rp, ymd } from "@/lib/format";
import { BOARD_VISIBILITY, PROJECT_STATUS } from "@/lib/labels";
import { pendingRequestFor } from "@/lib/approvals";
import { now } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOON = ["Calendar", "Workload", "Dashboard"];

export async function generateMetadata({ params }: PageProps<"/projects/[boardId]">): Promise<Metadata> {
  const [{ boardId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!UUID.test(boardId)) return { title: "Board" };
  const found = await loadBoard(user, boardId);
  return { title: found ? (found.board.code ? `${found.board.code} · ${found.board.name}` : found.board.name) : "Board" };
}

export default async function BoardPage({ params, searchParams }: PageProps<"/projects/[boardId]">) {
  const user = await getCurrentUser();
  const [{ boardId }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(boardId)) notFound();
  const found = await loadBoard(user, boardId);
  if (!found) notFound();
  const { board, access } = found;
  const kanban = sp.view === "kanban";
  const timeline = sp.view === "timeline";
  const view = kanban ? "kanban" : timeline ? "timeline" : "table";
  const p = { ...parseBoardParams(sp), ...(view !== "table" ? { groupBy: undefined } : {}) };
  // Filters carry over between Table and Kanban; view-specific params don't.
  const keepFilters = Object.fromEntries(["q", "person", "status", "group", "from", "to", "sort", "dir"].filter((k) => typeof sp[k] === "string" && sp[k]).map((k) => [k, sp[k] as string]));
  const search = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const db = getDb();

  const [colRows, groupRows, members, peopleRows, today] = await Promise.all([
    db.select().from(schema.boardColumns).where(eq(schema.boardColumns.boardId, boardId)).orderBy(asc(schema.boardColumns.position)),
    db.select().from(schema.boardGroups).where(eq(schema.boardGroups.boardId, boardId)).orderBy(asc(schema.boardGroups.position)),
    db
      .select({ userId: schema.boardMembers.userId, name: schema.users.name, role: schema.boardMembers.role, editAssignedOnly: schema.boardMembers.editAssignedOnly })
      .from(schema.boardMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.boardMembers.userId))
      .where(eq(schema.boardMembers.boardId, boardId))
      .orderBy(asc(schema.users.name)),
    // Who can be put on items: members + the board's department (same rule as the server action).
    db
      .select({ id: schema.users.id, name: schema.users.name, avatarKey: schema.users.avatarKey })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.active, true),
          or(
            sql`exists (select 1 from ${schema.boardMembers} m where m.board_id = ${boardId} and m.user_id = ${sql.identifier("users")}.${sql.identifier("id")})`,
            board.departmentId ? eq(schema.users.departmentId, board.departmentId) : undefined,
          ),
        ),
      )
      .orderBy(asc(schema.users.name)),
    now().then(ymd),
  ]);
  const columns: Column[] = colRows.map((c) => ({ id: c.id, key: c.key, title: c.title, type: c.type, settings: (c.settings ?? {}) as Record<string, unknown>, width: c.width, hidden: c.hidden, isSystem: c.isSystem, position: c.position }));
  const colKeys = columns.map((c) => ({ key: c.key, type: c.type }));
  const numberKeys = columns.filter((c) => c.type === "number").map((c) => c.key);
  const filtered = Boolean(p.q || p.person || p.status?.length || p.group || p.from || p.to);

  let groups: GroupData[];
  let truncated = false;
  if (timeline) {
    // Gantt: every matching item, in the board's groups (sorted by start date unless a sort is chosen).
    const res = await loadAllMatching(boardId, p.sort ? p : { ...p, sort: "timeline_start" }, colKeys);
    truncated = res.truncated;
    groups = groupRows
      .filter((g) => !p.group || g.id === p.group)
      .map((g) => ({ id: g.id, name: g.name, color: g.color, collapsed: g.collapsed, total: 0, summary: null, items: res.items.filter((i) => i.groupId === g.id) }))
      .map((g) => ({ ...g, total: g.items.length }))
      .filter((g) => !filtered || g.items.length);
  } else if (kanban) {
    const res = await loadAllMatching(boardId, p, colKeys);
    truncated = res.truncated;
    groups = [{ id: "v-all", name: "All items", color: "c1", collapsed: false, total: res.items.length, summary: null, items: res.items }];
  } else if (p.groupBy) {
    const res = await loadAllMatching(boardId, p, colKeys);
    truncated = res.truncated;
    const bucket = (key: string, name: string, color: string, items: ItemRow[]): GroupData => ({ id: `v-${key}`, name, color, collapsed: false, total: items.length, summary: null, items, virtual: true });
    if (p.groupBy === "person") {
      const ids = [...new Set(res.items.flatMap((i) => i.assignees))];
      groups = peopleRows.filter((u) => ids.includes(u.id)).map((u) => bucket(u.id, u.name, "c1", res.items.filter((i) => i.assignees.includes(u.id))));
      const none = res.items.filter((i) => !i.assignees.length);
      if (none.length) groups.push(bucket("none", "Unassigned", "c4", none));
    } else {
      const labels = p.groupBy === "status" ? labelsOf(columns.find((c) => c.key === "status")?.settings) : labelsOf(columns.find((c) => c.key === "priority")?.settings).length ? labelsOf(columns.find((c) => c.key === "priority")?.settings) : DEFAULT_PRIORITY_LABELS;
      const field = p.groupBy === "status" ? "statusKey" : "priority";
      groups = labels.map((l) => bucket(l.key, l.label, l.color, res.items.filter((i) => i[field] === l.key))).filter((g) => g.items.length);
      const none = res.items.filter((i) => !i[field] || !labels.some((l) => l.key === i[field]));
      if (none.length) groups.push(bucket("none", p.groupBy === "status" ? "No status" : "No priority", "grey", none));
    }
  } else {
    const summaries = await groupSummaries(boardId, p, numberKeys);
    const shown = groupRows.filter((g) => (!p.group || g.id === p.group) && (!filtered || summaries.has(g.id)));
    const pages = await Promise.all(shown.map((g) => (summaries.has(g.id) ? loadGroupItems(boardId, g.id, p, colKeys, 0, PAGE_SIZE) : Promise.resolve([] as ItemRow[]))));
    groups = shown.map((g, i) => ({ id: g.id, name: g.name, color: g.color, collapsed: g.collapsed, total: summaries.get(g.id)?.total ?? 0, summary: summaries.get(g.id)?.summary ?? null, items: pages[i] }));
  }
  const [subitems, options, pending] = await Promise.all([
    loadSubitems(groups.flatMap((g) => g.items.map((i) => i.id))),
    boardFormOptions(user),
    board.kind === "project" && board.projectStatus === "pending_approval" ? pendingRequestFor("project", board.id) : null,
  ]);
  const dept = board.departmentId ? (await db.select({ name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.id, board.departmentId)))[0]?.name : undefined;
  const people: Person[] = peopleRows;
  // The board's own workspace stays selectable when editing, even if it isn't the editor's department.
  const editOptions = board.departmentId && dept && !options.departments.some((d) => d.value === board.departmentId) ? { ...options, departments: [{ value: board.departmentId, label: dept }, ...options.departments] } : options;
  const [account, deal, owner] = await Promise.all([
    board.customerId ? db.select({ name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.id, board.customerId)).then((r) => r[0]?.name) : undefined,
    board.opportunityId ? db.select({ title: schema.opportunities.title }).from(schema.opportunities).where(eq(schema.opportunities.id, board.opportunityId)).then((r) => r[0]?.title) : undefined,
    board.ownerId ? db.select({ name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [board.ownerId])).then((r) => r[0]?.name) : undefined,
  ]);
  const archived = Boolean(board.archivedAt);
  const project = board.kind === "project";
  const meta = [dept, owner && `Owner: ${owner}`, account, deal && `Deal: ${deal}`, project && board.budget ? `Budget ${rp(board.budget)}${board.actualCost ? ` · spent ${rp(board.actualCost)}` : ""}` : null, project && (board.startOn || board.dueOn) ? `${board.startOn ? fdate(board.startOn) : "…"} – ${board.dueOn ? fdate(board.dueOn) : "…"}` : null].filter(Boolean);
  // Remount the client table on every server render (after refresh() or a URL change) so it starts from fresh data.
  const stamp = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <Link href="/projects" className="hover:text-fg">
          Boards &amp; Projects
        </Link>{" "}
        / <span className="text-fg">{board.code ?? board.name}</span>
      </nav>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] md:text-[28px]">{board.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            {board.code && <span className="font-semibold">{board.code}</span>}
            {project ? <StatusPill map={PROJECT_STATUS} value={board.projectStatus} /> : <Pill>Team board</Pill>}
            <Pill tone={BOARD_VISIBILITY[board.visibility].tone}>{BOARD_VISIBILITY[board.visibility].label}</Pill>
          </div>
          {meta.length > 0 && <p className="mt-1 text-[13px] text-muted">{meta.join(" · ")}</p>}
          {board.description && <p className="mt-2 max-w-[70ch] text-[13px] text-muted">{board.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {project && !archived && <ProjectStatusActions id={board.id} status={board.projectStatus ?? "draft"} canManage={access.manage} />}
          <MembersButton boardId={board.id} members={members} people={peopleRows.map((u) => ({ value: u.id, label: u.name }))} canManage={access.manage && !archived} ownerId={board.ownerId} />
          {access.manage && !archived && (
            <EditBoardButton
              o={editOptions}
              b={{ id: board.id, kind: board.kind, name: board.name, description: board.description, departmentId: board.departmentId, visibility: board.visibility, priority: board.priority, customerId: board.customerId, opportunityId: board.opportunityId, budget: board.budget, actualCost: board.actualCost, startOn: board.startOn, dueOn: board.dueOn, dependencyMode: board.dependencyMode }}
            />
          )}
          {access.manage && <ArchiveBoardButton id={board.id} archived={archived} />}
        </div>
      </div>
      {pending && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Waiting for approval{pending.step ? ` — step ${pending.step.position}: ${pending.step.label}` : ""}. Approvers see it under{" "}
          <Link href="/approvals" className="font-semibold underline">
            Approvals
          </Link>
          .
        </p>
      )}
      {archived && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">This board is archived and read-only.</p>}

      <nav aria-label="Board views" className="flex gap-1 overflow-x-auto border-b border-line">
        {[
          { label: "Main Table", on: view === "table", query: { ...keepFilters } },
          { label: "Kanban", on: kanban, query: { ...keepFilters, view: "kanban" } },
          { label: "Timeline", on: timeline, query: { ...keepFilters, view: "timeline" } },
        ].map((v) => (
          <Link
            key={v.label}
            href={{ pathname: `/projects/${board.id}`, query: v.query }}
            aria-current={v.on ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${v.on ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-fg"}`}
          >
            {v.label}
          </Link>
        ))}
        {SOON.map((v) => (
          <span key={v} aria-disabled="true" title="Coming in a next batch" className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] text-muted opacity-60">
            {v}
          </span>
        ))}
      </nav>

      <BoardTable
        key={stamp}
        boardId={board.id}
        columns={columns}
        groups={groups}
        subitems={subitems}
        people={people}
        accounts={options.accounts}
        deals={options.deals}
        access={{ manage: access.manage, edit: access.edit, editAssignedOnly: access.editAssignedOnly }}
        userId={user.id}
        search={search}
        sorted={Boolean(p.sort && columns.some((c) => c.key === p.sort))}
        virtual={view === "table" && Boolean(p.groupBy)}
        truncated={truncated}
        realGroups={groupRows.map((g) => ({ id: g.id, name: g.name, color: g.color }))}
        view={view}
        dependencyMode={board.dependencyMode}
        archived={archived}
        today={today}
      />
      <Toaster />
    </div>
  );
}
