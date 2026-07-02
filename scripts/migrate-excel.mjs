// One-time migration: reads CostControl69.xlsx and writes supabase/seed.sql
// Run with: node scripts/migrate-excel.mjs
//
// Source sheets used:
//   ราคาวัตถุดิบ       -> ingredients (raw + prep-linked rows)
//   Prep              -> prep_recipes + prep_recipe_items
//   เมนูอาหาร          -> menus + menu_recipe_items
//   ต้นทุนต่อเมนู       -> menus.last_period_qty_sold (already-resolved POS snapshot)

import XLSX from "xlsx";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, "..", "..", "CostControl69.xlsx");
const OUT_SQL = path.resolve(__dirname, "..", "supabase", "seed.sql");
const OUT_REPORT = path.resolve(__dirname, "..", "supabase", "migration-report.txt");

const wb = XLSX.readFile(SOURCE, { cellFormula: false });

const sheetRows = (name) => {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet not found: ${name}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
};

const report = [];
const log = (line) => report.push(line);

const sqlStr = (v) => {
  if (v === null || v === undefined || v === "") return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const sqlNum = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "NULL";
  return Number(v);
};

// ---------------------------------------------------------------------------
// 1. ราคาวัตถุดิบ -> raw ingredient candidates (with forward-filled category)
// ---------------------------------------------------------------------------
const priceRows = sheetRows("ราคาวัตถุดิบ");
// columns: A หมวด, B Material Name, C Material Cost, D Unit, E จำนวนรับ,
//          F จำนวนตัดแต่ง, G หน่วย small unit, H yield%, I ต้นทุนจริง
const rawIngredients = new Map(); // name -> record
let currentCategory = null;

for (let r = 1; r < priceRows.length; r++) {
  const row = priceRows[r];
  if (!row) continue;
  const [catCell, name, cost, unit, receiveQty, yieldQty, usageUnit] = row;
  if (catCell && String(catCell).trim() !== "") currentCategory = String(catCell).trim();
  if (!name || String(name).trim() === "") continue;

  const cleanName = String(name).trim();
  if (rawIngredients.has(cleanName)) {
    log(`WARN duplicate ingredient name in ราคาวัตถุดิบ: "${cleanName}" (row ${r + 1}) — keeping first occurrence`);
    continue;
  }
  rawIngredients.set(cleanName, {
    name: cleanName,
    category: currentCategory,
    purchaseCost: cost,
    purchaseUnitLabel: unit,
    receiveQty: receiveQty ?? 1,
    yieldQty: yieldQty,
    usageUnit: usageUnit,
  });
}
log(`ราคาวัตถุดิบ: parsed ${rawIngredients.size} unique ingredient rows`);

// ---------------------------------------------------------------------------
// 2. Prep -> group rows by prep name (column B), components in column C
// ---------------------------------------------------------------------------
const prepRows = sheetRows("Prep");
// columns: A หมวด, B ชื่อเมนู(=prep name), C ส่วนประกอบ, D จำนวน, E หน่วย, F ต้นทุน/หน่วย, G รวม, H note
const prepRecipes = new Map(); // prepName -> { category, items: [...] }

for (let r = 1; r < prepRows.length; r++) {
  const row = prepRows[r];
  if (!row) continue;
  const [cat, prepName, component, qty, unit, , , note] = row;
  if (!prepName || !component) continue;
  const cleanPrep = String(prepName).trim();
  const cleanComponent = String(component).trim();
  if (!prepRecipes.has(cleanPrep)) {
    prepRecipes.set(cleanPrep, { category: cat ? String(cat).trim() : null, items: [] });
  }
  prepRecipes.get(cleanPrep).items.push({
    component: cleanComponent,
    quantity: qty,
    unit,
    note,
  });
}
log(`Prep: parsed ${prepRecipes.size} prep recipes (${prepRows.length - 1} raw lines)`);

// Cross-check: every prep recipe name should exist as an ingredient row
// (that's how the spreadsheet links Prep totals back into ราคาวัตถุดิบ).
const prepNamesMissingFromPriceList = [];
for (const prepName of prepRecipes.keys()) {
  if (!rawIngredients.has(prepName)) prepNamesMissingFromPriceList.push(prepName);
}
if (prepNamesMissingFromPriceList.length) {
  log(`WARN ${prepNamesMissingFromPriceList.length} prep recipes have NO matching row in ราคาวัตถุดิบ (no yield qty/unit known): ${prepNamesMissingFromPriceList.join(", ")}`);
}

// Cross-check: every prep component should exist as an ingredient row
const unknownComponents = new Set();
for (const [prepName, recipe] of prepRecipes) {
  for (const item of recipe.items) {
    if (!rawIngredients.has(item.component) && !prepRecipes.has(item.component)) {
      unknownComponents.add(`${item.component} (used in ${prepName})`);
    }
  }
}
if (unknownComponents.size) {
  log(`WARN ${unknownComponents.size} Prep components not found in ราคาวัตถุดิบ or as another prep: ${[...unknownComponents].join(" | ")}`);
}

// ---------------------------------------------------------------------------
// 3. เมนูอาหาร -> group rows by menu name (column B)
// ---------------------------------------------------------------------------
const menuRows = sheetRows("เมนูอาหาร");
// columns: A หมวด, B ชื่อเมนู, C ส่วนประกอบ, D จำนวน, E หน่วย, F ต้นทุน/หน่วย, G รวม, H ราคาขาย, I Cook(fuel cost บาท)
const menus = new Map(); // menuName -> { category, sellingPrice, fuelCost, items: [] }

for (let r = 1; r < menuRows.length; r++) {
  const row = menuRows[r];
  if (!row) continue;
  const [cat, menuName, component, qty, unit, , , sellingPrice, fuelCost] = row;
  if (!menuName || !component) continue;
  const cleanMenu = String(menuName).trim();
  const cleanComponent = String(component).trim();
  if (!menus.has(cleanMenu)) {
    menus.set(cleanMenu, {
      category: cat ? String(cat).trim() : null,
      sellingPrice: sellingPrice,
      fuelCost: fuelCost ?? 0,
      items: [],
    });
  }
  const menu = menus.get(cleanMenu);
  if (sellingPrice != null && menu.sellingPrice == null) menu.sellingPrice = sellingPrice;
  menu.items.push({ component: cleanComponent, quantity: qty, unit });
}
log(`เมนูอาหาร: parsed ${menus.size} menus (${menuRows.length - 1} raw lines)`);

const menusMissingPrice = [...menus.entries()].filter(([, m]) => m.sellingPrice == null).map(([n]) => n);
if (menusMissingPrice.length) log(`WARN ${menusMissingPrice.length} menus have no selling price: ${menusMissingPrice.join(", ")}`);

const unknownMenuComponents = new Set();
for (const [menuName, menu] of menus) {
  for (const item of menu.items) {
    if (!rawIngredients.has(item.component) && !prepRecipes.has(item.component)) {
      unknownMenuComponents.add(`${item.component} (used in ${menuName})`);
    }
  }
}
if (unknownMenuComponents.size) {
  log(`WARN ${unknownMenuComponents.size} menu components not found in ราคาวัตถุดิบ or as a prep: ${[...unknownMenuComponents].join(" | ")}`);
}

// ---------------------------------------------------------------------------
// 4. ต้นทุนต่อเมนู -> last known qty sold per menu (already-resolved snapshot)
// ---------------------------------------------------------------------------
const costRows = sheetRows("ต้นทุนต่อเมนู");
// header at row 9 (index 8); data starts row 10 (index 9). B=ชื่อเมนู, C=จำนวนขาย
const qtySoldByMenu = new Map();
for (let r = 9; r < costRows.length; r++) {
  const row = costRows[r];
  if (!row) continue;
  const [, menuName, qtySold] = row;
  if (!menuName) continue;
  const cleanMenu = String(menuName).trim();
  const n = Number(qtySold);
  if (!Number.isNaN(n)) qtySoldByMenu.set(cleanMenu, n);
}
log(`ต้นทุนต่อเมนู: parsed qty-sold snapshot for ${qtySoldByMenu.size} menus`);

const menusMissingSales = [...menus.keys()].filter((n) => !qtySoldByMenu.has(n));
if (menusMissingSales.length) log(`INFO ${menusMissingSales.length} menus have no sales snapshot (will default to 0): ${menusMissingSales.slice(0, 30).join(", ")}${menusMissingSales.length > 30 ? " ..." : ""}`);

// ---------------------------------------------------------------------------
// 5. Build SQL: ingredients first (raw, no prep cost yet), then prep recipes
//    + items, then promote prep recipes into ingredients, then menus + items.
// ---------------------------------------------------------------------------
const sql = [];
sql.push("begin;");
sql.push("");

const ingredientIdByName = new Map();
const prepRecipeIdByName = new Map();

sql.push("-- 1) raw ingredients (is_prep = false)");
for (const [name, ing] of rawIngredients) {
  if (prepRecipes.has(name)) continue; // these become is_prep rows below
  const id = randomUUID();
  ingredientIdByName.set(name, id);
  sql.push(
    `insert into public.ingredients (id, name, category, is_prep, purchase_unit_label, purchase_cost, receive_qty, yield_qty, usage_unit) values (` +
      `${sqlStr(id)}, ${sqlStr(ing.name)}, ${sqlStr(ing.category)}, false, ${sqlStr(ing.purchaseUnitLabel)}, ${sqlNum(ing.purchaseCost)}, ${sqlNum(ing.receiveQty) === "NULL" ? 1 : sqlNum(ing.receiveQty)}, ${sqlNum(ing.yieldQty)}, ${sqlStr(ing.usageUnit)});`
  );
}
sql.push("");

sql.push("-- 2) prep recipes (header)");
for (const [name, recipe] of prepRecipes) {
  const priceRow = rawIngredients.get(name);
  const batchYieldQty = priceRow?.yieldQty ?? 1;
  const batchYieldUnit = priceRow?.usageUnit ?? "กรัม";
  const id = randomUUID();
  prepRecipeIdByName.set(name, id);
  sql.push(
    `insert into public.prep_recipes (id, name, category, batch_yield_qty, batch_yield_unit) values (` +
      `${sqlStr(id)}, ${sqlStr(name)}, ${sqlStr(recipe.category)}, ${sqlNum(batchYieldQty)}, ${sqlStr(batchYieldUnit)});`
  );
}
sql.push("");

sql.push("-- 3) promote each prep recipe into the ingredients list (is_prep = true)");
for (const [name] of prepRecipes) {
  const id = randomUUID();
  ingredientIdByName.set(name, id);
  const priceRow = rawIngredients.get(name);
  sql.push(
    `insert into public.ingredients (id, name, category, is_prep, usage_unit, prep_recipe_id) values (` +
      `${sqlStr(id)}, ${sqlStr(name)}, ${sqlStr(priceRow?.category ?? "prep")}, true, ${sqlStr(priceRow?.usageUnit ?? "กรัม")}, ${sqlStr(prepRecipeIdByName.get(name))});`
  );
}
sql.push("");

sql.push("-- 4) prep recipe items (components of each prep recipe)");
let prepItemSkipCount = 0;
let prepItemZeroQtyCount = 0;
for (const [prepName, recipe] of prepRecipes) {
  const prepId = prepRecipeIdByName.get(prepName);
  recipe.items.forEach((item, idx) => {
    const componentId = ingredientIdByName.get(item.component);
    if (!componentId) {
      prepItemSkipCount++;
      return; // unknown component, already reported above
    }
    let qty = sqlNum(item.quantity);
    if (qty === "NULL") {
      qty = 0;
      prepItemZeroQtyCount++;
    }
    const id = randomUUID();
    sql.push(
      `insert into public.prep_recipe_items (id, prep_recipe_id, ingredient_id, quantity, unit, note, sort_order) values (` +
        `${sqlStr(id)}, ${sqlStr(prepId)}, ${sqlStr(componentId)}, ${qty}, ${sqlStr(item.unit)}, ${sqlStr(item.note)}, ${idx});`
    );
  });
}
if (prepItemSkipCount) log(`WARN skipped ${prepItemSkipCount} prep recipe item lines due to unknown component ingredient`);
if (prepItemZeroQtyCount) log(`WARN ${prepItemZeroQtyCount} prep recipe item lines had a blank quantity in the spreadsheet — set to 0`);
sql.push("");

sql.push("-- 5) menus (header)");
const menuIdByName = new Map();
for (const [name, menu] of menus) {
  const id = randomUUID();
  menuIdByName.set(name, id);
  sql.push(
    `insert into public.menus (id, name, category, selling_price, fuel_cost, last_period_qty_sold) values (` +
      `${sqlStr(id)}, ${sqlStr(name)}, ${sqlStr(menu.category)}, ${sqlNum(menu.sellingPrice) === "NULL" ? 0 : sqlNum(menu.sellingPrice)}, ${sqlNum(menu.fuelCost) === "NULL" ? 0 : sqlNum(menu.fuelCost)}, ${sqlNum(qtySoldByMenu.get(name)) === "NULL" ? 0 : sqlNum(qtySoldByMenu.get(name))});`
  );
}
sql.push("");

sql.push("-- 6) menu recipe items");
let menuItemSkipCount = 0;
const menuItemZeroQty = [];
for (const [menuName, menu] of menus) {
  const menuId = menuIdByName.get(menuName);
  menu.items.forEach((item, idx) => {
    const componentId = ingredientIdByName.get(item.component);
    if (!componentId) {
      menuItemSkipCount++;
      return;
    }
    let qty = sqlNum(item.quantity);
    if (qty === "NULL") {
      qty = 0;
      menuItemZeroQty.push(`${menuName} -> ${item.component}`);
    }
    const id = randomUUID();
    sql.push(
      `insert into public.menu_recipe_items (id, menu_id, ingredient_id, quantity, unit, sort_order) values (` +
        `${sqlStr(id)}, ${sqlStr(menuId)}, ${sqlStr(componentId)}, ${qty}, ${sqlStr(item.unit)}, ${idx});`
    );
  });
}
if (menuItemSkipCount) log(`WARN skipped ${menuItemSkipCount} menu recipe item lines due to unknown component ingredient`);
if (menuItemZeroQty.length) log(`WARN ${menuItemZeroQty.length} menu recipe item lines had a blank quantity in the spreadsheet — set to 0: ${menuItemZeroQty.join(" | ")}`);

sql.push("");
sql.push("commit;");

writeFileSync(OUT_SQL, sql.join("\n"), "utf8");
writeFileSync(OUT_REPORT, report.join("\n"), "utf8");

console.log(`Wrote ${OUT_SQL}`);
console.log(`Wrote ${OUT_REPORT}`);
console.log("");
console.log(report.join("\n"));
