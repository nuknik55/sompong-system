import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCostingContext } from "@/lib/data";
import { getCurrentProfile } from "@/lib/auth";
import { editAccess } from "@/lib/edit-access";
import { RecipeEditor } from "@/components/recipe-editor";
import { DuplicateButton } from "@/components/duplicate-button";
import { DeleteRecipeButton } from "@/components/delete-recipe-button";
import { duplicateMenu, deleteMenu, updateMenuSellingPrice, toggleMenuStaffVisible } from "@/app/staff/menu/actions";
import { PageHeader, PageShell } from "@/components/ui/page";
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

  const access = editAccess(profile?.role);
  const isAdmin = access === "direct";
  const isEditor = access === "request";
  // Every role that cannot edit gets the read-only view with no costs: staff,
  // and hr or sales who reach this page by URL (item 34). An allowlist, so
  // a role added later is not handed the editor.
  const canEdit = access !== "view";

  // A hidden menu opens for owner and admin alone — the same allowlist the
  // list page uses. Everyone else gets notFound, editor, staff, hr and sales
  // alike, whether they followed a link or typed the URL.
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

  return (
    <PageShell>
      <PageHeader
        title={menu.name}
        subtitle={
          <>
            {!staffVisible && (
              <span className="rounded-full bg-pending-soft px-2 py-0.5 text-xs font-medium text-pending-ink">
                ซ่อนจาก staff
              </span>
            )}
            {!canEdit && (
              <span>ราคาขาย {menu.selling_price.toLocaleString("th-TH")} บาท · หมวด {menu.category ?? "-"}</span>
            )}
            {canEdit && <span>หมวด {menu.category ?? "-"}{isAdmin ? " (แก้ราคาขายได้ในกล่องสรุปด้านล่าง)" : ""}</span>}
          </>
        }
        actions={
          <>
            {isAdmin && (
              <form action={toggleMenuStaffVisible.bind(null, menu.id, !staffVisible)}>
                <button
                  type="submit"
                  className={`h-8 rounded-lg border px-3 font-heading text-sm font-medium shadow-btn-soft transition-colors ${
                    staffVisible
                      ? "border-neutral-300 text-neutral-600 hover:border-pending/60 hover:bg-pending-soft hover:text-pending-ink"
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
            {canEdit && (
              <DuplicateButton
                id={menu.id}
                originalName={menu.name}
                originalCategory={menu.category}
                categories={categories}
                duplicateAction={duplicateMenu}
                hrefPrefix="/staff/menu"
              />
            )}
          </>
        }
      />
      <RecipeEditor
        target="menu"
        parentId={menu.id}
        parentName={menu.name}
        initialItems={items.map((it) => ({ id: it.id, ingredient_id: it.ingredient_id, quantity: it.quantity, unit: null }))}
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, category: i.category, usage_unit: i.usage_unit, is_prep: i.is_prep }))}
        unitCosts={canEdit ? unitCostsObj : {}}
        qFactorPct={qFactorPct}
        sellingPrice={menu.selling_price}
        canEditPrice={isAdmin}
        onSavePrice={isAdmin ? updateMenuSellingPrice : undefined}
        readOnly={!canEdit}
        submitMode={isEditor ? "pending" : "save"}
        showCosts={canEdit}
      />
      <RecipeHistory target="menu" parentId={menu.id} />
    </PageShell>
  );
}
