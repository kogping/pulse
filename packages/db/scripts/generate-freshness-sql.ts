// Regenerates migrations/0001_attribute_confidence.sql from
// src/freshness.ts. Run after editing DECAY_RULES or ATTRIBUTE_CLASSES,
// then commit the diff. freshness.test.ts fails CI if the checked-in file
// ever falls out of sync with a fresh render of generateMigrationSql().
import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateMigrationSql } from "../src/freshness.sql";

const outPath = path.join(import.meta.dirname, "../migrations/0001_attribute_confidence.sql");
writeFileSync(outPath, generateMigrationSql());
console.log(`Wrote ${outPath}`);
