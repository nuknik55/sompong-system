"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { upsertCateringEvent, deleteCateringEvent } from "./actions";
import type { CateringEvent, CateringCustomer, StaffOption } from "./actions";

const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

// Values mirror the CHECK constraints in supabase/catering_migration.sql.
const VENUE_OPTIONS: { value: string; label: string }[] = [
  { value: "air_shared", label: "แอร์รวม" },
  { value: "room_v1",    label: "ห้อง V1" },
  { value: "room_v2",    label: "ห้อง V2" },
  { value: "room_v1_v2", label: "ห้อง V1 + V2" },
  { value: "offsite",    label: "นอกสถานที่" },
];
const BOOKING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "table",    label: "จองโต๊ะ" },
  { value: "room",     label: "จองห้อง" },
  { value: "catering", label: "จองงานจัดเลี้ยง" },
];
const FOOD_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "chinese_table", label: "โต๊ะจีน" },
  { value: "buffet",        label: "บุฟเฟต์" },
  { value: "a_la_carte",    label: "A la carte" },
  { value: "set_menu",      label: "ชุดเมนู" },
];
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "inquiry",          label: "สอบถาม" },
  { value: "awaiting_deposit", label: "รอมัดจำ" },
  { value: "deposit_paid",     label: "มัดจำแล้ว" },
  { value: "confirmed",        label: "คอนเฟิร์มแล้ว" },
  { value: "done",             label: "เสร็จสิ้น" },
  { value: "cancelled",        label: "ยกเลิก" },
];

const VENUE_LABEL        = Object.fromEntries(VENUE_OPTIONS.map((o) => [o.value, o.label]));
const BOOKING_TYPE_LABEL = Object.fromEntries(BOOKING_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const FOOD_FORMAT_LABEL  = Object.fromEntries(FOOD_FORMAT_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_LABEL       = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

const STATUS_COLOR: Record<string, string> = {
  inquiry:          "text-neutral-600 bg-neutral-50 border-neutral-200",
  awaiting_deposit: "text-amber-700 bg-amber-50 border-amber-200",
  deposit_paid:     "text-blue-700 bg-blue-50 border-blue-200",
  confirmed:        "text-green-700 bg-green-50 border-green-200",
  done:             "text-neutral-500 bg-neutral-100 border-neutral-300",
  cancelled:        "text-red-700 bg-red-50 border-red-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function thDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(d + "T00:00:00").getDay();
  return `${DAYS_SHORT[dow]} ${day}/${m}/${(y ?? 2500) + 543}`;
}

/** Postgres TIME comes back as HH:MM:SS; <input type="time"> wants HH:MM. */
function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

function timeRange(start: string | null, end: string | null): string {
  const s = toTimeInput(start);
  const e = toTimeInput(end);
  if (s && e) return `${s}–${e}`;
  return s || e || "–";
}

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function staffLabel(s: StaffOption): string {
  return s.nickname ?? s.full_name;
}

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  customerId: string | null;
  customerQuery: string;
  newPhone: string;
  newLineId: string;
  newCompany: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  booking_type: string;
  food_format: string;
  table_count: string;
  reserve_tables: string;
  table_label: string;
  guest_count: string;
  status: string;
  deposit_amount: string;
  deposit_paid_at: string;
  detail_note: string;
  kitchen_note: string;
  staff_ids: string[];
};

function blankForm(): FormState {
  return {
    customerId: null, customerQuery: "", newPhone: "", newLineId: "", newCompany: "",
    event_date: "", start_time: "", end_time: "",
    venue: "room_v2", booking_type: "table", food_format: "",
    table_count: "", reserve_tables: "", table_label: "", guest_count: "",
    status: "inquiry", deposit_amount: "", deposit_paid_at: "",
    detail_note: "", kitchen_note: "", staff_ids: [],
  };
}

function formFromEvent(e: CateringEvent): FormState {
  return {
    customerId: e.customer_id,
    customerQuery: e.customer_name ?? "",
    newPhone: "", newLineId: "", newCompany: "",
    event_date: e.event_date,
    start_time: toTimeInput(e.start_time),
    end_time: toTimeInput(e.end_time),
    venue: e.venue,
    booking_type: e.booking_type,
    food_format: e.food_format ?? "",
    table_count: e.table_count?.toString() ?? "",
    reserve_tables: e.reserve_tables?.toString() ?? "",
    table_label: e.table_label ?? "",
    guest_count: e.guest_count?.toString() ?? "",
    status: e.status,
    deposit_amount: e.deposit_amount?.toString() ?? "",
    deposit_paid_at: e.deposit_paid_at ?? "",
    detail_note: e.detail_note ?? "",
    kitchen_note: e.kitchen_note ?? "",
    staff_ids: e.staff_ids,
  };
}

// ─── Sub-components (module level on purpose) ─────────────────────────────────
// Declaring these inside CateringClient would give them a new function identity
// on every render, so React would remount them instead of updating — which
// destroys input DOM nodes and resets the caret on every keystroke.

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status] ?? ""}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function CustomerCombobox({
  customers,
  customerId,
  query,
  onPick,
  onQueryChange,
}: {
  customers: CateringCustomer[];
  customerId: string | null;
  query: string;
  onPick: (c: CateringCustomer | null) => void;
  onQueryChange: (text: string) => void;
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

  const q = query.trim().toLowerCase();
  const matches = q === ""
    ? customers.slice(0, 8)
    : customers
        .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
        .slice(0, 8);

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        className="input-base"
        placeholder="พิมพ์ชื่อ หรือ เบอร์โทร"
        value={query}
        onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {customerId && (
        <button
          type="button"
          onClick={() => { onPick(null); onQueryChange(""); setOpen(false); }}
          className="absolute right-2 top-1.5 text-xs text-neutral-400 hover:text-neutral-700"
        >
          ล้าง
        </button>
      )}
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { onPick(c); onQueryChange(c.name); setOpen(false); }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50 ${c.id === customerId ? "bg-blue-50" : ""}`}
              >
                <span className="text-neutral-800">
                  {c.name}
                  {c.company_name && <span className="ml-1 text-xs text-neutral-400">{c.company_name}</span>}
                </span>
                <span className="text-xs text-neutral-400">{c.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaffMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: StaffOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  // Offer active staff only, but keep showing anyone already assigned even if
  // they have since left — otherwise they would be stuck on the event with no
  // way to see or remove them.
  const visible = options.filter((s) => s.is_active || selected.includes(s.id));

  return (
    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-neutral-200 p-2">
      {visible.length === 0 && <span className="text-xs text-neutral-400">ไม่มีรายชื่อพนักงาน</span>}
      {visible.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            title={s.is_active ? undefined : "พนักงานคนนี้ไม่ได้ทำงานแล้ว"}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              on
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {staffLabel(s)}
            {!s.is_active && <span className="ml-1 opacity-60">(ลาออก)</span>}
          </button>
        );
      })}
    </div>
  );
}

function EventFormModal({
  initial,
  customers,
  staffOptions,
  isPending,
  error,
  onSave,
  onCancel,
}: {
  initial: CateringEvent | null;
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  isPending: boolean;
  error: string | null;
  onSave: (form: FormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? formFromEvent(initial) : blankForm()));

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isNewCustomer = form.customerId === null && form.customerQuery.trim() !== "";
  const canSave = form.event_date !== "" && form.customerQuery.trim() !== "" && !isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
          <h2 className="font-kanit text-base font-semibold">
            {initial ? "แก้ไขการจอง" : "บันทึกการจองใหม่"}
          </h2>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Customer */}
          <Field label="ลูกค้า *">
            <CustomerCombobox
              customers={customers}
              customerId={form.customerId}
              query={form.customerQuery}
              onPick={(c) => set("customerId", c?.id ?? null)}
              onQueryChange={(t) => setForm((f) => ({ ...f, customerQuery: t, customerId: null }))}
            />
          </Field>

          {isNewCustomer && (
            <div className="rounded-lg border border-green-200 bg-green-50/60 p-3">
              <p className="mb-2 text-xs font-medium text-green-800">
                ลูกค้าใหม่ — จะถูกสร้างเมื่อกดบันทึก: &quot;{form.customerQuery.trim()}&quot;
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Field label="เบอร์โทร">
                  <input className="input-base" value={form.newPhone}
                    onChange={(e) => set("newPhone", e.target.value)} />
                </Field>
                <Field label="LINE ID">
                  <input className="input-base" value={form.newLineId}
                    onChange={(e) => set("newLineId", e.target.value)} />
                </Field>
                <Field label="บริษัท">
                  <input className="input-base" value={form.newCompany}
                    onChange={(e) => set("newCompany", e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {/* Date + time */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="วันที่จัดงาน *">
              <input type="date" className="input-base" value={form.event_date}
                onChange={(e) => set("event_date", e.target.value)} />
            </Field>
            <Field label="เวลาเริ่ม">
              <input type="time" className="input-base" value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)} />
            </Field>
            <Field label="เวลาสิ้นสุด">
              <input type="time" className="input-base" value={form.end_time}
                onChange={(e) => set("end_time", e.target.value)} />
            </Field>
          </div>

          {/* Venue / type / format */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="สถานที่ *">
              <select className="input-base" value={form.venue} onChange={(e) => set("venue", e.target.value)}>
                {VENUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
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
          </div>

          {/* Counts */}
          <div className="grid grid-cols-4 gap-3">
            <Field label="จำนวนโต๊ะ">
              <input type="number" min={0} className="input-base" value={form.table_count}
                onChange={(e) => set("table_count", e.target.value)} />
            </Field>
            <Field label="โต๊ะสำรอง">
              <input type="number" min={0} className="input-base" value={form.reserve_tables}
                onChange={(e) => set("reserve_tables", e.target.value)} />
            </Field>
            <Field label="เลขโต๊ะ / หมายเหตุโต๊ะ">
              <input className="input-base" placeholder="T61, เต็มห้อง" value={form.table_label}
                onChange={(e) => set("table_label", e.target.value)} />
            </Field>
            <Field label="จำนวนแขก">
              <input type="number" min={0} className="input-base" value={form.guest_count}
                onChange={(e) => set("guest_count", e.target.value)} />
            </Field>
          </div>

          {/* Status + deposit */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="สถานะ *">
              <select className="input-base" value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="เงินมัดจำ (บาท)">
              <input type="number" min={0} className="input-base" value={form.deposit_amount}
                onChange={(e) => set("deposit_amount", e.target.value)} />
            </Field>
            <Field label="วันที่รับมัดจำ">
              <input type="date" className="input-base" value={form.deposit_paid_at}
                onChange={(e) => set("deposit_paid_at", e.target.value)} />
            </Field>
          </div>

          {/* Staff */}
          <Field label="ผู้รับงานจอง">
            <StaffMultiSelect
              options={staffOptions}
              selected={form.staff_ids}
              onToggle={(id) =>
                setForm((f) => ({
                  ...f,
                  staff_ids: f.staff_ids.includes(id)
                    ? f.staff_ids.filter((x) => x !== id)
                    : [...f.staff_ids, id],
                }))
              }
            />
          </Field>

          {/* Notes */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="รายละเอียดเพิ่มเติม">
              <textarea className="input-base h-20 resize-none" value={form.detail_note}
                onChange={(e) => set("detail_note", e.target.value)} />
            </Field>
            <Field label="แจ้งรายละเอียดให้ครัว">
              <textarea className="input-base h-20 resize-none" value={form.kitchen_note}
                onChange={(e) => set("kitchen_note", e.target.value)} />
            </Field>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white px-5 py-3">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
            ยกเลิก
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!canSave}
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CateringClient({
  initialEvents,
  customers,
  staffOptions,
  year,
  month,
}: {
  initialEvents: CateringEvent[];
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CateringEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CateringEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffById = new Map(staffOptions.map((s) => [s.id, s]));

  function goMonth(delta: number) {
    let y = year, m = month + delta;
    if (m > 12) { y++; m = 1; }
    if (m < 1)  { y--; m = 12; }
    router.push(`/owner/catering?year=${y}&month=${m}`);
  }

  function openNew() { setEditing(null); setError(null); setShowForm(true); }
  function openEdit(e: CateringEvent) { setEditing(e); setError(null); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(null); setError(null); }

  function handleSave(form: FormState) {
    setError(null);
    startTransition(async () => {
      try {
        await upsertCateringEvent({
          id: editing?.id,
          customer_id: form.customerId,
          new_customer: form.customerId
            ? null
            : {
                name: form.customerQuery,
                phone: form.newPhone,
                line_id: form.newLineId,
                company_name: form.newCompany,
              },
          event_date: form.event_date,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          venue: form.venue,
          booking_type: form.booking_type,
          food_format: form.food_format || null,
          table_count: toNum(form.table_count),
          reserve_tables: toNum(form.reserve_tables),
          table_label: form.table_label,
          guest_count: toNum(form.guest_count),
          status: form.status,
          deposit_amount: toNum(form.deposit_amount),
          deposit_paid_at: form.deposit_paid_at || null,
          detail_note: form.detail_note,
          kitchen_note: form.kitchen_note,
          staff_ids: form.staff_ids,
        });
        closeForm();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    startTransition(async () => {
      try {
        await deleteCateringEvent(id);
        setConfirmDelete(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">←</button>
          <span className="min-w-[150px] text-center text-sm font-medium">
            {MONTHS_TH[month - 1]} {year + 543}
          </span>
          <button onClick={() => goMonth(1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">→</button>
        </div>
        <button onClick={openNew} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          + บันทึกการจอง
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
              <th className="px-3 py-2 whitespace-nowrap">วันที่</th>
              <th className="px-3 py-2 whitespace-nowrap">เวลา</th>
              <th className="px-3 py-2">ลูกค้า</th>
              <th className="px-3 py-2">สถานที่</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2">อาหาร</th>
              <th className="px-3 py-2 text-center">โต๊ะ</th>
              <th className="px-3 py-2 text-center">แขก</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">ผู้รับงาน</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {initialEvents.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-neutral-400">
                  ไม่มีการจองในเดือนนี้
                </td>
              </tr>
            )}
            {initialEvents.map((e, i) => (
              <tr key={e.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{thDate(e.event_date)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-600 tabular-nums">{timeRange(e.start_time, e.end_time)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-900">{e.customer_name ?? "–"}</div>
                  {e.customer_phone && <div className="text-xs text-neutral-400 tabular-nums">{e.customer_phone}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">{VENUE_LABEL[e.venue] ?? e.venue}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">{BOOKING_TYPE_LABEL[e.booking_type] ?? e.booking_type}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">{e.food_format ? FOOD_FORMAT_LABEL[e.food_format] ?? e.food_format : "–"}</td>
                <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">
                  {e.table_count ?? (e.table_label ? "" : "–")}
                  {e.reserve_tables ? <span className="text-neutral-400"> +{e.reserve_tables}</span> : null}
                  {e.table_label && <div className="text-[10px] text-neutral-400">{e.table_label}</div>}
                </td>
                <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">{e.guest_count ?? "–"}</td>
                <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  {e.staff_ids.length === 0
                    ? "–"
                    : e.staff_ids.map((id) => {
                        const s = staffById.get(id);
                        return s ? staffLabel(s) : "?";
                      }).join(", ")}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => openEdit(e)} className="text-xs text-blue-600 hover:underline">แก้ไข</button>
                  <button onClick={() => setConfirmDelete(e)} className="ml-2 text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && !showForm && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {/* Form modal */}
      {showForm && (
        <EventFormModal
          key={editing?.id ?? "new"}
          initial={editing}
          customers={customers}
          staffOptions={staffOptions}
          isPending={isPending}
          error={error}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">ลบการจอง?</h3>
            <p className="mb-4 text-sm text-neutral-500">
              {confirmDelete.customer_name ?? "ไม่ระบุลูกค้า"} · {thDate(confirmDelete.event_date)}
              <br />
              ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button onClick={handleDelete} disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {isPending ? "กำลังลบ…" : "ลบถาวร"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </>
  );
}
