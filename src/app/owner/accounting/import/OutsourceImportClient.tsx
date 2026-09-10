"use client";

import { useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyOutsourceImport,
  previewOutsourceImport,
  type OutsourceApplyResult,
  type OutsourceMonthPreview,
  type OutsourcePreview,
} from "./outsource-actions";
import { canApply, importReducer, initialImportState } from "../revenue-import/import-state";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function thaiMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 0) + 543}`;
}

/** The month the screen opens on: the latest the file holds that this import may write expenses for; else the latest. */
function defaultMonth(months: OutsourceMonthPreview[]): string {
  const writable = months.filter((m) => !m.beforeLedger && !m.budget69Owned).map((m) => m.yearMonth).sort();
  if (writable.length > 0) return writable[writable.length - 1]!;
  return [...months.map((m) => m.yearMonth)].sort().at(-1) ?? "";
}

export function OutsourceImportClient() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Same reducer as the POS and budget69 imports: the File lives in state
  // from selection, apply sends that object, a different file drops the
  // preview. The preview here is the WHOLE file; the month is chosen after.
  const [state, dispatch] = useReducer(
    importReducer<File, OutsourcePreview, OutsourceApplyResult>,
    undefined,
    initialImportState<File, OutsourcePreview, OutsourceApplyResult>,
  );
  const { file, preview, error, applied } = state;
  const [yearMonth, setYearMonth] = useState<string>("");
  const month = preview?.months.find((m) => m.yearMonth === yearMonth) ?? null;

  function handlePreview() {
    if (!file) return;
    const previewOf = file;
    dispatch({ type: "preview-start" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", previewOf);
      const result = await previewOutsourceImport(fd);
      if (!result.ok) dispatch({ type: "preview-failed", error: result.error });
      else {
        dispatch({ type: "preview-ok", preview: result.preview, file: previewOf });
        setYearMonth((cur) => (result.preview.months.some((m) => m.yearMonth === cur) ? cur : defaultMonth(result.preview.months)));
      }
    });
  }

  function handleApply() {
    if (!file || !preview || !month || !canApply(state) || month.blocks.length > 0 || month.beforeLedger || "missing" in month.other) return;
    const other = month.other.value;
    const ok = window.confirm(
      (month.budget69Owned
        ? `เดือน ${thaiMonth(month.yearMonth)} เป็นของ budget69 — จะบันทึกเฉพาะ รายได้อื่นๆ ${fmt(other)} บาท\nรายจ่ายรายเดือนของเดือนนี้ไม่แตะต้อง\n\n`
        : `บันทึกรายจ่ายรายเดือนจากไฟล์บัญชี เดือน ${thaiMonth(month.yearMonth)}\n\n` +
          `${month.entries.length} รายการ รวม ${fmt(month.writtenTotal)} บาท (เต็มจำนวนตามไฟล์)\n` +
          `รายได้อื่นๆ ${fmt(other)} บาท${month.storedOther !== null ? ` (เดิม ${fmt(month.storedOther)})` : ""}\n\n`) +
        `${month.previousImport ? "เดือนนี้เคยนำเข้าแล้ว — ของเดิมจะถูกแทนที่ทั้งหมด\n" : ""}` +
        `ทุกรายการลงวันที่ 1 ของเดือน เป็น "ไม่ต้องจ่าย" ไม่ผูกซัพพลายเออร์\n\nยืนยันหรือไม่?`,
    );
    if (!ok) return;
    dispatch({ type: "apply-start" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("yearMonth", month.yearMonth);
      fd.set("expectedBlockTotal", String(month.blockTotal));
      fd.set("expectedOther", String(other));
      const result = await applyOutsourceImport(fd);
      if (!result.ok) dispatch({ type: "apply-failed", error: result.error });
      else {
        dispatch({ type: "apply-ok", result });
        router.refresh();
      }
    });
  }

  const monthBlocked = !month || month.blocks.length > 0 || month.beforeLedger || "missing" in month.other;
  const applyEnabled = !isPending && canApply(state) && !monthBlocked;
  const identity = month?.blocks.find((b) => b.kind === "identity");
  const unmapped = month?.blocks.find((b) => b.kind === "unmapped");
  const otherMissing = month?.blocks.find((b) => b.kind === "other-missing");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-neutral-800">อัปโหลดไฟล์บัญชี (69-08.xlsx, 69-09.xlsx …) แล้วเลือกเดือน</p>
          <p className="mt-1 text-xs text-neutral-500">
            อ่านแผ่น รับ-จ่าย ทุกเดือนในไฟล์ — กลุ่มรายจ่ายรายเดือน (ค่าแรงพนักงาน … รวมคชจ.) กับค่าธรรมเนียมบัตร
            บันทึกเต็มจำนวนตามไฟล์ บรรทัดละบัญชี ลงวันที่ 1 ของเดือน และช่อง F7 รายได้อื่นๆ ของแผ่นเดือน
          </p>
        </div>
        {/* No <form action>: React resets an uncontrolled form after its action,
            which is what emptied the POS import's file input on its first run. */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx"
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
          {preview && (
            <select
              value={yearMonth}
              disabled={isPending}
              onChange={(e) => setYearMonth(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            >
              {preview.months.map((m) => (
                <option key={m.yearMonth} value={m.yearMonth}>
                  {thaiMonth(m.yearMonth)}
                  {m.beforeLedger ? " — ก่อนเริ่มระบบ" : m.budget69Owned ? " — budget69 (เฉพาะรายได้อื่นๆ)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        {file && (
          <p className="text-xs text-neutral-500">
            ไฟล์ที่เลือก: <span className="font-medium text-neutral-700">{file.name}</span>{" "}
            <span className="tabular-nums">({Math.round(file.size / 1024)} KB)</span>
            {preview && ` — อ่านแล้ว: แผ่น ${preview.expenseSheet}, ${preview.months.length} เดือน`}
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {applied?.ok && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            บันทึกเดือน {thaiMonth(applied.yearMonth)} แล้ว ✓ —{" "}
            {applied.budget69Owned ? "เฉพาะรายได้อื่นๆ" : `${applied.inserted} รายการ`} · รายได้อื่นๆ {fmt(applied.other)}
            {applied.wasReimport && ` (แทนที่ของเดิม ${applied.deleted} รายการ)`}
          </p>
        )}
      </div>

      {preview && (
        <>
          {/* Month overview: every month in the file, its status, and who owns it. */}
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2">เดือน</th>
                  <th className="px-3 py-2">แถวในแผ่น</th>
                  <th className="px-3 py-2 text-right">รายจ่ายรายเดือน + ค่าบัตร</th>
                  <th className="px-3 py-2 text-right">รายได้อื่นๆ (F7)</th>
                  <th className="px-3 py-2">แหล่ง</th>
                  <th className="px-3 py-2">ตรวจสอบ</th>
                  <th className="px-3 py-2">นำเข้าแล้ว</th>
                </tr>
              </thead>
              <tbody>
                {preview.months.map((o) => (
                  <tr
                    key={o.yearMonth}
                    onClick={() => !isPending && setYearMonth(o.yearMonth)}
                    className={`cursor-pointer border-t border-neutral-100 ${o.yearMonth === yearMonth ? "bg-amber-50/60 font-medium" : "hover:bg-neutral-50"}`}
                  >
                    <td className="px-3 py-1.5">{thaiMonth(o.yearMonth)}</td>
                    <td className="px-3 py-1.5 text-xs tabular-nums text-neutral-500">{o.firstRow}–{o.lastRow}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(o.blockTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{"value" in o.other ? fmt(o.other.value) : <span className="text-red-700">ไม่พบ</span>}</td>
                    <td className="px-3 py-1.5 text-xs text-neutral-600">
                      {o.beforeLedger ? "ก่อนเริ่มระบบ — ข้าม" : o.budget69Owned ? "budget69 → เฉพาะรายได้อื่นๆ" : "ไฟล์บัญชี"}
                    </td>
                    <td className={`px-3 py-1.5 text-xs ${o.blocks.length === 0 ? "text-green-700" : "text-red-700 font-semibold"}`}>
                      {o.blocks.length === 0 ? "ตรงกัน ✓" : "หยุด"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">
                      {o.previousImport ? new Date(o.previousImport.importedAt).toLocaleDateString("th-TH") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {month && (
            <>
              {/* THE STOPS. Not warnings: the confirm button is disabled below,
                  and the server refuses the same way whatever the client sends. */}
              {identity && identity.kind === "identity" && (
                <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-semibold">หยุด — ยอดรวมของไฟล์ไม่ตรงกับแถวที่อ่านได้</p>
                  <p className="mt-1">
                    รวมคชจ. บอกว่า {fmt(identity.total)} แต่ หักจ่ายสด {fmt(identity.cashTotal)} + กลุ่มรายจ่ายรายเดือน {fmt(identity.monthlySum)} ={" "}
                    {fmt(identity.cashTotal + identity.monthlySum)} — ต่างกัน {fmt(identity.diff)}
                  </p>
                  <p className="mt-1">แปลว่ามีแถวในแผ่นที่ระบบมองไม่เห็นหรือนับซ้ำ ไม่บันทึกจนกว่าจะหาเจอ</p>
                </div>
              )}
              {unmapped && unmapped.kind === "unmapped" && (
                <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-semibold">
                    หยุด — มี {unmapped.rows.length} รายการในกลุ่มรายจ่ายรายเดือนที่ระบบไม่รู้จัก รวม {fmt(unmapped.total)} บาท
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {unmapped.rows.map((r) => (
                      <li key={r.row} className="flex justify-between gap-4">
                        <span>แถว {r.row} · {r.label}</span>
                        <span className="tabular-nums">{fmt(r.value)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">ชื่อรายการใหม่ต้องจับคู่บัญชีก่อน — ไม่เดา ไม่ข้าม</p>
                </div>
              )}
              {otherMissing && otherMissing.kind === "other-missing" && (
                <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-semibold">หยุด — ไม่พบ รายได้อื่นๆ (F7) ของเดือนนี้</p>
                  <p className="mt-1">{otherMissing.reason}</p>
                </div>
              )}
              {month.beforeLedger && (
                <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700">
                  เดือนนี้อยู่ก่อนที่ระบบเริ่มบันทึก — แสดงให้ดู ไม่บันทึก
                </div>
              )}
              {month.budget69Owned && !month.beforeLedger && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">เดือนนี้เป็นของ budget69 — จะบันทึกเฉพาะ รายได้อื่นๆ</p>
                  <p className="mt-1 text-xs">
                    รายจ่ายรายเดือนของ ม.ค.–ก.ค. 69 อยู่ในระบบจาก budget69 แล้ว เดือนหนึ่งมีแหล่งเดียว ตารางด้านล่างแสดงตัวเลขจากไฟล์บัญชีให้เทียบ แต่ไม่เขียน
                  </p>
                </div>
              )}

              {/* จะบันทึก — the monthly block in full, twins beside their cash-paid figures. */}
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-800">
                    {month.budget69Owned || month.beforeLedger ? "อยู่ในไฟล์ — ไม่บันทึก" : "จะบันทึก"} · {thaiMonth(month.yearMonth)} · แถว {month.firstRow}–{month.lastRow}
                    <span className="ml-2 text-xs font-normal text-neutral-500">
                      รวมคชจ. {fmt(month.total)} = หักจ่ายสด {fmt(month.cashTotal)} + รายจ่ายรายเดือน {fmt(month.total - month.cashTotal)} ✓
                    </span>
                  </p>
                  {month.previousImport && (
                    <p className="text-xs text-amber-700">
                      เคยนำเข้าแล้ว {new Date(month.previousImport.importedAt).toLocaleString("th-TH")} — ยืนยันจะแทนที่ทั้งหมด
                    </p>
                  )}
                </div>
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-neutral-500">
                    <tr>
                      <th className="py-1">บัญชี</th>
                      <th className="py-1">ในไฟล์</th>
                      <th className="py-1 text-right">จะบันทึก</th>
                      <th className="py-1 text-right">จ่ายสดรายวัน (มีในระบบแล้ว)</th>
                      <th className="py-1 text-right">บันทึกรายวันในระบบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {month.entries.map((e) => (
                      <tr key={e.coa_code} className="border-t border-neutral-100">
                        <td className="py-1">{e.coa_code} {e.coa_name}</td>
                        <td className="py-1 text-xs text-neutral-500">{e.rows.map((r) => `${r.label} แถว ${r.row}`).join(" + ")}</td>
                        <td className="py-1 text-right tabular-nums font-medium">{fmt(e.amount)}</td>
                        {/* The same label in the cash-paid block: a different figure,
                            not a mismatch. 604,970 beside 78,497 reads as two things. */}
                        <td className="py-1 text-right tabular-nums text-neutral-500">{e.cashTwin ? fmt(e.cashTwin.value) : "—"}</td>
                        <td className="py-1 text-right tabular-nums text-neutral-500">{e.appDaily > 0 ? fmt(e.appDaily) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-neutral-300 font-semibold">
                      <td className="py-1.5" colSpan={2}>รวม ({month.entries.length} รายการ)</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(month.blockTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-2 text-xs text-neutral-500">
                  บันทึกเต็มจำนวนตามไฟล์ ไม่หักบันทึกรายวัน — ตัวเลขรายเดือนกับจ่ายสดรายวันเป็นคนละยอดตามการคำนวณของไฟล์เอง
                  (ค่าภ.ง.ด.1 ประมาณ 10 บาท/เดือน อยู่ในจ่ายสดและถูกบันทึกรายวันเข้า 952 ด้วย — ยอมรับ)
                </p>
              </div>

              {/* other — the accountants' figure, this import owns it. */}
              <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
                <p className="font-medium text-neutral-800">รายได้อื่นๆ (ค่าเช่าร้าน+อื่นๆ) — ช่อง F7 ของแผ่นเดือน</p>
                {"value" in month.other ? (
                  <p className="mt-1 tabular-nums">
                    <span className="text-lg font-semibold">{fmt(month.other.value)}</span>
                    <span className="ml-2 text-xs text-neutral-500">แผ่น {month.other.sheet} · ผูกด้วย{month.other.tiedBy === "name" ? "ชื่อแผ่น" : month.other.tiedBy === "formula" ? "สูตร F7" : "สูตร F7 และชื่อแผ่น"}</span>
                    {month.storedOther !== null && (
                      <span className={`ml-3 text-xs ${Math.abs(month.storedOther - month.other.value) > 0.005 ? "text-amber-700" : "text-neutral-500"}`}>
                        ในระบบตอนนี้ {fmt(month.storedOther)}{Math.abs(month.storedOther - month.other.value) > 0.005 ? " → จะถูกแทนที่" : " (เท่ากัน)"}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-red-700">{month.other.missing}</p>
                )}
              </div>

              {/* ตรวจแล้วไม่บันทึก */}
              <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
                <p className="font-medium text-neutral-800">ตรวจแล้ว ไม่บันทึก</p>
                <ul className="mt-2 space-y-1.5 text-xs text-neutral-700">
                  {month.notImported.map((n) => (
                    <li key={`${n.row}-${n.label}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      <span>
                        แถว {n.row} · {n.label} <span className="tabular-nums font-medium">{fmt(n.value)}</span>
                        <span className="ml-2 text-neutral-500">— {n.reason}</span>
                      </span>
                      {n.appDaily !== undefined && (
                        <span className={`tabular-nums ${n.mismatch ? "font-semibold text-amber-700" : "text-neutral-500"}`}>
                          ในระบบ 230+231: {fmt(n.appDaily)} {n.mismatch ? "≠ ไม่ตรงกับไฟล์ — ตรวจบันทึกรายวัน" : "="}
                        </span>
                      )}
                    </li>
                  ))}
                  <li className="text-neutral-500">
                    ทุกอย่างอื่นในไฟล์ (ตารางรายวัน รายการจ่ายสด รับเงิน) ไม่แตะต้อง — ที่บันทึกในระบบเป็นหลัก
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3">
                {!applyEnabled && monthBlocked && !isPending && (
                  <p className="text-sm text-red-700">{month.beforeLedger ? "เดือนนี้ไม่บันทึก" : "ยังบันทึกไม่ได้ — ดูข้อความด้านบน"}</p>
                )}
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!applyEnabled}
                  className="rounded-md bg-brand-green px-5 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
                >
                  {isPending ? "กำลังบันทึก..." : month.budget69Owned ? `ยืนยันบันทึกรายได้อื่นๆ ${thaiMonth(month.yearMonth)}` : `ยืนยันบันทึกเดือน ${thaiMonth(month.yearMonth)}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
