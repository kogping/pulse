import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { auditSamples, venueAttributes, venues } from "./schema";

// §9 audit tooling: nightly random sample of venue-attributes, weighted
// toward stale ones, reviewed by a curator against reality. Feeds the
// weekly badge-accuracy % the >=90% gate is read from (see migration 0006's
// audit_accuracy_weekly view).

export interface AuditCandidateRow {
  id: string; // venue_attributes.id
  venueId: string;
  venueName: string;
  attributeKey: string;
  lastVerifiedAt: Date;
}

// A-Res weighted-without-replacement reservoir sampling: each row gets a
// key = rng() ** (1 / weight); the N highest keys win. Weight is age in
// hours (floored at 1h so a just-verified attribute still has a nonzero
// chance), so stale rows are favoured without ever excluding fresh ones
// outright. `rng` is injectable so this stays pure and testable — the only
// caller that passes anything but Math.random is audit.test.ts.
export function pickWeightedSample(
  rows: AuditCandidateRow[],
  count: number,
  now: Date,
  rng: () => number = Math.random,
): AuditCandidateRow[] {
  const keyed = rows.map((row) => {
    const ageHours = Math.max((now.getTime() - row.lastVerifiedAt.getTime()) / (1000 * 60 * 60), 0);
    const weight = Math.max(ageHours, 1);
    return { row, key: rng() ** (1 / weight) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, count).map((k) => k.row);
}

async function selectAuditCandidates(): Promise<AuditCandidateRow[]> {
  return db
    .select({
      id: venueAttributes.id,
      venueId: venues.id,
      venueName: venues.name,
      attributeKey: venueAttributes.attributeKey,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
    })
    .from(venueAttributes)
    .innerJoin(venues, eq(venues.id, venueAttributes.venueId));
}

export interface SampledAuditItem {
  auditSampleId: string;
  venueId: string;
  venueName: string;
  attributeKey: string;
  lastVerifiedAt: Date;
  ageHours: number;
}

function toSampledItem(auditSampleId: string, row: AuditCandidateRow, now: Date): SampledAuditItem {
  return {
    auditSampleId,
    venueId: row.venueId,
    venueName: row.venueName,
    attributeKey: row.attributeKey,
    lastVerifiedAt: row.lastVerifiedAt,
    ageHours: Math.round(((now.getTime() - row.lastVerifiedAt.getTime()) / (1000 * 60 * 60)) * 10) / 10,
  };
}

// Selects candidates and picks a weighted sample, without writing anything
// — the read-only half of the nightly job, reused by --dry-run.
export async function selectAuditSample(count = 20, now = new Date()): Promise<SampledAuditItem[]> {
  const candidates = await selectAuditCandidates();
  const picked = pickWeightedSample(candidates, count, now);
  return picked.map((row) => toSampledItem(row.id, row, now));
}

// Selects, picks, and writes an audit_samples row per item — the nightly
// job's actual side effect.
export async function sampleAuditBatch(count = 20, now = new Date()): Promise<SampledAuditItem[]> {
  const candidates = await selectAuditCandidates();
  const picked = pickWeightedSample(candidates, count, now);
  if (picked.length === 0) return [];

  const inserted = await db
    .insert(auditSamples)
    .values(picked.map((row) => ({ venueAttributeId: row.id, sampledAt: now })))
    .returning({ id: auditSamples.id, venueAttributeId: auditSamples.venueAttributeId });

  const byAttributeId = new Map(picked.map((row) => [row.id, row]));
  return inserted.map((ins) => toSampledItem(ins.id, byAttributeId.get(ins.venueAttributeId)!, now));
}

export interface PendingAuditItem {
  auditSampleId: string;
  venueId: string;
  venueName: string;
  attributeKey: string;
  value: string;
  lastVerifiedAt: Date;
  sampledAt: Date;
}

// Samples awaiting a curator's correct/incorrect verdict, oldest first.
export async function listPendingAuditSamples(): Promise<PendingAuditItem[]> {
  return db
    .select({
      auditSampleId: auditSamples.id,
      venueId: venues.id,
      venueName: venues.name,
      attributeKey: venueAttributes.attributeKey,
      value: venueAttributes.value,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
      sampledAt: auditSamples.sampledAt,
    })
    .from(auditSamples)
    .innerJoin(venueAttributes, eq(venueAttributes.id, auditSamples.venueAttributeId))
    .innerJoin(venues, eq(venues.id, venueAttributes.venueId))
    .where(isNull(auditSamples.verdict))
    .orderBy(auditSamples.sampledAt);
}

// Records a curator's verdict. Only succeeds against a still-pending
// sample (a second reviewer racing the first is a no-op, not a silent
// overwrite) — returns whether it actually applied.
export async function recordAuditVerdict(
  auditSampleId: string,
  verdict: "correct" | "incorrect",
  curatorId: string,
): Promise<boolean> {
  const result = await db
    .update(auditSamples)
    .set({ verdict, reviewedBy: curatorId, reviewedAt: new Date() })
    .where(and(eq(auditSamples.id, auditSampleId), isNull(auditSamples.verdict)))
    .returning({ id: auditSamples.id });
  return result.length > 0;
}

export interface WeeklyAccuracy {
  weekStart: Date;
  accuracyPct: number;
  sampleCount: number;
}

interface WeeklyAccuracyRow {
  week_start: string;
  accuracy_pct: string;
  sample_count: number;
}

// Reads the audit_accuracy_weekly view (migration 0006) — the number the
// >=90% gate is read from.
export async function weeklyAuditAccuracy(weeks = 6): Promise<WeeklyAccuracy[]> {
  const result = await db.execute(sql`
    select week_start, accuracy_pct, sample_count
    from audit_accuracy_weekly
    order by week_start desc
    limit ${weeks}
  `);
  return (result.rows as unknown as WeeklyAccuracyRow[]).map((row) => ({
    weekStart: new Date(row.week_start),
    accuracyPct: Math.round(Number(row.accuracy_pct) * 10) / 10,
    sampleCount: row.sample_count,
  }));
}
