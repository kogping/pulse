CREATE TABLE "curator_venue_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curator_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"nature" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_attribute_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"curator_id" uuid NOT NULL,
	"previous_value" text NOT NULL,
	"new_value" text NOT NULL,
	"note" text,
	"duration_ms" integer,
	"client_action_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "curator_venue_interests" ADD CONSTRAINT "curator_venue_interests_curator_id_curators_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_venue_interests" ADD CONSTRAINT "curator_venue_interests_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_venue_attribute_id_venue_attributes_id_fk" FOREIGN KEY ("venue_attribute_id") REFERENCES "public"."venue_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_curator_id_curators_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_decided_by_curators_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."curators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curator_venue_interests_curator_venue_idx" ON "curator_venue_interests" USING btree ("curator_id","venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_edits_client_action_id_idx" ON "pending_edits" USING btree ("client_action_id") WHERE "pending_edits"."client_action_id" is not null;--> statement-breakpoint
CREATE INDEX "pending_edits_status_idx" ON "pending_edits" USING btree ("status");--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_curators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."curators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Per-curator, per-week contribution counts (F0.3 attribution/compensation
-- gate). A view, not counter columns: every number here is derived from
-- venues.created_by and verification_events at read time, same "computed
-- never stored" discipline as attribute_confidence(). All four counters are
-- built pending confirmation from Ops on which ones the compensation model
-- actually needs (open item #1) — cheap to keep all four until then.
CREATE OR REPLACE VIEW curator_contributions_weekly AS
WITH venue_weeks AS (
  SELECT created_by AS curator_id, date_trunc('week', created_at) AS week_start, id AS venue_id
  FROM venues
  WHERE created_by IS NOT NULL
),
verified_weeks AS (
  SELECT ve.curator_id, date_trunc('week', ve.verified_at) AS week_start, va.venue_id, ve.action
  FROM verification_events ve
  JOIN venue_attributes va ON va.id = ve.venue_attribute_id
),
curator_weeks AS (
  SELECT curator_id, week_start FROM venue_weeks
  UNION
  SELECT curator_id, week_start FROM verified_weeks
),
venues_added AS (
  SELECT curator_id, week_start, count(*) AS n
  FROM venue_weeks
  GROUP BY curator_id, week_start
),
attributes_verified AS (
  SELECT curator_id, week_start, count(*) AS n
  FROM verified_weeks
  WHERE action = 'confirm'
  GROUP BY curator_id, week_start
),
corrections_made AS (
  SELECT curator_id, week_start, count(*) AS n
  FROM verified_weeks
  WHERE action = 'correct'
  GROUP BY curator_id, week_start
),
venue_weeks_touched AS (
  SELECT curator_id, week_start, count(DISTINCT venue_id) AS n
  FROM (
    SELECT curator_id, week_start, venue_id FROM venue_weeks
    UNION
    SELECT curator_id, week_start, venue_id FROM verified_weeks
  ) touched
  GROUP BY curator_id, week_start
)
SELECT
  cw.curator_id,
  cw.week_start,
  COALESCE(va2.n, 0) AS venues_added,
  COALESCE(av.n, 0) AS attributes_verified,
  COALESCE(cm.n, 0) AS corrections_made,
  COALESCE(vwt.n, 0) AS distinct_venue_weeks
FROM curator_weeks cw
LEFT JOIN venues_added va2 ON va2.curator_id = cw.curator_id AND va2.week_start = cw.week_start
LEFT JOIN attributes_verified av ON av.curator_id = cw.curator_id AND av.week_start = cw.week_start
LEFT JOIN corrections_made cm ON cm.curator_id = cw.curator_id AND cm.week_start = cw.week_start
LEFT JOIN venue_weeks_touched vwt ON vwt.curator_id = cw.curator_id AND vwt.week_start = cw.week_start;
--> statement-breakpoint
-- Attribution: contributing curators per venue, name + tier only. A view
-- over verification_events + venues.created_by, not a stored column — see
-- the confidence/contribution-counting rationale above.
CREATE OR REPLACE VIEW venue_curator_attribution AS
SELECT DISTINCT contributors.venue_id, contributors.curator_id, c.name, c.tier
FROM (
  SELECT v.id AS venue_id, v.created_by AS curator_id
  FROM venues v
  WHERE v.created_by IS NOT NULL
  UNION
  SELECT va.venue_id, ve.curator_id
  FROM verification_events ve
  JOIN venue_attributes va ON va.id = ve.venue_attribute_id
) contributors
JOIN curators c ON c.id = contributors.curator_id;