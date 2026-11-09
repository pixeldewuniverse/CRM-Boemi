CREATE TYPE "public"."campaign_status" AS ENUM('scheduled', 'running', 'done');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft_brief', 'ready_for_design', 'in_design', 'in_review', 'revision', 'approved', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."event_lead_status" AS ENUM('new', 'converted', 'not_relevant');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'running', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'deposit', 'paid');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'processing' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'shipped' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'completed' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'waiting_approval' BEFORE 'done';--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"format" text,
	"status" "content_status" DEFAULT 'draft_brief' NOT NULL,
	"writer_id" uuid,
	"designer_id" uuid,
	"campaign_id" uuid,
	"objective" text,
	"key_message" text,
	"caption" text,
	"cta" text,
	"hashtags" text,
	"products" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"segment" text,
	"phone_e164" text,
	"interest" text,
	"status" "event_lead_status" DEFAULT 'new' NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"held_on" date NOT NULL,
	"location" text,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"budget" bigint DEFAULT 0 NOT NULL,
	"actual_cost" bigint DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"leads_count" integer DEFAULT 0 NOT NULL,
	"deals_count" integer DEFAULT 0 NOT NULL,
	"revenue" bigint DEFAULT 0 NOT NULL,
	"campaign_id" uuid,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"pic_name" text,
	"phone_e164" text,
	"email" text,
	"segment" text,
	"city" text,
	"source" text NOT NULL,
	"campaign_id" uuid,
	"owner_id" uuid,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"note" text,
	"disqualify_reason" text,
	"customer_id" uuid,
	"qualification_score" integer,
	"qualification_tier" "lead_tier",
	"qualification_reason" text,
	"received_on" date DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"product_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_no" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"owner_id" uuid,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"price_tier" text,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"discount_pct" double precision DEFAULT 0 NOT NULL,
	"ppn" boolean DEFAULT true NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DEFAULT 'new'::text;--> statement-breakpoint
UPDATE "opportunities" SET "stage" = CASE "stage" WHEN 'qualified' THEN 'contacted' WHEN 'proposal' THEN 'quotation' ELSE "stage" END;--> statement-breakpoint
DROP TYPE "public"."opportunity_stage";--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('new', 'contacted', 'sampling', 'quotation', 'negotiation', 'won', 'lost');--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DEFAULT 'new'::"public"."opportunity_stage";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DATA TYPE "public"."opportunity_stage" USING "stage"::"public"."opportunity_stage";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "status" "campaign_status" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "result_leads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "result_revenue" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_pct" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ppn" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deposit_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_writer_id_users_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_designer_id_users_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_leads" ADD CONSTRAINT "event_leads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_leads" ADD CONSTRAINT "event_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_items_publish_idx" ON "content_items" USING btree ("publish_at");--> statement-breakpoint
CREATE INDEX "event_leads_event_idx" ON "event_leads" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "leads_owner_status_idx" ON "leads" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" USING btree ("source");--> statement-breakpoint
CREATE INDEX "quotation_items_quote_idx" ON "quotation_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_quote_no_uq" ON "quotations" USING btree ("quote_no");--> statement-breakpoint
CREATE INDEX "quotations_customer_idx" ON "quotations" USING btree ("customer_id");