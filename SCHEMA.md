# Conformance corpus schema

Language-agnostic contract between every implementation of the Obsidian Tasks parser
(Swift today; TypeScript for the Obsidian plugin and possibly Kotlin for Android are
future implementations per the roadmap). Each implementation ships a thin harness that
loads these fixtures and asserts against them. A parser change is not complete until the
corpus is updated and every implementation passes.

Fixtures live under `fixtures/<category>/`, one JSON file per category holding an array
of fixture objects. The category directory name determines which of the four fixture
shapes below the file uses:

- `documents/` → **document fixtures**
- `mutations/` → **mutation fixtures**
- `recurrence-completion/` → **recurrence completion fixtures**
- everything else (`status/`, `dates/`, `priority/`, `tags/`, `links/`, `recurrence/`,
  `dependencies/`, `preservation/`) → **line fixtures**

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
| `setPriority` | one of `highest`/`high`/`medium`/`normal`/`low`/`lowest` |
| `setDescription` | replacement description text |
| `addTag` | tag including `#`, e.g. `"#errands"` |
| `removeTag` | tag including `#` |

Mutations apply in order, each to the result of the previous one.

## Recurrence completion fixtures

Exercises `RecurrenceEngine.complete` (`Sources/PerliteCore/Recurrence/`): completing a
task, on a given date, either produces a completed line plus an optional next-instance
line, or must refuse entirely (§6.3 — an unparseable recurrence rule is never allowed to
complete-and-drop the task).

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
checked, only that `RecurrenceEngine.complete` throws.

`expected.nextInstanceLine` is `null` for a non-recurring task (no `🔁` field at all);
every fixture specifies it explicitly (never omitted) since both a real string and
`null` are meaningful expected outcomes here, unlike the "absent key means unchecked"
convention used elsewhere in this schema.
