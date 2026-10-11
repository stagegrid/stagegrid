CREATE TYPE "public"."question_batch_state" AS ENUM('open', 'answered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."question_state" AS ENUM('open', 'answered', 'cancelled');--> statement-breakpoint
CREATE TABLE "question_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"context_revision_id" uuid NOT NULL,
	"state" "question_batch_state" DEFAULT 'open' NOT NULL,
	"ask_key" text NOT NULL,
	"hold_for_context" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "question_state" DEFAULT 'open' NOT NULL,
	"answer" text,
	"changes_scope" boolean DEFAULT false NOT NULL,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"answer_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_batches" ADD CONSTRAINT "question_batches_context_revision_id_task_context_revisions_id_fk" FOREIGN KEY ("context_revision_id") REFERENCES "public"."task_context_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_batch_id_question_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."question_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_batches_task_idx" ON "question_batches" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_batches_ask_key_uq" ON "question_batches" USING btree ("run_id","ask_key");--> statement-breakpoint
CREATE UNIQUE INDEX "question_batches_one_open_uq" ON "question_batches" USING btree ("task_id") WHERE "question_batches"."state" = 'open';--> statement-breakpoint
CREATE INDEX "questions_batch_idx" ON "questions" USING btree ("batch_id","position");