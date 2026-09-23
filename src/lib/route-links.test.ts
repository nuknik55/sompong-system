/**
 * Run with: npm test — every page has a way in.
 *
 * Twice a page lost its only link and nobody noticed until Nik looked for it:
 * /owner/catering/cost-settings (off the sub-nav 2026-09-11 while a comment
 * claimed a link that did not exist; found 2026-09-16), and
 * /owner/catering/customers (reached only from a booking's ข้อมูลลูกค้า and
 * then ← กลับ; found 2026-09-22). A one-time check stays true only until the
 * next change, so this one runs every time.
 *
 * The rule: every page.tsx under src/app is the target of at least one string
 * that navigates, in a file OUTSIDE the page's own folder. A page's own links,
 * and its child pages' back links, are not a way in. Read from the parsed
 * source, so a comment naming a route is not a link:
 *   - a template placeholder ${...} matches only a DYNAMIC segment ([id]).
 *     The 2026-09-16 scan's first version let it match a fixed segment, so
 *     /owner/catering/${id} counted as a link to cost-settings;
 *   - a literal segment goes to a static route before a dynamic one
 *     (/owner/catering/new is not the booking [id]);
 *   - revalidatePath(...) is not navigation; redirect() and router.push() are.
 * It sees literal paths only: an href built from a prefix variable
 * (`${base}/${id}`) is invisible to it. Every page it passes today is found
 * through a literal, so that blind spot can only make it stricter.
 *
 * NO_WAY_IN lists the pages that have none on purpose, each with why. Add one
 * only with Nik's say-so. To scan another tree (a pre-fix commit exported
 * with git archive), set ROUTE_LINK_SCAN_ROOT to its src folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Pages with no link on purpose. */
const NO_WAY_IN: Record<string, string> = {
  "/owner/stations":
    "the station order-template editor (station_ingredients, with its child /owner/stations/[id]/template). Off the nav since " +
    "2026-07-03 (f959c0e), when order templates moved to /staff/inventory/template (templates, template_items); nothing else reads " +
    "its table. Listed for Nik 2026-09-22; he decided on 2026-09-23 to keep it as it is, unlinked, until item 35 " +
    "(supply ordering), which may reuse the station data (README).",
  "/staff/inventory/template/[stationId]":
    "a redirect to /staff/inventory/template for URLs from before 2026-07-03 (f959c0e).",
};

/** Where the app starts: reached by typing the address, or by the auth redirects. */
const ENTRY_POINTS = new Set(["/"]);

const HOLE = String.fromCharCode(0);

type Source = { file: string; text: string };
type Page = { route: string; segs: string[]; dir: string };

/** The navigating path strings of one file: segments, with "*" for a placeholder. */
function pathStrings(src: Source): string[][] {
  const sf = ts.createSourceFile(src.file, src.text, ts.ScriptTarget.Latest, true,
    src.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[][] = [];
  const visit = (n: ts.Node) => {
    let value: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) value = n.text;
    else if (ts.isTemplateExpression(n)) value = n.head.text + n.templateSpans.map((s) => HOLE + s.literal.text).join("");
    if (value !== null && value.startsWith("/")) {
      let p: ts.Node = n.parent;
      while (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || ts.isBinaryExpression(p)) p = p.parent;
      const callee = ts.isCallExpression(p) ? p.expression.getText(sf) : "";
      if (!callee.endsWith("revalidatePath")) {
        const clean = value.split("?")[0].split("#")[0];
        out.push(clean.split("/").filter(Boolean).map((s) => (s.includes(HOLE) ? "*" : s)));
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

const isDynamic = (seg: string) => seg.startsWith("[") && seg.endsWith("]");

/** How well a path string fits a page: -1 when it cannot be that page. */
function fit(str: string[], page: Page): number {
  if (str.length !== page.segs.length) return -1;
  let score = 0;
  for (let i = 0; i < str.length; i++) {
    const a = str[i], b = page.segs[i];
    if (a === "*") { if (!isDynamic(b)) return -1; continue; }
    if (a === b) { score += 2; continue; }
    if (isDynamic(b)) { score += 1; continue; }
    return -1;
  }
  return score;
}

/** For each page, the files outside its own folder holding a string that navigates to it. */
function waysIn(sources: Source[], pages: Page[]): Map<string, string[]> {
  const found = new Map<string, Set<string>>(pages.map((p) => [p.route, new Set<string>()]));
  for (const src of sources) {
    for (const str of pathStrings(src)) {
      let best: Page | null = null, bestFit = -1;
      for (const p of pages) { const f = fit(str, p); if (f > bestFit) { best = p; bestFit = f; } }
      if (!best) continue;
      // A file in the page's folder or below it is the page's own. The root
      // page's folder is the whole app, so for it only a file beside it is.
      const own = best.dir === "" ? !src.file.includes("/") : src.file.startsWith(best.dir + "/");
      if (!own) found.get(best.route)!.add(src.file);
    }
  }
  return new Map([...found].map(([k, v]) => [k, [...v].sort()]));
}

function pageOf(appRelativeDir: string): Page {
  const segs = appRelativeDir.split("/").filter(Boolean).filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return { route: "/" + segs.join("/"), segs, dir: appRelativeDir };
}

function unreached(sources: Source[], pages: Page[]): string[] {
  const ways = waysIn(sources, pages);
  return pages.map((p) => p.route).filter((r) => !ENTRY_POINTS.has(r) && ways.get(r)!.length === 0).sort();
}

test("CHECKER: a placeholder reaches only a dynamic segment; a literal prefers a static page; revalidatePath and comments are not links; a page's own folder does not count", () => {
  const pages = ["catering", "catering/[id]", "catering/new", "catering/cost-settings", "catering/customers", "catering/customers/[id]"].map(pageOf);
  const src = (file: string, text: string): Source => ({ file, text });
  const ways = waysIn([
    src("catering/Booking.tsx", "const a = `/catering/${id}`; revalidatePath(\"/catering/cost-settings\"); // /catering/customers"),
    src("catering/List.tsx", "<Link href=\"/catering/new\" />"),
    src("catering/customers/[id]/Detail.tsx", "<Link href=\"/catering/customers\">back</Link>"),
    src("catering/customers/List.tsx", "<Link href={`/catering/customers/${c.id}`} />"),
  ], pages);
  assert.deepEqual(ways.get("/catering/[id]"), ["catering/Booking.tsx"]);
  assert.deepEqual(ways.get("/catering/new"), ["catering/List.tsx"]);
  assert.deepEqual(ways.get("/catering/cost-settings"), [], "a placeholder and a revalidatePath are not a link to a fixed page");
  assert.deepEqual(ways.get("/catering/customers"), [], "a comment, and a back link from the page's own child, are not a way in");
  assert.deepEqual(ways.get("/catering/customers/[id]"), ["catering/customers/List.tsx"], "the list's link to a detail page is a way in to the detail page");
});

const SRC = process.env.ROUTE_LINK_SCAN_ROOT
  ? path.resolve(process.env.ROUTE_LINK_SCAN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(SRC, "app");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const toApp = (f: string) => path.relative(APP, f).split(path.sep).join("/");

test("EVERY PAGE HAS A WAY IN: a link from outside its own folder, or a reason in NO_WAY_IN", () => {
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
  const pages = walk(APP).filter((f) => /[\\/]page\.tsx?$/.test(f)).map((f) => pageOf(toApp(path.dirname(f))));
  assert.ok(pages.length >= 60, `found only ${pages.length} pages: the scan is not reading the app`);
  const sources = files.map((f) => ({ file: path.relative(APP, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));
  const routes = new Set(pages.map((p) => p.route));
  for (const r of Object.keys(NO_WAY_IN)) assert.ok(routes.has(r), `NO_WAY_IN names ${r}, which is not a page any more: remove it`);
  const missing = unreached(sources, pages);
  const unexplained = missing.filter((r) => !(r in NO_WAY_IN));
  const nowReached = Object.keys(NO_WAY_IN).filter((r) => !missing.includes(r));
  assert.deepEqual(unexplained, [], "pages no link outside their own folder reaches (link them, or list them in NO_WAY_IN with Nik's reason)");
  assert.deepEqual(nowReached, [], "pages in NO_WAY_IN that a link now reaches: remove them from the list");
});
