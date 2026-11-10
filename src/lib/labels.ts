/** Display labels + tones for every status used in the UI. */
export type Tone = "neutral" | "info" | "accent" | "ok" | "warn" | "bad";

type Def = { label: string; tone: Tone };
const d = (label: string, tone: Tone): Def => ({ label, tone });

export const LEAD_STATUS: Record<string, Def> = {
  new: d("New", "info"),
  contacted: d("Contacted", "accent"),
  qualified: d("Qualified", "ok"),
  disqualified: d("Disqualified", "bad"),
};

export const STAGES = ["new", "contacted", "sampling", "quotation", "negotiation", "won", "lost"] as const;
export const STAGE: Record<string, Def & { probability: number }> = {
  new: { ...d("New", "info"), probability: 10 },
  contacted: { ...d("Contacted", "accent"), probability: 20 },
  sampling: { ...d("Sampling / Trial", "accent"), probability: 35 },
  quotation: { ...d("Quotation Sent", "info"), probability: 55 },
  negotiation: { ...d("Negotiation", "warn"), probability: 75 },
  won: { ...d("Won", "ok"), probability: 100 },
  lost: { ...d("Lost", "bad"), probability: 0 },
};

export const QUOTE_STATUS: Record<string, Def> = {
  draft: d("Draft", "neutral"),
  sent: d("Sent", "info"),
  accepted: d("Accepted", "ok"),
  rejected: d("Rejected", "bad"),
  expired: d("Expired", "neutral"),
};

/** Order statuses used from now on (shipping is tracked separately). */
export const ORDER_FLOW = ["draft", "confirmed", "processing", "completed", "cancelled"] as const;
export const DELIVERY_STATUS: Record<string, Def> = {
  pending: d("Not shipped", "neutral"),
  shipped: d("Shipped", "accent"),
  delivered: d("Delivered", "ok"),
};
export const PAYMENT_KIND: Record<string, Def> = {
  deposit: d("Deposit", "warn"),
  settlement: d("Settlement", "ok"),
  other: d("Other", "neutral"),
};
export const PAYMENT_METHODS = ["Transfer", "Cash", "QRIS", "Card", "Giro"] as const;
export const QUOTE_APPROVAL: Record<string, Def> = {
  not_required: d("No approval needed", "neutral"),
  pending: d("Discount approval pending", "warn"),
  approved: d("Discount approved", "ok"),
  rejected: d("Discount rejected", "bad"),
};

export const ORDER_STATUS: Record<string, Def> = {
  draft: d("Draft", "neutral"),
  confirmed: d("Confirmed", "info"),
  processing: d("Processing", "warn"),
  shipped: d("Shipped", "accent"),
  delivered: d("Delivered", "accent"),
  completed: d("Completed", "ok"),
  cancelled: d("Cancelled", "bad"),
};

export const PAYMENT_STATUS: Record<string, Def> = {
  unpaid: d("Unpaid", "bad"),
  deposit: d("Deposit", "warn"),
  paid: d("Paid", "ok"),
};

export const FEE_STATUS: Record<string, Def> = {
  pending: d("Pending", "warn"),
  approved: d("Approved", "ok"),
  rejected: d("Rejected", "bad"),
  paid: d("Paid", "ok"),
};

export const TASK_COLUMNS = ["open", "in_progress", "waiting_approval", "done"] as const;
export const TASK_STATUS: Record<string, Def> = {
  open: d("To do", "neutral"),
  in_progress: d("In progress", "info"),
  waiting_approval: d("Waiting approval", "warn"),
  done: d("Done", "ok"),
  cancelled: d("Cancelled", "bad"),
};

export const CAMPAIGN_STATUS: Record<string, Def> = {
  scheduled: d("Scheduled", "info"),
  running: d("Running", "ok"),
  done: d("Done", "neutral"),
};

export const EVENT_STATUS: Record<string, Def> = {
  scheduled: d("Scheduled", "info"),
  running: d("Running", "ok"),
  done: d("Done", "neutral"),
  cancelled: d("Cancelled", "bad"),
};

export const EVENT_LEAD_STATUS: Record<string, Def> = {
  new: d("New", "info"),
  converted: d("Converted", "ok"),
  not_relevant: d("Not relevant", "neutral"),
};

export const CONTENT_FLOW = [
  "draft_brief",
  "ready_for_design",
  "in_design",
  "in_review",
  "revision",
  "approved",
  "scheduled",
  "published",
] as const;
export const CONTENT_STATUS: Record<string, Def> = {
  draft_brief: d("Draft brief", "neutral"),
  ready_for_design: d("Ready for design", "info"),
  in_design: d("In design", "accent"),
  in_review: d("In review", "warn"),
  revision: d("Revision", "bad"),
  approved: d("Approved", "ok"),
  scheduled: d("Scheduled", "info"),
  published: d("Published", "ok"),
};

export const CUSTOMER_STATUS: Record<string, Def> = {
  lead: d("Lead", "info"),
  prospect: d("Prospect", "accent"),
  active: d("Active", "ok"),
  inactive: d("Inactive", "neutral"),
};

/** Segments double as sales channels in reports. */
export const SEGMENTS = ["Hotel & Spa", "Retail Partner", "Corporate Gift", "Online & Event"] as const;
export const LEAD_SOURCES = ["Website", "Instagram", "WhatsApp", "Referral", "Event / Exhibition", "Walk-in Store", "Aroma journey", "Import"] as const;
export const LOST_REASONS = ["Price too high", "Chose a competitor", "No budget yet", "Unresponsive", "Other"] as const;
export const ACTIVITY_TYPES = ["Follow-up", "Call", "WhatsApp", "Email", "Visit", "Meeting", "Send samples", "Brief", "Design"] as const;
export const DISQUALIFY_REASONS = ["No budget", "Not a fit", "Unresponsive", "Duplicate", "Other"] as const;
export const VISIT_PURPOSES = ["Account visit", "Product demo", "Sample delivery", "Restock check", "Payment collection", "Complaint handling"] as const;
export const ACTIVITY_LOG_TYPES = ["Call", "WhatsApp", "Email", "Meeting", "Note"] as const;
export const TARGET_METRICS = {
  revenue: { label: "Revenue", money: true },
  orders: { label: "Orders", money: false },
  visits: { label: "Visits", money: false },
  new_customers: { label: "New customers", money: false },
} as const;
export type TargetMetric = keyof typeof TARGET_METRICS;
export const PRODUCT_UNITS = ["pcs", "bottle", "jar", "box", "pack", "jerrycan", "set"] as const;
export const CAMPAIGN_TYPES = ["Product launch", "Outbound", "Corporate gifting", "Brand / CSR", "Promotion", "Content"] as const;
export const EVENT_TYPES = ["B2B exhibition", "Pop-up", "Brand / CSR", "Workshop", "Sampling"] as const;
