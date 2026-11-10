CREATE TYPE "public"."criterion_kind" AS ENUM('rule', 'ai');--> statement-breakpoint
CREATE TYPE "public"."qualification_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."qualification_subject" AS ENUM('lead', 'account');--> statement-breakpoint
CREATE TABLE "qualification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "qualification_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" "qualification_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "qualification_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"criteria_version" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"ai" jsonb,
	"score" integer NOT NULL,
	"tier" "lead_tier" NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tier_override" "lead_tier";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tier_override_reason" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tier_override_by" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tier_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier_override" "lead_tier";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier_override_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier_override_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sla_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sla_escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD COLUMN "kind" "criterion_kind" DEFAULT 'rule' NOT NULL;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "qualification_runs" ADD CONSTRAINT "qualification_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_jobs_queued_uq" ON "qualification_jobs" USING btree ("subject_type","subject_id") WHERE "qualification_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "qualification_jobs_due_idx" ON "qualification_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "qualification_runs_subject_idx" ON "qualification_runs" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_override_by_users_id_fk" FOREIGN KEY ("tier_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tier_override_by_users_id_fk" FOREIGN KEY ("tier_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Leads already marked contacted: use their last update as the last contact.
UPDATE "leads" SET "last_contacted_at" = "updated_at" WHERE "status" = 'contacted' AND "last_contacted_at" IS NULL;
