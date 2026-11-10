import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { visibleBoardsWhere } from "@/lib/boards/access";
import { labelsOf } from "@/lib/boards/columns";

/** Jakarta calendar day of a timestamp. */
const jakartaDay = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const OPEN_STATUSES = ["draft", "pending_approval", "active", "on_hold"];

export type ProjectRow = {
  id: string;
  code: string | null;
  name: string;
  status: string;
  department: string;
  departmentId: string | null;
  owner: string | null;
  dueOn: string | null;
  items: number;
  done: number;
  /** 0–100, items whose status is in the Done category. */
  progress: number;
  overdue: number;
  /** Done items that had a due date, and how many of them were finished on time. */
  doneWithDue: number;
  doneOnTime: number;
  budget: number;
  actualCost: number;
  /** Open project whose due date has passed. */
  late: boolean;
};

export type DepartmentRow = {
  department: string;
  departmentId: string | null;
  projects: number;
  open: number;
  late: number;
  avgProgress: number;
  onTimeRate: number | null;
  overdue: number;
  budget: number;
  actualCost: number;
};

/**
 * Project performance from boards of kind "project" the user may see.
 * Progress and on-time use the Done CATEGORY of each board's status labels.
 */
export async function projectPerformance(user: CurrentUser, today: string, opts: { includeClosed?: boolean } = {}) {
  const db = getDb();
  const b = schema.boards;
  const it = schema.boardItems;
  const projects = await db
    .select({ id: b.id, code: b.code, name: b.name, status: b.projectStatus, departmentId: b.departmentId, department: schema.departments.name, owner: schema.users.name, dueOn: b.dueOn, budget: b.budget, actualCost: b.actualCost })
    .from(b)
    .leftJoin(schema.departments, eq(schema.departments.id, b.departmentId))
    .leftJoin(schema.users, eq(schema.users.id, b.ownerId))
    .where(and(await visibleBoardsWhere(user), eq(b.kind, "project"), isNull(b.archivedAt), opts.includeClosed === false ? inArray(b.projectStatus, OPEN_STATUSES as never) : undefined))
    .orderBy(sql`${schema.departments.name} nulls last`, b.name);
  const ids = projects.map((p) => p.id);
  const [items, statusCols] = ids.length
    ? await Promise.all([
        db.select({ boardId: it.boardId, statusKey: it.statusKey, dueOn: it.dueOn, completedAt: it.completedAt }).from(it).where(and(inArray(it.boardId, ids), isNull(it.parentItemId), isNull(it.archivedAt))),
        db.select({ boardId: schema.boardColumns.boardId, settings: schema.boardColumns.settings }).from(schema.boardColumns).where(and(inArray(schema.boardColumns.boardId, ids), eq(schema.boardColumns.key, "status"))),
      ])
    : [[], []];

  const rows: ProjectRow[] = projects.map((p) => {
    const doneKeys = new Set(labelsOf(statusCols.find((c) => c.boardId === p.id)?.settings).filter((l) => l.category === "done").map((l) => l.key));
    const mine = items.filter((i) => i.boardId === p.id);
    const isDone = (i: (typeof mine)[number]) => doneKeys.has(i.statusKey ?? "");
    const done = mine.filter(isDone);
    const withDue = done.filter((i) => i.dueOn);
    const status = p.status ?? "draft";
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status,
      department: p.department ?? "No department",
      departmentId: p.departmentId,
      owner: p.owner,
      dueOn: p.dueOn,
      items: mine.length,
      done: done.length,
      progress: mine.length ? Math.round((done.length / mine.length) * 100) : 0,
      overdue: mine.filter((i) => !isDone(i) && i.dueOn && i.dueOn < today).length,
      doneWithDue: withDue.length,
      doneOnTime: withDue.filter((i) => i.completedAt && jakartaDay(i.completedAt) <= i.dueOn!).length,
      budget: p.budget ?? 0,
      actualCost: p.actualCost ?? 0,
      late: OPEN_STATUSES.includes(status) && Boolean(p.dueOn && p.dueOn < today),
    };
  });

  const depts = new Map<string, DepartmentRow & { progressSum: number; withDue: number; onTime: number }>();
  for (const r of rows) {
    const k = r.departmentId ?? "";
    const d = depts.get(k) ?? { department: r.department, departmentId: r.departmentId, projects: 0, open: 0, late: 0, avgProgress: 0, onTimeRate: null, overdue: 0, budget: 0, actualCost: 0, progressSum: 0, withDue: 0, onTime: 0 };
    d.projects++;
    if (OPEN_STATUSES.includes(r.status)) d.open++;
    if (r.late) d.late++;
    d.progressSum += r.progress;
    d.withDue += r.doneWithDue;
    d.onTime += r.doneOnTime;
    d.overdue += r.overdue;
    d.budget += r.budget;
    d.actualCost += r.actualCost;
    depts.set(k, d);
  }
  const departments: DepartmentRow[] = [...depts.values()].map(({ progressSum, withDue, onTime, ...d }) => ({ ...d, avgProgress: d.projects ? Math.round(progressSum / d.projects) : 0, onTimeRate: withDue ? Math.round((onTime / withDue) * 100) : null }));
  const sum = (f: (r: ProjectRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const withDue = sum((r) => r.doneWithDue);
  const totals = {
    projects: rows.length,
    open: rows.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    late: rows.filter((r) => r.late).length,
    avgProgress: rows.length ? Math.round(sum((r) => r.progress) / rows.length) : 0,
    onTimeRate: withDue ? Math.round((sum((r) => r.doneOnTime) / withDue) * 100) : null,
    overdue: sum((r) => r.overdue),
    budget: sum((r) => r.budget),
    actualCost: sum((r) => r.actualCost),
  };
  return { rows, departments, totals };
}
