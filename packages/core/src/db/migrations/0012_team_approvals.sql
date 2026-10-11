CREATE TABLE "document_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "team" jsonb DEFAULT '{"analyst":{"enabled":false,"employeeId":null,"stageId":null},"dev":{"employeeId":null,"stageId":null},"reviewer":{"enabled":false,"employeeId":null},"qa":{"enabled":false,"employeeId":null,"stageId":null},"reworkLimit":2}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_approvals_doc_idx" ON "document_approvals" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_approvals_live_uq" ON "document_approvals" USING btree ("document_id","version") WHERE "document_approvals"."revoked_at" is null;