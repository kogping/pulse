import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N = 50;
const P75_BUDGET_MS = 250;
const EXPECTED_REGION = "syd1";

interface LatencyResponse {
  region: string | null;
  dbMs: number;
  redisMs: number;
  totalMs: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

async function main() {
  const deploymentUrl = process.argv[2] ?? process.env.LATENCY_URL;
  if (!deploymentUrl) {
    console.error("Usage: tsx scripts/latency-smoke.ts <deployed-url>  (or set LATENCY_URL)");
    process.exit(1);
    return;
  }

  const endpoint = new URL("/api/_latency", deploymentUrl).toString();
  const roundTripMs: number[] = [];
  let region: string | null = null;

  for (let i = 0; i < N; i++) {
    const start = performance.now();
    const res = await fetch(endpoint, { cache: "no-store" });
    const elapsed = performance.now() - start;

    if (!res.ok) {
      console.error(`request ${i + 1}/${N} failed: HTTP ${res.status}`);
      process.exit(1);
      return;
    }

    const body = (await res.json()) as LatencyResponse;
    region = body.region;
    roundTripMs.push(elapsed);
  }

  const sorted = [...roundTripMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p95 = percentile(sorted, 95);

  console.log(`endpoint: ${endpoint}`);
  console.log(`region:   ${region}`);
  console.log(`samples:  ${N}`);
  console.log(`p50:      ${p50.toFixed(1)}ms`);
  console.log(`p75:      ${p75.toFixed(1)}ms`);
  console.log(`p95:      ${p95.toFixed(1)}ms`);

  const today = new Date().toISOString().slice(0, 10);
  const baselinesDir = path.resolve(__dirname, "..", "docs", "baselines");
  mkdirSync(baselinesDir, { recursive: true });
  const outPath = path.join(baselinesDir, `latency-${today}.md`);

  writeFileSync(
    outPath,
    `# Latency baseline — ${today}

- Deployment URL: ${deploymentUrl}
- Endpoint: ${endpoint}
- Reported region: ${region}
- Samples: ${N}

| Percentile | Round trip |
| ---------- | ---------- |
| p50        | ${p50.toFixed(1)}ms |
| p75        | ${p75.toFixed(1)}ms |
| p95        | ${p95.toFixed(1)}ms |
`,
  );
  console.log(`\nwrote ${outPath}`);

  let failed = false;
  if (region !== EXPECTED_REGION) {
    console.error(`FAIL: reported region is "${region}", expected "${EXPECTED_REGION}"`);
    failed = true;
  }
  if (p75 > P75_BUDGET_MS) {
    console.error(`FAIL: p75 round trip ${p75.toFixed(1)}ms exceeds ${P75_BUDGET_MS}ms budget`);
    failed = true;
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
