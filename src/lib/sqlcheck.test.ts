/**
 * Run with: npm test — the SQL checker still catches what it exists to catch,
 * and every tracked migration passes it.
 *
 * Migrations are run by hand in the Supabase SQL editor, so scripts/sqlcheck.mjs
 * is the only check a file gets before Nik runs it (AGENTS.md, "The SQL
 * checker"). CI runs `node scripts/sqlcheck.mjs --all` as its own step; this
 * file keeps the same promise inside `npm test`, and proves the checker can
 * fail, on the one file known to be broken:
 *
 *   scripts/sqlcheck-fixtures/test_data_cleanup_migration.3057c55.sql is the
 *   test-data deletion as first committed (3057c55). It failed at parse time
 *   on its first run, 2026-09-22 — three PL/pgSQL IF conditions held a bare
 *   CASE — and checks A–F passed it. Check G was written for it. The fixture
 *   is pinned by hash so it stays the real file. DO NOT RUN IT: it cannot
 *   parse, and the rows it names are deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHECKER = path.join(APP, "scripts", "sqlcheck.mjs");
const FIXTURE = path.join(APP, "scripts", "sqlcheck-fixtures", "test_data_cleanup_migration.3057c55.sql");
const run = (...args: string[]) => spawnSync(process.execPath, [CHECKER, ...args], { cwd: APP, encoding: "utf8" });
const problemsOf = (stdout: string) => stdout.split("\n").filter((l) => l.startsWith("  XX ")).map((l) => l.slice(5));

test("THE 3057c55 FILE FAILS: check G flags its three IF conditions cut at a CASE's THEN, and nothing else", () => {
  // Line endings normalised: git may check the file out with CRLF on Windows.
  const text = fs.readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"),
    "a794141ef2c2be806210f842bd1ba72ac764a5a50a06108c477ab1719b10153a",
    "the fixture must be the file committed in 3057c55, byte for byte");
  const r = run(FIXTURE);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(problemsOf(r.stdout).map((p) => p.split(" ")[0]), ["G:1053", "G:1150", "G:1157"]);
});

test("the file Nik ran (3243e1a) passes every check, with no exception", () => {
  const r = run(path.join(APP, "supabase", "test_data_cleanup_migration.sql"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(problemsOf(r.stdout), []);
});

test("EVERY TRACKED MIGRATION PASSES, with only the recorded historical exceptions (the CI step)", () => {
  const r = run("--all");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = /sqlcheck --all: (\d+) migrations, 0 with a problem that is not an exception/.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(Number(m[1]) >= 89, `only ${m[1]} migrations checked: git ls-files is not seeing supabase/`);
});
