"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveCateringCharges, issueCateringQuote, addCateringEventMenu, removeCateringEventMenu } from "../actions";
import type { CateringEvent, CateringCharge, CateringRate, CateringSetMenuOption, CateringDishOption } from "../actions";
import {
  RATE_TYPE_OPTIONS, CHARGE_TYPE_OPTIONS, CHARGE_TYPE_LABEL, RATE_TYPE_TO_CHARGE_TYPE,
  fmtBaht, toNum, thFullDate,
} from "../shared-utils";

const ALL_CATEGORY = "ทั้งหมด";
const UNCATEGORIZED = "ไม่มีหมวด";

// Local-only row shape: numeric fields stay strings for controlled inputs
// (matches FormState's convention in shared.tsx), and _key is a client-side
// id for React — never sent to the server. Rows are saved wholesale, so a
// fresh crypto.randomUUID() key for a new row is fine; it never needs to
// match a real catering_event_charges.id.
type ChargeRow = {
  _key: string;
  label: string;
  charge_type: string;
  unit_price: string;
  quantity: string;
  amount: string;
  note: string;
  /** Carried through unedited — see saveCateringCharges in actions.ts for why
   *  this must survive every save, not just display on load. Non-null makes
   *  the row "locked" (label/charge_type/unit_price non-editable) — it was
   *  added via the menu picker, not typed by hand. */
  event_menu_id: string | null;
  /** Display-only tag for locked rows ("ชุดเมนู"/"เมนูเดี่ยว") — derived
   *  server-side in getCateringCharges, never sent back on save. */
  event_menu_kind: "set" | "dish" | null;
};

function blankChargeRow(): ChargeRow {
  return { _key: crypto.randomUUID(), label: "", charge_type: "other", unit_price: "", quantity: "1", amount: "", note: "", event_menu_id: null, event_menu_kind: null };
}

function rowFromCharge(c: CateringCharge): ChargeRow {
  return {
    _key: c.id,
    label: c.label,
    charge_type: c.charge_type,
    unit_price: c.unit_price.toString(),
    quantity: c.quantity.toString(),
    amount: c.amount.toString(),
    note: c.note ?? "",
    event_menu_id: c.event_menu_id,
    event_menu_kind: c.event_menu_kind,
  };
}

/** Reject/revert a quantity field to a floor of 1 on blur — applies to every
 *  row, locked or manual, per your call: a 0-or-negative quantity line is
 *  never meaningful, and this is the only guard on this field (nothing
 *  server-side re-checks it, matching how unit_price/amount aren't
 *  re-validated server-side either). */
function clampQuantity(value: string): string {
  const n = toNum(value);
  if (n === null || n <= 0) return "1";
  return value;
}

// Module level on purpose — see the note in shared.tsx: declaring this inside
// ChargesSection would remount it (and close the panel) on every keystroke.
function RatePicker({
  rates,
  event,
  disabled,
  onInsert,
}: {
  rates: CateringRate[];
  event: CateringEvent;
  disabled: boolean;
  onInsert: (rate: CateringRate) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // Suggest, don't auto-insert: highlight the delivery bracket that actually
  // covers this event's offsite_distance_km, and float it to the top of the
  // delivery group — the sales rep still has to click it.
  const matchId =
    event.location_type === "offsite" && event.offsite_distance_km != null
      ? rates.find(
          (r) =>
            r.rate_type === "delivery" &&
            r.min_distance_km != null &&
            r.max_distance_km != null &&
            event.offsite_distance_km! >= r.min_distance_km &&
            event.offsite_distance_km! <= r.max_distance_km,
        )?.id ?? null
      : null;

  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        เลือกจากอัตราที่ตั้งไว้
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {RATE_TYPE_OPTIONS.map((group) => {
            let rows = rates.filter((r) => r.rate_type === group.value);
            if (rows.length === 0) return null;
            if (matchId) {
              const m = rows.find((r) => r.id === matchId);
              if (m) rows = [m, ...rows.filter((r) => r.id !== matchId)];
            }
            return (
              <div key={group.value}>
                <div className="sticky top-0 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-500">
                  {group.label}
                </div>
                {rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { onInsert(r); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 ${r.id === matchId ? "bg-amber-50" : ""}`}
                  >
                    <span className="text-neutral-800">
                      {r.label}
                      {r.id === matchId && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">แนะนำ</span>
                      )}
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">
                      {fmtBaht(r.amount)}{r.unit ? ` / ${r.unit}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Module level for the same reason as RatePicker above. Deliberately
// sales-safe: only ever receives name + sale price, never cost — see
// getCateringSetMenuOptions()/getCateringDishOptions() in actions.ts.
//
// A full overlay rather than a small anchored dropdown — 238 dishes is too
// many to browse in a 320px-wide list. Category pills (from menus.category)
// only apply to the "เมนูเดี่ยว" tab, since set menus have no category; search
// still filters within whichever tab/category is active.
function MenuPicker({
  setMenus,
  dishes,
  disabled,
  onAdd,
}: {
  setMenus: CateringSetMenuOption[];
  dishes: CateringDishOption[];
  disabled: boolean;
  onAdd: (item: { kind: "set" | "dish"; id: string; quantity: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"set" | "dish">("set");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [quantity, setQuantity] = useState("1");

  const categories = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    for (const d of dishes) {
      if (d.category) set.add(d.category);
      else hasUncategorized = true;
    }
    return [ALL_CATEGORY, ...[...set].sort((a, b) => a.localeCompare(b, "th")), ...(hasUncategorized ? [UNCATEGORIZED] : [])];
  }, [dishes]);

  const q = query.trim().toLowerCase();
  const setMatches = setMenus.filter((s) => q === "" || s.name.toLowerCase().includes(q));
  const dishMatches = dishes.filter((d) => {
    if (category === UNCATEGORIZED ? d.category : category !== ALL_CATEGORY && d.category !== category) return false;
    return q === "" || d.name.toLowerCase().includes(q);
  });

  function pick(kind: "set" | "dish", id: string) {
    onAdd({ kind, id, quantity: Number(quantity) || 1 });
    setQuery("");
    setQuantity("1");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        + เพิ่มเมนู
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
              <h3 className="font-kanit text-sm font-semibold">เลือกเมนู</h3>
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="flex border-b border-neutral-100">
              <button
                type="button"
                onClick={() => setTab("set")}
                className={`flex-1 px-3 py-2 text-sm font-medium ${tab === "set" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
              >
                ชุดเมนู
              </button>
              <button
                type="button"
                onClick={() => setTab("dish")}
                className={`flex-1 px-3 py-2 text-sm font-medium ${tab === "dish" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
              >
                เมนูเดี่ยว
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
              <input
                autoFocus
                className="flex-1 rounded border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none"
                placeholder={tab === "set" ? "พิมพ์ชื่อชุดเมนู" : "พิมพ์ชื่อเมนู"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="text-xs text-neutral-500">จำนวน</label>
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            {tab === "dish" && (
              <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-5 py-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      category === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {tab === "set"
                ? (setMatches.length === 0
                    ? <p className="py-8 text-center text-sm text-neutral-400">ไม่พบชุดเมนู</p>
                    : setMatches.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => pick("set", s.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50"
                        >
                          <span className="text-neutral-800">{s.name}</span>
                          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">฿{fmtBaht(s.price_per_set)}</span>
                        </button>
                      )))
                : (dishMatches.length === 0
                    ? <p className="py-8 text-center text-sm text-neutral-400">ไม่พบเมนู</p>
                    : dishMatches.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => pick("dish", d.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50"
                        >
                          <span className="text-neutral-800">{d.name}</span>
                          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">฿{fmtBaht(d.selling_price)}</span>
                        </button>
                      )))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ChargesSection({
  event,
  initialCharges,
  rates,
  setMenuOptions,
  dishOptions,
}: {
  event: CateringEvent;
  initialCharges: CateringCharge[];
  rates: CateringRate[];
  setMenuOptions: CateringSetMenuOption[];
  dishOptions: CateringDishOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [charges, setCharges] = useState<ChargeRow[]>(() => initialCharges.map(rowFromCharge));
  const [error, setError] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);

  // useState(() => ...) only seeds state on mount — router.refresh() after a
  // save delivers a fresh initialCharges prop, but the already-mounted
  // component never picks it up on its own, so the table looked unchanged
  // until a manual browser reload. Resyncing on every prop change is only
  // safe because every row input below is disabled while isPending: without
  // that, a keystroke made in the gap between "saved" and the refreshed
  // props landing would get silently overwritten by this effect.
  useEffect(() => {
    setCharges(initialCharges.map(rowFromCharge));
  }, [initialCharges]);

  function updateRow(key: string, patch: Partial<ChargeRow>) {
    setCharges((cs) =>
      cs.map((c) => {
        if (c._key !== key) return c;
        const next = { ...c, ...patch };
        // Auto-compute amount from unit_price * quantity, but only when one
        // of those two changed — editing amount directly leaves it as typed,
        // per the override behavior catering_event_charges.amount was built for.
        // Locked rows never get a direct amount edit (no input rendered for
        // them), so this always stays the source of truth for those rows.
        if ("unit_price" in patch || "quantity" in patch) {
          const up = toNum(next.unit_price) ?? 0;
          const qty = toNum(next.quantity) ?? 0;
          next.amount = (up * qty).toString();
        }
        return next;
      }),
    );
  }

  function addBlankRow() {
    setCharges((cs) => [...cs, blankChargeRow()]);
  }

  function insertFromRate(rate: CateringRate) {
    setCharges((cs) => [
      ...cs,
      {
        _key: crypto.randomUUID(),
        label: rate.label,
        charge_type: RATE_TYPE_TO_CHARGE_TYPE[rate.rate_type] ?? "other",
        unit_price: rate.amount.toString(),
        quantity: "1",
        amount: rate.amount.toString(),
        note: rate.note ?? "",
        event_menu_id: null,
        event_menu_kind: null,
      },
    ]);
  }

  function removeRow(key: string) {
    setCharges((cs) => cs.filter((c) => c._key !== key));
  }

  function toPayload() {
    return charges
      .filter((c) => c.label.trim() !== "")
      .map((c) => ({
        label: c.label,
        charge_type: c.charge_type,
        unit_price: toNum(c.unit_price) ?? 0,
        quantity: toNum(c.quantity) ?? 0,
        amount: toNum(c.amount) ?? 0,
        note: c.note || null,
        event_menu_id: c.event_menu_id,
      }));
  }

  function handleSaveCharges() {
    setError(null);
    startTransition(async () => {
      try {
        await saveCateringCharges(event.id, toPayload());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกรายการไม่สำเร็จ");
      }
    });
  }

  function handleIssue() {
    setError(null);
    startTransition(async () => {
      try {
        // issueCateringQuote recomputes the total from the database, not
        // from local state — charges must be persisted first, or a re-issue
        // would silently use stale numbers.
        await saveCateringCharges(event.id, toPayload());
        await issueCateringQuote(event.id);
        setConfirmIssue(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ออกใบเสนอราคาไม่สำเร็จ");
        setConfirmIssue(false);
      }
    });
  }

  // Menu-picker add/remove are immediate server calls, not deferred to
  // "บันทึกรายการ" like every other edit here — matching the old
  // EventMenusSection behavior, and required for the delete side per your
  // call: a locked row's removal must always go through
  // removeCateringEventMenu (cascade), never the wholesale charges
  // delete+reinsert saveCateringCharges does, which would silently drop the
  // charge row without ever touching its catering_event_menus counterpart.
  function handleAddMenu(item: { kind: "set" | "dish"; id: string; quantity: number }) {
    setError(null);
    startTransition(async () => {
      try {
        await addCateringEventMenu(event.id, { ...item, note: null });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "เพิ่มเมนูไม่สำเร็จ");
      }
    });
  }

  function handleRemoveMenu(eventMenuId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeCateringEventMenu(eventMenuId, event.id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  const total = charges.reduce((s, c) => s + (toNum(c.amount) ?? 0), 0);
  const issueLabel = event.quote_number ? `ออกใบเสนอราคาใหม่ (R${event.quote_revision + 1})` : "ออกใบเสนอราคา";

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-kanit text-base font-semibold text-neutral-900">รายการเมนู / ค่าใช้จ่าย / ใบเสนอราคา</h3>
        <div className="flex flex-wrap gap-2">
          <MenuPicker setMenus={setMenuOptions} dishes={dishOptions} disabled={isPending} onAdd={handleAddMenu} />
          <button type="button" onClick={addBlankRow} disabled={isPending} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            + เพิ่มรายการ
          </button>
          <RatePicker rates={rates} event={event} disabled={isPending} onInsert={insertFromRate} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full table-fixed text-sm">
          {/* Fixed widths so the charge_type select and note input get room
              to show their full text instead of being auto-sized down by
              the numeric columns next to them. */}
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "23%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-3 py-2">รายการ</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2 text-right">ราคาต่อหน่วย</th>
              <th className="px-3 py-2 text-right">จำนวน</th>
              <th className="px-3 py-2 text-right">รวม</th>
              <th className="px-3 py-2">หมายเหตุ</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {charges.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-neutral-400">ยังไม่มีรายการ</td>
              </tr>
            )}
            {charges.map((c) => {
              const locked = c.event_menu_id !== null;
              return (
                <tr key={c._key} className="border-b border-neutral-100 last:border-0">
                  <td className="px-2 py-1.5">
                    {locked ? (
                      <div className="flex items-center gap-1.5 px-1 py-1 text-sm text-neutral-800">
                        <span className="truncate">{c.label}</span>
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                          {c.event_menu_kind === "set" ? "ชุดเมนู" : "เมนูเดี่ยว"}
                        </span>
                      </div>
                    ) : (
                      <input disabled={isPending} className="charge-input" value={c.label} onChange={(e) => updateRow(c._key, { label: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {locked ? (
                      <span className="block px-1 py-1 text-sm text-neutral-600">{CHARGE_TYPE_LABEL[c.charge_type] ?? c.charge_type}</span>
                    ) : (
                      <select disabled={isPending} className="charge-input" value={c.charge_type} onChange={(e) => updateRow(c._key, { charge_type: e.target.value })}>
                        {CHARGE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {locked ? (
                      <span className="block px-1 py-1 text-right text-sm tabular-nums text-neutral-600">{c.unit_price}</span>
                    ) : (
                      <input disabled={isPending} type="number" className="charge-input text-right tabular-nums" value={c.unit_price}
                        onChange={(e) => updateRow(c._key, { unit_price: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input disabled={isPending} type="number" min={1} className="charge-input text-right tabular-nums" value={c.quantity}
                      onChange={(e) => updateRow(c._key, { quantity: e.target.value })}
                      onBlur={(e) => updateRow(c._key, { quantity: clampQuantity(e.target.value) })} />
                  </td>
                  <td className="px-2 py-1.5">
                    {locked ? (
                      <span className="block px-1 py-1 text-right text-sm tabular-nums text-neutral-600">{c.amount}</span>
                    ) : (
                      <input disabled={isPending} type="number" className="charge-input text-right tabular-nums" value={c.amount}
                        onChange={(e) => updateRow(c._key, { amount: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input disabled={isPending} className="charge-input" value={c.note} onChange={(e) => updateRow(c._key, { note: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => (locked ? handleRemoveMenu(c.event_menu_id!) : removeRow(c._key))}
                      disabled={isPending}
                      className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-30"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-200 font-medium">
              <td colSpan={4} className="px-3 py-2 text-right text-neutral-600">รวมทั้งหมด</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-900">฿{fmtBaht(total)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
        <div className="text-xs text-neutral-500">
          {event.quote_number ? (
            <>
              เลขที่ใบเสนอราคา <span className="font-medium tabular-nums text-neutral-700">{event.quote_number}</span>
              {event.quote_revision > 0 && ` (แก้ไขครั้งที่ ${event.quote_revision})`}
              {event.quoted_at && ` · ออกล่าสุด ${thFullDate(event.quoted_at.slice(0, 10))}`}
            </>
          ) : (
            "ยังไม่เคยออกใบเสนอราคา"
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleSaveCharges} disabled={isPending}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            บันทึกรายการ
          </button>
          {event.quote_number && (
            <Link href={`/owner/catering/${event.id}/quote`}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
              พิมพ์ใบเสนอราคา
            </Link>
          )}
          {/* Not gated on quote_number — kitchen prep can start before pricing is finalized. */}
          <Link href={`/owner/catering/${event.id}/function-sheet`}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            พิมพ์ใบฟังก์ชั่นงาน
          </Link>
          <button type="button" onClick={() => setConfirmIssue(true)} disabled={isPending || charges.length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            {issueLabel}
          </button>
        </div>
      </div>

      {confirmIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">
              {event.quote_number ? "ออกใบเสนอราคาใหม่?" : "ออกใบเสนอราคา?"}
            </h3>
            <p className="mb-4 text-sm text-neutral-500">
              จะบันทึกรายการปัจจุบัน ({charges.length} รายการ, รวม ฿{fmtBaht(total)}) แล้วออกเป็นเอกสารที่ลูกค้าเห็นได้
              {event.quote_number ? " — เลขที่เดิมยังใช้เหมือนเดิม แต่ยอดและวันที่จะถูกอัปเดตเป็นล่าสุด" : ""}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmIssue(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button onClick={handleIssue} disabled={isPending}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
                {isPending ? "กำลังออก…" : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .charge-input { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; font-size: 0.8125rem; outline: none; background: white; }
        .charge-input:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
        .charge-input:disabled { background: #f9fafb; color: #9ca3af; }
      `}</style>
    </section>
  );
}
