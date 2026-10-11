CREATE TYPE "public"."review_state" AS ENUM('none', 'pending', 'passed', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."run_role" AS ENUM('analyst', 'dev', 'reviewer', 'qa');--> statement-breakpoint
CREATE TYPE "public"."task_role" AS ENUM('analyst', 'dev', 'qa');--> statement-breakpoint
CREATE TABLE "submission_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" text NOT NULL,
	"verdict" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reviews_run_uq" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD COLUMN "review_state" "review_state" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "role" "run_role" DEFAULT 'dev' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "role" "task_role";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rework_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_reviews_sub_idx" ON "submission_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_handoff_uq" ON "tasks" USING btree ("parent_task_id","role") WHERE "tasks"."parent_task_id" is not null;