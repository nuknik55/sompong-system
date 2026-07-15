"use client";

import { useState, useTransition } from "react";
import {
  applyPosSalesImport,
  previewPosSalesImport,
  upsertPosSalesAlias,
  type SalesImportPreview,
} from "@/app/owner/sales-import-actions";
import { unstable_rethrow } from "next/navigation";

function formatNum(n: number) {
  return n.toLocaleString("th-TH");
}

export function PosSalesImport() {
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [mergedNames, setMergedNames] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [mergeDivisor, setMergeDivisor] = useState<Record<string, string>>({});
  const [qtyBump, setQtyBump] = useState<Record<string, number>>({});
  const [qtyDivisor, setQtyDivisor] = useState<Record<string, number>>({});
  const [rowDivisorInput, setRowDivisorInput] = useState<Record<string, string>>({});

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDoneCount(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("file", file);
        const result = await previewPosSalesImport(formData);
        setPreview(result);
        setChecked(Object.fromEntries(result.matched.map((r) => [r.menuId, true])));
        setMergedNames(new Set());
        setQtyBump({});
        setQtyDivisor({});
        setRowDivisorInput({});
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
        setPreview(null);
      }
    });
  }

  function mergeUnmatched(productName: string, qtySold: number) {
    const targetMenuId = mergeTarget[productName];
    if (!targetMenuId) return;
    const divisor = Number(mergeDivisor[productName]) || 1;
    setError(null);
    startTransition(async () => {
      try {
        // Saved permanently — every future import will route this product
        // name into the chosen menu automatically, no need to redo this.
        await upsertPosSalesAlias(productName, targetMenuId, divisor);
        setQtyBump((prev) => ({ ...prev, [targetMenuId]: (prev[targetMenuId] ?? 0) + qtySold / divisor }));
        setMergedNames((prev) => new Set(prev).add(productName));
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ผูกเข้าเมนูไม่สำเร็จ");
      }
    });
  }

  function divideRow(menuName: string, menuId: string) {
    const divisor = Number(rowDivisorInput[menuId]);
    if (!divisor) return;
    setError(null);
    startTransition(async () => {
      try {
        // Saved permanently as an alias on the menu's own name, so future
        // imports of this exact product apply the same divisor automatically.
        await upsertPosSalesAlias(menuName, menuId, divisor);
        setQtyDivisor((prev) => ({ ...prev, [menuId]: divisor }));
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function finalQtyFor(r: { menuId: string; newQty: number }): number {
    const divided = r.newQty / (qtyDivisor[r.menuId] ?? 1);
    return Math.round((divided + (qtyBump[r.menuId] ?? 0)) * 100) / 100;
  }

  function confirmApply() {
    if (!preview) return;
    const updates = preview.matched
      .filter((r) => checked[r.menuId])
      .map((r) => ({ menuId: r.menuId, newQty: finalQtyFor(r) }));
    if (updates.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const n = await applyPosSalesImport(updates);
        setDoneCount(n);
        setPreview(null);
        window.location.reload();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "อัปเดตยอดขายไม่สำเร็จ");
      }
    });
  }

  const checkedCount = preview ? preview.matched.filter((r) => checked[r.menuId]).length : 0;
  const sortedMenuOptions = preview ? [...preview.matched].sort((a, b) => a.name.localeCompare(b.name, "th")) : [];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
      >
        นำเข้ายอดขายจาก POS
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="text-sm">
          <p className="mb-2 font-medium text-neutral-700">นำเข้ายอดขาย (จำนวนขาย) จากรายงาน POS</p>
          <p className="mb-3 text-neutral-500">
            ไฟล์ &quot;รายงานการขายตามสินค้า&quot; จาก POS เลือกช่วงวันที่ตามที่ต้องการ (เช่น 2 เดือนล่าสุด หรือตั้งแต่ต้นปี) แล้ว Export
            to Excel — ยอดขายจะถูกใช้แทนค่าเดิมทั้งหมดสำหรับเมนูที่พบในไฟล์ (เมนูที่ไม่อยู่ในไฟล์จะไม่ถูกแก้)
          </p>
          <p className="mb-3 text-xs text-neutral-400">
            ถ้าชื่อสินค้าใน POS ไม่ตรงกับเมนูเลย (อยู่ในรายการ &quot;ไม่พบในระบบ&quot; ด้านล่าง เช่น ขายตามน้ำหนักเป็นขีด) ใช้ปุ่ม
            &quot;ผูกเข้าเมนู&quot; เพื่อรวมยอดเข้ากับเมนูที่มีอยู่ — ผูกครั้งเดียว ครั้งต่อไปนำเข้าใหม่จะรวมให้อัตโนมัติเลย
          </p>
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            onChange={handleFile}
            disabled={isPending}
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 underline hover:text-neutral-800">
          ปิด
        </button>
      </div>

      {isPending && !preview && <p className="text-sm text-neutral-500">กำลังอ่านไฟล์...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {doneCount != null && <p className="text-sm text-green-700">อัปเดตยอดขายสำเร็จ {doneCount} เมนู</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-600">
              พบเมนูตรงกัน {preview.matched.length} รายการ (เลือกไว้ {checkedCount}) — ไม่พบในระบบ {preview.unmatched.length} รายการ
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChecked(Object.fromEntries(preview.matched.map((r) => [r.menuId, true])))}
                className="text-xs text-neutral-500 underline hover:text-neutral-800"
              >
                เลือกทั้งหมด
              </button>
              <button type="button" onClick={() => setChecked({})} className="text-xs text-neutral-500 underline hover:text-neutral-800">
                ไม่เลือกเลย
              </button>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-50">
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2">เมนู</th>
                  <th className="px-2 py-2 text-right">ยอดขายเดิม</th>
                  <th className="px-2 py-2 text-right">ยอดขายใหม่</th>
                  <th className="px-2 py-2 text-right">ยอดเงิน (สุทธิ)</th>
                </tr>
              </thead>
              <tbody>
                {preview.matched.map((r) => {
                  const finalQty = finalQtyFor(r);
                  const adjusted = !!qtyBump[r.menuId] || !!qtyDivisor[r.menuId];
                  return (
                    <tr key={r.menuId} className="border-b border-neutral-100 last:border-0">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!checked[r.menuId]}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [r.menuId]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{formatNum(r.oldQty)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className={`tabular-nums ${adjusted ? "font-medium text-amber-700" : "font-medium"}`}>
                            {formatNum(finalQty)}
                          </span>
                          {qtyDivisor[r.menuId] ? (
                            <span className="text-xs text-green-700">(÷{qtyDivisor[r.menuId]} ✓)</span>
                          ) : (
                            <>
                              <span className="text-xs text-neutral-400">÷</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="1"
                                value={rowDivisorInput[r.menuId] ?? ""}
                                onChange={(e) =>
                                  setRowDivisorInput((prev) => ({ ...prev, [r.menuId]: e.target.value.replace(/[^0-9.]/g, "") }))
                                }
                                className="w-10 rounded border border-neutral-300 px-1 py-0.5 text-center text-xs"
                              />
                              <button
                                type="button"
                                disabled={!rowDivisorInput[r.menuId] || isPending}
                                onClick={() => divideRow(r.name, r.menuId)}
                                title="หารยอดนี้ถาวร (เช่น POS นับเป็นขีดแต่จริงคือเศษส่วนของจาน) — บันทึกไว้ใช้ครั้งหน้าด้วย"
                                className="rounded border border-neutral-300 px-1 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                              >
                                หาร
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{formatNum(r.netRevenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.unmatched.length > 0 && (
            <details className="rounded-lg border border-neutral-200 bg-white p-3 text-sm" open>
              <summary className="cursor-pointer text-neutral-600">
                ไม่พบเมนู {preview.unmatched.length} รายการในระบบ (ชื่อไม่ตรงกัน หรือยังไม่เคยเพิ่ม) — ผูกเข้ากับเมนูที่มีอยู่ได้
              </summary>
              <ul className="mt-2 max-h-96 space-y-1.5 overflow-y-auto">
                {preview.unmatched.map((u) => {
                  const merged = mergedNames.has(u.productName);
                  return (
                    <li
                      key={u.productName}
                      className={`flex flex-wrap items-center gap-1.5 border-b border-neutral-100 pb-1.5 text-sm last:border-0 ${
                        merged ? "opacity-40" : ""
                      }`}
                    >
                      <span className="text-neutral-600">
                        {u.productName} — ขาย {formatNum(u.qtySold)}
                      </span>
                      {merged ? (
                        <span className="text-xs text-green-700">✓ ผูกแล้ว (จำไว้ใช้ครั้งหน้าด้วย)</span>
                      ) : (
                        <>
                          <select
                            value={mergeTarget[u.productName] ?? ""}
                            onChange={(e) => setMergeTarget((prev) => ({ ...prev, [u.productName]: e.target.value }))}
                            className="rounded border border-neutral-300 px-1.5 py-1 text-xs"
                          >
                            <option value="">เลือกเมนูปลายทาง...</option>
                            {sortedMenuOptions.map((m) => (
                              <option key={m.menuId} value={m.menuId}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-neutral-400">÷</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="1"
                            value={mergeDivisor[u.productName] ?? ""}
                            onChange={(e) =>
                              setMergeDivisor((prev) => ({ ...prev, [u.productName]: e.target.value.replace(/[^0-9.]/g, "") }))
                            }
                            className="w-12 rounded border border-neutral-300 px-1.5 py-1 text-center text-xs"
                          />
                          <button
                            type="button"
                            disabled={!mergeTarget[u.productName] || isPending}
                            onClick={() => mergeUnmatched(u.productName, u.qtySold)}
                            className="rounded border border-neutral-300 px-1.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                          >
                            ผูกเข้าเมนู
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <button
            type="button"
            disabled={isPending || checkedCount === 0}
            onClick={confirmApply}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "กำลังอัปเดต..." : `ยืนยันอัปเดตยอดขาย ${checkedCount} เมนู`}
          </button>
        </div>
      )}
    </div>
  );
}
