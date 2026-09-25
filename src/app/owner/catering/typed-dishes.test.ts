/**
 * Run with: npm test — typed dishes and per-head lines (Nik, 2026-09-25).
 *
 * TYPED DISHES: a course that is not in the menu list, typed by name. It is a
 * menu dish OR a typed name, never both (the database checks it too); it has
 * no selling price and no cost until owner or admin links it to a real menu;
 * sales may add, edit and remove typed dishes and NOTHING else on a
 * booking's menu, and never sees a cost. PER HEAD: price per guest × guests,
 * labelled ท่าน, never โต๊ะ; the totals, the discount and the deposit are the
 * charge rows' sums, so a per-head line changes none of that arithmetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventMenuView, draftFromLine, lineFoodCost, newCustomLineDraft, newTypedDish, salesDraftError, toSavePayload,
  typedDishesPayload, validateDrafts, validateSavePayload, validateTypedPayload, type EventMenuLine,
} from "./event-menu.ts";
import { dishKey, isTypedDish, recipeMenuId, typedDishNameError } from "./menu-lines.ts";
import { canEditTypedDishes, eventMenuAccess } from "../../../lib/event-menu-access.ts";
import { lineUnit, PER_HEAD_UNIT, setCountUnit } from "../../../lib/kitchen-sheet.ts";
import { addDish, designFigures, swapDish, typedDesignDish } from "../../../lib/set-design.ts";
import { docMoney } from "../../../lib/quote-doc.ts";
import { linesFromCharges, priceBoxProblem } from "./booking-lines.ts";
import type { CateringCharge } from "./actions.ts";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const line = (over: Partial<EventMenuLine> = {}): EventMenuLine => ({
  id: UUID(1), name: "ชุด 380", tables: 1, perHead: false, pricePerTable: 11400, sourceSetMenuId: UUID(2), source: "copy",
  dishes: [
    { id: UUID(10), menu_id: UUID(20), menu_name: "ปลากะพง", selling_price: 450, quantity: 1, section: "dish", sort_order: 10, note: null },
    { id: UUID(11), menu_id: null, dish_name: "ห่อหมก", linked_menu_id: null, menu_name: "ห่อหมก", selling_price: 0, quantity: 1, section: "dish", sort_order: 20, note: null },
  ],
  ...over,
});

test("a typed dish: exactly one of a menu and a name; 1-120 characters; one key per name, case-folded", () => {
  assert.equal(isTypedDish({ menu_id: null }), true);
  assert.equal(isTypedDish({ menu_id: UUID(1) }), false);
  assert.equal(typedDishNameError("  "), "พิมพ์ชื่อเมนู");
  assert.match(typedDishNameError("ก".repeat(121))!, /120/);
  assert.equal(typedDishNameError("ก".repeat(120)), null);
  assert.equal(dishKey({ menu_id: null, dish_name: " Tom Yum " }), dishKey({ menu_id: null, dish_name: "tom yum" }));
  assert.notEqual(dishKey({ menu_id: UUID(3) }), dishKey({ menu_id: null, dish_name: UUID(3) }));
  assert.equal(recipeMenuId({ menu_id: null, linked_menu_id: UUID(4) }), UUID(4), "a linked typed dish costs as its menu");
  assert.equal(recipeMenuId({ menu_id: null, linked_menu_id: null }), null);
});

test("the menu page's cost: an unlinked typed dish makes it unknown and is counted; a linked one costs as its menu", () => {
  const costs = { [UUID(20)]: { unit_cost: 100, has_unknown_cost: false } };
  const c = lineFoodCost(line().dishes, costs);
  assert.equal(c.costPerTable, 100);
  assert.equal(c.hasUnknownCost, true);
  assert.equal(c.typedWithoutCost, 1);
  const linked = line({ dishes: [{ ...line().dishes[1]!, linked_menu_id: UUID(20) }] });
  assert.deepEqual(lineFoodCost(linked.dishes, costs), { costPerTable: 100, hasUnknownCost: false, typedWithoutCost: 0 });
});

test("the owner's save sends a typed dish as a name (and its link), a menu dish as a menu; the server check agrees", () => {
  const base = [draftFromLine(line())];
  const edited = [{ ...base[0]!, dishes: [...base[0]!.dishes, newTypedDish("k", "ลอดช่อง", "dessert")] }];
  assert.equal(validateDrafts(edited), null);
  const payload = toSavePayload(edited, base);
  assert.equal(payload.length, 1);
  assert.deepEqual(payload[0]!.items.map((i) => [i.menu_id, i.dish_name, i.linked_menu_id]), [[UUID(20), null, null], [null, "ห่อหมก", null], [null, "ลอดช่อง", null]]);
  assert.equal(validateSavePayload(payload), null);
  // What the screen could never send: both, neither, a link on a menu dish, a name twice.
  const item = { quantity: 1, section: "dish", sort_order: 10, note: null, source_set_menu_id: null, source_event_menu_id: null };
  const one = (it: Record<string, unknown>) => [{ ...payload[0]!, items: [{ ...item, ...it }] }];
  assert.ok(validateSavePayload(one({ menu_id: UUID(20), dish_name: "x", linked_menu_id: null })));
  assert.ok(validateSavePayload(one({ menu_id: null, dish_name: null, linked_menu_id: null })));
  assert.match(validateSavePayload(one({ menu_id: UUID(20), dish_name: null, linked_menu_id: UUID(21) }))!, /เฉพาะเมนูที่พิมพ์เอง|รูปแบบ/);
  assert.match(validateSavePayload([{ ...payload[0]!, items: [{ ...item, menu_id: null, dish_name: "ก", linked_menu_id: null }, { ...item, menu_id: null, dish_name: " ก ", linked_menu_id: null }] }])!, /ซ้ำ/);
  assert.match(validateDrafts([{ ...base[0]!, dishes: [...base[0]!.dishes, newTypedDish("k2", "ห่อหมก")] }])!, /ซ้ำ/);
});

test("SALES may change typed dishes only: a menu dish, the price, the count or a new line is refused", () => {
  const base = draftFromLine(line());
  const addTyped = { ...base, dishes: [...base.dishes, newTypedDish("k", "น้ำพริกลงเรือ")] };
  assert.equal(salesDraftError(addTyped, base), null);
  const renamed = { ...base, dishes: base.dishes.map((d) => (d.menu_id == null ? { ...d, dish_name: "ห่อหมกปลา", menu_name: "ห่อหมกปลา" } : d)) };
  assert.equal(salesDraftError(renamed, base), null);
  assert.equal(salesDraftError({ ...base, dishes: base.dishes.filter((d) => d.menu_id == null) }, base), "แก้ได้เฉพาะเมนูที่พิมพ์เอง", "removing a menu dish");
  assert.equal(salesDraftError({ ...base, dishes: base.dishes.map((d) => (d.menu_id ? { ...d, quantity: "2" } : d)) }, base), "แก้ได้เฉพาะเมนูที่พิมพ์เอง", "a menu dish's quantity");
  assert.equal(salesDraftError({ ...base, price: "1" }, base), "แก้ได้เฉพาะเมนูที่พิมพ์เอง", "the price");
  assert.equal(salesDraftError({ ...base, tables: 2 }, base), "แก้ได้เฉพาะเมนูที่พิมพ์เอง", "the count");
  assert.equal(salesDraftError(newCustomLineDraft("n", "ใหม่", 100), base), "แก้ได้เฉพาะเมนูที่พิมพ์เอง", "a new line");
  // The payload: typed dishes only; a copied one carries its id (its link stays server-side).
  const payload = typedDishesPayload(addTyped);
  assert.deepEqual(payload.map((p) => [p.id, p.dish_name]), [[UUID(11), "ห่อหมก"], [null, "น้ำพริกลงเรือ"]]);
  assert.equal(validateTypedPayload(payload), null);
  // A line still reading the shared set sends no ids: the database copies first, then matches by name.
  const shared = draftFromLine(line({ source: "shared" }));
  assert.deepEqual(typedDishesPayload(shared).map((p) => p.id), [null]);
  // The server's own check refuses what sales could never send.
  assert.equal(validateTypedPayload([{ ...payload[0]!, menu_id: UUID(20) }]), "แก้ได้เฉพาะเมนูที่พิมพ์เอง");
  assert.equal(validateTypedPayload([{ ...payload[0]!, linked_menu_id: UUID(20) }]), "แก้ได้เฉพาะเมนูที่พิมพ์เอง");
  assert.match(validateTypedPayload([payload[1]!, { ...payload[1]!, dish_name: " น้ำพริกลงเรือ " }])!, /สองครั้ง/);
});

test("who: typed dishes for owner, admin and sales; sales still gets no cost map and no other edit", () => {
  assert.deepEqual(["owner", "admin", "sales", "editor", "staff", "hr", null].map((r) => canEditTypedDishes(eventMenuAccess(r))),
    [true, true, true, false, false, false, false]);
  const costs = { [UUID(20)]: { unit_cost: 100, has_unknown_cost: false } };
  const sales = buildEventMenuView({ access: "view", locked: false, lines: [line()], dishCostById: costs });
  assert.equal(sales.canEdit, false);
  assert.equal(sales.canEditTyped, true);
  assert.equal(sales.dishCostById, null);
  assert.doesNotMatch(JSON.stringify(sales), /unit_cost|has_unknown_cost/);
  assert.equal(buildEventMenuView({ access: "view", locked: true, lines: [], dishCostById: null }).canEditTyped, false, "locked");
  assert.equal(buildEventMenuView({ access: "view", locked: false, cancelled: true, lines: [], dishCostById: null }).canEditTyped, false, "cancelled");
  assert.equal(buildEventMenuView({ access: "none", locked: false, lines: [], dishCostById: null }).canEditTyped, false);
});

test("PER HEAD: labelled ท่าน, never โต๊ะ; per-table lines keep the booking's word", () => {
  assert.equal(PER_HEAD_UNIT, "ท่าน");
  assert.equal(lineUnit(true, "chinese_table"), "ท่าน");
  assert.equal(lineUnit(true, "buffet"), "ท่าน");
  assert.equal(lineUnit(false, "chinese_table"), setCountUnit("chinese_table"));
  assert.equal(lineUnit(false, "box_set"), "กล่อง");
  // A per-head custom set starts at the booking's guests, a per-table one at 1 table.
  assert.equal(newCustomLineDraft("n", "บุฟเฟต์", 380, true, 30).tables, 30);
  assert.equal(newCustomLineDraft("n", "ชุด", 3000).tables, 1);
  const bad = { ...newCustomLineDraft("n", "บุฟเฟต์", 380, true, 30), tables: 0 };
  assert.match(validateDrafts([bad])!, /ท่าน/);
  assert.doesNotMatch(validateDrafts([bad])!, /โต๊ะ/);
  const payload = toSavePayload([newCustomLineDraft("n", "บุฟเฟต์", 380, true, 30)], []);
  assert.equal(payload[0]!.per_head, true);
  assert.equal(payload[0]!.tables, 30);
  // The price box names a per-head line's count in its own word.
  const setLineRow = { key: "s", kind: "set", section: "menu", refId: UUID(5), eventMenuId: null, label: "บุฟเฟต์ 380", unitPrice: "380", quantity: "0.5", amount: "190", chargeType: "food", note: null, free: false } as unknown as Parameters<typeof priceBoxProblem>[0][number];
  assert.match(priceBoxProblem([setLineRow], () => PER_HEAD_UNIT)!, /ท่าน/);
});

test("PER HEAD money: the price box and the documents add the stored charges, so 380 × 30 behaves as any line", () => {
  // The charges as the database stores them for a per-head line (price per
  // guest × guests, catering_save_booking_prices), a transport line and a
  // discount; read back through the price box's own loader and the
  // documents' own money function, the code that runs.
  const charge = (over: Partial<CateringCharge>): CateringCharge => ({
    id: "c", label: "x", charge_type: "food", unit_price: 0, quantity: 1, amount: 0, note: null, event_menu_id: null, rate_id: null,
    rate_type: null, rate_display_label: null, ...over,
  } as CateringCharge);
  const charges = [
    charge({ id: "h", label: "บุฟเฟต์ 380", unit_price: 380, quantity: 30, amount: 11400, event_menu_id: UUID(1) }),
    charge({ id: "t", label: "ค่าขนส่ง", charge_type: "transport", unit_price: 3500, amount: 3500 }),
    charge({ id: "d", label: "ส่วนลด", charge_type: "discount", unit_price: -400, amount: -400 }),
  ];
  const lines = linesFromCharges(charges);
  const total = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  assert.equal(lines[0]!.unitPrice, "380");
  assert.equal(lines[0]!.quantity, "30");
  assert.equal(total, 14500, "the price box's total: the same sum as with the line per table");
  const m = docMoney(charges.reduce((sum, c) => sum + c.amount, 0), 30, null);
  assert.equal(m.total, total, "the documents' total and the price box's agree");
  assert.equal(m.depositDue, 4350, "30% deposit");
  assert.equal(docMoney(m.total, 30, 4350).balance, 10150);
  assert.equal(380 * 30, 11400, "the 18 Oct booking's 11,400, per head, would be the same total");
});

test("a typed name refuses what prints as nothing: no-break space, tab, line break, zero-width", () => {
  for (const cp of [160, 9, 10, 8203, 65279]) {
    assert.match(typedDishNameError("กุ้ง" + String.fromCodePoint(cp) + "เผา")!, /พิมพ์ไม่ออก/, "code point " + cp);
  }
  assert.equal(typedDishNameError("กุ้ง เผา"), null, "an ordinary space inside is a name");
});

test("the design workspace: a typed dish adds once, has no price, and its cost comes only from a link", () => {
  const facts = new Map([[UUID(20), { name: "ปลา", selling_price: 450, unit_cost: 100, has_unknown_cost: false }]]);
  let items = addDish([], { menu_id: UUID(20), quantity: 1, section: "dish", note: null });
  items = addDish(items, typedDesignDish("ห่อหมก"));
  items = addDish(items, typedDesignDish(" ห่อหมก "));
  assert.equal(items.length, 2, "the same typed name twice gains portions, not a row");
  assert.equal(items[1]!.quantity, 2);
  const f = designFigures(items, 1000, facts);
  assert.equal(f.costPerTable, 100);
  assert.equal(f.dishesTotal, 450, "a typed dish has no selling price");
  assert.equal(f.typedWithoutCost, 1);
  assert.equal(f.hasUnknownCost, true);
  const linked = designFigures([{ ...items[1]!, linked_menu_id: UUID(20) }], 1000, facts);
  assert.equal(linked.costPerTable, 200);
  assert.equal(linked.dishesTotal, 0, "a link is for cost only, never a price");
  // Swapping a typed dish for a menu dish makes it that menu dish.
  const swapped = swapDish(items, 1, UUID(21));
  assert.equal(swapped.find((x) => x.menu_id === UUID(21))?.dish_name, undefined);
});
