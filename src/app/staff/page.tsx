import { getCostingContext } from "@/lib/data";
import { computeMenuCost, classifyWithinCategory } from "@/lib/costing";
import { getCurrentProfile } from "@/lib/auth";
import { editAccess } from "@/lib/edit-access";
import { CategoryFilterList } from "@/components/category-filter-list";
import { CreateRecipeForm } from "@/components/create-recipe-form";
import { createMenu } from "@/app/staff/menu/actions";

export default async function StaffHomePage() {
  const [{ menus, menuItems, unitCosts, qFactorPct }, profile] = await Promise.all([
    getCostingContext(),
    getCurrentProfile(),
  ]);

  // Who may see a menu hidden from staff: owner and admin, the two roles that
  // manage the list. Named as an ALLOWLIST (item 34, the last bullet): the old
  // rule filtered for staff and editor by name, so hr and sales — and any role
  // added later — were shown every hidden menu name here. The menu PAGE has
  // refused them all along (staff/menu/[id] notFounds a hidden menu for
  // anyone outside editAccess "direct"), so this closes the list that leaked
  // the names while the page behind it was shut.
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const visibleMenus = isAdmin ? menus : menus.filter((m) => m.staff_visible);

  // Ranked over ALL menus, within category (the same helper as /owner), and
  // only then narrowed to what this person may see. Ranking the visible
  // subset would give a staff member different verdicts from the owner's.
  // The class is used only by the list's "sort by class" option here, and
  // only for the roles that see a dish's margin (owner, admin, editor:
  // editAccess, as on the recipe page): a Star-to-Dog order is that margin,
  // ranked, so staff, hr and sales get no such option (Nik, 2026-09-17).
  const seesMargin = editAccess(profile?.role) !== "view";
  const ranked = seesMargin
    ? classifyWithinCategory(
        menus.map((menu) => computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct)),
      )
    : [];
  const meClassById = new Map(ranked.map((r) => [r.menu.id, r.menuClass]));

  const categories = [...new Set(visibleMenus.map((m) => m.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );

  const canCreate = profile?.role === "admin" || profile?.role === "owner" || profile?.role === "editor";

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
          hiddenFromStaff: isAdmin && !m.staff_visible ? true : undefined,
        }))}
        hrefPrefix="/staff/menu"
        placeholder="พิมพ์ค้นหาชื่อเมนู..."
      />
    </div>
  );
}
