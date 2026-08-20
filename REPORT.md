# Conformance tooling: index, validation, and cross-implementation reports

This corpus is the contract between every parser implementation (Swift today;
TypeScript, Kotlin, and a Windows implementation are planned per the roadmap). The rules
themselves live in `SCHEMA.md`; this document covers the tooling that keeps the corpus
itself honest and lets two implementations' results be compared mechanically instead of
by reading two test logs side by side.

## Fixture identity

Every fixture has a **fully-qualified id**: `<category>/<name>`, e.g.
`status/status-todo` or `mutations/mutation-set-due-replaces-existing-value-only`. This
is the identifier every tool and every implementation's harness uses — `name` alone is
only unique within its own category's file.

## `index.json`

A generated, committed manifest of the whole corpus:

```json
{
  "schemaVersion": 1,
  "totalFixtures": 119,
  "categories": [
    { "name": "status", "shape": "line", "file": "status.json", "count": 13,
      "ids": ["status/status-todo", "..."] }
  ]
}
```

`shape` is one of `line | document | mutation | recurrence-completion` — the four
fixture shapes `SCHEMA.md` defines. This is what lets a harness discover categories from
data instead of hard-coding a list that a new category directory could silently miss.

Regenerate after adding, removing, or renaming any fixture:

```sh
node tools/build-index.mjs          # regenerate in place
node tools/build-index.mjs --check  # exit 1 if the committed file is stale (CI)
```

## `validate.mjs`

Validates every fixture against the rules `SCHEMA.md` states in prose (required keys,
unknown keys, enum vocabularies, the `serialized == input` round-trip rule for line
fixtures) and confirms `index.json` is fresh. Dependency-free Node, so it runs on any CI
runner with no install step:

```sh
node tools/validate.mjs
```

This is the one check that protects every implementation from a malformed or drifted
fixture — run centrally here, not reimplemented per language.

## What an implementation's harness must do

1. **Load categories from `index.json`**, not a list of its own — a category the harness
   doesn't yet know how to run belongs in that implementation's skip file (below), not in
   a code-level omission that silently drops it.
2. **Assert its own fixture count.** Sum of fixtures actually executed, plus fixtures
   declared skipped, must equal `index.json`'s `totalFixtures`. This is the specific
   check that turns "the corpus submodule wasn't initialized" or "a category directory
   went missing" from a silently-green suite into a loud failure.
3. **Declare skips explicitly.** A repo that doesn't yet implement every fixture shape
   (e.g. a plugin bringing up line fixtures before mutation fixtures) commits its own
   `conformance-skips.json` at its repo root:
   ```json
   [
     { "id": "documents/document-nested-subtasks", "reason": "document parser not ported yet" }
   ]
   ```
   A skipped fixture is reported `outcome: "skip"`, never silently dropped from the
   count. An id present in `index.json` that is neither executed nor declared skipped is
   a hard failure.

## The report format

Each harness *may* emit a report in this shape (a diff needs at least two to compare):

```json
{
  "corpusVersion": 1,
  "corpusCommit": "abc1234",
  "implementation": "swift",
  "results": [
    { "id": "status/status-todo", "outcome": "pass" },
    { "id": "documents/document-nested-subtasks", "outcome": "skip",
      "reason": "declared: document parser not ported yet" },
    { "id": "dates/date-malformed", "outcome": "fail",
      "reason": "expected .invalid(raw:), got .valid" }
  ]
}
```

`corpusCommit` is the corpus repo's commit the run was checked out at — load-bearing for
a meaningful diff, since two reports generated against different corpus versions aren't
comparable.

## Comparing two implementations

```sh
node tools/diff-reports.mjs swift-report.json typescript-report.json
```

Prints only where two (or more) reports disagree on a fixture both actually attempted
(a `skip` on one side while another passes or fails is not a disagreement — it just means
one implementation hasn't gotten there yet), plus any id present in one report but
missing from another entirely. Exits non-zero on any disagreement or missing id, so this
is CI-wireable directly: run it as a step once more than one implementation's report is
available.

## Why this exists

Nothing about the fixtures themselves changes because of this tooling — `SCHEMA.md`
remains the actual contract. This tooling exists so that a stale checkout, a partially
ported category, or an implementation genuinely disagreeing with another produces a loud,
specific failure instead of the pre-existing state, where an empty or partial corpus
checkout produced a silently green test suite in every implementation.
