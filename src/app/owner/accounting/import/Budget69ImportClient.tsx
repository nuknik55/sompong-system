"use client";

import { useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyBudget69Import, previewBudget69Import, type ApplyResult, type Budget69Preview } from "./actions";
import { canApply, importReducer, initialImportState } from "../revenue-import/import-state";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function thaiMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 0) + 543}`;
}

export function Budget69ImportClient({ defaultYearMonth }: { defaultYearMonth: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  // Same reducer as the POS import: the File lives in state from selection,
  // apply sends that object, and a different file invalidates the preview.
  const [state, dispatch] = useReducer(
    importReducer<File, Budget69Preview, ApplyResult>,
    undefined,
    initialImportState<File, Budget69Preview, ApplyResult>,
  );
  const { file, preview, error, applied } = state;

  function handlePreview() {
    if (!file) return;
    const previewOf = file;
    dispatch({ type: "preview-start" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", previewOf);
      fd.set("yearMonth", yearMonth);
      const result = await previewBudget69Import(fd);
      if (!result.ok) dispatch({ type: "preview-failed", error: result.error });
      else dispatch({ type: "preview-ok", preview: result.preview, file: previewOf });
    });
  }

  function handleApply() {
    if (!file || !preview || !canApply(state)) return;
    const writing = preview.entries.filter((e) => e.lump > 0);
    const ok = window.confirm(
      `บันทึกรายจ่ายรายเดือนจาก budget69 เดือน ${thaiMonth(preview.yearMonth)}\n\n` +
        `${writing.length} รายการ รวม ${fmt(preview.writtenTotal)} บาท\n` +
        `(ยอดในชีต ${fmt(preview.sheetTotalMapped)} − ที่บันทึกรายวันแล้ว ${fmt(preview.sheetTotalMapped - preview.writtenTotal)})\n\n` +
        `${preview.previousImport ? "เดือนนี้เคยนำเข้าแล้ว — ของเดิมจะถูกแทนที่ทั้งหมด\n" : ""}` +
        `ทุกรายการลงวันที่ 1 ของเดือน เป็น "ไม่ต้องจ่าย" ไม่ผูกซัพพลายเออร์\n\nยืนยันหรือไม่?`,
    );
    if (!ok) return;
    dispatch({ type: "apply-start" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("yearMonth", preview.yearMonth);
      fd.set("expectedSheetExpenseTotal", String(preview.sheetExpenseTotal));
      const result = await applyBudget69Import(fd);
      if (!result.ok) dispatch({ type: "apply-failed", error: result.error });
      else {
        dispatch({ type: "apply-ok", result });
        router.refresh();
      }
    });
  }

  const applyEnabled = !isPending && canApply(state);
  const unexplained = preview?.blocks.find((b) => b.kind === "unexplained");
  const unmapped = preview?.blocks.find((b) => b.kind === "unmapped");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-neutral-800">อัปโหลด budget69.xlsx แล้วเลือกเดือน</p>
          <p className="mt-1 text-xs text-neutral-500">
            อ่านคอลัมน์ &quot;จริง&quot; (สีเขียว) ของแผ่น งบ69 เดือนที่เลือก แล้วบันทึกเป็นรายการละ 1 บรรทัดต่อบัญชี
            ลงวันที่ 1 ของเดือน — เฉพาะส่วนที่ยังไม่ได้บันทึกรายวัน
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
          <input
            type="month"
            value={yearMonth}
            disabled={isPending}
            onChange={(e) => {
              setYearMonth(e.target.value);
              // A different month is a different preview.
              if (file) dispatch({ type: "select-file", file });
            }}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
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
            บันทึกเดือน {thaiMonth(applied.yearMonth)} แล้ว ✓ — {applied.inserted} รายการ
            {applied.wasReimport && ` (แทนที่ของเดิม ${applied.deleted} รายการ)`}
          </p>
        )}
      </div>

      {preview && (
        <>
          {/* THE STOP. Not a warning: the confirm button is disabled below, and
              the server refuses the same way whatever the client sends. */}
          {unexplained && unexplained.kind === "unexplained" && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-semibold">หยุด — ยอดในชีตกับที่จะบันทึกไม่ตรงกัน และไม่มีคำอธิบาย</p>
              <p className="mt-1">
                ชีตบอกว่าเดือนนี้มีรายจ่าย {fmt(unexplained.sheetExpenseTotal)} (ยอดขาย − Net Profit
                {unexplained.sheetExcluded > 0 && ` + แถวที่สูตรรวมของชีตข้ามไป ${fmt(unexplained.sheetExcluded)}`})
                แต่ทุกบรรทัดที่ระบบรู้จักรวมกันได้ {fmt(unexplained.explained)} — ต่างกัน {fmt(unexplained.diff)}
              </p>
              <p className="mt-1">
                แปลว่ามีแถวในชีตที่ระบบมองไม่เห็นหรือนับซ้ำ นี่คือแหล่งที่มาของต้นทุนหนึ่งในสามของร้าน จึงไม่บันทึกจนกว่าจะหาเจอ
              </p>
            </div>
          )}
          {unmapped && unmapped.kind === "unmapped" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">
                มี {unmapped.rows.length} แถวในชีตที่ยังไม่ได้จับคู่บัญชี รวม {fmt(unmapped.total)} บาท — ต้องเพิ่มในตารางจับคู่ก่อน
              </p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {unmapped.rows.map((r) => (
                  <li key={r.row} className="flex justify-between gap-4">
                    <span>แถว {r.row} · {r.name}</span>
                    <span className="tabular-nums">{fmt(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Month overview — which months reconcile, and which are already in. */}
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2">เดือน</th>
                  <th className="px-3 py-2 text-right">รายจ่ายตามชีต</th>
                  <th className="px-3 py-2 text-right">จะบันทึก</th>
                  <th className="px-3 py-2 text-right">ส่วนลด/GP (จาก POS)</th>
                  <th className="px-3 py-2 text-right">ยังไม่จับคู่</th>
                  <th className="px-3 py-2">ตรวจสอบ</th>
                  <th className="px-3 py-2">นำเข้าแล้ว</th>
                </tr>
              </thead>
              <tbody>
                {preview.overview.map((o) => (
                  <tr key={o.yearMonth} className={`border-t border-neutral-100 ${o.yearMonth === preview.yearMonth ? "bg-amber-50/60 font-medium" : ""}`}>
                    <td className="px-3 py-1.5">{thaiMonth(o.yearMonth)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(o.sheetExpenseTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(o.writtenTotal)} <span className="text-xs text-neutral-400">({o.entries})</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{fmt(o.posOwnedTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.unmapped === 0 ? "—" : o.unmapped}</td>
                    <td className={`px-3 py-1.5 text-xs ${o.reconciles ? "text-green-700" : "text-red-700 font-semibold"}`}>{o.reconciles ? "ตรงกัน ✓" : "ไม่ตรง — หยุด"}</td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{o.importedAt ? new Date(o.importedAt).toLocaleDateString("th-TH") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The chosen month, in four groups so July reads as decided. */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-neutral-800">
                {thaiMonth(preview.yearMonth)} — ยอดขายตามชีต {fmt(preview.revenue)} · Net Profit {fmt(preview.netProfit)} · รายจ่าย {fmt(preview.sheetExpenseTotal)}
              </p>
              {preview.previousImport && (
                <p className="text-xs text-amber-700">
                  เคยนำเข้าแล้ว {new Date(preview.previousImport.importedAt).toLocaleString("th-TH")} — ยืนยันจะแทนที่ทั้งหมด
                </p>
              )}
            </div>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th className="py-1">บัญชี</th>
                  <th className="py-1 text-right">ยอดชีต</th>
                  <th className="py-1 text-right">บันทึกรายวันแล้ว</th>
                  <th className="py-1 text-right">จะบันทึก</th>
                </tr>
              </thead>
              <tbody>
                {preview.entries.filter((e) => e.lump > 0).map((e) => (
                  <tr key={e.coa_code} className="border-t border-neutral-100">
                    <td className="py-1">{e.coa_code} {e.coa_name}</td>
                    <td className="py-1 text-right tabular-nums text-neutral-500">{fmt(e.sheetAmount)}</td>
                    <td className="py-1 text-right tabular-nums text-neutral-500">{e.appAmount > 0 ? fmt(e.appAmount) : "—"}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{fmt(e.lump)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300 font-semibold">
                  <td className="py-1.5">รวมที่จะบันทึก ({preview.entries.filter((e) => e.lump > 0).length} รายการ)</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500">{fmt(preview.sheetTotalMapped)}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500">{fmt(preview.sheetTotalMapped - preview.writtenTotal)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(preview.writtenTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {(preview.negatives.length > 0 || preview.appOnly.length > 0 || preview.posOwned.length > 0 || preview.sheetExcluded.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {preview.negatives.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                  <p className="font-medium text-neutral-800">บันทึกรายวันเกินยอดชีต — ไม่เขียนเพิ่ม, รายการเดิมคงอยู่</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                    {preview.negatives.map((n) => (
                      <li key={n.coa_code}>{n.coa_code} {n.coa_name}: ชีต {fmt(n.sheetAmount)} &lt; รายวัน {fmt(n.appAmount)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.appOnly.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                  <p className="font-medium text-neutral-800">มีในระบบ แต่ชีตไม่มีแถวนี้ — ไม่แตะต้อง</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                    {preview.appOnly.map((a) => (
                      <li key={a.coa_code}>{a.coa_code} {a.coa_name}: {fmt(a.appAmount)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.posOwned.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                  <p className="font-medium text-neutral-800">มาจากการนำเข้ารายได้ POS — ไม่เขียนจากชีต (จะนับซ้ำ)</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                    {preview.posOwned.map((x) => (
                      <li key={x.coa_code}>{x.coa_code} {x.coa_name}: ชีต {fmt(x.sheetAmount)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.sheetExcluded.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                  <p className="font-medium text-neutral-800">แถวที่สูตรรวมของชีตข้ามไป — บันทึกให้, ยอดชีตไม่รวม</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                    {preview.sheetExcluded.map((x) => (
                      <li key={x.row}>แถว {x.row} {x.name}: {fmt(x.amount)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {!applyEnabled && preview.blocks.length > 0 && (
              <p className="text-sm text-red-700">ยังบันทึกไม่ได้ — ดูข้อความด้านบน</p>
            )}
            <button
              type="button"
              onClick={handleApply}
              disabled={!applyEnabled}
              className="rounded-md bg-brand-green px-5 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
            >
              {isPending ? "กำลังบันทึก..." : `ยืนยันบันทึกเดือน ${thaiMonth(preview.yearMonth)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
