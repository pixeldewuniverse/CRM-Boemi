"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { LOST_REASONS, STAGE, STAGES } from "@/lib/labels";
import { notify } from "@/lib/notifications";

const MANAGES = ["admin", "sales_manager"];

const Input = z.object({
  dealId: z.uuid(),
  stage: z.enum(STAGES),
  lostReason: z.enum(LOST_REASONS).optional(),
});

export type MoveResult = { ok: true } | { ok: false; error: string };

/** Drag a deal to another stage. Owners move their own deals; managers move any. */
export async function moveDeal(input: z.input<typeof Input>): Promise<MoveResult> {
  const user = await verifyUser();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move." };
  const { dealId, stage, lostReason } = parsed.data;
  if (stage === "lost" && !lostReason) return { ok: false, error: "Choose a lost reason." };

  const db = getDb();
  const o = schema.opportunities;
  const [deal] = await db.select({ ownerId: o.ownerId, stage: o.stage, title: o.title }).from(o).where(eq(o.id, dealId));
  if (!deal) return { ok: false, error: "Deal not found." };
  if (deal.ownerId !== user.id && !MANAGES.includes(user.role)) {
    return { ok: false, error: "Only the deal owner or a sales manager can move this deal." };
  }
  if (deal.stage === stage) return { ok: true };

  await db
    .update(o)
    .set({ stage, probability: STAGE[stage].probability, lostReason: stage === "lost" ? lostReason : null })
    .where(eq(o.id, dealId));

  await audit({
    actorId: user.id,
    action: "update",
    entity: "opportunity",
    entityId: deal.title,
    changes: { stage: [deal.stage, stage], ...(lostReason ? { reason: lostReason } : {}) },
  });
  if (deal.ownerId !== user.id) {
    await notify({
      userIds: [deal.ownerId],
      type: "opportunity.stage_changed",
      title: `${deal.title} moved to ${STAGE[stage].label}`,
      body: `Moved by ${user.name}.`,
      link: "/sales/pipeline",
    });
  }
  refresh();
  return { ok: true };
}
