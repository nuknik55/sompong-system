/**
 * Run with: npm test — images picked on the print page never leave the
 * browser (Nik, 2026-09-24).
 *
 * PrintImages.tsx keeps a picked file as an object URL and nothing else. This
 * reads its PARSED source, so a comment cannot pass or fail it: it may import
 * only React and the sheet's rules, may name no network or upload API, and
 * must release what it creates — revokeObjectURL where an image is taken off
 * and where the page is left. Each check is first shown to fail on a sample
 * that breaks it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "PrintImages.tsx");
const ALLOWED_IMPORTS = new Set(["react", "@/lib/event-sheet"]);
// Every way out a picked file could take: the network, another window, storage that outlives the page, a form.
const NETWORK = /^(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|FormData|createClient|storage|upload|rpc|Image|location|open|postMessage|localStorage|sessionStorage|indexedDB|caches|requestSubmit|submit|action|formAction)$/;

function scan(source: string) {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports: string[] = [];
  const names: string[] = [];
  let creates = 0;
  let revokes = 0;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) imports.push((n.moduleSpecifier as ts.StringLiteral).text);
    if (ts.isIdentifier(n)) {
      names.push(n.text);
      if (n.text === "createObjectURL") creates++;
      if (n.text === "revokeObjectURL") revokes++;
    }
    if (ts.isStringLiteral(n) && /^use server$/.test(n.text)) names.push("use server");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return {
    badImports: imports.filter((i) => !ALLOWED_IMPORTS.has(i)),
    network: [...new Set(names.filter((x) => NETWORK.test(x) || x === "use server"))],
    creates,
    revokes,
  };
}

test("the check can fail: a sample that uploads is caught", () => {
  const bad = scan(`import { createClient } from "@/lib/supabase/client";
    export function X() { const u = URL.createObjectURL(f); fetch("/x", { body: new FormData() }); createClient().storage.from("b").upload("p", f); }`);
  assert.deepEqual(bad.badImports, ["@/lib/supabase/client"]);
  assert.ok(bad.network.includes("fetch") && bad.network.includes("FormData") && bad.network.includes("upload"), bad.network.join(","));
  assert.equal(bad.revokes, 0);
});

test("PrintImages takes no props: nothing can be handed in to carry a file out", () => {
  const sf = ts.createSourceFile("x.tsx", fs.readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "PrintImages");
  assert.ok(fn, "PrintImages is a function declaration");
  assert.equal(fn.parameters.length, 0);
});

test("PrintImages imports only React and the sheet's rules, and names no network or upload API", () => {
  const r = scan(fs.readFileSync(FILE, "utf8"));
  assert.deepEqual(r.badImports, []);
  assert.deepEqual(r.network, []);
});

test("every object URL it creates is released: when an image is taken off, and when the page is left", () => {
  const r = scan(fs.readFileSync(FILE, "utf8"));
  assert.ok(r.creates >= 1, "it makes object URLs");
  assert.ok(r.revokes >= 2, `revokeObjectURL is called in ${r.revokes} place(s); expected the removal and the unmount`);
});
