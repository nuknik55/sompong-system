/**
 * Run with: npm test — no month or day string is derived from a local-time or
 * UTC Date. (Was month-strings.test.ts; the day half was added 2026-09-19
 * when the same defect turned up on thirteen more surfaces.)
 *
 * THREE SHAPES, all of them found in this repo:
 *
 *   1. `new Date(y, m - 2, 1).toISOString()` — built in the RUNTIME's zone,
 *      read back in UTC. The two agree in UTC, which is why it survived on
 *      Vercel; on a machine in Bangkok, August's "previous month" came out as
 *      June and its "next" as August itself.
 *   2. `new Date(ds + "T00:00:00").toISOString()` — a zoneless string is
 *      parsed in the runtime's zone, so the same round trip, one day out west
 *      of Greenwich. It is how two HR pages found the Monday of a week.
 *   3. `new Date().toISOString().slice(0, 10)` — the UTC day, and Thailand is
 *      UTC+7. For the first seven hours of every Bangkok day this is
 *      yesterday: บันทึกรายวัน opened on yesterday's entries, the transfer
 *      slip on the week before, the schedule on last week. `.slice(0, 7)` is
 *      the same defect a month at a time.
 *
 * All three are now the helpers in src/lib/bangkok-date.ts — a named zone for
 * the clock, string math for everything else. This file reads the SOURCE so
 * the next page cannot quietly reintroduce any of them: the checks are first
 * run against inputs they MUST flag, and against the shapes they must let
 * through, because a scanner that flags nothing is worse than none.
 *
 * Reading a Date with local getters after building it locally
 * (`new Date(y, m, 0).getDate()`, `thaiDateFull`'s `d.getDate()`) is NOT this
 * defect: both halves are in the same zone, so the answer is consistent. Only
 * a UTC read of a local build, or a UTC read of the clock sliced to a
 * calendar unit, is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Rule = "local-date-to-iso" | "local-string-to-iso" | "local-mutation-to-iso" | "utc-now-month" | "utc-now-day";
type Finding = { line: number; rule: Rule; text: string };

/** Anywhere inside an expression: `new Date()` with no arguments. The transfer
 *  slip held one in a ternary, which an initialiser-only check walked past. */
function containsClockDate(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (isClockDate(n)) { found = true; return; }
    n.forEachChild(walk);
  };
  walk(node);
  return found;
}

/** `new Date()` with no arguments, or `new Date(Date.now() ...)` — the clock. */
function isClockDate(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || node.expression.getText() !== "Date") return false;
  const args = node.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
  if (args.length === 0) return true;
  return args.length === 1 && /\bDate\.now\s*\(/.test(args[0]!.getText());
}

/** `new Date(...)` with arguments that are NOT Date.UTC(...) — a local-clock date. */
function isLocalComponentsDate(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || node.expression.getText() !== "Date") return false;
  const args = node.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
  if (args.length < 2) return false;
  const first = args[0]!;
  return !(ts.isCallExpression(first) && first.expression.getText() === "Date.UTC");
}

/**
 * `new Date("…T00:00:00")` or `new Date(x + "T00:00:00")` — a date-time string
 * with no zone, which is parsed locally. The same literal ending in Z, or
 * carrying an offset, is UTC and fine.
 */
function isZonelessStringDate(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || node.expression.getText() !== "Date") return false;
  const args = node.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
  if (args.length !== 1) return false;
  const literals: string[] = [];
  const collect = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push(n.text);
    n.forEachChild(collect);
  };
  collect(args[0]!);
  return literals.some((l) => /T\d{2}:\d{2}/.test(l) && !/(Z|[+-]\d{2}:?\d{2})$/.test(l));
}

export function findDateStringDefects(source: string): Finding[] {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const localDateVars = new Set<string>();
  const clockVars = new Set<string>();
  /** Variables moved with LOCAL setters — setUTCDate and friends are not these. */
  const mutatedVars = new Set<string>();

  // Pass 1: variables holding a Date — local components, zoneless string, or
  // the bare clock.
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isLocalComponentsDate(node.initializer) || isZonelessStringDate(node.initializer)) {
        localDateVars.add(node.name.text);
      } else if (containsClockDate(node.initializer)) {
        clockVars.add(node.name.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^set(Date|Month|FullYear|Hours|Minutes)$/.test(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      mutatedVars.add(node.expression.expression.text);
    }
    node.forEachChild(collect);
  };
  file.forEachChild(collect);

  const at = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "toISOString") {
      const receiver = node.expression.expression;
      const viaVar = ts.isIdentifier(receiver) && localDateVars.has(receiver.text);
      const fromClock = isClockDate(receiver) || (ts.isIdentifier(receiver) && clockVars.has(receiver.text));
      const parent = node.parent;
      const call = parent && ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent) ? parent.parent : null;
      const args = call ? call.arguments.map((a) => a.getText()).join(",") : "";
      const sliced = parent && ts.isPropertyAccessExpression(parent) ? parent.name.text : "";
      const slicesMonth = sliced === "slice" && args === "0,7";
      const slicesDay = (sliced === "slice" && args === "0,10") || (sliced === "split" && args === '"T"');
      const text = node.getText().slice(0, 60);

      const mutated = ts.isIdentifier(receiver) && mutatedVars.has(receiver.text);
      if (isLocalComponentsDate(receiver) || viaVar) findings.push({ line: at(node), rule: "local-date-to-iso", text });
      else if (mutated) findings.push({ line: at(node), rule: "local-mutation-to-iso", text });
      else if (isZonelessStringDate(receiver)) findings.push({ line: at(node), rule: "local-string-to-iso", text });
      // The clock read as UTC is only wrong where it is cut to a calendar
      // unit. A full timestamp is an instant, and an instant has no zone
      // problem.
      else if (fromClock && slicesMonth) findings.push({ line: at(node), rule: "utc-now-month", text });
      else if (fromClock && slicesDay) findings.push({ line: at(node), rule: "utc-now-day", text });
    }
    node.forEachChild(walk);
  };
  file.forEachChild(walk);
  return findings;
}

test("the check flags all three shapes, and passes the zone-safe ones", () => {
  const flags = (src: string) => findDateStringDefects(src).map((f) => f.rule);

  // Must flag — one per shape, inline and through a variable.
  assert.deepEqual(flags(`const prev = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);`), ["local-date-to-iso"]);
  assert.deepEqual(flags(`function f() { const d = new Date(y, m - 1, 1); return d.toISOString().slice(0, 7); }`), ["local-date-to-iso"]);
  assert.deepEqual(flags(`const monday = new Date(ds + "T00:00:00").toISOString().slice(0, 10);`), ["local-string-to-iso"]);
  assert.deepEqual(flags(`function f() { const d = new Date("2026-09-19T00:00:00"); return d.toISOString(); }`), ["local-date-to-iso"]);
  assert.deepEqual(flags(`const today = new Date().toISOString().slice(0, 7);`), ["utc-now-month"]);
  assert.deepEqual(flags(`function f() { const t = new Date(); return t.toISOString().slice(0, 7); }`), ["utc-now-month"]);
  assert.deepEqual(flags(`const today = new Date().toISOString().slice(0, 10);`), ["utc-now-day"]);
  assert.deepEqual(flags(`const today = new Date().toISOString().split("T")[0]!;`), ["utc-now-day"]);
  assert.deepEqual(flags(`const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);`), ["utc-now-day"]);
  assert.deepEqual(flags(`function f() { const d = from ? new Date(from) : new Date(); return d.toISOString().slice(0, 10); }`), ["utc-now-day"], "a clock hidden in a ternary");
  assert.deepEqual(flags(`function f() { const d = new Date(start); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); }`), ["local-mutation-to-iso"]);
  assert.deepEqual(flags(`function f() { const t = new Date(); return t.toISOString().split("T")[0]; }`), ["utc-now-day"]);

  // Must pass.
  assert.deepEqual(flags(`function f() { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return d.toISOString().slice(0, 7); }`), []);
  assert.deepEqual(flags(`const day = new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);`), []);
  assert.deepEqual(flags(`function f() { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString(); }`), [], "UTC setters are not local mutation");
  assert.deepEqual(flags(`const d = new Date(iso).toISOString();`), [], "an ISO string in, an ISO string out");
  assert.deepEqual(flags(`const d = new Date(ds + "T00:00:00Z").toISOString().slice(0, 10);`), [], "Z is a zone");
  assert.deepEqual(flags(`const stamp = new Date().toISOString();`), [], "a full timestamp is an instant");
  assert.deepEqual(flags(`const days = new Date(y, m, 0).getDate();`), [], "local in, local out");
  assert.deepEqual(flags(`function f() { const d = new Date(ds + "T00:00:00"); return d.getDate() + d.getMonth(); }`), [], "local in, local out");
});

test("no page, action or component builds a date string from a local-time or UTC Date", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
  const files: string[] = [];
  const walkDir = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(full);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walkDir(root);
  assert.ok(files.length > 50, `expected to scan the whole of src, found ${files.length} files`);
  const bad = files.flatMap((f) =>
    findDateStringDefects(fs.readFileSync(f, "utf8")).map((x) => `${path.relative(root, f)}:${x.line} [${x.rule}] ${x.text}`),
  );
  assert.deepEqual(bad, []);
});
