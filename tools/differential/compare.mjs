// Differential fuzzing, step 3: compare two implementations' results for the same cases.
//
//   node tools/differential/compare.mjs cases.jsonl swift.jsonl typescript.jsonl [--examples N] [--json out.json]
//
// Groups every disagreement by case kind and the first field that differs, so one root
// cause shows up as one group (with a count and a few of the shortest examples) instead of
// thousands of lines. Exits 1 when anything disagrees or a case is missing from a side.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const positional = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && !all[i - 1]?.startsWith("--"));
const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
if (positional.length !== 3) {
  console.error("usage: compare.mjs cases.jsonl a.jsonl b.jsonl [--examples N] [--json out.json]");
  process.exit(2);
}
const [casesPath, aPath, bPath] = positional;
const exampleCount = Number(option("examples", 3));

const readJsonl = (path) =>
  new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line))
      .map((entry) => [entry.id, entry]),
  );
const cases = readJsonl(casesPath);
const a = readJsonl(aPath);
const b = readJsonl(bPath);
const [aName, bName] = [aPath, bPath].map((path) => basename(path).replace(/\.jsonl$/, ""));

/** The first path (`tasks[2].description`) at which two JSON values differ, or null. */
function firstDifference(x, y, path = "") {
  if (Object.is(x, y)) return null;
  if (typeof x !== typeof y || x === null || y === null || typeof x !== "object" || Array.isArray(x) !== Array.isArray(y)) return path || "(root)";
  if (Array.isArray(x)) {
    if (x.length !== y.length) {
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const inner = firstDifference(x[i], y[i], `${path}[${i}]`);
        if (inner !== null) return inner;
      }
      return `${path}.length`;
    }
    for (let i = 0; i < x.length; i++) {
      const inner = firstDifference(x[i], y[i], `${path}[${i}]`);
      if (inner !== null) return inner;
    }
    return null;
  }
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const inner = firstDifference(x[key], y[key], path === "" ? key : `${path}.${key}`);
    if (inner !== null) return inner;
  }
  return null;
}
const valueAt = (value, path) =>
  path === "(root)" ? value : path.replace(/\[(\d+)\]/g, ".$1").replace(/\.length$/, "").split(".").reduce((v, key) => (v == null ? v : v[key]), value);

const groups = new Map();
const missing = [];
let agreed = 0;
for (const [id, testCase] of cases) {
  const left = a.get(id);
  const right = b.get(id);
  if (left === undefined || right === undefined) {
    missing.push({ id, missingFrom: [left === undefined ? aName : null, right === undefined ? bName : null].filter(Boolean) });
    continue;
  }
  const path = firstDifference(left.result, right.result);
  if (path === null) {
    agreed++;
    continue;
  }
  // Index paths collapse (tasks[3].x → tasks[].x) so the same bug on different tasks groups together.
  const key = `${testCase.kind} · ${path.replace(/\[\d+\]/g, "[]")}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ id, case: testCase, path, [aName]: valueAt(left.result, path), [bName]: valueAt(right.result, path) });
}

const size = (entry) => JSON.stringify(entry.case).length;
const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
console.log(`${cases.size} cases · ${agreed} agree · ${cases.size - agreed - missing.length} disagree in ${groups.size} group(s) · ${missing.length} missing`);
for (const [key, entries] of sorted) {
  console.log(`\n■ ${key} — ${entries.length} case(s)`);
  for (const entry of [...entries].sort((x, y) => size(x) - size(y)).slice(0, exampleCount)) {
    const { kind, id, ...input } = entry.case;
    console.log(`  ${entry.id}  ${JSON.stringify(input)}`);
    console.log(`    ${entry.path}: ${aName}=${JSON.stringify(entry[aName])}  ${bName}=${JSON.stringify(entry[bName])}`);
  }
}
for (const entry of missing.slice(0, 10)) console.log(`missing ${entry.id} from ${entry.missingFrom.join(", ")}`);

const out = option("json", null);
if (out !== null) writeFileSync(out, JSON.stringify({ agreed, missing, groups: Object.fromEntries(sorted) }, null, 1));
process.exit(groups.size > 0 || missing.length > 0 ? 1 : 0);
