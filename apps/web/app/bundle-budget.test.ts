import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// F1.5: Mapbox GL JS must load only on the map toggle, in its own dynamic
// chunk — never in the JS the browser has to parse before the feed even
// paints. This runs a real `next build` and inspects its output rather than
// grepping source, because the thing that actually matters is what
// Next/webpack decided to put in the initial chunk graph, not what
// list-map-toggle.tsx's dynamic() call merely intends.
const APP_DIR = path.resolve(__dirname, "..");
const NEXT_DIR = path.join(APP_DIR, ".next");
const APP_BUILD_MANIFEST = path.join(NEXT_DIR, "app-build-manifest.json");

beforeAll(() => {
  execSync("pnpm exec next build", {
    cwd: APP_DIR,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
}, 300_000);

interface AppBuildManifest {
  pages: Record<string, string[]>;
}

function readManifest(): AppBuildManifest {
  return JSON.parse(readFileSync(APP_BUILD_MANIFEST, "utf8")) as AppBuildManifest;
}

// The manifest keys pages by route, not URL — the root route is "/page".
function rootPageChunks(manifest: AppBuildManifest): string[] {
  const chunks = manifest.pages["/page"];
  if (!chunks) throw new Error(`app-build-manifest.json has no "/page" entry — keys were: ${Object.keys(manifest.pages).join(", ")}`);
  return chunks.filter((chunk) => chunk.endsWith(".js"));
}

describe("bundle budget", () => {
  it("never puts mapbox-gl in the root page's initial JS chunk graph", () => {
    const manifest = readManifest();
    const chunks = rootPageChunks(manifest);
    expect(chunks.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const chunk of chunks) {
      const chunkPath = path.join(NEXT_DIR, chunk);
      if (!existsSync(chunkPath)) continue;
      const source = readFileSync(chunkPath, "utf8");
      if (/mapbox-gl/i.test(source)) offenders.push(chunk);
    }

    expect(offenders).toEqual([]);
  });
});
