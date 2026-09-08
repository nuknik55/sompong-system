"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewItemClassification,
  saveItemClassification,
  type ItemCandidate,
  type ItemClassificationPreview,
} from "./actions";
import { CATEGORIES, CATEGORY_LABEL, isCategory, type Category } from "./categories";

// `category: null` is "not yet decided" — a state distinct from all six.
//
// A product with no row in pos_item_categories loads with NOTHING selected.
// It is not food, it is not other, and it is not a guess from its POS group:
// the group mapping was one-time seed machinery and does not run here. A row
// becomes a category only when a person picks one, and only rows a person
// decided are written. Everything else stays unreviewed and keeps showing up
// as ใหม่ until someone looks at it.
//
// `decided` and `category !== null` say the same thing on load; they diverge
// only while the user is undoing a mis-click on a new row (both go back).
type Draft = { category: Category | null; coffeeSharePerUnit: string; decided: boolean };

const CARVE_OUT_HELP =
  "หมวด = เงินไปอยู่ที่ไหน · ฿/หน่วย แยกให้ร้านกาแฟ = ส่วนที่ออกจากหมวดนั้นไปร้านกาแฟ · " +
  "เช่น ไอติมข้าวเหนียวมะม่วง ฿129 หมวดของหวาน แยก ฿15 → ของหวาน ฿114 / ร้านกาแฟ ฿15";

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseShare(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What this item contributes to the coffee total under the current draft,
 * NET of discount and platform GP (the basis the screen states). The
 * per-channel work is folded into netWhole/carveWeight server-side.
 */
function coffeeNet(c: ItemCandidate, d: Draft): number {
  if (!d.decided || d.category === null) return 0;
  if (d.category === "coffee") return c.netWhole;
  const share = parseShare(d.coffeeSharePerUnit);
  return share == null ? 0 : share * c.carveWeight;
}

/** The same contribution before any deduction — shown beside the net figure. */
function coffeeGross(c: ItemCandidate, d: Draft): number {
  if (!d.decided || d.category === null) return 0;
  if (d.category === "coffee") return c.gross;
  const share = parseShare(d.coffeeSharePerUnit);
  return share == null ? 0 : share * c.qty;
}

export function CoffeeItemsClient({ initialStoredCount }: { initialStoredCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ItemClassificationPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [target, setTarget] = useState("128625");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ written: number; skipped: number } | null>(null);

  // Product names the user actually interacted with in this session — a
  // category picked or a carve-out edited. Keyed exactly as `drafts` is.
  //
  // Re-confirming a row you looked at IS a review event and earns a fresh
  // reviewed_at, even when the value ends up unchanged. Being marked decided
  // at load time because a row already exists is not.
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
        const result = await previewItemClassification(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const p = result.preview;
        setPreview(p);
        setTouched(new Set());
        setDrafts(
          Object.fromEntries(
            p.candidates.map((c) => [
              c.productName,
              {
                category: c.category,
                coffeeSharePerUnit: c.coffeeSharePerUnit == null ? "" : String(c.coffeeSharePerUnit),
                // Already in the table = already decided. No row = not, and
                // the selector shows nothing until someone picks.
                decided: c.category !== null,
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
        const result = await saveItemClassification(
          preview.candidates
            .filter((c) => {
              const d = drafts[c.productName];
              return d?.decided && d.category !== null;
            })
            .map((c) => {
              const d = drafts[c.productName];
              return {
                productName: c.productName,
                category: d.category as Category,
                coffeeSharePerUnit: d.category === "coffee" ? null : parseShare(d.coffeeSharePerUnit),
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

  function setCategory(c: ItemCandidate, value: string) {
    const d = drafts[c.productName];
    if (value === "") {
      // Back to "not yet decided". Only reachable on a row with no stored
      // category (the placeholder is disabled otherwise), so this is an undo
      // of a mis-click, and the row must not be saved or count as touched.
      setTouched((prev) => {
        const next = new Set(prev);
        next.delete(c.productName);
        return next;
      });
      setSaved(null);
      setDrafts((p) => ({ ...p, [c.productName]: { category: null, coffeeSharePerUnit: "", decided: false } }));
      return;
    }
    if (!isCategory(value)) return;
    markTouched(c.productName);
    setDrafts((p) => ({
      ...p,
      [c.productName]: {
        ...d,
        category: value,
        // The CHECK forbids a carve-out on a coffee row; clear it here so the
        // box does not reappear with a stale value if the user switches back.
        coffeeSharePerUnit: value === "coffee" ? "" : d.coffeeSharePerUnit,
        decided: true,
      },
    }));
  }

  // Counts DECIDED rows only, so the figure always equals what saving would
  // record. On a first run with new items it moves as decisions are made,
  // which is the honest reading — nothing is classified until someone says so.
  const totals = useMemo(() => {
    if (!preview) return { net: 0, gross: 0 };
    return preview.candidates.reduce(
      (s, c) => {
        const d = drafts[c.productName];
        if (!d) return s;
        return { net: s.net + coffeeNet(c, d), gross: s.gross + coffeeGross(c, d) };
      },
      { net: 0, gross: 0 },
    );
  }, [preview, drafts]);

  const undecidedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.candidates.filter((c) => !drafts[c.productName]?.decided).length;
  }, [preview, drafts]);

  const decidedCount = (preview?.candidates.length ?? 0) - undecidedCount;

  const targetNum = Number(target) || 0;
  const gap = totals.net - targetNum;
  const reconciled = Math.abs(gap) < 1;

  const visible = useMemo(() => {
    if (!preview) return [];
    const q = query.trim().toLowerCase();
    return preview.candidates.filter(
      (c) => (!onlyUnreviewed || !c.reviewed) && (q === "" || c.productName.toLowerCase().includes(q)),
    );
  }, [preview, onlyUnreviewed, query]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">อัปโหลดไฟล์ยอดขายจาก POS</p>
          <p className="mt-1 text-xs text-neutral-500">
            ใช้ไฟล์ที่ export จาก POS โดยตรง — ชื่อไฟล์ SaleData_YYYYMMDD_HHMMSS.xls (มี 5 แผ่น)
            ไม่ใช่ไฟล์ที่จัดหมวดเอง (69-MMSaleData.xlsx) ระบบจะแสดงสินค้าทุกตัวในไฟล์ ให้เลือกหมวดให้สินค้าที่ยังไม่มีหมวด
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            ปัจจุบันบันทึกหมวดไว้แล้ว {initialStoredCount} รายการ
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
          {/* Reconciliation — feedback while classifying, not a separate check afterwards.
              The basis is stated in words because Nik's own figure is net of discount
              and GP, and a total that silently used a different basis would look
              like a bug in one direction or the other. */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs text-neutral-500">
                  ยอดร้านกาแฟ สุทธิ ({preview.period}) — หลังหักส่วนลดและ GP Grab/LineMan ตามอัตราในไฟล์
                </p>
                <p className={`text-2xl font-semibold tabular-nums ${reconciled ? "text-green-700" : "text-neutral-900"}`}>
                  {fmt(totals.net)} ฿
                </p>
                <p className="text-xs text-neutral-500 tabular-nums">ก่อนหัก {fmt(totals.gross)} ฿</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">ยอดเป้าหมายจาก Excel (สุทธิ)</label>
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
                มี {preview.unreviewedCount} รายการที่ยังไม่มีหมวด — รายการใหม่ที่เพิ่งมีในเดือนนี้
                {" "}
                <button type="button" onClick={() => setOnlyUnreviewed((v) => !v)} className="underline">
                  {onlyUnreviewed ? "แสดงทั้งหมด" : "ดูเฉพาะรายการใหม่"}
                </button>
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า"
                className="w-64 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <p className="text-xs text-neutral-500">
                ช่องทางขาย (Eat In / ห่อ / Grab / LM) มาจากไฟล์อยู่แล้ว — หน้านี้เลือกเฉพาะ &quot;หมวด&quot; ของสินค้า
              </p>
            </div>
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 w-36">หมวด</th>
                    <th className="px-3 py-2">สินค้า</th>
                    <th className="px-3 py-2">หมวดใน POS</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ยอดขาย</th>
                    <th className="px-3 py-2 text-right w-32">฿/หน่วย แยกให้ร้านกาแฟ</th>
                    <th className="px-3 py-2 text-right">เข้าร้านกาแฟ (สุทธิ)</th>
                  </tr>
                  {/* In the sticky header, not above the table, so it stays on
                      screen next to the carve-out boxes while the list scrolls.
                      The direction of the carve-out is the thing most likely
                      to be misread on this screen. */}
                  <tr>
                    <th colSpan={7} className="px-3 pb-2 text-left text-xs font-normal text-neutral-600">
                      {CARVE_OUT_HELP}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const d = drafts[c.productName] ?? { category: null, coffeeSharePerUnit: "", decided: false };
                    const net = coffeeNet(c, d);
                    return (
                      <tr
                        key={c.productName}
                        // Shading follows the DECISION, not the stored state, so a
                        // row stops looking outstanding the moment it is acted on.
                        className={`border-t border-neutral-100 ${!d.decided ? "bg-amber-50/60" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <select
                            value={d.category ?? ""}
                            disabled={isPending}
                            onChange={(e) => setCategory(c, e.target.value)}
                            className={`w-full rounded border px-1.5 py-1 text-xs ${d.category === null ? "border-amber-400 text-amber-800" : "border-neutral-300"}`}
                          >
                            {/* The placeholder is the "not yet decided" state.
                                A stored row cannot go back to it: there is no
                                delete, so no un-decide. */}
                            <option value="" disabled={c.reviewed}>
                              — เลือกหมวด —
                            </option>
                            {CATEGORIES.map((k) => (
                              <option key={k} value={k}>
                                {CATEGORY_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-neutral-800">
                          {c.productName}
                          {!c.reviewed && <span className="ml-2 text-xs text-amber-700">ใหม่</span>}
                          {!d.decided && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                              ยังไม่เลือกหมวด
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-500">{c.where}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{fmt(c.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{fmt(c.gross)}</td>
                        <td className="px-3 py-2 text-right">
                          {d.category === null ? (
                            <span className="text-xs text-neutral-300">—</span>
                          ) : d.category === "coffee" ? (
                            // Mirrors the CHECK: no carve-out on a coffee row.
                            <span className="text-xs text-neutral-400">ทั้งรายการ</span>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="ไม่มี"
                              title={CARVE_OUT_HELP}
                              value={d.coffeeSharePerUnit}
                              disabled={isPending}
                              onChange={(e) => {
                                markTouched(c.productName);
                                setDrafts((p) => ({
                                  ...p,
                                  [c.productName]: { ...d, coffeeSharePerUnit: e.target.value, decided: true },
                                }));
                              }}
                              className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-xs tabular-nums"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-800">
                          {net > 0 ? fmt(net) : "—"}
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
                {undecidedCount > 0 ? ` — ยังไม่เลือกหมวด ${undecidedCount} รายการ` : ""}
              </p>
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
        </>
      )}
    </div>
  );
}
