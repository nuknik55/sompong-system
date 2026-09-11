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

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getRoomConflictCandidates, saveBooking } from "./actions";
import type {
  BookingLine, CateringCharge, CateringCustomer, CateringDishOption, CateringEvent, CateringRate,
  CateringSetMenuOption, StaffOption,
} from "./actions";
import { ROOM_CONFLICTS, findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";
import {
  LOCATION_TYPE_OPTIONS, VENUE_OPTIONS, BOOKING_TYPE_OPTIONS, FOOD_FORMAT_OPTIONS, STATUS_OPTIONS,
  VENUE_LABEL, RATE_TYPE_TO_CHARGE_TYPE, blankForm, formFromEvent, formToUpsertPayload, conflictTimeLabel,
  fmtBaht, toNum, staffLabel, Field,
} from "./shared-utils";
import type { FormState } from "./shared-utils";
import { CustomerCombobox, SearchSelect, Time24Input, ToggleGroup } from "./shared";

// ─── Price box model ─────────────────────────────────────────────────────────

type Line = {
  key: string;
  /** set/dish: a menu line (unit price locked to the menu). rate: from catering_rates. manual: typed. discount: negative. */
  kind: "set" | "dish" | "rate" | "manual" | "discount";
  section: Section;
  refId: string | null;
  eventMenuId: string | null;
  label: string;
  unitPrice: string;
  quantity: string;
  amount: string;
  chargeType: string;
};

type Section = "menu" | "room" | "drink" | "delivery" | "music" | "other" | "discount";

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

const SECTION_BY_CHARGE_TYPE: Record<string, Section> = {
  venue: "room", drink: "drink", transport: "delivery", discount: "discount", food: "menu",
};

function sectionForCharge(c: CateringCharge): Section {
  if (c.event_menu_id) return "menu";
  if (c.charge_type === "discount") return "discount";
  if (c.charge_type === "service" && /ดนตรี|คาราโอเกะ|วง/.test(c.label)) return "music";
  return SECTION_BY_CHARGE_TYPE[c.charge_type] ?? "other";
}

function linesFromCharges(charges: CateringCharge[]): Line[] {
  return charges.map((c) => ({
    key: c.id,
    kind: c.event_menu_id ? (c.event_menu_kind === "set" ? "set" : "dish") : c.charge_type === "discount" ? "discount" : "manual",
    section: sectionForCharge(c),
    refId: null,
    eventMenuId: c.event_menu_id,
    label: c.label,
    unitPrice: String(c.unit_price),
    quantity: String(c.quantity),
    amount: String(c.amount),
    chargeType: c.charge_type,
  }));
}

function money(n: number) { return `฿${fmtBaht(n)}`; }

/** Device memory of the last taker chosen, for logins with no linked employee. */
const LAST_TAKER_KEY = "catering.lastTaker";

// ─── Screen ──────────────────────────────────────────────────────────────────

export function BookingScreen({
  event,
  initialCharges,
  customers,
  staffOptions,
  rates,
  setMenuOptions,
  dishOptions,
  defaultStaffId,
}: {
  event: CateringEvent | null;
  initialCharges: CateringCharge[];
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  rates: CateringRate[];
  setMenuOptions: CateringSetMenuOption[];
  dishOptions: CateringDishOption[];
  /** The login's linked employee; pre-selected as taker on a new booking. */
  defaultStaffId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => (event ? formFromEvent(event) : blankForm(defaultStaffId)));
  const [lines, setLines] = useState<Line[]>(() => linesFromCharges(initialCharges));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm((f) => ({ ...f, [k]: v })); }

  // ── Room conflict: same rule as the server (conflict.ts); hard-blocks save ──
  const excludeId = event?.id ?? null;
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
      chargeType: section === "music" ? "service" : (RATE_TYPE_TO_CHARGE_TYPE[rate.rate_type] ?? "other"),
    }]);
  }
  function addMenu(kind: "set" | "dish", id: string) {
    if (lines.some((l) => l.kind === kind && l.refId === id)) return; // one line per set: the server bumps quantity on a repeat add
    const opt = kind === "set" ? setMenuOptions.find((s) => s.id === id) : dishOptions.find((d) => d.id === id);
    if (!opt) return;
    const price = kind === "set" ? (opt as CateringSetMenuOption).price_per_set : (opt as CateringDishOption).selling_price;
    const qty = kind === "set" ? (toNum(form.table_count) ?? 1) : 1;
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), kind, section: "menu", refId: id, eventMenuId: null,
      label: opt.name, unitPrice: String(price), quantity: String(qty), amount: String(price * qty), chargeType: "food",
    }]);
  }
  function addManual(section: Section) {
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), kind: section === "discount" ? "discount" : "manual", section, refId: null, eventMenuId: null,
      label: section === "discount" ? "ส่วนลด" : "", unitPrice: "", quantity: "1", amount: "", chargeType: section === "discount" ? "discount" : "other",
    }]);
  }
  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      if ("unitPrice" in patch || "quantity" in patch) {
        const up = toNum(next.unitPrice) ?? 0, q = toNum(next.quantity) ?? 0;
        next.amount = String(next.kind === "discount" ? -Math.abs(up * q) : up * q);
      }
      if ("amount" in patch && next.kind === "discount") next.amount = String(-Math.abs(toNum(next.amount) ?? 0));
      return next;
    }));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  // ── Save ──
  const canSave = form.event_date !== "" && form.customerQuery.trim() !== "" && !isPending && !conflict;

  function buildLines(): BookingLine[] {
    return lines
      .filter((l) => l.kind === "set" || l.kind === "dish" || l.label.trim() !== "")
      .map((l): BookingLine =>
        l.kind === "set" || l.kind === "dish"
          ? { kind: l.kind, refId: l.refId ?? "", eventMenuId: l.eventMenuId, quantity: Math.max(1, toNum(l.quantity) ?? 1) }
          : { kind: "charge", label: l.label, charge_type: l.chargeType, unit_price: toNum(l.unitPrice) ?? 0, quantity: toNum(l.quantity) ?? 1, amount: toNum(l.amount) ?? 0, note: null },
      );
  }

  function save(issueQuote: boolean) {
    setError(null);
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
    startTransition(async () => {
      const result = await saveBooking({ event: formToUpsertPayload(derived, event?.id), lines: buildLines(), issueQuote });
      if (!result.ok) { setError(result.error); return; }
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
  useEffect(() => {
    if (event || defaultStaffId) return;
    try {
      const last = localStorage.getItem(LAST_TAKER_KEY);
      if (last && staffOptions.some((s) => s.id === last && s.takes_bookings && s.is_active)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from device storage, unavailable during render under SSR
        setForm((f) => (f.staff_ids.length === 0 ? { ...f, staff_ids: [last] } : f));
      }
    } catch { /* storage unavailable: no default */ }
  }, [event, defaultStaffId, staffOptions]);

  return (
    <div className="space-y-5">
      {/* ── The booking: the sheet's row ── */}
      <section className="space-y-4 rounded-xl border border-neutral-300 bg-white p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="ลูกค้า *" className="sm:col-span-2">
            <CustomerCombobox
              customers={customers}
              customerId={form.customerId}
              query={form.customerQuery}
              onPick={(c) => setForm((f) => ({ ...f, customerId: c?.id ?? null, customerAddress: c?.address ?? "", customerContactPerson: c?.contact_person ?? "" }))}
              onQueryChange={(t) => setForm((f) => ({ ...f, customerQuery: t, customerId: null }))}
            />
          </Field>
          <Field label="เบอร์โทร">
            {pickedCustomer ? (
              <input className="input-base" value={pickedCustomer.phone ?? ""} readOnly title="เบอร์ที่บันทึกไว้ของลูกค้ารายนี้" />
            ) : (
              <input className="input-base" value={form.newPhone} onChange={(e) => set("newPhone", e.target.value)} placeholder="ลูกค้าใหม่" />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="วันที่จัดงาน *">
            <input type="date" className="input-base" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} />
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
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
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
            {takers.length === 0 && <p className="mt-1 text-xs text-amber-700">ยังไม่มีใครถูกตั้งเป็นผู้รับงานจอง — ติ๊ก &quot;รับงานจองจัดเลี้ยง&quot; ในหน้าพนักงาน (HR)</p>}
          </Field>
          <Field label="เงินมัดจำ (บาท)">
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
          <h2 className="font-kanit text-base font-semibold text-neutral-900">ราคา / ใบเสนอราคา</h2>
          <p className="text-xs text-neutral-500">
            {event?.quote_number
              ? <>เลขที่ <span className="font-medium tabular-nums text-neutral-700">{event.quote_number}</span>{event.quote_revision > 0 && ` (แก้ไขครั้งที่ ${event.quote_revision})`}</>
              : "ยังไม่เคยออกใบเสนอราคา"}
          </p>
        </div>
        <div className="divide-y divide-neutral-200">
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
                        <input className="line-input" placeholder="รายการ" value={l.label} disabled={isPending} onChange={(e) => updateLine(l.key, { label: e.target.value })} />
                      ) : (
                        <span className="truncate text-sm text-neutral-800" title={l.label}>{l.label}</span>
                      )}
                      <input type="number" className="line-input text-right tabular-nums" value={l.kind === "discount" ? String(Math.abs(toNum(l.unitPrice) ?? 0) || "") : l.unitPrice}
                        disabled={isPending || l.kind === "set" || l.kind === "dish"} title={l.kind === "set" || l.kind === "dish" ? "ราคาตามชุดเมนู" : "ราคาต่อหน่วย"}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                      <input type="number" min={1} className="line-input text-right tabular-nums" value={l.quantity} disabled={isPending}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                      <span className={`text-right text-sm tabular-nums ${l.kind === "discount" ? "text-red-700" : "text-neutral-900"}`}>{money(toNum(l.amount) ?? 0)}</span>
                      <button type="button" onClick={() => removeLine(l.key)} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    {sec.key === "menu" && (
                      <>
                        {/* Type to filter: 238 dishes is not a scrollable list. */}
                        <div className="w-56">
                          <SearchSelect
                            options={setMenuOptions.map((s) => ({ id: s.id, name: s.name, price: s.price_per_set }))}
                            placeholder="+ ชุดเมนู × โต๊ะ — พิมพ์เพื่อค้นหา"
                            disabled={isPending}
                            onPick={(id) => addMenu("set", id)}
                          />
                        </div>
                        <div className="w-56">
                          <SearchSelect
                            options={dishOptions.map((d) => ({ id: d.id, name: d.name, price: d.selling_price }))}
                            placeholder="+ เมนูเดี่ยว — พิมพ์เพื่อค้นหา"
                            disabled={isPending}
                            onPick={(id) => addMenu("dish", id)}
                          />
                        </div>
                      </>
                    )}
                    {sectionRates.length > 0 && (
                      <select className="line-input w-64" value="" disabled={isPending} onChange={(e) => { const r = sectionRates.find((x) => x.id === e.target.value); if (r) addRate(sec.key, r); }}>
                        <option value="">+ เลือกจากอัตรา</option>
                        {sectionRates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label} — {fmtBaht(r.amount)}{r.unit ? ` / ${r.unit}` : ""}{suggestedDelivery?.id === r.id ? " (ตรงระยะทาง)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {(sec.key === "other" || sec.key === "discount") && (
                      <button type="button" onClick={() => addManual(sec.key)} disabled={isPending} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
                        {sec.key === "discount" ? "+ ส่วนลด" : "+ พิมพ์รายการเอง"}
                      </button>
                    )}
                    {sec.key === "delivery" && form.location_type !== "offsite" && rows.length === 0 && (
                      <span className="text-xs text-neutral-400">เฉพาะงานนอกสถานที่</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-neutral-300 pt-3">
          <span className="text-sm font-medium text-neutral-700">รวมทั้งหมด</span>
          <span className="text-lg font-semibold tabular-nums text-neutral-900">{money(total)}</span>
        </div>
      </section>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 text-sm">
          {event && <Link href={`/owner/catering/${event.id}/function-sheet`} className="text-neutral-500 hover:text-neutral-800">พิมพ์ใบฟังก์ชั่นงาน</Link>}
          {event?.quote_number && <Link href={`/owner/catering/${event.id}/quote`} className="text-neutral-500 hover:text-neutral-800">พิมพ์ใบเสนอราคา</Link>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => save(false)} disabled={!canSave}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            {isPending ? "กำลังบันทึก…" : "บันทึกอย่างเดียว"}
          </button>
          <button type="button" onClick={() => save(true)} disabled={!canSave || lines.length === 0}
            title={lines.length === 0 ? "ยังไม่มีรายการราคา" : undefined}
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            {isPending ? "กำลังบันทึก…" : event?.quote_number ? `บันทึกและออกใบเสนอราคาใหม่ (R${event.quote_revision + 1})` : "บันทึกและออกใบเสนอราคา"}
          </button>
        </div>
      </div>

      {/* Borders: #d4d4d4 is neutral-300, the app's own commonest control
          border (184 input-shaped className uses against 89 at the 200
          weight), and the weight the daily accounting screen uses — the one
          Nik works in every day without complaint. Focus is that screen's
          blue-400 too. The faint #e5e7eb this replaces is the shared
          .input-base, copied verbatim into seven files; the other six are
          untouched here and are Nik's decision, app-wide. */}
      <style>{`
        .input-base { width: 100%; border: 1px solid #d4d4d4; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; color: #171717; }
        .input-base:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,0.25); }
        .input-base:read-only { background: #f5f5f5; color: #525252; }
        .input-base::placeholder { color: #a3a3a3; }
        .line-input { width: 100%; border: 1px solid #d4d4d4; border-radius: 6px; padding: 4px 8px; font-size: 0.8125rem; outline: none; background: white; color: #171717; }
        .line-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,0.25); }
        .line-input:disabled { background: #f5f5f5; color: #737373; }
        .line-input::placeholder { color: #a3a3a3; }
      `}</style>
    </div>
  );
}
