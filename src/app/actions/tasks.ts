"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { TASK_COLUMNS, TASK_STATUS } from "@/lib/labels";
import { notify } from "@/lib/notifications";
import type { MoveResult } from "./pipeline";

const MANAGES = ["admin", "sales_manager"];

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
  if (task.assigneeId !== user.id && !MANAGES.includes(user.role)) {
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
