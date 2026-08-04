ALTER TABLE "venues" DROP CONSTRAINT "venues_slug_unique";--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "quality_tier" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "curator_pitch" text;--> statement-breakpoint
ALTER TABLE "venue_hours" ADD COLUMN "kitchen_closes_at" time;--> statement-breakpoint
CREATE UNIQUE INDEX "venues_precinct_slug_idx" ON "venues" USING btree ("precinct","slug");