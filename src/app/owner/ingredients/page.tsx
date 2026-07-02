import { getCostingContext } from "@/lib/data";
import { requireAdminOrEditor } from "@/lib/auth";
import { IngredientManager } from "@/components/ingredient-manager";
import { CategoryFilterList } from "@/components/category-filter-list";
import { CreateRecipeForm } from "@/components/create-recipe-form";
import { createPrep } from "@/app/staff/prep/actions";
import { Tabs } from "@/components/tabs";
import { PosPriceImport } from "@/components/pos-price-import";

export default async function OwnerIngredientsPage() {
  const profile = await requireAdminOrEditor();
  const { ingredients, unitCosts, menus, menuItems, prepRecipes, prepItems } = await getCostingContext();
  const raw = ingredients.filter((i) => !i.is_prep);

  const menuById = new Map(menus.map((m) => [m.id, m.name]));
  const prepById = new Map(prepRecipes.map((p) => [p.id, p.name]));

  const prepCategories = [...new Set(prepRecipes.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "th")
  );

  const usageMap: Record<string, { menus: { id: string; name: string }[]; preps: { id: string; name: string }[] }> = {};
  function ensure(id: string) {
    if (!usageMap[id]) usageMap[id] = { menus: [], preps: [] };
    return usageMap[id];
  }
  for (const item of menuItems) {
    const name = menuById.get(item.menu_id);
    if (name) ensure(item.ingredient_id).menus.push({ id: item.menu_id, name });
  }
  for (const item of prepItems) {
    const name = prepById.get(item.prep_recipe_id);
    if (name) ensure(item.ingredient_id).preps.push({ id: item.prep_recipe_id, name });
  }

  const submitMode = profile.role === "admin" ? "save" : "pending";
  const isAdmin = profile.role === "admin";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">จัดการวัตถุดิบ</h1>
        <p className="text-sm text-neutral-500">
          แก้ราคาซื้อ, จำนวนรับ, จำนวนตัดแต่ง (yield) ของวัตถุดิบดิบ — ของเตรียม (Prep) คำนวณต้นทุนจากสูตรอัตโนมัติ
          {submitMode === "pending" && (
            <span className="ml-1 text-amber-600">· การเปลี่ยนแปลงต้องรอ Admin อนุมัติ</span>
          )}
        </p>
      </div>
      <Tabs
        tabs={[
          {
            label: `วัตถุดิบดิบ (${raw.length})`,
            content: (
              <IngredientManager
                ingredients={raw.map((i) => ({
                  id: i.id,
                  name: i.name,
                  category: i.category,
                  purchase_unit_label: i.purchase_unit_label ?? null,
                  purchase_cost: i.purchase_cost,
                  receive_qty: i.receive_qty ?? 1,
                  yield_qty: i.yield_qty,
                  usage_unit: i.usage_unit,
                }))}
                unitCosts={Object.fromEntries(unitCosts)}
                usageMap={usageMap}
                submitMode={submitMode}
              />
            ),
          },
          {
            label: `ของเตรียม (${prepRecipes.length})`,
            content: (
              <div className="space-y-3">
                <CreateRecipeForm kind="prep" createAction={createPrep} hrefPrefix="/staff/prep" categories={prepCategories} pendingMode={!isAdmin} />
                <CategoryFilterList
                  items={prepRecipes.map((p) => ({
                    id: p.id,
                    name: p.name,
                    category: p.category ?? null,
                    subtitle: `ผลผลิต ${p.batch_yield_qty} ${p.batch_yield_unit}`,
                  }))}
                  hrefPrefix="/staff/prep"
                  placeholder="พิมพ์ค้นหาชื่อของเตรียม..."
                />
              </div>
            ),
          },
          ...(isAdmin
            ? [{ label: "นำเข้าราคาจาก POS", content: <PosPriceImport /> }]
            : []),
        ]}
      />
    </div>
  );
}
