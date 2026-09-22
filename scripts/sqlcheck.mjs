/**
 * Checks over a migration file. Each one exists because it was missed once.
 *
 *  A. STRUCTURE — dollar tags balanced, one BEGIN/COMMIT, unique test labels.
 *  B. FORMAT ARITY — placeholders against arguments (a mismatch aborts).
 *  C. PARSE-TIME REFERENCES — an object the file CREATES, named in executable
 *     SQL before its own CREATE. PL/pgSQL plans a statement before evaluating
 *     any guard inside it. (First failed run.)
 *  D. DE-ESCAPED REGEX — \s+ arriving as s+ through a generator, matching
 *     nothing and returning NULL in silence. (Second failed run.)
 *  E. DOOMED COLLECTOR — a result line written inside a block that always
 *     aborts. set_config is TRANSACTIONAL: its third argument decides whether
 *     a value survives COMMIT, not whether it survives ABORT, so the rows go
 *     with the test writes and the file reports success on evidence it never
 *     gathered. (Third failed run: 8 rows of 31, no error, applied.)
 *  F. DECLARED ROW COUNT — the static number of emitting sites against the
 *     count the file asserts at run time. A checker that counts SITES is not
 *     counting ROWS; tying the two together is what makes either mean
 *     anything. (Why check E's defect passed every earlier check.)
 *  G. PL/pgSQL CONDITION CUT AT A CASE — PL/pgSQL reads an IF / ELSIF
 *     condition up to the first THEN outside ( ) and [ ] (pl_gram.y,
 *     expr_until_then -> read_sql_construct; it does not track CASE/END). A
 *     bare CASE in the condition ends it at the CASE's own THEN, and the SQL
 *     parser gets a cut-off expression: "syntax error at end of input".
 *     Checks A-F passed such a file; it failed on its first run
 *     (test_data_cleanup_migration.sql, 2026-09-22). Wrap the CASE in ( ).
 *     ELSEIF is read too. Not covered: a CASE statement's WHEN clause (the
 *     same reader), and IFs inside dynamic SQL strings.
 *
 * Usage, from the app folder:
 *   node scripts/sqlcheck.mjs supabase/<file>.sql [...]
 *       every check, no exceptions: what a NEW migration must pass before it
 *       goes to Nik. Exit 1 on any problem.
 *   node scripts/sqlcheck.mjs --all
 *       every tracked migration (git ls-files supabase), with the historical
 *       exceptions in scripts/sqlcheck-exceptions.json applied: what CI runs on
 *       every push. Exit 1 on a problem that is not an exception, and on an
 *       exception that no longer occurs (delete it).
 * An exception names a file AND a check letter, with its reason. Never add one
 * for a new file: fix the file. AGENTS.md, "The SQL checker".
 */
import fs from "node:fs";
import nodePath from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function stripComments(src) {
  const out = [];
  for (const line of src.split(/\r?\n/)) {
    let inS = false, dollar = null, res = "";
    for (let i = 0; i < line.length; i++) {
      if (dollar) { res += line[i]; if (line.startsWith(dollar, i)) { i += dollar.length - 1; res += dollar.slice(1); dollar = null; } continue; }
      if (!inS) {
        const m = /^\$[A-Za-z_]*\$/.exec(line.slice(i));
        if (m) { dollar = m[0]; res += m[0]; i += m[0].length - 1; continue; }
        if (line[i] === "'") { inS = true; res += "'"; continue; }
        if (line[i] === "-" && line[i + 1] === "-") break;
      } else if (line[i] === "'") inS = false;
      res += line[i];
    }
    out.push(res);
  }
  return out.join("\n");
}

function blankStrings(code, { blankFnBodies }) {
  const chars = code.split("");
  let i = 0;
  while (i < code.length) {
    const dq = /^\$([A-Za-z_]*)\$/.exec(code.slice(i));
    if (dq) {
      const tag = dq[0];
      const end = code.indexOf(tag, i + tag.length);
      if (end < 0) break;
      const isDynamic = dq[1] === "q" || (blankFnBodies && dq[1] === "fn");
      if (isDynamic) for (let k = i + tag.length; k < end; k++) if (chars[k] !== "\n") chars[k] = " ";
      i = isDynamic ? end + tag.length : i + tag.length;
      continue;
    }
    if (code[i] === "'") {
      let j = i + 1;
      while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) { if (code[j] === "'" && code[j + 1] === "'") j++; j++; }
      for (let k = i + 1; k < j; k++) if (chars[k] !== "\n") chars[k] = " ";
      i = j + 1;
      continue;
    }
    i++;
  }
  return chars.join("");
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

function splitArgs(code, open) {
  let depth = 0, i = open, start = open + 1;
  const args = [];
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "'") { i++; while (i < code.length && !(code[i] === "'" && code[i + 1] !== "'")) { if (code[i] === "'") i++; i++; } continue; }
    const dq = /^\$([A-Za-z_]*)\$/.exec(code.slice(i));
    if (dq) { const end = code.indexOf(dq[0], i + dq[0].length); if (end < 0) return null; i = end + dq[0].length - 1; continue; }
    if (c === "(") { depth++; if (depth === 1) start = i + 1; continue; }
    if (c === ")") { depth--; if (depth === 0) { args.push(code.slice(start, i)); return { args, end: i }; } continue; }
    if (c === "," && depth === 1) { args.push(code.slice(start, i)); start = i + 1; }
  }
  return null;
}

/** Line ranges of every CREATE ... FUNCTION pg_temp.x ... $fn$; definition. */
function helperRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+pg_temp\./i.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\$fn\$;/.test(lines[j])) { ranges.push([i + 1, j + 1]); i = j; break; }
      }
    }
  }
  return ranges;
}
const inRanges = (line, ranges) => ranges.some(([a, b]) => line >= a && line <= b);

function checkFile(path) {
  const raw = fs.readFileSync(path, "utf8");
  const code = stripComments(raw);
  const lines = code.split("\n");
  const problems = [];
  const notes = [];
  const helpers = helperRanges(lines);

  // ── A. structure ──────────────────────────────────────────────────────
  const tags = {};
  for (const m of code.matchAll(/\$([A-Za-z_]*)\$/g)) tags[m[1]] = (tags[m[1]] ?? 0) + 1;
  for (const [tag, n] of Object.entries(tags)) if (n % 2 !== 0) problems.push(`A: dollar tag $${tag}$ appears ${n} times (odd)`);
  const begins = (code.match(/^\s*BEGIN;\s*$/gm) ?? []).length;
  const commits = (code.match(/^\s*COMMIT;\s*$/gm) ?? []).length;
  if (begins !== commits) problems.push(`A: ${begins} BEGIN; against ${commits} COMMIT;`);
  const labels = [...code.matchAll(/pg_temp\.t\(\s*'([^']+)'/g)].map((m) => m[1].split(" ")[0]);
  const dupes = labels.filter((x, i) => labels.indexOf(x) !== i);
  if (dupes.length) problems.push(`A: duplicate test labels: ${[...new Set(dupes)].join(", ")}`);
  notes.push(`A tags ${Object.entries(tags).map(([t, n]) => `$${t}$x${n}`).join(" ")} | ${begins} BEGIN/${commits} COMMIT | ${labels.length} labels`);

  // ── B. format() arity ─────────────────────────────────────────────────
  let formats = 0;
  for (const m of code.matchAll(/\bformat\s*\(/g)) {
    const parsed = splitArgs(code, code.indexOf("(", m.index));
    if (!parsed) { problems.push(`B:${lineOf(code, m.index)} format( unbalanced`); continue; }
    const [tpl, ...rest] = parsed.args;
    const t = tpl.trim();
    if (!/^'/.test(t) && !/^\$[A-Za-z_]*\$/.test(t)) continue;
    formats++;
    const ph = (t.replace(/%%/g, "").match(/%[ILs]/g) ?? []).length;
    const args = rest.filter((a) => a.trim() !== "").length;
    if (ph !== args) problems.push(`B:${lineOf(code, m.index)} format() ${ph} placeholder(s), ${args} argument(s)`);
  }
  notes.push(`B format() literal-template calls: ${formats}, arity matched`);

  // ── C. parse-time references ──────────────────────────────────────────
  const created = [];
  for (const m of code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([A-Za-z_]\w*)/gi)) created.push({ name: m[1], kind: "table", line: lineOf(code, m.index) });
  for (const m of code.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)/gi)) created.push({ name: m[1], kind: "column", line: lineOf(code, m.index) });
  for (const m of code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([A-Za-z_]\w*)/gi)) if (m[1] !== "pg_temp") created.push({ name: m[1], kind: "function", line: lineOf(code, m.index) });
  const exec = blankStrings(code, { blankFnBodies: true });
  for (const obj of created) {
    for (const m of exec.matchAll(new RegExp(`\\b${obj.name}\\b`, "g"))) {
      const line = lineOf(exec, m.index);
      if (line >= obj.line) continue;
      const text = exec.split("\n")[line - 1].trim();
      if (/to_regclass|information_schema|::regclass|::regprocedure/.test(text)) continue;
      problems.push(`C:${line} names ${obj.kind} "${obj.name}" before its CREATE at line ${obj.line}:\n        ${text}`);
    }
  }
  notes.push(`C objects created: ${created.map((c) => `${c.name}@${c.line}`).join(", ") || "none"}`);

  // ── D. de-escaped regex ───────────────────────────────────────────────
  let regexLits = 0;
  for (const m of code.matchAll(/'((?:[^']|'')*)'/g)) {
    const lit = m[1];
    if (!(lit.includes("(?:") || lit.startsWith("^") || lit.includes("[[:"))) continue;
    regexLits++;
    const bare = [...lit.matchAll(/(^|[^\\\]])([swdSWD])([+*])/g)].map((x) => x[2] + x[3]);
    if (bare.length) problems.push(`D:${lineOf(code, m.index)} regex literal has de-escaped ${[...new Set(bare)].join(", ")}:\n        ${lit.slice(0, 80)}`);
  }
  notes.push(`D regex literals: ${regexLits}`);

  // ── E. doomed collector ───────────────────────────────────────────────
  // A block that ends in a deliberate abort undoes every set_config made
  // inside it. Result lines written there are lost unless the handler puts
  // them back.
  let doomedBlocks = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/RAISE\s+EXCEPTION\s+USING\s+ERRCODE/i.test(lines[i])) continue;
    let start = -1;
    for (let j = i; j >= 0; j--) if (lines[j].trim() === "BEGIN") { start = j; break; }
    let handler = -1;
    for (let j = i; j < lines.length; j++) if (lines[j].trim() === "EXCEPTION") { handler = j; break; }
    if (start < 0 || handler < 0) continue;
    let end = lines.length - 1;
    for (let j = handler; j < lines.length; j++) if (/^\s*END;?\s*$/.test(lines[j])) { end = j; break; }
    doomedBlocks++;
    const doomed = [];
    for (let j = start; j < handler; j++) if (/pg_temp\.(note|t)\(/.test(lines[j]) && !inRanges(j + 1, helpers)) doomed.push(j + 1);
    if (doomed.length === 0) continue;
    const handlerText = lines.slice(handler, end + 1).join("\n");
    if (/set_config\(/.test(handlerText)) {
      notes.push(`E:${start + 1}-${handler + 1} ${doomed.length} result line(s) inside an always-aborting block, restored by the handler`);
    } else {
      problems.push(`E:${start + 1}-${handler + 1} ${doomed.length} result line(s) written inside a block that always aborts (line ${i + 1}), and the handler puts nothing back — set_config is rolled back with the test writes, so these rows never reach the result table:\n        lines ${doomed.join(", ")}`);
    }
  }
  notes.push(`E always-aborting blocks: ${doomedBlocks}`);

  // ── F. declared row count ─────────────────────────────────────────────
  // Sites, classified: a t() call emits one row; a note() emits one; a note
  // whose text starts with "skip" replaces a t() row rather than adding one;
  // the row-count line is the assertion itself and is not part of the count.
  let t = 0, plain = 0, skip = 0, assertion = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    if (inRanges(ln, helpers)) continue;
    if (/PERFORM\s+pg_temp\.t\(/.test(lines[i])) t++;
    if (/PERFORM\s+pg_temp\.note\(/.test(lines[i])) {
      const text = lines.slice(i, i + 2).join(" ");
      if (/'\s*skip/.test(text)) skip++;
      else if (/row count verified/.test(text)) assertion++;
      else plain++;
    }
  }
  const staticRows = t + plain + skip - skip; // a skip line stands in for a t() row
  const declared = (/c_expected\s+constant\s+bigint\s*:=\s*(\d+)/.exec(code) ?? [])[1];
  if (declared === undefined) {
    problems.push("F: the file asserts no expected row count — a block that emits nothing would pass unnoticed");
  } else if (Number(declared) !== staticRows) {
    problems.push(`F: ${staticRows} emitting sites (${t} tests + ${plain} notes), but the file asserts ${declared}`);
  }
  notes.push(`F rows: ${t} tests + ${plain} notes + ${skip} skip-alternative + ${assertion} assertion = ${staticRows} asserted, file declares ${declared ?? "nothing"}`);

  // ── G. PL/pgSQL condition cut at a CASE's THEN ───────────────────────
  // Mimics read_sql_construct: from an IF or ELSIF that starts a statement,
  // read to the first THEN at bracket depth 0; strings and comments are
  // already blank. A CASE at depth 0 with no END before that THEN means the
  // THEN was the CASE's own, and the condition is cut there.
  const gtext = blankStrings(code, { blankFnBodies: false });
  const isWord = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  const STARTS = new Set(["THEN", "ELSE", "LOOP", "BEGIN"]);
  let conditions = 0;
  for (const m of gtext.matchAll(/\b(ELSEIF|ELSIF|IF)\b/gi)) {
    if (isWord(gtext[m.index - 1]) || isWord(gtext[m.index + m[0].length])) continue;
    // What precedes it: a statement boundary, or a word that ends one.
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(gtext[j])) j--;
    let startsStatement = j < 0 || gtext[j] === ";" || gtext.slice(j - 1, j + 1) === ">>";
    if (!startsStatement && isWord(gtext[j])) {
      let k = j;
      while (k >= 0 && isWord(gtext[k])) k--;
      startsStatement = STARTS.has(gtext.slice(k + 1, j + 1).toUpperCase());
    }
    if (!startsStatement) continue;           // END IF, DROP ... IF EXISTS, ADD COLUMN IF NOT EXISTS
    conditions++;
    let depth = 0, openCase = 0, i = m.index + m[0].length, ended = null;
    while (i < gtext.length) {
      const c = gtext[i];
      if (c === '"') { const e = gtext.indexOf('"', i + 1); i = e < 0 ? gtext.length : e + 1; continue; }
      if (c === "(" || c === "[") { depth++; i++; continue; }
      if (c === ")" || c === "]") { depth--; i++; continue; }
      if (c === ";" && depth === 0) { ended = ";"; break; }
      if (isWord(c) && !isWord(gtext[i - 1])) {
        let e = i;
        while (isWord(gtext[e])) e++;
        const w = gtext.slice(i, e).toUpperCase();
        if (depth === 0) {
          if (w === "THEN") { ended = "THEN"; break; }
          if (w === "CASE") openCase++;
          if (w === "END" && openCase > 0) openCase--;
        }
        i = e;
        continue;
      }
      i++;
    }
    if (ended === "THEN" && openCase > 0) {
      const cond = gtext.slice(m.index, i + 4).replace(/\s+/g, " ").trim();
      problems.push(`G:${lineOf(gtext, m.index)} ${m[0].toUpperCase()} condition is cut at the THEN of a bare CASE — PL/pgSQL stops the condition there; wrap the CASE in parentheses:\n        ${cond.slice(0, 160)}`);
    } else if (ended !== "THEN") {
      problems.push(`G:${lineOf(gtext, m.index)} ${m[0].toUpperCase()} with no THEN before ${ended ?? "the end of the file"}`);
    }
  }
  notes.push(`G IF/ELSIF conditions read as PL/pgSQL reads them: ${conditions}`);

  return { path, problems, notes };
}

function report(r) {
  console.log(`\n===== ${r.path}`);
  for (const n of r.notes) console.log("  . " + n);
  if (r.problems.length === 0) console.log("  OK no problems");
  else for (const p of r.problems) console.log("  XX " + p);
}

/** A problem line starts with its check's letter: "F: ...", "G:1053 ...". */
const letterOf = (problem) => problem[0];

/** Every tracked migration, with the recorded historical exceptions applied. */
function runAll(root) {
  const recorded = JSON.parse(fs.readFileSync(nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), "sqlcheck-exceptions.json"), "utf8"));
  const allowed = new Map();
  for (const [letter, entry] of Object.entries(recorded.checks)) {
    const files = Array.isArray(entry.files) ? entry.files : Object.keys(entry.files);
    for (const f of files) {
      if (!allowed.has(f)) allowed.set(f, new Set());
      allowed.get(f).add(letter);
    }
  }
  const files = execFileSync("git", ["ls-files", "--", "supabase/*.sql"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).sort();
  if (files.length === 0) {
    console.log("sqlcheck --all: no tracked migration found. Run it from the app folder.");
    return 1;
  }
  let failing = 0, excused = 0;
  const stale = [];
  for (const f of files) {
    const r = checkFile(nodePath.join(root, f));
    const ok = allowed.get(f) ?? new Set();
    const fresh = r.problems.filter((p) => !ok.has(letterOf(p)));
    const seen = new Set(r.problems.map(letterOf));
    for (const l of ok) if (!seen.has(l)) stale.push(`${f}: ${l} no longer flagged`);
    excused += r.problems.length - fresh.length;
    if (fresh.length) {
      failing++;
      report({ ...r, path: f, problems: fresh });
    }
  }
  for (const f of allowed.keys()) if (!files.includes(f)) stale.push(`${f}: not a tracked migration`);
  console.log(`\nsqlcheck --all: ${files.length} migrations, ${failing} with a problem that is not an exception; `
    + `${excused} historical problem(s) excused, in ${allowed.size} files listed in scripts/sqlcheck-exceptions.json`);
  if (stale.length) console.log("Exceptions that no longer occur (delete them):\n  " + stale.join("\n  "));
  return failing || stale.length ? 1 : 0;
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("usage: node scripts/sqlcheck.mjs <file.sql> [...]   |   node scripts/sqlcheck.mjs --all");
    process.exit(2);
  }
  if (args[0] === "--all") process.exit(runAll(process.cwd()));
  let bad = 0;
  for (const p of args) {
    const r = checkFile(p);
    report(r);
    if (r.problems.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}

export { checkFile };
