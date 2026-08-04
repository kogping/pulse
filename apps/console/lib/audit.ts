// §9 audit tooling: read/write access to the nightly audit sample for the
// console's /audit page. Like lib/ops.ts, this queries Drizzle/Neon
// directly — read/write paths reviewed by a trusted curator, not exercised
// by Playwright, so there's no AUTH_TEST_MODE in-memory counterpart to
// keep in sync.
import {
  listPendingAuditSamples,
  recordAuditVerdict,
  weeklyAuditAccuracy,
  type PendingAuditItem,
  type WeeklyAccuracy,
} from "@pulse/db";

export type { PendingAuditItem, WeeklyAccuracy };

export async function getAuditPageData(): Promise<{ pending: PendingAuditItem[]; weeklyAccuracy: WeeklyAccuracy[] }> {
  const [pending, weeklyAccuracy] = await Promise.all([listPendingAuditSamples(), weeklyAuditAccuracy(6)]);
  return { pending, weeklyAccuracy };
}

export async function submitAuditVerdict(auditSampleId: string, verdict: "correct" | "incorrect", curatorId: string): Promise<boolean> {
  return recordAuditVerdict(auditSampleId, verdict, curatorId);
}
