CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."criteria_operator" AS ENUM('equals', 'not_equals', 'in', 'gte', 'lte', 'contains', 'exists');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('lead', 'prospect', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."lead_tier" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'executive', 'sales_manager', 'sales', 'marketing', 'finance');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('planned', 'checked_in', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text,
	"starts_on" date,
	"ends_on" date,
	"budget" bigint,
	"owner_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"phone_e164" text,
	"email" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_type" text,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"phone_e164" text,
	"email" text,
	"instagram" text,
	"birthday" date,
	"address" text,
	"city" text,
	"region" text,
	"owner_id" uuid,
	"source" text,
	"source_detail" text,
	"campaign_id" uuid,
	"external_ref" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"interests" jsonb,
	"qualification_score" integer,
	"qualification_tier" "lead_tier",
	"qualification_reason" text,
	"qualified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"target" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"stage" "opportunity_stage" DEFAULT 'new' NOT NULL,
	"value" bigint,
	"probability" integer,
	"expected_close_on" date,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"sales_id" uuid,
	"status" "order_status" DEFAULT 'confirmed' NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"channel" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"variant" text,
	"price" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"field" text NOT NULL,
	"operator" "criteria_operator" NOT NULL,
	"value" jsonb,
	"weight" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"customer_id" uuid,
	"visit_id" uuid,
	"assignee_id" uuid NOT NULL,
	"created_by" uuid,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" "role" DEFAULT 'sales' NOT NULL,
	"manager_id" uuid,
	"phone" text,
	"region" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"description" text,
	"receipt_key" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_id" uuid NOT NULL,
	"status" "visit_status" DEFAULT 'planned' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"latitude" double precision,
	"longitude" double precision,
	"photo_key" text,
	"purpose" text,
	"notes" text,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_id_users_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_fees" ADD CONSTRAINT "visit_fees_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_fees" ADD CONSTRAINT "visit_fees_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_fees" ADD CONSTRAINT "visit_fees_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_sales_id_users_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contacts_customer_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_owner_idx" ON "customers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "customers_tier_idx" ON "customers" USING btree ("qualification_tier");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_source_ref_uq" ON "customers" USING btree ("source","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_uq" ON "kpi_targets" USING btree ("user_id","metric","period");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_uq" ON "notification_preferences" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_owner_stage_idx" ON "opportunities" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "opportunities_customer_idx" ON "opportunities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_no_uq" ON "orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","ordered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_customer_idx" ON "tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "visit_fees_status_idx" ON "visit_fees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "visits_customer_idx" ON "visits" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "visits_sales_idx" ON "visits" USING btree ("sales_id","scheduled_at");