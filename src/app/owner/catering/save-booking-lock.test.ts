/**
 * Run with: npm test — saveBooking checks the cost lock before it writes.
 *
 * Its later steps check the lock as well, so a locked booking was always
 * refused in the end; but step 1 (upsertCateringEvent) wrote first, and the
 * refusal came after the staff list, a new customer, a history line and, for
 * owner and admin, the booking's own fields had changed (queue item 33).
 * Nothing but the ORDER of two calls prevents that, so the order is tested,
 * on the parsed source: a comment naming either function cannot satisfy it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The functions called inside `fnName`, in source order; null if it is not there. */
function callsIn(source: string, fnName: string): string[] | null {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  let body: ts.Block | undefined;
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) body = node.body;
  });
  if (!body) return null;
  const names: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) names.push(node.expression.text);
    node.forEachChild(walk);
  };
  walk(body);
  return names;
}

/** Null when saveBooking checks the lock before its first write; otherwise why not. */
function lockFirstProblem(source: string): string | null {
  const calls = callsIn(source, "saveBooking");
  if (!calls) return "no saveBooking";
  const write = calls.indexOf("upsertCateringEvent");
  const lock = calls.indexOf("assertCostNotLocked");
  if (write < 0) return "no upsertCateringEvent call";
  if (lock < 0) return "no assertCostNotLocked call";
  if (lock > write) return "the lock is checked after the booking is written";
  return null;
}

test("the check flags a lock checked late, a lock not checked, and a comment", () => {
  const late = `export async function saveBooking(i) {
    const id = await upsertCateringEvent(i.event);
    await assertCostNotLocked(db, id);
  }`;
  const missing = `export async function saveBooking(i) {
    // assertCostNotLocked(db, i.event.id) — in a comment only
    const id = await upsertCateringEvent(i.event);
  }`;
  const early = `export async function saveBooking(i) {
    if (i.event.id) await assertCostNotLocked(await createClient(), i.event.id);
    const id = await upsertCateringEvent(i.event);
  }`;
  assert.equal(lockFirstProblem(late), "the lock is checked after the booking is written");
  assert.equal(lockFirstProblem(missing), "no assertCostNotLocked call");
  assert.equal(lockFirstProblem(early), null);
});

test("saveBooking checks the cost lock before it writes anything", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.equal(lockFirstProblem(fs.readFileSync(actions, "utf8")), null);
});

/** The body of the top-level function `fnName`, if the file declares one. */
function bodyOf(file: ts.SourceFile, fnName: string): ts.Block | undefined {
  let body: ts.Block | undefined;
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) body = node.body;
  });
  return body;
}

/**
 * Null when saveBooking keeps the quantity check's answer and RETURNS on it
 * before its first write; otherwise why not. Since 2026-09-21 a menu line's
 * quantity is written as sent, never lifted to 1, so the refusal is the only
 * thing between a bad number and the charge rows. A call whose answer is
 * ignored refuses nothing, so the order of the calls alone is not enough
 * (review, 2026-09-21).
 */
function quantityFirstProblem(source: string): string | null {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const body = bodyOf(file, "saveBooking");
  if (!body) return "no saveBooking";
  let writeAt = -1, checkAt = -1, returnAt = -1;
  let answer: string | null = null;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "upsertCateringEvent" && writeAt < 0) writeAt = node.getStart(file);
      if (node.expression.text === "bookingLinesQuantityProblem" && checkAt < 0) {
        checkAt = node.getStart(file);
        if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) answer = node.parent.name.text;
      }
    }
    if (ts.isIfStatement(node) && answer && returnAt < 0 && ts.isIdentifier(node.expression) && node.expression.text === answer) {
      let returns = false;
      const find = (n: ts.Node) => { if (ts.isReturnStatement(n)) returns = true; n.forEachChild(find); };
      find(node.thenStatement);
      if (returns) returnAt = node.getStart(file);
    }
    node.forEachChild(walk);
  };
  walk(body);
  if (writeAt < 0) return "no upsertCateringEvent call";
  if (checkAt < 0) return "no bookingLinesQuantityProblem call";
  if (checkAt > writeAt) return "the quantities are checked after the booking is written";
  if (!answer) return "the check's answer is not kept";
  if (returnAt < 0) return "nothing returns on the check's answer";
  if (returnAt > writeAt) return "the refusal comes after the booking is written";
  return null;
}

test("the check flags quantities checked late, not checked, a comment, an answer ignored, and an answer not returned on", () => {
  const fn = (inner: string) => `export async function saveBooking(i) {\n${inner}\n}`;
  const write = "const id = await upsertCateringEvent(i.event);";
  assert.equal(quantityFirstProblem(fn(`${write}\nconst bad = bookingLinesQuantityProblem(i.lines);\nif (bad) return { ok: false, error: bad };`)),
    "the quantities are checked after the booking is written");
  assert.equal(quantityFirstProblem(fn(`// bookingLinesQuantityProblem(i.lines) — in a comment only\n${write}`)), "no bookingLinesQuantityProblem call");
  assert.equal(quantityFirstProblem(fn(`bookingLinesQuantityProblem(i.lines);\n${write}`)), "the check's answer is not kept");
  assert.equal(quantityFirstProblem(fn(`const bad = bookingLinesQuantityProblem(i.lines);\nif (bad) console.log(bad);\n${write}`)), "nothing returns on the check's answer");
  assert.equal(quantityFirstProblem(fn(`const bad = bookingLinesQuantityProblem(i.lines);\nif (bad) return { ok: false, error: bad };\n${write}`)), null);
});

test("saveBooking refuses a bad menu-line quantity, and returns, before it writes anything", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.equal(quantityFirstProblem(fs.readFileSync(actions, "utf8")), null);
});

const ROUNDERS = new Set(["max", "min", "round", "floor", "ceil", "trunc"]);

/** Every Math.max/min/round/floor/ceil/trunc over a quantity inside the named functions. */
function quantityRounding(source: string, fnNames: string[]): string[] {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  for (const fnName of fnNames) {
    const body = bodyOf(file, fnName);
    if (!body) { hits.push(`no ${fnName}`); continue; }
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Math"
          && ROUNDERS.has(node.expression.name.text)
          && node.arguments.some((a) => /quantity|qty/i.test(a.getText(file)))) {
        hits.push(`${fnName}: ${node.getText(file)}`);
      }
      node.forEachChild(walk);
    };
    walk(body);
  }
  return hits;
}

const WRITERS = ["saveBooking", "saveCateringCharges", "addCateringEventMenu"];

test("the rounding check flags a clamp put back on the server's write path, and not a comment", () => {
  const clamped = `export async function saveBooking(i) {
    // Math.max(1, l.quantity) — in a comment only
    payload.push({ quantity: Math.max(1, l.quantity) });
  }
  async function saveCateringCharges() {}
  async function addCateringEventMenu() {}`;
  assert.deepEqual(quantityRounding(clamped, WRITERS), ["saveBooking: Math.max(1, l.quantity)"]);
});

test("no server writer of a menu line rounds or clamps its quantity", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.deepEqual(quantityRounding(fs.readFileSync(actions, "utf8"), WRITERS), []);
});

/**
 * The initializer of `prop` in saveBooking's menu-line charge — the pushed
 * object with charge_type "food" and an event_menu_id — as source text: what
 * a menu line's charge row is written with. Read on the parsed source, like
 * THE ONE PRICE in event-menu.test.ts, which holds the same object's
 * unit_price to the row saveBooking re-read.
 */
function menuLinePushInitializers(source: string, prop: string): string[] {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const body = bodyOf(file, "saveBooking");
  if (!body) return [];
  const out: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const byName = new Map<string, ts.Expression>();
      for (const p of node.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) byName.set(p.name.text, p.initializer);
      const type = byName.get("charge_type");
      const init = byName.get(prop);
      if (byName.has("event_menu_id") && type && ts.isStringLiteral(type) && type.text === "food" && init) out.push(init.getText(file));
    }
    node.forEachChild(walk);
  };
  walk(body);
  return out;
}

test("the check reads what a menu line's charge row is written with", () => {
  const clamped = `export async function saveBooking(i) {
    payload.push({ label: row.label, charge_type: "food", unit_price: row.unit_price, quantity: Math.max(1, l.quantity), amount: row.unit_price * l.quantity, event_menu_id: row.event_menu_id });
    payload.push({ label: l.label, charge_type: l.charge_type, quantity: l.quantity, event_menu_id: null });
  }`;
  assert.deepEqual(menuLinePushInitializers(clamped, "quantity"), ["Math.max(1, l.quantity)"]);
  assert.deepEqual(menuLinePushInitializers(clamped, "amount"), ["row.unit_price * l.quantity"]);
});

test("saveBooking writes a menu line's quantity as sent and its charge to the satang", () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts"), "utf8");
  assert.deepEqual(menuLinePushInitializers(source, "quantity"), ["l.quantity"]);
  assert.deepEqual(menuLinePushInitializers(source, "amount"), ["menuChargeAmount(row.unit_price, l.quantity)"]);
});
