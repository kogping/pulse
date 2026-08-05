CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows" integer,
	"source_etag" text,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "transit_hubs" ADD COLUMN "gtfs_stop_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_departures" ADD COLUMN "direction" smallint;--> statement-breakpoint
ALTER TABLE "scheduled_departures" ADD COLUMN "service_days" smallint;--> statement-breakpoint
ALTER TABLE "scheduled_departures" ADD COLUMN "gtfs_trip_id" text;--> statement-breakpoint
CREATE INDEX "import_runs_source_started_at_idx" ON "import_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transit_hubs_gtfs_stop_id_idx" ON "transit_hubs" USING btree ("gtfs_stop_id");--> statement-breakpoint
CREATE INDEX "scheduled_departures_hub_day_time_idx" ON "scheduled_departures" USING btree ("transit_hub_id","day_of_week","scheduled_time");