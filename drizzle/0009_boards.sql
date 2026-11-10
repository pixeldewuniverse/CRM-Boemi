CREATE TYPE "public"."board_kind" AS ENUM('project', 'team', 'template');--> statement-breakpoint
CREATE TYPE "public"."board_member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."board_visibility" AS ENUM('department', 'private', 'shared');--> statement-breakpoint
CREATE TYPE "public"."dependency_mode" AS ENUM('strict', 'flexible', 'none');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('FS', 'SS', 'FF', 'SF');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'pending_approval', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "board_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" double precision NOT NULL,
	"width" integer DEFAULT 160 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'c1' NOT NULL,
	"position" double precision NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_item_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_id" uuid,
	"field" text NOT NULL,
	"from" jsonb,
	"to" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_item_assignees" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "board_item_assignees_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "board_item_dependencies" (
	"predecessor_id" uuid NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" "dependency_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "board_item_dependencies_predecessor_id_successor_id_pk" PRIMARY KEY("predecessor_id","successor_id")
);
--> statement-breakpoint
CREATE TABLE "board_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"name" text NOT NULL,
	"position" double precision NOT NULL,
	"status_key" text,
	"priority" text,
	"start_on" date,
	"due_on" date,
	"estimate_hours" double precision,
	"customer_id" uuid,
	"opportunity_id" uuid,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_members" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_member_role" DEFAULT 'editor' NOT NULL,
	"edit_assigned_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "board_members_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "board_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"type" text DEFAULT 'table' NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "board_kind" DEFAULT 'team' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"department_id" uuid,
	"owner_id" uuid,
	"visibility" "board_visibility" DEFAULT 'department' NOT NULL,
	"code" text,
	"project_status" "project_status",
	"priority" text,
	"customer_id" uuid,
	"opportunity_id" uuid,
	"budget" bigint,
	"actual_cost" bigint,
	"start_on" date,
	"due_on" date,
	"approval_request_id" uuid,
	"dependency_mode" "dependency_mode" DEFAULT 'flexible' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_groups" ADD CONSTRAINT "board_groups_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_activity" ADD CONSTRAINT "board_item_activity_item_id_board_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_activity" ADD CONSTRAINT "board_item_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_assignees" ADD CONSTRAINT "board_item_assignees_item_id_board_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_assignees" ADD CONSTRAINT "board_item_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_dependencies" ADD CONSTRAINT "board_item_dependencies_predecessor_id_board_items_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_dependencies" ADD CONSTRAINT "board_item_dependencies_successor_id_board_items_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_group_id_board_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."board_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_parent_item_id_board_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_views" ADD CONSTRAINT "board_views_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_columns_key_uq" ON "board_columns" USING btree ("board_id","key");--> statement-breakpoint
CREATE INDEX "board_groups_board_idx" ON "board_groups" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "board_item_activity_item_idx" ON "board_item_activity" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "board_item_assignees_user_idx" ON "board_item_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "board_item_deps_successor_idx" ON "board_item_dependencies" USING btree ("successor_id");--> statement-breakpoint
CREATE INDEX "board_items_group_idx" ON "board_items" USING btree ("board_id","group_id","position");--> statement-breakpoint
CREATE INDEX "board_items_parent_idx" ON "board_items" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "board_items_due_idx" ON "board_items" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "board_members_user_idx" ON "board_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "board_views_board_idx" ON "board_views" USING btree ("board_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_code_uq" ON "boards" USING btree ("code") WHERE "boards"."code" is not null;--> statement-breakpoint
CREATE INDEX "boards_department_idx" ON "boards" USING btree ("department_id");