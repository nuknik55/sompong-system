/**
 * Run with: npm test — every exported server action runs a role guard before
 * it touches the database (2026-09-25).
 *
 * Each export of a "use server" file is a POST endpoint that any signed-in
 * account can call directly, whatever page shows it (AGENTS.md, "The
 * server/client boundary"; Next's layouts and page guards do NOT run for an
 * action). So the guard has to be in the action. This walks every "use server"
 * file's exported functions, in source order, following calls into helpers
 * (same file or imported through a relative or @/ path), and asks which
 * comes first: a guard from src/lib/auth.ts, or a database client / query.
 *
 * The exceptions below are what the tree held when this test was written. The
 * list only shrinks: an entry that no longer needs to be here fails the test
 * until it is removed, and a new action without a guard fails until it gets
 * one (or an entry, with its reason, that a reviewer has to read).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARDS = new Set(["requireProfile", "requireOwner", "requireAdmin", "requireAdminOrEditor", "requireHR", "requireHROrAdmin", "requireSales", "requireOrdering"]);
const DB_CALLS = new Set(["createClient", "createAdminClient", "from", "rpc", "fetchAllRows"]);

type Parsed = { file: string; sf: ts.SourceFile; fns: Map<string, ts.FunctionDeclaration>; imports: Map<string, { from: string; name: string }> };
const cache = new Map<string, Parsed | null>();

function resolveModule(fromFile: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(fromFile), spec) : null;
  if (!base) return null;
  for (const c of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

function parse(file: string): Parsed | null {
  if (cache.has(file)) return cache.get(file)!;
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const fns = new Map<string, ts.FunctionDeclaration>();
  const imports = new Map<string, { from: string; name: string }>();
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n);
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      const target = resolveModule(file, n.moduleSpecifier.text);
      if (target) for (const el of n.importClause.namedBindings.elements) imports.set(el.name.text, { from: target, name: (el.propertyName ?? el.name).text });
    }
  });
  const p = { file, sf, fns, imports };
  cache.set(file, p);
  return p;
}

/** "guard" or "db", whichever call is reached first in source order; null when neither is. */
function firstReached(p: Parsed, fn: ts.FunctionDeclaration, seen: Set<string>): "guard" | "db" | null {
  let res: "guard" | "db" | null = null;
  const visit = (node: ts.Node) => {
    if (res) return;
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (name && GUARDS.has(name)) { res = "guard"; return; }
      if (name && DB_CALLS.has(name)) { res = "db"; return; }
      if (ts.isIdentifier(e)) {
        const key = (file: string, n: string) => file + "#" + n;
        let target: { p: Parsed; fn: ts.FunctionDeclaration } | null = null;
        if (p.fns.has(e.text)) target = { p, fn: p.fns.get(e.text)! };
        else if (p.imports.has(e.text)) {
          const imp = p.imports.get(e.text)!;
          const q = parse(imp.from);
          const f = q?.fns.get(imp.name);
          if (q && f) target = { p: q, fn: f };
        }
        if (target && !seen.has(key(target.p.file, target.fn.name!.text))) {
          seen.add(key(target.p.file, target.fn.name!.text));
          const r = firstReached(target.p, target.fn, seen);
          if (r) { res = r; return; }
        }
      }
    }
    node.forEachChild(visit);
  };
  if (fn.body) visit(fn.body);
  return res;
}

function serverActionFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") && /^\s*["']use server["']/.test(fs.readFileSync(f, "utf8"))) out.push(f);
    }
  };
  walk(SRC);
  return out;
}

/** "file:function" for every exported action whose first step is not a guard. */
function unguarded(): string[] {
  const out: string[] = [];
  for (const file of serverActionFiles()) {
    const p = parse(file)!;
    for (const [name, fn] of p.fns) {
      if (!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (firstReached(p, fn, new Set()) !== "guard") out.push(path.relative(SRC, file).split(path.sep).join("/") + ":" + name);
    }
  }
  return out.sort();
}

/**
 * Known, with the reason. Removing the reason's cause means removing the entry.
 */
const EXCEPTIONS: Record<string, string> = {
  "app/login/actions.ts:login": "signing in: there is no one to guard yet",
  "app/login/actions.ts:logout": "signing out: harmless for anyone",
};

test("the walk finds the actions, and follows a guard kept in a helper of another file", () => {
  const files = serverActionFiles();
  assert.ok(files.length >= 20, `only ${files.length} "use server" files found: the walk is broken`);
  const catering = parse(path.join(SRC, "app/owner/catering/actions.ts"))!;
  // getCateringEventMenus is one line calling readEventMenus in menu-read.ts, whose guard is there.
  assert.equal(firstReached(catering, catering.fns.get("getCateringEventMenus")!, new Set()), "guard");
});

test("the check can fail: an action whose query comes before its guard is flagged", () => {
  const file = path.join(SRC, "__probe__.ts");
  const sf = ts.createSourceFile(file, `"use server";
import { requireSales } from "@/lib/auth";
export async function late() { const s = await createClient(); await requireSales(); return s; }
export async function early() { await requireSales(); const s = await createClient(); return s; }
export async function none() { return 1; }`, ts.ScriptTarget.Latest, true);
  const fns = new Map<string, ts.FunctionDeclaration>();
  sf.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n); });
  const p: Parsed = { file, sf, fns, imports: new Map() };
  assert.equal(firstReached(p, fns.get("late")!, new Set()), "db");
  assert.equal(firstReached(p, fns.get("early")!, new Set()), "guard");
  assert.equal(firstReached(p, fns.get("none")!, new Set()), null);
});

test("every exported server action runs a guard before the database, except the listed ones", () => {
  const found = unguarded();
  const unlisted = found.filter((k) => !(k in EXCEPTIONS));
  assert.deepEqual(unlisted, [], "an action with no guard before its first query: add requireX() as its first statement");
});

test("the exception list only shrinks: every entry is still needed", () => {
  const found = new Set(unguarded());
  const stale = Object.keys(EXCEPTIONS).filter((k) => !found.has(k));
  assert.deepEqual(stale, [], "these actions now have a guard: delete their entries");
});
