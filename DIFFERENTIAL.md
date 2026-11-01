# Differential fuzzing

The fixtures say what the right answer is for cases someone thought of. Differential
fuzzing finds the cases nobody thought of: generate a large batch of random inputs, run
the same batch through two implementations, and list every input where they disagree.
Neither side is assumed right. A disagreement means at least one is wrong; a shrunk
version of the case then becomes a real fixture with the correct answer.

```sh
node tools/differential/generate.mjs --seed 7 > cases.jsonl
perlite-roundtrip differential cases.jsonl > swift.jsonl          # perlite-app/PerliteCore
node Scripts/differential.mjs cases.jsonl > typescript.jsonl      # perlite-obsidian
node tools/differential/compare.mjs cases.jsonl swift.jsonl typescript.jsonl
```

`compare.mjs` groups disagreements by case kind and the first field that differs, and
prints the shortest few examples of each group, so one bug reads as one group. It exits
1 on any disagreement or missing case. `--json out.json` keeps every example.

## Cases

`generate.mjs` writes one JSON object per line. The same seed always produces the same
file (SplitMix64, as PerliteCore's own round-trip fuzz test uses). Defaults: 20,000
lines, 2,000 documents, 5,000 mutations, 5,000 completions; `--lines`, `--documents`,
`--mutations`, `--completions` change them.

Every case has an `id`, a `kind` and a `config` (the shared `config` object from
`SCHEMA.md`, same absent/null rules). By kind:

| kind | other fields |
|---|---|
| `line` | `input` — one line |
| `document` | `content` — a whole file: frontmatter, headings, fences, tasks, with `\n`, `\r\n`, mixed or lone-`\r` line endings |
| `mutation` | `input`, `mutations` — the ops from `SCHEMA.md`, applied in order |
| `completion` | `input`, `today` — always a real date |

The generator mixes well-formed fields with malformed ones and junk: every date emoji
(with and without U+FE0F), invalid and signed dates, reminder times, recurrence rules
the grammar does and doesn't know, ids and dependencies, wiki links, code spans, block
ids, tags with punctuation, and every whitespace character on the edge of the
definition in `SCHEMA.md`. Mutation and completion cases start from well-formed task
lines so most of them reach the code they test.

## Results

Each implementation prints one line per case: `{"id": "...", "result": {...}}`. A case
that throws inside the harness itself prints `{"crashed": "<message>"}` — the other side
may not crash on the same input. Dates use the `SCHEMA.md` convention (`"YYYY-MM-DD"`,
`"YYYY-MM-DD HH:mm"` for reminders, `"invalid:<raw>"`, or `null`).

- **line** — `{"isTask": false}` when the line is rejected, otherwise every field a line
  fixture can check (`status`, `indent`, `listMarker`, `description`, `priority`, the
  six dates, `reminder`, `recurrenceRule`, `onCompletion`, `id`, `blockedBy`, `tags`,
  `links`) plus `indentDepth` and `serialized`.
- **document** — `taskCount`, `frontmatterTags`, `roundTrips` (reserialising gives back
  `content` exactly) and `tasks[]`: `line` (0-based), `raw`, `description`,
  `indentDepth`, `allTags` (sorted by UTF-16 code unit, as JavaScript's `sort()` does)
  and `parentHeading`.
- **mutation** — `{"ok": true, "serialized": "..."}`, or `{"ok": false, "failedAt": n}`
  where `n` is the failing mutation's index, `-1` when the input isn't a task.
- **completion** — `{"completedLine", "nextInstanceLine"}`, `{"refused": true}`, or
  `{"isTask": false}`.

Agreement doesn't prove both are right — a bug both share stays invisible. So also
check the properties that must always hold: every parsed line's `serialized` equals its
input, and every document `roundTrips`.

## What it has found

The first runs (November 2026, 256,000 cases over eight seeds) turned up, all now
fixtures:

- **TypeScript:** recurrence arithmetic through `Date.UTC` mapped years 0–99 to
  1900–1999.
- **Swift:** recurrence arithmetic through Foundation's `Calendar` switched to the
  Julian calendar before October 1582; `Int(_:)` accepted signed dates and times
  (`+202-01-05`, `+9:30`).
- **Both:** different whitespace — Swift trimmed and split on Foundation's sets, the
  plugin on JavaScript's. Now JavaScript's on both sides (see `SCHEMA.md`).
- **Harness:** Foundation's `JSONSerialization` drops a leading U+FEFF from string
  values; the Swift side decodes cases with `JSONDecoder` instead.
