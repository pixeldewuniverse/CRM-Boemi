ALTER TABLE "leads" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "instagram" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "birthday" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "interests" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_uq" ON "leads" USING btree ("external_source","external_ref") WHERE "leads"."external_ref" is not null;