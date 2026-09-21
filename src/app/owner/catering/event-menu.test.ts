/**
 * Run with: npm test — the figures on a booking's own menu, the draft the
 * screen holds until บันทึก, and what reaches the browser.
 *
 * The worked examples are Nik's: 4,800 of dishes sold as a 4,500 set sells
 * BELOW à-la-carte by 6.25% (sales may see it); his four courses 250 × 5,
 * 1,000, 180 and 547.06 add up to 2,977.06 and the rows must show why; 2,000
 * of cost against 4,500 is 44.44% (owner and admin only). The last tests are
 * the payload: the view a sales session is sent carries no cost, even when a
 * cost map was handed to the builder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  applySourceDishes, buildEventMenuLines, buildEventMenuView, comparisonHeadline, comparisonText, COMPARISON_LABEL,
  dishLineTotal, dishLineTotalText, dishNamesForPriceBox, dishesTotalPerTable, draftDishes, draftFromLine, draftsEqual, duplicateSetName, EVENT_MENU_SECTION_LIST,
  foodCostFigure, isSetLine, lineDraftsEqual, lineFoodCost, newCustomLineDraft, resolveDishes, setVsAlaCarte,
  swapPriceWarning, swapWarningText, SWAP_WARN_RATIO, toSavePayload, validateDrafts, validateSavePayload, viewVersion, removedLineIds, validateRemoveIds,
  isSetNameTaken, newLineDraftFromSource, draftPrice,
  type EventMenuDish, type EventMenuLine,
} from "./event-menu.ts";

const dish = (menu_name: string, selling_price: number, quantity = 1, section = "dish", id = menu_name): EventMenuDish => ({
  id, menu_id: `m-${id}`, menu_name, selling_price, quantity, section, sort_order: 0, note: null,
});
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.005, `${what}: ${a} vs ${b}`);

// ── The figures ──────────────────────────────────────────────────────────────

test("NIK'S FOUR COURSES: every row shows its own product, and the rows add up to the total under them", () => {
  // 2026-09-19: the screen said 2,977.06; Nik summed the displayed unit
  // prices (250 + 1,000 + 180 + 547.06 = 1,977.06) because the row never
  // showed 250 × 5. Quantity is portions per table, so 2,977.06 was right —
  // the defect was that the rows could not be added up to it.
  const courses = [dish("A", 250, 5), dish("B", 1000), dish("C", 180), dish("D", 547.06)];
  const rows = courses.map(dishLineTotal);
  assert.deepEqual(rows, [1250, 1000, 180, 547.06]);
  near(rows.reduce((s, r) => s + r, 0), 2977.06, "the rows' sum");
  near(dishesTotalPerTable(courses), 2977.06, "the total");
  near(dishesTotalPerTable(courses), rows.reduce((s, r) => s + r, 0), "total = Σ rows, by construction");
  // And the row TEXT carries the arithmetic, so a reader can add it up.
  assert.equal(dishLineTotalText(courses[0]!), "฿250.00 × 5 = ฿1,250.00");
  assert.equal(dishLineTotalText(courses[1]!), "฿1,000.00", "a single portion shows the price alone");
  assert.equal(dishLineTotalText(dish("E", 547.06, 2)), "฿547.06 × 2 = ฿1,094.12");
});

test("NIK'S EXAMPLE: dishes worth 4,800 sold as a 4,500 set sells BELOW à-la-carte by 6.25%", () => {
  const dishes = [dish("ปลากะพงทอดน้ำปลา", 1200), dish("กุ้งอบวุ้นเส้น", 900), dish("เป็ดปักกิ่ง", 1500), dish("ผัดผัก", 400), dish("ข้าวผัด", 800)];
  assert.equal(dishesTotalPerTable(dishes), 4800);
  const fig = setVsAlaCarte(4800, 4500)!;
  assert.equal(fig.direction, "below");
  assert.equal(fig.diff, -300);
  near(fig.pct, 6.25, "%");
  assert.equal(comparisonHeadline(fig), "ต่ำกว่าสั่งแยกจาน 6.25%");
  assert.match(comparisonText(fig), /ราคาชุด 4,500\.00 บาท ต่ำกว่าราคาสั่งแยกจานรวม 4,800\.00 บาท อยู่ 300\.00 บาท \(6\.25% ของราคาสั่งแยกจาน\)/);
});

test("NIK'S BOOKING: a 4,500 set over 2,977.06 of dishes sells ABOVE à-la-carte, and says so — never as a negative discount", () => {
  const fig = setVsAlaCarte(2977.06, 4500)!;
  assert.equal(fig.direction, "above");
  near(fig.diff, 1522.94, "baht above");
  near(fig.pct, 51.16, "%");
  assert.equal(comparisonHeadline(fig), "สูงกว่าสั่งแยกจาน 51.16%");
  const text = comparisonText(fig);
  assert.match(text, /สูงกว่า/);
  assert.match(text, /1,522\.94 บาท/);
  assert.match(text, /51\.16%/);
  assert.doesNotMatch(text, /ส่วนลด|−|-\d/, "no discount wording and no sign to interpret");
  assert.equal(COMPARISON_LABEL, "ราคาอาหารชุดเทียบกับสั่งแยกจาน");
});

test("the comparison's edge cases: equal, no dishes, no price", () => {
  assert.equal(setVsAlaCarte(4500, 4500)!.direction, "equal");
  assert.equal(comparisonHeadline(setVsAlaCarte(4500, 4500)), "เท่ากับสั่งแยกจาน");
  assert.match(comparisonText(setVsAlaCarte(4500, 4500)), /เท่ากับ.*พอดี/);
  assert.equal(setVsAlaCarte(0, 4500), null, "no dishes: nothing to compare");
  assert.equal(setVsAlaCarte(4800, null), null);
  assert.equal(comparisonHeadline(null), "—");
  assert.match(comparisonText(null), /ยังเทียบไม่ได้/);
});

test("NIK'S OTHER EXAMPLE: cost 2,000 against 4,500 is 44.44%; the line cost multiplies portions the same way the price does", () => {
  near(foodCostFigure(2000, 4500).pct!, 44.44, "food cost %");
  assert.equal(foodCostFigure(2000, null).pct, null, "no price, no percentage");
  assert.equal(foodCostFigure(2000, 0).pct, null);
  const costs = { "m-A": { unit_cost: 40, has_unknown_cost: false }, "m-B": { unit_cost: 300, has_unknown_cost: false } };
  const c = lineFoodCost([dish("A", 250, 5), dish("B", 1000)], costs);
  assert.equal(c.costPerTable, 40 * 5 + 300, "five portions of A cost five times A");
  assert.equal(c.hasUnknownCost, false);
  const u = lineFoodCost([dish("A", 250, 5), dish("Z", 100)], costs);
  assert.equal(u.costPerTable, 200);
  assert.equal(u.hasUnknownCost, true, "a dish with no cost entry is unknown, not zero and silent");
});

test("a swap is flagged past 10%, in either direction, and exactly 10% is not past it", () => {
  assert.equal(SWAP_WARN_RATIO, 0.1);
  assert.equal(swapPriceWarning(1000, 1100).warn, false, "exactly +10%");
  assert.equal(swapPriceWarning(1000, 900).warn, false, "exactly -10%");
  assert.equal(swapPriceWarning(1000, 1101).warn, true);
  assert.equal(swapPriceWarning(1000, 899).warn, true);
  assert.equal(swapPriceWarning(1000, 1000).warn, false);
  assert.equal(swapPriceWarning(0, 500).warn, false, "no old price, nothing to compare against");
  assert.equal(swapPriceWarning(NaN, 500).warn, false);
  near(swapPriceWarning(1200, 1500).diffPct!, 25, "diff %");
  const text = swapWarningText("ปลากะพงทอดน้ำปลา", 1200, "ปลากะพงอบเกลือ", 1500);
  assert.match(text, /แพงกว่า/);
  assert.match(text, /25\.0%/);
  assert.match(text, /เกิน 10%/);
  assert.match(swapWarningText("A", 1500, "B", 1200), /ถูกกว่า/);
});

test("the copy is the record; a booking from before the feature falls back to the shared set", () => {
  const copy = [dish("copied", 100)];
  const shared = [dish("shared", 100)];
  assert.deepEqual(resolveDishes(copy, shared, true), { source: "copy", dishes: copy });
  assert.deepEqual(resolveDishes(undefined, shared, false), { source: "shared", dishes: shared }, "never copied: the shared set, as before");
  assert.deepEqual(resolveDishes(undefined, undefined, false), { source: "none", dishes: [] });
  assert.deepEqual(resolveDishes([], [], false), { source: "none", dishes: [] });
  assert.deepEqual(resolveDishes(copy, shared, false), { source: "copy", dishes: copy });
  // THE REVIEW'S HOLE: a copy emptied to zero rows is still a copy.
  assert.deepEqual(resolveDishes([], shared, true), { source: "copy", dishes: [] });
  assert.deepEqual(resolveDishes(undefined, shared, true), { source: "copy", dishes: [] });
});

test("a set line is one with a shared source, or one naming no dish (a custom set); a dish line names a dish", () => {
  assert.equal(isSetLine({ set_menu_id: "s1", menu_id: null }), true);
  assert.equal(isSetLine({ set_menu_id: null, menu_id: null }), true, "a custom set: neither, by the widened CHECK");
  assert.equal(isSetLine({ set_menu_id: null, menu_id: "m1" }), false);
});

test("the page's lines carry the charge's price per table and the resolved dishes; dish lines are left out", () => {
  const menus = [
    { id: "L1", set_menu_id: "s1", menu_id: null, name: "ชุด 4,500", quantity: 10 },
    { id: "L2", set_menu_id: null, menu_id: null, name: "ชุดพิเศษ", quantity: 2 },
    { id: "D1", set_menu_id: null, menu_id: "m9", name: "ข้าวผัดกุ้ง", quantity: 10 },
  ];
  const charges = [
    { event_menu_id: "L1", unit_price: 4500 },
    { event_menu_id: "L2", unit_price: 3000 },
    { event_menu_id: "D1", unit_price: 160 },
    { event_menu_id: null, unit_price: 2000 },
  ];
  const dishes = new Map([["L1", { source: "copy" as const, dishes: [dish("ปลากะพง", 1200)] }]]);
  const lines = buildEventMenuLines(menus, charges, dishes);
  assert.deepEqual(lines.map((l) => l.id), ["L1", "L2"]);
  assert.equal(lines[0]!.pricePerTable, 4500);
  assert.equal(lines[0]!.tables, 10);
  assert.equal(lines[0]!.source, "copy");
  assert.equal(lines[1]!.pricePerTable, 3000);
  assert.equal(lines[1]!.source, "none", "a custom set with no dishes yet");
});

test("the price box's dish names: section order, then serving order; nothing dropped here", () => {
  const dishes = [
    { ...dish("ขนม", 100, 1, "dessert"), sort_order: 10 },
    { ...dish("ปลา", 1000, 1, "dish"), sort_order: 20 },
    { ...dish("กุ้ง", 900, 1, "dish"), sort_order: 10 },
    { ...dish("น้ำ", 50, 1, "drink"), sort_order: 10 },
  ];
  assert.deepEqual(dishNamesForPriceBox(dishes), ["กุ้ง", "ปลา", "ขนม", "น้ำ"]);
});

// ── The draft ────────────────────────────────────────────────────────────────

const line = (over: Partial<EventMenuLine> = {}): EventMenuLine => ({
  id: "L1", name: "ชุด 4,500", tables: 10, pricePerTable: 4500, sourceSetMenuId: "s1", source: "copy",
  dishes: [dish("A", 250, 5), dish("B", 1000)],
  ...over,
});

test("DRAFT: opening the page is not dirty; every kind of edit is; ยกเลิก is a return to the baseline", () => {
  const base = [draftFromLine(line())];
  assert.equal(draftsEqual(base, [draftFromLine(line())]), true, "the same line twice is not a change");
  const qty = structuredClone(base); qty[0]!.dishes[0]!.quantity = "6";
  const swap = structuredClone(base); swap[0]!.dishes[1] = { ...swap[0]!.dishes[1]!, menu_id: "m-Z", menu_name: "Z", selling_price: 990 };
  const removed = structuredClone(base); removed[0]!.dishes.pop();
  const added = structuredClone(base); added[0]!.dishes.push({ key: "k", menu_id: "m-N", menu_name: "N", selling_price: 300, quantity: "1", section: "dish", note: null, source_set_menu_id: null, source_event_menu_id: null });
  const price = structuredClone(base); price[0]!.price = "4321";
  const kept = structuredClone(base); kept[0]!.materialize = true;
  for (const [what, d] of Object.entries({ qty, swap, removed, added, price, kept })) assert.equal(draftsEqual(base, d), false, `${what} is a change`);
  // Text that parses to the same number is not a change: "4500.0" is 4500.
  const same = structuredClone(base); same[0]!.price = "4500.0"; same[0]!.dishes[0]!.quantity = "5.0";
  assert.equal(draftsEqual(base, same), true);
  assert.equal(lineDraftsEqual(base[0]!, structuredClone(base)[0]!), true);
});

test("DRAFT: the payload carries only the lines that changed, whole, and a new custom set with its name and tables", () => {
  const base = [draftFromLine(line()), draftFromLine(line({ id: "L2", name: "ชุดเล็ก", pricePerTable: 3000, sourceSetMenuId: null, dishes: [dish("C", 180)] }))];
  const drafts = structuredClone(base);
  drafts[0]!.price = "4321";
  drafts[0]!.dishes[0]!.quantity = "6";
  drafts.push(newCustomLineDraft("new-1", " ชุดพิเศษ ", 5000));
  assert.equal(validateDrafts(drafts), null);
  const payload = toSavePayload(drafts, base);
  assert.deepEqual(payload.map((p) => p.key), ["L1", "new-1"], "L2 was not touched and is not sent");
  assert.equal(payload[0]!.event_menu_id, "L1");
  assert.equal(payload[0]!.price_per_table, 4321);
  assert.equal(payload[0]!.set_name, null, "an existing line keeps its name");
  assert.deepEqual(payload[0]!.items.map((i) => [i.menu_id, i.quantity, i.sort_order]), [["m-A", 6, 10], ["m-B", 1, 20]], "the whole list, not the diff");
  assert.deepEqual(payload[0]!.known_item_ids, ["A", "B"], "the conflict token: the row ids the page opened with");
  assert.equal(payload[0]!.known_price, 4500, "and the price it opened with, not the one being saved");
  assert.equal(payload[1]!.event_menu_id, null);
  assert.deepEqual([payload[1]!.known_item_ids, payload[1]!.known_price], [[], null], "a new set has nothing to conflict with");
  assert.equal(payload[1]!.set_name, "ชุดพิเศษ");
  assert.equal(payload[1]!.tables, 1, "A4: a new set is one table; the real count is set in the price box");
  assert.equal(payload[1]!.price_per_table, 5000);
  assert.deepEqual(payload[1]!.items, [], "started empty");
  assert.equal(validateSavePayload(payload), null, "and the server accepts what the screen sends");
});

test("DRAFT: a fallback line keeps its shared-set provenance when materialised; a source fill records where it came from", () => {
  const fallback = draftFromLine(line({ source: "shared", sourceSetMenuId: "s1" }));
  assert.equal(fallback.dishes[0]!.source_set_menu_id, "s1", "the shared set is the provenance of a materialised fallback row");
  const copied = draftFromLine(line({ dishes: [{ ...dish("A", 250), source_set_menu_id: "s9", source_event_menu_id: null }] }));
  assert.equal(copied.dishes[0]!.source_set_menu_id, "s9", "a copied row keeps what it was copied with");

  const fromBooking = applySourceDishes(fallback, [dish("X", 500, 2, "dish"), dish("Y", 60, 1, "drink")], { event_menu_id: "other-line" }, (i) => `k${i}`);
  assert.equal(fromBooking.materialize, true);
  assert.deepEqual(fromBooking.dishes.map((d) => [d.menu_id, d.quantity, d.section, d.source_event_menu_id, d.source_set_menu_id]),
    [["m-X", "2", "dish", "other-line", null], ["m-Y", "1", "drink", "other-line", null]]);
  const fromSet = applySourceDishes(fallback, [dish("X", 500)], { set_menu_id: "s2" }, (i) => `k${i}`);
  assert.deepEqual([fromSet.dishes[0]!.source_set_menu_id, fromSet.dishes[0]!.source_event_menu_id], ["s2", null]);
  // Materialising without touching a course is itself a change to save.
  assert.equal(draftsEqual([fallback], [{ ...fallback, materialize: true }]), false);
  assert.equal(toSavePayload([{ ...fallback, materialize: true }], [fallback]).length, 1);
  assert.equal(toSavePayload([{ ...fallback, materialize: true, dishes: [] }], [fallback])[0]!.items.length, 0, "start empty: an empty copy is sent, not a fall-back");
});

test("DRAFT: the figures follow the draft live — quantity text, an unparsable one counts as 0", () => {
  const d = draftFromLine(line());
  near(dishesTotalPerTable(draftDishes(d)), 2250, "250 × 5 + 1,000");
  d.dishes[0]!.quantity = "6";
  near(dishesTotalPerTable(draftDishes(d)), 2500, "live");
  d.dishes[0]!.quantity = "";
  near(dishesTotalPerTable(draftDishes(d)), 1000, "blank counts as 0 in the figure (and fails validation)");
  assert.match(validateDrafts([d])!, /จำนวนต่อโต๊ะ/);
});

test("A5: a NEW set may not take a name another set line of the booking already has; existing duplicates are left alone", () => {
  const existing = draftFromLine(line({ id: "L1", name: "t2000" }));
  const secondExisting = draftFromLine(line({ id: "L2", name: "t2000", pricePerTable: 1234 }));
  assert.equal(validateDrafts([existing, secondExisting]), null, "Nik's three t2000 rows are his to delete, not ours to refuse");
  assert.equal(duplicateSetName([existing, secondExisting]), null);
  const fresh = newCustomLineDraft("n", " T2000 ", 2000);
  assert.equal(duplicateSetName([existing, fresh]), "T2000", "trimmed and case-folded");
  assert.match(validateDrafts([existing, fresh])!, /มีชุดชื่อ “T2000” อยู่ในงานนี้แล้ว/);
  const twoNew = [newCustomLineDraft("a", "ชุดเจ", 1500), newCustomLineDraft("b", "ชุดเจ", 1800)];
  assert.match(validateDrafts(twoNew)!, /ชุดเจ/);
  assert.equal(validateDrafts([existing, newCustomLineDraft("n", "t2000 เจ", 2000)]), null, "a different name is fine");
  assert.match(validateSavePayload(toSavePayload(twoNew, []))!, /ชุดเจ/, "and the server refuses two new lines with one name");
});

test("DRAFT: validation names the first problem — no name, no tables, bad price, bad quantity, bad section, a dish twice", () => {
  assert.match(validateDrafts([newCustomLineDraft("n", "  ", 100)])!, /ต้องมีชื่อ/);
  assert.match(validateDrafts([{ ...newCustomLineDraft("n", "ชุด", 100), tables: 0 }])!, /โต๊ะ/);
  const badPrice = draftFromLine(line()); badPrice.price = "abc";
  assert.match(validateDrafts([badPrice])!, /ราคาต่อโต๊ะ/);
  const negPrice = draftFromLine(line()); negPrice.price = "-1";
  assert.match(validateDrafts([negPrice])!, /ราคาต่อโต๊ะ/);
  const zeroQty = draftFromLine(line()); zeroQty.dishes[0]!.quantity = "0";
  assert.match(validateDrafts([zeroQty])!, /จำนวนต่อโต๊ะ/);
  const badSection = draftFromLine(line()); badSection.dishes[0]!.section = "soup";
  assert.match(validateDrafts([badSection])!, /หมวด/);
  const twice = draftFromLine(line()); twice.dishes[1] = { ...twice.dishes[1]!, menu_id: "m-A" };
  assert.match(validateDrafts([twice])!, /ซ้ำ/);
  assert.equal(validateDrafts([draftFromLine(line()), newCustomLineDraft("n", "ชุด", 0)]), null, "a free set (price 0) is allowed");
});

test("SERVER: the payload check refuses what the screen could never send", () => {
  assert.match(validateSavePayload([])!, /ไม่มีรายการ/);
  assert.match(validateSavePayload("x")!, /ไม่มีรายการ/);
  assert.match(validateSavePayload([{ event_menu_id: null, set_name: "", tables: 1, price_per_table: 1, items: [] }])!, /ชื่อ/);
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: -5, items: [] }])!, /ราคาต่อโต๊ะ/);
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: 1, known_item_ids: [], known_price: null, items: [{ menu_id: "m", quantity: 0, section: "dish" }] }])!, /จำนวนต่อโต๊ะ/);
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: 1, known_item_ids: [], known_price: null, items: [{ menu_id: "m", quantity: 1, section: "soup" }] }])!, /หมวด/);
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: 1, known_item_ids: [], known_price: null, items: [{ menu_id: "m", quantity: 1, section: "dish" }, { menu_id: "m", quantity: 1, section: "drink" }] }])!, /ซ้ำ/);
  assert.match(validateSavePayload([{ event_menu_id: 5, price_per_table: 1, items: [] }])!, /รูปแบบ/);
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: 1, known_item_ids: "x", known_price: null, items: [] }])!, /รูปแบบ/, "the token must be an id list");
  assert.match(validateSavePayload([{ event_menu_id: "L1", price_per_table: 1, known_item_ids: [], known_price: "4500", items: [] }])!, /รูปแบบ/);
  assert.equal(validateSavePayload([{ event_menu_id: "L1", price_per_table: 0, known_item_ids: ["a"], known_price: 4500, items: [] }]), null, "an emptied copy at a free price is a valid save");
});

test("DELETING A SET: marking it is a draft edit, it leaves the save payload, and its id goes to the delete list", () => {
  // Nik, 2026-09-20: a set made with สร้างชุดเมนูเอง could not be removed
  // from the screen that made it. Deleting is now an edit like any other.
  const base = [draftFromLine(line({ id: "L1" })), draftFromLine(line({ id: "L2", name: "ชุดเล็ก", pricePerTable: 3000, dishes: [dish("C", 180)] }))];
  assert.deepEqual(removedLineIds(base), [], "nothing is marked when the page opens");

  const marked = structuredClone(base);
  marked[1]!.removed = true;
  assert.equal(draftsEqual(base, marked), false, "marking a set for deletion is a change to save");
  assert.deepEqual(removedLineIds(marked), [{ event_menu_id: "L2", known_item_ids: ["C"], known_price: 3000 }],
    "the deletion carries the same conflict token an edit carries");
  assert.deepEqual(toSavePayload(marked, base), [], "a line being deleted is not also saved");

  // ยกเลิก is a return to the baseline, so the mark goes with it.
  assert.deepEqual(removedLineIds(base), []);

  // An edit to one set and a deletion of another travel together.
  const both = structuredClone(marked);
  both[0]!.price = "4321";
  const payload = toSavePayload(both, base);
  assert.deepEqual(payload.map((p) => p.key), ["L1"]);
  assert.deepEqual(removedLineIds(both).map((r) => r.event_menu_id), ["L2"]);
});

test("DELETING A SET: a line that was never saved has no id to delete, and a broken line can still be removed", () => {
  const unsaved = newCustomLineDraft("new-1", "ชุดทดสอบ", 2000);
  assert.deepEqual(removedLineIds([{ ...unsaved, removed: true }]), [], "nothing on the server to delete");

  // A set whose price cannot be parsed blocks a save — unless it is the one
  // being deleted, in which case its contents no longer matter.
  const broken = draftFromLine(line({ id: "L9" }));
  broken.price = "abc";
  assert.match(validateDrafts([broken])!, /ราคาต่อโต๊ะ/);
  assert.equal(validateDrafts([{ ...broken, removed: true }]), null, "a set being deleted is not validated");
  assert.deepEqual(removedLineIds([{ ...broken, removed: true }]).map((r) => r.event_menu_id), ["L9"]);
});

test("DELETING A SET: the name stays taken until the deletion is saved, because the save creates before it deletes", () => {
  const existing = draftFromLine(line({ id: "L1", name: "t2000" }));
  const marked = { ...existing, removed: true };
  // The function's A5 check runs against the database, where the row still
  // is when the create is attempted. Reusing the name has to be two saves.
  assert.equal(duplicateSetName([marked, newCustomLineDraft("n", "t2000", 2000)]), "t2000");
  assert.match(validateDrafts([marked, newCustomLineDraft("n", "t2000", 2000)])!, /มีชุดชื่อ “t2000”/);
  assert.equal(validateDrafts([marked, newCustomLineDraft("n", "t2000 ใหม่", 2000)]), null);
});

test("COPYING INTO AN EMPTY BOOKING creates the whole set line: name, price, tables, courses, provenance", () => {
  // Nik, 2026-09-20: deleting every set line left the menu page with no card,
  // and the copy button lived on a card — so the screen that owns the menu
  // had no way back. A pick now creates the line itself.
  const source = {
    name: "ชุด 4,500",
    pricePerTable: 4500,
    dishes: [dish("ปลากะพง", 1200, 1, "dish"), dish("ขนม", 100, 2, "dessert")],
  };
  const line = newLineDraftFromSource("new-1", source, 10, { set_menu_id: "s1" }, (i) => `k${i}`);
  assert.equal(line.eventMenuId, null, "not on the server yet");
  assert.equal(line.name, "ชุด 4,500", "named after its source");
  assert.equal(draftPrice(line), 4500, "priced by its source");
  assert.equal(line.tables, 10, "the booking's own table count");
  assert.equal(line.materialize, true);
  assert.deepEqual(line.dishes.map((d) => [d.menu_id, d.quantity, d.section, d.source_set_menu_id]),
    [["m-ปลากะพง", "1", "dish", "s1"], ["m-ขนม", "2", "dessert", "s1"]], "courses and their sections, with provenance");

  // And it saves as a new line: the function writes the line, its food charge
  // and its courses together, which is what puts it in the price box.
  assert.equal(validateDrafts([line]), null);
  const payload = toSavePayload([line], []);
  assert.equal(payload.length, 1);
  assert.equal(payload[0]!.event_menu_id, null);
  assert.equal(payload[0]!.set_name, "ชุด 4,500");
  assert.equal(payload[0]!.tables, 10);
  assert.equal(payload[0]!.price_per_table, 4500);
  assert.equal(payload[0]!.items.length, 2);
  assert.equal(validateSavePayload(payload), null);

  // From a past booking instead: the other provenance column, same shape.
  const fromBooking = newLineDraftFromSource("new-2", source, 1, { event_menu_id: "L9" }, (i) => `k${i}`);
  assert.deepEqual(fromBooking.dishes.map((d) => [d.source_event_menu_id, d.source_set_menu_id]), [["L9", null], ["L9", null]]);
  assert.equal(fromBooking.tables, 1, "no table count on the booking: one table");
});

test("COPYING INTO AN EMPTY BOOKING refuses a name the booking already uses", () => {
  const existing = [draftFromLine(line({ id: "L1", name: "ชุด 4,500" }))];
  assert.equal(isSetNameTaken(existing, "ชุด 4,500"), true);
  assert.equal(isSetNameTaken(existing, " ชุด 4,500 "), true, "trimmed and case-folded, as the save compares");
  assert.equal(isSetNameTaken(existing, "ชุด 3,500"), false);
  assert.equal(isSetNameTaken([], "ชุด 4,500"), false, "an empty booking can take any name");
  assert.equal(isSetNameTaken(existing, "   "), false, "a blank name is a different problem");
  // The save would refuse it too, so the screen refusing first is the same rule earlier.
  const clash = newLineDraftFromSource("new-1", { name: "ชุด 4,500", pricePerTable: 4500, dishes: [] }, 1, { set_menu_id: "s1" }, (i) => `k${i}`);
  assert.match(validateDrafts([...existing, clash])!, /มีชุดชื่อ “ชุด 4,500”/);
});

test("SERVER: the delete list is distinct UUIDs, each carrying its conflict token", () => {
  const A = "11111111-2222-4333-8444-555555555555";
  const B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  const one = (event_menu_id: string) => ({ event_menu_id, known_item_ids: ["x"], known_price: 4500 });
  assert.equal(validateRemoveIds([]), null);
  assert.equal(validateRemoveIds([one(A), one(B)]), null);
  assert.equal(validateRemoveIds([{ event_menu_id: A, known_item_ids: [], known_price: null }]), null, "a line with no copy and no charge");
  assert.match(validateRemoveIds("a")!, /รูปแบบ/);
  assert.match(validateRemoveIds([one("L1")])!, /รูปแบบ/, "not a uuid: refused here, not by Postgres");
  assert.match(validateRemoveIds([one(A), one(A)])!, /รูปแบบ/, "the same line twice is a malformed call");
  assert.match(validateRemoveIds([{ event_menu_id: A, known_item_ids: "x", known_price: null }])!, /รูปแบบ/);
  assert.match(validateRemoveIds([{ event_menu_id: A, known_item_ids: [], known_price: "4500" }])!, /รูปแบบ/);
  assert.match(validateRemoveIds([null])!, /รูปแบบ/);
});

test("the fallback line's token is empty: it has no rows yet, and a copy made elsewhere since will show as rows", () => {
  const fallback = draftFromLine(line({ source: "shared" }));
  assert.deepEqual([fallback.knownItemIds, fallback.knownPrice], [[], 4500]);
});

test("the section list has one definition, in print order, with its labels", () => {
  assert.deepEqual(EVENT_MENU_SECTION_LIST.map((s) => s.value), ["dish", "dessert", "drink", "free"]);
  assert.equal(EVENT_MENU_SECTION_LIST[3]!.label, "รายการแถมฟรี");
});

test("A ROW'S SECTION IS A DRAFT EDIT: it makes the line dirty, ยกเลิก restores it, and the save carries it", () => {
  // Nik, 2026-09-20: each row carries a selector for the group it prints
  // under. It needs no change to the save function — the payload has always
  // carried section per item, and V10 in the migration proves an invalid one
  // is refused by the table's CHECK.
  const base = [draftFromLine(line({ dishes: [dish("A", 250, 5), dish("B", 1000)] }))];
  const moved = structuredClone(base);
  moved[0]!.dishes[1]!.section = "dessert";
  assert.equal(draftsEqual(base, moved), false, "changing a section is a change to save");
  assert.equal(draftsEqual(base, structuredClone(base)), true);

  const payload = toSavePayload(moved, base);
  assert.equal(payload.length, 1);
  assert.deepEqual(payload[0]!.items.map((i) => [i.menu_id, i.section]), [["m-A", "dish"], ["m-B", "dessert"]]);
  assert.equal(validateSavePayload(payload), null);
  assert.equal(validateDrafts(moved), null);

  // An invalid one never leaves the screen, and never leaves the server either.
  const bad = structuredClone(base);
  bad[0]!.dishes[0]!.section = "soup";
  assert.match(validateDrafts(bad)!, /หมวด/);
  assert.match(validateSavePayload(toSavePayload(bad, base))!, /หมวด/);

  // The order of the flat list is untouched by a section change: the screen
  // keeps insertion order, the documents group by section themselves.
  assert.deepEqual(payload[0]!.items.map((i) => i.sort_order), [10, 20]);
});

// ── The payload to the browser ───────────────────────────────────────────────

test("THE PAYLOAD: a sales session is never sent a cost, even when the builder is handed the cost map", () => {
  const l = line();
  const costs = { "m-A": { unit_cost: 40.25, has_unknown_cost: false }, "m-B": { unit_cost: 300.5, has_unknown_cost: true } };

  const sales = buildEventMenuView({ access: "view", locked: false, lines: [l], dishCostById: costs });
  assert.equal(sales.dishCostById, null, "the cost map is dropped for a viewer");
  assert.equal(sales.canEdit, false);
  const json = JSON.stringify(sales);
  assert.ok(!json.includes("40.25") && !json.includes("300.5") && !json.includes("unit_cost"), "no cost figure or field survives serialisation");
  assert.ok(json.includes("4500") && json.includes("250"), "while the customer prices, which sales may see, do");

  const admin = buildEventMenuView({ access: "edit", locked: false, lines: [l], dishCostById: costs });
  assert.deepEqual(admin.dishCostById, costs);
  assert.equal(admin.canEdit, true);

  const lockedAdmin = buildEventMenuView({ access: "edit", locked: true, lines: [l], dishCostById: costs });
  assert.equal(lockedAdmin.canEdit, false, "a locked booking's menu is frozen for everyone");
  assert.equal(lockedAdmin.locked, true);
  assert.deepEqual(lockedAdmin.dishCostById, costs, "frozen, not hidden: the owner still reads the cost");

  assert.equal(buildEventMenuView({ access: "none", locked: false, lines: [l], dishCostById: costs }).dishCostById, null);
});

test("the view's version changes when the booking's data does — not when a cost elsewhere does", () => {
  const a = buildEventMenuView({ access: "edit", locked: false, lines: [line()], dishCostById: null });
  const b = buildEventMenuView({ access: "edit", locked: false, lines: [line()], dishCostById: null });
  const c = buildEventMenuView({ access: "edit", locked: false, lines: [line({ pricePerTable: 4321 })], dishCostById: null });
  const d = buildEventMenuView({ access: "edit", locked: false, lines: [line()], dishCostById: { "m-A": { unit_cost: 99, has_unknown_cost: false } } });
  const e = buildEventMenuView({ access: "edit", locked: true, lines: [line()], dishCostById: null });
  assert.equal(viewVersion(a), viewVersion(b));
  assert.notEqual(viewVersion(a), viewVersion(c));
  assert.equal(viewVersion(a), viewVersion(d), "an ingredient price changing must not read as this booking changing");
  assert.notEqual(viewVersion(a), viewVersion(e), "the lock is part of what the person sees");
});

// ── The one price, on the parsed source ──────────────────────────────────────
//
// Item 4 (Nik): the price per table on the menu page IS the price box's
// number. That holds only while the booking screen's save takes a set line's
// unit_price from the database row it re-reads, never from its own state —
// otherwise a stale tab would write the old price back over the menu page's
// change. saveBooking is read here as source, so a comment cannot satisfy it.

function menuLineUnitPriceInitializers(source: string): string[] {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  let body: ts.Block | undefined;
  file.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === "saveBooking") body = n.body; });
  if (!body) return [];
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "unit_price" && ts.isObjectLiteralExpression(n.parent)) {
      const props = n.parent.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : ""));
      // The menu-line push carries charge_type "food" and event_menu_id from the row.
      const literal = n.parent.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && ts.isIdentifier(p.name) && p.name.text === "charge_type");
      if (props.includes("event_menu_id") && literal && ts.isStringLiteral(literal.initializer) && literal.initializer.text === "food") out.push(n.initializer.getText(file));
    }
    n.forEachChild(walk);
  };
  walk(body);
  return out;
}

test("CHECK: the checker sees a client-supplied unit price and a database one", () => {
  const client = `export async function saveBooking(i) { payload.push({ label: l.label, charge_type: "food", unit_price: l.unit_price, quantity: 1, event_menu_id: row.event_menu_id }); }`;
  const db = `export async function saveBooking(i) { payload.push({ label: row.label, charge_type: "food", unit_price: row.unit_price, quantity: 1, event_menu_id: row.event_menu_id }); }`;
  assert.deepEqual(menuLineUnitPriceInitializers(client), ["l.unit_price"]);
  assert.deepEqual(menuLineUnitPriceInitializers(db), ["row.unit_price"]);
});

test("THE ONE PRICE: saveBooking writes a set line's unit_price from the database row it re-read, never from the screen", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, "actions.ts"), "utf8");
  const inits = menuLineUnitPriceInitializers(source);
  assert.equal(inits.length, 1, "exactly one menu-line charge is pushed in saveBooking");
  assert.equal(inits[0], "row.unit_price");
});

test("A NEW SET's tables follow the price box's rule: whole, at least 1 — or the booking screen would refuse every later save", () => {
  // Found by the review of the booking-screen quantity fix (2026-09-21): a
  // booking whose จำนวนโต๊ะ was 2.5 got a 2.5-table set from this page, and
  // the booking screen then refused to save the booking at all.
  for (const tables of [2.5, 0.5, 0, -1, 100_001]) {
    assert.match(validateDrafts([{ ...newCustomLineDraft("n", "ชุด", 100), tables }])!, /^ชุด: จำนวน/, `draft ${tables}`);
    assert.match(validateSavePayload([{ event_menu_id: null, set_name: "ชุด", tables, price_per_table: 1, known_item_ids: [], known_price: null, items: [] }])!, /^จำนวน/, `payload ${tables}`);
  }
  assert.equal(validateDrafts([{ ...newCustomLineDraft("n", "ชุด", 100), tables: 10 }]), null);
  assert.equal(validateSavePayload([{ event_menu_id: null, set_name: "ชุด", tables: 10, price_per_table: 1, known_item_ids: [], known_price: null, items: [] }]), null);
});
