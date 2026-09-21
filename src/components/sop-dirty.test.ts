/**
 * Run with: npm test — what counts as an unsaved change in the SOP form,
 * used daily by the head chef and the prep head.
 *
 * The old model was a flag set by every onChange, so every "and back
 * again" case below would have read as changed for the rest of the visit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sopSnapshot, type SopState } from "./sop-dirty.ts";

const blank = (): SopState => ({
  authorName: "", updatedAt: "2026-09-21", demoVideoUrl: "",
  ingredientNotes: {}, prepSteps: [], cookSteps: [], platingSteps: [], checklist: [],
});
const filled = (): SopState => ({
  authorName: "เวช", updatedAt: "2026-09-01", demoVideoUrl: "https://example.com/v",
  ingredientNotes: { "i-pork": "หั่นเต๋า", "i-garlic": "สับละเอียด" },
  prepSteps: [{ text: "ล้างหมู", photoUrl: null }, { text: "หั่น", photoUrl: "p1.jpg" }],
  cookSteps: [{ text: "ผัด", photoUrl: null }],
  platingSteps: [{ text: "ตักใส่จาน", photoUrl: null }],
  checklist: [{ text: "ร้อน" }],
});
const snap = sopSnapshot;

test("A FORM NOBODY TOUCHED IS CLEAN — a new SOP and an existing one", () => {
  assert.equal(snap(blank()), snap(blank()));
  assert.equal(snap(filled()), snap(filled()));
});

test("TYPED AND REVERTED IS CLEAN — the false warning the flag gave", () => {
  const s = filled();
  assert.notEqual(snap({ ...s, authorName: "เวชX" }), snap(s));
  assert.equal(snap({ ...s, authorName: "เวช" }), snap(s), "back to what it was");
  const step = { ...s, prepSteps: [{ text: "ล้างหมูให้สะอาด", photoUrl: null }, s.prepSteps[1]!] };
  assert.notEqual(snap(step), snap(s));
  assert.equal(snap({ ...s, prepSteps: [{ text: "ล้างหมู", photoUrl: null }, s.prepSteps[1]!] }), snap(s));
});

test("A NOTE TYPED AND CLEARED IS THE SAME AS NO NOTE — the save writes no blank note", () => {
  const s = blank();
  assert.equal(snap({ ...s, ingredientNotes: { "i-pork": "" } }), snap(s), "cleared");
  assert.equal(snap({ ...s, ingredientNotes: { "i-pork": "   " } }), snap(s), "whitespace only");
  assert.notEqual(snap({ ...s, ingredientNotes: { "i-pork": "x" } }), snap(s), "but a real note is a change");
});

test("NOTES ARE TRIMMED LIKE THE SAVE TRIMS THEM, and their order does not matter", () => {
  const s = filled();
  assert.equal(snap({ ...s, ingredientNotes: { "i-pork": "หั่นเต๋า ", "i-garlic": " สับละเอียด" } }), snap(s));
  assert.equal(snap({ ...s, ingredientNotes: { "i-garlic": "สับละเอียด", "i-pork": "หั่นเต๋า" } }), snap(s), "key order");
});

test("A STEP ADDED AND LEFT BLANK IS NOT A CHANGE — the save drops blank steps", () => {
  const s = filled();
  assert.equal(snap({ ...s, cookSteps: [...s.cookSteps, { text: "", photoUrl: null }] }), snap(s));
  assert.equal(snap({ ...s, checklist: [...s.checklist, { text: "  " }] }), snap(s));
  // Faithful to the save, including its quirk: a blank step's photo is dropped with it.
  assert.equal(snap({ ...s, cookSteps: [...s.cookSteps, { text: "", photoUrl: "lost.jpg" }] }), snap(s));
});

test("THE VIDEO LINK IS TRIMMED LIKE THE SAVE TRIMS IT", () => {
  const s = filled();
  assert.equal(snap({ ...s, demoVideoUrl: "https://example.com/v " }), snap(s));
  assert.notEqual(snap({ ...s, demoVideoUrl: "https://example.com/w" }), snap(s));
});

test("THE CLIENT tempId IS NOT PART OF IT — it is regenerated on every derivation", () => {
  // StepItem carries a tempId from Date.now/Math.random; the snapshot takes
  // only text and photo, so two derivations of one SOP compare equal.
  const withIds = { ...filled(), prepSteps: filled().prepSteps.map((p, i) => ({ ...p, tempId: `t${i}-${Math.random()}` })) };
  assert.equal(snap(withIds as SopState), snap(filled()));
});

test("EVERY REAL EDIT IS CAUGHT — a missed one is lost work", () => {
  const s = filled();
  const cases: [string, SopState][] = [
    ["author", { ...s, authorName: "นิก" }],
    ["date", { ...s, updatedAt: "2026-09-02" }],
    ["video", { ...s, demoVideoUrl: "" }],
    ["a note changed", { ...s, ingredientNotes: { ...s.ingredientNotes, "i-pork": "หั่นชิ้น" } }],
    ["a note removed", { ...s, ingredientNotes: { "i-garlic": "สับละเอียด" } }],
    ["a step's text", { ...s, cookSteps: [{ text: "ผัดไฟแรง", photoUrl: null }] }],
    ["a step's photo", { ...s, prepSteps: [s.prepSteps[0]!, { text: "หั่น", photoUrl: "p2.jpg" }] }],
    ["a step removed", { ...s, prepSteps: [s.prepSteps[0]!] }],
    ["steps reordered", { ...s, prepSteps: [s.prepSteps[1]!, s.prepSteps[0]!] }],
    ["a step moved between sections", { ...s, cookSteps: [], platingSteps: [...s.platingSteps, { text: "ผัด", photoUrl: null }] }],
    ["a checklist line", { ...s, checklist: [{ text: "ร้อนจัด" }] }],
    ["a checklist line added", { ...s, checklist: [...s.checklist, { text: "สะอาด" }] }],
    ["trailing space in a STEP — steps are written untrimmed", { ...s, cookSteps: [{ text: "ผัด ", photoUrl: null }] }],
  ];
  for (const [what, state] of cases) assert.notEqual(snap(state), snap(s), what);
});
