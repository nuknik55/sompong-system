/**
 * Run with: npm test — the server/client boundary (scripts/rsc-boundary.mjs).
 *
 * The first tests run the checker on inline trees it MUST flag, each the
 * shape of a defect that passed tsc, lint, tests and the build: a checker
 * that passes everything is worse than none. The last test runs it on src.
 * To run it on another tree (for example 2d4c10f, exported with
 * `git archive`), set RSC_SCAN_ROOT to that tree's src folder; the real-tree
 * test then fails and prints that tree's problems.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFiles, readTree, isComponentName } from "../../scripts/rsc-boundary.mjs";

const ROOT = path.resolve("/fixture/src");
const tree = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([p, s]) => [path.join(ROOT, p), s]));
const problems = (files: Record<string, string>): string[] => checkFiles(tree(files), ROOT).problems;

const CLIENT_TABLE = `"use client";
import { useRouter } from "next/navigation";
export const TH_ROW = "border-b bg-neutral-200";
export function RowLink({ href }: { href: string }) { useRouter(); return null; }
export function effectiveQty(item: { q: number }) { return item.q; }
export type Row = { id: string };
`;

test("A: a server page importing a CONSTANT from a \"use client\" module is flagged (TH_ROW)", () => {
  const p = problems({
    "components/ui/table.tsx": CLIENT_TABLE,
    "app/owner/page.tsx": `import { TH_ROW } from "@/components/ui/table";\nexport default function Page() { return TH_ROW; }\n`,
  });
  assert.equal(p.length, 1);
  assert.match(p[0], /^A app\/owner\/page\.tsx: imports "TH_ROW"/);
});

test("A: a server page calling a FUNCTION from a \"use client\" module is flagged (effectiveQty)", () => {
  const p = problems({
    "app/staff/x/SessionActions.tsx": CLIENT_TABLE,
    "app/staff/x/page.tsx": `import { SessionActions, effectiveQty } from "./SessionActions";\nexport default function Page() { return effectiveQty({ q: 1 }); }\n`,
  });
  assert.equal(p.length, 2, p.join("\n")); // effectiveQty, and SessionActions is not exported there
  assert.ok(p.some((x) => /imports "effectiveQty"/.test(x)));
});

test("A: reached through a plain module the page imports, and through a server-only file", () => {
  const p = problems({
    "components/ui/table.tsx": CLIENT_TABLE,
    "lib/helpers.ts": `import { effectiveQty } from "@/components/ui/table";\nexport const f = effectiveQty;\n`,
    "lib/data.ts": `import "server-only";\nimport { TH_ROW } from "../components/ui/table";\nexport const g = TH_ROW;\n`,
    "app/page.tsx": `import { f } from "@/lib/helpers";\nexport default function Page() { return f; }\n`,
  });
  assert.equal(p.length, 2, p.join("\n"));
  assert.ok(p.some((x) => x.startsWith("A lib/helpers.ts")));
  assert.ok(p.some((x) => x.startsWith("A lib/data.ts")));
});

test("A: a namespace import from a \"use client\" module is flagged", () => {
  const p = problems({
    "components/ui/table.tsx": CLIENT_TABLE,
    "app/page.tsx": `import * as T from "@/components/ui/table";\nexport default function Page() { return T; }\n`,
  });
  assert.equal(p.length, 1);
});

test("A: components, types and default imports pass; client files importing client files are not checked", () => {
  assert.deepEqual(problems({
    "components/ui/table.tsx": CLIENT_TABLE,
    "components/Widget.tsx": `"use client";\nexport default function Widget() { return null; }\n`,
    "app/page.tsx": [
      `import { RowLink, type Row } from "@/components/ui/table";`,
      `import type { Row as R2 } from "@/components/ui/table";`,
      `import Widget from "@/components/Widget";`,
      `export default function Page() { return RowLink; }`,
    ].join("\n"),
    "app/Client.tsx": `"use client";\nimport { TH_ROW, effectiveQty } from "@/components/ui/table";\nexport function Client() { return TH_ROW + effectiveQty({ q: 1 }); }\n`,
  }), []);
});

test("B: a \"use server\" file exporting a non-async constant is flagged (DISABLE_INSTEAD)", () => {
  const p = problems({
    "app/owner/team/actions.ts": [
      `"use server";`,
      `export type ActionResult = { error?: string };`,
      `export const DISABLE_INSTEAD = "บัญชีนี้มีประวัติในใบสั่งของ จึงลบไม่ได้";`,
      `export async function deleteUser(id: string): Promise<ActionResult> { return {}; }`,
    ].join("\n"),
  });
  assert.equal(p.length, 1, p.join("\n"));
  assert.match(p[0], /^B app\/owner\/team\/actions\.ts: a "use server" file exports "DISABLE_INSTEAD" \(const\)/);
});

test("B: a sync function, a class, an export list and export * are flagged; async functions and types pass", () => {
  const p = problems({
    "app/a/actions.ts": [
      `'use server'`,
      `export function sync() { return 1; }`,
      `export class K {}`,
      `const local = 1; export { local };`,
      `export * from "./other";`,
      `export async function ok1() {}`,
      `export const ok2 = async () => {};`,
      `export interface I { a: number }`,
    ].join("\n"),
    "app/a/other.ts": `export const z = 1;\n`,
  });
  const names = p.map((x) => /exports (?:"([^"]+)"|(export \*))/.exec(x)?.[1] ?? "*").sort();
  assert.deepEqual(names, ["*", "K", "local", "sync"]);
});

test("the component heuristic: PascalCase with a lower-case letter", () => {
  assert.ok(isComponentName("RowLink"));
  assert.ok(isComponentName("A1b"));
  assert.ok(!isComponentName("TH_ROW"));
  assert.ok(!isComponentName("ROW"));
  assert.ok(!isComponentName("effectiveQty"));
});

test("the real tree has no problems (with RSC_SCAN_ROOT: another tree, whose problems fail this test)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = process.env.RSC_SCAN_ROOT ? path.resolve(process.env.RSC_SCAN_ROOT) : path.resolve(here, "..");
  const { problems: found, serverFiles, clientModules } = checkFiles(readTree(root), root);
  // A control: the scan must actually see the app, or "no problems" means nothing.
  assert.ok(serverFiles > 100, `only ${serverFiles} server files found`);
  assert.ok(clientModules > 50, `only ${clientModules} "use client" modules found`);
  assert.deepEqual(found, [], "\n" + found.join("\n"));
});
