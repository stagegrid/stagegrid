ALTER TABLE "runners" ADD COLUMN "ceilings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "capacity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "capacity_resumes" integer DEFAULT 0 NOT NULL;