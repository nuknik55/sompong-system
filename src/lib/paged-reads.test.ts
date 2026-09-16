/**
 * Run with: npm test — every paged read ends its ORDER BY on a unique key.
 *
 * fetchAllRows pages with separate LIMIT/OFFSET queries. Without a total
 * order, Postgres may return a row on two pages and another on none, and the
 * result is a steady, wrong total with a correct row count. That happened:
 * a 2026-09-16 replay of getMonthlySummary's unordered read gave August 2026
 * an operating profit of 8.8% against a true 7.7% (supabase/README.md,
 * queue item 10). The check that should have caught it compared the page with
 * another read made the same way, so it could only agree (AGENTS.md, "What
 * would have caught it").
 *
 * This file is the check that does not share that layer: it reads the SOURCE.
 * Two rules, both over every .ts/.tsx file in src:
 *
 *   1. Every fetchAllRows(...) query ends its ORDER BY on `id`, or on the
 *      table's primary key where that is not `id` (UNIQUE_ORDER_KEYS below).
 *   2. Every `.range(` call sits inside a fetchAllRows callback, so a
 *      hand-written paging loop cannot slip past rule 1.
 *
 * The first tests run the checker on inline sources it MUST flag. A checker
 * that passes everything is worse than none. The first version of this one
 * passed a query with no ORDER BY at all, because `undefined === undefined`.
 *
 * To run the scan against another tree (for example, a pre-fix commit
 * exported with `git archive`), set PAGED_READ_SCAN_ROOT to its src folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Tables whose unique key is not `id`. Add a table here only with its PK. */
const UNIQUE_ORDER_KEYS: Record<string, string> = {
  pos_item_categories: "pos_product_name",
};

type Finding = { line: number; rule: "order" | "range"; detail: string };

function isFetchAllRowsCall(n: ts.Node): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetchAllRows";
}

function isRangeCall(n: ts.Node): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "range";
}

/** The links of a call chain a.b(x).c(y), from the root outward. */
function chainOf(call: ts.CallExpression): { name: string; arg: string | null }[] {
  const links: { name: string; arg: string | null }[] = [];
  let c: ts.Expression = call;
  while (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression)) {
    const a = c.arguments[0];
    links.unshift({ name: c.expression.name.text, arg: a && ts.isStringLiteral(a) ? a.text : null });
    c = c.expression.expression;
  }
  return links;
}

export function findUnorderedPagedReads(source: string, fileName = "input.ts"): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const insideFetchAllRows = new Set<ts.Node>();

  (function visit(n: ts.Node) {
    if (isFetchAllRowsCall(n)) {
      const ranges: ts.CallExpression[] = [];
      (function collect(m: ts.Node) {
        if (isRangeCall(m)) ranges.push(m);
        ts.forEachChild(m, collect);
      })(n);
      if (ranges.length === 0) findings.push({ line: lineOf(n), rule: "order", detail: "fetchAllRows query has no .range( call" });
      for (const r of ranges) {
        insideFetchAllRows.add(r);
        const links = chainOf(r);
        const table = links.find((l) => l.name === "from")?.arg ?? null;
        const orders = links.filter((l) => l.name === "order").map((l) => l.arg);
        const last = orders.length ? orders[orders.length - 1] : undefined;
        // Compare only real values: with no ORDER BY, `last` is undefined, and
        // so is the map lookup for most tables.
        const pk = table !== null ? UNIQUE_ORDER_KEYS[table] : undefined;
        const unique = last === "id" || (typeof last === "string" && pk !== undefined && last === pk);
        if (!unique) {
          findings.push({
            line: lineOf(r),
            rule: "order",
            detail: `${table ?? "?"} ordered by ${orders.length ? orders.join(", ") : "(nothing)"} — must end on ${pk ?? "id"}`,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  })(sf);

  (function visit(n: ts.Node) {
    if (isRangeCall(n) && !insideFetchAllRows.has(n)) {
      findings.push({ line: lineOf(n), rule: "range", detail: ".range( outside fetchAllRows — page through fetchAllRows instead" });
    }
    ts.forEachChild(n, visit);
  })(sf);

  return findings;
}

// ── the checker must fail for the right reasons ─────────────────────────────

const wrap = (query: string) => `fetchAllRows(({ from, to }) => ${query}.range(from, to));`;

test("CHECKER: a paged read with no ORDER BY at all is flagged (the August P&L shape)", () => {
  const f = findUnorderedPagedReads(wrap(`supabase.from("expense_entries").select("coa_code,amount").filter("entry_date", "gte", a)`));
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "order");
  assert.match(f[0]!.detail, /\(nothing\)/);
});

test("CHECKER: ordering by non-unique columns only is flagged (the delivery-window shape)", () => {
  const f = findUnorderedPagedReads(wrap(`supabase.from("pos_receipt_deliveries").select("*").order("material_code").order("document_date")`));
  assert.equal(f.length, 1);
});

test("CHECKER: `id` as the LAST key passes; `id` anywhere else does not", () => {
  assert.deepEqual(findUnorderedPagedReads(wrap(`supabase.from("menus").select("*").order("name").order("id")`)), []);
  assert.equal(findUnorderedPagedReads(wrap(`supabase.from("menus").select("*").order("id").order("name")`)).length, 1);
});

test("CHECKER: a table's own primary key passes only for that table", () => {
  assert.deepEqual(findUnorderedPagedReads(wrap(`supabase.from("pos_item_categories").select("*").order("pos_product_name")`)), []);
  assert.equal(findUnorderedPagedReads(wrap(`supabase.from("menus").select("*").order("pos_product_name")`)).length, 1);
});

test("CHECKER: a .range( outside fetchAllRows is flagged", () => {
  const f = findUnorderedPagedReads(`const { data } = await supabase.from("menus").select("*").order("id").range(0, 999);`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "range");
});

// ── the scan ────────────────────────────────────────────────────────────────

const SRC = process.env.PAGED_READ_SCAN_ROOT
  ? path.resolve(process.env.PAGED_READ_SCAN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

test("every paged read in src ends its ORDER BY on a unique key", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, `expected to scan the app's source, found ${files.length} files under ${SRC}`);

  let pagedReads = 0;
  const problems: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("fetchAllRows") && !text.includes(".range(")) continue;
    pagedReads += (text.match(/\bfetchAllRows\s*[<(]/g) ?? []).length;
    for (const p of findUnorderedPagedReads(text, f)) {
      problems.push(`${path.relative(SRC, f).replace(/\\/g, "/")}:${p.line}  ${p.detail}`);
    }
  }
  // The definition itself is one match; there must be real calls to check.
  assert.ok(pagedReads > 5, `expected to find fetchAllRows calls, found ${pagedReads}`);
  assert.deepEqual(problems, [], `paged reads without a total order:\n  ${problems.join("\n  ")}`);
});
