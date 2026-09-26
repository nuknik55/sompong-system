/**
 * Run with: npm test — hidden pay is null, never 0; unread pay is never saved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_PAY, PAY_UNREAD_REFUSAL, isPayFigure, payFiguresProblem } from "./pay-rules.ts";

test("hidden pay carries no number at all", () => {
  for (const [k, v] of Object.entries(NO_PAY)) assert.equal(v, null, k);
});

test("a pay figure is a finite number, 0 or more", () => {
  for (const ok of [0, 1, 15000, 0.5]) assert.equal(isPayFigure(ok), true, String(ok));
  for (const bad of [null, undefined, NaN, Infinity, -1, "15000", ""]) assert.equal(isPayFigure(bad), false, String(bad));
});

test("an employee save is refused when any monthly figure is unread", () => {
  const good = { base_salary: 15000, position_allowance: 0, social_security_monthly: 750, daily_wage: null };
  assert.equal(payFiguresProblem(good), null);
  assert.equal(payFiguresProblem({ ...good, daily_wage: 400 }), null);
  assert.equal(payFiguresProblem({ ...NO_PAY }), PAY_UNREAD_REFUSAL, "what admin receives can never be saved back");
  assert.equal(payFiguresProblem({ ...good, base_salary: null }), PAY_UNREAD_REFUSAL);
  assert.equal(payFiguresProblem({ ...good, social_security_monthly: NaN }), PAY_UNREAD_REFUSAL);
  assert.equal(payFiguresProblem({ ...good, daily_wage: -5 }), PAY_UNREAD_REFUSAL);
});

// The wiring, read from the shipped files (comments stripped).
const code = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("the HR actions use the shared NO_PAY and refuse unread pay on save", () => {
  const src = code("../app/owner/hr/actions.ts");
  assert.match(src, /import \{[^}]*NO_PAY[^}]*\} from "@\/lib\/pay-rules"/);
  assert.doesNotMatch(src, /const NO_PAY/, "no local NO_PAY with zeros");
  const upsert = src.slice(src.indexOf("export async function upsertEmployee("), src.indexOf("export async function updateEmployeeSortOrders("));
  assert.match(upsert, /payFiguresProblem\(e\)/, "upsertEmployee checks the figures");
  assert.ok(upsert.indexOf("payFiguresProblem(e)") < upsert.indexOf('from("employees")'), "before it writes");
  for (const getter of ["getPayrollEntries", "getEmployeePayrollHistory"]) {
    const start = src.indexOf(`export async function ${getter}(`);
    const body = src.slice(start, src.indexOf("\nexport async function ", start + 10));
    assert.match(body, /PAY_UNREAD_REFUSAL/, getter + " refuses to compute from unread pay");
  }
});
