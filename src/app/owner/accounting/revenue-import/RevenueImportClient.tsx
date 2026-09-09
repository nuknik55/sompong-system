"use client";

import { useReducer, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyPosRevenueImport,
  previewPosRevenueImport,
  type ApplyResult,
  type ImportPreview,
} from "./actions";
import { canApply, importReducer, initialImportState } from "./import-state";

const TYPE_LABEL: Record<string, string> = {
  food: "อาหาร",
  drink: "เครื่องดื่ม",
  dessert: "ของหวาน",
  delivery: "เดลิเวอรี่",
  souvenir: "ของฝาก",
  pos_other: "อื่นๆ (POS)",
};

const COA_LABEL: Record<string, string> = {
  "650": "ส่วนลด",
  "752": "ค่า GP LineMan",
  "753": "ค่า GP Grab",
};

/**
 * Nik's own August sheets, for comparison only — NEVER a gate.
 *
 * These are one month's absolute figures, so there is nothing to compare a
 * September import against. What the import refuses on instead are the
 * month-independent invariants in pos-revenue.ts. The three differences below
 * are deliberate and documented in supabase/README.md; they are shown here so
 * the first person to check an import against his spreadsheet finds the
 * explanation rather than a discrepancy.
 */
const AUGUST_BASELINE: { yearMonth: string; notes: string[] } = {
  yearMonth: "2026-08",
  notes: [
    "อาหาร (กินที่ร้าน) 3,136,226 ต่ำกว่าชีต อาหาร ของนิก 3,140,505 อยู่ 4,279 — ของฝาก 3,024 กับขนมบ้าบิ่นย้ายออกจากอาหารโดยตั้งใจ",
    "เดลิเวอรี่ 210,926 ไม่ใช่ 212,456 — ตัวเลขในตารางรวมกาแฟที่ขายผ่าน Grab/LineMan 1,530 ซึ่งการนำเข้าตัดออก",
    "ของหวาน 187,434 ไม่ใช่ 188,199 — ส่วนแบ่งไอติมข้าวเหนียวมะม่วง 765 ย้ายไปฝั่งร้านกาแฟ",
    "ยอดร้านกาแฟ 129,277 เป็นยอดก่อนหักส่วนลดและ GP — ตัวเลขที่นิกกรอก 128,625 คิด GP แบบ 30% เท่ากันทั้งสองเจ้า",
    "ส่วนลดและ GP ที่บันทึกรวมส่วนของร้านกาแฟราว 620 บาท (0.016% ของรายได้) ตรงกับที่ธนาคารและแพลตฟอร์มหักจริง",
  ],
};

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function Delta({ current, next }: { current: number | null; next: number }) {
  if (current === null) return <span className="text-xs text-neutral-400">ใหม่</span>;
  const d = next - current;
  if (Math.abs(d) < 0.005) return <span className="text-xs text-neutral-400">เท่าเดิม</span>;
  return (
    <span className={`text-xs tabular-nums ${d > 0 ? "text-green-700" : "text-red-600"}`}>
      {d > 0 ? "+" : ""}
      {fmt(d)}
    </span>
  );
}

export function RevenueImportClient() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The File lives HERE from the moment it is chosen, and apply sends this
  // object. It is never read back from the <input>: the first production run
  // did that and found the input empty, because React 19 resets an
  // uncontrolled form after a <form action> completes. See import-state.ts.
  const [state, dispatch] = useReducer(
    importReducer<File, ImportPreview, ApplyResult>,
    undefined,
    initialImportState<File, ImportPreview, ApplyResult>,
  );
  const { file, preview, error, applied } = state;

  function handlePreview() {
    if (!file) return;
    const previewOf = file; // the file this preview will belong to, even if the selection changes meanwhile
    dispatch({ type: "preview-start" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", previewOf);
      const result = await previewPosRevenueImport(fd);
      if (!result.ok) dispatch({ type: "preview-failed", error: result.error });
      else dispatch({ type: "preview-ok", preview: result.preview, file: previewOf });
    });
  }

  function handleApply() {
    if (!file || !preview || !canApply(state)) return;
    const ok = window.confirm(
      `บันทึกรายได้เดือน ${preview.yearMonth}\n\n` +
        `${preview.revenue.filter((r) => r.amount > 0).length} บรรทัดรายได้ รวม ${fmt(preview.restaurantGross)} บาท\n` +
        `${preview.expenses.length} รายการค่าใช้จ่าย (ส่วนลด/GP)\n\n` +
        `${preview.previousImport ? "เดือนนี้เคยนำเข้าแล้ว — ของเดิมจะถูกแทนที่ทั้งหมด\n" : ""}` +
        `ยอด "อื่นๆ" ของฝ่ายบัญชีจะไม่ถูกแตะต้อง\n\nยืนยันหรือไม่?`,
    );
    if (!ok) return;

    dispatch({ type: "apply-start" });
    startTransition(async () => {
      // The held file is sent again, not the numbers: the server re-parses
      // and refuses unless it gets back the month and gross shown above.
      const fd = new FormData();
      fd.set("file", file);
      fd.set("expectedYearMonth", preview.yearMonth);
      fd.set("expectedGrossTotal", String(preview.grossTotal));
      const result = await applyPosRevenueImport(fd);
      if (!result.ok) dispatch({ type: "apply-failed", error: result.error });
      else {
        dispatch({ type: "apply-ok", result });
        router.refresh();
      }
    });
  }

  const blocked = (preview?.blocks.length ?? 0) > 0;
  const applyEnabled = !isPending && canApply(state);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">อัปโหลดไฟล์ยอดขายจาก POS</p>
          <p className="mt-1 text-xs text-neutral-500">
            ใช้ไฟล์ที่ export จาก POS โดยตรง — SaleData_YYYYMMDD_HHMMSS.xls (มี 5 แผ่น) และต้องเป็นเดือนเดียว
            ระบบจะแสดงตัวเลขทั้งหมดให้ตรวจก่อน ยังไม่บันทึกอะไรจนกว่าจะกดยืนยัน
          </p>
        </div>
        {/* Deliberately NOT a <form action={…}>: React resets an uncontrolled
            form after its action completes, which is what emptied the file
            input on the first production run. The input only feeds state;
            the buttons read state. */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xls,.xlsx"
            disabled={isPending}
            onChange={(e) => dispatch({ type: "select-file", file: e.target.files?.[0] ?? null })}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={isPending || !file}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending && !preview ? "กำลังอ่าน..." : "อ่านไฟล์"}
          </button>
        </div>
        {file && (
          <p className="text-xs text-neutral-500">
            ไฟล์ที่เลือก: <span className="font-medium text-neutral-700">{file.name}</span>{" "}
            <span className="tabular-nums">({Math.round(file.size / 1024)} KB)</span>
            {preview && " — อ่านแล้ว"}
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {applied?.ok && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            บันทึกเดือน {applied.yearMonth} แล้ว ✓ — รายได้ {applied.revenueWritten} บรรทัด, ค่าใช้จ่าย{" "}
            {applied.expensesWritten} รายการ
            {applied.wasReimport && " (แทนที่ข้อมูลเดิม)"}
          </p>
        )}
      </div>

      {preview && (
        <>
          {preview.blocks.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">ยังบันทึกไม่ได้ — ต้องแก้ก่อน</p>
              {preview.blocks.map((b, i) => (
                <div key={i} className="text-sm text-amber-900">
                  {b.kind === "unstored" && (
                    <>
                      <p>
                        มีสินค้า {b.products.length} รายการที่ยังไม่มีหมวด รวม {fmt(b.totalGross)} บาท —{" "}
                        <a href="/owner/accounting/coffee-items" className="underline">
                          ไปหน้าจัดหมวดสินค้า POS
                        </a>
                      </p>
                      <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs">
                        {b.products.map((p) => (
                          <li key={p.productName} className="flex justify-between gap-4">
                            <span>{p.productName}</span>
                            <span className="tabular-nums">{fmt(p.gross)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {b.kind === "sum" && (
                    <p>
                      {b.label}: คำนวณได้ {fmt(b.computed)} แต่ควรเป็น {fmt(b.expected)}
                    </p>
                  )}
                  {b.kind === "period" && <p>{b.message}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-neutral-800">
                เดือน {preview.yearMonth} — จากไฟล์ {preview.fileName}
              </p>
              {preview.previousImport && (
                <p className="text-xs text-amber-700">
                  เคยนำเข้าแล้วเมื่อ {new Date(preview.previousImport.importedAt).toLocaleString("th-TH")} — กดยืนยันจะแทนที่ทั้งหมด
                </p>
              )}
            </div>

            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th className="py-1">ประเภทรายได้</th>
                  <th className="py-1 text-right">ปัจจุบัน</th>
                  <th className="py-1 text-right">จะเป็น</th>
                  <th className="py-1 text-right">ต่าง</th>
                </tr>
              </thead>
              <tbody>
                {preview.revenue.map((r) => (
                  <tr key={r.revenue_type} className="border-t border-neutral-100">
                    <td className="py-1.5">{TYPE_LABEL[r.revenue_type] ?? r.revenue_type}</td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">
                      {r.current === null ? "—" : fmt(r.current)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{fmt(r.amount)}</td>
                    <td className="py-1.5 text-right">
                      <Delta current={r.current} next={r.amount} />
                    </td>
                  </tr>
                ))}
                {/* Shown greyed precisely so its exclusion is visible rather than
                    implied. The import cannot write this row: "other" is not a
                    RevenueType, and the RPC's allowlist has no entry for it. */}
                <tr className="border-t border-neutral-100 bg-neutral-50 text-neutral-400">
                  <td className="py-1.5">
                    อื่นๆ (บัญชี)
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">ไม่แตะต้อง</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {preview.otherCurrent === null ? "—" : fmt(preview.otherCurrent)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">คงเดิม</td>
                  <td className="py-1.5" />
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300 font-semibold">
                  <td className="py-1.5">รวมที่จะบันทึก</td>
                  <td />
                  <td className="py-1.5 text-right tabular-nums">{fmt(preview.restaurantGross)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>

            <p className="mt-2 text-xs text-neutral-500">
              ยอดรวมในไฟล์ {fmt(preview.grossTotal)} = ที่จะบันทึก {fmt(preview.restaurantGross)} + ร้านกาแฟ{" "}
              {fmt(preview.coffeeGross)} (รวมส่วนแบ่งแยก {fmt(preview.carveOut)}) — ร้านกาแฟไม่นับเป็นรายได้ร้านอาหาร
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm font-medium text-neutral-800">ค่าใช้จ่ายที่จะบันทึก ({preview.entryDate})</p>
            <p className="mt-1 text-xs text-neutral-500">
              ทั้งสามรายการเป็น &quot;ไม่ต้องจ่าย&quot; — GP ถูกหักก่อนเงินเข้า และส่วนลดไม่มีเงินออก จึงไม่ขึ้นในรายการโอน
            </p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {preview.expenses.map((e) => (
                  <tr key={e.bill_ref} className="border-t border-neutral-100">
                    <td className="py-1.5">
                      {e.coa_code} {COA_LABEL[e.coa_code] ?? ""}
                      <span className="ml-2 text-xs text-neutral-400">{e.bill_ref}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">
                      {e.current === null ? "—" : fmt(e.current)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{fmt(e.amount)}</td>
                    <td className="py-1.5 text-right">
                      <Delta current={e.current} next={e.amount} />
                    </td>
                  </tr>
                ))}
                {preview.expenses.length === 0 && (
                  <tr>
                    <td className="py-2 text-sm text-neutral-400">ไม่มี</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-neutral-500">
              ส่วนลด {fmt(preview.discounts.discount)} + CRM ครึ่งหนึ่ง {fmt(preview.discounts.crmBooked)} (เต็ม{" "}
              {fmt(preview.discounts.crmRaw)}) · ไม่นับ {fmt(preview.discounts.excluded)}
              {preview.platformFees.map((p) => ` · GP ${p.method} ${p.ratePct}% ของ ${fmt(p.amount)}`).join("")}
            </p>
            {preview.discounts.unclassifiedNames.length > 0 && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                ส่วนลดที่ยังไม่รู้จัก (ไม่ถูกบันทึก): {preview.discounts.unclassifiedNames.join(", ")}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            <p className="font-medium text-neutral-800">ข้อมูลอื่นในไฟล์ (ยังไม่บันทึก)</p>
            <p className="mt-1 text-xs text-neutral-500">
              จำนวนบิล {fmt(preview.covers.bills)} · จำนวนลูกค้า {fmt(preview.covers.customers)} · ยกเลิกบิล{" "}
              {fmt(preview.covers.cancelledBills)} รายการ {fmt(preview.covers.cancelledAmount)} บาท
            </p>
          </div>

          {preview.yearMonth === AUGUST_BASELINE.yearMonth && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm font-medium text-neutral-700">เทียบกับชีตของนิก (แสดงอย่างเดียว ไม่ได้ใช้ตัดสิน)</p>
              <ul className="mt-2 space-y-1 text-xs text-neutral-600">
                {AUGUST_BASELINE.notes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {blocked && <p className="text-sm text-amber-700">แก้รายการข้างบนก่อนจึงจะบันทึกได้</p>}
            <button
              type="button"
              onClick={handleApply}
              disabled={!applyEnabled}
              className="rounded-md bg-brand-green px-5 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
            >
              {isPending ? "กำลังบันทึก..." : `ยืนยันบันทึกเดือน ${preview.yearMonth}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
