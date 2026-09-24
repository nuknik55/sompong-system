"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import {
  DESIGN_MAX_COLUMNS, addDish, copyDish, designFigures, moveDish, parseDesignPrice, removeDish, swapDish,
  type DesignDish, type DishFacts,
} from "@/lib/set-design";
import { EVENT_MENU_SECTION_LIST } from "../../menu-lines";
import { menuLineQuantityError } from "../../booking-lines";
import { comparisonText, setVsAlaCarte } from "../../event-menu";
import type { DishCostOption } from "../SetMenusClient";
import { createDraft, deleteDraft, makeDraftReal, saveDraft } from "./actions";

export type DraftSet = { id: string; name: string; price: number; items: DesignDish[]; updated_at: string };

type Column = {
  id: string;
  name: string;
  priceText: string;
  items: DesignDish[];
  /** The snapshot last saved (or loaded): the column is dirty when it differs. */
  saved: string;
  /** The draft's version as last saved or loaded: what its next save sends. */
  seen: string;
};

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const snapshot = (c: Pick<Column, "name" | "priceText" | "items">) => JSON.stringify([c.name, c.priceText, c.items]);
const fromDraft = (d: DraftSet): Column => {
  const c = { id: d.id, name: d.name, priceText: String(d.price), items: d.items };
  return { ...c, saved: snapshot(c), seen: d.updated_at };
};
// Static class names, so the stylesheet has them: one to four columns on a desktop.
const GRID: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

/**
 * The columns after the server's list changed (a save, a create, a delete, a
 * make-real — anyone's): a clean column takes the server's copy, a dirty one
 * keeps its edits (its save is then refused if someone saved it meanwhile),
 * a draft that is gone goes, a new one comes in.
 */
function merge(cols: Column[], drafts: DraftSet[]): Column[] {
  const byId = new Map(cols.map((c) => [c.id, c]));
  return drafts.map((d) => {
    const c = byId.get(d.id);
    return c && snapshot(c) !== c.saved ? c : fromDraft(d);
  });
}

export function DesignClient({ drafts, realSets, dishOptions }: {
  drafts: DraftSet[];
  realSets: { id: string; name: string }[];
  dishOptions: DishCostOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cols, setCols] = useState<Column[]>(() => drafts.map(fromDraft));
  const [shown, setShown] = useState<string[]>(() => drafts.slice(0, DESIGN_MAX_COLUMNS).map((d) => d.id));
  const [prevDrafts, setPrevDrafts] = useState(drafts);
  const [showNew, setShowNew] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [realDialog, setRealDialog] = useState<{ id: string; name: string; priceText: string } | null>(null);
  const [fromSet, setFromSet] = useState("");
  const [fromDraftId, setFromDraftId] = useState("");

  // THE SERVER'S LIST CHANGED: fold it in during render (React's pattern for
  // state that follows a prop), so no column's unsaved edits are lost to it.
  if (drafts !== prevDrafts) {
    setPrevDrafts(drafts);
    const known = new Set(cols.map((c) => c.id));
    const ids = new Set(drafts.map((d) => d.id));
    setCols(merge(cols, drafts));
    let nextShown = shown.filter((id) => ids.has(id));
    // A trial set this screen just made is shown at once, in place of the
    // last column when four are already open.
    const added = drafts.filter((d) => !known.has(d.id)).map((d) => d.id);
    if (showNew && added.length > 0) {
      nextShown = [...nextShown.slice(0, Math.max(0, DESIGN_MAX_COLUMNS - added.length)), ...added].slice(0, DESIGN_MAX_COLUMNS);
      setShowNew(false);
      setActive(Math.max(0, nextShown.length - 1));
    }
    setShown(nextShown);
  }

  const facts = useMemo(() => new Map<string, DishFacts>(dishOptions.map((d) => [d.id, d])), [dishOptions]);
  const visible = shown.map((id) => cols.find((c) => c.id === id)).filter((c): c is Column => !!c);
  const dirty = (c: Column) => snapshot(c) !== c.saved;
  const anyDirty = cols.some(dirty);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const update = (id: string, fn: (c: Column) => Column) => setCols((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  function run(work: () => Promise<{ error?: string }>, done?: () => void) {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await work();
        if (r.error) { setMessage({ error: true, text: r.error }); return; }
        done?.();
      } catch {
        setMessage({ error: true, text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  }

  function save(c: Column) {
    const price = parseDesignPrice(c.priceText);
    if (price === null) { setMessage({ error: true, text: `“${c.name}”: ราคาต่อโต๊ะไม่ถูกต้อง` }); return; }
    // What is SENT is what becomes "saved": an edit typed while the save
    // runs stays unsaved (review, 2026-09-24).
    const sent = snapshot(c);
    run(async () => {
      const r = await saveDraft(c.id, c.seen, { name: c.name, price, items: c.items });
      if (!r.error) update(c.id, (x) => ({ ...x, saved: sent, seen: r.updatedAt ?? x.seen }));
      // Someone else saved it: fetch their version, so “ทิ้งการแก้ไข” loads it.
      if (r.conflict) router.refresh();
      return r.conflict ? { error: `${r.error} (กด “ทิ้งการแก้ไข” ที่ชุดนี้เพื่อโหลดฉบับล่าสุด)` } : r;
    }, () => {
      setMessage({ error: false, text: `บันทึก “${c.name}” แล้ว` });
      router.refresh();
    });
  }

  function create(source: Parameters<typeof createDraft>[0]) {
    setShowNew(true);
    run(() => createDraft(source), () => router.refresh());
  }

  function remove(c: Column) {
    if (!window.confirm(`ลบชุดทดลอง “${c.name}”?`)) return;
    run(() => deleteDraft(c.id), () => router.refresh());
  }

  function discard(c: Column) {
    const d = drafts.find((x) => x.id === c.id);
    if (d) update(c.id, () => fromDraft(d));
    setMessage(null);
  }

  function makeReal() {
    if (!realDialog) return;
    const price = parseDesignPrice(realDialog.priceText);
    if (price === null || price <= 0) { setMessage({ error: true, text: "ใส่ราคาต่อโต๊ะก่อนทำเป็นชุดจริง" }); return; }
    const col = cols.find((c) => c.id === realDialog.id);
    if (!col) return;
    const { id, name } = realDialog;
    run(async () => {
      let seen = col.seen;
      // The column's own unsaved dishes are saved first, under the dialog's
      // name and price, so the real set is what the screen shows.
      if (dirty(col)) {
        const r = await saveDraft(id, seen, { name, price, items: col.items });
        if (r.error) return r;
        seen = r.updatedAt ?? seen;
        update(id, (x) => ({ ...x, seen }));
      }
      return makeDraftReal(id, seen, name, price);
    }, () => {
      setRealDialog(null);
      setMessage({ error: false, text: `“${name}” เป็นชุดจริงแล้ว — พนักงานขายเลือกใช้กับงานได้` });
      router.refresh();
    });
  }

  function toggleShown(id: string) {
    setShown((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= DESIGN_MAX_COLUMNS ? s : [...s, id]));
    setActive(0);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/owner/catering/set-menus", label: "ชุดเมนู" }}
        title="ออกแบบชุดเมนู"
        subtitle={<span>ชุดทดลองเปรียบเทียบกันได้ครั้งละ {DESIGN_MAX_COLUMNS} ชุด — เห็นเฉพาะ Owner และ Admin พนักงานขายไม่เห็นชุดทดลองและต้นทุน</span>}
      />

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <button type="button" disabled={pending} onClick={() => create({ from: "scratch" })} className={buttonClass("primary", { size: "sm" })}>
          + ชุดทดลองใหม่
        </button>
        <label className="text-sm text-neutral-700">
          เริ่มจากชุดจริง
          <select value={fromSet} onChange={(e) => setFromSet(e.target.value)} className="input-base ml-2 w-48">
            <option value="">— เลือก —</option>
            {realSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || !fromSet} onClick={() => create({ from: "set", id: fromSet })} className={buttonClass("secondary", { size: "sm" })}>
          คัดลอกมาเป็นชุดทดลอง
        </button>
        <label className="text-sm text-neutral-700">
          เริ่มจากชุดทดลอง
          <select value={fromDraftId} onChange={(e) => setFromDraftId(e.target.value)} className="input-base ml-2 w-48">
            <option value="">— เลือก —</option>
            {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || !fromDraftId} onClick={() => create({ from: "draft", id: fromDraftId })} className={buttonClass("secondary", { size: "sm" })}>
          คัดลอก
        </button>
      </div>

      {cols.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-600">แสดง (ไม่เกิน {DESIGN_MAX_COLUMNS} ชุด):</span>
          {cols.map((c) => (
            <label key={c.id} className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${shown.includes(c.id) ? "border-brand-green bg-brand-green-soft" : "border-neutral-300 bg-white"}`}>
              <input type="checkbox" checked={shown.includes(c.id)} onChange={() => toggleShown(c.id)}
                disabled={!shown.includes(c.id) && shown.length >= DESIGN_MAX_COLUMNS} />
              {c.name || "(ไม่มีชื่อ)"}{dirty(c) ? " •" : ""}
            </label>
          ))}
        </div>
      )}

      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" : "text-sm text-neutral-700"}>{message.text}</p>}

      {cols.length === 0 && <p className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">ยังไม่มีชุดทดลอง — เริ่มชุดใหม่ หรือคัดลอกจากชุดจริง</p>}

      {/* A phone shows one trial set at a time; this strip switches between them. */}
      {visible.length > 1 && (
        <div className="flex gap-1 overflow-x-auto lg:hidden" role="tablist" aria-label="ชุดทดลองที่แสดง">
          {visible.map((c, i) => (
            <button key={c.id} type="button" role="tab" aria-selected={i === Math.min(active, visible.length - 1)} aria-controls={`draft-${c.id}`} onClick={() => setActive(i)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${i === Math.min(active, visible.length - 1) ? "bg-brand-green text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}>
              {c.name || "(ไม่มีชื่อ)"}
            </button>
          ))}
        </div>
      )}

      <div className={`lg:grid lg:gap-4 ${GRID[Math.max(1, visible.length)]}`}>
        {visible.map((c, i) => (
          <DraftColumn
            key={c.id}
            col={c}
            hiddenOnPhone={i !== Math.min(active, visible.length - 1)}
            others={visible.filter((o) => o.id !== c.id)}
            facts={facts}
            dishOptions={dishOptions}
            dirty={dirty(c)}
            pending={pending}
            onChange={(fn) => update(c.id, fn)}
            onCopyTo={(index, targetId) => {
              const target = cols.find((o) => o.id === targetId);
              if (target) update(targetId, (t) => ({ ...t, items: copyDish(c.items, index, target.items) }));
            }}
            onMoveTo={(index, targetId) => {
              const target = cols.find((o) => o.id === targetId);
              if (!target) return;
              const [from, to] = moveDish(c.items, index, target.items);
              setCols((cs) => cs.map((o) => (o.id === c.id ? { ...o, items: from } : o.id === targetId ? { ...o, items: to } : o)));
            }}
            onSave={() => save(c)}
            onDiscard={() => discard(c)}
            onDelete={() => remove(c)}
            onMakeReal={() => setRealDialog({ id: c.id, name: c.name.replace(/ [(]ร่าง[)]$/, ""), priceText: c.priceText })}
          />
        ))}
      </div>

      {realDialog && <MakeRealDialog value={realDialog} pending={pending} onChange={setRealDialog} onCancel={() => setRealDialog(null)} onConfirm={makeReal} />}

      <p className="text-xs text-neutral-500">
        ชุดจริงแก้ต่อได้ที่ <Link href="/owner/catering/set-menus" className="underline">จัดการชุดเมนู</Link>
      </p>
    </div>
  );
}

function MakeRealDialog({ value, pending, onChange, onCancel, onConfirm }: {
  value: { id: string; name: string; priceText: string };
  pending: boolean;
  onChange: (v: { id: string; name: string; priceText: string }) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="ทำเป็นชุดจริง">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="font-heading text-lg font-semibold text-neutral-900">ทำเป็นชุดจริง</h2>
        <p className="text-sm text-neutral-600">เมื่อเป็นชุดจริงแล้ว พนักงานขายเลือกใช้กับงานได้ และจะเปลี่ยนกลับเป็นชุดทดลองไม่ได้</p>
        <label className="block text-sm text-neutral-700">ชื่อชุดเมนู
          <input ref={nameRef} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} className="input-base mt-1 block w-full" />
        </label>
        <label className="block text-sm text-neutral-700">ราคาต่อโต๊ะ (บาท)
          <input value={value.priceText} onChange={(e) => onChange({ ...value, priceText: e.target.value })} inputMode="decimal" className="input-base mt-1 block w-full" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass("secondary")}>ยกเลิก</button>
          <button type="button" disabled={pending} onClick={onConfirm} className={buttonClass("primary")}>ทำเป็นชุดจริง</button>
        </div>
      </div>
    </div>
  );
}

/**
 * A portion field that keeps what is typed ("0.", "", "1.2") and takes the
 * number only when it is one a set can hold, saying why next to the dish
 * when it is not (review, 2026-09-24: a number field that snapped back on
 * every other keystroke could not take 0.5).
 */
function QtyInput({ value, label, onValid }: { value: number; label: string; onValid: (q: number) => void }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  const error = text.trim() === "" ? "ใส่จำนวน" : menuLineQuantityError("dish", Number(text));
  return (
    <span className="flex w-16 shrink-0 flex-col items-end">
      <input value={text} inputMode="decimal" aria-label={label} aria-invalid={error !== null} title={error ?? undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && menuLineQuantityError("dish", n) === null) onValid(n);
        }}
        className={`input-base w-full text-right ${error ? "border-danger" : ""}`} />
      {/* Short under the field; the whole rule is its tooltip and the save's message. */}
      {error && <span className="text-right text-[11px] leading-tight text-danger">ไม่ถูกต้อง</span>}
    </span>
  );
}

function DraftColumn({ col, hiddenOnPhone, others, facts, dishOptions, dirty, pending, onChange, onCopyTo, onMoveTo, onSave, onDiscard, onDelete, onMakeReal }: {
  col: Column;
  hiddenOnPhone: boolean;
  others: Column[];
  facts: Map<string, DishFacts>;
  dishOptions: DishCostOption[];
  dirty: boolean;
  pending: boolean;
  onChange: (fn: (c: Column) => Column) => void;
  onCopyTo: (index: number, targetId: string) => void;
  onMoveTo: (index: number, targetId: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onMakeReal: () => void;
}) {
  const [search, setSearch] = useState("");
  // The dish the search will REPLACE, when "เปลี่ยน" was pressed on one; else it adds.
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const price = parseDesignPrice(col.priceText) ?? 0;
  const fig = designFigures(col.items, price, facts);
  const comparison = setVsAlaCarte(fig.dishesTotal, price > 0 ? price : null);
  const needle = search.trim().toLowerCase();
  const matches = needle === "" ? [] : dishOptions.filter((d) => d.name.toLowerCase().includes(needle)).slice(0, 8);
  const setItems = (items: DesignDish[]) => onChange((c) => ({ ...c, items }));
  const swapping = swapIndex !== null && swapIndex < col.items.length ? col.items[swapIndex] : null;

  function pick(d: DishCostOption) {
    if (swapping && swapIndex !== null) setItems(swapDish(col.items, swapIndex, d.id));
    else setItems(addDish(col.items, { menu_id: d.id, quantity: 1, section: "dish", note: null }));
    setSearch("");
    setSwapIndex(null);
  }

  return (
    <section id={`draft-${col.id}`} aria-label={col.name || "ชุดทดลอง"} className={`space-y-3 rounded-lg border border-neutral-200 bg-white p-3 ${hiddenOnPhone ? "hidden lg:block" : ""}`}>
      <input value={col.name} onChange={(e) => onChange((c) => ({ ...c, name: e.target.value }))} aria-label="ชื่อชุดทดลอง"
        className="input-base block w-full font-medium" />
      <label className="block text-sm text-neutral-700">ราคาต่อโต๊ะ (บาท)
        <input value={col.priceText} onChange={(e) => onChange((c) => ({ ...c, priceText: e.target.value }))} inputMode="decimal"
          className="input-base mt-1 block w-full tabular-nums" />
      </label>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-neutral-50 p-2 text-sm">
        <dt className="text-neutral-600">ต้นทุนต่อโต๊ะ</dt><dd className="text-right tabular-nums">฿{baht(fig.costPerTable)}</dd>
        <dt className="text-neutral-600">ราคาต่อโต๊ะ</dt><dd className="text-right tabular-nums">฿{baht(price)}</dd>
        <dt className="text-neutral-600">Food cost</dt><dd className="text-right font-medium tabular-nums">{fig.foodCostPct != null ? `${fig.foodCostPct.toFixed(1)}%` : "–"}</dd>
        <dt className="text-neutral-600">กำไรต่อโต๊ะ</dt><dd className={`text-right font-medium tabular-nums ${fig.margin < 0 ? "text-danger" : ""}`}>฿{baht(fig.margin)}</dd>
        <dt className="text-neutral-600">สั่งแยกจาน</dt><dd className="text-right tabular-nums">฿{baht(fig.dishesTotal)}</dd>
      </dl>
      {comparison && <p className="text-xs text-neutral-600">{comparisonText(comparison)}</p>}
      {fig.hasUnknownCost && <p className="text-xs text-pending-ink">⚠ มีเมนูที่ยังไม่ทราบต้นทุน — ต้นทุนจริงสูงกว่าตัวเลขนี้</p>}

      {EVENT_MENU_SECTION_LIST.map((section) => {
        const rows = col.items.map((it, index) => ({ it, index })).filter(({ it }) => it.section === section.value);
        if (rows.length === 0) return null;
        return (
          <div key={section.value} className="space-y-1.5">
            <h3 className="text-xs font-semibold text-brand-green">{section.label}</h3>
            {rows.map(({ it, index }) => {
              const f = facts.get(it.menu_id);
              return (
                <div key={it.menu_id} className={`rounded-md border p-2 text-sm ${swapIndex === index ? "border-brand-green" : "border-neutral-100"}`}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 pt-1.5">{f?.name ?? "เมนูที่ไม่พบ"}{f?.has_unknown_cost && <span className="text-pending-ink" title="ต้นทุนไม่ทราบ"> ⚠</span>}</span>
                    <QtyInput value={it.quantity} label={`จำนวนต่อโต๊ะ ${f?.name ?? ""}`}
                      onValid={(q) => setItems(col.items.map((x, i) => (i === index ? { ...x, quantity: q } : x)))} />
                    <span className="w-20 pt-1.5 text-right text-xs tabular-nums text-neutral-500">฿{baht((f?.unit_cost ?? 0) * it.quantity)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    <select value={it.section} aria-label="หมวด" onChange={(e) => setItems(col.items.map((x, i) => (i === index ? { ...x, section: e.target.value } : x)))}
                      className="input-base py-0.5 text-xs">
                      {EVENT_MENU_SECTION_LIST.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setSwapIndex(swapIndex === index ? null : index)} className={buttonClass("link", { size: "sm" })}>
                      {swapIndex === index ? "ยกเลิกเปลี่ยน" : "เปลี่ยน"}
                    </button>
                    {others.length > 0 && (
                      <>
                        <select value="" aria-label="คัดลอกไปชุดอื่น" onChange={(e) => e.target.value && onCopyTo(index, e.target.value)} className="input-base max-w-28 py-0.5 text-xs">
                          <option value="">คัดลอกไป…</option>
                          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <select value="" aria-label="ย้ายไปชุดอื่น" onChange={(e) => e.target.value && onMoveTo(index, e.target.value)} className="input-base max-w-28 py-0.5 text-xs">
                          <option value="">ย้ายไป…</option>
                          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </>
                    )}
                    <button type="button" onClick={() => setItems(removeDish(col.items, index))} className={buttonClass("link", { size: "sm", dangerHover: true })}>ลบ</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="space-y-1">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={swapping ? `เปลี่ยน “${facts.get(swapping.menu_id)?.name ?? ""}” เป็น… (พิมพ์ชื่อ)` : "+ เพิ่มเมนู (พิมพ์ชื่อ)"}
          aria-label={swapping ? "ค้นหาเมนูที่จะเปลี่ยนเป็น" : "ค้นหาเมนูเพื่อเพิ่ม"} className="input-base block w-full text-sm" />
        {matches.length > 0 && (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-neutral-200 text-sm">
            {matches.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => pick(d)} className="flex w-full justify-between px-2 py-1 text-left hover:bg-neutral-50">
                  <span>{d.name}</span><span className="text-xs tabular-nums text-neutral-500">ต้นทุน ฿{baht(d.unit_cost)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-2">
        <button type="button" disabled={pending || !dirty} onClick={onSave} className={buttonClass("primary", { size: "sm" })}>{dirty ? "บันทึก" : "บันทึกแล้ว"}</button>
        {dirty && <button type="button" disabled={pending} onClick={onDiscard} className={buttonClass("secondary", { size: "sm" })}>ทิ้งการแก้ไข</button>}
        <button type="button" disabled={pending} onClick={onMakeReal} className={buttonClass("secondary", { size: "sm" })}>ทำเป็นชุดจริง</button>
        <button type="button" disabled={pending} onClick={onDelete} className={buttonClass("link", { size: "sm", danger: true })}>ลบชุดทดลอง</button>
      </div>
    </section>
  );
}
