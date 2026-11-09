"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { CONTENT_STEPS, canTakeStep, type ContentStatus } from "@/lib/content-flow";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { CONTENT_STATUS } from "@/lib/labels";
import { notify } from "@/lib/notifications";

const Move = z.object({
  contentId: z.uuid(),
  to: z.enum(Object.keys(CONTENT_STEPS) as [ContentStatus, ...ContentStatus[]]),
  note: z.string().max(500).optional(),
});

/** Move a post one step through the workflow and tell whoever is next. */
export async function moveContent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Move.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const { contentId, to, note } = parsed.data;

  const db = getDb();
  const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, contentId));
  if (!item) return { ok: false, error: "Content not found." };
  const step = CONTENT_STEPS[item.status].find((s) => s.to === to);
  if (!step) return { ok: false, error: "This post has moved on — refresh the page." };
  if (!canTakeStep(step, user.role, user.id, item.designerId)) return { ok: false, error: "This step belongs to someone else." };
  if (step.needsNote && !note) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { note: "Tell the designer what to change." } };

  await db.update(schema.contentItems).set({ status: to }).where(eq(schema.contentItems.id, item.id));
  await audit({ actorId: user.id, action: "update", entity: "content", entityId: item.title, changes: { status: [item.status, to], ...(note ? { note } : {}) } });

  const link = "/marketing/content";
  const label = CONTENT_STATUS[to].label;
  if ((to === "ready_for_design" || to === "revision") && item.designerId && item.designerId !== user.id) {
    await notify({
      userIds: [item.designerId],
      type: "content.your_turn",
      title: to === "revision" ? `Revision needed: ${item.title}` : `Ready for design: ${item.title}`,
      body: note ?? `From ${user.name}`,
      link,
    });
  } else if (to === "in_review" && item.writerId && item.writerId !== user.id) {
    await notify({ userIds: [item.writerId], type: "content.your_turn", title: `Ready to review: ${item.title}`, body: `Design by ${user.name}`, link });
  } else if (to === "approved" && item.designerId && item.designerId !== user.id) {
    await notify({ userIds: [item.designerId], type: "content.update", title: `Approved: ${item.title}`, body: `By ${user.name}`, link });
  } else if (to === "published" && item.writerId && item.writerId !== user.id) {
    await notify({ userIds: [item.writerId], type: "content.update", title: `${label}: ${item.title}`, link });
  }
  refresh();
  return { ok: true };
}
