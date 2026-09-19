"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CateringDishOption } from "../../actions";
import {
  addEventMenuDish, copyEventMenuFromSet, createCustomEventMenu, removeEventMenuDish, replaceEventMenuDish, updateEventMenuItem,
  type EventMenuActionResult,
} from "../../actions";
import { fmtBaht, toNum, SET_MENU_SECTIONS } from "../../shared-utils";
import { discountFigure, discountText, dishesTotalPerTable, swapPriceWarning, swapWarningText, type EventMenuDish, type EventMenuLine, type EventMenuView } from "../../event-menu";

/**
 * The booking's own menu, one card per set line. What this component may do
 * is decided by the view it is given (canEdit, costByLine) and nowhere here:
 * a sales session's view carries no cost and canEdit false, a locked
 * booking's view carries canEdit false for everyone. Every write goes through
 * a server action that checks the same two things again.
 */

const RESULT_ERROR = "ทำไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

export function EventMenuClient({
  eventId, tableCount, view, dishOptions,
}: {
  eventId: string;
  tableCount: number | null;
  view: EventMenuView;
  dishOptions: CateringDishOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<EventMenuActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.status === "error") { setError(res.message); return; }
        router.refresh();
      } catch {
        setError(RESULT_ERROR);
      }
    });
  }

  const setLines = view.lines;

  return (
    <div className="space-y-4">
      {view.locked && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          🔒 ต้นทุนของงานนี้ถูกล็อกแล้ว — รายการอาหารถูกตรึงไว้ แก้ไขไม่ได้จนกว่าจะปลดล็อกในหน้าต้นทุน-กำไร
        </div>
      )}
      {!view.locked && !view.canEdit && (
        <p className="text-xs text-neutral-500">ดูได้อย่างเดียว — เจ้าของร้านและผู้จัดการเป็นผู้แก้ไขรายการอาหารของงาน</p>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {setLines.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          งานนี้ยังไม่มีชุดเมนู — เพิ่มชุดเมนูในกล่องราคาของหน้าจอง หรือสร้างชุดของงานเองด้านล่าง
        </p>
      )}

      {setLines.map((line) => (
        <SetLineCard
          key={line.id}
          eventId={eventId}
          line={line}
          cost={view.costByLine?.[line.id] ?? null}
          canEdit={view.canEdit}
          isPending={isPending}
          dishOptions={dishOptions}
          run={run}
        />
      ))}

      {view.canEdit && <CustomSetForm eventId={eventId} defaultTables={tableCount ?? 1} isPending={isPending} run={run} />}
    </div>
  );
}

// ── One set line ─────────────────────────────────────────────────────────────

function SetLineCard({
  eventId, line, cost, canEdit, isPending, dishOptions, run,
}: {
  eventId: string;
  line: EventMenuLine;
  cost: { costPerTable: number; pct: number | null; hasUnknownCost: boolean } | null;
  canEdit: boolean;
  isPending: boolean;
  dishOptions: CateringDishOption[];
  run: (action: () => Promise<EventMenuActionResult>) => void;
}) {
  const discount = discountFigure(dishesTotalPerTable(line.dishes), line.pricePerTable);
  // A line still reading the shared set: the copy is offered, not made.
  const legacy = line.source === "shared";
  const editable = canEdit && !legacy;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div>
          <p className="font-medium text-neutral-900">{line.name}</p>
          <p className="text-xs text-neutral-500 tabular-nums">
            {fmtBaht(line.tables)} โต๊ะ · {line.pricePerTable != null ? `฿${fmtBaht(line.pricePerTable)} / โต๊ะ` : "ไม่มีราคาต่อโต๊ะ"}
          </p>
        </div>
        <SourceBadge line={line} />
      </div>

      {legacy && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          รายการนี้ยังอ่านจากชุดเมนูกลาง (จองไว้ก่อนมีระบบสำเนา) — ถ้าชุดเมนูกลางเปลี่ยน รายการที่แสดงจะเปลี่ยนตาม
          {canEdit && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => copyEventMenuFromSet(eventId, line.id))}
              className="ml-2 rounded bg-amber-700 px-2 py-0.5 text-white hover:bg-amber-800 disabled:opacity-50"
            >
              คัดลอกมาเป็นของงานนี้
            </button>
          )}
        </div>
      )}

      <div className="space-y-3 px-4 py-3">
        {SET_MENU_SECTIONS.map(({ value, label }) => {
          const rows = line.dishes.filter((d) => d.section === value);
          if (rows.length === 0 && !editable) return null;
          return (
            <div key={value}>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
              {rows.length === 0 && <p className="text-xs text-neutral-400">— ไม่มี —</p>}
              <ul className="divide-y divide-neutral-100">
                {rows.map((d, i) => (
                  <DishRow key={d.id} eventId={eventId} dish={d} index={i + 1} editable={editable} isPending={isPending} dishOptions={dishOptions} run={run} />
                ))}
              </ul>
              {editable && <AddDishRow eventId={eventId} lineId={line.id} section={value} isPending={isPending} dishOptions={dishOptions} run={run} />}
            </div>
          );
        })}
        {line.dishes.length === 0 && !editable && <p className="text-sm text-neutral-400">ยังไม่มีรายการอาหารในชุดนี้</p>}
      </div>

      {/* Figures. The discount is a customer-price fact and shows for every
          reader; the cost block renders only when the view carried one,
          which it does for owner and admin alone. */}
      <div className="grid gap-3 border-t border-neutral-100 px-4 py-3 sm:grid-cols-2">
        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-xs text-neutral-500">ส่วนลดเทียบราคาเมนูแยก</p>
          <p className={`tabular-nums font-medium ${discount && discount.amount < 0 ? "text-red-700" : "text-neutral-800"}`}>
            {discount ? `${discount.amount >= 0 ? "" : "−"}${Math.abs(discount.pct).toFixed(2)}%` : "—"}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{discountText(discount)}</p>
        </div>
        {cost && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
            <p className="text-xs font-medium text-amber-800">ต้นทุนอาหาร (Admin/Owner เท่านั้น)</p>
            <p className="tabular-nums font-medium text-neutral-800">
              ฿{fmtBaht(cost.costPerTable)} / โต๊ะ{cost.pct != null && <> · {cost.pct.toFixed(2)}% ของราคาชุด</>}
            </p>
            {cost.hasUnknownCost && <p className="mt-0.5 text-xs text-amber-700">⚠ มีเมนูที่ยังไม่ทราบต้นทุนแน่ชัด ตัวเลขอาจต่ำกว่าความจริง</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ line }: { line: EventMenuLine }) {
  const cls = "rounded-full border px-2 py-0.5 text-xs";
  if (line.source === "copy" && line.sourceSetMenuId) return <span className={`${cls} border-green-200 bg-green-50 text-green-700`}>คัดลอกจากชุดเมนู · แก้ไขแยกจากชุดกลาง</span>;
  if (line.source === "copy") return <span className={`${cls} border-blue-200 bg-blue-50 text-blue-700`}>ชุดของงานนี้ (กำหนดเอง)</span>;
  if (line.source === "shared") return <span className={`${cls} border-amber-200 bg-amber-50 text-amber-700`}>ยังใช้ชุดเมนูกลาง</span>;
  return <span className={`${cls} border-neutral-200 bg-neutral-50 text-neutral-500`}>ยังไม่มีรายการ</span>;
}

// ── A course ─────────────────────────────────────────────────────────────────

function DishRow({
  eventId, dish, index, editable, isPending, dishOptions, run,
}: {
  eventId: string;
  dish: EventMenuDish;
  index: number;
  editable: boolean;
  isPending: boolean;
  dishOptions: CateringDishOption[];
  run: (action: () => Promise<EventMenuActionResult>) => void;
}) {
  const [swapping, setSwapping] = useState(false);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(String(dish.quantity));
  const picked = dishOptions.find((d) => d.id === pick);
  const warning = picked ? swapPriceWarning(dish.selling_price, picked.selling_price) : null;

  return (
    <li className="py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-right text-xs text-neutral-400 tabular-nums">{index}.</span>
        <span className="flex-1 text-neutral-800">{dish.menu_name}</span>
        <span className="text-xs text-neutral-500 tabular-nums">฿{fmtBaht(dish.selling_price)}</span>
        {editable ? (
          <input
            type="text" inputMode="decimal" value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={() => {
              const n = toNum(qty);
              if (n == null || n <= 0 || n === dish.quantity) { setQty(String(dish.quantity)); return; }
              run(() => updateEventMenuItem(eventId, dish.id, { quantity: n }));
            }}
            title="จำนวนต่อโต๊ะ"
            className="w-14 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-xs tabular-nums"
          />
        ) : (
          <span className="w-14 text-right text-xs text-neutral-500 tabular-nums">× {fmtBaht(dish.quantity)}</span>
        )}
        {editable && (
          <>
            <button type="button" disabled={isPending} onClick={() => { setSwapping((s) => !s); setPick(""); }}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              {swapping ? "ยกเลิก" : "เปลี่ยน"}
            </button>
            <button type="button" disabled={isPending} onClick={() => run(() => removeEventMenuDish(eventId, dish.id))}
              className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-400 hover:border-red-300 hover:text-red-500 disabled:opacity-50">
              ลบ
            </button>
          </>
        )}
      </div>
      {dish.note && <p className="ml-7 text-xs text-neutral-400">{dish.note}</p>}
      {swapping && (
        <div className="ml-7 mt-1.5 space-y-1.5">
          <DishSelect value={pick} onChange={setPick} dishOptions={dishOptions} placeholder="เลือกเมนูที่จะใช้แทน…" />
          {/* The >10% rule (Nik): a warning, never a block. The confirm button stays. */}
          {picked && warning?.warn && (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              ⚠ {swapWarningText(dish.menu_name, dish.selling_price, picked.name, picked.selling_price)}
            </p>
          )}
          {picked && !warning?.warn && (
            <p className="text-xs text-neutral-500 tabular-nums">
              ราคาใกล้เคียงกัน ({fmtBaht(dish.selling_price)} → {fmtBaht(picked.selling_price)} บาท)
            </p>
          )}
          <button type="button" disabled={isPending || !picked}
            onClick={() => { if (picked) run(() => replaceEventMenuDish(eventId, dish.id, picked.id)); setSwapping(false); }}
            className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            ยืนยันเปลี่ยนเป็นเมนูนี้
          </button>
        </div>
      )}
    </li>
  );
}

function AddDishRow({
  eventId, lineId, section, isPending, dishOptions, run,
}: {
  eventId: string;
  lineId: string;
  section: string;
  isPending: boolean;
  dishOptions: CateringDishOption[];
  run: (action: () => Promise<EventMenuActionResult>) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <DishSelect value={pick} onChange={setPick} dishOptions={dishOptions} placeholder="+ เพิ่มเมนูในหมวดนี้…" />
      <button type="button" disabled={isPending || !pick}
        onClick={() => { const id = pick; setPick(""); run(() => addEventMenuDish(eventId, lineId, id, section)); }}
        className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
        เพิ่ม
      </button>
    </div>
  );
}

/** A native select grouped by category — the dish list is a few hundred rows, and sales-safe (name and customer price only). */
function DishSelect({ value, onChange, dishOptions, placeholder }: { value: string; onChange: (v: string) => void; dishOptions: CateringDishOption[]; placeholder: string }) {
  const groups = new Map<string, CateringDishOption[]>();
  for (const d of dishOptions) {
    const key = d.category ?? "ไม่ระบุหมวด";
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="max-w-xs flex-1 rounded border border-neutral-300 px-2 py-1 text-xs">
      <option value="">{placeholder}</option>
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "th")).map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((d) => <option key={d.id} value={d.id}>{d.name} — ฿{fmtBaht(d.selling_price)}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// ── A custom set for this booking ────────────────────────────────────────────

function CustomSetForm({
  eventId, defaultTables, isPending, run,
}: {
  eventId: string;
  defaultTables: number;
  isPending: boolean;
  run: (action: () => Promise<EventMenuActionResult>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [tables, setTables] = useState(String(defaultTables));
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
        + สร้างชุดเมนูของงานเอง (เลือกเมนูเองตั้งแต่ต้น)
      </button>
    );
  }
  const priceN = toNum(price);
  const tablesN = toNum(tables);
  const valid = name.trim() !== "" && priceN != null && priceN >= 0 && tablesN != null && tablesN > 0;
  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-neutral-800">ชุดเมนูของงานเอง</p>
      <p className="text-xs text-neutral-500">สร้างเป็นรายการชุดในกล่องราคาด้วยราคาต่อโต๊ะที่ตั้งไว้ แล้วค่อยเพิ่มเมนูทีละรายการด้านบน</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อชุด เช่น ชุดพิเศษ 4,500"
          className="min-w-[12rem] flex-1 rounded border border-neutral-300 px-2 py-1" />
        <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="ราคา/โต๊ะ"
          className="w-28 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums" />
        <input type="text" inputMode="decimal" value={tables} onChange={(e) => setTables(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="โต๊ะ"
          className="w-20 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums" />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={isPending || !valid}
          onClick={() => run(() => createCustomEventMenu(eventId, { name: name.trim(), pricePerTable: priceN!, tables: tablesN! }))}
          className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
          สร้างชุด
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50">ยกเลิก</button>
      </div>
    </div>
  );
}
