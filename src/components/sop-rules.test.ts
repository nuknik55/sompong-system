/**
 * Run with: npm test — the SOP form's rules (queue items 42, 43, 44).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BATCH_YIELD_REFUSAL, parseBatchYield, photoOnlyStepProblem, withStepPhoto } from "./sop-rules.ts";

const step = (text: string, photoUrl: string | null = null) => ({ text, photoUrl });

test("item 43: a step with a photo and no words is refused, and named as the person counts it", () => {
  const p = photoOnlyStepProblem({ prepSteps: [step("ล้างกุ้ง"), step("  ", "https://x/p.jpg")], cookSteps: [], platingSteps: [] });
  assert.match(p ?? "", /ขั้นตอนการเตรียมวัตถุดิบ ขั้นที่ 2/);
  assert.match(photoOnlyStepProblem({ prepSteps: [], cookSteps: [], platingSteps: [step("", "u")] }) ?? "", /การจัดจาน ขั้นที่ 1/);
});

test("item 43: words with or without a photo, and a blank step with no photo, are fine", () => {
  assert.equal(photoOnlyStepProblem({ prepSteps: [step("ล้าง", "u"), step("หั่น"), step("")], cookSteps: [], platingSteps: [] }), null);
});

test("item 42: the photo lands on its own step in the list as it is NOW", () => {
  const picked = [{ tempId: "a", text: "หนึ่ง", photoUrl: null }, { tempId: "b", text: "สอง", photoUrl: null }];
  // While the upload ran: step b was re-worded and a step c added.
  const now = [{ tempId: "a", text: "หนึ่ง", photoUrl: null }, { tempId: "b", text: "สอง (แก้)", photoUrl: null }, { tempId: "c", text: "สาม", photoUrl: null }];
  const after = withStepPhoto(now, "a", "https://x/a.jpg");
  assert.deepEqual(after.map((s) => [s.tempId, s.text, s.photoUrl]), [["a", "หนึ่ง", "https://x/a.jpg"], ["b", "สอง (แก้)", null], ["c", "สาม", null]]);
  assert.notDeepEqual(after, withStepPhoto(picked, "a", "https://x/a.jpg"), "the old list would have dropped c and the edit to b");
});

test("item 42: a step removed during its upload does not come back", () => {
  const now = [{ tempId: "b", text: "สอง", photoUrl: null }];
  assert.deepEqual(withStepPhoto(now, "a", "https://x/a.jpg"), now);
});

test("item 44: a yield is a number above 0, or refused", () => {
  assert.equal(parseBatchYield("8"), 8);
  assert.equal(parseBatchYield(" 2.5 "), 2.5);
  for (const bad of ["", " ", ".", "0", "0.0", "1.2.3", "-1", "abc", "1e3"]) assert.equal(parseBatchYield(bad), null, JSON.stringify(bad));
  assert.match(BATCH_YIELD_REFUSAL, /มากกว่า 0/);
});
