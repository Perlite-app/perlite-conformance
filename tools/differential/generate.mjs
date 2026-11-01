// Differential fuzzing, step 1: write a seeded batch of random cases as JSON Lines.
//
//   node tools/differential/generate.mjs [--seed N] [--lines N] [--documents N]
//        [--mutations N] [--completions N] > cases.jsonl
//
// Each implementation runs the same file through its own parser (see DIFFERENTIAL.md for
// the per-case input and output shapes) and `compare.mjs` reports every case where the
// outputs differ. Nothing here knows the right answer — a disagreement means at least one
// implementation is wrong, and the minimised case becomes a real fixture.
//
// Dependency-free, deterministic: the same seed always produces the same file.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const seed = BigInt(args.seed ?? 1);
const counts = {
  line: Number(args.lines ?? 20000),
  document: Number(args.documents ?? 2000),
  mutation: Number(args.mutations ?? 5000),
  completion: Number(args.completions ?? 5000),
};

// SplitMix64 — the same generator as PerliteCore's RoundTripFuzzTests, so a seed means the
// same thing on both sides if a case ever needs regenerating there.
let state = seed;
const MASK = (1n << 64n) - 1n;
function next() {
  state = (state + 0x9e3779b97f4a7c15n) & MASK;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return z ^ (z >> 31n);
}
const int = (lo, hi) => lo + Number(next() % BigInt(hi - lo + 1));
const pick = (list) => list[int(0, list.length - 1)];
const chance = (p) => Number(next() % 10000n) < p * 10000;
const many = (lo, hi, make) => Array.from({ length: int(lo, hi) }, make);

// --- Building blocks -------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");
function isoDate() {
  if (chance(0.08)) return pick(["2028-02-29", "2027-02-29", "2026-02-28", "2026-12-31", "2026-01-31", "2024-02-29", "2100-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]);
  return `${int(2024, 2028)}-${pad2(int(1, 12))}-${pad2(int(1, 28))}`;
}
/** A real date — "today" always is. */
function validDate() {
  for (;;) {
    const text = isoDate();
    const [y, m, d] = text.split("-").map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    if (d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) return text;
  }
}
function dateText() {
  if (chance(0.8)) return isoDate();
  return pick(["2026-13-01", "2026-00-10", "2026-02-30", "2026-1-5", "26-01-05", "2026/01/05", "+202-01-05", "-2026-01-05", "not-a-date", "2026-01-05T10:00", "２０２６-01-05", "2026-01-05x", ""]);
}
const timeText = () => (chance(0.85) ? `${pad2(int(0, 23))}:${pad2(int(0, 59))}` : pick(["24:00", "9:30", "12:60", "7pm", "12:3", "+9:30", "-1:00", "1٢:30"]));

const DATE_EMOJI = ["📅", "📆", "🗓", "⏳", "⌛", "🛫", "➕", "✅", "❌"];
const VS16 = "\uFE0F";
const RULES = [
  "every day", "every 3 days", "every week", "every 2 weeks", "every weekday", "every month", "every year",
  "every week on Monday", "every week on Monday, Friday", "every week on Sunday", "every 2 weeks on Tuesday and Thursday",
  "every month on the 1st", "every month on the 31st", "every month on the last day", "every month on the last Friday",
  "every month on the 2nd Wednesday", "every 3 months", "every year on March 3", "every January", "every 6 months on the 15th",
  "every day when done", "every week when done", "every 2 weeks when done", "Every Week", "EVERY DAY", "every 0 days",
  "every -1 days", "every fortnight", "every week on Funday", "every", "daily", "every 1 day", "every 100 years",
  "every week on monday", "every month on the 0th", "every week  on Monday",
];
const WORDS = [
  "Buy milk", "Write report", "Call", "mum", "Café ☕ résumé", "日本語のタスク", "🎉 celebrate", "e\u0301", "😀" + VS16, "🇬🇧🇺🇸",
  "a", "b", "-", "—", ":", "(", ")", "...", "x", "100%", "C#", "issue#12", "email@example.com", "naïve", "🧑\u200D💻",
  "\u00A0", "\u2009", "\u000B", "\u000C", "\u0085", "\u2028", "\u2029", "\uFEFF", "\r", "Ω", "ß", "İ", "ﬁ", "𝔘𝔫𝔦", "مرحبا",
];
const TAGS = [
  "#task", "#errands", "#project/subproject", "#🔥", "#", "#a-b", "#a_b", "#1234", "#2026", "#a.b", "#tag,", "#tag)", "(#tag)",
  "#Work", "#work", "#WORK", "#tâche", "#日本", "#a/b/c", "#/a", "#a/", "##double", "#tag!", "#tag?", "#x#y", "#todo",
];
const LINKS = [
  "[[Note]]", "[[Note|Alias]]", "[[Note#Heading|Alias]]", "[[unterminated", "[[]]", "[[Note 📅 2026-01-01]]", "[[a|b|c]]",
  "[link](https://example.com/#frag)", "[unterminated](", "![[embed.png]]", "<https://x.y/#z>", "https://example.com/path#anchor",
];

function field() {
  switch (int(0, 15)) {
    case 0: case 1: case 2: {
      const emoji = pick(DATE_EMOJI) + (chance(0.08) ? VS16 : "");
      return chance(0.1) ? emoji : `${emoji}${chance(0.1) ? "  " : " "}${dateText()}`;
    }
    case 3: return `⏰${chance(0.05) ? VS16 : ""} ${dateText()}${chance(0.6) ? ` ${timeText()}` : ""}`;
    case 4: return pick(["🔺", "⏫", "🔼", "🔽", "⏬", "⏫" + VS16, "🔼🔽"]);
    case 5: case 6: return `🔁${chance(0.05) ? VS16 : ""}${chance(0.05) ? "" : " " + pick(RULES)}`;
    case 7: return pick(["🏁 delete", "🏁 keep", "🏁", "🏁 nonsense"]);
    case 8: return pick(["🆔 abc123", "🆔 a_b-c", "🆔", "🆔 has space", "🆔 ÄÖ"]);
    case 9: return pick(["⛔ abc123", "⛔ abc123,def456", "⛔ a, b", "⛔ a,,b", "⛔", "⛔ ,"]);
    case 10: return pick(TAGS);
    case 11: return pick(LINKS);
    case 12: return pick(["`code span`", "`📅 2026-01-01`", "`unterminated", "``a ` b``", "$📅 2026-01-01$"]);
    case 13: return pick(["^block-id", "^", "^abc 📅 2026-01-01", "%%comment%%", "<!-- c -->"]);
    default: return pick(WORDS);
  }
}

function taskLine({ wellFormed = false } = {}) {
  const quote = !wellFormed && chance(0.04) ? pick(["> ", ">", "> > ", "> [!note] "]) : "";
  const indent = pick(["", "", "", " ", "  ", "\t", "\t\t", "    ", " \t", "        "]);
  const marker = wellFormed || chance(0.85) ? pick(["- ", "- ", "- ", "* ", "+ ", "1. ", "42. "]) : pick(["1) ", "-  ", "-\t", "-", "•"]);
  const status = wellFormed || chance(0.85) ? pick([" ", " ", " ", "x", "X", "-", "/", "!", ">", "?", "@"]) : pick(["", "  ", "xx", "✓", "\t"]);
  const fields = many(0, 9, field);
  // Most lines carry the default global filter somewhere, or nearly every case would be
  // "not a task" under the default config.
  if (wellFormed || chance(0.7)) fields.splice(int(0, fields.length), 0, wellFormed ? "#task" : pick(["#task", "#task", "#task", "#Task", "#task/sub", "#tasks"]));
  const separator = () => pick([" ", " ", " ", "  ", "\t"]);
  const body = fields.map((piece, i) => (i === 0 ? piece : separator() + piece)).join("");
  const gap = body === "" ? "" : pick([" ", " ", " ", "", "  "]);
  const trailing = pick(["", "", "", " ", "  ", "\t"]);
  return `${quote}${indent}${marker}[${status}]${gap}${body}${trailing}`;
}

function config({ wellFormed = false } = {}) {
  if (chance(0.5)) return {};
  if (wellFormed) return { globalFilter: pick([null, "#task"]), ...(chance(0.2) ? { frontmatterTagInheritance: true } : {}) };
  return {
    ...(chance(0.8) ? { globalFilter: pick([null, "#task", "#todo", "#Task", "TODO", "#a/b"]) } : {}),
    ...(chance(0.2) ? { frontmatterTagInheritance: true } : {}),
  };
}

// --- Case shapes -----------------------------------------------------------------------

function lineCase() {
  return { kind: "line", input: taskLine(), config: config() };
}

function documentCase() {
  const blocks = [];
  if (chance(0.3)) {
    blocks.push(pick([
      "---\ntags: [alpha, beta]\n---",
      "---\ntags:\n  - alpha\n  - '#beta'\n---",
      "---\ntags: alpha beta\n---",
      "---\ntitle: x\n---",
      "---\ntags: [unterminated\n---",
      "---\n---",
      "---\ntags: [a]\n",
      "---\r\ntags: [a]\r\n---",
    ]));
  }
  for (const _ of many(1, 14, () => 0)) {
    blocks.push(pick([
      () => taskLine(), () => taskLine(), () => taskLine(), () => taskLine(),
      () => pick(["# Heading", "## Heading ##", "#NoSpace", "   # Indented", "####### Seven", "# ", "### 📅 2026-01-01", "Setext\n===", "# Heading #task"]),
      () => pick(["```", "~~~", "````", "```js", "   ```", "    ```", "``` ", "```\n- [ ] fenced #task\n```"]),
      () => pick(["", "", "Plain paragraph", "- plain list item", "    indented code", "> quote", "| a | b |", "<div>", "%%", "$$"]),
    ])());
  }
  const lineEnding = pick(["\n", "\n", "\n", "\r\n", "\r\n", "mixed", "\r"]);
  const lines = blocks.join("\n").split("\n");
  let content = lines.map((line, i) => line + (i === lines.length - 1 ? "" : lineEnding === "mixed" ? pick(["\n", "\r\n"]) : lineEnding)).join("");
  if (chance(0.6)) content += lineEnding === "mixed" ? "\n" : lineEnding;
  // No byte-order mark: Obsidian (`vault.read`) and Foundation (`String(contentsOf:encoding:)`)
  // both strip it before a parser sees the text — see DIFFERENTIAL.md.
  return { kind: "document", content, config: config() };
}

function mutation() {
  switch (int(0, 10)) {
    case 0: return { op: "setStatus", value: pick([" ", "x", "X", "-", "/", "!", "?"]) };
    case 1: return { op: "setDue", value: chance(0.25) ? null : isoDate() };
    case 2: return { op: "setScheduled", value: chance(0.25) ? null : isoDate() };
    case 3: return { op: "setStart", value: chance(0.25) ? null : isoDate() };
    case 4: return { op: "setReminder", value: chance(0.25) ? null : `${isoDate()}${chance(0.6) ? ` ${pad2(int(0, 23))}:${pad2(int(0, 59))}` : ""}` };
    case 5: return { op: "setPriority", value: pick(["highest", "high", "medium", "normal", "low", "lowest"]) };
    case 6: return { op: "setDescription", value: many(0, 4, () => pick([...WORDS, ...TAGS.slice(0, 6), "📅 2026-01-01", "🔁 every day"])).join(" ") };
    case 7: return { op: "addTag", value: pick(["#errands", "#new", "#a/b", "#Work", "#task", "#🔥"]) };
    case 8: return { op: "removeTag", value: pick(["#errands", "#work", "#Work", "#task", "#a-b", "#missing"]) };
    default: return { op: "setRecurrence", value: chance(0.25) ? null : pick(RULES) };
  }
}

function mutationCase() {
  return { kind: "mutation", input: taskLine({ wellFormed: true }), config: config({ wellFormed: true }), mutations: many(1, 5, mutation) };
}

function completionCase() {
  // Bias towards lines that actually recur, so most cases exercise the engine.
  let input = taskLine({ wellFormed: true });
  if (!input.includes("🔁") && chance(0.85)) input += ` 🔁 ${pick(RULES)}${chance(0.7) ? ` 📅 ${isoDate()}` : ""}`;
  return { kind: "completion", input, config: config({ wellFormed: true }), today: validDate() };
}

const makers = { line: lineCase, document: documentCase, mutation: mutationCase, completion: completionCase };
let n = 0;
for (const [kind, count] of Object.entries(counts)) {
  for (let i = 0; i < count; i++) {
    process.stdout.write(JSON.stringify({ id: `${kind}-${String(++n).padStart(6, "0")}`, ...makers[kind]() }) + "\n");
  }
}
