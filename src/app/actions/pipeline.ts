"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { mayManage } from "@/lib/scope";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { LOST_REASONS, STAGE, STAGES } from "@/lib/labels";
import { canSell, isManager } from "@/lib/permissions";
import { customerScope } from "@/lib/customers";
import { and } from "drizzle-orm";
import { notify } from "@/lib/notifications";
import { managersOf } from "@/lib/notifications/recipients";
import { rp } from "@/lib/format";


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
  const [deal] = await db
    .select({ ownerId: o.ownerId, stage: o.stage, title: o.title, value: o.value, account: schema.customers.name })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .where(eq(o.id, dealId));
  if (!deal) return { ok: false, error: "Deal not found." };
  if (!(await mayManage(user, deal.ownerId))) {
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
  if (stage === "won" || stage === "lost") {
    await notify({
      userIds: await managersOf(deal.ownerId, [user.id]),
      type: stage === "won" ? "deal.won" : "deal.lost",
      title: stage === "won" ? `Deal won: ${deal.title}` : `Deal lost: ${deal.title}`,
      body: `${deal.account} · ${rp(deal.value ?? 0)}${stage === "lost" && lostReason ? ` · ${lostReason}` : ""}`,
      link: "/sales/pipeline",
    });
  }
  refresh();
  return { ok: true };
}

const Deal = z.object({
  accountId: z.uuid("Choose an account."),
  title: z.string("Give the deal a short title.").min(3, "Give the deal a short title.").max(160),
  stage: z.enum(STAGES).default("new"),
  value: z.string().optional(),
  closeOn: z.iso.date("Pick a date.").optional(),
  ownerId: z.uuid().optional(),
});

export async function createDeal(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't add deals." };
  const parsed = Deal.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  if (d.stage === "lost") return { ok: false, error: "Create the deal first, then drag it to Lost with a reason." };
  const [account] = await getDb()
    .select({ id: schema.customers.id, name: schema.customers.name, ownerId: schema.customers.ownerId })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, d.accountId), customerScope(user)));
  if (!account) return { ok: false, error: "Account not found.", fieldErrors: { accountId: "Choose one of your accounts." } };

  const ownerId = isManager(user) ? (d.ownerId ?? account.ownerId ?? user.id) : user.id;
  await getDb().insert(schema.opportunities).values({
    customerId: account.id,
    ownerId,
    title: d.title,
    stage: d.stage,
    probability: STAGE[d.stage].probability,
    value: parseRupiah(d.value) ?? 0,
    expectedCloseOn: d.closeOn,
  });
  await audit({ actorId: user.id, action: "create", entity: "opportunity", entityId: d.title, changes: { account: account.name, stage: d.stage } });
  refresh();
  return { ok: true, message: `Deal ${d.title} added.` };
}
