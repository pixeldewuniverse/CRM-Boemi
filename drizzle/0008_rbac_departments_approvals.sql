CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'project_manager';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'staff';--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"approver_type" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_id" uuid,
	"approver_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "approval_step_status" DEFAULT 'waiting' NOT NULL,
	"decided_by" uuid,
	"note" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_flow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"approver_type" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_id" uuid,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "approval_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"min_amount" bigint,
	"max_amount" bigint,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"link" text,
	"requester_id" uuid NOT NULL,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"head_user_id" uuid,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_flow_steps" ADD CONSTRAINT "approval_flow_steps_flow_id_approval_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."approval_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_flow_steps" ADD CONSTRAINT "approval_flow_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_flow_id_approval_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."approval_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_actions_request_idx" ON "approval_actions" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "approval_flow_steps_flow_idx" ON "approval_flow_steps" USING btree ("flow_id","position");--> statement-breakpoint
CREATE INDEX "approval_flows_entity_idx" ON "approval_flows" USING btree ("entity_type","active");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "users" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "users_manager_idx" ON "users" USING btree ("manager_id");--> statement-breakpoint
-- Backfill: departments from the free-text users.department column.
INSERT INTO "departments" ("name", "code")
SELECT DISTINCT ON (upper(regexp_replace(trim("department"), '[^A-Za-z0-9]+', '-', 'g'))) trim("department"), upper(regexp_replace(trim("department"), '[^A-Za-z0-9]+', '-', 'g'))
  FROM "users" WHERE coalesce(trim("department"), '') <> ''
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
UPDATE "users" u SET "department_id" = d."id"
  FROM "departments" d WHERE d."code" = upper(regexp_replace(trim(u."department"), '[^A-Za-z0-9]+', '-', 'g'));
--> statement-breakpoint
UPDATE "departments" d SET "head_user_id" = (
  SELECT u."id" FROM "users" u WHERE u."department_id" = d."id" AND u."role" = 'sales_manager' AND u."active" ORDER BY u."created_at" LIMIT 1
) WHERE d."head_user_id" IS NULL;
--> statement-breakpoint
-- Default approval flows = the behaviour before the engine existed.
INSERT INTO "approval_flows" ("id", "entity_type", "name", "priority") VALUES
  ('00000000-0000-4000-8000-000000000001', 'visit_fee', 'Visit fee: manager or finance', 100),
  ('00000000-0000-4000-8000-000000000002', 'quotation_discount', 'Quotation discount above the sales limit', 100);
--> statement-breakpoint
INSERT INTO "approval_flow_steps" ("flow_id", "position", "approver_type", "roles", "label") VALUES
  ('00000000-0000-4000-8000-000000000001', 1, 'role', ARRAY['sales_manager', 'finance'], 'Manager or Finance'),
  ('00000000-0000-4000-8000-000000000002', 1, 'role', ARRAY['sales_manager'], 'Department Head / Manager');
--> statement-breakpoint
-- Visit fees still waiting → requests on the default flow (decided fees stay readable in visit_fees).
INSERT INTO "approval_requests" ("flow_id", "entity_type", "entity_id", "amount", "title", "link", "requester_id", "status", "current_step", "created_at")
SELECT '00000000-0000-4000-8000-000000000001', 'visit_fee', f."id", f."amount", 'Visit fee · ' || c."name", '/sales/visits', f."requested_by", 'pending', 1, f."created_at"
  FROM "visit_fees" f JOIN "visits" v ON v."id" = f."visit_id" JOIN "customers" c ON c."id" = v."customer_id"
 WHERE f."status" = 'pending';
--> statement-breakpoint
INSERT INTO "approval_requests" ("flow_id", "entity_type", "entity_id", "amount", "title", "link", "requester_id", "status", "current_step", "created_at")
SELECT '00000000-0000-4000-8000-000000000002', 'quotation_discount', q."id", ceil(q."discount_pct")::bigint, q."quote_no" || ' · ' || q."discount_pct" || '% discount', '/sales/quotations/' || q."id", q."owner_id", 'pending', 1, q."created_at"
  FROM "quotations" q WHERE q."approval" = 'pending' AND q."owner_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "approval_actions" ("request_id", "position", "label", "approver_type", "roles", "approver_ids", "status")
SELECT r."id", 1, s."label", s."approver_type", s."roles",
       coalesce(
         nullif(ARRAY(SELECT u."id" FROM "users" u WHERE u."active" AND u."role"::text = ANY (s."roles") AND u."id" <> r."requester_id"), '{}'),
         ARRAY(SELECT u."id" FROM "users" u WHERE u."active" AND u."role" = 'admin' AND u."id" <> r."requester_id")
       ),
       'pending'
  FROM "approval_requests" r JOIN "approval_flow_steps" s ON s."flow_id" = r."flow_id" AND s."position" = 1;
