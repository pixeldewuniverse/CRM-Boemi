CREATE TYPE "public"."quote_approval" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'shipped', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('deposit', 'settlement', 'other');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"contact_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"doc_type" text NOT NULL,
	"period" text NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_doc_type_period_pk" PRIMARY KEY("doc_type","period")
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'settlement' NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "quotation_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_status" "delivery_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "terms" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "approval" "quote_approval" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_customer_idx" ON "activities" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_user_idx" ON "activities" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "order_payments_order_idx" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_quotation_uq" ON "orders" USING btree ("quotation_id") WHERE "orders"."quotation_id" is not null;--> statement-breakpoint
-- Backfill: delivery moves out of the order status.
UPDATE "orders" SET "delivery_status" = 'delivered', "delivered_at" = "ordered_at" WHERE "status" IN ('delivered', 'completed');--> statement-breakpoint
UPDATE "orders" SET "delivery_status" = 'shipped', "shipped_at" = "ordered_at" WHERE "status" = 'shipped';--> statement-breakpoint
UPDATE "orders" SET "status" = 'processing' WHERE "status" IN ('shipped', 'delivered');--> statement-breakpoint
-- Backfill: amounts already marked as paid become payment records (paid_amount is derived from these from now on).
INSERT INTO "order_payments" ("order_id", "kind", "amount", "paid_on", "method", "note")
SELECT "id", CASE WHEN "payment_status" = 'deposit' THEN 'deposit'::"payment_kind" ELSE 'settlement'::"payment_kind" END,
       "paid_amount", ("ordered_at" AT TIME ZONE 'Asia/Jakarta')::date, 'Transfer', 'Imported from earlier records'
  FROM "orders" WHERE "paid_amount" > 0;
