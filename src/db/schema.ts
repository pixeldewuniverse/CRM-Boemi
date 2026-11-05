/**
 * Sales & Marketing Tools — Phase 1 database schema.
 *
 * Plain PostgreSQL only (no provider-specific features) so the same
 * migrations run on Neon (staging) and Cloud SQL for PostgreSQL (production).
 * Money is stored as whole Rupiah in bigint.
 */
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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

export const roleEnum = pgEnum("role", [
  "admin",
  "executive",
  "sales_manager",
  "sales",
  "marketing",
  "finance",
]);

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
  "done",
  "cancelled",
]);

export const opportunityStageEnum = pgEnum("opportunity_stage", [
  "new",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "confirmed",
  "delivered",
  "cancelled",
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
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

/* ───────────────── Customers, contacts, leads ───────────────── */

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  channel: text("channel"), // event, instagram, website, journey, referral…
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  budget: rupiah("budget"),
  ownerId: uuid("owner_id").references(() => users.id),
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
    variant: text("variant"),
    price: rupiah("price"),
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
    total: rupiah("total").notNull().default(0),
    channel: text("channel"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
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
  },
  (t) => [uniqueIndex("notification_prefs_uq").on(t.userId, t.type)],
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
