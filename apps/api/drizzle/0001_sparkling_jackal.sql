CREATE TYPE "public"."submission_status" AS ENUM('pending', 'checking', 'accepted', 'needs_reupload');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"folder_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"slot" varchar(16) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"assessment" jsonb,
	"drive_file_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_token_hash_unique" ON "applications" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_application_slot_unique" ON "submissions" USING btree ("application_id","slot");