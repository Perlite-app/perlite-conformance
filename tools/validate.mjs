#!/usr/bin/env node
// Validates every fixture in the corpus against the rules conformance/SCHEMA.md states in
// prose, and confirms conformance/index.json is fresh. Language-agnostic and dependency-
// free by design — this is the one check every implementation (Swift, TypeScript, Kotlin,
// C#) relies on to protect it from a malformed or drifted fixture, run once here rather
// than reimplemented per language.
//
// Usage: node validate.mjs

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanFixtures, readFixtureFile, validateCategory } from "./lib.mjs";

const corpusRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(corpusRoot, "fixtures");
const indexPath = join(corpusRoot, "index.json");

let errors = [];

let scanned;
try {
  scanned = scanFixtures(fixturesDir);
} catch (error) {
  console.error(`FAIL: could not scan fixtures/: ${error.message}`);
  process.exit(1);
}

// Freshness: index.json must match a fresh scan exactly, byte for byte modulo the
// wrapping schemaVersion field this scan doesn't produce on its own.
if (!existsSync(indexPath)) {
  errors.push("conformance/index.json does not exist — run `node tools/build-index.mjs`.");
} else {
  const committed = JSON.parse(readFileSync(indexPath, "utf8"));
  if (committed.totalFixtures !== scanned.totalFixtures ||
      JSON.stringify(committed.categories) !== JSON.stringify(scanned.categories)) {
    errors.push("conformance/index.json is stale — run `node tools/build-index.mjs` and commit the result.");
  }
}

// Global id uniqueness across every category, not just within one.
const seenIDs = new Map();
for (const category of scanned.categories) {
  for (const id of category.ids) {
    if (seenIDs.has(id)) {
      errors.push(`duplicate fixture id "${id}" in both ${seenIDs.get(id)} and ${category.name}`);
    }
    seenIDs.set(id, category.name);
  }
}

// Per-fixture shape/content validation.
for (const category of scanned.categories) {
  const fixtures = readFixtureFile(join(fixturesDir, category.name, category.file));
  errors.push(...validateCategory(category.shape, fixtures, category.name));
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} problem(s) found:\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK — ${scanned.totalFixtures} fixtures across ${scanned.categories.length} categories, all valid, index.json fresh.`);
