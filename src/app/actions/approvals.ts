"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { decide } from "@/lib/approvals";
import { verifyUser } from "@/lib/auth";
import { formObject, type FormState } from "@/lib/forms";

const Decision = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

/** Approve / reject the current step of a request (inbox at /approvals). Rights are checked in decide(). */
export async function decideApproval(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Decision.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { requestId, decision, note } = parsed.data;
  if (decision === "rejected" && !note) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { note: "Tell the requester why." } };
  const res = await decide(user, requestId, decision, note);
  if (!res.ok) return { ok: false, error: res.error };
  refresh();
  return { ok: true, message: res.final === null ? "Approved — sent to the next approver." : decision === "approved" ? "Approved." : "Rejected." };
}
