# perlite-conformance

Language-agnostic conformance corpus for parsers of the [Obsidian Tasks
plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) markdown dialect, as used
by [Perlite](https://github.com/Perlite-app). Every implementation — Swift today;
TypeScript, Kotlin, and a Windows implementation planned — ships a thin harness that
loads the fixtures here and asserts against them, so "does this parser handle field X
correctly" has one answer instead of one answer per codebase.

- **`SCHEMA.md`** — the fixture format itself: what each of the four fixture shapes
  (line/document/mutation/recurrence-completion) requires, and every three-way
  absent/null/value convention the format relies on. Read this first.
- **`fixtures/<category>/`** — the actual test data, one JSON file per category.
- **`index.json`** — a generated manifest of every fixture (regenerate with
  `node tools/build-index.mjs` after touching `fixtures/`).
- **`REPORT.md`** — the tooling: the validator, the fixture-index freshness check, and
  the format two implementations' results are compared in.
- **`DIFFERENTIAL.md`** — differential fuzzing: generate random cases, run them through
  two implementations, list every case where they disagree.

```sh
node tools/validate.mjs   # validate every fixture + confirm index.json is fresh
```

MIT licensed — use this corpus for any parser of this markdown dialect, not just
Perlite's own implementations.
