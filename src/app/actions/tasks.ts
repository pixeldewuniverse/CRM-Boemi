"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { mayManage } from "@/lib/scope";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { ACTIVITY_TYPES, TASK_COLUMNS, TASK_STATUS } from "@/lib/labels";
import { canSell, isManager } from "@/lib/permissions";
import { customerScope } from "@/lib/customers";
import { and } from "drizzle-orm";
import { notify } from "@/lib/notifications";
import type { MoveResult } from "./pipeline";


const Input = z.object({
  taskId: z.uuid(),
  status: z.enum(TASK_COLUMNS),
});

/** Drag a task to another column. Assignees move their own tasks; managers move any. */
export async function moveTask(input: z.input<typeof Input>): Promise<MoveResult> {
  const user = await verifyUser();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move." };
  const { taskId, status } = parsed.data;

  const db = getDb();
  const t = schema.tasks;
  const [task] = await db
    .select({ assigneeId: t.assigneeId, createdBy: t.createdBy, status: t.status, title: t.title, managerId: schema.users.managerId })
    .from(t)
    .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
    .where(eq(t.id, taskId));
  if (!task) return { ok: false, error: "Task not found." };
  if (!(await mayManage(user, task.assigneeId))) {
    return { ok: false, error: "Only the assignee or a sales manager can move this task." };
  }
  if (task.status === status) return { ok: true };

  await db
    .update(t)
    .set({ status, completedAt: status === "done" ? new Date() : null })
    .where(eq(t.id, taskId));

  await audit({ actorId: user.id, action: "update", entity: "task", entityId: task.title, changes: { status: [task.status, status] } });

  // Someone else needs to act: ask the approver, or tell the assignee.
  if (status === "waiting_approval") {
    const approver = task.managerId ?? task.createdBy;
    if (approver && approver !== user.id) {
      await notify({
        userIds: [approver],
        type: "task.assigned",
        title: `Approval needed: ${task.title}`,
        body: `${user.name} moved this task to ${TASK_STATUS[status].label}.`,
        link: "/sales/tasks",
      });
    }
  } else if (task.assigneeId !== user.id) {
    await notify({
      userIds: [task.assigneeId],
      type: "task.assigned",
      title: `${task.title} → ${TASK_STATUS[status].label}`,
      body: `Moved by ${user.name}.`,
      link: "/sales/tasks",
    });
  }
  refresh();
  return { ok: true };
}

const NewTask = z.object({
  title: z.string("Describe the task.").min(3, "Describe the task.").max(200),
  type: z.enum(ACTIVITY_TYPES).default("Follow-up"),
  accountId: z.uuid().optional(),
  dueDate: z.iso.date("Pick a due date."),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
  assigneeId: z.uuid().optional(),
  description: z.string().max(1000).optional(),
});

export async function createTask(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user) && user.role !== "marketing") return { ok: false, error: "Your role can't add tasks here." };
  const parsed = NewTask.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  if (d.accountId) {
    const [acc] = await getDb()
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, d.accountId), customerScope(user)));
    if (!acc) return { ok: false, error: "Account not found.", fieldErrors: { accountId: "Choose one of your accounts." } };
  }
  const assigneeId = isManager(user) && d.assigneeId ? d.assigneeId : user.id;
  const dueAt = new Date(`${d.dueDate}T${d.dueTime}:00+07:00`);
  await getDb().insert(schema.tasks).values({
    title: d.title,
    type: d.type,
    customerId: d.accountId,
    assigneeId,
    createdBy: user.id,
    status: "open",
    dueAt,
    description: d.description,
  });
  await audit({ actorId: user.id, action: "create", entity: "task", entityId: d.title, changes: { due: `${d.dueDate} ${d.dueTime}` } });
  if (assigneeId !== user.id) {
    await notify({ userIds: [assigneeId], type: "task.assigned", title: `New task: ${d.title}`, body: `From ${user.name} · due ${d.dueDate} ${d.dueTime}`, link: "/sales/tasks" });
  }
  refresh();
  return { ok: true, message: "Task added." };
}
