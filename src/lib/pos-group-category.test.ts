/** Run with: npm test — the shared POS-group resolution, used by the seed and the screen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFromPosGroup, suggestFromPosGroups } from "./pos-group-category.ts";

test("the eleven groups: eight resolve, three have no default, unknown is null", () => {
  assert.equal(categoryFromPosGroup("อาหาร", ""), "food");
  assert.equal(categoryFromPosGroup("ตรุษจีน", ""), "food");
  assert.equal(categoryFromPosGroup("Comment Menu", ""), "food");
  assert.equal(categoryFromPosGroup("อาหารเจ", ""), "food");
  assert.equal(categoryFromPosGroup("Lineman", ""), "food");
  assert.equal(categoryFromPosGroup("เครื่องดื่ม", "น้ำผลไม้"), "drink");
  assert.equal(categoryFromPosGroup("เครื่องดื่ม", "ของหวาน"), "dessert");
  assert.equal(categoryFromPosGroup("ร้านกาแฟ", ""), "coffee");
  assert.equal(categoryFromPosGroup("กลุ่มของฝาก", ""), "souvenir");
  assert.equal(categoryFromPosGroup("Other", ""), null);
  assert.equal(categoryFromPosGroup("ออเดอร์พนักงาน", ""), null);
  assert.equal(categoryFromPosGroup("อื่นๆ", ""), null);
  assert.equal(categoryFromPosGroup("กลุ่มใหม่", ""), null, "an unlisted group is reported, never defaulted");
});

test("suggestion: one resolved group → that; a no-default group beside it says nothing; two resolved groups disagreeing → none", () => {
  assert.equal(suggestFromPosGroups([{ group: "อาหาร", subcategory: "" }]), "food");
  assert.equal(suggestFromPosGroups([{ group: "อาหาร", subcategory: "" }, { group: "ออเดอร์พนักงาน", subcategory: "" }]), "food");
  assert.equal(suggestFromPosGroups([{ group: "ออเดอร์พนักงาน", subcategory: "" }]), null, "staff orders alone suggest nothing");
  assert.equal(suggestFromPosGroups([{ group: "อาหาร", subcategory: "" }, { group: "ร้านกาแฟ", subcategory: "" }]), null, "groups disagree → a person decides");
  assert.equal(suggestFromPosGroups([{ group: "อาหาร", subcategory: "" }, { group: "Lineman", subcategory: "" }]), "food", "two groups, one answer");
  assert.equal(suggestFromPosGroups([]), null);
});
