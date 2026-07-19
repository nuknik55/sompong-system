import { getCostingContext } from "@/lib/data";
import { computeMenuCost, classifyMenuEngineering } from "@/lib/costing";
import { getCurrentProfile } from "@/lib/auth";
import { CategoryFilterList } from "@/components/category-filter-list";
import { CreateRecipeForm } from "@/components/create-recipe-form";
import { createMenu } from "@/app/staff/menu/actions";

export default async function StaffHomePage() {
  const [{ menus, menuItems, unitCosts, qFactorPct }, profile] = await Promise.all([
    getCostingContext(),
    getCurrentProfile(),
  ]);

  const isStaffOnly = profile?.role === "staff" || profile?.role === "editor";
  const visibleMenus = isStaffOnly ? menus.filter((m) => m.staff_visible) : menus;

  const menuCosts = visibleMenus.map((menu) =>
    computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct),
  );
  const ranked = classifyMenuEngineering(menuCosts);
  const meClassById = new Map(ranked.map((r) => [r.menu.id, r.menuClass]));

  const categories = [...new Set(visibleMenus.map((m) => m.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );

  const canCreate = profile?.role === "admin" || profile?.role === "editor";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-kanit text-xl font-semibold text-neutral-900">สูตรอาหาร</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {profile?.role === "staff"
              ? "ดูสูตรวัตถุดิบแต่ละเมนู — ไม่สามารถแก้ไขได้"
              : "เลือกวัตถุดิบจากรายการ ห้ามพิมพ์ชื่อเอง ระบบจะคำนวณต้นทุนให้อัตโนมัติ"}
          </p>
        </div>
        {canCreate && (
          <CreateRecipeForm
            kind="menu"
            createAction={createMenu}
            hrefPrefix="/staff/menu"
            categories={categories}
            pendingMode={profile?.role === "editor"}
          />
        )}
      </div>
      <CategoryFilterList
        items={visibleMenus.map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          meClass: meClassById.get(m.id),
        }))}
        hrefPrefix="/staff/menu"
        placeholder="พิมพ์ค้นหาชื่อเมนู..."
      />
    </div>
  );
}
