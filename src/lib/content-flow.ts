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

export const CONTENT_CHANNELS = ["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube", "Email", "Website", "WhatsApp"] as const;
export const CONTENT_FORMATS = ["Feed", "Carousel", "Reels", "Story", "Video", "Post", "Newsletter", "Article"] as const;

/** Writer side: plans briefs, edits, reschedules, reviews. */
export const isWriter = (role: string) => role === "admin" || role === "marketing" || role === "sales_manager";

/** May edit the brief / move the date / add references (anything but a published post). */
export const canEditBrief = (role: string, status: ContentStatus) => isWriter(role) && status !== "published";

/** Drafts can be deleted by the writer side; Super Admin may delete any post. */
export const canDeleteContent = (role: string, status: ContentStatus) => role === "admin" || (isWriter(role) && status === "draft_brief");

/** Design results: the assigned designer (or Super Admin) while the post is with design. */
export const DESIGN_OPEN: ContentStatus[] = ["ready_for_design", "in_design", "revision"];
export const canUploadDesign = (role: string, userId: string, designerId: string | null, status: ContentStatus) =>
  DESIGN_OPEN.includes(status) && (role === "admin" || (role === "designer" && designerId === userId));

/** Comments: writer side and the assigned designer. Everyone else reads. */
export const canComment = (role: string, userId: string, designerId: string | null) => isWriter(role) || (role === "designer" && designerId === userId);

export const MAX_CONTENT_FILE_MB = 4;
