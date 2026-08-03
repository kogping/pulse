CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "curators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"precinct" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"location" geography(Point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "venue_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"is_closed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"attribute_key" text NOT NULL,
	"value" text NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_attribute_id" uuid NOT NULL,
	"curator_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "correction_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_attribute_id" uuid NOT NULL,
	"reporter_session_hash" text NOT NULL,
	"reason" text,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transit_hubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"location" geography(Point,4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_hub_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"transit_hub_id" uuid NOT NULL,
	"walk_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transit_hub_id" uuid NOT NULL,
	"route" text NOT NULL,
	"headsign" text,
	"day_of_week" integer NOT NULL,
	"scheduled_time" time NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_hours" ADD CONSTRAINT "venue_hours_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_attributes" ADD CONSTRAINT "venue_attributes_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_attributes" ADD CONSTRAINT "venue_attributes_verified_by_curators_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."curators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_venue_attribute_id_venue_attributes_id_fk" FOREIGN KEY ("venue_attribute_id") REFERENCES "public"."venue_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_curator_id_curators_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_flags" ADD CONSTRAINT "correction_flags_venue_attribute_id_venue_attributes_id_fk" FOREIGN KEY ("venue_attribute_id") REFERENCES "public"."venue_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ADD CONSTRAINT "venue_hub_links_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_hub_links" ADD CONSTRAINT "venue_hub_links_transit_hub_id_transit_hubs_id_fk" FOREIGN KEY ("transit_hub_id") REFERENCES "public"."transit_hubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_departures" ADD CONSTRAINT "scheduled_departures_transit_hub_id_transit_hubs_id_fk" FOREIGN KEY ("transit_hub_id") REFERENCES "public"."transit_hubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venues_location_gist_idx" ON "venues" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_hours_venue_day_idx" ON "venue_hours" USING btree ("venue_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_attributes_venue_key_idx" ON "venue_attributes" USING btree ("venue_id","attribute_key");--> statement-breakpoint
CREATE INDEX "correction_flags_attribute_flagged_idx" ON "correction_flags" USING btree ("venue_attribute_id","flagged_at");--> statement-breakpoint
CREATE INDEX "transit_hubs_location_gist_idx" ON "transit_hubs" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_hub_links_venue_hub_idx" ON "venue_hub_links" USING btree ("venue_id","transit_hub_id");--> statement-breakpoint
CREATE INDEX "scheduled_departures_hub_day_idx" ON "scheduled_departures" USING btree ("transit_hub_id","day_of_week");