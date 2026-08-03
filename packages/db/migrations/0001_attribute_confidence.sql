CREATE OR REPLACE FUNCTION attribute_confidence(
  attribute_key text,
  last_verified_at timestamptz,
  flag_count int
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH classified AS (
    SELECT
  CASE
    WHEN attribute_key IN ('crowd_level', 'queue_length') THEN 'realtime'
    WHEN attribute_key IN ('cover_charge', 'last_entry_tonight', 'live_music_tonight') THEN 'nightly'
    WHEN attribute_key IN ('booking_required', 'dress_code', 'outdoor_area', 'price_tier', 'wheelchair_accessible') THEN 'static'
    ELSE 'nightly'
  END AS attribute_class,
      EXTRACT(EPOCH FROM (now() - last_verified_at)) / 3600.0 AS age_hours
  ),
  decayed AS (
    SELECT
  CASE
    WHEN attribute_class = 'realtime' AND age_hours <= 2 THEN 'fresh'
    WHEN attribute_class = 'realtime' AND age_hours <= 6 THEN 'ageing'
    WHEN attribute_class = 'realtime' THEN 'unconfirmed'
    WHEN attribute_class = 'nightly' AND age_hours <= 12 THEN 'fresh'
    WHEN attribute_class = 'nightly' AND age_hours <= 36 THEN 'ageing'
    WHEN attribute_class = 'nightly' THEN 'unconfirmed'
    WHEN attribute_class = 'static' AND age_hours <= 720 THEN 'fresh'
    WHEN attribute_class = 'static' AND age_hours <= 2880 THEN 'ageing'
    WHEN attribute_class = 'static' THEN 'unconfirmed'
  END AS decayed_confidence
    FROM classified
  )
  SELECT
    CASE
      WHEN flag_count >= 2 THEN 'unconfirmed'
      WHEN flag_count >= 1 AND decayed_confidence = 'fresh' THEN 'ageing'
      ELSE decayed_confidence
    END
  FROM decayed
$$;
--> statement-breakpoint
CREATE OR REPLACE VIEW venue_attributes_resolved AS
SELECT
  va.venue_id,
  va.attribute_key,
  va.value,
  va.last_verified_at,
  va.verified_by,
  attribute_confidence(
    va.attribute_key,
    va.last_verified_at,
    COALESCE(flag_counts.flag_count, 0)::int
  ) AS confidence
FROM venue_attributes va
LEFT JOIN LATERAL (
  SELECT count(*) AS flag_count
  FROM correction_flags cf
  WHERE cf.venue_attribute_id = va.id
    AND cf.flagged_at >= now() - interval '24 hours'
) flag_counts ON true;
