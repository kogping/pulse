import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOpsSummary } from "@/lib/ops";

function formatSeconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

// Auth-gated the same as /queue — any signed-in curator, no tier check.
// There are ~10 allow-listed, trusted curators and the data here is their
// own throughput; this is what docs/gates/curator-queue-week5.md reads.
export default async function OpsPage() {
  const session = await auth();
  if (!session) redirect("/signin");

  const summary = await getOpsSummary(7);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8 text-ink-50">
      <header>
        <h1 className="text-xl font-semibold">Ops</h1>
        <p className="text-sm text-ink-300">Verification queue throughput and timing, last {summary.sinceDays} days.</p>
      </header>

      <section aria-labelledby="ops-overall">
        <h2 id="ops-overall" className="mb-2 text-base font-semibold">
          Overall
        </h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-ink-300">Events</dt>
            <dd className="text-lg font-semibold">{summary.overall.totalEvents}</dd>
          </div>
          <div>
            <dt className="text-ink-300">Median time / item</dt>
            <dd className="text-lg font-semibold">{formatSeconds(summary.overall.medianDurationMs)}</dd>
          </div>
          <div>
            <dt className="text-ink-300">p90 time / item</dt>
            <dd className="text-lg font-semibold">{formatSeconds(summary.overall.p90DurationMs)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="ops-per-attribute">
        <h2 id="ops-per-attribute" className="mb-2 text-base font-semibold">
          By attribute
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-ink-300">
              <th className="py-1 font-medium">Attribute</th>
              <th className="py-1 font-medium">Events</th>
              <th className="py-1 font-medium">Median</th>
              <th className="py-1 font-medium">p90</th>
            </tr>
          </thead>
          <tbody>
            {summary.perAttribute.map((row) => (
              <tr key={row.attributeKey} className="border-b border-ink-900">
                <td className="py-1">{row.attributeKey}</td>
                <td className="py-1">{row.count}</td>
                <td className="py-1">{formatSeconds(row.medianDurationMs)}</td>
                <td className="py-1">{formatSeconds(row.p90DurationMs)}</td>
              </tr>
            ))}
            {summary.perAttribute.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-ink-300">
                  No timed events yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="ops-per-curator">
        <h2 id="ops-per-curator" className="mb-2 text-base font-semibold">
          By curator
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-ink-300">
              <th className="py-1 font-medium">Curator</th>
              <th className="py-1 font-medium">Confirmed</th>
              <th className="py-1 font-medium">Corrected</th>
              <th className="py-1 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.perCurator.map((row) => (
              <tr key={row.curatorName} className="border-b border-ink-900">
                <td className="py-1">{row.curatorName}</td>
                <td className="py-1">{row.confirmCount}</td>
                <td className="py-1">{row.correctCount}</td>
                <td className="py-1">{row.total}</td>
              </tr>
            ))}
            {summary.perCurator.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-ink-300">
                  No events yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
