CREATE TYPE "public"."content_asset_kind" AS ENUM('reference', 'design');--> statement-breakpoint
CREATE TABLE "content_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"kind" "content_asset_kind" NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"file_key" text,
	"url" text,
	"mime" text,
	"size" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "guideline" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "design_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "content_activity" ADD CONSTRAINT "content_activity_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_activity" ADD CONSTRAINT "content_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_activity_content_idx" ON "content_activity" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_assets_content_idx" ON "content_assets" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_assets_key_idx" ON "content_assets" USING btree ("file_key");--> statement-breakpoint
UPDATE "content_items" SET "design_version" = 1 WHERE "status" NOT IN ('draft_brief', 'ready_for_design');
