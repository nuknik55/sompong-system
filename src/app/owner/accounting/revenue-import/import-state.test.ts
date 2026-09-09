/**
 * Run with:  npm test
 *
 * The first production run of the import failed at apply: the file had been
 * read from the DOM input, which React 19 resets after a form action. These
 * tests pin the replacement — the File lives in state, and apply can only
 * ever act on the file the preview was built from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canApply, importReducer, initialImportState, type ImportState } from "./import-state.ts";

type Preview = { blocks: readonly unknown[]; gross: number };
type Result = { ok: boolean };
type F = { name: string };
type S = ImportState<F, Preview, Result>;

const A = { name: "SaleData_A.xls" };
const B = { name: "SaleData_B.xls" };
const clean: Preview = { blocks: [], gross: 3989129 };
const blocked: Preview = { blocks: [{ kind: "unstored" }], gross: 3297811 };

function run(...actions: Parameters<typeof importReducer<F, Preview, Result>>[1][]): S {
  return actions.reduce((s, a) => importReducer(s, a), initialImportState<F, Preview, Result>());
}

test("the happy path: select, preview, apply", () => {
  const s1 = run({ type: "select-file", file: A });
  assert.equal(s1.file, A);
  assert.equal(canApply(s1), false); // no preview yet

  const s2 = importReducer(s1, { type: "preview-ok", preview: clean, file: A });
  assert.equal(canApply(s2), true);

  const s3 = importReducer(s2, { type: "apply-ok", result: { ok: true } });
  assert.equal(s3.applied?.ok, true);
  assert.equal(s3.file, A, "the file is kept so a re-run is one click");
  assert.equal(s3.preview, null, "but the preview is dropped — its 'current' column is now stale");
  assert.equal(canApply(s3), false, "a re-run must re-read first");
});

test("REGRESSION: the file is in state, so nothing after preview can lose it", () => {
  // The production failure: apply found no file. In this model the file
  // exists independently of any DOM element, and no action other than
  // select-file can change it.
  const s = run(
    { type: "select-file", file: A },
    { type: "preview-start" },
    { type: "preview-ok", preview: clean, file: A },
    { type: "apply-start" },
    { type: "apply-failed", error: "network" },
    { type: "preview-start" },
    { type: "preview-ok", preview: clean, file: A },
  );
  assert.equal(s.file, A);
  assert.equal(canApply(s), true);
});

test("choosing a different file after a preview INVALIDATES the preview", () => {
  const s = run(
    { type: "select-file", file: A },
    { type: "preview-ok", preview: clean, file: A },
    { type: "select-file", file: B },
  );
  assert.equal(s.file, B);
  assert.equal(s.preview, null, "the old preview must not remain visible beside the new file");
  assert.equal(s.previewedFile, null);
  assert.equal(canApply(s), false, "B cannot be applied against A's numbers");
});

test("a preview that arrives for a file no longer selected does not enable apply", () => {
  // The user picked A, pressed อ่านไฟล์, then picked B before the server
  // answered. The answer is A's preview; the held file is B.
  const s = run(
    { type: "select-file", file: A },
    { type: "preview-start" },
    { type: "select-file", file: B },
    { type: "preview-ok", preview: clean, file: A },
  );
  assert.equal(s.file, B);
  assert.equal(s.previewedFile, A);
  assert.equal(canApply(s), false);
});

test("a blocking condition disables apply even with a matching file", () => {
  const s = run({ type: "select-file", file: A }, { type: "preview-ok", preview: blocked, file: A });
  assert.equal(canApply(s), false);
});

test("clearing the input (select-file with null) disables apply and drops the preview", () => {
  const s = run(
    { type: "select-file", file: A },
    { type: "preview-ok", preview: clean, file: A },
    { type: "select-file", file: null },
  );
  assert.equal(s.file, null);
  assert.equal(s.preview, null);
  assert.equal(canApply(s), false);
});

test("a failed preview keeps the file and records the reason", () => {
  const s = run({ type: "select-file", file: A }, { type: "preview-failed", error: "ไฟล์นี้ครอบคลุมหลายเดือน" });
  assert.equal(s.file, A);
  assert.equal(s.preview, null);
  assert.match(s.error ?? "", /หลายเดือน/);
  assert.equal(canApply(s), false);
});

test("identity, not name: two files with the same name are still two files", () => {
  const A2 = { name: A.name };
  const s = run({ type: "select-file", file: A }, { type: "preview-ok", preview: clean, file: A }, { type: "select-file", file: A2 });
  assert.equal(canApply(s), false);
});
