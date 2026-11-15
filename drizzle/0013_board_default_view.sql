CREATE TABLE "board_view_prefs" (
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"view" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_view_prefs_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "default_view" text;--> statement-breakpoint
ALTER TABLE "board_view_prefs" ADD CONSTRAINT "board_view_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_view_prefs" ADD CONSTRAINT "board_view_prefs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;