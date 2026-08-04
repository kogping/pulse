// §9 audit tooling: nightly weighted-random sample of venue-attributes for a
// curator to mark correct/incorrect against reality. Invoked by
// .github/workflows/audit.yml. --dry-run selects and prints the sample
// without writing audit_samples rows or announcing anything — safe to run
// against any environment with read access.
import { sampleAuditBatch, selectAuditSample, type SampledAuditItem } from "@pulse/db";

const SAMPLE_SIZE = 20;

function printSample(items: SampledAuditItem[]): void {
  console.log(`sampled ${items.length} venue-attributes:\n`);
  for (const item of items) {
    console.log(`  ${item.venueName.padEnd(28)} ${item.attributeKey.padEnd(22)} ${item.ageHours.toFixed(1)}h old`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    const items = await selectAuditSample(SAMPLE_SIZE);
    printSample(items);
    process.exit(0);
    return;
  }

  const items = await sampleAuditBatch(SAMPLE_SIZE);
  printSample(items);

  const consoleUrl = process.env.PULSE_CONSOLE_URL;
  const auditPageUrl = consoleUrl ? new URL("/audit", consoleUrl).toString() : "(set PULSE_CONSOLE_URL to link the audit page)";
  console.log(`\nreview at: ${auditPageUrl}`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      summaryPath,
      `## Nightly audit sample\n\nSampled ${items.length} venue-attributes for review.\n\n[Review at ${auditPageUrl}](${auditPageUrl})\n`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
