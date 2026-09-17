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
