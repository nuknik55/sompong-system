"use client";

import { useMemo, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { deletePosSalesAlias, updatePosSalesAlias } from "@/app/owner/sales-import-actions";
import { decimalBoxInput, decimalBoxText } from "@/lib/decimal-input";
import { validDivisor } from "@/lib/pos-sales-divisor";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";

export type DivisorRow = { id: string; posProductName: string; menuId: string; divisor: number };
export type MenuOption = { id: string; name: string; category: string | null };

/**
 * The row being edited: the menu, the divisor box's typed text and value,
 * and the values the edit STARTED from. Those are what the save checks the
 * row against, and what "unsaved" compares with — never the list's current
 * values, which a refresh (after deleting another row) can replace with an
 * edit made in another tab.
 */
type Edit = {
  id: string;
  menuId: string;
  draft: string | null;
  divisor: number | null;
  loaded: { menuId: string; divisor: number };
};

const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 4 });
const BAD_DIVISOR = "ตัวหารต้องอยู่ระหว่าง 0.0001 ถึง 1,000";
// A ÷10 is also what marks a dish sold by the kilo on the catering sheets
// (weightSoldMenuIds in @/lib/kitchen-sheet), so adding or removing one
// changes those sheets at once, for every booking — say so.
const TAKES_EFFECT = "บันทึกแล้ว — ยอดขายมีผลกับการนำเข้าครั้งต่อไป ถ้าเพิ่มหรือเอา ÷10 ออก ใบฟังก์ชั่นงานจัดเลี้ยงจะเปลี่ยนหน่วย (กก.) ทันที";

export function PosDivisorsClient({ rows, menus }: { rows: DivisorRow[]; menus: MenuOption[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menuById = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus]);

  // Unsaved is a comparison with the values the edit started from, never a
  // flag. A row deleted elsewhere (gone after a refresh) is not rendered, so
  // an edit of it is not held as unsaved work.
  const editRowShown = !!edit && rows.some((r) => r.id === edit.id);
  const dirty = !!edit && editRowShown && (edit.menuId !== edit.loaded.menuId || edit.divisor !== edit.loaded.divisor);
  useLeaveGuard(dirty);

  function startEdit(r: DivisorRow) {
    setError(null);
    setNotice(null);
    setEdit({ id: r.id, menuId: r.menuId, draft: null, divisor: r.divisor, loaded: { menuId: r.menuId, divisor: r.divisor } });
  }

  function save() {
    if (!edit) return;
    const divisor = edit.divisor == null ? null : validDivisor(edit.divisor);
    if (divisor == null) { setError(BAD_DIVISOR); return; }
    const saving = edit;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updatePosSalesAlias(saving.id, saving.menuId, divisor, saving.loaded);
        if (result.status === "error") { setError(result.message); return; }
        setEdit(null);
        setNotice(TAKES_EFFECT);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function remove(r: DivisorRow) {
    const menuName = menuById.get(r.menuId)?.name ?? "?";
    const ok = confirm(
      `ลบตัวหารของ "${r.posProductName}" (→ ${menuName} ÷${fmt(r.divisor)}) ?\n\n` +
        "นำเข้าครั้งต่อไป ชื่อนี้จะนับตามที่ POS นับ (÷1) ถ้าตรงกับชื่อเมนู หรือจะไม่ถูกนับเลยถ้าไม่ตรงกับเมนูใด" +
        (r.divisor === 10 ? "\n\nและเมนูนี้จะไม่ถูกพิมพ์เป็น กก. ในใบฟังก์ชั่นงานจัดเลี้ยงอีก (ถ้าไม่มี ÷10 อื่น) — มีผลทันที ทุกงาน" : ""),
    );
    if (!ok) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await deletePosSalesAlias(r.id, { menuId: r.menuId, divisor: r.divisor });
        if (result.status === "error") { setError(result.message); return; }
        setEdit((cur) => (cur?.id === r.id ? null : cur));
        setNotice(`ลบตัวหารของ "${r.posProductName}" แล้ว`);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        {notice && <p className="text-sm text-success-ink">{notice}</p>}
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          ยังไม่มีตัวหาร — สร้างได้จากหน้านำเข้ายอดขาย (ปุ่ม หาร หรือ ผูกเข้าเมนู)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-success-ink">{notice}</p>}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
              <th className="px-3 py-2">ชื่อสินค้าใน POS</th>
              <th className="px-3 py-2">เมนูในแอป</th>
              <th className="px-3 py-2 text-right">ตัวหาร</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const current = edit?.id === r.id ? edit : null;
              const menu = menuById.get(r.menuId);
              return (
                <tr key={r.id} className="border-b border-neutral-100 align-top last:border-0">
                  <td className="px-3 py-2">{r.posProductName}</td>
                  <td className="px-3 py-2">
                    {current ? (
                      <select
                        value={current.menuId}
                        disabled={isPending}
                        onChange={(e) => setEdit({ ...current, menuId: e.target.value })}
                        className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
                      >
                        {menus.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}{m.category ? ` (${m.category})` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        {menu?.name ?? "(ไม่พบเมนู)"}
                        {menu?.category && <span className="ml-1.5 text-xs text-neutral-500">{menu.category}</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {current ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-neutral-500">÷</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="ตัวหาร"
                          disabled={isPending}
                          value={decimalBoxText(current.draft, current.divisor)}
                          onChange={(e) => {
                            const { text, value } = decimalBoxInput(e.target.value);
                            setEdit({ ...current, draft: text, divisor: value });
                          }}
                          onBlur={() => setEdit((cur) => (cur ? { ...cur, draft: null } : cur))}
                          className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-right"
                        />
                      </span>
                    ) : (
                      `÷${fmt(r.divisor)}`
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {current ? (
                      <>
                        <button
                          type="button"
                          disabled={isPending || !dirty}
                          onClick={save}
                          className={buttonClass("primary", { size: "sm" })}
                        >
                          {isPending ? "กำลังบันทึก..." : "บันทึก"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setEdit(null)}
                          className="ml-3 text-xs text-neutral-500 underline hover:text-neutral-800"
                        >
                          ยกเลิก
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          // Another row's unsaved edit would be lost by switching.
                          disabled={isPending || dirty}
                          onClick={() => startEdit(r)}
                          className="text-xs text-neutral-600 underline hover:text-neutral-900 disabled:opacity-40"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => remove(r)}
                          className="ml-3 text-xs text-danger underline hover:text-danger disabled:opacity-40"
                        >
                          ลบ
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
