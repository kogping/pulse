ALTER TABLE "verification_events" ADD COLUMN "action" text DEFAULT 'confirm' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_events" ADD COLUMN "previous_value" text;--> statement-breakpoint
ALTER TABLE "verification_events" ADD COLUMN "new_value" text;--> statement-breakpoint
ALTER TABLE "verification_events" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "verification_events" ADD COLUMN "client_action_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_events_client_action_id_idx" ON "verification_events" USING btree ("client_action_id") WHERE "verification_events"."client_action_id" is not null;--> statement-breakpoint
CREATE INDEX "verification_events_verified_at_idx" ON "verification_events" USING btree ("verified_at");