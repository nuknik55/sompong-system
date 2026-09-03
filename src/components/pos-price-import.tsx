"use client";

import { useState, useTransition, useEffect } from "react";
import {
  applyPosImport,
  ingestPosDeliveries,
  buildPosImportPreview,
  getPosPriceAliases,
  addPosPriceAlias,
  deletePosPriceAlias,
  type PosImportPreview,
  type PosImportRow,
  type PriceAliasRow,
} from "@/app/owner/ingredients/pos-import-actions";

/** Rows per request. ~180 KB of JSON; a full history is ~12 sequential calls. */
const CHUNK_SIZE = 2000;

/** 25690830 -> "2026-08-30". The parser's key is Buddhist-era yyyymmdd. */
function dateKeyToIso(dateKey: number): string {
  const y = Math.floor(dateKey / 10000) - 543;
  const m = Math.floor((dateKey % 10000) / 100);
  const d = dateKey % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const RULE_LABEL: Record<string, string> = {
  "dominant-vendor": "ราคากลาง (ผู้ขายหลัก)",
  "all-vendor": "ราคากลาง (ทุกผู้ขาย)",
  "latest-delivery": "ล่าสุด (ข้อมูลน้อย)",
};

function formatBaht(n: number | null) {
  if (n == null) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PosPriceImport({ ingredientOptions }: { ingredientOptions: { id: string; name: string }[] }) {
  const [preview, setPreview] = useState<PosImportPreview | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  /** Rows sent / total, while uploading. null when idle. */
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  /** Deliveries newly stored by the last upload — rows actually inserted, not sent. */
  const [storedCount, setStoredCount] = useState<number | null>(null);

  // Alias state
  /** Per-row yield_qty entry, for rows whose unit changed or was never set. */
  const [yieldInput, setYieldInput] = useState<Record<string, string>>({});
  /** Rows whose unit change the user has explicitly confirmed. */
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [aliases, setAliases] = useState<PriceAliasRow[]>([]);
  const [showAliases, setShowAliases] = useState(false);
  const [newPosName, setNewPosName] = useState("");
  const [newIngredientId, setNewIngredientId] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasIsPending, startAliasTransition] = useTransition();

  useEffect(() => {
    getPosPriceAliases().then(setAliases).catch(() => {});
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDoneCount(null);
    startTransition(async () => {
      try {
        // Parse in the browser. Posting the .xls hit Vercel's 4.5 MB request
        // limit, which rejects before the function runs and surfaces as an
        // unparseable "unexpected response". Parsed rows are ~38.5% of the
        // file's size and go up in chunks, so the ceiling is gone.
        //
        // Dynamic import so SheetJS (~800 KB) is fetched only when a file is
        // actually chosen, not by every page that ships this bundle.
        const { parsePosReceiptDeliveries } = await import("@/lib/pos-parse");
        const materials = parsePosReceiptDeliveries(await file.arrayBuffer());

        const rows = materials.flatMap((m) =>
          m.deliveries.map((d) => ({
            materialCode: m.materialCode,
            materialName: m.materialName,
            documentNumber: d.documentNumber,
            documentDate: dateKeyToIso(d.dateKey),
            vendorName: d.vendorName,
            unitName: d.unitName,
            qty: d.qty,
            totalCostIncVat: d.totalCostIncVat,
            totalCostExcVat: d.totalCostExcVat,
            datePrecision: d.datePrecision,
          })),
        );
        if (rows.length === 0) {
          throw new Error(
            'อ่านไฟล์ไม่พบรายการรับสินค้าเลย ตรวจสอบว่าเป็นไฟล์รายงาน "ใบรับสินค้าตรง" ที่ export มาจาก POS หรือไม่',
          );
        }

        // Sequential: the server bounds rows per batch, and concurrent chunks
        // would race that check.
        const batchId = crypto.randomUUID();
        setProgress({ sent: 0, total: rows.length });
        let stored = 0;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const res = await ingestPosDeliveries(batchId, rows.slice(i, i + CHUNK_SIZE), file.name);
          stored += res.inserted;
          setProgress({ sent: Math.min(i + CHUNK_SIZE, rows.length), total: rows.length });
        }
        setStoredCount(stored);

        // The preview reads the delivery WINDOW, not this upload. Re-importing
        // a file whose rows are already stored is a legitimate no-op that
        // still produces a full preview.
        const result = await buildPosImportPreview();
        setPreview(result);
        // A "changed"-unit row starts unchecked and cannot be checked until
        // resolved; mixed-unit deliveries stay unchecked as before.
        setChecked(
          Object.fromEntries(
            result.matched.map((r) => [
              r.ingredientId,
              r.unitState !== "changed" && !r.mixedUnits && !r.unitRedefinitionSuspected,
            ]),
          ),
        );
        // Seed each resolvable row's yield input, so the common case is
        // "confirm" rather than "work it out".
        //
        // "changed": the stored yield describes the OLD unit and is therefore
        // wrong by definition, so the proposal wins.
        // "unset": only the label was missing — an existing yield_qty may be a
        // real, trimmed figure someone measured, and a pack-size proposal must
        // not silently replace it. Existing value wins; the proposal only
        // fills a genuine blank.
        setYieldInput(
          Object.fromEntries(
            result.matched
              .filter((r) => r.unitState === "changed" || r.unitState === "unset")
              .map((r) => {
                const preferred =
                  r.unitState === "changed"
                    ? r.proposedYieldQty
                    : r.currentYieldQty ?? r.proposedYieldQty;
                return [r.ingredientId, preferred != null ? String(preferred) : ""];
              }),
          ),
        );
        setResolved({});
      } catch (err) {
        setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
        setPreview(null);
      } finally {
        setProgress(null);
      }
    });
  }

  function confirmApply() {
    if (!preview) return;
    const updates = preview.matched
      .filter((r) => checked[r.ingredientId])
      .map((r) => {
        // Carry the unit through whenever the price is not already
        // denominated in the stored unit — the whole point of this step. The
        // server rejects a unit without a yield, so both travel together.
        if (r.unitState === "changed" || (r.unitState === "unset" && yieldInput[r.ingredientId]?.trim())) {
          const raw = yieldInput[r.ingredientId]?.trim();
          const parsed = raw ? Number(raw) : NaN;
          return {
            ingredientId: r.ingredientId,
            newCost: r.newCost,
            newUnitLabel: r.newUnit,
            newYieldQty: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
          };
        }
        return { ingredientId: r.ingredientId, newCost: r.newCost };
      });
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

  function handleAddAlias() {
    setAliasError(null);
    startAliasTransition(async () => {
      try {
        await addPosPriceAlias(newPosName, newIngredientId);
        const updated = await getPosPriceAliases();
        setAliases(updated);
        setNewPosName("");
        setNewIngredientId("");
      } catch (err) {
        setAliasError(err instanceof Error ? err.message : "เพิ่ม alias ไม่สำเร็จ");
      }
    });
  }

  function handleDeleteAlias(id: string) {
    startAliasTransition(async () => {
      await deletePosPriceAlias(id);
      setAliases((prev) => prev.filter((a) => a.id !== id));
    });
  }

  const checkedCount = preview ? preview.matched.filter((r) => checked[r.ingredientId]).length : 0;

  // Headline numbers for the review. The point is that a reviewer should not
  // have to assume every price is now median-backed — a fifth are not.
  const summary = {
    unchanged: preview?.matched.filter((r) => r.pctChange != null && Math.abs(r.pctChange) < 0.5).length ?? 0,
    bigMove: preview?.matched.filter((r) => r.pctChange != null && Math.abs(r.pctChange) > 20).length ?? 0,
    thinData: preview?.matched.filter((r) => r.rule === "latest-delivery").length ?? 0,
    firstPrice: preview?.matched.filter((r) => r.oldCost == null).length ?? 0,
    blocked:
      preview?.matched.filter((r) => r.unitState === "changed" || r.unitRedefinitionSuspected).length ?? 0,
  };

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
        <p className="mb-3 text-xs text-neutral-400">
          เมื่ออัปโหลด ระบบจะ<b>บันทึกประวัติการรับของจากไฟล์นี้ไว้ทันที</b> (ก่อนกดยืนยันราคา) เพราะรายงาน POS ย้อนหลังได้จำกัด —
          ข้อมูลที่ไม่เก็บตอนนี้จะหายไปถาวร การกดยืนยันด้านล่างมีผลเฉพาะ<b>การอัปเดตราคาวัตถุดิบ</b>เท่านั้น
        </p>
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          onChange={handleFile}
          disabled={isPending}
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {progress && (
          <p className="mt-2 text-xs text-neutral-500">
            กำลังส่งข้อมูล {progress.sent.toLocaleString("th-TH")} / {progress.total.toLocaleString("th-TH")} แถว…
          </p>
        )}
        {storedCount != null && !progress && (
          <p className="mt-2 text-xs text-neutral-500">
            บันทึกประวัติการรับของใหม่ {storedCount.toLocaleString("th-TH")} รายการ
            {storedCount === 0 && " (ข้อมูลในไฟล์นี้มีอยู่แล้วทั้งหมด)"}
          </p>
        )}
      </div>

      {/* Alias management */}
      <div className="rounded-lg border border-neutral-200 bg-white text-sm">
        <button
          type="button"
          onClick={() => setShowAliases((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <span>ตั้งค่า alias ราคา ({aliases.length})</span>
          <span className="text-neutral-400">{showAliases ? "▲" : "▼"}</span>
        </button>

        {showAliases && (
          <div className="border-t border-neutral-200 p-4 space-y-3">
            <p className="text-xs text-neutral-500">
              เมื่อ POS มีชื่อวัตถุดิบที่ระบุ → อัปเดตราคาให้วัตถุดิบในระบบที่กำหนดด้วย (ราคาเดียวกัน)
              <br />
              ตัวอย่าง: &quot;หัวกะทิ&quot; ใน POS → อัปเดตทั้ง &quot;หัวกะทิ&quot; และ &quot;หางกะทิ&quot; ในระบบ
            </p>

            {aliases.length > 0 && (
              <div className="rounded-md border border-neutral-200 divide-y divide-neutral-100">
                {aliases.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="font-medium text-neutral-700">{a.posIngredientName}</span>
                    <span className="text-neutral-400">→</span>
                    <span className="flex-1 text-neutral-600">{a.ingredientName}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteAlias(a.id)}
                      disabled={aliasIsPending}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      ลบ
                    </button>
                  </div>
                ))}
              </div>
            )}
            {aliases.length === 0 && <p className="text-xs text-neutral-400">ยังไม่มี alias</p>}

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="ชื่อใน POS (เช่น หัวกะทิ)"
                value={newPosName}
                onChange={(e) => setNewPosName(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm flex-1 min-w-40"
              />
              <select
                value={newIngredientId}
                onChange={(e) => setNewIngredientId(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm flex-1 min-w-40"
              >
                <option value="">— เลือกวัตถุดิบในระบบ —</option>
                {ingredientOptions.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddAlias}
                disabled={aliasIsPending || !newPosName.trim() || !newIngredientId}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                เพิ่ม
              </button>
            </div>
            {aliasError && <p className="text-xs text-red-600">{aliasError}</p>}
          </div>
        )}
      </div>

      {isPending && !preview && <p className="text-sm text-neutral-500">กำลังอ่านไฟล์...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {doneCount != null && <p className="text-sm text-green-700">อัปเดตราคาสำเร็จ {doneCount} รายการ</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-600">
              <p>
                พบวัตถุดิบตรงกัน {preview.matched.length} รายการ (เลือกไว้ {checkedCount}) — ไม่พบในระบบ{" "}
                {preview.unmatched.length} รายการ
              </p>
              {/* Say what the run actually does, including what it does NOT do. */}
              <p className="mt-1 text-xs text-neutral-500">
                ราคาไม่เปลี่ยน {summary.unchanged} รายการ · เปลี่ยนเกิน 20% {summary.bigMove} รายการ ·{" "}
                คิดจากการรับของครั้งเดียว {summary.thinData} รายการ
                {summary.firstPrice > 0 && ` · ตั้งราคาครั้งแรก ${summary.firstPrice} รายการ (เมนูที่ใช้จะเปลี่ยนจาก "ไม่ทราบต้นทุน" เป็นต้นทุนจริง)`}
                {summary.blocked > 0 && ` · ต้องแก้หน่วยก่อน ${summary.blocked} รายการ`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                // Never bulk-select an unresolved unit change — that would
                // defeat the block in one click, which is how the old
                // advisory warning ended up ignored.
                onClick={() =>
                  setChecked(
                    Object.fromEntries(
                      preview.matched.map((r) => [
                        r.ingredientId,
                        !((r.unitState === "changed" || r.unitRedefinitionSuspected) && !resolved[r.ingredientId]),
                      ]),
                    ),
                  )
                }
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
                  <th className="px-2 py-2">ที่มาของราคา</th>
                  <th className="px-2 py-2">วันที่ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {preview.matched.map((r: PosImportRow) => {
                  const bigChange = r.pctChange != null && Math.abs(r.pctChange) >= 30;
                  // A suspected unit redefinition blocks exactly like a changed
                  // unit: same problem (price and unit out of step), same fix
                  // (price + unit + yield together), so it must not be a checkbox.
                  const isBlocked =
                    (r.unitState === "changed" || r.unitRedefinitionSuspected) && !resolved[r.ingredientId];
                  return (
                    <>
                    <tr
                      key={r.ingredientId}
                      className={`border-b border-neutral-100 last:border-0 ${isBlocked ? "bg-red-50" : r.mixedUnits ? "bg-orange-50" : bigChange ? "bg-amber-50" : r.aliasSource ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={isBlocked}
                          title={isBlocked ? "ต้องยืนยันหน่วยและ yield ก่อน" : undefined}
                          checked={!!checked[r.ingredientId]}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [r.ingredientId]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.name}
                        {r.aliasSource && (
                          <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-xs text-blue-700">
                            alias จาก {r.aliasSource}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">{formatBaht(r.oldCost)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatBaht(r.newCost)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${bigChange ? "font-medium text-amber-700" : "text-neutral-500"}`}>
                        {r.pctChange != null ? `${r.pctChange > 0 ? "+" : ""}${r.pctChange.toFixed(0)}%` : "ใหม่"}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">
                        {RULE_LABEL[r.rule] ?? r.rule}
                        <span className="ml-1 text-neutral-400">
                          ({r.poolSize === 1 ? "ครั้งเดียว" : `${r.poolSize} ครั้ง`})
                        </span>
                        {r.vendorUnsettled && (
                          <span className="ml-1 text-amber-700" title="ผู้ขายหลักยังไม่ชัดเจน — อาจสลับในรอบถัดไป">⚠</span>
                        )}
                        {r.monthPrecisionSeen > 0 && (
                          <span
                            className="ml-1 text-sky-700"
                            title={`${r.monthPrecisionSeen} รายการทราบแค่เดือน (วันที่เป็นค่าประมาณ) — นับเข้าเฉพาะเดือนที่อยู่ในช่วงทั้งเดือน`}
                          >
                            ~{r.monthPrecisionSeen}
                          </span>
                        )}
                        {r.outliersDropped > 0 && (
                          <span className="ml-1 text-neutral-400" title={`ตัดรายการผิดปกติออก ${r.outliersDropped} รายการ`}>
                            ↯{r.outliersDropped}
                          </span>
                        )}
                        {/* Volume share, not delivery-count share. Spelling it out
                            matters: the number used to mean "% of deliveries" and
                            now means "% of the quantity bought", and a percentage
                            that changes meaning without saying so is worse than
                            no percentage. */}
                        <div className="text-[10px] text-neutral-400">
                          {r.vendorName || "(ไม่ระบุผู้ขาย)"}
                          {r.vendorShare > 0 && ` · ส่งของ ${Math.round(r.vendorShare * 100)}% ของปริมาณ`}
                        </div>
                      </td>
                      <td className={`px-2 py-1.5 ${r.unitState === "changed" ? "font-medium text-red-700" : "text-neutral-500"}`}>
                        {r.oldUnit ?? "—"} → {r.newUnit || "—"}
                        {r.unitState === "changed" && " ⚠"}
                        {r.unitRedefinitionSuspected && (
                          <div className="text-[10px] font-medium text-red-700">
                            หน่วยเดิมกับ POS ชื่อเหมือนกัน แต่ราคาต่างกัน {r.suspectedPackCount}× พอดี — น่าจะเป็นคนละขนาดบรรจุ ต้องแก้ราคา+หน่วย+ปริมาณพร้อมกัน
                          </div>
                        )}
                        {r.mixedUnits && <span className="ml-1 text-orange-700" title="วันที่ล่าสุดมีหลายหน่วย">±</span>}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">{r.latestDateLabel}</td>
                    </tr>
                    {r.unitState === "changed" && (
                      <tr key={`${r.ingredientId}-resolve`} className={isBlocked ? "bg-red-50" : "bg-green-50"}>
                        <td />
                        <td colSpan={6} className="px-2 pb-2 text-xs">
                          <div className="rounded border border-neutral-200 bg-white p-2">
                            <p className="mb-1.5 text-neutral-700">
                              หน่วยเปลี่ยนจาก <b>{r.oldUnit}</b> เป็น <b>{r.newUnit}</b> — ราคาใหม่คิดต่อ{" "}
                              <b>{r.newUnit}</b> แต่ค่า yield เดิม ({r.currentYieldQty ?? "ไม่ได้ตั้ง"}) อ้างอิงหน่วยเก่า
                              จึงต้องยืนยันพร้อมกัน
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-neutral-600">
                                จำนวนตัดแต่ง (yield) ต่อ {r.currentReceiveQty} {r.newUnit}
                                {r.usageUnit ? ` เป็น ${r.usageUnit}` : ""}:
                              </label>
                              <input
                                type="number"
                                className="w-28 rounded border border-neutral-300 px-2 py-1"
                                value={yieldInput[r.ingredientId] ?? ""}
                                placeholder={r.currentYieldQty != null ? String(r.currentYieldQty) : "—"}
                                onChange={(e) => setYieldInput((p) => ({ ...p, [r.ingredientId]: e.target.value }))}
                              />
                              <button
                                type="button"
                                className="rounded bg-neutral-900 px-2.5 py-1 font-medium text-white hover:bg-neutral-700"
                                onClick={() => {
                                  setResolved((p) => ({ ...p, [r.ingredientId]: true }));
                                  setChecked((p) => ({ ...p, [r.ingredientId]: true }));
                                }}
                              >
                                {resolved[r.ingredientId] ? "ยืนยันแล้ว ✓" : "ยืนยันหน่วยและ yield"}
                              </button>
                            </div>
                            {r.proposedYieldBasis && (
                              <p className="mt-1 text-neutral-500">
                                เสนอจากชื่อหน่วย: {r.proposedYieldBasis} — ตรวจสอบก่อนยืนยัน
                                (ของที่ต้องตัดแต่งจะได้จริงน้อยกว่านี้)
                              </p>
                            )}
                            {!r.proposedYieldBasis && (
                              <p className="mt-1 text-neutral-500">
                                อ่านขนาดบรรจุจากชื่อหน่วยไม่ได้ — กรุณากรอกเอง
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
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
