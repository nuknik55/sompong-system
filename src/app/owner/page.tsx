import { getCostingContext } from "@/lib/data";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { redirect } from "next/navigation";
import { computeMenuCost, classifyMenuEngineering, type MenuEngineeringClass } from "@/lib/costing";
import { MenuEngineeringChart } from "@/components/menu-engineering-chart";
import { MenuEngineeringSection } from "@/components/menu-engineering-section";
import { QFactorSetting } from "@/components/q-factor-setting";
import { PosSalesImport } from "@/components/pos-sales-import";
import { CategoryTabs } from "@/components/category-tabs";

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Items at or above the 75th-percentile selling price across ALL menus get the
 *  "premium" badge — restaurant-wide threshold, never changes with category filter. */
function computePremiumThreshold(prices: number[]): number {
  if (prices.length === 0) return Infinity;
  const sorted = [...prices].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[idx] ?? sorted[sorted.length - 1];
}

export default async function OwnerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const profile = await requireProfile();
  if (!isAdminOrAbove(profile.role)) redirect("/staff");

  const { category: rawCategory } = await searchParams;
  const selectedCategory = rawCategory?.trim() || "all";

  const { menus, menuItems, unitCosts, qFactorPct } = await getCostingContext();

  // Sorted category list for the tab bar.
  const allCategories = [
    ...new Set(menus.map((m) => m.category).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b, "th"));

  // Filter to selected category (or all).
  const visibleMenus =
    selectedCategory === "all"
      ? menus
      : menus.filter((m) => m.category === selectedCategory);

  const visibleMenuIds = new Set(visibleMenus.map((m) => m.id));
  const visibleItems = menuItems.filter((it) => visibleMenuIds.has(it.menu_id));

  // Classify only the visible subset so thresholds reflect this category.
  const menuCosts = visibleMenus.map((menu) =>
    computeMenuCost(
      menu,
      visibleItems.filter((it) => it.menu_id === menu.id),
      unitCosts,
      qFactorPct,
    ),
  );
  const ranked = classifyMenuEngineering(menuCosts).sort((a, b) => b.qtySold - a.qtySold);

  const premiumThreshold = computePremiumThreshold(menus.map((m) => m.selling_price));

  const classCounts = ranked.reduce(
    (acc, r) => {
      acc[r.menuClass] = (acc[r.menuClass] ?? 0) + 1;
      return acc;
    },
    {} as Record<MenuEngineeringClass, number>,
  );

  const totalRevenue = ranked.reduce((s, r) => s + r.menu.selling_price * r.qtySold, 0);
  const totalCost = ranked.reduce((s, r) => s + r.totalCost * r.qtySold, 0);
  const avgFoodCostPct = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">ภาพรวมต้นทุนและ Menu Engineering</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          <QFactorSetting initial={qFactorPct} />
        </div>
      </div>

      {/* Toolbar zone: POS import + category filter — subtle green tint to visually separate from content */}
      <div className="no-print rounded-xl bg-brand-green/5 px-4 py-3 space-y-3">
        <PosSalesImport />
        <div className="space-y-1.5">
          <CategoryTabs categories={allCategories} selected={selectedCategory} />
          {selectedCategory !== "all" && (
            <p className="text-xs text-neutral-400">
              แสดงเฉพาะหมวด &quot;{selectedCategory}&quot; — Star/Horse/Puzzle/Dog คำนวณจากเมนูในหมวดนี้เท่านั้น
            </p>
          )}
        </div>
      </div>

      {/* Revenue / cost summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="ยอดขายรวม (รอบล่าสุด)" value={`${formatBaht(totalRevenue)} บาท`} />
        <SummaryCard label="ต้นทุนรวม (รอบล่าสุด)" value={`${formatBaht(totalCost)} บาท`} />
        <SummaryCard
          label="% Food Cost เฉลี่ย"
          value={avgFoodCostPct != null ? `${avgFoodCostPct.toFixed(1)}%` : "-"}
        />
        <SummaryCard
          label={selectedCategory === "all" ? "จำนวนเมนูทั้งหมด" : `เมนูในหมวด "${selectedCategory}"`}
          value={`${ranked.length} เมนู`}
        />
      </div>

      {/* Scatter chart (always shows all visible points) */}
      <MenuEngineeringChart
        data={ranked.map((r) => ({
          name: r.menu.name,
          popularPct: r.popularPct ?? 0,
          profitPerUnit: r.profitPerUnit,
          qtySold: r.qtySold,
          menuClass: r.menuClass,
        }))}
      />

      {/* Clickable class cards + filterable table */}
      <MenuEngineeringSection
        classCounts={classCounts}
        rows={ranked.map((r) => ({
          id: r.menu.id,
          name: r.menu.name,
          qtySold: r.qtySold,
          sellingPrice: r.menu.selling_price,
          totalCost: r.totalCost,
          foodCostPct: r.foodCostPct,
          profitPerUnit: r.profitPerUnit,
          menuClass: r.menuClass,
          hasUnknownCost: r.hasUnknownCost,
          isPremium: r.menu.selling_price >= premiumThreshold,
        }))}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-lg font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
