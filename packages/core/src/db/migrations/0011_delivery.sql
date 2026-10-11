CREATE TYPE "public"."submission_state" AS ENUM('submitted', 'accepted', 'superseded', 'changes_requested');--> statement-breakpoint
CREATE TABLE "task_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_ref" text NOT NULL,
	"url" text,
	"repo" text,
	"branch" text,
	"first_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_artifacts_ref_uq" UNIQUE("task_id","kind","external_ref")
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"context_revision_id" uuid NOT NULL,
	"head_commit" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"artifacts" jsonb NOT NULL,
	"verification" jsonb NOT NULL,
	"state" "submission_state" DEFAULT 'submitted' NOT NULL,
	"accept_key" text,
	"accepted_commit" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_submissions_run_uq" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "delivery" jsonb DEFAULT '{"mode":"local","repo":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_first_run_id_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_context_revision_id_task_context_revisions_id_fk" FOREIGN KEY ("context_revision_id") REFERENCES "public"."task_context_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_submissions_task_idx" ON "task_submissions" USING btree ("task_id","created_at");