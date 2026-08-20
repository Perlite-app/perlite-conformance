// Shared scan/validation logic for build-index.mjs and validate.mjs. Deliberately
// dependency-free (Node built-ins only) so it runs identically in any CI runner without
// an install step — the corpus's own zero-third-party-dependency discipline, applied to
// its tooling too.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Directory name -> fixture shape. This mapping is the single source of truth for what
// SCHEMA.md calls "the category directory name determines which fixture shape a file
// uses" — everything else (Swift's index-driven category loading, the validator, a
// future TS/Kotlin/C# harness) derives from this, not a hard-coded list of its own.
const SHAPE_BY_DIRECTORY = {
  documents: "document",
  mutations: "mutation",
  "recurrence-completion": "recurrence-completion",
};
const DEFAULT_SHAPE = "line";

export function shapeForDirectory(name) {
  return SHAPE_BY_DIRECTORY[name] ?? DEFAULT_SHAPE;
}

/** Scans `fixturesDir` (the `conformance/fixtures` directory) and returns the same
 * shape `index.json` stores, minus the wrapping `schemaVersion` field. One JSON file
 * per category directory is assumed (matches every implementation's own loader, which
 * lists a directory rather than trusting a fixed filename). */
export function scanFixtures(fixturesDir) {
  const categoryNames = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const categories = categoryNames.map((name) => {
    const dir = join(fixturesDir, name);
    const jsonFiles = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    if (jsonFiles.length !== 1) {
      throw new Error(
        `fixtures/${name}/ must contain exactly one .json file, found ${jsonFiles.length}`
      );
    }
    const file = jsonFiles[0];
    const fixtures = readFixtureFile(join(dir, file));
    const ids = fixtures.map((f) => `${name}/${f.name}`);
    return { name, shape: shapeForDirectory(name), file, count: fixtures.length, ids };
  });

  const totalFixtures = categories.reduce((sum, c) => sum + c.count, 0);
  return { totalFixtures, categories };
}

export function readFixtureFile(path) {
  const raw = readFileSync(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: expected a top-level JSON array of fixtures`);
  }
  return parsed;
}

export function buildIndex(fixturesDir) {
  const scanned = scanFixtures(fixturesDir);
  return { schemaVersion: 1, totalFixtures: scanned.totalFixtures, categories: scanned.categories };
}

// ---------------------------------------------------------------------------
// Validation — enforces the rules SCHEMA.md states in prose but nothing previously
// checked mechanically: unknown keys, required keys, enum vocabularies, and the
// "serialized must equal input" round-trip rule for line fixtures.

const CONFIG_KEYS = ["globalFilter", "filenameAsScheduledDate", "frontmatterTagInheritance"];
const STATUS_KIND_VALUES = ["todo", "done", "cancelled", "custom"];
const PRIORITY_VALUES = ["highest", "high", "medium", "normal", "low", "lowest"];
const MUTATION_OP_VALUES = [
  "setStatus", "setDue", "setScheduled", "setStart", "setReminder",
  "setPriority", "setDescription", "addTag", "removeTag", "setRecurrence",
];

const LINE_EXPECTED_KEYS = [
  "isTask", "status", "indent", "listMarker", "description", "priority",
  "due", "scheduled", "start", "created", "done", "cancelled", "reminder",
  "recurrenceRule", "onCompletion", "id", "blockedBy", "tags", "links",
];
const DATE_FIELD_KEYS = ["due", "scheduled", "start", "created", "done", "cancelled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REMINDER_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

function unknownKeys(obj, allowed) {
  return Object.keys(obj ?? {}).filter((k) => !allowed.includes(k));
}

function isDateLike(value, re) {
  return typeof value === "string" && (value.startsWith("invalid:") || re.test(value));
}

function validateConfig(config, errors, where) {
  if (config === undefined) return;
  for (const key of unknownKeys(config, CONFIG_KEYS)) {
    errors.push(`${where}: config has unknown key "${key}"`);
  }
}

function validateLineFixture(fixture, errors, where) {
  for (const key of unknownKeys(fixture, ["name", "input", "config", "expected", "serialized"])) {
    errors.push(`${where}: unknown top-level key "${key}"`);
  }
  validateConfig(fixture.config, errors, where);
  if (typeof fixture.expected?.isTask !== "boolean") {
    errors.push(`${where}: expected.isTask must be a boolean`);
    return;
  }
  const expected = fixture.expected;
  for (const key of unknownKeys(expected, LINE_EXPECTED_KEYS)) {
    errors.push(`${where}: expected has unknown key "${key}"`);
  }
  if (expected.status !== undefined) {
    for (const key of unknownKeys(expected.status, ["symbol", "kind"])) {
      errors.push(`${where}: expected.status has unknown key "${key}"`);
    }
    if (expected.status.kind !== undefined && !STATUS_KIND_VALUES.includes(expected.status.kind)) {
      errors.push(`${where}: expected.status.kind "${expected.status.kind}" is not one of ${STATUS_KIND_VALUES.join(", ")}`);
    }
  }
  if (expected.priority !== undefined && !PRIORITY_VALUES.includes(expected.priority)) {
    errors.push(`${where}: expected.priority "${expected.priority}" is not one of ${PRIORITY_VALUES.join(", ")}`);
  }
  for (const key of DATE_FIELD_KEYS) {
    const value = expected[key];
    if (value !== undefined && value !== null && !isDateLike(value, DATE_RE)) {
      errors.push(`${where}: expected.${key} "${value}" is not YYYY-MM-DD or "invalid:<raw>"`);
    }
  }
  if (expected.reminder !== undefined && expected.reminder !== null && !isDateLike(expected.reminder, REMINDER_RE)) {
    errors.push(`${where}: expected.reminder "${expected.reminder}" is not a valid reminder shape`);
  }
  if (expected.links !== undefined) {
    for (const [i, link] of expected.links.entries()) {
      for (const key of unknownKeys(link, ["target", "alias"])) {
        errors.push(`${where}: expected.links[${i}] has unknown key "${key}"`);
      }
    }
  }

  if (expected.isTask === false) {
    if (fixture.serialized !== undefined) {
      errors.push(`${where}: expected.isTask is false but "serialized" is present (SCHEMA.md: omit it)`);
    }
    return;
  }
  if (typeof fixture.serialized !== "string") {
    errors.push(`${where}: serialized is required whenever expected.isTask is true`);
  } else if (fixture.serialized !== fixture.input) {
    errors.push(`${where}: serialized must equal input for a line fixture (mutation-exercising fixtures belong in mutations/)`);
  }
}

function validateDocumentFixture(fixture, errors, where) {
  for (const key of unknownKeys(fixture, ["name", "content", "config", "expected"])) {
    errors.push(`${where}: unknown top-level key "${key}"`);
  }
  validateConfig(fixture.config, errors, where);
  if (typeof fixture.expected?.taskCount !== "number") {
    errors.push(`${where}: expected.taskCount must be a number`);
  }
  for (const key of unknownKeys(fixture.expected, ["taskCount", "frontmatterTags", "tasks"])) {
    errors.push(`${where}: expected has unknown key "${key}"`);
  }
  if (fixture.expected?.tasks !== undefined) {
    for (const [i, task] of fixture.expected.tasks.entries()) {
      for (const key of unknownKeys(task, ["description", "indentDepth", "allTags", "parentHeading"])) {
        errors.push(`${where}: expected.tasks[${i}] has unknown key "${key}"`);
      }
    }
  }
}

function validateMutationFixture(fixture, errors, where) {
  for (const key of unknownKeys(fixture, ["name", "input", "config", "mutations", "expectedSerialized"])) {
    errors.push(`${where}: unknown top-level key "${key}"`);
  }
  validateConfig(fixture.config, errors, where);
  if (typeof fixture.expectedSerialized !== "string") {
    errors.push(`${where}: expectedSerialized is required`);
  }
  if (!Array.isArray(fixture.mutations) || fixture.mutations.length === 0) {
    errors.push(`${where}: mutations must be a non-empty array`);
    return;
  }
  for (const [i, mutation] of fixture.mutations.entries()) {
    for (const key of unknownKeys(mutation, ["op", "value"])) {
      errors.push(`${where}: mutations[${i}] has unknown key "${key}"`);
    }
    if (!MUTATION_OP_VALUES.includes(mutation.op)) {
      errors.push(`${where}: mutations[${i}].op "${mutation.op}" is not one of ${MUTATION_OP_VALUES.join(", ")}`);
    }
  }
}

function validateRecurrenceCompletionFixture(fixture, errors, where) {
  for (const key of unknownKeys(fixture, ["name", "input", "today", "config", "expected", "expectRefusal"])) {
    errors.push(`${where}: unknown top-level key "${key}"`);
  }
  validateConfig(fixture.config, errors, where);
  if (!isDateLike(fixture.today, DATE_RE) || fixture.today?.startsWith("invalid:")) {
    errors.push(`${where}: today must be a YYYY-MM-DD string`);
  }
  const hasExpected = fixture.expected !== undefined;
  const hasRefusal = fixture.expectRefusal === true;
  if (hasExpected === hasRefusal) {
    errors.push(`${where}: exactly one of "expected" or "expectRefusal: true" must be present`);
    return;
  }
  if (hasExpected) {
    for (const key of unknownKeys(fixture.expected, ["completedLine", "nextInstanceLine"])) {
      errors.push(`${where}: expected has unknown key "${key}"`);
    }
    if (typeof fixture.expected.completedLine !== "string") {
      errors.push(`${where}: expected.completedLine is required`);
    }
    if (!("nextInstanceLine" in fixture.expected)) {
      errors.push(`${where}: expected.nextInstanceLine must be present (string or explicit null — never omitted here)`);
    }
  }
}

const VALIDATORS_BY_SHAPE = {
  line: validateLineFixture,
  document: validateDocumentFixture,
  mutation: validateMutationFixture,
  "recurrence-completion": validateRecurrenceCompletionFixture,
};

/** Validates one category's fixture array. Returns a flat list of human-readable error
 * strings; an empty array means the category is clean. */
export function validateCategory(shape, fixtures, categoryName) {
  const errors = [];
  const validator = VALIDATORS_BY_SHAPE[shape];
  const seenNames = new Set();
  for (const fixture of fixtures) {
    const where = `${categoryName}/${fixture?.name ?? "<missing name>"}`;
    if (typeof fixture?.name !== "string" || fixture.name.length === 0) {
      errors.push(`${categoryName}: a fixture is missing a non-empty "name"`);
      continue;
    }
    if (seenNames.has(fixture.name)) {
      errors.push(`${where}: duplicate fixture name within ${categoryName}/`);
    }
    seenNames.add(fixture.name);
    validator(fixture, errors, where);
  }
  return errors;
}
