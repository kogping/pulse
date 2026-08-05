ALTER TABLE "venue_hub_links" ALTER COLUMN "walk_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ADD COLUMN "walk_seconds" integer;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ADD COLUMN "is_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill any pre-existing rows (e.g. seed data written before this
-- migration) from the old walk_minutes column so walk_seconds can be made
-- NOT NULL below without losing rows. New rows written by hub-links.ts
-- always populate walk_seconds directly.
UPDATE "venue_hub_links" SET "walk_seconds" = "walk_minutes" * 60 WHERE "walk_seconds" IS NULL;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ALTER COLUMN "walk_seconds" SET NOT NULL;