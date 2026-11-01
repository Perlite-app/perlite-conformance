# Conformance corpus schema

Language-agnostic contract between every implementation of the Obsidian Tasks parser
(Swift today; TypeScript for the Obsidian plugin, Kotlin for Android, and a Windows
implementation are planned per the roadmap). Each implementation ships a thin harness
that loads these fixtures and asserts against them. A parser change is not complete
until the corpus is updated and every implementation passes.

Fixtures live under `fixtures/<category>/`, one JSON file per category holding an array
of fixture objects. A fixture's fully-qualified id — the identifier every tool and every
implementation's harness uses, since `name` alone is only unique within its own
category — is `<category>/<name>`.

The category directory name determines which of the four fixture shapes below the file
uses:

- `documents/` → **document fixtures**
- `mutations/` → **mutation fixtures**
- `recurrence-completion/` → **recurrence completion fixtures**
- everything else (`status/`, `dates/`, `priority/`, `tags/`, `links/`, `recurrence/`,
  `dependencies/`, `preservation/`, `whitespace/`) → **line fixtures**

## Text the parser sees

- **Whitespace** is JavaScript's: what `\s` and `String.prototype.trim` match — tab,
  line feed, `\v`, `\f`, `\r`, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029,
  U+202F, U+205F, U+3000 and U+FEFF. That's the Tasks plugin's own definition. It is
  wider than Foundation's `.whitespaces` and, unlike `Character.isWhitespace`, does not
  include U+0085. Every place an implementation trims or splits on whitespace uses it
  (`whitespace/` pins the edges).
- **Dates and times** are ASCII digits only: `+202-01-05` is a malformed date and
  `+9:30` is not a time.
- **Calendar arithmetic** (recurrence) is on the proleptic Gregorian calendar for every
  year, as moment.js does — no Julian switch in 1582, and years below 100 are not
  shifted into the 1900s.
- **No byte-order mark.** Obsidian's `vault.read` and Foundation's
  `String(contentsOf:encoding:)` both drop a leading U+FEFF before a parser sees the
  file (and neither writes one back), so no fixture starts with one.

## Shared `config` object

Present (optionally) on every fixture. Any omitted key uses the parser's real-world
default, **not** an empty/permissive default — `globalFilter` in particular defaults to
`"#task"` when the key is absent, matching production behaviour (§6.2 of the MVP spec:
assume the filter is on). Pass `"globalFilter": null` explicitly to disable it.

```json
{
  "globalFilter": "#task",
  "filenameAsScheduledDate": false,
  "frontmatterTagInheritance": false
}
```

## Line fixtures

One input line, its expected parsed fields, and its expected serialised output (which is
the input unchanged, for every fixture in this corpus — mutation fixtures are separate).

```json
{
  "name": "due-date-with-tag",
  "input": "- [ ] Buy milk #task #errands 📅 2026-08-13",
  "config": { "globalFilter": "#task" },
  "expected": {
    "isTask": true,
    "status": { "symbol": " ", "kind": "todo" },
    "indent": "",
    "listMarker": "- ",
    "description": "Buy milk #errands",
    "priority": "normal",
    "due": "2026-08-13",
    "scheduled": null,
    "start": null,
    "created": null,
    "done": null,
    "cancelled": null,
    "recurrenceRule": null,
    "onCompletion": null,
    "id": null,
    "blockedBy": [],
    "tags": ["#errands"],
    "links": []
  },
  "serialized": "- [ ] Buy milk #task #errands 📅 2026-08-13"
}
```

Rules:

- `expected.isTask: false` means the line must be rejected — either not a checklist item
  at all, or excluded by the configured global filter. No other `expected` keys are
  checked in that case, and `serialized` is omitted.
- Every field under `expected` besides `isTask` is optional; an absent key is not
  checked. This keeps single-field fixtures short — a fixture about `due` need not spell
  out `scheduled: null`, `start: null`, etc.
- Date fields (`due`, `scheduled`, `start`, `created`, `done`, `cancelled`) are either an
  ISO `YYYY-MM-DD` string (must parse as `.valid`), or `"invalid:<raw text>"` (must parse
  as `.invalid(raw: "<raw text>")`) for malformed-date fixtures.
- `reminder` (chunk 22, the `⏰` field) follows the same convention, plus an optional
  time: `"YYYY-MM-DD"`, `"YYYY-MM-DD HH:mm"`, or `"invalid:<raw text>"`.
- `status.kind` is one of `todo`, `done`, `cancelled`, `custom`.
- `priority` is one of `highest`, `high`, `medium`, `normal`, `low`, `lowest`.
- `links[]` entries are `{"target": "...", "alias": "..." | null}`.
- `serialized` is required whenever `isTask` is true, and must equal `input` — every line
  fixture in this corpus is a round-trip fixture. Fixtures that specifically exercise
  mutation belong in `mutations/`, not here.

## Document fixtures

A whole small file: verifies code-fence and frontmatter handling, which can only be
decided with file-level context, plus that the document reassembles byte-identically.

```json
{
  "name": "code-fence-excludes-tasks",
  "content": "- [ ] Real task #task\n```\n- [ ] Fake task #task\n```\n",
  "config": {},
  "expected": {
    "taskCount": 1,
    "frontmatterTags": [],
    "tasks": [
      { "description": "Real task", "indentDepth": 0 }
    ]
  }
}
```

`expected.tasks` is optional and, when present, is checked positionally against the
document's parsed tasks in order — each entry may include any subset of `description`,
`indentDepth`, `allTags`, and `parentHeading`; only the keys present are checked. Useful
for nested-subtask fixtures where indentation, not just count, is the point, and for
frontmatter tag inheritance fixtures, where `allTags` (order-independent) is checked
against each task's *merged* tag set — its own inline tags plus any inherited from
frontmatter — not `tags` alone. Set `"frontmatterTagInheritance": true` in `config` for
those.

`parentHeading` is three-way like `config.globalFilter` above: key absent means "don't
check"; `"parentHeading": null` asserts the task has no preceding heading; a string
asserts that exact heading text (leading `#`s, surrounding whitespace, and an optional
closing `##` sequence all stripped). Only ATX headings (`#` through `######`) are
recognised — setext (`===`/`---` underline) headings are not.

The harness always additionally asserts that reserialising the parsed document equals
`content` exactly — this is not a separate field because it is true for every fixture in
this corpus.

## Mutation fixtures

An input line, an ordered list of field mutations, and the expected line after applying
all of them. This is what proves the "touching one task produces exactly one changed
line" requirement (§10).

```json
{
  "name": "set-due-inserts-field",
  "input": "- [ ] Buy milk #task",
  "config": {},
  "mutations": [
    { "op": "setDue", "value": "2026-09-01" }
  ],
  "expectedSerialized": "- [ ] Buy milk #task 📅 2026-09-01"
}
```

Supported `op` values and their `value` shape:

| op | value |
|---|---|
| `setStatus` | single-character string, e.g. `"x"` |
| `setDue` / `setScheduled` / `setStart` | `YYYY-MM-DD` string, or `null` to remove the field |
| `setReminder` | `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` string, or `null` to remove the field |
| `setPriority` | one of `highest`/`high`/`medium`/`normal`/`low`/`lowest` |
| `setDescription` | replacement description text |
| `addTag` | tag including `#`, e.g. `"#errands"` |
| `removeTag` | tag including `#` |
| `setRecurrence` | free-text recurrence rule (e.g. `"every week"`), or `null` to remove the field — the parser does not validate this text at write time; see the `dates`/`recurrence` line-fixture categories for what makes a rule *parseable* |

Mutations apply in order, each to the result of the previous one.

## Recurrence completion fixtures

Exercises completing a recurring task: on a given date, completing a task either
produces a completed line plus an optional next-instance line, or must refuse entirely
(an unparseable recurrence rule is never allowed to complete-and-drop the task). This is
describing behaviour every implementation's recurrence engine must reproduce — it is not
tied to any one implementation's file layout.

```json
{
  "name": "recurrence-completion-weekly",
  "input": "- [ ] Water plants #task 📅 2026-08-13 🔁 every week",
  "today": "2026-08-15",
  "config": {},
  "expected": {
    "completedLine": "- [x] Water plants #task 📅 2026-08-13 🔁 every week ✅ 2026-08-15",
    "nextInstanceLine": "- [ ] Water plants #task 📅 2026-08-20 🔁 every week"
  }
}
```

For a refusal case, replace `expected` with `"expectRefusal": true` — no line fields are
checked, only that completion refuses (throws, returns an error, or whatever the
implementation's own error-handling idiom is) rather than completing and silently
dropping the task.

`expected.nextInstanceLine` is `null` for a non-recurring task (no `🔁` field at all);
every fixture specifies it explicitly (never omitted) since both a real string and
`null` are meaningful expected outcomes here, unlike the "absent key means unchecked"
convention used elsewhere in this schema.

## Keeping this contract enforceable, not just documented

The rules above are prose; `index.json` and `tools/` make them mechanically checkable —
see `REPORT.md` for the generated fixture index, the schema validator, the
cross-implementation report format, and the diff tool that answers "do two
implementations actually agree?" directly instead of by reading two test logs side by
side. Run `node tools/validate.mjs` after editing any fixture.
