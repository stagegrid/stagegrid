CREATE TYPE "public"."run_state" AS ENUM('queued', 'running', 'waiting_for_answer', 'waiting_for_capacity', 'succeeded', 'failed', 'cancelled', 'interrupted');--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_event_uq" UNIQUE("run_id","event_id"),
	CONSTRAINT "run_events_sequence_uq" UNIQUE("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "runner_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"runner_id" uuid,
	CONSTRAINT "runner_enrollments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "runner_projects" (
	"runner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "runner_projects_runner_id_project_id_pk" PRIMARY KEY("runner_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_prefix" text NOT NULL,
	"providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text,
	"max_concurrent" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "runners_credential_hash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"context_revision_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" "run_state" DEFAULT 'queued' NOT NULL,
	"task_state_before" "task_state" NOT NULL,
	"runtime" jsonb NOT NULL,
	"start_key" text NOT NULL,
	"runner_id" uuid,
	"claim_key" text,
	"fencing_token" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"session_ref" text,
	"resume_at" timestamp with time zone,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"failure_reason" text,
	"completion_key" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_task_start_key_uq" UNIQUE("task_id","start_key")
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_enrollments" ADD CONSTRAINT "runner_enrollments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_enrollments" ADD CONSTRAINT "runner_enrollments_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_projects" ADD CONSTRAINT "runner_projects_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_projects" ADD CONSTRAINT "runner_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_context_revision_id_task_context_revisions_id_fk" FOREIGN KEY ("context_revision_id") REFERENCES "public"."task_context_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runners_seen_idx" ON "runners" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "runs_task_idx" ON "runs" USING btree ("task_id","attempt");--> statement-breakpoint
CREATE INDEX "runs_queue_idx" ON "runs" USING btree ("project_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_task_uq" ON "runs" USING btree ("task_id") WHERE "runs"."state" in ('queued','running','waiting_for_answer','waiting_for_capacity');