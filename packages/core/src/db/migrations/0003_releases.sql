CREATE TYPE "public"."release_item_kind" AS ENUM('new', 'change');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('active', 'released', 'cancelled');--> statement-breakpoint
CREATE TABLE "release_cells" (
	"release_id" uuid NOT NULL,
	"cell_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_cells_release_id_cell_id_pk" PRIMARY KEY("release_id","cell_id")
);
--> statement-breakpoint
CREATE TABLE "release_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "release_item_kind" NOT NULL,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_phases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"name" text NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"freeze" boolean DEFAULT false NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"target_date" date NOT NULL,
	"status" "release_status" DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"snapshot" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_release_phases" jsonb DEFAULT '[{"name":"Dev"},{"name":"SIT","freeze":true},{"name":"UAT"}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "release_cells" ADD CONSTRAINT "release_cells_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_cells" ADD CONSTRAINT "release_cells_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_items" ADD CONSTRAINT "release_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_items" ADD CONSTRAINT "release_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_items" ADD CONSTRAINT "release_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_phases" ADD CONSTRAINT "release_phases_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_cells_cell_idx" ON "release_cells" USING btree ("cell_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_items_uq" ON "release_items" USING btree ("release_id","item_id");--> statement-breakpoint
CREATE INDEX "release_phases_release_idx" ON "release_phases" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "releases_project_idx" ON "releases" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_name_uq" ON "releases" USING btree ("project_id",lower("name")) WHERE "releases"."deleted_at" is null;