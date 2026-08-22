"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addCateringEventMenu, removeCateringEventMenu } from "../actions";
import type { CateringEventMenu, CateringSetMenuOption, CateringDishOption } from "../actions";
import { fmtBaht } from "../shared";

// Module level on purpose — see the note in shared.tsx: declaring this inside
// EventMenusSection would remount it (and close the panel) on every keystroke.
// Deliberately sales-safe: only ever receives name + sale price, never cost —
// see getCateringSetMenuOptions()/getCateringDishOptions() in actions.ts.
function MenuPicker({
  setMenus,
  dishes,
  onAdd,
}: {
  setMenus: CateringSetMenuOption[];
  dishes: CateringDishOption[];
  onAdd: (item: { kind: "set" | "dish"; id: string; quantity: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"set" | "dish">("set");
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const q = query.trim().toLowerCase();
  const setMatches = q === "" ? setMenus.slice(0, 8) : setMenus.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  const dishMatches = q === "" ? dishes.slice(0, 8) : dishes.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 8);

  function pick(kind: "set" | "dish", id: string) {
    onAdd({ kind, id, quantity: Number(quantity) || 1 });
    setQuery("");
    setQuantity("1");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        + เพิ่มเมนู
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-96 rounded-lg border border-neutral-200 bg-white shadow-lg">
          <div className="flex border-b border-neutral-100">
            <button
              type="button"
              onClick={() => setTab("set")}
              className={`flex-1 px-3 py-2 text-xs font-medium ${tab === "set" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
            >
              ชุดเมนู
            </button>
            <button
              type="button"
              onClick={() => setTab("dish")}
              className={`flex-1 px-3 py-2 text-xs font-medium ${tab === "dish" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
            >
              เมนูเดี่ยว
            </button>
          </div>
          <div className="flex items-center gap-2 border-b border-neutral-100 p-2">
            <input
              autoFocus
              className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none"
              placeholder="พิมพ์ชื่อ"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <input
              type="number"
              min={1}
              className="w-16 rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {tab === "set"
              ? (setMatches.length === 0
                  ? <p className="px-3 py-4 text-center text-xs text-neutral-400">ไม่พบชุดเมนู</p>
                  : setMatches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pick("set", s.id)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="text-neutral-800">{s.name}</span>
                        <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">฿{fmtBaht(s.price_per_set)}</span>
                      </button>
                    )))
              : (dishMatches.length === 0
                  ? <p className="px-3 py-4 text-center text-xs text-neutral-400">ไม่พบเมนู</p>
                  : dishMatches.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => pick("dish", d.id)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="text-neutral-800">{d.name}</span>
                        <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">฿{fmtBaht(d.selling_price)}</span>
                      </button>
                    )))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EventMenusSection({
  eventId,
  initialMenus,
  setMenuOptions,
  dishOptions,
}: {
  eventId: string;
  initialMenus: CateringEventMenu[];
  setMenuOptions: CateringSetMenuOption[];
  dishOptions: CateringDishOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd(item: { kind: "set" | "dish"; id: string; quantity: number }) {
    setError(null);
    startTransition(async () => {
      try {
        await addCateringEventMenu(eventId, { ...item, note: null });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "เพิ่มเมนูไม่สำเร็จ");
      }
    });
  }

  function handleRemove(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeCateringEventMenu(id, eventId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-kanit text-base font-semibold text-neutral-900">เมนูที่สั่ง</h3>
        <MenuPicker setMenus={setMenuOptions} dishes={dishOptions} onAdd={handleAdd} />
      </div>

      {initialMenus.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400">ยังไม่มีเมนู</p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {initialMenus.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <span className="text-sm text-neutral-800">{m.name}</span>
                <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                  {m.set_menu_id ? "ชุดเมนู" : "เมนูเดี่ยว"}
                </span>
                {m.note && <div className="text-xs text-neutral-400">{m.note}</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-neutral-500">× {m.quantity}</span>
                <button type="button" onClick={() => handleRemove(m.id)} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-600">
                  ลบ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
