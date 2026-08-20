#!/usr/bin/env node
// Generates conformance/index.json from the fixture files on disk. Every implementation's
// harness derives its category list (and, in the count-assertion test, its expected total)
// from this file rather than a hard-coded list of its own — see conformance/REPORT.md.
//
// Usage:
//   node build-index.mjs           regenerate conformance/index.json in place
//   node build-index.mjs --check   exit 1 if the committed index.json is stale (CI mode)

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "./lib.mjs";

const corpusRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(corpusRoot, "fixtures");
const indexPath = join(corpusRoot, "index.json");

const fresh = buildIndex(fixturesDir);
const freshText = JSON.stringify(fresh, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(indexPath)) {
    console.error("conformance/index.json does not exist — run `node build-index.mjs` and commit it.");
    process.exit(1);
  }
  const committed = readFileSync(indexPath, "utf8");
  if (committed !== freshText) {
    console.error("conformance/index.json is stale — run `node build-index.mjs` and commit the result.");
    process.exit(1);
  }
  console.log(`OK — index.json matches the corpus (${fresh.totalFixtures} fixtures across ${fresh.categories.length} categories).`);
} else {
  writeFileSync(indexPath, freshText);
  console.log(`Wrote conformance/index.json — ${fresh.totalFixtures} fixtures across ${fresh.categories.length} categories.`);
}
