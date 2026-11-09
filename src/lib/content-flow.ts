/**
 * Content calendar workflow: who may move a post to which status, and who
 * gets told. Writers = Marketing; Designers = the assigned designer.
 */
export type ContentStatus =
  | "draft_brief"
  | "ready_for_design"
  | "in_design"
  | "in_review"
  | "revision"
  | "approved"
  | "scheduled"
  | "published";

type Side = "writer" | "designer";
export type ContentStep = { to: ContentStatus; label: string; side: Side; needsNote?: boolean };

export const CONTENT_STEPS: Record<ContentStatus, ContentStep[]> = {
  draft_brief: [{ to: "ready_for_design", label: "Send to design", side: "writer" }],
  ready_for_design: [{ to: "in_design", label: "Start design", side: "designer" }],
  in_design: [{ to: "in_review", label: "Submit for review", side: "designer" }],
  revision: [{ to: "in_review", label: "Resubmit for review", side: "designer" }],
  in_review: [
    { to: "approved", label: "Approve", side: "writer" },
    { to: "revision", label: "Request revision", side: "writer", needsNote: true },
  ],
  approved: [{ to: "scheduled", label: "Schedule", side: "writer" }],
  scheduled: [{ to: "published", label: "Mark published", side: "writer" }],
  published: [],
};

/** Writer side: Marketing, Sales Manager, Admin. Designer side: the assigned designer or Admin. */
export function canTakeStep(step: ContentStep, role: string, userId: string, designerId: string | null): boolean {
  if (role === "admin") return true;
  if (step.side === "writer") return role === "marketing" || role === "sales_manager";
  return role === "designer" && designerId === userId;
}
