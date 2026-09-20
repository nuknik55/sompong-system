"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CateringDishOption, EventMenuActionResult, EventMenuSource, EventMenuSources } from "../../actions";
import { getEventMenuSourceDishes, listEventMenuSources, saveEventMenus } from "../../actions";
import { fmtBaht, toNum, StatusBadge, thDate, thFullDate } from "../../shared-utils";
import {
  applySourceDishes, comparisonHeadline, comparisonText, COMPARISON_LABEL, dishLineTotalText, dishesTotalPerTable, draftDishes,
  draftFromLine, draftPrice, draftsEqual, foodCostFigure, lineFoodCost, newCustomLineDraft, setVsAlaCarte, swapPriceWarning,
  swapWarningText, toSavePayload, validateDrafts, EVENT_MENU_SECTION_LABELS, EVENT_MENU_SECTION_LIST,
  type DraftDish, type EventMenuSection, type EventMenuView, type LineDraft,
} from "../../event-menu";

/**
 * The booking's own menu, one card per set line, EDITED AS A DRAFT (Nik):
 * every swap, quantity, removal, addition, fill-from-source, new custom set
 * and the price per table is held here, the figures follow live, and one
 * บันทึก sends the changed lines to saveEventMenus — which the database writes
 * in one transaction. ยกเลิก puts the screen back to how it opened; leaving
 * with unsaved changes asks first.
 *
 * ONE FLAT LIST PER SET, ONE PICKER (Nik, 2026-09-19: "it works, but you have
 * to be familiar with it"). No section groupings here — a course keeps the
 * section it was copied with, a course added here is a dish, and the
 * printed documents go on grouping by the column as before.
 *
 * What this component may do is decided by the view it is given (canEdit,
 * dishCostById) and nowhere here: a sales session's view carries no cost map
 * and canEdit false, a locked booking's view carries canEdit false for
 * everyone. The save action checks the same two things again.
 */

const RESULT_ERROR = "ทำไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";
const LEAVE_MSG = "มีการแก้ไขที่ยังไม่ได้บันทึก — ออกจากหน้านี้โดยไม่บันทึกหรือไม่?";
const REPLACE_MSG = "ชุดนี้มีรายการอาหารอยู่แล้ว — แทนที่ทั้งหมดด้วยรายการที่เลือกหรือไม่? (มีผลเมื่อกดบันทึก)";
const CLEAR_MSG = "ลบรายการอาหารทั้งหมดของชุดนี้ออกจากหน้าจอ แล้วเริ่มเลือกใหม่ตั้งแต่ต้นหรือไม่? (มีผลเมื่อกดบันทึก)";

type Header = { backHref: string; backLabel: string; status: string; date: string };
type Quote = { number: string; revision: number } | null;

export function EventMenuClient(props: {
  eventId: string;
  /** viewVersion(view): changes when the data does, so a refresh after a save remounts the editor with a clean draft. */
  version: string;
  header: Header;
  view: EventMenuView;
  dishOptions: CateringDishOption[];
  quote: Quote;
}) {
  // Lives OUTSIDE the keyed editor so "saved" is still on screen after the
  // remount that a successful save causes.
  const [notice, setNotice] = useState<string | null>(null);
  return <EventMenuEditor {...props} notice={notice} onNotice={setNotice} />;
}

function EventMenuEditor({
  eventId, version, header, view, dishOptions, quote, notice, onNotice,
}: {
  eventId: string;
  version: string;
  header: Header;
  view: EventMenuView;
  dishOptions: CateringDishOption[];
  quote: Quote;
  notice: string | null;
  onNotice: (n: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const baseline = useMemo(() => view.lines.map(draftFromLine), [view.lines]);
  const [drafts, setDrafts] = useState<LineDraft[]>(baseline);
  // NEW SERVER DATA IS ADOPTED ONLY WHEN IT CANNOT COST THE PERSON ANYTHING:
  // when the draft is clean, or when the data is their own save landing. A
  // refresh that arrives while they are mid-edit — another tab's save, a
  // session-cookie refresh re-rendering the page — keeps the draft and says
  // the data moved (review, 2026-09-19: a keyed remount threw the draft
  // away). React's "adjust state on prop change" pattern, during render.
  const [seenVersion, setSeenVersion] = useState(version);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const dirty = !draftsEqual(baseline, drafts);
  if (version !== seenVersion && (!dirty || awaitingRefresh)) {
    setSeenVersion(version);
    setDrafts(baseline);
    setAwaitingRefresh(false);
    setCreating(false);
  }
  const serverMoved = version !== seenVersion;
  const problem = validateDrafts(drafts);
  const canEdit = view.canEdit;

  // Leaving asks first while dirty. Two ways out, two guards: the browser
  // (close, reload, typed URL) fires beforeunload; an in-app link — this
  // page's back link, the nav bar, anything rendered outside this component
  // — never does, so every click on an internal link is caught in the
  // capture phase before Next.js sees it. The browser's own back button is
  // not caught (popstate cannot be refused); that is the one path that
  // leaves without asking.
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: globalThis.MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#") || (/^[a-z]+:/i.test(href) && !href.startsWith(location.origin))) return;
      if (!window.confirm(LEAVE_MSG)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  function updateLine(key: string, fn: (d: LineDraft) => LineDraft) {
    onNotice(null);
    setError(null);
    setDrafts((ds) => ds.map((d) => (d.key === key ? fn(d) : d)));
  }
  function addLine(d: LineDraft) {
    onNotice(null);
    setDrafts((ds) => [...ds, d]);
    setCreating(false);
  }
  function removeNewLine(key: string) {
    setDrafts((ds) => ds.filter((d) => d.key !== key));
  }
  function cancel() {
    // Back to how the page opened — or, when the server moved underneath,
    // to what it holds now.
    setDrafts(baseline);
    setSeenVersion(version);
    setError(null);
    setCreating(false);
  }
  function save() {
    if (!dirty || problem) return;
    setError(null);
    startTransition(async () => {
      try {
        const res: EventMenuActionResult = await saveEventMenus(eventId, toSavePayload(drafts, baseline));
        if (res.status === "error") { setError(res.message); return; }
        setAwaitingRefresh(true);
        onNotice("บันทึกรายการอาหารของงานแล้ว");
        router.refresh();
      } catch {
        // The answer was lost, not necessarily the save: fetch what the server
        // holds. A clean draft adopts it; a dirty one keeps editing over it.
        setError(RESULT_ERROR);
        router.refresh();
      }
    });
  }
  const existingNames = drafts.map((d) => d.name);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={header.backHref} className="text-sm text-neutral-400 hover:text-neutral-700">{header.backLabel}</Link>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">รายการอาหารของงาน</h1>
          <StatusBadge status={header.status} />
          <span className="text-sm text-neutral-500">{thFullDate(header.date)}</span>
        </div>
        {dirty && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">มีการแก้ไขที่ยังไม่บันทึก</span>}
      </div>

      {view.locked && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          🔒 ต้นทุนของงานนี้ถูกล็อกแล้ว — รายการอาหารและราคาต่อโต๊ะถูกตรึงไว้ แก้ไขไม่ได้จนกว่าจะปลดล็อกในหน้าต้นทุน-กำไร
        </div>
      )}
      {!view.locked && !canEdit && (
        <p className="text-xs text-neutral-500">ดูได้อย่างเดียว — เจ้าของร้านและผู้จัดการเป็นผู้แก้ไขรายการอาหารของงาน</p>
      )}
      {canEdit && !view.locked && (
        // The one sentence a first-time user needs. Everything else on the
        // page is a button that says what it does.
        <p className="text-xs text-neutral-500">
          แก้ไขได้เลย — เปลี่ยน ลบ เพิ่มเมนู หรือแก้ราคาต่อโต๊ะ ตัวเลขจะเปลี่ยนทันที แล้วกด <b>บันทึก</b> ด้านล่างครั้งเดียวเมื่อเสร็จ
        </p>
      )}
      {serverMoved && dirty && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ข้อมูลของงานนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — กด <b>ยกเลิก</b> เพื่อโหลดข้อมูลล่าสุด (การแก้ไขที่ค้างอยู่จะหาย) หรือบันทึกต่อ ระบบจะปฏิเสธเฉพาะชุดที่ถูกแก้ไขชนกัน
        </div>
      )}
      {notice && !dirty && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          ✓ {notice}
          <button type="button" onClick={() => onNotice(null)} className="ml-2 text-green-500 hover:text-green-700">✕</button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {drafts.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          งานนี้ยังไม่มีชุดเมนู — เพิ่มชุดเมนูในกล่องราคาของหน้าจอง หรือกด “สร้างชุดเมนูเอง” ด้านล่าง
        </p>
      )}

      {drafts.map((d) => (
        <LineCard
          key={d.key}
          eventId={eventId}
          draft={d}
          baseline={baseline.find((b) => b.key === d.key) ?? null}
          canEdit={canEdit}
          costById={view.dishCostById}
          dishOptions={dishOptions}
          quote={quote}
          isPending={isPending}
          onChange={(fn) => updateLine(d.key, fn)}
          onRemoveNew={() => removeNewLine(d.key)}
        />
      ))}

      {/* A3: behind a button, closed by default — a booking that already has
          its set should not see an open form under it. A6: more than one set
          per booking stays (ten normal tables and two vegetarian). */}
      {canEdit && !creating && (
        <button type="button" onClick={() => setCreating(true)}
          className="rounded-lg border border-dashed border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
          + สร้างชุดเมนูเอง
        </button>
      )}
      {canEdit && creating && (
        <NewCustomSetForm existingNames={existingNames} isPending={isPending} onAdd={addLine} onCancel={() => setCreating(false)} />
      )}

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <p className={`text-sm ${problem ? "text-red-700" : dirty ? "text-amber-800" : "text-neutral-500"}`}>
            {problem ?? (dirty ? "มีการแก้ไขที่ยังไม่บันทึก — กดบันทึกเพื่อเก็บทั้งหมดพร้อมกัน" : "ไม่มีการแก้ไข")}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} disabled={!dirty || isPending}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={!dirty || !!problem || isPending}
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {isPending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One set line ─────────────────────────────────────────────────────────────

function LineCard({
  eventId, draft, baseline, canEdit, costById, dishOptions, quote, isPending, onChange, onRemoveNew,
}: {
  eventId: string;
  draft: LineDraft;
  baseline: LineDraft | null;
  canEdit: boolean;
  costById: EventMenuView["dishCostById"];
  dishOptions: CateringDishOption[];
  quote: Quote;
  isPending: boolean;
  onChange: (fn: (d: LineDraft) => LineDraft) => void;
  onRemoveNew: () => void;
}) {
  const [chooser, setChooser] = useState(false);
  const [sources, setSources] = useState<EventMenuSources | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const dishes = draftDishes(draft);
  const price = draftPrice(draft);
  const alaCarte = dishesTotalPerTable(dishes);
  const comparison = setVsAlaCarte(alaCarte, price);
  const cost = costById ? lineFoodCost(dishes, costById) : null;
  const legacy = draft.source === "shared" && !draft.materialize;
  const priceChanged = baseline != null && draftPrice(baseline) !== price;

  function openChooser() {
    setLocalError(null);
    setChooser(true);
    if (sources) return;
    startLoading(async () => {
      try { setSources(await listEventMenuSources(eventId)); }
      catch (err) { setLocalError(err instanceof Error ? err.message : RESULT_ERROR); setChooser(false); }
    });
  }
  function pickSource(source: EventMenuSource) {
    startLoading(async () => {
      try {
        const got = await getEventMenuSourceDishes(source);
        if (draft.dishes.length > 0 && !window.confirm(REPLACE_MSG)) return;
        const prov = source.kind === "set" ? { set_menu_id: source.setMenuId } : { event_menu_id: source.eventMenuId };
        onChange((d) => applySourceDishes(d, got.dishes, prov, () => crypto.randomUUID()));
        setChooser(false);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : RESULT_ERROR);
      }
    });
  }
  function startEmpty() {
    if (draft.dishes.length > 0 && !window.confirm(CLEAR_MSG)) return;
    onChange((d) => ({ ...d, materialize: true, dishes: [] }));
  }
  // A1: the one picker. A course lands at the END of the list, as a dish —
  // the section column stays for the printed documents and is not chosen here.
  function addDish(menuId: string) {
    const opt = dishOptions.find((o) => o.id === menuId);
    if (!opt) return;
    if (draft.dishes.some((x) => x.menu_id === menuId)) { setLocalError(`${opt.name} อยู่ในชุดนี้แล้ว`); return; }
    setLocalError(null);
    onChange((d) => ({
      ...d, materialize: true,
      dishes: [...d.dishes, { key: crypto.randomUUID(), menu_id: opt.id, menu_name: opt.name, selling_price: opt.selling_price, quantity: "1", section: "dish", note: null, source_set_menu_id: null, source_event_menu_id: null }],
    }));
  }
  function swapDish(key: string, opt: CateringDishOption) {
    if (draft.dishes.some((x) => x.key !== key && x.menu_id === opt.id)) { setLocalError(`${opt.name} อยู่ในชุดนี้แล้ว`); return; }
    setLocalError(null);
    // A swapped course is the person's choice, not the source's: provenance is cleared. Its section stays.
    onChange((d) => ({
      ...d, materialize: true,
      dishes: d.dishes.map((x) => (x.key === key ? { ...x, menu_id: opt.id, menu_name: opt.name, selling_price: opt.selling_price, source_set_menu_id: null, source_event_menu_id: null } : x)),
    }));
  }
  function setQuantity(key: string, quantity: string) {
    onChange((d) => ({ ...d, materialize: true, dishes: d.dishes.map((x) => (x.key === key ? { ...x, quantity } : x)) }));
  }
  // The group the three documents print this course under. A draft edit like
  // any other: it follows บันทึก, ยกเลิก puts it back, and the save carries it
  // to catering_event_menu_items.section, which the kitchen sheet and the
  // function sheet group by and the quotation orders by (Nik, 2026-09-20).
  function setSection(key: string, section: string) {
    onChange((d) => ({ ...d, materialize: true, dishes: d.dishes.map((x) => (x.key === key ? { ...x, section } : x)) }));
  }
  function removeDish(key: string) {
    setLocalError(null);
    onChange((d) => ({ ...d, materialize: true, dishes: d.dishes.filter((x) => x.key !== key) }));
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-neutral-900">{draft.name}</p>
          <p className="text-xs text-neutral-500 tabular-nums">
            {fmtBaht(draft.tables)} โต๊ะ
            {draft.eventMenuId == null && <span className="text-neutral-400"> · ตั้งจำนวนโต๊ะจริงในกล่องราคาของหน้าจองหลังบันทึก</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <SourceBadge draft={draft} />
            {draft.eventMenuId == null && (
              <button type="button" onClick={onRemoveNew} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50" title="เอาชุดที่ยังไม่บันทึกนี้ออก">✕</button>
            )}
          </div>
          {canEdit ? (
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              ราคาต่อโต๊ะ
              <input
                type="text" inputMode="decimal" value={draft.price} disabled={isPending}
                onChange={(e) => onChange((d) => ({ ...d, price: e.target.value.replace(/[^0-9.]/g, "") }))}
                className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-sm tabular-nums"
                title="ราคาเดียวกับกล่องราคาในหน้าจอง — แก้ที่นี่ หน้าจองและใบเสนอราคาเปลี่ยนตาม"
              />
            </label>
          ) : (
            <p className="text-sm text-neutral-700 tabular-nums">{price != null ? `฿${fmtBaht(price)} / โต๊ะ` : "ไม่มีราคาต่อโต๊ะ"}</p>
          )}
        </div>
      </div>

      {canEdit && quote && (priceChanged || draft.eventMenuId == null) && (
        // Two totals exist once a quotation is issued: the printed document
        // reads the live rows and follows this save at once; quoted_total —
        // the figure the cost page and the lock use — is the last ISSUED
        // revision's until it is re-issued on the booking screen.
        <p className="mx-4 mt-2 text-xs text-amber-800">
          ใบเสนอราคา {quote.number}{quote.revision > 0 ? ` (แก้ไขครั้งที่ ${quote.revision})` : ""} ออกไว้แล้ว — เอกสารที่พิมพ์จะแสดงราคาใหม่ทันทีที่บันทึก แต่ยอดที่บันทึกไว้กับใบเสนอราคา (ที่หน้าต้นทุน-กำไรใช้) ยังเป็นยอดเดิมจนกว่าจะกด “บันทึกและออกใบเสนอราคาใหม่” ในหน้าจอง
        </p>
      )}

      {legacy && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          รายการนี้ยังอ่านจากชุดเมนูกลาง (จองไว้ก่อนมีระบบสำเนา) — ถ้าชุดเมนูกลางเปลี่ยน รายการที่แสดงจะเปลี่ยนตาม
          {canEdit && (
            <>
              {" "}แก้ไขรายการใดก็ได้แล้วบันทึก จะเก็บเป็นของงานนี้ หรือ
              <button type="button" disabled={isPending} onClick={() => onChange((d) => ({ ...d, materialize: true }))}
                className="ml-1 rounded bg-amber-700 px-2 py-0.5 text-white hover:bg-amber-800 disabled:opacity-50">
                เก็บตามที่แสดงเป็นของงานนี้
              </button>
            </>
          )}
        </div>
      )}

      {canEdit && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" disabled={isPending || loading} onClick={openChooser}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            คัดลอกรายการอาหารจาก…
          </button>
          {draft.dishes.length > 0 && (
            <button type="button" disabled={isPending} onClick={startEmpty}
              className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              ล้างรายการ แล้วเริ่มจากว่าง
            </button>
          )}
          {localError && <span className="text-red-700">{localError}</span>}
        </div>
      )}

      {chooser && (
        <SourceChooser sources={sources} loading={loading || isPending} onPick={pickSource} onClose={() => setChooser(false)} />
      )}

      {/* A2: one flat list, in the order the courses were added. */}
      <div className="px-4 py-3">
        {draft.dishes.length === 0 && (
          <p className="text-sm text-neutral-400">
            {canEdit ? "ยังไม่มีรายการอาหารในชุดนี้ — เลือกเมนูด้านล่าง หรือคัดลอกจากชุดมาตรฐาน / การจองอื่น" : "ยังไม่มีรายการอาหารในชุดนี้"}
          </p>
        )}
        <ul className="divide-y divide-neutral-100">
          {draft.dishes.map((x, i) => (
            <DishRow key={x.key} dish={x} index={i + 1} editable={canEdit} isPending={isPending} dishOptions={dishOptions}
              onQuantity={(q) => setQuantity(x.key, q)} onSection={(s) => setSection(x.key, s)} onSwap={(opt) => swapDish(x.key, opt)} onRemove={() => removeDish(x.key)} />
          ))}
        </ul>
        {canEdit && <AddDishRow isPending={isPending} dishOptions={dishOptions} onAdd={addDish} />}
      </div>

      {/* Figures, live from the draft. The à-la-carte total and the comparison
          are customer-price facts and show for every reader; the cost block
          renders only when the view carried the cost map, which it does for
          owner and admin alone. */}
      <div className="grid gap-3 border-t border-neutral-100 px-4 py-3 sm:grid-cols-3">
        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-xs text-neutral-500">ราคาสั่งแยกจานรวม / โต๊ะ</p>
          <p className="tabular-nums font-medium text-neutral-800">฿{fmtBaht(alaCarte)}</p>
          <p className="mt-0.5 text-xs text-neutral-500">รวมจากแต่ละบรรทัด (ราคา × จำนวนต่อโต๊ะ)</p>
        </div>
        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-xs text-neutral-500">{COMPARISON_LABEL}</p>
          <p className={`tabular-nums font-medium ${comparison?.direction === "below" ? "text-green-700" : "text-neutral-800"}`}>
            {comparisonHeadline(comparison)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{comparisonText(comparison)}</p>
        </div>
        {cost && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
            <p className="text-xs font-medium text-amber-800">ต้นทุนอาหาร (Admin/Owner เท่านั้น)</p>
            <p className="tabular-nums font-medium text-neutral-800">
              ฿{fmtBaht(cost.costPerTable)} / โต๊ะ
              {foodCostFigure(cost.costPerTable, price).pct != null && <> · {foodCostFigure(cost.costPerTable, price).pct!.toFixed(2)}% ของราคาชุด</>}
            </p>
            {cost.hasUnknownCost && <p className="mt-0.5 text-xs text-amber-700">⚠ มีเมนูที่ยังไม่ทราบต้นทุนแน่ชัด ตัวเลขอาจต่ำกว่าความจริง</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ draft }: { draft: LineDraft }) {
  const cls = "rounded-full border px-2 py-0.5 text-xs";
  if (draft.eventMenuId == null) return <span className={`${cls} border-blue-200 bg-blue-50 text-blue-700`}>ชุดใหม่ · ยังไม่บันทึก</span>;
  if (draft.source === "shared" && draft.materialize) return <span className={`${cls} border-green-200 bg-green-50 text-green-700`}>จะเก็บเป็นของงานนี้เมื่อบันทึก</span>;
  if (draft.source === "shared") return <span className={`${cls} border-amber-200 bg-amber-50 text-amber-700`}>ยังใช้ชุดเมนูกลาง</span>;
  if (draft.source === "copy" && draft.sourceSetMenuId) return <span className={`${cls} border-green-200 bg-green-50 text-green-700`}>คัดลอกจากชุดเมนู · แก้ไขแยกจากชุดกลาง</span>;
  if (draft.source === "copy") return <span className={`${cls} border-blue-200 bg-blue-50 text-blue-700`}>ชุดของงานนี้</span>;
  return <span className={`${cls} border-neutral-200 bg-neutral-50 text-neutral-500`}>ยังไม่มีรายการ</span>;
}

// ── The chooser: a standard set, or another booking's own list ──────────────

function SourceChooser({
  sources, loading, onPick, onClose,
}: {
  sources: EventMenuSources | null;
  loading: boolean;
  onPick: (source: EventMenuSource) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"sets" | "bookings">("sets");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // Every booking, newest first (the server orders them); the search narrows
  // by the booking's name. No window: an old booking is exactly what someone
  // wants to repeat.
  const bookings = (sources?.bookings ?? []).filter((b) => q === "" || (b.customer_name ?? "").toLowerCase().includes(q));
  return (
    <div className="mx-4 mt-3 rounded-lg border border-neutral-300 bg-neutral-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-xs">
          {/* `loading` also covers a save in flight: nothing may change the draft while it is being written. */}
          <button type="button" onClick={() => setTab("sets")} className={`rounded px-2.5 py-1 ${tab === "sets" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}>ชุดเมนูมาตรฐาน</button>
          <button type="button" onClick={() => setTab("bookings")} className={`rounded px-2.5 py-1 ${tab === "bookings" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}>การจองอื่น</button>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-800">ปิด</button>
      </div>
      <p className="mb-2 text-xs text-neutral-500">เลือกหนึ่งรายการ — รายการอาหารของชุดนั้นจะมาแทนที่รายการในชุดนี้ (มีผลเมื่อกดบันทึก)</p>
      {loading && !sources && <p className="text-xs text-neutral-500">กำลังโหลด…</p>}
      {sources && tab === "sets" && (
        <ul className="max-h-64 divide-y divide-neutral-200 overflow-y-auto rounded border border-neutral-200 bg-white">
          {sources.sets.length === 0 && <li className="px-3 py-2 text-xs text-neutral-400">ไม่มีชุดเมนูมาตรฐานที่เปิดใช้</li>}
          {sources.sets.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={loading} onClick={() => onPick({ kind: "set", setMenuId: s.id })}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50">
                <span className="text-neutral-800">{s.name}</span>
                <span className="text-xs text-neutral-500 tabular-nums">฿{fmtBaht(s.price_per_set)} · {s.dish_count} รายการ</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sources && tab === "bookings" && (
        <div className="space-y-2">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อการจอง (ชื่อลูกค้า)…"
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm" />
          <ul className="max-h-72 divide-y divide-neutral-200 overflow-y-auto rounded border border-neutral-200 bg-white">
            {bookings.length === 0 && <li className="px-3 py-2 text-xs text-neutral-400">{q ? "ไม่พบการจองที่ตรงกับคำค้น" : "ยังไม่มีการจองอื่นที่มีชุดเมนู"}</li>}
            {bookings.map((b) => (
              <li key={b.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="tabular-nums">{thDate(b.event_date)}</span>
                  <span className="font-medium text-neutral-800">{b.customer_name ?? "ไม่ระบุลูกค้า"}</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {b.lines.map((l) => (
                    <button key={l.id} type="button" disabled={loading} onClick={() => onPick({ kind: "line", eventId: b.id, eventMenuId: l.id })}
                      className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
                      {l.name} · {fmtBaht(l.tables)} โต๊ะ
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── A course ─────────────────────────────────────────────────────────────────

function DishRow({
  dish, index, editable, isPending, dishOptions, onQuantity, onSection, onSwap, onRemove,
}: {
  dish: DraftDish;
  index: number;
  editable: boolean;
  isPending: boolean;
  dishOptions: CateringDishOption[];
  onQuantity: (q: string) => void;
  onSection: (section: string) => void;
  onSwap: (opt: CateringDishOption) => void;
  onRemove: () => void;
}) {
  const [swapping, setSwapping] = useState(false);
  const [pick, setPick] = useState("");
  const picked = dishOptions.find((d) => d.id === pick);
  const warning = picked ? swapPriceWarning(dish.selling_price, picked.selling_price) : null;
  const qty = toNum(dish.quantity);
  const figure = { selling_price: dish.selling_price, quantity: qty != null && qty > 0 ? qty : 0 };

  return (
    <li className="py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-right text-xs text-neutral-400 tabular-nums">{index}.</span>
        <span className="flex-1 text-neutral-800">{dish.menu_name}</span>
        {/* The group this course prints under on the kitchen sheet, the
            function sheet and the quotation. NOT a grouping of this screen
            (A2): the list stays flat and in the order courses were added —
            this is one field of the row, the way จำนวน is. A new course is
            รายการอาหาร; a copied one keeps what it came with. */}
        {editable ? (
          <select
            value={dish.section} disabled={isPending}
            onChange={(e) => onSection(e.target.value)}
            title="หมวดที่รายการนี้จะพิมพ์อยู่ในใบฟังก์ชั่นงานและใบเสนอราคา"
            className="rounded border border-neutral-300 px-1 py-0.5 text-xs text-neutral-600"
          >
            {EVENT_MENU_SECTION_LIST.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : (
          dish.section !== "dish" && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              {EVENT_MENU_SECTION_LABELS[dish.section as EventMenuSection] ?? dish.section}
            </span>
          )
        )}
        {/* B7: the row's own arithmetic — "฿250.00 × 5 = ฿1,250.00" — so the rows add up to the total below them. */}
        <span className="text-xs text-neutral-600 tabular-nums">{figure.quantity > 0 ? dishLineTotalText(figure) : `฿${fmtBaht(dish.selling_price)} × ?`}</span>
        {editable ? (
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            <span>× </span>
            <input
              type="text" inputMode="decimal" value={dish.quantity} disabled={isPending}
              onChange={(e) => onQuantity(e.target.value.replace(/[^0-9.]/g, ""))}
              title="จำนวนต่อโต๊ะ"
              className={`w-12 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums ${qty != null && qty > 0 ? "border-neutral-300" : "border-red-400"}`}
            />
          </label>
        ) : (
          <span className="w-14 text-right text-xs text-neutral-500 tabular-nums">× {dish.quantity}</span>
        )}
        {editable && (
          <>
            <button type="button" disabled={isPending} onClick={() => { setSwapping((s) => !s); setPick(""); }}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              {swapping ? "ยกเลิก" : "เปลี่ยนเมนู"}
            </button>
            <button type="button" disabled={isPending} onClick={onRemove}
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
            onClick={() => { if (picked) onSwap(picked); setSwapping(false); setPick(""); }}
            className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            ยืนยันเปลี่ยนเป็นเมนูนี้
          </button>
        </div>
      )}
    </li>
  );
}

/** A1: the ONE picker for the whole set. */
function AddDishRow({ isPending, dishOptions, onAdd }: { isPending: boolean; dishOptions: CateringDishOption[]; onAdd: (menuId: string) => void }) {
  const [pick, setPick] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-2">
      <DishSelect value={pick} onChange={setPick} dishOptions={dishOptions} placeholder="+ เลือกเมนูที่จะเพิ่ม…" />
      <button type="button" disabled={isPending || !pick}
        onClick={() => { const id = pick; setPick(""); onAdd(id); }}
        className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
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

// ── สร้างชุดเมนูเอง: a name and a price; one table until the price box says otherwise ──

function NewCustomSetForm({ existingNames, isPending, onAdd, onCancel }: { existingNames: string[]; isPending: boolean; onAdd: (d: LineDraft) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const priceN = toNum(price);
  // A5: the same refusal the save applies, shown before the button is pressed.
  const taken = existingNames.some((n) => n.trim().toLocaleLowerCase("th") === name.trim().toLocaleLowerCase("th")) && name.trim() !== "";
  const valid = name.trim() !== "" && !taken && priceN != null && priceN >= 0;
  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-neutral-800">สร้างชุดเมนูเอง</p>
      <p className="text-xs text-neutral-500">ตั้งชื่อและราคาต่อโต๊ะ ชุดจะเพิ่มเป็นการ์ดใหม่ว่างๆ ด้านบน — เลือกเมนูเอง หรือคัดลอกจากชุดมาตรฐาน/การจองอื่น แล้วกดบันทึก จำนวนโต๊ะเริ่มที่ 1 ตั้งจำนวนจริงในกล่องราคาของหน้าจอง</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อชุด เช่น ชุดเจ 3,500"
          className={`min-w-[12rem] flex-1 rounded border px-2 py-1 ${taken ? "border-red-400" : "border-neutral-300"}`} />
        <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="ราคา/โต๊ะ"
          className="w-28 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums" />
      </div>
      {taken && <p className="text-xs text-red-700">มีชุดชื่อ “{name.trim()}” อยู่ในงานนี้แล้ว — ตั้งชื่อชุดใหม่ให้ต่างกัน</p>}
      <div className="flex gap-2">
        <button type="button" disabled={isPending || !valid}
          onClick={() => onAdd(newCustomLineDraft(`new-${crypto.randomUUID()}`, name, priceN!))}
          className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
          เพิ่มชุด
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50">ยกเลิก</button>
      </div>
    </div>
  );
}
