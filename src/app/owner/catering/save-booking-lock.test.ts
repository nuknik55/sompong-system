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
 * Null when saveBooking, before its first write (upsertCateringEvent): keeps
 * the lines check's answer and RETURNS on it, and runs the database's dry run
 * of the price box (checkBookingPrices) — and writes the price box
 * (writeBookingPrices) only AFTER the booking's own fields; otherwise why not.
 * A call whose answer is ignored refuses nothing, so the order of the calls
 * alone is not enough (review, 2026-09-21).
 */
function linesFirstProblem(source: string): string | null {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const body = bodyOf(file, "saveBooking");
  if (!body) return "no saveBooking";
  let writeAt = -1, checkAt = -1, returnAt = -1, dryAt = -1, pricesAt = -1;
  let answer: string | null = null;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "upsertCateringEvent" && writeAt < 0) writeAt = node.getStart(file);
      if (name === "checkBookingPrices" && dryAt < 0) dryAt = node.getStart(file);
      if (name === "writeBookingPrices" && pricesAt < 0) pricesAt = node.getStart(file);
      if (name === "bookingLinesProblem" && checkAt < 0) {
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
  if (checkAt < 0) return "no bookingLinesProblem call";
  if (checkAt > writeAt) return "the lines are checked after the booking is written";
  if (!answer) return "the check's answer is not kept";
  if (returnAt < 0) return "nothing returns on the check's answer";
  if (returnAt > writeAt) return "the refusal comes after the booking is written";
  if (dryAt < 0) return "no checkBookingPrices call";
  if (dryAt > writeAt) return "the dry run comes after the booking is written";
  if (pricesAt < 0) return "no writeBookingPrices call";
  if (pricesAt < writeAt) return "the price box is written before the booking";
  return null;
}

test("the check flags lines checked late, not checked, a comment, an answer ignored or not returned on, and a dry run late or missing", () => {
  const fn = (inner: string) => `export async function saveBooking(i) {\n${inner}\n}`;
  const check = "const bad = bookingLinesProblem(i.lines, kinds);\nif (bad) return { ok: false, error: bad };";
  const dry = "const dry = await checkBookingPrices(db, id, i.lines, i.known);\nif (dry) return { ok: false, error: dry };";
  const write = "const id = await upsertCateringEvent(i.event);";
  const prices = "await writeBookingPrices(db, id, i.lines, i.known);";
  assert.equal(linesFirstProblem(fn(`${write}\n${check}\n${dry}\n${prices}`)), "the lines are checked after the booking is written");
  assert.equal(linesFirstProblem(fn(`// bookingLinesProblem(i.lines) — in a comment only\n${dry}\n${write}\n${prices}`)), "no bookingLinesProblem call");
  assert.equal(linesFirstProblem(fn(`bookingLinesProblem(i.lines, kinds);\n${dry}\n${write}\n${prices}`)), "the check's answer is not kept");
  assert.equal(linesFirstProblem(fn(`const bad = bookingLinesProblem(i.lines, kinds);\nif (bad) console.log(bad);\n${dry}\n${write}\n${prices}`)), "nothing returns on the check's answer");
  assert.equal(linesFirstProblem(fn(`${check}\n${write}\n${dry}\n${prices}`)), "the dry run comes after the booking is written");
  assert.equal(linesFirstProblem(fn(`${check}\n${write}\n${prices}`)), "no checkBookingPrices call");
  assert.equal(linesFirstProblem(fn(`${check}\n${dry}\n${prices}\n${write}`)), "the price box is written before the booking");
  assert.equal(linesFirstProblem(fn(`${check}\n${dry}\n${write}\n${prices}`)), null);
});

test("saveBooking checks every line and dry-runs the price box before it writes anything, and writes the price box after the booking", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.equal(linesFirstProblem(fs.readFileSync(actions, "utf8")), null);
});

/**
 * Every statement in the file that writes catering_event_charges directly —
 * `.from("catering_event_charges")` followed by insert, update, upsert or
 * delete. Since 2026-09-21 the price box is written by
 * catering_save_booking_prices in one transaction; a direct write is the
 * shape that deleted every charge row, then failed the insert, and left a
 * booking with no price lines.
 */
function directChargeWrites(source: string): string[] {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ["insert", "update", "upsert", "delete"].includes(node.expression.name.text)) {
      // Down the chain to its .from("…").
      let inner: ts.Expression = node.expression.expression;
      while (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text !== "from") {
        inner = inner.expression.expression;
      }
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "from"
          && inner.arguments[0] && ts.isStringLiteral(inner.arguments[0]) && inner.arguments[0].text === "catering_event_charges") {
        hits.push(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: .${node.expression.name.text}`);
      }
    }
    node.forEachChild(walk);
  };
  walk(file);
  return hits;
}

test("the direct-write check finds a delete and an insert on the charges, and not a read, a comment or another table", () => {
  const src = `async function f(db) {
    // db.from("catering_event_charges").delete() — in a comment only
    await db.from("catering_event_charges").delete().eq("event_id", id);
    await db.from("catering_event_charges").insert(rows);
    await db.from("catering_event_charges").select("id").eq("event_id", id);
    await db.from("catering_event_menus").delete().eq("id", id);
  }`;
  assert.deepEqual(directChargeWrites(src), ["3: .delete", "4: .insert"]);
});

test("nothing in the catering actions writes a charge row directly: the price box is one transaction", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.deepEqual(directChargeWrites(fs.readFileSync(actions, "utf8")), []);
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

test("the rounding check flags a clamp put back on the save path, and not a comment", () => {
  const clamped = `export async function saveBooking(i) {
    // Math.max(1, l.quantity) — in a comment only
    const lines = i.lines.map((l) => ({ ...l, quantity: Math.max(1, l.quantity) }));
  }`;
  assert.deepEqual(quantityRounding(clamped, ["saveBooking"]), ["saveBooking: Math.max(1, l.quantity)"]);
});

test("saveBooking sends every quantity as it came: nothing rounds or clamps it", () => {
  const actions = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts");
  assert.deepEqual(quantityRounding(fs.readFileSync(actions, "utf8"), ["saveBooking"]), []);
});
