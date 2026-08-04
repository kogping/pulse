import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { curatorVenueInterests, pendingEdits, venueAttributes, venues, verificationEvents } from "./schema";
import { bumpPrecinctFeedCacheVersion } from "./feed-cache";
import { redis } from "./redis";

// Curator conflict-of-interest declaration and the pending-edit approval
// flow it gates. A curator with a declared interest in a venue never sees
// that venue in their own queue (queue.ts filters on this table) and any
// edit they submit lands in pending_edits instead of venue_attributes —
// see createPendingEditIfConflicted below.

export interface PendingEditRecord {
  id: string;
  venueAttributeId: string;
  venueId: string;
  curatorId: string;
  previousValue: string;
  newValue: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

// Best-effort feed-cache invalidation for a write against `venueId`. Looks
// up the venue's precinct (neither EditRequest nor the pending_edits row
// carries it) and bumps that precinct's Redis version counter — see
// feed-cache.ts. Never throws: a Redis outage here must not fail the
// attribute write that triggered it.
async function invalidateFeedCacheForVenue(venueId: string): Promise<void> {
  try {
    const [venue] = await db.select({ precinct: venues.precinct }).from(venues).where(eq(venues.id, venueId)).limit(1);
    if (!venue) return;
    await bumpPrecinctFeedCacheVersion(redis, venue.precinct);
  } catch (error) {
    console.warn(`[feed-cache] failed to invalidate for venue "${venueId}"`, error);
  }
}

export async function declareInterest(curatorId: string, venueId: string, nature: string): Promise<void> {
  await db
    .insert(curatorVenueInterests)
    .values({ curatorId, venueId, nature })
    .onConflictDoNothing({ target: [curatorVenueInterests.curatorId, curatorVenueInterests.venueId] });
}

export async function hasDeclaredInterest(curatorId: string, venueId: string): Promise<boolean> {
  const rows = await db
    .select({ id: curatorVenueInterests.id })
    .from(curatorVenueInterests)
    .where(and(eq(curatorVenueInterests.curatorId, curatorId), eq(curatorVenueInterests.venueId, venueId)))
    .limit(1);
  return rows.length > 0;
}

export interface EditRequest {
  venueAttributeId: string;
  venueId: string;
  curatorId: string;
  previousValue: string;
  newValue: string;
  note?: string | null;
  durationMs?: number | null;
  clientActionId?: string | null;
}

// The single choke point every attribute-write path must go through:
// applies the edit directly unless the curator has declared an interest in
// the venue, in which case it's parked in pending_edits and
// venue_attributes is left untouched. Returns which happened so the caller
// can report the right outbox status.
export async function applyOrDeferEdit(
  request: EditRequest,
): Promise<{ outcome: "applied" } | { outcome: "deferred"; pendingEditId: string }> {
  if (await hasDeclaredInterest(request.curatorId, request.venueId)) {
    const [row] = await db
      .insert(pendingEdits)
      .values({
        venueAttributeId: request.venueAttributeId,
        venueId: request.venueId,
        curatorId: request.curatorId,
        previousValue: request.previousValue,
        newValue: request.newValue,
        note: request.note ?? null,
        durationMs: request.durationMs ?? null,
        clientActionId: request.clientActionId ?? null,
      })
      .onConflictDoNothing({ target: pendingEdits.clientActionId, where: sql`${pendingEdits.clientActionId} is not null` })
      .returning({ id: pendingEdits.id });
    return { outcome: "deferred", pendingEditId: row?.id ?? "" };
  }

  await db
    .update(venueAttributes)
    .set({ value: request.newValue, lastVerifiedAt: new Date(), verifiedBy: request.curatorId })
    .where(eq(venueAttributes.id, request.venueAttributeId));
  await db.insert(verificationEvents).values({
    venueAttributeId: request.venueAttributeId,
    curatorId: request.curatorId,
    action: "correct",
    previousValue: request.previousValue,
    newValue: request.newValue,
    durationMs: request.durationMs ?? null,
    clientActionId: request.clientActionId ?? null,
  });
  await invalidateFeedCacheForVenue(request.venueId);
  return { outcome: "applied" };
}

export async function listPendingEdits(status: "pending" | "approved" | "rejected" = "pending"): Promise<PendingEditRecord[]> {
  const rows = await db.select().from(pendingEdits).where(eq(pendingEdits.status, status));
  return rows.map((row) => ({
    id: row.id,
    venueAttributeId: row.venueAttributeId,
    venueId: row.venueId,
    curatorId: row.curatorId,
    previousValue: row.previousValue,
    newValue: row.newValue,
    note: row.note,
    status: row.status as PendingEditRecord["status"],
    createdAt: row.createdAt,
  }));
}

export type DecidePendingEditResult = "not_found" | "already_decided" | "self_approval" | "applied" | "rejected";

// A second curator — never the author — approves or rejects. Approving
// applies the edit to venue_attributes and writes the audit trail
// (attributed to the original author, since they made the correction; the
// approver is recorded on the pending_edits row itself).
export async function decidePendingEdit(
  pendingEditId: string,
  decision: "approve" | "reject",
  decidingCuratorId: string,
): Promise<DecidePendingEditResult> {
  const [edit] = await db.select().from(pendingEdits).where(eq(pendingEdits.id, pendingEditId)).limit(1);
  if (!edit) return "not_found";
  if (edit.status !== "pending") return "already_decided";
  if (edit.curatorId === decidingCuratorId) return "self_approval";

  if (decision === "reject") {
    await db
      .update(pendingEdits)
      .set({ status: "rejected", decidedBy: decidingCuratorId, decidedAt: new Date() })
      .where(eq(pendingEdits.id, pendingEditId));
    return "rejected";
  }

  await db
    .update(venueAttributes)
    .set({ value: edit.newValue, lastVerifiedAt: new Date(), verifiedBy: edit.curatorId })
    .where(eq(venueAttributes.id, edit.venueAttributeId));
  await db.insert(verificationEvents).values({
    venueAttributeId: edit.venueAttributeId,
    curatorId: edit.curatorId,
    action: "correct",
    previousValue: edit.previousValue,
    newValue: edit.newValue,
    durationMs: edit.durationMs,
    note: `approved by curator ${decidingCuratorId}`,
  });
  await db
    .update(pendingEdits)
    .set({ status: "approved", decidedBy: decidingCuratorId, decidedAt: new Date() })
    .where(eq(pendingEdits.id, pendingEditId));
  await invalidateFeedCacheForVenue(edit.venueId);
  return "applied";
}
