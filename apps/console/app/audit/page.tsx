import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAuditPageData } from "@/lib/audit";
import { AuditReviewList } from "./audit-review-list";

// Auth-gated the same as /queue, /ops, and /pending-edits — any signed-in
// curator can review. §9: the current-week accuracy % is surfaced
// prominently because it's the number the >=90% gate is read from.
export default async function AuditPage() {
  const session = await auth();
  if (!session) redirect("/signin");

  const { pending, weeklyAccuracy } = await getAuditPageData();
  const currentWeek = weeklyAccuracy[0];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-8 text-ink-50">
      <header>
        <h1 className="text-xl font-semibold">Audit</h1>
        <p className="text-sm text-ink-300">Nightly random sample of venue-attributes, weighted toward stale. Mark each against reality.</p>
      </header>

      <section aria-labelledby="audit-accuracy" className="rounded border border-ink-700 p-4">
        <h2 id="audit-accuracy" className="mb-2 text-base font-semibold">
          Weekly badge accuracy
        </h2>
        {currentWeek ? (
          <>
            <p className="text-3xl font-semibold">{currentWeek.accuracyPct.toFixed(1)}%</p>
            <p className="text-sm text-ink-300">
              {currentWeek.sampleCount} sample{currentWeek.sampleCount === 1 ? "" : "s"} reviewed this week
              {currentWeek.accuracyPct < 90 ? " — below the 90% gate" : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-300">No reviewed samples yet this week.</p>
        )}
        {weeklyAccuracy.length > 1 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-ink-300">
                <th className="py-1 font-medium">Week of</th>
                <th className="py-1 font-medium">Accuracy</th>
                <th className="py-1 font-medium">Samples</th>
              </tr>
            </thead>
            <tbody>
              {weeklyAccuracy.slice(1).map((week) => (
                <tr key={week.weekStart.toISOString()} className="border-b border-ink-900">
                  <td className="py-1">{week.weekStart.toISOString().slice(0, 10)}</td>
                  <td className="py-1">{week.accuracyPct.toFixed(1)}%</td>
                  <td className="py-1">{week.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="audit-pending">
        <h2 id="audit-pending" className="mb-2 text-base font-semibold">
          Awaiting review ({pending.length})
        </h2>
        <AuditReviewList items={pending} />
      </section>
    </main>
  );
}
