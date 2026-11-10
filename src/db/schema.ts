/**
 * Sales & Marketing Tools — Phase 1 database schema.
 *
 * Plain PostgreSQL only (no provider-specific features) so the same
 * migrations run on Neon (staging) and Cloud SQL for PostgreSQL (production).
 * Money is stored as whole Rupiah in bigint.
 */
import { relations, sql } from "drizzle-orm";
import { ROLES } from "../lib/roles";
import {
  type AnyPgColumn,
  primaryKey,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ───────────────────────── Enums ───────────────────────── */

export const roleEnum = pgEnum("role", ROLES);

export const customerStatusEnum = pgEnum("customer_status", [
  "lead",
  "prospect",
  "active",
  "inactive",
]);

export const leadTierEnum = pgEnum("lead_tier", ["hot", "warm", "cold"]);

export const visitStatusEnum = pgEnum("visit_status", [
  "planned",
  "checked_in",
  "completed",
  "cancelled",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "in_progress",
  "waiting_approval",
  "done",
  "cancelled",
]);

export const opportunityStageEnum = pgEnum("opportunity_stage", [
  "new",
  "contacted",
  "sampling",
  "quotation",
  "negotiation",
  "won",
  "lost",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
]);

export const paymentStatusEnum = pgEnum("payment_status", ["unpaid", "deposit", "paid"]);

export const deliveryStatusEnum = pgEnum("delivery_status", ["pending", "shipped", "delivered"]);

export const paymentKindEnum = pgEnum("payment_kind", ["deposit", "settlement", "other"]);

export const approvalNeedEnum = pgEnum("quote_approval", ["not_required", "pending", "approved", "rejected"]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "disqualified",
]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
]);

export const campaignStatusEnum = pgEnum("campaign_status", ["scheduled", "running", "done"]);

export const eventStatusEnum = pgEnum("event_status", ["scheduled", "running", "done", "cancelled"]);

export const eventLeadStatusEnum = pgEnum("event_lead_status", ["new", "converted", "not_relevant"]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft_brief",
  "ready_for_design",
  "in_design",
  "in_review",
  "revision",
  "approved",
  "scheduled",
  "published",
]);

export const criteriaOperatorEnum = pgEnum("criteria_operator", [
  "equals",
  "not_equals",
  "in",
  "gte",
  "lte",
  "contains",
  "exists",
]);

/* ───────────────────── Shared columns ───────────────────── */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const rupiah = (name: string) => bigint(name, { mode: "number" });

/* ───────────────────── Users & access ───────────────────── */

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"), // null once the user signs in with Google Workspace only
    role: roleEnum("role").notNull().default("sales"),
    managerId: uuid("manager_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    phone: text("phone"),
    region: text("region"),
    position: text("position"),
    department: text("department"),
    joinedOn: date("joined_on"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "set null" }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // "password" now; "google" once Google Workspace sign-in is on (password_hash stays null).
    authProvider: text("auth_provider").notNull().default("password"),
    googleSub: text("google_sub"),
    avatarKey: text("avatar_key"), // profile photo, object key in storage
    // Bumped on password change: sessions signed with an older version are signed out.
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_department_idx").on(t.departmentId), index("users_manager_idx").on(t.managerId)],
);

/** Departments & teams. A Department Head / Manager sees the data of everyone in their department. */
export const departments = pgTable("departments", {
  id: id(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  headUserId: uuid("head_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => departments.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────── Customers, contacts, leads ───────────────── */

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  channel: text("channel"), // event, instagram, website, journey, referral…
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  budget: rupiah("budget"),
  ownerId: uuid("owner_id").references(() => users.id),
  type: text("type"), // product launch, outbound, corporate gifting, brand / CSR…
  status: campaignStatusEnum("status").notNull().default("scheduled"),
  resultLeads: integer("result_leads").notNull().default(0),
  resultRevenue: rupiah("result_revenue").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text("name").notNull(),
    businessType: text("business_type"),
    status: customerStatusEnum("status").notNull().default("lead"),
    phoneE164: text("phone_e164"), // normalised +62… used for de-duplication
    email: text("email"),
    instagram: text("instagram"),
    birthday: date("birthday"),
    address: text("address"),
    city: text("city"),
    region: text("region"),
    ownerId: uuid("owner_id").references(() => users.id),

    // Attribution
    source: text("source"), // e.g. "journey", "website", "event", "import"
    sourceDetail: text("source_detail"),
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    externalRef: text("external_ref"), // id in the source system, makes webhooks idempotent

    // Consent (UU PDP)
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),

    // Interests captured by forms (e.g. journey aroma result, product preference)
    interests: jsonb("interests").$type<Record<string, unknown>>(),

    // AI / rule-based qualification
    qualificationScore: integer("qualification_score"),
    qualificationTier: leadTierEnum("qualification_tier"),
    qualificationReason: text("qualification_reason"),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customers_owner_idx").on(t.ownerId),
    index("customers_phone_idx").on(t.phoneE164),
    index("customers_email_idx").on(sql`lower(${t.email})`),
    index("customers_tier_idx").on(t.qualificationTier),
    uniqueIndex("customers_source_ref_uq").on(t.source, t.externalRef),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: text("position"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_customer_idx").on(t.customerId)],
);

/** Client-defined rules used to score/qualify customers. */
export const qualificationCriteria = pgTable("qualification_criteria", {
  id: id(),
  name: text("name").notNull(),
  field: text("field").notNull(), // customer field or interests.<key>
  operator: criteriaOperatorEnum("operator").notNull(),
  value: jsonb("value").$type<unknown>(),
  weight: integer("weight").notNull().default(10),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────── Sales activities ───────────────────── */

export const visits = pgTable(
  "visits",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    salesId: uuid("sales_id")
      .notNull()
      .references(() => users.id),
    status: visitStatusEnum("status").notNull().default("planned"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    photoKey: text("photo_key"), // object key in storage (Blob / GCS)
    purpose: text("purpose"),
    notes: text("notes"),
    outcome: text("outcome"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("visits_customer_idx").on(t.customerId),
    index("visits_sales_idx").on(t.salesId, t.scheduledAt),
  ],
);

export const visitFees = pgTable(
  "visit_fees",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    amount: rupiah("amount").notNull(),
    description: text("description"),
    receiptKey: text("receipt_key"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("visit_fees_status_idx").on(t.status)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    visitId: uuid("visit_id").references(() => visits.id, {
      onDelete: "set null",
    }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    type: text("type"), // follow-up, call, whatsapp, email, visit, meeting, send samples, brief, design
    status: taskStatusEnum("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId, t.status, t.dueAt),
    index("tasks_customer_idx").on(t.customerId),
  ],
);

/* ───────────────── Products, pipeline, orders ───────────────── */

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    variant: text("variant"), // pack size, e.g. 250 ml
    unit: text("unit").notNull().default("pcs"), // selling unit: pcs, bottle, box, jerrycan…
    price: rupiah("price"), // retail price; tier prices are derived
    stock: integer("stock").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("products_sku_uq").on(t.sku)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    stage: opportunityStageEnum("stage").notNull().default("new"),
    value: rupiah("value"),
    probability: integer("probability"),
    expectedCloseOn: date("expected_close_on"),
    lostReason: text("lost_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opportunities_owner_stage_idx").on(t.ownerId, t.stage),
    index("opportunities_customer_idx").on(t.customerId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNo: text("order_no").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    salesId: uuid("sales_id").references(() => users.id),
    status: orderStatusEnum("status").notNull().default("confirmed"),
    orderedAt: timestamp("ordered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    subtotal: rupiah("subtotal").notNull().default(0),
    discountPct: doublePrecision("discount_pct").notNull().default(0),
    ppn: boolean("ppn").notNull().default(true),
    taxAmount: rupiah("tax_amount").notNull().default(0),
    total: rupiah("total").notNull().default(0),
    depositPct: integer("deposit_pct").notNull().default(0),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
    paidAmount: rupiah("paid_amount").notNull().default(0),
    reference: text("reference"),
    channel: text("channel"),
    notes: text("notes"),
    quotationId: uuid("quotation_id").references((): AnyPgColumn => quotations.id, { onDelete: "set null" }),
    deliveryStatus: deliveryStatusEnum("delivery_status").notNull().default("pending"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
    uniqueIndex("orders_quotation_uq").on(t.quotationId).where(sql`${t.quotationId} is not null`),
    index("orders_customer_idx").on(t.customerId, t.orderedAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: rupiah("unit_price").notNull().default(0),
    subtotal: rupiah("subtotal").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** Deposits and settlements; orders.paid_amount / payment_status are derived from these. */
export const orderPayments = pgTable(
  "order_payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: paymentKindEnum("kind").notNull().default("settlement"),
    amount: rupiah("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    method: text("method"), // transfer, cash, QRIS…
    reference: text("reference"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("order_payments_order_idx").on(t.orderId)],
);

/* ─────────────────────────── Leads ─────────────────────────── */

/** New prospects before they become an Account + Deal. */
export const leads = pgTable(
  "leads",
  {
    id: id(),
    company: text("company").notNull(),
    picName: text("pic_name"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    segment: text("segment"),
    city: text("city"),
    source: text("source").notNull(), // required for attribution
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    ownerId: uuid("owner_id").references(() => users.id),
    status: leadStatusEnum("status").notNull().default("new"),
    note: text("note"),
    disqualifyReason: text("disqualify_reason"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    qualificationScore: integer("qualification_score"),
    qualificationTier: leadTierEnum("qualification_tier"),
    qualificationReason: text("qualification_reason"),
    receivedOn: date("received_on").notNull().defaultNow(),
    // From other BOEMI systems (e.g. the aroma journey site)
    externalSource: text("external_source"),
    externalRef: text("external_ref"),
    instagram: text("instagram"),
    birthday: date("birthday"),
    interests: jsonb("interests").$type<Record<string, unknown>>(),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_owner_status_idx").on(t.ownerId, t.status),
    index("leads_source_idx").on(t.source),
    uniqueIndex("leads_external_uq").on(t.externalSource, t.externalRef).where(sql`${t.externalRef} is not null`),
  ],
);

/* ───────────────────────── Quotations ───────────────────────── */

export const quotations = pgTable(
  "quotations",
  {
    id: id(),
    quoteNo: text("quote_no").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    ownerId: uuid("owner_id").references(() => users.id),
    status: quoteStatusEnum("status").notNull().default("draft"),
    issuedOn: date("issued_on").notNull(),
    validUntil: date("valid_until"),
    priceTier: text("price_tier"),
    subtotal: rupiah("subtotal").notNull().default(0),
    discountPct: doublePrecision("discount_pct").notNull().default(0),
    ppn: boolean("ppn").notNull().default(true),
    taxAmount: rupiah("tax_amount").notNull().default(0),
    total: rupiah("total").notNull().default(0),
    notes: text("notes"),
    terms: text("terms"),
    // Discount above the role's limit needs a manager's approval before sending.
    approval: approvalNeedEnum("approval").notNull().default("not_required"),
    approvalNote: text("approval_note"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("quotations_quote_no_uq").on(t.quoteNo),
    index("quotations_customer_idx").on(t.customerId),
  ],
);

export const quotationItems = pgTable(
  "quotation_items",
  {
    id: id(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: rupiah("unit_price").notNull().default(0),
    subtotal: rupiah("subtotal").notNull().default(0),
  },
  (t) => [index("quotation_items_quote_idx").on(t.quotationId)],
);

/* ─────────────────────────── Events ─────────────────────────── */

export const events = pgTable("events", {
  id: id(),
  name: text("name").notNull(),
  type: text("type"), // B2B exhibition, pop-up, brand / CSR
  heldOn: date("held_on").notNull(),
  location: text("location"),
  status: eventStatusEnum("status").notNull().default("scheduled"),
  budget: rupiah("budget").notNull().default(0),
  actualCost: rupiah("actual_cost").notNull().default(0),
  visitors: integer("visitors").notNull().default(0),
  leadsCount: integer("leads_count").notNull().default(0),
  dealsCount: integer("deals_count").notNull().default(0),
  revenue: rupiah("revenue").notNull().default(0),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  ownerId: uuid("owner_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Contacts collected at a booth, before they become leads. */
export const eventLeads = pgTable(
  "event_leads",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    segment: text("segment"),
    phoneE164: text("phone_e164"),
    interest: text("interest"),
    status: eventLeadStatusEnum("status").notNull().default("new"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("event_leads_event_idx").on(t.eventId)],
);

/* ────────────────────── Content calendar ────────────────────── */

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    title: text("title").notNull(),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
    format: text("format"), // Reels, Carousel, Feed, Story, Video, Newsletter, Post
    status: contentStatusEnum("status").notNull().default("draft_brief"),
    writerId: uuid("writer_id").references(() => users.id),
    designerId: uuid("designer_id").references(() => users.id),
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    objective: text("objective"),
    keyMessage: text("key_message"),
    caption: text("caption"),
    cta: text("cta"),
    hashtags: text("hashtags"),
    products: text("products"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_items_publish_idx").on(t.publishAt)],
);

/* ──────────────────────── Activity log ──────────────────────── */

/**
 * Things that already happened with an account (call, WhatsApp, email,
 * meeting, note). Separate from tasks, which are future to-dos with owners,
 * due dates and reminders.
 */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("activities_customer_idx").on(t.customerId, t.occurredAt), index("activities_user_idx").on(t.userId, t.occurredAt)],
);

/* ───────────────────── Settings & numbering ───────────────────── */

/** Small typed settings (validated in src/lib/settings.ts), e.g. document templates. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updatedAt(),
});

/** Running number per document type and period (YYYYMM, YYYY or "all"). */
export const documentCounters = pgTable(
  "document_counters",
  {
    docType: text("doc_type").notNull(),
    period: text("period").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.docType, t.period] })],
);

/* ─────────────────────── Approval engine ─────────────────────── */

export const approvalRequestStatusEnum = pgEnum("approval_request_status", ["pending", "approved", "rejected", "cancelled"]);
export const approvalStepStatusEnum = pgEnum("approval_step_status", ["waiting", "pending", "approved", "rejected", "skipped"]);

/** Which steps a request of one type goes through (first active match by amount range, then priority). */
export const approvalFlows = pgTable(
  "approval_flows",
  {
    id: id(),
    entityType: text("entity_type").notNull(), // visit_fee | quotation_discount | project | project_budget | purchase_request
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    minAmount: bigint("min_amount", { mode: "number" }),
    maxAmount: bigint("max_amount", { mode: "number" }),
    priority: integer("priority").notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approval_flows_entity_idx").on(t.entityType, t.active)],
);

export const approvalFlowSteps = pgTable(
  "approval_flow_steps",
  {
    id: id(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => approvalFlows.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    // role (any user with one of `roles`) | user | direct_manager | department_head
    approverType: text("approver_type").notNull(),
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    label: text("label"),
  },
  (t) => [index("approval_flow_steps_flow_idx").on(t.flowId, t.position)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    flowId: uuid("flow_id").references(() => approvalFlows.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    title: text("title").notNull(),
    link: text("link"),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    currentStep: integer("current_step").notNull().default(1),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approval_requests_entity_idx").on(t.entityType, t.entityId), index("approval_requests_status_idx").on(t.status)],
);

/** One row per step of a request; steps are copied from the flow when the request is made. */
export const approvalActions = pgTable(
  "approval_actions",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    approverType: text("approver_type").notNull(),
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Resolved when the step becomes current.
    approverIds: uuid("approver_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: approvalStepStatusEnum("status").notNull().default("waiting"),
    decidedBy: uuid("decided_by").references(() => users.id),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approval_actions_request_idx").on(t.requestId, t.position)],
);

/* ─────────────────────────── KPI ─────────────────────────── */

export const kpiTargets = pgTable(
  "kpi_targets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(), // visits, new_customers, revenue, orders…
    period: text("period").notNull(), // e.g. 2026-11
    target: bigint("target", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("kpi_targets_uq").on(t.userId, t.metric, t.period)],
);

/* ─────────────────────── Notifications ─────────────────────── */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // task.assigned, task.due, visit_fee.pending…
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    push: boolean("push").notNull().default(true),
  },
  (t) => [uniqueIndex("notification_prefs_uq").on(t.userId, t.type)],
);

/** One row per browser/device that allowed push notifications (Web Push, VAPID). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    device: text("device"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/* ───────────────────────── Audit trail ───────────────────────── */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(), // create, update, delete, approve, login…
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entity, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

/* ───────────────────────── Relations ───────────────────────── */

export const usersRelations = relations(users, ({ many, one }) => ({
  manager: one(users, { fields: [users.managerId], references: [users.id] }),
  customers: many(customers),
  tasks: many(tasks),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  owner: one(users, { fields: [customers.ownerId], references: [users.id] }),
  campaign: one(campaigns, {
    fields: [customers.campaignId],
    references: [campaigns.id],
  }),
  contacts: many(contacts),
  visits: many(visits),
  tasks: many(tasks),
  opportunities: many(opportunities),
  orders: many(orders),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  customer: one(customers, {
    fields: [contacts.customerId],
    references: [customers.id],
  }),
}));

export const visitsRelations = relations(visits, ({ one, many }) => ({
  customer: one(customers, {
    fields: [visits.customerId],
    references: [customers.id],
  }),
  sales: one(users, { fields: [visits.salesId], references: [users.id] }),
  fees: many(visitFees),
}));

export const visitFeesRelations = relations(visitFees, ({ one }) => ({
  visit: one(visits, { fields: [visitFees.visitId], references: [visits.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  customer: one(customers, {
    fields: [tasks.customerId],
    references: [customers.id],
  }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one }) => ({
  customer: one(customers, {
    fields: [opportunities.customerId],
    references: [customers.id],
  }),
  owner: one(users, { fields: [opportunities.ownerId], references: [users.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));
