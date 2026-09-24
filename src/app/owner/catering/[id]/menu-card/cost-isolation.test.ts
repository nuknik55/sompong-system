/**
 * Run with: npm test — the menu card imports nothing that computes cost.
 *
 * Nik's rule for the card (2026-09-24): its page and its save action must not
 * import anything that computes cost. A sales session prints this card, and
 * the rule that sales never sees a cost is kept by keeping the code away, not
 * by trusting every caller to leave it unused.
 *
 * So the test walks the REAL import graph from the card's three files, value
 * imports only (an `import type` brings no code), through relative and `@/`
 * paths, and fails if any module it reaches exports a value whose name says
 * cost, margin or profit. The one exception is the lock check, which reads a
 * timestamp and computes nothing. It proves it can fail: from the kitchen
 * sheet's page — which reaches event-menu.ts through actions.ts — the same
 * walk must report foodCostFigure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../../..");
const COST = /cost|margin|profit/i;
const ALLOWED = new Set(["assertCostNotLocked"]);

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package: next, react, @supabase/*, server-only
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`cannot resolve ${spec} from ${path.relative(SRC, from)}`);
}

const hasExport = (n: ts.Node) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** A module's value imports (specifiers) and value exports (names). */
function scan(file: string): { imports: string[]; exports: string[] } {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const exports: string[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      const clause = s.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      const typeOnly = clause != null && (clause.isTypeOnly
        || (!clause.name && named != null && named.length > 0 && named.every((e) => e.isTypeOnly)));
      if (!typeOnly) imports.push((s.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(s)) {
      const named = s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements : null;
      const values = named ? named.filter((e) => !e.isTypeOnly) : null;
      if (s.isTypeOnly || (values && values.length === 0)) continue;
      if (s.moduleSpecifier) imports.push((s.moduleSpecifier as ts.StringLiteral).text);
      if (values) exports.push(...values.map((e) => e.name.text));
      else exports.push("*");
    } else if (hasExport(s)) {
      if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) {
        if (s.name) exports.push(s.name.text);
      } else if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.push(d.name.text);
      }
    }
  }
  return { imports, exports };
}

/** Every module reachable from the entries, with the cost-named values it exports. */
function walk(entries: string[]): { reached: Set<string>; offenders: { file: string; names: string[] }[] } {
  const reached = new Set<string>();
  const offenders: { file: string; names: string[] }[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    const { imports, exports } = scan(file);
    const bad = exports.filter((n) => COST.test(n) && !ALLOWED.has(n));
    if (bad.length > 0) offenders.push({ file: path.relative(SRC, file).replaceAll("\\", "/"), names: bad });
    for (const spec of imports) {
      const next = resolve(file, spec);
      if (next) queue.push(next);
    }
  }
  return { reached, offenders };
}

const CARD = ["page.tsx", "MenuCardClient.tsx", "actions.ts"].map((f) => path.join(HERE, f));
const rel = (s: Set<string>) => [...s].map((f) => path.relative(SRC, f).replaceAll("\\", "/"));

test("the walk can fail: from the kitchen sheet it reaches event-menu.ts and reports foodCostFigure", () => {
  const { offenders } = walk([path.join(HERE, "../kitchen-sheet/page.tsx")]);
  const em = offenders.find((o) => o.file === "app/owner/catering/event-menu.ts");
  assert.ok(em, JSON.stringify(offenders));
  assert.ok(em.names.includes("foodCostFigure") && em.names.includes("lineFoodCost"), em.names.join(", "));
});

test("the walk reads what it should: the card reaches the shared reads and not the cost-bearing modules", () => {
  const reached = rel(walk(CARD).reached);
  for (const f of ["app/owner/catering/menu-read.ts", "app/owner/catering/menu-lines.ts", "lib/function-sheet.ts", "app/owner/catering/cost-lock.ts"]) {
    assert.ok(reached.includes(f), `${f} not reached: ${reached.join(", ")}`);
  }
  for (const f of ["app/owner/catering/actions.ts", "app/owner/catering/event-menu.ts", "app/owner/catering/shared-utils.tsx"]) {
    assert.ok(!reached.includes(f), `${f} is reached`);
  }
});

test("THE RULE: the card's page, its client and its save action import nothing that computes cost", () => {
  assert.deepEqual(walk(CARD).offenders, []);
});
