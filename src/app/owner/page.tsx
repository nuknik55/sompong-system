import { getCostingContext, getCapexThreshold } from "@/lib/data";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { redirect } from "next/navigation";
import { computeMenuCost, classifyWithinCategory, unrankedReasonText, MIN_RANKABLE_GROUP, type MenuEngineeringClass } from "@/lib/costing";
import { MenuEngineeringChart } from "@/components/menu-engineering-chart";
import { MenuEngineeringSection } from "@/components/menu-engineering-section";
import { QFactorSetting } from "@/components/q-factor-setting";
import { CapexThresholdSetting } from "@/components/capex-threshold-setting";
import { PosSalesImport } from "@/components/pos-sales-import";
import { CategoryTabs } from "@/components/category-tabs";
import { getPosImportMeta } from "./sales-import-actions";
import { PageHeader, PageShell } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { thaiDate } from "@/lib/thai-date";

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

  const [{ menus, menuItems, unitCosts, qFactorPct }, posImportMeta, capexThreshold] = await Promise.all([
    getCostingContext(),
    getPosImportMeta(),
    getCapexThreshold(),
  ]);

  // Sorted category list for the tab bar.
  const allCategories = [
    ...new Set(menus.map((m) => m.category).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b, "th"));

  // Every dish is ranked WITHIN ITS OWN CATEGORY (queue item 5), always over
  // all menus, and the tab only filters what is shown. So a dish carries the
  // same verdict on ทั้งหมด, on its category tab and on /staff. A category
  // with fewer than MIN_RANKABLE_GROUP dishes with sales is not ranked at
  // all, and each of its dishes says why.
  const itemsByMenu = new Map<string, typeof menuItems>();
  for (const it of menuItems) {
    const list = itemsByMenu.get(it.menu_id);
    if (list) list.push(it);
    else itemsByMenu.set(it.menu_id, [it]);
  }
  const allRanked = classifyWithinCategory(
    menus.map((menu) => computeMenuCost(menu, itemsByMenu.get(menu.id) ?? [], unitCosts, qFactorPct)),
  );
  const ranked = allRanked
    .filter((r) => selectedCategory === "all" || r.menu.category === selectedCategory)
    .sort((a, b) => b.qtySold - a.qtySold);

  // Chart position is the dish's share of the sales SHOWN: all sales on
  // ทั้งหมด, its category's on a tab. The colour is its within-category class.
  const shownQty = ranked.reduce((s, r) => s + r.qtySold, 0);
  const smallGroup = selectedCategory === "all" ? null : ranked.find((r) => r.unrankedReason?.kind === "small_group")?.unrankedReason ?? null;

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
    <PageShell>
      <PageHeader
        title="ภาพรวมต้นทุนและ Menu Engineering"
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <QFactorSetting initial={qFactorPct} isOwner={profile.role === "owner"} />
            {/* The other owner-set number, on the only settings surface the app
                has (queue item 9). It governs บันทึกรายวัน, not this page. */}
            <CapexThresholdSetting initial={capexThreshold} isOwner={profile.role === "owner"} />
          </div>
        }
      />

      {/* Toolbar zone: POS import + category filter — subtle green tint to visually separate from content */}
      <div className="no-print rounded-xl bg-brand-green/5 px-4 py-3 space-y-3">
        <PosSalesImport />
        <div className="space-y-1.5">
          <CategoryTabs categories={allCategories} selected={selectedCategory} />
          {selectedCategory === "all" ? (
            <p className="text-xs text-neutral-500">
              Star/Horse/Puzzle/Dog เทียบกับเมนูในหมวดเดียวกันเท่านั้น — หมวดที่มีเมนูที่มียอดขายน้อยกว่า {MIN_RANKABLE_GROUP} รายการจะยังไม่จัดอันดับ
            </p>
          ) : (
            <p className="text-xs text-neutral-500">
              แสดงเฉพาะหมวด &quot;{selectedCategory}&quot; — Star/Horse/Puzzle/Dog คำนวณจากเมนูในหมวดนี้เท่านั้น
            </p>
          )}
          {smallGroup && (
            <p className="rounded-md border border-pending/60 bg-pending-soft px-3 py-2 text-xs text-pending-ink">
              ยังจัดอันดับหมวดนี้ไม่ได้: {unrankedReasonText(smallGroup)}
            </p>
          )}
        </div>
      </div>

      {/* Revenue / cost summary cards */}
      {posImportMeta && posImportMeta.dateFrom && (
        <p className="text-sm font-semibold text-neutral-800">
          📅 ข้อมูลยอดขาย:{" "}
          <span className="text-neutral-600 font-normal">
            {posImportMeta.dateTo && posImportMeta.dateTo !== posImportMeta.dateFrom
              ? `${thaiDate(posImportMeta.dateFrom)} – ${thaiDate(posImportMeta.dateTo)}`
              : thaiDate(posImportMeta.dateFrom)}
          </span>
        </p>
      )}
      {/* The page's four summary numbers, as the shared look's coloured tiles. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile accent="green" label="ยอดขายรวม (รอบล่าสุด)" value={`${formatBaht(totalRevenue)} บาท`} />
        <StatTile accent="navy" label="ต้นทุนรวม (รอบล่าสุด)" value={`${formatBaht(totalCost)} บาท`} />
        <StatTile
          accent="gold"
          label="% Food Cost เฉลี่ย"
          value={avgFoodCostPct != null ? `${avgFoodCostPct.toFixed(1)}%` : "-"}
        />
        <StatTile
          label={selectedCategory === "all" ? "จำนวนเมนูทั้งหมด" : `เมนูในหมวด "${selectedCategory}"`}
          value={`${ranked.length} เมนู`}
        />
      </div>

      {/* Scatter chart (always shows all visible points) */}
      <MenuEngineeringChart
        note={selectedCategory === "all" ? "สีของจุด = กลุ่มเมื่อเทียบกับเมนูในหมวดเดียวกัน · ตำแหน่ง = เทียบกับยอดขายทุกเมนู" : undefined}
        data={ranked.map((r) => ({
          name: r.menu.name,
          popularPct: shownQty > 0 ? (r.qtySold / shownQty) * 100 : 0,
          unrankedNote: r.unrankedReason ? unrankedReasonText(r.unrankedReason) : null,
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
          unrankedNote: r.unrankedReason ? unrankedReasonText(r.unrankedReason) : null,
          hasUnknownCost: r.hasUnknownCost,
          isPremium: r.menu.selling_price >= premiumThreshold,
        }))}
      />
    </PageShell>
  );
}
