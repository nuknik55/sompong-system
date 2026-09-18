/**
 * Run with: npm test — no month string is derived from a local-time Date.
 *
 * `new Date(y, m - 2, 1).toISOString().slice(0, 7)` builds the date in the
 * RUNTIME's zone and reads it back in UTC. In UTC the two agree, which is why
 * it survived on Vercel; on a machine in Bangkok, August's "previous month"
 * came out as June and its "next month" as August itself, so the P&L and
 * break-even navigators skipped a month in `npm run dev` (found 2026-09-18).
 * `new Date().toISOString().slice(0, 7)` has the same shape: it is the UTC
 * month, and for the first seven hours of every Bangkok month it is the
 * previous one.
 *
 * Both are now `previousMonth` / `nextMonth` / `bangkokYearMonth` from
 * checklist.ts, which are string math and a named zone. This file reads the
 * SOURCE so the next page cannot quietly reintroduce either: the two checks
 * are first run against inputs they must flag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Finding = { line: number; rule: "local-date-to-iso" | "utc-now-month"; text: string };

/** `new Date()` with no arguments — the clock, read back in UTC by toISOString. */
function isBareNow(node: ts.Node): boolean {
  return ts.isNewExpression(node) && node.expression.getText() === "Date" && (node.arguments?.length ?? 0) === 0;
}

/** `new Date(...)` with arguments that are NOT Date.UTC(...) — a local-clock date. */
function isLocalComponentsDate(node: ts.Node): boolean {
  if (!ts.isNewExpression(node) || node.expression.getText() !== "Date") return false;
  const args = node.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
  if (args.length < 2) return false;
  const first = args[0]!;
  return !(ts.isCallExpression(first) && first.expression.getText() === "Date.UTC");
}

export function findLocalMonthStrings(source: string): Finding[] {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const localDateVars = new Set<string>();
  const nowVars = new Set<string>();

  // Pass 1: variables holding a Date — local components, or the bare clock.
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isLocalComponentsDate(node.initializer)) localDateVars.add(node.name.text);
      else if (isBareNow(node.initializer)) nowVars.add(node.name.text);
    }
    node.forEachChild(collect);
  };
  file.forEachChild(collect);

  const at = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "toISOString") {
      const receiver = node.expression.expression;
      const fromLocalDate =
        isLocalComponentsDate(receiver) || (ts.isIdentifier(receiver) && localDateVars.has(receiver.text));
      // The UTC clock, inline or through a variable — the month list held it
      // as `const today = new Date()`, which an inline-only rule called clean.
      // Only a MONTH slice of it is wrong: a day slice is a different
      // question, and the ones in this app are correct.
      const fromNow = isBareNow(receiver) || (ts.isIdentifier(receiver) && nowVars.has(receiver.text));
      const parent = node.parent;
      const slicesMonth =
        parent && ts.isPropertyAccessExpression(parent) && parent.name.text === "slice" &&
        ts.isCallExpression(parent.parent) && parent.parent.arguments.map((a) => a.getText()).join(",") === "0,7";
      if (fromLocalDate) findings.push({ line: at(node), rule: "local-date-to-iso", text: node.getText().slice(0, 60) });
      else if (fromNow && slicesMonth) findings.push({ line: at(node), rule: "utc-now-month", text: node.getText().slice(0, 60) });
    }
    node.forEachChild(walk);
  };
  file.forEachChild(walk);
  return findings;
}

test("the check flags both shapes, and passes the zone-safe ones", () => {
  const skipsAMonth = `const prev = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);`;
  const viaVariable = `function f() { const d = new Date(y, m - 1, 1); return d.toISOString().slice(0, 7); }`;
  const utcNowMonth = `const today = new Date().toISOString().slice(0, 7);`;
  const utcNowMonthVar = `function f() { const today = new Date(); return today.toISOString().slice(0, 7); }`;
  const utcBuilt = `function f() { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return d.toISOString().slice(0, 7); }`;
  const fromIsoString = `const d = new Date(iso).toISOString();`;
  const daysInMonth = `const days = new Date(y, m, 0).getDate();`;
  const utcNowDay = `const today = new Date().toISOString().slice(0, 10);`;
  const nowTimestamp = `function f() { const now = new Date(); return now.toISOString(); }`;
  assert.deepEqual(findLocalMonthStrings(skipsAMonth).map((f) => f.rule), ["local-date-to-iso"]);
  assert.deepEqual(findLocalMonthStrings(viaVariable).map((f) => f.rule), ["local-date-to-iso"]);
  assert.deepEqual(findLocalMonthStrings(utcNowMonth).map((f) => f.rule), ["utc-now-month"]);
  assert.deepEqual(findLocalMonthStrings(utcNowMonthVar).map((f) => f.rule), ["utc-now-month"]);
  assert.deepEqual(findLocalMonthStrings(utcBuilt), []);
  assert.deepEqual(findLocalMonthStrings(fromIsoString), []);
  assert.deepEqual(findLocalMonthStrings(daysInMonth), []);
  assert.deepEqual(findLocalMonthStrings(utcNowDay), []);
  assert.deepEqual(findLocalMonthStrings(nowTimestamp), []);
});

test("no page in src/app builds a month string from a local-time Date", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "app");
  const files: string[] = [];
  const walkDir = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(full);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walkDir(root);
  assert.ok(files.length > 20, `expected to scan the app, found ${files.length} files`);
  const bad = files.flatMap((f) =>
    findLocalMonthStrings(fs.readFileSync(f, "utf8")).map((x) => `${path.relative(root, f)}:${x.line} [${x.rule}] ${x.text}`),
  );
  assert.deepEqual(bad, []);
});
