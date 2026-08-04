// CI gate for F2.4's provenance invariant: nothing under apps/web may
// import the venue_attributes table directly (as `venueAttributes`, static
// or dynamic import from @pulse/db) — every venue attribute shown to a
// visitor must come through getVenueForCard/getFeedVenues
// (packages/db/src/provenance.ts), which can only return the
// AttributeView union. apps/console is intentionally NOT scanned: the
// curator console reads and writes venue_attributes directly by design
// (curator-facing editing, see apps/console/lib/venue-store.ts and
// queue-store.ts) — the invariant this guards is about what an anonymous
// visitor can be shown, not about curator tooling.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCANNABLE_EXTENSIONS = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "e2e"]);

// Matches both:
//   import { ..., venueAttributes, ... } from "@pulse/db"
//   const { ..., venueAttributes, ... } = await import("@pulse/db")
const IMPORT_PATTERN =
  /import\s*\{([^}]*)\}\s*from\s*["'](@pulse\/db[^"']*)["']|(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s*import\(\s*["'](@pulse\/db[^"']*)["']\s*\)/g;

function importsBindingNamed(bindingList: string, name: string): boolean {
  return bindingList
    .split(",")
    .map((binding) => binding.trim().split(/\s+as\s+/)[0]?.trim())
    .includes(name);
}

function findViolationsInFile(contents: string): boolean {
  for (const match of contents.matchAll(IMPORT_PATTERN)) {
    const bindings = match[1] ?? match[3];
    const specifier = match[2] ?? match[4];
    if (!bindings || !specifier) continue;
    if (specifier !== "@pulse/db") continue;
    if (importsBindingNamed(bindings, "venueAttributes")) return true;
  }
  return false;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (SCANNABLE_EXTENSIONS.includes(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

// Exported so both the CLI (scripts/check-no-direct-attribute-import.ts) and
// the fixture-driven test (attribute-import-guard.test.ts) can point this at
// any directory — the real apps/web/app, or scripts/__fixtures__/direct-attribute-import.
export function findDirectAttributeImportViolations(rootDir: string): string[] {
  const violations: string[] = [];
  for (const file of walk(rootDir)) {
    if (findViolationsInFile(readFileSync(file, "utf-8"))) {
      violations.push(path.relative(rootDir, file));
    }
  }
  return violations.sort();
}
