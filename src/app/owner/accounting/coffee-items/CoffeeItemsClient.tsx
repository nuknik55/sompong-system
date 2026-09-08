"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewCoffeeClassification,
  saveCoffeeClassification,
  type CoffeeCandidate,
  type CoffeeClassificationPreview,
} from "./actions";

// `decided` is the whole point of this type.
//
// An item the POS files under ร้านกาแฟ arrives PRE-TICKED, because that is a
// good suggestion. A suggestion is not a decision. If saving wrote every
// pre-ticked row, an item nobody examined would become a confirmed
// classification — and the confirmation would then hide it from next month's
// "ใหม่" list, which is the one place it would otherwise have surfaced.
//
// So: only rows the user actually acted on are written. Everything else stays
// unreviewed and keeps showing up until someone looks at it.
type Draft = { isCoffee: boolean; sharePerUnit: string; decided: boolean };

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** What this item contributes to the coffee total under the current draft. */
function coffeeAmount(c: CoffeeCandidate, d: Draft): number {
  if (!d.isCoffee) return 0;
  const share = d.sharePerUnit.trim();
  if (share === "") return c.gross; // whole line
  const per = Number(share);
  return Number.isFinite(per) ? per * c.qty : 0;
}

export function CoffeeItemsClient({ initialCoffeeCount }: { initialCoffeeCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<CoffeeClassificationPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [target, setTarget] = useState("128625");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ written: number; skipped: number } | null>(null);

  // Product names the user actually interacted with in this session — a
  // checkbox toggled or a share amount edited. Keyed exactly as `drafts` is.
  //
  // Re-confirming a row you looked at IS a review event and earns a fresh
  // reviewed_at, even when the value ends up unchanged. Being auto-marked
  // decided at load time is not, and neither is bulk-accepting a suggestion.
  const [touched, setTouched] = useState<Set<string>>(new Set());

  function markTouched(productName: string) {
    setTouched((prev) => {
      const next = new Set(prev);
      next.add(productName);
      return next;
    });
    // Any edit invalidates the previous save result. Without this, the grey
    // "ไม่มีการเปลี่ยนแปลง — ไม่ได้บันทึกอะไร" notice would sit next to genuinely
    // unsaved work and claim the opposite of what is now true.
    setSaved(null);
  }

  function handleUpload(formData: FormData) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const p = await previewCoffeeClassification(formData);
        setPreview(p);
        setDrafts(
          Object.fromEntries(
            p.candidates.map((c) => [
              c.productName,
              {
                isCoffee: c.isCoffee,
                sharePerUnit: c.sharePerUnit == null ? "" : String(c.sharePerUnit),
                // Already in the table = already decided. Never seen = not,
                // however plausible its pre-tick.
                decided: c.reviewed,
              },
            ]),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
      }
    });
  }

  function handleSave() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveCoffeeClassification(
          preview.candidates
            .filter((c) => drafts[c.productName]?.decided)
            .map((c) => {
              const d = drafts[c.productName];
              const share = d.sharePerUnit.trim();
              return {
                productName: c.productName,
                isCoffee: d.isCoffee,
                sharePerUnit: d.isCoffee && share !== "" && Number.isFinite(Number(share)) ? Number(share) : null,
                touched: touched.has(c.productName),
              };
            }),
        );
        setSaved(result);

        // Clear the ใหม่ badge without re-parsing the file. Every decided item
        // now has a row — written this time, or already present and skipped —
        // so marking them reviewed is a statement of fact, not an optimism.
        // `preview` is client state derived from the upload, so router.refresh()
        // alone would never touch it and the badge would persist until re-upload.
        setPreview((p) => {
          if (!p) return p;
          const candidates = p.candidates.map((c) =>
            drafts[c.productName]?.decided ? { ...c, reviewed: true } : c,
          );
          return { ...p, candidates, unreviewedCount: candidates.filter((c) => !c.reviewed).length };
        });
        setTouched(new Set());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  // Counts DECIDED rows only, so the figure always equals what saving would
  // record. On a first run that starts at 0 and moves as decisions are made,
  // which is the honest reading — nothing is classified until someone says so.
  const runningTotal = useMemo(() => {
    if (!preview) return 0;
    return preview.candidates.reduce((s, c) => {
      const d = drafts[c.productName];
      return d?.decided ? s + coffeeAmount(c, d) : s;
    }, 0);
  }, [preview, drafts]);

  const undecidedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.candidates.filter((c) => !drafts[c.productName]?.decided).length;
  }, [preview, drafts]);

  const decidedCount = (preview?.candidates.length ?? 0) - undecidedCount;

  /**
   * Turn every outstanding suggestion into a decision, in one deliberate act.
   *
   * Bulk-accepting does NOT mark rows touched, so an unchanged existing row
   * keeps its reviewed_at. But rows with no stored row are written anyway —
   * they are new — which means one click can classify hundreds of items nobody
   * inspected, from a POS-category guess.
   *
   * That is the original problem arriving through a different door. The door is
   * meant to be there; what it must not be is quiet. So the confirmation names
   * the number of items this click would classify FOR THE FIRST TIME, and
   * counts only those — re-confirming rows that already have a decision is not
   * the risk and padding the number with them would blunt the warning.
   */
  function acceptAllSuggestions() {
    if (!preview) return;
    const firstTime = preview.candidates.filter(
      (c) => !c.reviewed && !drafts[c.productName]?.decided,
    ).length;

    if (firstTime > 0) {
      // The wording must match what the click actually does. This only marks
      // drafts as decided — nothing reaches the database until "บันทึก" is
      // pressed. Saying "saved immediately" would be the same claim-vs-effect
      // mismatch this screen exists to avoid, and worse in this direction: a
      // user who believes it already saved may never press save at all.
      const ok = window.confirm(
        `จะตั้งค่าสินค้า ${firstTime} รายการที่ยังไม่เคยตรวจ ` +
          `โดยใช้หมวดจาก POS เป็นตัวตั้ง (ร้านกาแฟ = ใช่, นอกนั้น = ไม่ใช่)\n\n` +
          `ยังไม่บันทึกลงระบบตอนนี้ — จะบันทึกเมื่อกดปุ่ม "บันทึก" ` +
          `หลังบันทึกแล้วรายการเหล่านี้จะไม่ขึ้นเป็น "ใหม่" อีก ` +
          `ถ้ามีรายการที่ POS จัดหมวดไว้ผิด จะไม่มีใครเห็นอีกจนกว่าจะมาแก้เอง\n\n` +
          `ยืนยันหรือไม่?`,
      );
      if (!ok) return;
    }

    // A stale "nothing was saved" notice sitting next to freshly-decided rows
    // reads as though this click did nothing.
    setSaved(null);

    setDrafts((p) => {
      const next = { ...p };
      for (const k of Object.keys(next)) next[k] = { ...next[k], decided: true };
      return next;
    });
  }

  const targetNum = Number(target) || 0;
  const gap = runningTotal - targetNum;
  const reconciled = Math.abs(gap) < 1;

  const visible = useMemo(() => {
    if (!preview) return [];
    return onlyUnreviewed ? preview.candidates.filter((c) => !c.reviewed) : preview.candidates;
  }, [preview, onlyUnreviewed]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">อัปโหลดไฟล์ยอดขายจาก POS</p>
          <p className="mt-1 text-xs text-neutral-500">
            ไฟล์ &quot;รายงานการขายตามสินค้า&quot; — ระบบจะแสดงสินค้าทุกตัวในไฟล์ ให้ติ๊กเฉพาะรายการที่เป็นของร้านกาแฟ
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            ปัจจุบันบันทึกไว้แล้ว {initialCoffeeCount} รายการเป็นของร้านกาแฟ
          </p>
        </div>
        <form action={handleUpload} className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            name="file"
            accept=".xls,.xlsx"
            required
            disabled={isPending}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "กำลังอ่าน..." : "อ่านไฟล์"}
          </button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {/* Three states, never a success tick on a write that did not happen.
            "บันทึกแล้ว 0 รายการ ✓" reads as either a bug or a lie depending on
            the reader, and it is the same apparent-success-with-no-effect shape
            this project keeps finding. */}
        {saved !== null &&
          (saved.written > 0 ? (
            <p className="text-sm text-green-700">
              บันทึกแล้ว {saved.written} รายการ ✓
              {saved.skipped > 0 && (
                <span className="text-neutral-500"> — ข้าม {saved.skipped} รายการที่ไม่มีการเปลี่ยนแปลง</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-neutral-500">
              ไม่มีการเปลี่ยนแปลง — ไม่ได้บันทึกอะไร
              {saved.skipped > 0 && ` (ตรวจแล้ว ${saved.skipped} รายการ ค่าเดิมทั้งหมด)`}
            </p>
          ))}
      </div>

      {preview && (
        <>
          {/* Reconciliation — feedback while ticking, not a separate check afterwards */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs text-neutral-500">ยอดร้านกาแฟที่ติ๊กไว้ ({preview.period})</p>
                <p className={`text-2xl font-semibold tabular-nums ${reconciled ? "text-green-700" : "text-neutral-900"}`}>
                  {fmt(runningTotal)} ฿
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">ยอดเป้าหมายจาก Excel</label>
                <input
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-36 rounded-md border border-neutral-300 px-2 py-1.5 text-right text-sm tabular-nums"
                />
              </div>
              <div className="text-right">
                <p className="text-xs text-neutral-500">ต่าง</p>
                <p className={`text-lg font-semibold tabular-nums ${reconciled ? "text-green-700" : Math.abs(gap) < 5000 ? "text-amber-600" : "text-red-600"}`}>
                  {gap > 0 ? "+" : ""}{fmt(gap)}
                </p>
              </div>
            </div>
            {preview.unreviewedCount > 0 && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                มี {preview.unreviewedCount} รายการที่ยังไม่เคยตรวจ — รายการใหม่ที่เพิ่งมีในเดือนนี้
                {" "}
                <button type="button" onClick={() => setOnlyUnreviewed((v) => !v)} className="underline">
                  {onlyUnreviewed ? "แสดงทั้งหมด" : "ดูเฉพาะรายการใหม่"}
                </button>
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 w-12">กาแฟ</th>
                    <th className="px-3 py-2">สินค้า</th>
                    <th className="px-3 py-2">หมวดใน POS</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ยอดขาย</th>
                    <th className="px-3 py-2 text-right w-32">฿/หน่วย ที่เป็นกาแฟ</th>
                    <th className="px-3 py-2 text-right">เข้ากาแฟ</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const d = drafts[c.productName] ?? { isCoffee: false, sharePerUnit: "" };
                    const amount = coffeeAmount(c, d);
                    return (
                      <tr
                        key={c.productName}
                        // Shading follows the DECISION, not the stored state, so a
                        // row stops looking outstanding the moment it is acted on.
                        className={`border-t border-neutral-100 ${!d.decided ? "bg-amber-50/60" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={d.isCoffee}
                            disabled={isPending}
                            onChange={(e) => {
                              markTouched(c.productName);
                              setDrafts((p) => ({
                                ...p,
                                [c.productName]: { ...d, isCoffee: e.target.checked, decided: true },
                              }));
                            }}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-2 text-neutral-800">
                          {c.productName}
                          {!c.reviewed && <span className="ml-2 text-xs text-amber-700">ใหม่</span>}
                          {!d.decided && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                              ยังไม่ยืนยัน
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-500">{c.where}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{fmt(c.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{fmt(c.gross)}</td>
                        <td className="px-3 py-2 text-right">
                          {d.isCoffee ? (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="ทั้งรายการ"
                              value={d.sharePerUnit}
                              disabled={isPending}
                              onChange={(e) => {
                                markTouched(c.productName);
                                setDrafts((p) => ({
                                  ...p,
                                  [c.productName]: { ...d, sharePerUnit: e.target.value, decided: true },
                                }));
                              }}
                              className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-xs tabular-nums"
                            />
                          ) : (
                            <span className="text-xs text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-800">
                          {amount > 0 ? fmt(amount) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-neutral-400">
                        ไม่มีรายการ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50 px-4 py-3">
              <p className="text-xs text-neutral-500">
                แสดง {visible.length} จาก {preview.candidates.length} รายการ
                {undecidedCount > 0 ? ` — ยังไม่ยืนยัน ${undecidedCount} รายการ` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {undecidedCount > 0 && (
                  <button
                    type="button"
                    onClick={acceptAllSuggestions}
                    disabled={isPending}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                  >
                    ยืนยันตามที่ระบบเสนอ ({undecidedCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending || decidedCount === 0}
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isPending ? "กำลังบันทึก..." : `บันทึก ${decidedCount} รายการ`}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
