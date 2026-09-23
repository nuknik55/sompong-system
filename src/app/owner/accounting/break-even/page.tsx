export const dynamic = "force-dynamic";

import { requireOwner } from "@/lib/auth";
import { getMonthlySummary, getMonthlyCovers, getCoaBehaviors } from "../actions";
import { completenessNotices } from "../summary/completeness";
import { breakEven } from "../break-even";
import { nextMonth, previousMonth } from "../checklist";
import { bangkokYearMonth } from "@/lib/bangkok-date";
import { ToolRow } from "../tool-row";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";

/**
 * Break-even for one month: four figures and one sentence of basis. No
 * table, no chart, no trend — if it wants either, that is a different item.
 *
 * Reuses getMonthlySummary (amounts, completeness) and
 * monthly_covers; the classification comes from coa.cost_behavior through
 * the rule in break-even.ts.
 */

function baht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
function thaiMonth(yearMonth: string) {
  const M = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const [y, m] = yearMonth.split("-").map(Number);
  return `${M[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

export default async function BreakEvenPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  // OWNER ONLY since 2026-09-17 (Nik): break-even and the safety margin are
  // derived from the shop's profit. An admin is sent to /owner.
  const profile = await requireOwner();
  const { month: rawMonth } = await searchParams;
  const today = bangkokYearMonth();
  const yearMonth = rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today;

  const [summary, covers, coa] = await Promise.all([getMonthlySummary(yearMonth), getMonthlyCovers(yearMonth), getCoaBehaviors()]);

  const [y, m] = yearMonth.split("-").map(Number);
  // Pure string math (see the summary page): a local-time Date skipped a
  // month on a Bangkok machine.
  const prevMonth = previousMonth(yearMonth);
  const nextMonthStr = nextMonth(yearMonth);

  // Every account with a total this month, operating and below the line —
  // the rule decides what is in, not the grouping.
  const accounts = [...summary.groups, ...summary.nonOperating].flatMap((g) => g.accounts.map((a) => ({ code: a.code, total: a.total })));
  const r = breakEven({ revenue: summary.totalRevenue, accounts, coa, covers });
  const groupName = new Map([...summary.groups, ...summary.nonOperating].map((g) => [g.group_code, g.group_name]));
  const fixedByHeaderNames = r.fixedByHeader.map((g) => groupName.get(g) ?? g);
  const notices = completenessNotices(summary);

  return (
    <PageShell>
      <PageHeader title="จุดคุ้มทุน" />
      <ToolRow role={profile.role} yearMonth={yearMonth} current="break-even" />

      <div className="flex items-center gap-3">
        <a href={`/owner/accounting/break-even?month=${prevMonth}`} className={buttonClass("secondary", { size: "sm" })}>‹</a>
        <span className="font-medium text-neutral-800">{thaiMonth(yearMonth)}</span>
        {yearMonth !== today && (
          <a href={`/owner/accounting/break-even?month=${nextMonthStr}`} className={buttonClass("secondary", { size: "sm" })}>›</a>
        )}
      </div>

      {summary.totalRevenue === 0 ? (
        <p className="rounded-lg border border-pending/60 bg-pending-soft px-4 py-3 text-sm text-pending-ink">
          เดือนนี้ยังไม่มีรายได้ในระบบ — นำเข้ารายได้ POS ก่อน จึงจะคำนวณจุดคุ้มทุนได้
        </p>
      ) : (
        <>
          {notices.map((n) => (
            <p key={n} className="rounded-lg border border-pending/60 bg-pending-soft px-4 py-3 text-sm text-pending-ink">{n}</p>
          ))}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="อัตรากำไรส่วนเกิน" value={r.contributionMargin !== null ? pct(r.contributionMargin) : "—"} sub={`ผันแปร ${baht(r.variable)} จากรายได้ ${baht(r.revenue)}`} />
            <Figure label="ต้นทุนคงที่" value={`${baht(r.fixed)} ฿`} sub={r.excluded > 0 ? `ไม่นับ ${baht(r.excluded)} (ภาษี/CapEx/ร้านกาแฟ)` : undefined} />
            <Figure
              label="รายได้ที่จุดคุ้มทุน"
              value={r.breakEvenRevenue !== null ? `${baht(r.breakEvenRevenue)} ฿` : "—"}
              sub={r.breakEvenRevenue !== null ? `${pct(r.breakEvenRevenue / r.revenue)} ของรายได้เดือนนี้` : "กำไรส่วนเกินไม่พอ — ไม่มีจุดคุ้มทุน"}
              highlight={r.safetyMargin === null ? "red" : r.safetyMargin < 0 ? "red" : r.safetyMargin / r.revenue < 0.1 ? "amber" : "green"}
            />
            <Figure
              label="ส่วนเผื่อความปลอดภัย"
              value={r.safetyMargin !== null ? `${baht(r.safetyMargin)} ฿` : "—"}
              sub={r.safetyMargin !== null ? `${pct(r.safetyMargin / r.revenue)} ของรายได้` : undefined}
            />
          </div>

          {r.breakEvenBills !== null && covers && (
            <p className="text-sm text-neutral-700 tabular-nums">
              เท่ากับ <strong>{baht(r.breakEvenBills)} บิล</strong> ที่ {baht(r.revenuePerBill ?? 0)} ฿/บิล — เดือนนี้มี {baht(covers.bills)} บิล
              {(() => { const days = new Date(y!, m!, 0).getDate(); return ` (${Math.ceil(r.breakEvenBills! / days)} บิล/วัน จาก ${Math.round(covers.bills / days)} บิล/วันจริง)`; })()}
            </p>
          )}

          {/* The basis, in words. */}
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            ผันแปร = วัตถุดิบ, ค่าส่ง/GP และบัญชีที่ตั้งเป็นผันแปรไว้ (ค่าแรงรายวัน ส่วนลด ของแจก) · คงที่ = ที่เหลือ
            {fixedByHeaderNames.length > 0 && (
              <> — โดย <strong>{fixedByHeaderNames.join(", ")}</strong> ถูกนับเป็นคงที่ทั้งหมวดตามหัวหมวด ทั้งที่บางส่วนแปรตามยอดขาย</>
            )}
            {" "}ดังนั้นอัตรากำไรส่วนเกินจริงต่ำกว่านี้เล็กน้อย และจุดคุ้มทุนจริงสูงกว่านี้เล็กน้อย — เป็นค่าประมาณตามการจัดหมวด ไม่ใช่ตัวเลขแม่นยำ
            {r.unresolved.length > 0 && <> · บัญชีที่ไม่มีในผัง: {r.unresolved.join(", ")}</>}
          </p>
        </>
      )}
    </PageShell>
  );
}

function Figure({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "red" | "amber" | "green" }) {
  const color = highlight === "red" ? "text-danger" : highlight === "amber" ? "text-pending-ink" : highlight === "green" ? "text-brand-green" : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500 tabular-nums">{sub}</p>}
    </div>
  );
}
