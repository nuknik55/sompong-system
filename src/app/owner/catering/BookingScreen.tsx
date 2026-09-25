"use client";

// THE ONE SCREEN. A booking is the sheet's row — ตารางจองงานต่างๆ ปี 69:
// customer, phone, date, time, place, tables, guests, booking type, status,
// taker, note, kitchen note, deposit — plus a price box that IS the quote,
// and two buttons. Replaces the create modal and the split detail page
// (booking above, charges below, two save buttons that each saved half).
//
// PRICE BOX LAYOUT IS PROVISIONAL. Its rows are built from the existing
// rate list (catering_rates by type) and the set menus. Nik is sending the
// quote his staff hand customers today; when it arrives the rows are
// adjusted to match it before this commit is finalised.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getRoomConflictCandidates, saveBooking } from "./actions";
import type {
  CateringCharge, CateringCustomer, CateringDishOption, CateringEvent, CateringEventType,
  CateringRate, CateringSetMenuOption, StaffOption,
} from "./actions";
import { bookingLinesForSave, linesFromCharges, menuLineQuantityOk, priceBoxProblem, type Line, type Section } from "./booking-lines";
import { canMarkFree, unmarkedZeroLines } from "@/lib/event-sheet";
import { docMoney } from "@/lib/quote-doc";
import { setCountUnit, PER_HEAD_UNIT } from "@/lib/kitchen-sheet";
import { foldSetName } from "./event-menu";
import { bookingSnapshot, seenAfter, serverViewAction, type SeenView, type ServerView } from "./booking-dirty";
import { markUnsaved } from "@/lib/unsaved-changes";
import { Button, buttonClass } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/page";
import { ROOM_CONFLICTS, findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";
import {
  LOCATION_TYPE_OPTIONS, VENUE_OPTIONS, BOOKING_TYPE_OPTIONS, FOOD_FORMAT_OPTIONS, STATUS_OPTIONS,
  VENUE_LABEL, RATE_TYPE_TO_CHARGE_TYPE, blankForm, formFromEvent, formToUpsertPayload, pickCustomer, typeCustomerName, conflictTimeLabel, thDate,
  fmtBaht, toNum, staffLabel, Field,
} from "./shared-utils";
import type { FormState } from "./shared-utils";
import { CustomerCombobox, SearchSelect, Time24Input, ToggleGroup } from "./shared";
import { ambiguousCustomerMessage, matchTypedCustomer, typedCustomerHint } from "./customer-match";

// ─── Price box model ─────────────────────────────────────────────────────────

/** Provisional order and titles — see the file header. */
const SECTIONS: { key: Section; title: string; rateType: string | null }[] = [
  { key: "menu",     title: "ชุดเมนู / เมนู",     rateType: null },
  { key: "room",     title: "ห้อง / สถานที่",      rateType: "room" },
  { key: "drink",    title: "เครื่องดื่ม",          rateType: "drink" },
  { key: "delivery", title: "ค่าขนส่ง (นอกสถานที่)", rateType: "delivery" },
  { key: "music",    title: "ดนตรี",                rateType: "music" },
  { key: "other",    title: "อื่นๆ / เบี้ยเลี้ยง",   rateType: "staff_bonus" },
  { key: "discount", title: "ส่วนลด",               rateType: null },
];

function money(n: number) { return `฿${fmtBaht(n)}`; }

/** Device memory of the last taker chosen, for logins with no linked employee. */
const LAST_TAKER_KEY = "catering.lastTaker";

const LEAVE_MSG = "มีการแก้ไขที่ยังไม่ได้บันทึก — ออกจากหน้านี้โดยไม่บันทึกหรือไม่?";
const RELOAD_MSG = "ทิ้งการแก้ไขที่ยังไม่ได้บันทึก แล้วโหลดข้อมูลล่าสุดของงานนี้หรือไม่?";
/**
 * A save that brought no answer at all: the connection, the server, a deploy
 * mid-session, or a sign-in that has ended (the proxy sends that request to
 * the login page, so it too arrives here as no answer).
 */
const RESULT_LOST =
  "ไม่ได้รับคำตอบจากระบบ — ข้อมูลที่แก้ไขยังอยู่ในหน้านี้ ลองกดบันทึกอีกครั้ง ถ้ายังไม่ได้ อาจหลุดจากระบบ: เปิดแท็บใหม่ เข้าสู่ระบบ แล้วกลับมากดบันทึกที่หน้านี้ ถ้ายังไม่ได้อีก ให้จดสิ่งที่แก้ไว้ แล้วรีเฟรชหน้านี้ (ระบบอาจเพิ่งอัปเดต)";
/** The same for a booking not created yet: it may have been, and saving again would make a second. */
const RESULT_LOST_NEW =
  "ไม่ได้รับคำตอบจากระบบ — งานนี้อาจถูกสร้างไปแล้ว: ดูในรายการงาน (เปิดแท็บใหม่) ก่อนกดบันทึกอีกครั้ง เพื่อไม่ให้เกิดงานซ้ำ ข้อมูลที่แก้ไขยังอยู่ในหน้านี้ ถ้าหลุดจากระบบ ให้เข้าสู่ระบบในแท็บใหม่ แล้วกลับมาที่หน้านี้";

/** The menu lines a set of charges shows: the lines a save may drop. */
const menuIdsOf = (charges: CateringCharge[]) => charges.flatMap((c) => (c.event_menu_id ? [c.event_menu_id] : []));

// ─── Screen ──────────────────────────────────────────────────────────────────

export function BookingScreen({
  event,
  initialCharges,
  customers,
  staffOptions,
  rates,
  eventTypes,
  setMenuOptions,
  dishOptions,
  defaultStaffId,
  dishNamesByMenuLine = {},
  perHeadMenuLines = [],
}: {
  event: CateringEvent | null;
  initialCharges: CateringCharge[];
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  rates: CateringRate[];
  /** ACTIVE ประเภทงาน only. A booking whose type was later ปิดใช้ keeps it —
   *  the value is still stored and still prints — but it cannot be chosen
   *  again from here, which is the whole point of retiring one. */
  eventTypes: CateringEventType[];
  setMenuOptions: CateringSetMenuOption[];
  dishOptions: CateringDishOption[];
  /** The login's linked employee; pre-selected as taker on a new booking. */
  defaultStaffId: string | null;
  /**
   * Per set line (catering_event_menus.id): the names of what is served at it,
   * in section order — the booking's own copy, or the shared set for a line
   * from before the copy existed (getEventMenuDishes). Shown under the set's
   * name in the price box (Nik, 2026-09-19: the names, not a count). A set
   * added on this screen and not yet saved has no entry and shows nothing.
   */
  dishNamesByMenuLine?: Record<string, string[]>;
  /** Saved set lines priced per guest (catering_event_menus.per_head): their count is guests. */
  perHeadMenuLines?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => (event ? formFromEvent(event) : blankForm(defaultStaffId)));
  const [lines, setLines] = useState<Line[]>(() => linesFromCharges(initialCharges));
  const [error, setError] = useState<string | null>(null);
  // The error a SAVE returned, which "โหลดข้อมูลล่าสุด" is offered beside —
  // never beside the screen's own checks, where it would only tempt someone
  // to throw a draft away over a typo.
  const [reloadFor, setReloadFor] = useState<string | null>(null);

  // ── Leaving with unsaved changes asks first (Nik, 2026-09-20) ──────────
  //
  // The same model as the menu page. THE BASELINE IS TAKEN FROM THE SAME
  // VALUES THIS SCREEN INITIALISED WITH, not from a re-derivation of them,
  // so at mount the two strings are equal by construction and nothing but an
  // edit can separate them — this is the screen sales uses most, and a
  // warning on a form nobody touched would be dismissed by reflex and then
  // absent on the day it mattered. Re-baselined in exactly two places: when
  // the device's remembered taker is seeded (not the person's edit) and
  // after a save succeeds.
  const [initialClean] = useState<string>(() =>
    bookingSnapshot(event ? formFromEvent(event) : blankForm(defaultStaffId), linesFromCharges(initialCharges)));
  const [cleanAt, setCleanAt] = useState<string>(initialClean);
  const dirty = bookingSnapshot(form, lines) !== cleanAt;

  // ── The floating save bar (Nik, 2026-09-23) ─────────────────────────────
  //
  // The form is long and its save buttons sit at the very bottom, so while
  // (and only while) there are unsaved changes a bar is fixed to the foot of
  // the screen with the same two saves: the same handlers, the same disabled
  // states, the same labels. The buttons below the price box stay.
  //
  // The bar must never cover the page: while it shows, the page gets bottom
  // padding equal to the bar's own height, measured, so the last thing on
  // the page (ดูข้อมูลเพิ่ม, the history) can always be scrolled clear of it.
  // On the body, not in this screen: the booking page renders more below
  // this component, and that is what the bar would otherwise sit on.
  const saveBarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bar = saveBarRef.current;
    if (!dirty || !bar) return;
    const reserve = () => { document.body.style.paddingBottom = `${bar.offsetHeight}px`; };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = "";
    };
  }, [dirty]);

  // ── The server's view, decided INSIDE the screen (queue item 41, Nik 2026-09-21) ──
  //
  // The page keys this screen on the booking alone. New server data — after
  // a save, another tab's save, the menu page, a second sales login — arrives
  // as new props and is taken ONLY when it cannot cost the person anything:
  // the form is clean, or it is their own save landing. Otherwise the draft
  // stays and a banner says the booking changed elsewhere. The rule is
  // serverViewAction (booking-dirty.ts), where it is tested; this is React's
  // "adjust state when a prop changes", during render, as the menu page does.
  const serverSnapshot = useMemo(
    () => (event ? bookingSnapshot(formFromEvent(event), linesFromCharges(initialCharges)) : initialClean),
    [event, initialCharges, initialClean],
  );
  const [seen, setSeen] = useState<SeenView>(() => ({
    updatedAt: event?.updated_at ?? null, snapshot: initialClean, menuIds: menuIdsOf(initialCharges),
  }));
  // From a successful save until its data is on screen: the form stays
  // locked, so nothing typed in between can be thrown away by the landing.
  const [landing, setLanding] = useState(false);
  // The token of the person's OWN partial save (the booking's fields written,
  // the price box not): the retry sends it, and the refresh that brings it is
  // taken as the baseline with the draft kept.
  const [ackAt, setAckAt] = useState<string | null>(null);
  // A NEW booking this screen created (by a partial save, or a save whose
  // landing never came): the next save updates it instead of creating a
  // second one.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const server: ServerView = { updatedAt: event?.updated_at ?? null, snapshot: serverSnapshot };
  const viewAction = event ? serverViewAction(seen, server, { dirty, landing, ackAt }) : "same";
  if (viewAction === "adopt" && event) {
    setForm(formFromEvent(event));
    setLines(linesFromCharges(initialCharges));
    setCleanAt(serverSnapshot);
    setSeen(seenAfter("adopt", seen, server, menuIdsOf(initialCharges)));
    setLanding(false);
    setAckAt(null);
    setNotice(null);
  } else if (viewAction === "ack") {
    // The draft stays, and so do the lines it is based on (seenAfter).
    setSeen(seenAfter("ack", seen, server, menuIdsOf(initialCharges)));
    setCleanAt(serverSnapshot);
    setAckAt(null);
  } else if (viewAction === "token") {
    setSeen(seenAfter("token", seen, server, menuIdsOf(initialCharges)));
  }
  const serverMoved = viewAction === "hold";
  // The whole form, not only the price box, while a save is in flight and
  // until it lands (Nik, 2026-09-21: typing during a save used to be lost).
  const busy = isPending || landing;
  // What a set counts on THIS booking — โต๊ะ, กล่อง or ชุด, the kitchen sheet's word.
  const countUnit = setCountUnit(form.food_format || null);
  // A PER-HEAD set line counts guests and prices per guest (Nik, 2026-09-25):
  // a saved one by its stored flag, a new one by its set's.
  const perHeadSets = new Set(setMenuOptions.filter((s) => s.per_head).map((s) => s.id));
  const perHeadLines = new Set(perHeadMenuLines);
  const isPerHead = (l: Line) => l.kind === "set" && (l.eventMenuId ? perHeadLines.has(l.eventMenuId) : l.refId != null && perHeadSets.has(l.refId));
  const unitOf = (l: Line) => (isPerHead(l) ? PER_HEAD_UNIT : countUnit);
  // A name TYPED rather than picked: which customer the save will take it for
  // (customer-match.ts, the save's own rule), said under the name box before
  // the save, and refused here when it is ambiguous (queue item 50).
  const typedMatch = !form.customerId && form.customerQuery.trim() !== ""
    ? matchTypedCustomer(form.customerQuery, form.newPhone, customers)
    : null;
  const typedHint = typedMatch ? typedCustomerHint(typedMatch, form.customerQuery.trim(), event?.customer_id ?? null) : null;

  // The landing's own safety: if the saved data never arrives (the refresh
  // failed), unlock after a while and say so, rather than leave the form
  // locked for good.
  useEffect(() => {
    if (!landing || isPending) return;
    const t = setTimeout(() => {
      setLanding(false);
      setNotice("บันทึกแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่ได้ — รีเฟรชหน้านี้ก่อนแก้ไขต่อ");
    }, 10_000);
    return () => clearTimeout(t);
  }, [landing, isPending]);

  /**
   * The way out of the banner and of a refused save: drop the draft (asking
   * first), show what the screen last took from the server, and fetch the
   * newest, which the clean form takes as it lands. The props can be older
   * than the refusal: only a conflict refreshes on its own. Not locked while
   * it loads: a lock with no answer would stay, and typing before the newest
   * lands only holds it, with the banner.
   */
  function reloadLatest() {
    if (!event) return;
    if (dirty && !window.confirm(RELOAD_MSG)) return;
    setForm(formFromEvent(event));
    setLines(linesFromCharges(initialCharges));
    setCleanAt(serverSnapshot);
    setSeen(seenAfter("adopt", seen, server, menuIdsOf(initialCharges)));
    setAckAt(null);
    setError(null);
    setNotice(null);
    router.refresh();
  }

  // Registered only WHILE DIRTY, so a clean form has no listeners at all and
  // the handlers cannot read a stale value: the effect re-runs when dirty
  // flips, which is twice in a session, not once per keystroke.
  useEffect(() => {
    if (!dirty) return;
    // ออกจากระบบ is a form submit ending in a redirect, so neither handler
    // below can see it. Registering here keeps the two in step: the shell
    // asks exactly when this screen would have (Nik, 2026-09-20).
    const release = markUnsaved();
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    // An in-app link never fires beforeunload, so every internal anchor is
    // caught in the capture phase before Next.js sees it. The browser's own
    // Back button stays uncaught, as decided for the menu page: popstate
    // cannot be refused and the workaround breaks Back for everyone.
    const click = (e: globalThis.MouseEvent) => {
      // A modified or middle click opens a new tab and LEAVES THIS PAGE
      // WHERE IT IS, so there is nothing to warn about — and cancelling one
      // used to swallow the new tab instead (review, 2026-09-20). Next's own
      // Link makes the same exemption.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#") || (/^[a-z]+:/i.test(href) && !href.startsWith(location.origin))) return;
      if (!window.confirm(LEAVE_MSG)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      release();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm((f) => ({ ...f, [k]: v })); }

  // ── Room conflict: same rule as the server (conflict.ts); hard-blocks save ──
  // A new booking a partial save already created does not clash with itself
  // (review, 2026-09-21: the retry's save button was disabled by it).
  const excludeId = event?.id ?? createdId;
  const conflictEligible = form.location_type === "in_house" && !!ROOM_CONFLICTS[form.venue];
  const [candidates, setCandidates] = useState<RoomConflictCandidate[]>([]);
  useEffect(() => {
    if (!conflictEligible || !form.event_date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidation of stale candidates, see shared.tsx history
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      getRoomConflictCandidates(form.event_date, excludeId)
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.event_date, excludeId, conflictEligible]);
  const conflict = conflictEligible ? findRoomConflict(form.venue, form.start_time, form.end_time, candidates) : null;

  // ── Price box helpers ──
  const total = lines.reduce((s, l) => s + (toNum(l.amount) ?? 0), 0);
  // THE ฿0 WARNING (Nik, 2026-09-24): a ฿0 line not ticked แถมฟรี saves as
  // it is, and does not print under รายการแถมฟรี. Said, never blocked.
  const zeroNotFree = unmarkedZeroLines(lines.map((l) => ({ kind: l.kind, label: l.label, amount: toNum(l.amount) ?? 0, free: l.free })));
  // The computed deposit, shown beside the percentage field so whoever agrees
  // the term sees the figure it produces. Never written anywhere —
  // deposit_amount records what was actually received. Same arithmetic the
  // printed documents use, from @/lib/quote-doc where it is tested.
  const depositDue = docMoney(total, toNum(form.deposit_percent), null).depositDue;
  const suggestedDelivery = useMemo(() => {
    const km = toNum(form.offsite_distance_km);
    if (form.location_type !== "offsite" || km === null) return null;
    return rates.find((r) => r.rate_type === "delivery" && r.min_distance_km != null && r.max_distance_km != null && km >= r.min_distance_km && km <= r.max_distance_km) ?? null;
  }, [rates, form.location_type, form.offsite_distance_km]);

  function addRate(section: Section, rate: CateringRate) {
    const qty = section === "drink" ? (toNum(form.guest_count) ?? 1) : 1;
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), kind: "rate", section, refId: rate.id, eventMenuId: null,
      label: rate.label, unitPrice: String(rate.amount), quantity: String(qty), amount: String(rate.amount * qty),
      chargeType: section === "music" ? "service" : (RATE_TYPE_TO_CHARGE_TYPE[rate.rate_type] ?? "other"), note: null, free: false,
    }]);
  }
  function addMenu(kind: "set" | "dish", id: string) {
    const opt = kind === "set" ? setMenuOptions.find((s) => s.id === id) : dishOptions.find((d) => d.id === id);
    if (!opt) return;
    // One line per set or dish, loaded lines included. A second pick of a set
    // the booking already has used to make TWO charge rows for one line and
    // print the set twice (review, 2026-09-19); the server refuses it too.
    // A per-head set counts guests: the message says so.
    const pickedUnit = kind === "set" && (opt as CateringSetMenuOption).per_head ? PER_HEAD_UNIT : "โต๊ะ";
    if (lines.some((l) => l.kind === kind && l.refId === id)) {
      setError(`${opt.name} อยู่ในกล่องราคาแล้ว — แก้จำนวน${pickedUnit}ในบรรทัดเดิมแทน`);
      return;
    }
    // AND BY NAME, because a set copied in on the menu page is stored as the
    // booking's OWN set (no set_menu_id), so the id test above cannot see it
    // — picking the same standard set here would have made a second line
    // with the same label and price (review, 2026-09-20). The database refuses
    // it too (catering_save_booking_prices, the A5 rule).
    if (kind === "set" && lines.some((l) => l.kind === "set" && foldSetName(l.label) === foldSetName(opt.name))) {
      setError(`งานนี้มีชุดชื่อ “${opt.name}” อยู่แล้ว — แก้จำนวน${pickedUnit}ในบรรทัดเดิม หรือลบชุดเดิมก่อน`);
      return;
    }
    setError(null);
    const price = kind === "set" ? (opt as CateringSetMenuOption).price_per_set : (opt as CateringDishOption).selling_price;
    // A set counts whole tables (booking-lines.ts), so the booking's table
    // count is the default only when it is one; otherwise 1, in plain view.
    // A per-head set counts guests: the booking's guest count, when it is one.
    const tables = kind === "set" && (opt as CateringSetMenuOption).per_head ? toNum(form.guest_count) : toNum(form.table_count);
    const qty = kind === "set" ? (tables !== null && menuLineQuantityOk("set", tables) ? tables : 1) : 1;
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), kind, section: "menu", refId: id, eventMenuId: null,
      label: opt.name, unitPrice: String(price), quantity: String(qty), amount: String(price * qty), chargeType: "food", note: null, free: false,
    }]);
  }
  function addManual(section: Section) {
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), kind: section === "discount" ? "discount" : "manual", section, refId: null, eventMenuId: null,
      label: section === "discount" ? "ส่วนลด" : "", unitPrice: "", quantity: "1", amount: "", chargeType: section === "discount" ? "discount" : "other", note: null, free: false,
    }]);
  }
  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      if ("unitPrice" in patch || "quantity" in patch) {
        const up = toNum(next.unitPrice) ?? 0, q = toNum(next.quantity) ?? 0;
        // TO THE SATANG. 333.33 x 3 is 999.9899999999999 in binary floating
        // point: it was written to the charge row that way and, once the
        // unsaved-changes guard existed, retyping the same quantity read as
        // an edit for ever after (review, 2026-09-20).
        const exact = Math.round(up * q * 100) / 100;
        next.amount = String(next.kind === "discount" ? -Math.abs(exact) : exact);
      }
      if ("amount" in patch && next.kind === "discount") next.amount = String(-Math.abs(toNum(next.amount) ?? 0));
      return next;
    }));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }
  // แถมฟรี prices the line: ticked, ฿0 a unit and in all; unticked, the
  // price it had before the tick on this screen. A line loaded already free
  // has none: a dish gets the dish's price (as the database gives it), a rate
  // the rate's, and a typed line keeps ฿0 for the person to type.
  function markFree(l: Line, free: boolean) {
    if (free) { updateLine(l.key, { free, unitPrice: "0", amount: "0", unitPriceBeforeFree: l.unitPrice }); return; }
    const own = l.unitPriceBeforeFree
      ?? (l.kind === "dish" ? dishOptions.find((d) => d.id === l.refId)?.selling_price
        : l.kind === "rate" ? rates.find((r) => r.id === l.refId)?.amount
        : undefined)?.toString();
    updateLine(l.key, own === undefined ? { free, unitPriceBeforeFree: undefined } : { free, unitPrice: own, unitPriceBeforeFree: undefined });
  }

  // ── Save ──
  const canSave = form.event_date !== "" && form.customerQuery.trim() !== "" && !busy && !conflict;
  // 7.7: a silently greyed-out save button is the same "is this broken?"
  // confusion the print links caused. Name what is missing, right where the
  // buttons are. The room conflict has its own louder message elsewhere.
  const missingForSave = [
    ...(form.customerQuery.trim() === "" ? ["ชื่อลูกค้า"] : []),
    ...(form.event_date === "" ? ["วันที่จัดงาน"] : []),
  ];

  // 7.4: the same rate on two lines is almost always a slip — Nik's first
  // real booking quoted three overlapping drink packages on a customer
  // document. "Almost" is why this WARNS and never blocks: a legitimate
  // double (two karaoke sets for two rooms) stays saveable.
  const duplicateRateLabels = (() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    for (const l of lines) {
      if (l.kind !== "rate" || !l.refId) continue;
      if (seen.has(l.refId)) dups.add(seen.get(l.refId) as string);
      else seen.set(l.refId, l.label);
    }
    return [...dups];
  })();

  function save(issueQuote: boolean) {
    setError(null);
    setNotice(null);
    // Every line is checked before anything is sent, and named when refused
    // (booking-lines.ts): a set by whole counts of the booking's own unit, a
    // dish by up to three decimals, every other line by what the database
    // would refuse.
    const problem = priceBoxProblem(lines, unitOf);
    if (problem) { setError(problem); return; }
    // A typed name that is already a customer's is never guessed: the person
    // picks, or gives the new customer's phone. The save refuses it as well.
    if (typedMatch?.kind === "ambiguous") {
      setError(ambiguousCustomerMessage(form.customerQuery.trim(), typedMatch));
      return;
    }
    // Fields the screen no longer shows are derived from the price box, so
    // the columns keep meaning: room_portion from the chosen room rate,
    // music from the chosen music line.
    const roomLine = lines.find((l) => l.section === "room");
    const musicLine = lines.find((l) => l.section === "music");
    const derived: FormState = {
      ...form,
      room_portion: roomLine ? (/ครึ่ง/.test(roomLine.label) ? "half" : /เต็ม/.test(roomLine.label) ? "full" : form.room_portion) : form.room_portion,
      music_type: musicLine ? "other" : form.music_type === "other" ? "none" : form.music_type,
      music_note: musicLine ? musicLine.label : form.music_note,
    };
    // A new booking that a partial save already created is saved again,
    // never created twice.
    const targetId = event?.id ?? createdId ?? undefined;
    startTransition(async () => {
      // A save that THROWS (no answer: the connection, the server, a deploy
      // mid-session, an ended sign-in) used to take the whole screen to the
      // error page, draft and all (review, 2026-09-21). It may or may not
      // have landed; the draft stays either way. On an existing booking a
      // retry that finds it landed is refused as a change made elsewhere;
      // a NEW booking may already exist, and the message says to look first.
      const result = await saveBooking({
        event: formToUpsertPayload(derived, targetId), lines: bookingLinesForSave(lines), issueQuote,
        // The lines the DRAFT is based on — not the newest props, which may
        // hold lines created elsewhere since; those are kept (saveBooking).
        knownMenuIds: seen.menuIds,
        // THE CONFLICT TOKEN: the booking as this screen took it, or as its
        // own partial save left it.
        expectedUpdatedAt: targetId ? (ackAt ?? seen.updatedAt) : null,
      }).catch(() => null);
      if (!result) {
        const lost = targetId ? RESULT_LOST : RESULT_LOST_NEW;
        setError(lost);
        setReloadFor(lost);
        return;
      }
      if (!result.ok && result.pricesSaved && result.id) {
        // Everything but the quotation landed: the draft IS the booking now.
        // Take the saved data as a successful save does, locked until it is
        // on screen, so the lines this save created become the screen's own
        // and removing one later holds (review, 2026-09-21). The message
        // stays; a new booking goes to its own page.
        setError(result.error);
        setCleanAt(bookingSnapshot(form, lines));
        setLanding(true);
        // A NEW booking is this one from now on, as after a successful save.
        if (!event) setCreatedId(result.id);
        if (!event) router.push(`/owner/catering/${result.id}`);
        router.refresh();
        return;
      }
      if (!result.ok) {
        setError(result.error);
        setReloadFor(result.error);
        // Part of the save landed (the booking's own fields, or all but the
        // quotation): take its id and token so a retry saves the same booking
        // and is not refused as someone else's change. The draft stays.
        if (result.id) {
          if (!event) setCreatedId(result.id);
          if (result.updatedAt !== undefined) setAckAt(result.updatedAt ?? null);
        }
        // The customer this save attached, or ADDED from the typed name, even
        // when nothing else landed: the retry sends it as a pick. Matching the
        // name again would find that very customer and be refused (queue item
        // 50). The form was locked since the click, so the name is the saved one.
        const saved = result.customerId;
        if (saved) setForm((f) => (f.customerId ? f : { ...f, customerId: saved }));
        // Only a conflict fetches on its own: the database has just answered,
        // and the newest data lets the screen show what moved, or, when
        // nothing it shows did, lets the next save through. After any other
        // failure a refresh can load the page into that same failure and take
        // the draft with it (review, 2026-09-21); the error offers
        // "โหลดข้อมูลล่าสุด" instead.
        if (event && result.conflict) router.refresh();
        return;
      }
      // SAVED IS CLEAN, and the form stays locked until the saved data is on
      // screen, so nothing typed in between can be lost by the landing.
      setCleanAt(bookingSnapshot(form, lines));
      setLanding(true);
      // A NEW booking is this one from now on: should the landing never come,
      // the next save updates it rather than creating a second.
      if (!event) { setCreatedId(result.id); setAckAt(result.updatedAt); }
      try { if (derived.staff_ids[0]) localStorage.setItem(LAST_TAKER_KEY, derived.staff_ids[0]); } catch { /* storage unavailable */ }
      router.push(issueQuote ? `/owner/catering/${result.id}/quote` : `/owner/catering/${result.id}`);
      router.refresh();
    });
  }

  const pickedCustomer = form.customerId ? customers.find((c) => c.id === form.customerId) : null;
  // The taker dropdown: people flagged takes_bookings on the HR page (the
  // sheet's six), plus whoever is already saved on this booking even if
  // since unflagged or left — otherwise they would be stuck on it unseen.
  const takers = staffOptions.filter((s) => (s.takes_bookings && s.is_active) || form.staff_ids.includes(s.id));

  // Default taker on a NEW booking: the login's employee (defaultStaffId,
  // via blankForm) when linked; else the last taker chosen on this device;
  // else nothing, and the person picks. Device memory is a convenience for
  // the shared `sale` login, which has no employee of its own; it never
  // overrides a saved booking or a linked login.
  // ONE condition for both halves of the seed below. They used to be gated
  // differently — the form on "no taker yet", the baseline on "the baseline
  // is untouched" — which could seed one without the other (review,
  // 2026-09-20).
  const hasTaker = form.staff_ids.length > 0;
  useEffect(() => {
    if (event || defaultStaffId || hasTaker) return;
    try {
      const last = localStorage.getItem(LAST_TAKER_KEY);
      if (last && staffOptions.some((s) => s.id === last && s.takes_bookings && s.is_active)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from device storage, unavailable during render under SSR
        setForm((f) => (f.staff_ids.length === 0 ? { ...f, staff_ids: [last] } : f));
        // AND THE BASELINE WITH IT: the device's remembered taker is a
        // default this screen chose, not something the person typed, so it
        // must not make a brand-new form read as edited. Only while the
        // baseline is still the untouched one — if the person has already
        // typed something, their edit is theirs and stays unsaved.
        setCleanAt((c) => (c === initialClean
          ? bookingSnapshot({ ...blankForm(defaultStaffId), staff_ids: [last] }, linesFromCharges(initialCharges))
          : c));
      }
    } catch { /* storage unavailable: no default */ }
  }, [event, defaultStaffId, staffOptions, hasTaker, initialClean, initialCharges]);

  return (
    <div className="space-y-5">
      {serverMoved && (
        <div className="rounded-lg border border-pending/60 bg-pending-soft px-4 py-2 text-sm text-pending-ink">
          ข้อมูลของงานนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — การแก้ไขของคุณยังอยู่ บันทึกต่อได้ (ถ้ามีคนบันทึกงานนี้จากหน้าจองอื่น ระบบจะไม่ให้บันทึกทับ)
          <button type="button" onClick={reloadLatest} disabled={busy} className="ml-2 font-medium underline hover:text-amber-950 disabled:opacity-50">โหลดข้อมูลล่าสุด</button>
        </div>
      )}
      {notice && <p className="rounded-md bg-pending-soft px-3 py-2 text-sm text-pending-ink">{notice}</p>}

      {/* ONE lock for the whole form while a save is in flight and until it
          lands: a disabled fieldset disables every control inside it,
          including those the shared components render.
          No m-0: Tailwind's space-y puts the gap as each child's BOTTOM
          margin, and m-0 on this child zeroed it, so the save buttons sat
          flush against the price box's border (Nik, 2026-09-23). Preflight
          already resets a fieldset's own margin. */}
      <fieldset disabled={busy} className="min-w-0 space-y-5 border-0 p-0">
      {/* ── The booking: the sheet's row ── */}
      <section className="space-y-4 rounded-xl border border-neutral-300 bg-white p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="ลูกค้า *" className="sm:col-span-2">
            <CustomerCombobox
              customers={customers}
              customerId={form.customerId}
              query={form.customerQuery}
              onPick={(c) => setForm((f) => pickCustomer(f, c))}
              onQueryChange={(t) => setForm((f) => typeCustomerName(f, t))}
            />
            {typedHint && <p className="mt-1 text-xs text-pending-ink">{typedHint}</p>}
          </Field>
          <Field label="เบอร์โทร">
            {/* Read-only whenever the booking has its customer, in the page's
                list or not (one a failed save just added is not): a phone
                typed here then would be sent nowhere (review, 2026-09-22).
                The customer page edits a customer's phone. */}
            {form.customerId ? (
              <input className="input-base" readOnly title="เบอร์ที่บันทึกไว้ของลูกค้ารายนี้ (แก้ได้ที่หน้าลูกค้า)"
                value={pickedCustomer ? (pickedCustomer.phone ?? "") : form.customerId === event?.customer_id ? (event?.customer_phone ?? "") : form.newPhone} />
            ) : (
              <input className="input-base" value={form.newPhone} onChange={(e) => set("newPhone", e.target.value)} placeholder="ลูกค้าใหม่" />
            )}
          </Field>
        </div>

        {/* On a phone the date takes the row and the two times share the
            next: three columns in 290px overlapped the time pickers. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="วันที่จัดงาน *" className="col-span-2 sm:col-span-1">
            <input type="date" className="input-base" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} />
            {/* The native input renders in the BROWSER's locale — measured:
                lang="th" at page, wrapper and input level all still print
                09/14/2026 on an en-US Chromium, so no markup can force
                dd/mm/yyyy. The Thai reading beside it removes the misreading
                at one line's cost; a masked dd/mm input stays a held
                fallback (README) because staff would type the Buddhist year
                into it — the 1968 bug again, per screen. */}
            {form.event_date && <p className="mt-1 text-xs text-neutral-500">{thDate(form.event_date)}</p>}
          </Field>
          <Field label="เวลาเริ่ม"><Time24Input value={form.start_time} onChange={(v) => set("start_time", v)} /></Field>
          <Field label="เวลาสิ้นสุด"><Time24Input value={form.end_time} onChange={(v) => set("end_time", v)} /></Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="สถานที่ *">
            <ToggleGroup
              options={LOCATION_TYPE_OPTIONS}
              value={form.location_type}
              onPick={(v) => setForm((f) => ({ ...f, location_type: v, venue: v === "in_house" && f.venue === "" ? "room_v2" : f.venue }))}
            />
          </Field>
          {form.location_type === "in_house" ? (
            <Field label="ห้อง *">
              <select className="input-base" value={form.venue} onChange={(e) => set("venue", e.target.value)}>
                {VENUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="ที่อยู่นอกสถานที่">
                <input className="input-base" value={form.offsite_address} onChange={(e) => set("offsite_address", e.target.value)} />
              </Field>
              <Field label="ระยะทาง (กม.)">
                <input type="number" min={0} className="input-base" value={form.offsite_distance_km} onChange={(e) => set("offsite_distance_km", e.target.value)} />
              </Field>
            </>
          )}
        </div>

        {conflict && (
          <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            <p className="font-medium">⚠ ไม่สามารถบันทึกได้ — ห้องชนกับการจองอื่น</p>
            <p>{conflict.customer_name ?? "-"} ({VENUE_LABEL[conflict.venue] ?? conflict.venue}, {conflictTimeLabel(conflict.start_time, conflict.end_time)})</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="ประเภทการจอง *">
            <select className="input-base" value={form.booking_type} onChange={(e) => set("booking_type", e.target.value)}>
              {BOOKING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {/* ประเภทงาน sits beside ประเภทการจอง because the two get confused
              in conversation and seeing them together is the fastest way to
              tell them apart: this is what the party is FOR, that one is what
              is being booked. NOT required — a booking is often taken before
              anyone asks. */}
          <Field label="ประเภทงาน">
            <select className="input-base" value={form.event_type_id} onChange={(e) => set("event_type_id", e.target.value)}>
              <option value="">– ไม่ระบุ –</option>
              {eventTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              {/* PREVENTS A SCREEN FROM CHANGING STORED DATA BY BEING LOOKED
                  AT. A type that was ปิดใช้ after this booking was saved is
                  not in the list above, so the select would match no option,
                  fall back to ไม่ระบุ, and the next save would write that
                  blank over a real answer — without anyone touching the
                  field. Rendering the stored value as one extra option is
                  what stops it. Same family as the stale-mirror items: the
                  screen must never quietly disagree with the database. */}
              {form.event_type_id && !eventTypes.some((t) => t.id === form.event_type_id) && (
                <option value={form.event_type_id}>{event?.event_type_label ?? "(ปิดใช้แล้ว)"}</option>
              )}
            </select>
          </Field>
          <Field label="รูปแบบอาหาร">
            <select className="input-base" value={form.food_format} onChange={(e) => set("food_format", e.target.value)}>
              <option value="">– ไม่ระบุ –</option>
              {FOOD_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="จำนวนโต๊ะ">
            <input type="number" min={0} className="input-base" value={form.table_count} onChange={(e) => set("table_count", e.target.value)} />
          </Field>
          <Field label="จำนวนแขก">
            <input type="number" min={0} className="input-base" value={form.guest_count} onChange={(e) => set("guest_count", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="สถานะ *">
            <select className="input-base" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {/* Single taker, as the sheet's ผู้รับงานจอง. Narrowed to flagged
              employees in the taker commit; until then every active employee. */}
          <Field label="ผู้รับงานจอง">
            <select className="input-base" value={form.staff_ids[0] ?? ""} onChange={(e) => set("staff_ids", e.target.value ? [e.target.value] : [])}>
              <option value="">– เลือก –</option>
              {takers.map((s) => <option key={s.id} value={s.id}>{staffLabel(s)}</option>)}
            </select>
            {takers.length === 0 && <p className="mt-1 text-xs text-pending-ink">ยังไม่มีใครถูกตั้งเป็นผู้รับงานจอง — ติ๊ก &quot;รับงานจองจัดเลี้ยง&quot; ในหน้าพนักงาน (HR)</p>}
          </Field>
          {/* The agreed TERM, beside the amount actually RECEIVED. Two fields
              on purpose: a customer may round, or pay in two parts, so the
              percentage cannot be derived from the amount and the amount must
              not be overwritten by the percentage. Three states: blank = not
              yet discussed (prints "______%"), 0 = agreed no deposit (every
              deposit clause and row is omitted), 1-100 = agreed percent.
              New bookings pre-fill 30 — a form default only, see blankForm. */}
          <Field label="มัดจำ (%) ที่ตกลง">
            <input
              type="number" min={0} max={100} step="0.01"
              className="input-base"
              placeholder="เช่น 30 (0 = ไม่เก็บ)"
              value={form.deposit_percent}
              onChange={(e) => set("deposit_percent", e.target.value)}
            />
            {toNum(form.deposit_percent) === 0 ? (
              <p className="mt-1 text-xs text-neutral-500">ตกลงไม่เก็บมัดจำ — เอกสารจะไม่แสดงเงื่อนไขมัดจำ</p>
            ) : depositDue != null && depositDue > 0 ? (
              <p className="mt-1 text-xs text-neutral-500">
                = ฿{fmtBaht(depositDue)} จากยอด ฿{fmtBaht(total)}
              </p>
            ) : null}
          </Field>
          <Field label="เงินมัดจำที่รับแล้ว (บาท)">
            <input type="number" min={0} className="input-base" value={form.deposit_amount} onChange={(e) => set("deposit_amount", e.target.value)} />
          </Field>
          <Field label="วันที่รับมัดจำ">
            <input type="date" className="input-base" value={form.deposit_paid_at} onChange={(e) => set("deposit_paid_at", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="รายละเอียดเพิ่มเติม">
            <textarea className="input-base h-16 resize-none" value={form.detail_note} onChange={(e) => set("detail_note", e.target.value)} />
          </Field>
          <Field label="แจ้งรายละเอียดให้ครัว">
            <textarea className="input-base h-16 resize-none" value={form.kitchen_note} onChange={(e) => set("kitchen_note", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* ── The price box: the quote ── */}
      <section className="rounded-xl border border-neutral-300 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-neutral-900">ราคา / ใบเสนอราคา</h2>
          <p className="text-xs text-neutral-500">
            {event?.quote_number
              ? <>เลขที่ <span className="font-medium tabular-nums text-neutral-700">{event.quote_number}</span>{event.quote_revision > 0 && ` (แก้ไขครั้งที่ ${event.quote_revision})`}</>
              : "ยังไม่เคยออกใบเสนอราคา"}
          </p>
        </div>
        {/* On a phone the price rows are wider than the screen (a 9rem label
            beside five fixed columns, since be8ea1c), which made the WHOLE
            page scroll sideways and the phone shrink it to fit. The rows now
            scroll inside the box instead, like the booking table; from 36rem
            of width up, nothing changes (2026-09-22). */}
        <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[36rem] divide-y divide-neutral-200">
          {SECTIONS.map((sec) => {
            const rows = lines.filter((l) => l.section === sec.key);
            const sectionRates = sec.rateType ? rates.filter((r) => r.rate_type === sec.rateType) : [];
            return (
              <div key={sec.key} className="grid grid-cols-[9rem_1fr] gap-3 py-2.5 sm:grid-cols-[11rem_1fr]">
                <div className="pt-1.5 text-sm font-medium text-neutral-700">{sec.title}</div>
                <div className="space-y-1.5">
                  {rows.map((l) => (
                    <div key={l.key} className="grid grid-cols-[1fr_6rem_4.5rem_7rem_2rem] items-center gap-2">
                      {l.kind === "manual" ? (
                        <div className="min-w-0">
                          <input className="line-input w-full" placeholder="รายการ" value={l.label} disabled={busy} onChange={(e) => updateLine(l.key, { label: e.target.value })} />
                          <FreeMark line={l} disabled={busy} onChange={(free) => markFree(l, free)} />
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <span className="block truncate text-sm text-neutral-800" title={l.label}>{l.label}</span>
                          {canMarkFree(l.kind) && <FreeMark line={l} disabled={busy} onChange={(free) => markFree(l, free)} />}
                          {isPerHead(l) && <span className="text-xs text-neutral-500">ราคาต่อ{PER_HEAD_UNIT} × จำนวน{PER_HEAD_UNIT}</span>}
                          {/* THE DISH NAMES, under the set (Nik). Comma-separated,
                              clamped to two rows by CSS with the full list in the
                              tooltip — so a long set is cut by the space it has,
                              never by a count or a "+3 more". */}
                          {l.kind === "set" && l.eventMenuId && (dishNamesByMenuLine[l.eventMenuId]?.length ?? 0) > 0 && (
                            <p className="line-clamp-2 text-xs leading-snug text-neutral-500" title={dishNamesByMenuLine[l.eventMenuId]!.join(", ")}>
                              {dishNamesByMenuLine[l.eventMenuId]!.join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                      <input type="number" className="line-input text-right tabular-nums" value={l.kind === "discount" ? String(Math.abs(toNum(l.unitPrice) ?? 0) || "") : l.unitPrice}
                        disabled={busy || l.kind === "set" || l.kind === "dish"}
                        title={l.kind === "set" ? `ราคาต่อ${unitOf(l)} — แก้ไขได้ในหน้ารายการอาหารของงาน (ตัวเลขเดียวกัน)` : l.kind === "dish" ? "ราคาตามเมนู" : "ราคาต่อหน่วย"}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                      {/* A dish takes a quantity above 0 with up to three decimals —
                          half a kilo is 0.5; a set, whole counts of the booking's
                          own unit (booking-lines.ts). */}
                      <input type="number" className="line-input text-right tabular-nums" value={l.quantity} disabled={busy}
                        min={l.kind === "dish" ? 0 : 1} step={l.kind === "dish" ? "any" : undefined}
                        title={l.kind === "dish" ? "จำนวน — ใส่ทศนิยมได้ไม่เกิน 3 ตำแหน่ง เช่น 0.5" : l.kind === "set" ? `จำนวน${unitOf(l)} — จำนวนเต็ม` : undefined}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                      <span className={`text-right text-sm tabular-nums ${l.kind === "discount" ? "text-danger" : "text-neutral-900"}`}>{money(toNum(l.amount) ?? 0)}</span>
                      <Button kind="link" size="sm" onClick={() => removeLine(l.key)} disabled={busy} aria-label="เอาบรรทัดนี้ออก">✕</Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    {sec.key === "menu" && (
                      <>
                        {/* Type to filter: 238 dishes is not a scrollable list. */}
                        <div className="w-56">
                          <SearchSelect
                            options={setMenuOptions.map((s) => ({ id: s.id, name: s.per_head ? `${s.name} (ราคาต่อท่าน)` : s.name, price: s.price_per_set }))}
                            placeholder="+ ชุดเมนู × โต๊ะ — พิมพ์เพื่อค้นหา"
                            disabled={busy}
                            onPick={(id) => addMenu("set", id)}
                          />
                        </div>
                        <div className="w-56">
                          <SearchSelect
                            options={dishOptions.map((d) => ({ id: d.id, name: d.name, price: d.selling_price }))}
                            placeholder="+ เมนูเดี่ยว — พิมพ์เพื่อค้นหา"
                            disabled={busy}
                            onPick={(id) => addMenu("dish", id)}
                          />
                        </div>
                      </>
                    )}
                    {sectionRates.length > 0 && (
                      <select className="line-input w-64" value="" disabled={busy} onChange={(e) => { const r = sectionRates.find((x) => x.id === e.target.value); if (r) addRate(sec.key, r); }}>
                        <option value="">+ เลือกจากอัตรา</option>
                        {sectionRates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label} — {fmtBaht(r.amount)}{r.unit ? ` / ${r.unit}` : ""}{suggestedDelivery?.id === r.id ? " (ตรงระยะทาง)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {(sec.key === "other" || sec.key === "discount") && (
                      <Button kind="secondary" size="sm" onClick={() => addManual(sec.key)} disabled={busy}>
                        {sec.key === "discount" ? "+ ส่วนลด" : "+ พิมพ์รายการเอง"}
                      </Button>
                    )}
                    {sec.key === "delivery" && form.location_type !== "offsite" && rows.length === 0 && (
                      <span className="text-xs text-neutral-500">เฉพาะงานนอกสถานที่</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
        {zeroNotFree.length > 0 && (
          <p role="status" className="mt-2 rounded-md bg-pending-soft px-3 py-2 text-xs text-pending-ink">
            ราคา ฿0 แต่ยังไม่ได้ติ๊ก “แถมฟรี”: {zeroNotFree.join(", ")} — บันทึกได้ตามปกติ แต่จะไม่พิมพ์ในรายการแถมฟรีของใบรายละเอียดงาน
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-neutral-300 pt-3">
          <span className="text-sm font-medium text-neutral-700">รวมทั้งหมด</span>
          <span className="text-lg font-semibold tabular-nums text-neutral-900">{money(total)}</span>
        </div>
      </section>
      </fieldset>

      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
          {/* Beside every refused or lost save of an existing booking, so a
              message that says "โหลดข้อมูลล่าสุด" always has the button
              (review, 2026-09-21: after a conflict or a partial save it had
              none). It asks before dropping a draft. */}
          {event && error === reloadFor && (
            <button type="button" onClick={reloadLatest} disabled={busy} className="ml-2 font-medium underline hover:text-red-900 disabled:opacity-50">โหลดข้อมูลล่าสุด</button>
          )}
        </p>
      )}

      {/* THE BUTTONS BELOW THE PRICE BOX, in three groups (Nik, 2026-09-22):
          save first, right-aligned, the one that also issues the quotation
          the main action; then พิมพ์; then ดูข้อมูลเพิ่ม, on the booking page
          (catering/[id]/page.tsx) because those links are the page's. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button kind="secondary" onClick={() => save(false)} disabled={!canSave}>
          {busy ? "กำลังบันทึก…" : "บันทึกอย่างเดียว"}
        </Button>
        {/* An EMPTY price box may still be issued once a quotation exists:
            a booking whose set lines were all removed has a live total of 0
            against a recorded total that is not, and re-issuing is the only
            way to reconcile them — refusing it left the booking unlockable
            for good (review, 2026-09-20). */}
        <Button kind="primary" onClick={() => save(true)} disabled={!canSave || (lines.length === 0 && !event?.quote_number)}
          title={lines.length === 0 && !event?.quote_number ? "ยังไม่มีรายการราคา" : undefined}>
          {busy ? "กำลังบันทึก…" : event?.quote_number ? `บันทึกและออกใบเสนอราคาใหม่ (R${event.quote_revision + 1})` : "บันทึกและออกใบเสนอราคา"}
        </Button>
      </div>

      {/* Gated on `dirty` alone, the same condition that arms the guard and
          registers with the shell — so what the screen SAYS and what it
          WARNS about can never disagree (review, 2026-09-20). */}
      {dirty && (
        <p className="text-right text-xs text-pending-ink">มีการแก้ไขที่ยังไม่ได้บันทึก</p>
      )}
      {serverMoved && (
        <p className="text-right text-xs text-pending-ink">
          ข้อมูลของงานนี้ถูกแก้ไขจากที่อื่น — <button type="button" onClick={reloadLatest} disabled={busy} className="underline disabled:opacity-50">โหลดข้อมูลล่าสุด</button>
        </p>
      )}
      {missingForSave.length > 0 && !busy && (
        <p className="text-right text-xs text-neutral-500">
          กรอก {missingForSave.join(" และ ")} ก่อนบันทึก
        </p>
      )}

      {/* The floating save bar: see saveBarRef above. The two buttons are
          the ones below the price box, verbatim: the same onClick, disabled
          and title. Beside the desktop sidebar (lg:left-52), not over it.
          m-0: this screen's space-y gives each child a bottom margin, which
          would lift a fixed bar 20px off the bottom edge. z-10: under the
          open lists of the SearchSelect and the customer box (z-30, z-20),
          so a list opened near the bottom is drawn over the bar, not under
          it; the phone menu and the dialogs (z-40, z-50) stay above. */}
      {dirty && (
        <div
          ref={saveBarRef}
          role="region"
          aria-label="บันทึกการแก้ไข"
          className="no-print fixed inset-x-0 bottom-0 z-10 m-0 border-t border-neutral-300 bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgb(23_23_23/0.08)] backdrop-blur-sm lg:left-52"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-2 sm:px-6">
            <span className="mr-auto text-xs text-pending-ink">มีการแก้ไขที่ยังไม่ได้บันทึก</span>
            <Button kind="secondary" onClick={() => save(false)} disabled={!canSave}>
              {busy ? "กำลังบันทึก…" : "บันทึกอย่างเดียว"}
            </Button>
            <Button kind="primary" onClick={() => save(true)} disabled={!canSave || (lines.length === 0 && !event?.quote_number)}
              title={lines.length === 0 && !event?.quote_number ? "ยังไม่มีรายการราคา" : undefined}>
              {busy ? "กำลังบันทึก…" : event?.quote_number ? `บันทึกและออกใบเสนอราคาใหม่ (R${event.quote_revision + 1})` : "บันทึกและออกใบเสนอราคา"}
            </Button>
          </div>
        </div>
      )}
      {duplicateRateLabels.length > 0 && (
        <p className="rounded-md bg-pending-soft px-3 py-2 text-sm text-pending-ink">
          รายการซ้ำ: {duplicateRateLabels.join(", ")} ถูกเพิ่มไว้มากกว่า 1 บรรทัด — ตรวจสอบก่อนบันทึก (บันทึกได้ตามปกติ)
        </p>
      )}

      {/* พิมพ์: the documents, named for who reads them (the service sheet and
          the kitchen's). BUTTONS, not text links: Nik used the page for a
          real job and thought there were no print buttons at all. Each keeps
          its old condition: a saved booking; the quotation once one exists. */}
      {event && (
        <ButtonGroup label="พิมพ์">
          {event.quote_number && <Link href={`/owner/catering/${event.id}/quote`} className={buttonClass("secondary")}>ใบเสนอราคา</Link>}
          {/* The event-details sheet (Nik, 2026-09-24): edited here, printed after the quotation or alone. */}
          <Link href={`/owner/catering/${event.id}/details`} className={buttonClass("secondary")}>ใบรายละเอียดงาน</Link>
          <Link href={`/owner/catering/${event.id}/function-sheet`} className={buttonClass("secondary")}>ใบฟังก์ชั่นงาน บริการ</Link>
          <Link href={`/owner/catering/${event.id}/kitchen-sheet`} className={buttonClass("secondary")}>ใบฟังก์ชั่นงาน ครัว</Link>
          {/* The card on each table (Nik, 2026-09-24): every status but cancelled. */}
          {event.status !== "cancelled" && <Link href={`/owner/catering/${event.id}/menu-card`} className={buttonClass("secondary")}>การ์ดเมนูบนโต๊ะ</Link>}
        </ButtonGroup>
      )}

      {/* Borders: #d4d4d4 is neutral-300, the app's own commonest control
          border (184 input-shaped className uses against 89 at the 200
          weight), and the weight the daily accounting screen uses — the one
          Nik works in every day without complaint. Focus is that screen's
          blue-400 too. The faint #e5e7eb this replaces is the shared
          .input-base, copied verbatim into seven files; the other six are
          untouched here and are Nik's decision, app-wide. */}
    </div>
  );
}

/**
 * แถมฟรี on one price-box line (Nik, 2026-09-24): a dish, rate or typed line
 * that prints under รายการแถมฟรี on the event-details sheet. The mark is what
 * makes it free, and it prices the line ฿0 (markFree); a ฿0 line without it
 * is not free, and the screen only warns about it.
 */
function FreeMark({ line, disabled, onChange }: { line: Line; disabled: boolean; onChange: (free: boolean) => void }) {
  return (
    <label className="mt-0.5 inline-flex items-center gap-1 text-xs text-neutral-600">
      <input type="checkbox" checked={line.free} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      แถมฟรี
    </label>
  );
}
