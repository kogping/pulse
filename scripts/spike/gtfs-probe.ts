/**
 * TfNSW Open Data spike — NOT part of the app build.
 *
 * Measures the three unknowns that decide the F3 (transport) build:
 *   1. static GTFS bundle: download size, unzip time, row counts, parse time
 *   2. GTFS-Realtime trip-update feed: payload size, decode time, cadence
 *   3. practical rate-limit ceiling on the realtime endpoint
 *
 * Usage:
 *   TFNSW_API_KEY=... pnpm spike:gtfs-probe static <mode>
 *   TFNSW_API_KEY=... pnpm spike:gtfs-probe realtime <feed> [--minutes=10]
 *   TFNSW_API_KEY=... pnpm spike:gtfs-probe hammer <feed>
 *
 * Modes (static):   sydneytrains | buses | metro | nswtrains |
 *                    ferries/sydneyferries | lightrail/innerwest |
 *                    lightrail/cbdandsoutheast
 * Feeds (realtime): buses | ferries/sydneyferries | lightrail/innerwest |
 *                    lightrail/cbdandsoutheast | nswtrains |
 *                    v2/sydneytrains | v2/metro | v2/lightrail/innerwest
 *
 * Results are written as JSON next to this script under ./results/.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const BASE_URL = "https://api.transport.nsw.gov.au";

function apiKey(): string {
  const key = process.env.TFNSW_API_KEY;
  if (!key) {
    console.error("Set TFNSW_API_KEY (see .env.local at repo root).");
    process.exit(1);
  }
  return key;
}

function authHeader(): Record<string, string> {
  return { Authorization: `apikey ${apiKey()}` };
}

async function fetchBinary(url: string): Promise<{ buf: Buffer; res: Response; ms: number }> {
  const start = performance.now();
  const res = await fetch(url, { headers: authHeader() });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = performance.now() - start;
  return { buf, res, ms };
}

// ---------- static bundle probe ----------

async function probeStatic(mode: string) {
  const url = `${BASE_URL}/v1/gtfs/schedule/${mode}`;
  console.log(`Downloading static GTFS for "${mode}" from ${url}`);

  const { buf, res, ms: downloadMs } = await fetchBinary(url);
  if (!res.ok) {
    console.error(`Download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const zipBytes = buf.length;
  console.log(`  downloaded ${(zipBytes / 1024 / 1024).toFixed(1)} MB in ${downloadMs.toFixed(0)} ms`);

  const workDir = mkdtempSync(path.join(tmpdir(), "gtfs-probe-"));
  const zipPath = path.join(workDir, "bundle.zip");
  writeFileSync(zipPath, buf);

  const unzipStart = performance.now();
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", workDir]);
  const unzipMs = performance.now() - unzipStart;
  console.log(`  unzipped in ${unzipMs.toFixed(0)} ms`);

  const files = readdirSync(workDir).filter((f) => f.endsWith(".txt"));
  const parseStart = performance.now();
  const rowCounts: Record<string, number> = {};
  let uncompressedBytes = 0;
  for (const file of files) {
    const filePath = path.join(workDir, file);
    uncompressedBytes += statSync(filePath).size;
    const content = readFileSync(filePath, "utf8");
    // GTFS text files: one record per line, minus the header. Good enough
    // for a row-count estimate — none of the launch-relevant files here
    // (stops/routes/trips/stop_times/calendar) embed newlines in fields.
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    rowCounts[file] = Math.max(lines.length - 1, 0);
  }
  const parseMs = performance.now() - parseStart;
  console.log(`  parsed ${files.length} files (${(uncompressedBytes / 1024 / 1024).toFixed(1)} MB uncompressed) in ${parseMs.toFixed(0)} ms`);

  rmSync(workDir, { recursive: true, force: true });

  const result = {
    mode,
    url,
    zipBytes,
    downloadMs,
    unzipMs,
    uncompressedBytes,
    parseMs,
    totalMs: downloadMs + unzipMs + parseMs,
    rowCounts,
    lastModified: res.headers.get("last-modified"),
    contentDisposition: res.headers.get("content-disposition"),
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `static-${mode.replace(/\//g, "_")}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`  wrote ${outPath}`);
  return result;
}

// ---------- realtime cadence probe ----------

function decode(buf: Buffer) {
  const start = performance.now();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  const decodeMs = performance.now() - start;
  return { feed, decodeMs };
}

async function probeRealtime(feedName: string, minutes: number) {
  const url = `${BASE_URL}/v1/gtfs/realtime/${feedName}`;
  console.log(`Polling realtime feed "${feedName}" from ${url} for ${minutes} minutes`);

  const samples: Array<{
    t: string;
    payloadBytes: number;
    decodeMs: number;
    fetchMs: number;
    entityCount: number;
    feedTimestamp: number | null;
    lastModifiedHeader: string | null;
  }> = [];

  const deadline = Date.now() + minutes * 60_000;
  let lastFeedTimestamp: number | null = null;
  const changeIntervalsSec: number[] = [];
  let lastChangeAt: number | null = null;

  while (Date.now() < deadline) {
    const { buf, res, ms: fetchMs } = await fetchBinary(url);
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} — skipping sample`);
      await sleep(15_000);
      continue;
    }
    const { feed, decodeMs } = decode(buf);
    const feedTimestamp = feed.header?.timestamp ? Number(feed.header.timestamp) : null;

    if (feedTimestamp !== null && feedTimestamp !== lastFeedTimestamp) {
      if (lastChangeAt !== null) {
        changeIntervalsSec.push((Date.now() - lastChangeAt) / 1000);
      }
      lastChangeAt = Date.now();
      lastFeedTimestamp = feedTimestamp;
    }

    samples.push({
      t: new Date().toISOString(),
      payloadBytes: buf.length,
      decodeMs,
      fetchMs,
      entityCount: feed.entity.length,
      feedTimestamp,
      lastModifiedHeader: res.headers.get("last-modified"),
    });
    console.log(
      `  ${new Date().toISOString()} payload=${(buf.length / 1024).toFixed(0)}KB decode=${decodeMs.toFixed(1)}ms entities=${feed.entity.length}`,
    );

    await sleep(15_000);
  }

  const result = {
    feedName,
    url,
    minutes,
    sampleCount: samples.length,
    avgPayloadBytes: avg(samples.map((s) => s.payloadBytes)),
    avgDecodeMs: avg(samples.map((s) => s.decodeMs)),
    observedChangeIntervalsSec: changeIntervalsSec,
    medianObservedCadenceSec: median(changeIntervalsSec),
    samples,
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `realtime-${feedName.replace(/\//g, "_")}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`  wrote ${outPath}`);
  return result;
}

// ---------- rate-limit hammer ----------

async function hammer(feedName: string) {
  const url = `${BASE_URL}/v1/gtfs/realtime/${feedName}`;
  console.log(`Hammering ${url} to find the practical rate-limit ceiling`);

  // TfNSW documents 5 req/sec (Bronze plan) and returns HTTP 403 with
  // X-Error-Detail: 'Account Over Rate Limit' when exceeded — not 429.
  // We ramp concurrency and back off on either 429 or 403.
  const attempts: Array<{ t: string; status: number; ms: number; errorDetail: string | null }> = [];
  let concurrency = 1;
  let consecutiveThrottles = 0;
  let ceilingReqPerSec: number | null = null;

  for (let round = 0; round < 30 && ceilingReqPerSec === null; round++) {
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const t0 = performance.now();
        const res = await fetch(url, { headers: authHeader() });
        await res.arrayBuffer();
        return { status: res.status, ms: performance.now() - t0, errorDetail: res.headers.get("x-error-detail") };
      }),
    );
    const elapsedSec = (performance.now() - start) / 1000;
    for (const r of results) {
      attempts.push({ t: new Date().toISOString(), status: r.status, ms: r.ms, errorDetail: r.errorDetail });
    }

    const throttled = results.some((r) => r.status === 429 || r.status === 403);
    console.log(`  round ${round}: concurrency=${concurrency} -> statuses=${results.map((r) => r.status).join(",")}`);

    if (throttled) {
      consecutiveThrottles++;
      ceilingReqPerSec = Math.max(concurrency - 1, 1) / Math.max(elapsedSec, 1);
      console.log(`  throttled at concurrency=${concurrency}; backing off`);
      await sleep(5000 * consecutiveThrottles); // exponential backoff
    } else {
      concurrency += 1;
      await sleep(1000);
    }
  }

  const result = {
    feedName,
    url,
    documentedThrottle: "5 requests/sec (Bronze plan), 60,000/day",
    observedCeilingReqPerSec: ceilingReqPerSec,
    attempts,
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `hammer-${feedName.replace(/\//g, "_")}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`  wrote ${outPath}`);
  return result;
}

// ---------- helpers ----------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------- entrypoint ----------

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  if (!cmd || !arg) {
    console.error("Usage: gtfs-probe.ts <static|realtime|hammer> <mode|feed> [--minutes=10]");
    process.exit(1);
  }

  if (cmd === "static") {
    await probeStatic(arg);
  } else if (cmd === "realtime") {
    const minutesArg = rest.find((a) => a.startsWith("--minutes="));
    const minutes = minutesArg ? Number(minutesArg.split("=")[1]) : 10;
    await probeRealtime(arg, minutes);
  } else if (cmd === "hammer") {
    await hammer(arg);
  } else {
    console.error(`Unknown command "${cmd}"`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
