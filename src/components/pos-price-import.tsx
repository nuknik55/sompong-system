"use client";

import { useState, useTransition } from "react";
import { applyPosImport, previewPosImport, type PosImportPreview, type PosImportRow } from "@/app/owner/ingredients/pos-import-actions";

function formatBaht(n: number | null) {
  if (n == null) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PosPriceImport() {
  const [preview, setPreview] = useState<PosImportPreview | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDoneCount(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("file", file);
        const result = await previewPosImport(formData);
        setPreview(result);
        // Default-uncheck unit mismatches: applying them would compute a
        // wrong cost-per-unit, since the purchase unit itself changed.
        setChecked(Object.fromEntries(result.matched.map((r) => [r.ingredientId, !r.unitMismatch])));
      } catch (err) {
        setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
        setPreview(null);
      }
    });
  }

  function confirmApply() {
    if (!preview) return;
    const updates = preview.matched.filter((r) => checked[r.ingredientId]).map((r) => ({ ingredientId: r.ingredientId, newCost: r.newCost }));
    if (updates.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const n = await applyPosImport(updates);
        setDoneCount(n);
        setPreview(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "อัปเดตราคาไม่สำเร็จ");
      }
    });
  }

  const checkedCount = preview ? preview.matched.filter((r) => checked[r.ingredientId]).length : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <p className="mb-2 font-medium text-neutral-700">นำเข้าราคาวัตถุดิบจากรายงาน POS</p>
        <p className="mb-3 text-neutral-500">
          ไฟล์ต้อง export จากระบบ POS ดังนี้: ประเภทรายงาน <b>&quot;ใบรับสินค้าตรง&quot;</b>, รูปแบบรายงาน{" "}
          <b>&quot;รายงานตามสินค้า&quot;</b>, ช่วงวันที่ <b>ย้อนหลัง 3 เดือน</b> จากวันนี้, เลือก All สำหรับกลุ่ม/หมวด/วัตถุดิบ/คลัง/ผู้จัดจำหน่าย
          ทั้งหมด, ลักษณะรายงานเลือก &quot;แสดงข้อมูลทั้งหมด&quot; แล้วกด &quot;Export to Excel&quot;
        </p>
        <p className="mb-3 text-xs text-neutral-400">
          ระบบจะใช้ราคาของ <b>วันที่รับล่าสุด</b> เท่านั้น (TotalCost(Inc.Vat) ÷ Qty ของวันนั้น) ไม่ใช่ค่าเฉลี่ยทั้ง 3 เดือน — วัตถุดิบที่ไม่มีการซื้อในช่วงนี้จะไม่ถูกแก้ไข (ใช้ราคาเดิม)
        </p>
        <p className="mb-3 text-xs text-amber-700">
          ถ้าหน่วยซื้อล่าสุดจาก POS ไม่ตรงกับหน่วยที่ตั้งไว้ในระบบ (เช่น เดิมซื้อเป็นกล่อง 4 แกลลอน แต่ล่าสุดซื้อทีละ 1 แกลลอน) ระบบจะ
          <b>ไม่ติ๊กเลือกให้อัตโนมัติ</b> เพราะคำนวณราคาต่อหน่วยผิดได้ — ให้ตรวจสอบ แก้หน่วยซื้อ/จำนวนตัดแต่งในหน้านี้ให้ตรงกับหน่วยใหม่ก่อน
          แล้วจึงนำเข้าราคาอีกครั้ง
        </p>
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          onChange={handleFile}
          disabled={isPending}
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {isPending && !preview && <p className="text-sm text-neutral-500">กำลังอ่านไฟล์...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {doneCount != null && <p className="text-sm text-green-700">อัปเดตราคาสำเร็จ {doneCount} รายการ</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-600">
              พบวัตถุดิบตรงกัน {preview.matched.length} รายการ (เลือกไว้ {checkedCount}) — ไม่พบในระบบ {preview.unmatched.length} รายการ
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChecked(Object.fromEntries(preview.matched.map((r) => [r.ingredientId, true])))}
                className="text-xs text-neutral-500 underline hover:text-neutral-800"
              >
                เลือกทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setChecked({})}
                className="text-xs text-neutral-500 underline hover:text-neutral-800"
              >
                ไม่เลือกเลย
              </button>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-50">
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2">ชื่อ</th>
                  <th className="px-2 py-2 text-right">ราคาเดิม</th>
                  <th className="px-2 py-2 text-right">ราคาใหม่</th>
                  <th className="px-2 py-2 text-right">เปลี่ยน</th>
                  <th className="px-2 py-2">หน่วย (เดิม → POS)</th>
                  <th className="px-2 py-2">วันที่ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {preview.matched.map((r: PosImportRow) => {
                  const bigChange = r.pctChange != null && Math.abs(r.pctChange) >= 30;
                  return (
                    <tr
                      key={r.ingredientId}
                      className={`border-b border-neutral-100 last:border-0 ${r.unitMismatch ? "bg-red-50" : bigChange ? "bg-amber-50" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!checked[r.ingredientId]}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [r.ingredientId]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{formatBaht(r.oldCost)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatBaht(r.newCost)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${bigChange ? "font-medium text-amber-700" : "text-neutral-500"}`}>
                        {r.pctChange != null ? `${r.pctChange > 0 ? "+" : ""}${r.pctChange.toFixed(0)}%` : "ใหม่"}
                      </td>
                      <td className={`px-2 py-1.5 ${r.unitMismatch ? "font-medium text-red-700" : "text-neutral-500"}`}>
                        {r.oldUnit ?? "-"} → {r.newUnit || "-"}
                        {r.unitMismatch && " ⚠"}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">{r.latestDateLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.unmatched.length > 0 && (
            <details className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer text-neutral-600">
                ไม่พบวัตถุดิบ {preview.unmatched.length} รายการในระบบ (ชื่อไม่ตรงกัน หรือยังไม่เคยเพิ่ม)
              </summary>
              <ul className="mt-2 list-inside list-disc text-neutral-500">
                {preview.unmatched.map((u) => (
                  <li key={u.materialCode}>
                    {u.materialName} ({u.materialCode})
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            disabled={isPending || checkedCount === 0}
            onClick={confirmApply}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "กำลังอัปเดต..." : `ยืนยันอัปเดตราคา ${checkedCount} รายการ`}
          </button>
        </div>
      )}
    </div>
  );
}
