// CI gate for the expand/contract invariant: a migration file that drops a
// column or table must ship with a companion "<name>.contract.sql" file
// (the follow-up PR in the two-PR sequence) proving the drop was reviewed
// as a deliberate contract step, not slipped in as an ordinary migration.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../migrations");
const DESTRUCTIVE_PATTERN = /\bDROP\s+(COLUMN|TABLE)\b/i;

function findViolations(dir: string): string[] {
  const allFiles = readdirSync(dir);
  const migrationFiles = allFiles.filter((f) => f.endsWith(".sql") && !f.endsWith(".contract.sql"));
  const violations: string[] = [];

  for (const file of migrationFiles) {
    const contents = readFileSync(path.join(dir, file), "utf-8");
    if (!DESTRUCTIVE_PATTERN.test(contents)) continue;

    const companion = file.replace(/\.sql$/, ".contract.sql");
    if (!allFiles.includes(companion)) {
      violations.push(
        `${file} contains DROP COLUMN/TABLE but has no companion ${companion}. ` +
          `Destructive changes require a two-PR expand/contract sequence.`,
      );
    }
  }

  return violations;
}

const violations = findViolations(MIGRATIONS_DIR);
if (violations.length > 0) {
  console.error("Destructive migration check failed:\n");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log("Destructive migration check passed.");
