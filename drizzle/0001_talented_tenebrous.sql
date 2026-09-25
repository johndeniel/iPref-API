ALTER TABLE "personal_information" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_pi_user_id" ON "personal_information" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "personal_information" ADD CONSTRAINT "personal_information_user_id_unique" UNIQUE("user_id");