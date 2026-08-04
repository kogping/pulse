CREATE TABLE "audit_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_attribute_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verdict" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_samples" ADD CONSTRAINT "audit_samples_venue_attribute_id_venue_attributes_id_fk" FOREIGN KEY ("venue_attribute_id") REFERENCES "public"."venue_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_samples" ADD CONSTRAINT "audit_samples_reviewed_by_curators_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."curators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_samples_sampled_at_idx" ON "audit_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "audit_samples_verdict_idx" ON "audit_samples" USING btree ("verdict");--> statement-breakpoint
-- Weekly badge accuracy % (the number the >=90% gate is read from). A view
-- over audit_samples, not a stored/upserted counter: the ">= 90%" gate must
-- always reflect the current audit_samples rows, and a stored snapshot
-- could drift from a re-reviewed sample the same way a stored confidence
-- column could drift from attribute_confidence() (see CLAUDE.md invariant
-- 2). Only reviewed samples (verdict is not null) count.
CREATE OR REPLACE VIEW audit_accuracy_weekly AS
SELECT
  date_trunc('week', reviewed_at) AS week_start,
  count(*) FILTER (WHERE verdict = 'correct')::numeric / count(*) * 100 AS accuracy_pct,
  count(*) AS sample_count
FROM audit_samples
WHERE verdict IS NOT NULL
GROUP BY date_trunc('week', reviewed_at);