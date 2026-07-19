import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCostingContext } from "@/lib/data";
import { getCurrentProfile } from "@/lib/auth";
import { RecipeEditor } from "@/components/recipe-editor";
import { DuplicateButton } from "@/components/duplicate-button";
import { DeleteRecipeButton } from "@/components/delete-recipe-button";
import { duplicateMenu, deleteMenu, updateMenuSellingPrice, toggleMenuStaffVisible } from "@/app/staff/menu/actions";
import { RecipeHistory } from "@/components/recipe-history";

export default async function StaffMenuEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [profile, menuResult, costingCtx] = await Promise.all([
    getCurrentProfile(),
    (async () => {
      const supabase = await createClient();
      return supabase.from("menus").select("id, name, category, selling_price, staff_visible").eq("id", id).single();
    })(),
    getCostingContext(),
  ]);

  const { data: menu } = menuResult;
  if (!menu) notFound();

  const isOwner = profile?.role === "owner";
  const isAdmin = profile?.role === "admin" || profile?.role === "owner";
  const isEditor = profile?.role === "editor";
  const isStaff = profile?.role === "staff";

  // Block staff/editor from accessing hidden menus directly via URL
  if (!isAdmin && !(menu as unknown as { staff_visible: boolean }).staff_visible) {
    notFound();
  }

  const staffVisible = (menu as unknown as { staff_visible: boolean }).staff_visible;

  const { ingredients, menus, menuItems, unitCosts, qFactorPct } = costingCtx;
  const items = menuItems.filter((it) => it.menu_id === id);
  const unitCostsObj = Object.fromEntries(unitCosts);
  const categories = [...new Set(menus.map((m) => m.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "th")
  );

  const canEdit = isAdmin || isEditor;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-neutral-900">{menu.name}</h1>
            {!staffVisible && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                ซ่อนจาก staff
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <form action={toggleMenuStaffVisible.bind(null, menu.id, !staffVisible)}>
                <button
                  type="submit"
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    staffVisible
                      ? "border-neutral-300 text-neutral-600 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700"
                      : "border-brand-green bg-brand-green/10 text-brand-green hover:bg-brand-green/20"
                  }`}
                >
                  {staffVisible ? "ซ่อนจาก staff" : "เปิดให้ staff ดู"}
                </button>
              </form>
            )}
            {isAdmin && (
              <DeleteRecipeButton
                id={menu.id}
                label="ลบเมนูนี้"
                confirmMessage={`ลบเมนู "${menu.name}" แน่ใจหรือไม่? ลบแล้วกู้คืนไม่ได้`}
                deleteAction={deleteMenu}
                redirectTo="/staff"
              />
            )}
          </div>
        </div>
        {isStaff && (
          <p className="text-sm text-neutral-500">
            ราคาขาย {menu.selling_price.toLocaleString("th-TH")} บาท · หมวด {menu.category ?? "-"}
          </p>
        )}
        {!isStaff && <p className="text-sm text-neutral-400">หมวด {menu.category ?? "-"}{isAdmin ? " (แก้ราคาขายได้ในกล่องสรุปด้านล่าง)" : ""}</p>}
        {canEdit && (
          <div className="mt-2">
            <DuplicateButton
              id={menu.id}
              originalName={menu.name}
              originalCategory={menu.category}
              categories={categories}
              duplicateAction={duplicateMenu}
              hrefPrefix="/staff/menu"
            />
          </div>
        )}
      </div>
      <RecipeEditor
        target="menu"
        parentId={menu.id}
        parentName={menu.name}
        initialItems={items.map((it) => ({ id: it.id, ingredient_id: it.ingredient_id, quantity: it.quantity, unit: null }))}
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, category: i.category, usage_unit: i.usage_unit, is_prep: i.is_prep }))}
        unitCosts={isStaff ? {} : unitCostsObj}
        qFactorPct={qFactorPct}
        sellingPrice={menu.selling_price}
        canEditPrice={isAdmin}
        onSavePrice={isAdmin ? updateMenuSellingPrice : undefined}
        readOnly={isStaff}
        submitMode={isEditor ? "pending" : "save"}
        showCosts={!isStaff}
      />
      <RecipeHistory target="menu" parentId={menu.id} />
    </div>
  );
}
