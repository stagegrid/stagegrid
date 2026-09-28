CREATE TYPE "public"."link_kind" AS ENUM('doc', 'design', 'issue', 'other');--> statement-breakpoint
CREATE TABLE "cell_assignees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cell_assignees_one_of" CHECK (("cell_assignees"."user_id" is null) <> ("cell_assignees"."display_name" is null))
);
--> statement-breakpoint
CREATE TABLE "cell_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"kind" "link_kind" DEFAULT 'other' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" uuid NOT NULL,
	"author_id" uuid,
	"via" "actor_via" NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell_assignees" ADD CONSTRAINT "cell_assignees_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_assignees" ADD CONSTRAINT "cell_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_assignees" ADD CONSTRAINT "cell_assignees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_links" ADD CONSTRAINT "cell_links_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_links" ADD CONSTRAINT "cell_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cell_assignees_cell_idx" ON "cell_assignees" USING btree ("cell_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cell_assignees_user_uq" ON "cell_assignees" USING btree ("cell_id","user_id") WHERE "cell_assignees"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cell_assignees_name_uq" ON "cell_assignees" USING btree ("cell_id",lower("display_name")) WHERE "cell_assignees"."display_name" is not null;--> statement-breakpoint
CREATE INDEX "cell_links_cell_idx" ON "cell_links" USING btree ("cell_id");--> statement-breakpoint
CREATE INDEX "comments_cell_idx" ON "comments" USING btree ("cell_id","created_at");