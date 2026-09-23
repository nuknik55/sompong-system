export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getFoodCostMonth } from "../actions";
import { previousMonth, nextMonth } from "../checklist";
import { bangkokYearMonth } from "@/lib/bangkok-date";
import { completenessNotices } from "../summary/completeness";
import { ToolRow } from "../tool-row";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";
import { PageHeader, PageShell } from "@/components/ui/page";

/**
 * ต้นทุนอาหาร — the head chef's month, and since 2026-09-18 what an admin has
 * instead of the P&L (queue item 37): sales, the food bought against them,
 * that as a percentage, and how it sits against the target on the chart of
 * accounts. Owner and admin; getFoodCostMonth carries the same guard.
 *
 * EVERY FIGURE HERE COMES FROM getFoodCostMonth, which returns G100 and
 * nothing else, and this page is a server component with no client child, so
 * what it renders is the whole of what reaches the browser. Do not hand the
 * view to a client component, and do not call getMonthlySummary here: that
 * one is the owner's, and its payload carries every group and the profit.
 */

/** Whole baht for the headline figures; the table uses two decimals so its column adds up. */
function baht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function baht2(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function thaiMonth(yearMonth: string) {
  const M = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const [y, m] = yearMonth.split("-").map(Number);
  return `${M[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

export default async function FoodCostPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const profile = await requireAdmin();
  const { month: rawMonth } = await searchParams;
  const today = bangkokYearMonth();
  // 01-12, not \d\d: "2026-99" would otherwise reach monthEnd and 500 the page.
  const yearMonth = rawMonth?.match(/^\d{4}-(0[1-9]|1[0-2])$/) ? rawMonth : today;

  const view = await getFoodCostMonth(yearMonth);
  // No profit figure on this page, so the notice does not name one.
  const notices = completenessNotices(view, { hasProfitFigures: false });

  // String math, not Date: new Date(y, m-2, 1).toISOString() reads the local
  // clock, so on a Bangkok machine August's "previous" came out as June and
  // its "next" as August itself. These two are pure (checklist.ts).
  const prev = previousMonth(yearMonth);
  const next = nextMonth(yearMonth);

  // Over target is red, under it green — the one verdict this page makes, and
  // only when the month can carry one. An incomplete month has partial costs
  // against a full month of sales, and a month with no purchases booked at
  // all is not a cheap month, it is an empty one: both would otherwise read
  // as "well under target".
  const judged = !view.expenseDataIncomplete && !view.monthInProgress && view.cogs > 0;
  const over = view.gapPoints != null && view.gapPoints > 0;
  const pctColor = !judged || view.gapPoints == null ? "text-neutral-900" : over ? "text-danger" : "text-brand-green";
  const verdictBox = !judged
    ? "border-neutral-200 bg-neutral-50 text-neutral-700"
    : over
      ? "border-danger/40 bg-danger-soft text-danger"
      : "border-success/30 bg-success-soft text-success-ink";

  return (
    <PageShell>
      <PageHeader back={{ href: `/owner/accounting?month=${yearMonth}`, label: "ดูทั้งเดือน", reload: true }} title="ต้นทุนอาหาร" />
      <ToolRow role={profile.role} yearMonth={yearMonth} current="food-cost" />

      <div className="flex items-center gap-3">
        <a href={`/owner/accounting/food-cost?month=${prev}`} className={buttonClass("secondary", { size: "sm" })}>‹</a>
        <span className="font-medium text-neutral-800">{thaiMonth(yearMonth)}</span>
        {yearMonth < today && (
          <a href={`/owner/accounting/food-cost?month=${next}`} className={buttonClass("secondary", { size: "sm" })}>›</a>
        )}
      </div>

      {notices.map((n) => (
        <p key={n} className="rounded-lg border border-pending/60 bg-pending-soft px-4 py-3 text-sm text-pending-ink">{n}</p>
      ))}

      {view.revenue === 0 ? (
        <p className="rounded-lg border border-pending/60 bg-pending-soft px-4 py-3 text-sm text-pending-ink">
          เดือนนี้ยังไม่มียอดขายในระบบ — นำเข้ารายได้ POS ก่อน จึงจะคิด % ต้นทุนอาหารได้
          {view.cogs !== 0 && <> (ตอนนี้บันทึกค่าวัตถุดิบไว้แล้ว {baht(view.cogs)} บาท)</>}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="ยอดขาย" value={`${baht(view.revenue)} ฿`} />
            <Figure label="ต้นทุนวัตถุดิบ" value={`${baht(view.cogs)} ฿`} />
            <Figure
              label="% ต้นทุนอาหาร"
              value={view.pctOfRevenue != null ? `${view.pctOfRevenue.toFixed(1)}%` : "—"}
              color={pctColor}
              sub={view.targetPct != null ? `เป้าหมาย ${view.targetPct}%` : undefined}
            />
          </div>

          {/* What the percentage means, in the terms it is used in: how far
              off target, and what that distance is worth this month. On a
              month that cannot carry a verdict the same two numbers are
              shown, without calling them a saving or an overspend. */}
          {view.gapPoints != null && view.targetPct != null && (
            <p className={`rounded-lg border px-4 py-3 text-sm ${verdictBox}`}>
              ทุก 100 บาทที่ขายได้ เป็นค่าวัตถุดิบ {view.pctOfRevenue!.toFixed(1)} บาท — เป้าหมายคือไม่เกิน {view.targetPct} บาท{" "}
              {view.cogs === 0 ? (
                <>
                  แต่เดือนนี้<strong>ยังไม่มีการบันทึกค่าวัตถุดิบเลย</strong> ตัวเลขนี้จึงยังไม่ใช่ต้นทุนจริงของเดือน
                </>
              ) : !judged ? (
                <>
                  ต่างจากเป้า {Math.abs(view.gapPoints).toFixed(1)} จุด ({over ? "สูงกว่า" : "ต่ำกว่า"}) — แต่
                  <strong>เดือนนี้ข้อมูลยังไม่ครบ</strong> ตัวเลขจะยังเปลี่ยน จึงยังสรุปไม่ได้
                </>
              ) : Math.abs(view.gapPoints) < 0.05 ? (
                <>เดือนนี้<strong>อยู่ที่เป้าพอดี</strong></>
              ) : over ? (
                <>
                  เดือนนี้<strong>สูงกว่าเป้า {view.gapPoints.toFixed(1)} จุด</strong> คิดเป็นเงินประมาณ{" "}
                  <strong>{baht(Math.abs(view.gapBaht!))} บาท</strong> ของเดือนนี้
                </>
              ) : (
                <>
                  เดือนนี้<strong>ต่ำกว่าเป้า {Math.abs(view.gapPoints).toFixed(1)} จุด</strong> ประหยัดได้ประมาณ{" "}
                  <strong>{baht(Math.abs(view.gapBaht!))} บาท</strong> ของเดือนนี้
                </>
              )}
            </p>
          )}

          {view.accounts.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="text-left text-xs">
                  <tr className={TH_ROW}>
                    <th className="px-4 py-2">หมวดวัตถุดิบ (เรียงจากมากไปน้อย)</th>
                    <th className="px-4 py-2 text-right">จำนวน (฿)</th>
                    <th className="w-24 px-4 py-2 text-right">% ของยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {view.accounts.map((a) => (
                    <tr key={a.code} className="border-t border-neutral-100">
                      <td className="px-4 py-1.5 text-neutral-700">{a.name}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-neutral-700">{baht2(a.total)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-xs text-neutral-500">
                        {a.pctOfRevenue != null ? `${a.pctOfRevenue.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-neutral-300 bg-neutral-50">
                  <tr>
                    <td className="px-4 py-2 font-semibold text-neutral-900">รวมต้นทุนวัตถุดิบ</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{baht2(view.cogs)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {view.pctOfRevenue != null ? `${view.pctOfRevenue.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* The basis, in words: which numbers these are, and which they are not. */}
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        ยอดขาย = รายได้ทั้งหมดของเดือนที่อยู่ในระบบ — ยอดจาก POS รวมกับรายได้อื่นที่กรอกจากไฟล์บัญชี
        (เช่น ขายเศษของ/น้ำมันเก่า) · ต้นทุนวัตถุดิบ = รายจ่ายที่บันทึกไว้ในหมวด
        &quot;ต้นทุนวัตถุดิบ (COGS)&quot; ของเดือนนั้น ตามวันที่บันทึก ไม่ใช่วันที่ใช้ของ ·
        เป้าหมาย {view.targetPct != null ? `${view.targetPct}%` : "—"} ตั้งไว้ในหน้า จัดการหมวด
        <br />
        ตัวเลขนี้คือ<strong>ของที่ซื้อเข้ามาจริงทั้งเดือน</strong>เทียบกับยอดขายทั้งเดือน จึงไม่เท่ากับ
        % Food Cost ในหน้า ภาพรวมต้นทุน ซึ่งคิดจากสูตรอาหารของเมนูที่ขายได้ ในรอบการนำเข้ายอดขายล่าสุด
        ไม่ใช่รายเดือน — เดือนที่ซื้อของตุนไว้จะสูงกว่าปกติ และเดือนที่ใช้ของเก่าจะต่ำกว่าปกติ
      </p>
    </PageShell>
  );
}

function Figure({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${color ?? "text-neutral-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}
