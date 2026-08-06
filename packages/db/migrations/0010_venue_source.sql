ALTER TABLE "venues" ADD COLUMN "source" text DEFAULT 'curator' NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "external_place_id" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "external_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "venues_source_idx" ON "venues" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_external_place_id_idx" ON "venues" USING btree ("external_place_id") WHERE "venues"."external_place_id" is not null;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_source_check" CHECK ("venues"."source" in ('curator', 'google_places'));