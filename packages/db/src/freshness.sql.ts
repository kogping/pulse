import { ATTRIBUTE_CLASSES, DECAY_RULES, DEFAULT_ATTRIBUTE_CLASS, type AttributeClass } from "./freshness";

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Renders "attribute_key IN ('a','b',...)" grouped by class, so the SQL
// class lookup is generated from the exact same map as attributeClassFor().
function classCaseExpression(): string {
  const classes = Object.keys(DECAY_RULES) as AttributeClass[];
  const keysByClass = new Map<AttributeClass, string[]>(classes.map((c) => [c, []]));
  for (const [key, cls] of Object.entries(ATTRIBUTE_CLASSES)) {
    keysByClass.get(cls)?.push(key);
  }

  const whenClauses = classes
    .filter((cls) => (keysByClass.get(cls) ?? []).length > 0)
    .map((cls) => {
      const keys = (keysByClass.get(cls) ?? []).sort().map(sqlLiteral).join(", ");
      return `    WHEN attribute_key IN (${keys}) THEN ${sqlLiteral(cls)}`;
    })
    .join("\n");

  return `  CASE\n${whenClauses}\n    ELSE ${sqlLiteral(DEFAULT_ATTRIBUTE_CLASS)}\n  END`;
}

function decayCaseExpression(): string {
  const classes = Object.keys(DECAY_RULES) as AttributeClass[];
  const whenClauses = classes
    .map((cls) => {
      const { freshHours, ageingHours } = DECAY_RULES[cls];
      return (
        `    WHEN attribute_class = ${sqlLiteral(cls)} AND age_hours <= ${freshHours} THEN 'fresh'\n` +
        `    WHEN attribute_class = ${sqlLiteral(cls)} AND age_hours <= ${ageingHours} THEN 'ageing'\n` +
        `    WHEN attribute_class = ${sqlLiteral(cls)} THEN 'unconfirmed'`
      );
    })
    .join("\n");

  return `  CASE\n${whenClauses}\n  END`;
}

// Full CREATE FUNCTION statement, generated from ATTRIBUTE_CLASSES /
// DECAY_RULES so it can never drift from attributeConfidence() in
// freshness.ts. Checked in verbatim as
// migrations/0001_attribute_confidence.sql; freshness.test.ts asserts the
// checked-in file matches a fresh render of this function.
function generateAttributeConfidenceSql(): string {
  return `CREATE OR REPLACE FUNCTION attribute_confidence(
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
${classCaseExpression()} AS attribute_class,
      EXTRACT(EPOCH FROM (now() - last_verified_at)) / 3600.0 AS age_hours
  ),
  decayed AS (
    SELECT
${decayCaseExpression()} AS decayed_confidence
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
`;
}

const VIEW_SQL = `CREATE OR REPLACE VIEW venue_attributes_resolved AS
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
`;

// Full contents of migrations/0001_attribute_confidence.sql, generated from
// ATTRIBUTE_CLASSES / DECAY_RULES in freshness.ts. Checked in verbatim;
// freshness.test.ts asserts the checked-in file matches a fresh render of
// this function so the SQL can never silently drift from the TS source of
// truth.
export function generateMigrationSql(): string {
  return `${generateAttributeConfidenceSql()}--> statement-breakpoint\n${VIEW_SQL}`;
}
