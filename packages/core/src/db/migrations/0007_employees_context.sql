CREATE TYPE "public"."employee_provider" AS ENUM('claude_code', 'codex');--> statement-breakpoint
CREATE TYPE "public"."employee_role" AS ENUM('analyst', 'dev', 'reviewer', 'qa');--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" "employee_role" NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"provider" "employee_provider" NOT NULL,
	"model" text,
	"avatar" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_context_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_context_revisions_no_uq" UNIQUE("task_id","revision_no")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_context_revisions" ADD CONSTRAINT "task_context_revisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_context_revisions" ADD CONSTRAINT "task_context_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_project_idx" ON "employees" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_name_uq" ON "employees" USING btree ("project_id",lower("display_name")) WHERE "employees"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "task_context_revisions_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_context_revisions rows are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_context_revisions_no_update" BEFORE UPDATE ON "task_context_revisions" FOR EACH ROW EXECUTE FUNCTION "task_context_revisions_immutable"();
