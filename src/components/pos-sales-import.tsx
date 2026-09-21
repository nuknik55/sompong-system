"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  applyPosSalesImport,
  createPosSalesAlias,
  previewPosSalesImport,
  type SalesImportPreview,
  type SalesImportRow,
} from "@/app/owner/sales-import-actions";
import { divisibleSource, sourcesQty, validDivisor, withSessionChanges, type SalesSource } from "@/lib/pos-sales-divisor";
import { unstable_rethrow, useRouter } from "next/navigation";

function formatNum(n: number) {
  return n.toLocaleString("th-TH");
}

/** A divisor, to the four decimals pos_sales_aliases stores. */
function formatDivisor(n: number) {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

export function PosSalesImport() {
  const router = useRouter();
  // The File lives in state from selection; reading is a separate, explicit
  // step. Same shape as the accounting imports (import-state.ts): a new
  // selection drops everything derived from the old file, and the DOM input
  // is only ever how a file gets into state, never read back. Nik asked for
  // select-then-อ่านไฟล์ on every upload; this page used to read on select.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [mergedNames, setMergedNames] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [mergeDivisor, setMergeDivisor] = useState<Record<string, string>>({});
  // This session's changes, per menu row: the divisor just saved for the
  // row's one unsaved POS name (หาร), and POS names just tied to it
  // (ผูกเข้าเมนู). Every figure is the per-source sum — see pos-sales-divisor.ts.
  const [divided, setDivided] = useState<Record<string, number>>({});
  const [mergedInto, setMergedInto] = useState<Record<string, SalesSource[]>>({});
  const [rowDivisorInput, setRowDivisorInput] = useState<Record<string, string>>({});
  // Set when saving a divisor fails: the divisor may exist after all (a
  // lost response, another tab), so this preview's figures may be wrong and
  // ยืนยัน waits for อ่านไฟล์, which re-reads every divisor.
  const [stale, setStale] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    // A different file invalidates the previous preview and its per-row
    // adjustments; nothing is read until อ่านไฟล์.
    setFile(e.target.files?.[0] ?? null);
    setPreview(null);
    setError(null);
    setDoneCount(null);
  }

  function handleRead() {
    if (!file) return;
    const reading = file;
    setError(null);
    setDoneCount(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("file", reading);
        const res = await previewPosSalesImport(formData);
        if (res.status === "error") { setError(res.message); setPreview(null); return; }
        const result = res.preview;
        setPreview(result);
        setChecked(Object.fromEntries(result.matched.map((r) => [r.menuId, true])));
        setMergedNames(new Set());
        setDivided({});
        setMergedInto({});
        setRowDivisorInput({});
        setMergeTarget({});
        setMergeDivisor({});
        setStale(false);
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
    // Only a row of this preview: its share is added to that row, and a menu
    // with no row here would take the name for good and show it nowhere.
    if (!preview?.matched.some((r) => r.menuId === targetMenuId)) {
      setError("เมนูปลายทางไม่อยู่ในไฟล์นี้ — เลือกใหม่");
      return;
    }
    // A blank box means ÷1: the name is the same dish, counted the same way.
    const typed = mergeDivisor[productName]?.trim() ? Number(mergeDivisor[productName]) : 1;
    const divisor = validDivisor(typed);
    if (divisor == null) { setError("ตัวหารต้องอยู่ระหว่าง 0.0001 ถึง 1,000"); return; }
    setError(null);
    startTransition(async () => {
      try {
        // Saved permanently — every future import will route this product
        // name into the chosen menu automatically, no need to redo this.
        const result = await createPosSalesAlias(productName, targetMenuId, divisor);
        if (result.status === "error") { setError(result.message); setStale(true); return; }
        setMergedInto((prev) => ({
          ...prev,
          [targetMenuId]: [...(prev[targetMenuId] ?? []), { productName: productName.trim(), qtySold, divisor, saved: true }],
        }));
        setMergedNames((prev) => new Set(prev).add(productName));
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ผูกเข้าเมนูไม่สำเร็จ");
        setStale(true);
      }
    });
  }

  function sourcesFor(r: SalesImportRow): SalesSource[] {
    return withSessionChanges(r.sources, divided[r.menuId], mergedInto[r.menuId]);
  }

  function divideRow(r: SalesImportRow) {
    // Only a POS name with NO divisor may be divided, and only that name's
    // count: dividing the row's total also divided kilos the other names had
    // already converted, and the button came back on every import.
    const divisible = divisibleSource(sourcesFor(r));
    if (!divisible) return;
    const divisor = validDivisor(Number(rowDivisorInput[r.menuId]));
    if (divisor == null) { setError("ตัวหารต้องอยู่ระหว่าง 0.0001 ถึง 1,000"); return; }
    setError(null);
    startTransition(async () => {
      try {
        // Saved permanently for this POS name, so every later import divides
        // it the same way — and shows the divisor instead of this box.
        const result = await createPosSalesAlias(divisible.productName, r.menuId, divisor);
        if (result.status === "error") { setError(result.message); setStale(true); return; }
        setDivided((prev) => ({ ...prev, [r.menuId]: divisor }));
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
        setStale(true);
      }
    });
  }

  function finalQtyFor(r: SalesImportRow): number {
    return sourcesQty(sourcesFor(r));
  }

  function confirmApply() {
    if (!preview) return;
    const updates = preview.matched
      .filter((r) => checked[r.menuId])
      .map((r) => ({ menuId: r.menuId, newQty: finalQtyFor(r) }));
    if (updates.length === 0) return;
    // Every POS row of the file as read — matched and not — so the server can
    // route them again against the divisors as they are at this moment.
    const posRows = [
      ...preview.matched.flatMap((r) => r.sources.map((s) => ({ productName: s.productName, qtySold: s.qtySold }))),
      ...preview.unmatched.map((u) => ({ productName: u.productName, qtySold: u.qtySold })),
    ];
    setError(null);
    startTransition(async () => {
      try {
        const result = await applyPosSalesImport(updates, preview.dateFrom, preview.dateTo, posRows);
        if (result.status === "error") { setError(result.message); setStale(true); return; }
        setDoneCount(result.count);
        setPreview(null);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "อัปเดตยอดขายไม่สำเร็จ");
      }
    });
  }

  const checkedCount = preview ? preview.matched.filter((r) => checked[r.menuId]).length : 0;
  const sortedMenuOptions = preview ? [...preview.matched].sort((a, b) => a.name.localeCompare(b.name, "th")) : [];

  // From the open panel the page opens in a new tab: leaving would drop a
  // file already read and every tick in its preview.
  const divisorsLink = (newTab: boolean) => (
    <Link
      href="/owner/pos-divisors"
      className="text-xs text-neutral-500 underline hover:text-neutral-800"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      ตัวหารยอดขาย POS
    </Link>
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
        >
          นำเข้ายอดขายจาก POS
        </button>
        {divisorsLink(preview != null)}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="text-sm">
          <p className="mb-2 font-medium text-neutral-700">นำเข้ายอดขาย (จำนวนขาย) จากรายงาน POS</p>
          <p className="mb-3 text-neutral-500">
            ไฟล์ &quot;รายงานการขายตามสินค้า&quot; จาก POS เลือกช่วงวันที่ตามที่ต้องการ (เช่น 2 เดือนล่าสุด หรือตั้งแต่ต้นปี) แล้ว Export
            to Excel — เมื่อยืนยัน ยอดขายเดิมของทุกเมนูจะถูกล้างเป็น 0 ก่อน แล้วใส่ยอดจากไฟล์นี้ เมนูที่ไม่อยู่ในไฟล์
            หรือไม่ได้เลือกไว้ จะมียอดขายเป็น 0
          </p>
          <p className="mb-3 text-xs text-neutral-400">
            ถ้าชื่อสินค้าใน POS ไม่ตรงกับเมนูเลย (อยู่ในรายการ &quot;ไม่พบในระบบ&quot; ด้านล่าง เช่น ขายตามน้ำหนักเป็นขีด) ใช้ปุ่ม
            &quot;ผูกเข้าเมนู&quot; เพื่อรวมยอดเข้ากับเมนูที่มีอยู่ และใส่ตัวหารในช่อง ÷ — POS นับเป็นขีด แต่เมนูในแอป 1 หน่วย = 1 กก.
            ให้ใส่ 10 (เว้นว่าง = ÷1) — ผูกครั้งเดียว ครั้งต่อไปนำเข้าใหม่จะรวมให้อัตโนมัติเลย ตัวหาร ÷10 ยังทำให้ใบฟังก์ชั่นงานจัดเลี้ยง
            พิมพ์เมนูนั้นเป็น กก. ทันที ทุกงาน
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={handleFile}
              disabled={isPending}
              className="block rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleRead}
              disabled={isPending || !file}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending && !preview ? "กำลังอ่าน..." : "อ่านไฟล์"}
            </button>
          </div>
          {file && (
            <p className="mt-1 text-xs text-neutral-500">
              ไฟล์ที่เลือก: <span className="font-medium text-neutral-700">{file.name}</span>
              {preview && " — อ่านแล้ว"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {divisorsLink(true)}
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 underline hover:text-neutral-800">
            ปิด
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {doneCount != null && <p className="text-sm text-green-700">อัปเดตยอดขายสำเร็จ {doneCount} เมนู</p>}

      {preview && (
        <div className="space-y-3">
          {preview.dateFrom && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              📅 {preview.dateTo && preview.dateTo !== preview.dateFrom ? "ช่วงวันที่" : "วันที่"}ในรายงาน:{" "}
              <strong>
                {preview.dateTo && preview.dateTo !== preview.dateFrom
                  ? `${preview.dateFrom} – ${preview.dateTo}`
                  : preview.dateFrom}
              </strong>
              <span className="ml-2 text-xs text-blue-600">(ยอดขายเดิมทั้งหมดจะถูกล้าง แล้วแทนด้วยข้อมูลใหม่จากไฟล์นี้)</span>
            </p>
          )}
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
                  const sources = sourcesFor(r);
                  const finalQty = finalQtyFor(r);
                  const divisible = divisibleSource(sources);
                  const adjusted = divided[r.menuId] != null || (mergedInto[r.menuId]?.length ?? 0) > 0;
                  // The divisors in effect, shown where the หาร box would be.
                  const inEffect = [...new Set(sources.filter((s) => s.saved).map((s) => s.divisor))];
                  // Which POS names fed the row and by what, whenever that is
                  // anything more than "this dish, counted as it stands".
                  const showSources = sources.length > 1 || sources.some((s) => s.saved && s.divisor !== 1);
                  return (
                    <tr key={r.menuId} className="border-b border-neutral-100 last:border-0">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!checked[r.menuId]}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [r.menuId]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.name}
                        {showSources && (
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {sources
                              .map((s) => `${s.productName} (${formatNum(s.qtySold)}) ${s.saved ? `÷${formatDivisor(s.divisor)}` : "ยังไม่มีตัวหาร"}`)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{formatNum(r.oldQty)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className={`tabular-nums ${adjusted ? "font-medium text-amber-700" : "font-medium"}`}>
                            {formatNum(finalQty)}
                          </span>
                          {!divisible ? (
                            <span className="text-xs text-green-700" title="ตั้งตัวหารไว้แล้ว — แก้หรือลบได้ที่หน้า ตัวหารยอดขาย POS">
                              ({inEffect.map((d) => `÷${formatDivisor(d)}`).join(" · ")} ✓)
                            </span>
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
                                onClick={() => divideRow(r)}
                                title={`หารยอดของ "${divisible.productName}" ใน POS ถาวร (เช่น POS นับเป็นขีด แต่ในแอป 1 หน่วย = 1 กก. ให้หาร 10) — บันทึกไว้ใช้ครั้งหน้าด้วย ÷10 ยังทำให้ใบฟังก์ชั่นงานจัดเลี้ยงพิมพ์เมนูนี้เป็น กก.`}
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

          <p className="text-xs text-neutral-500">
            เมื่อยืนยัน ยอดขายของทุกเมนูจะถูกล้างเป็น 0 ก่อน — เมนูที่ไม่ได้เลือก และเมนูที่ไม่อยู่ในไฟล์นี้ จะมียอดขายเป็น 0
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {stale && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              บันทึกตัวหารไม่สำเร็จ ตัวเลขในตารางนี้อาจไม่ตรงกับตัวหารที่บันทึกไว้จริง — กด &quot;อ่านไฟล์&quot; อีกครั้งก่อนยืนยัน
            </p>
          )}
          <button
            type="button"
            disabled={isPending || checkedCount === 0 || stale}
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
