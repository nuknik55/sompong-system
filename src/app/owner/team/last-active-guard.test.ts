/**
 * Run with: npm test — every team action that can leave nobody able to sign
 * in as owner or admin asks the same rule first (lastActiveCheck: owners and
 * admins whose login is not banned, fail closed on a bad read).
 *
 * Deleting and disabling used it; demoting an admin still counted admin
 * PROFILES, so a disabled admin counted as one and the only admin who could
 * sign in could be demoted (2026-09-23). Nothing but the call itself keeps
 * the three in step, so the call is tested, on the parsed source: a comment
 * naming it, or a call whose answer is ignored, cannot satisfy it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The writes that remove or demote an account, as method names. */
const WRITES = new Set(["update", "delete", "updateUserById", "deleteUser"]);

/**
 * Null when `fnName` calls lastActiveCheck, keeps its answer, returns on it,
 * and does all that before its first write; otherwise why not.
 */
function guardProblem(source: string, fnName: string): string | null {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  let body: ts.Block | undefined;
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) body = node.body;
  });
  if (!body) return `no ${fnName}`;
  let checkAt = -1, returnAt = -1, writeAt = -1;
  let answer: string | null = null;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "lastActiveCheck" && checkAt < 0) {
        checkAt = node.getStart(file);
        const holder = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
        if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) answer = holder.name.text;
      }
      if (ts.isPropertyAccessExpression(callee) && WRITES.has(callee.name.text) && writeAt < 0) writeAt = node.getStart(file);
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
  if (checkAt < 0) return "no lastActiveCheck call";
  if (!answer) return "the check's answer is not kept";
  if (returnAt < 0) return "nothing returns on the check's answer";
  if (writeAt < 0) return "no write";
  if (checkAt > writeAt || returnAt > writeAt) return "the check comes after the write";
  return null;
}

test("the check flags the old profile count, a comment, an ignored answer and a late check", () => {
  const fn = (inner: string) => `export async function updateUserRole(userId, role) {\n${inner}\n}`;
  const write = `const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);`;
  const check = `const lastActive = await lastActiveCheck(supabase, current, "x", "ลดสิทธิ์");\nif (lastActive) return { error: lastActive };`;
  // THE DEFECT's shape: the admin profiles counted, a disabled one included.
  const old = `if (role !== "admin" && current.role === "admin" && (await countAdmins(supabase)) <= 1) return { error: "x" };`;
  assert.equal(guardProblem(fn(`${old}\n${write}`), "updateUserRole"), "no lastActiveCheck call");
  assert.equal(guardProblem(fn(`// lastActiveCheck(supabase, current) — in a comment only\n${write}`), "updateUserRole"), "no lastActiveCheck call");
  assert.equal(guardProblem(fn(`await lastActiveCheck(supabase, current, "x");\n${write}`), "updateUserRole"), "the check's answer is not kept");
  assert.equal(guardProblem(fn(`const lastActive = await lastActiveCheck(supabase, current, "x");\nif (lastActive) console.log(lastActive);\n${write}`), "updateUserRole"), "nothing returns on the check's answer");
  assert.equal(guardProblem(fn(`${write}\n${check}`), "updateUserRole"), "the check comes after the write");
  assert.equal(guardProblem(fn(`if (role !== "admin") {\n${check}\n}\n${write}`), "updateUserRole"), null);
});

test("demoting, deleting and disabling all ask the last-active rule before they write", () => {
  const actions = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "actions.ts"), "utf8");
  for (const fnName of ["updateUserRole", "deleteUser", "setUserDisabled"]) {
    assert.equal(guardProblem(actions, fnName), null, fnName);
  }
});
