#!/usr/bin/env node
// Compares two or more conformance reports (see conformance/REPORT.md for the format
// each implementation's harness emits) and prints only where they disagree. This is the
// direct answer to "no matter the codebase, we know the parsers agree" — a command, not
// an exercise in reading two test logs side by side.
//
// Usage: node diff-reports.mjs <report1.json> <report2.json> [more-reports.json...]

import { readFileSync } from "node:fs";

const paths = process.argv.slice(2);
if (paths.length < 2) {
  console.error("Usage: node diff-reports.mjs <report1.json> <report2.json> [more...]");
  process.exit(2);
}

const reports = paths.map((path) => {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const outcomes = new Map(report.results.map((r) => [r.id, r]));
  return { path, implementation: report.implementation ?? path, outcomes };
});

const allIDs = new Set();
for (const report of reports) for (const id of report.outcomes.keys()) allIDs.add(id);

let disagreements = 0;
let missing = 0;

for (const id of [...allIDs].sort()) {
  const perReport = reports.map((r) => ({ implementation: r.implementation, entry: r.outcomes.get(id) }));

  const absent = perReport.filter((r) => r.entry === undefined);
  if (absent.length > 0) {
    missing++;
    console.log(`MISSING ${id}`);
    for (const r of absent) console.log(`  - ${r.implementation}: fixture not present in this report`);
    continue;
  }

  // Skips don't count toward agreement either way — only implementations that actually
  // attempted the fixture need to agree on pass/fail.
  const attempted = perReport.filter((r) => r.entry.outcome !== "skip");
  const distinctOutcomes = new Set(attempted.map((r) => r.entry.outcome));
  if (distinctOutcomes.size > 1) {
    disagreements++;
    console.log(`DISAGREE ${id}`);
    for (const r of attempted) console.log(`  - ${r.implementation}: ${r.entry.outcome}`);
  }
}

console.log("");
console.log(`${allIDs.size} fixture id(s) compared across ${reports.length} report(s): ${disagreements} disagreement(s), ${missing} missing.`);
process.exit(disagreements > 0 || missing > 0 ? 1 : 0);
