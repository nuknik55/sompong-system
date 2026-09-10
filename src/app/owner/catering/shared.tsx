"use client";

// The interactive pieces the booking screen (BookingScreen.tsx) is built
// from: ToggleGroup, Time24Input and CustomerCombobox. Only things with
// hooks or browser APIs live here; plain constants, formatters and
// non-interactive components are in shared-utils.tsx so server components
// can import them (see that file's header for why the split exists).
//
// EventForm, EventFormModal and StaffMultiSelect used to live here: the
// create modal and the detail page's edit form. The one-screen
// BookingScreen replaced both on 2026-09-10, with zero live events to
// migrate.

import { useState, useRef, useEffect } from "react";
import type { CateringCustomer } from "./actions";

// ─── Sub-components (module level on purpose) ─────────────────────────────────
// Declaring these inside a page component would give them a new function
// identity on every render, so React would remount them instead of updating —
// which destroys input DOM nodes and resets the caret on every keystroke.

/** Toggle-button group shared by location_type / room_portion / music_type. */
export function ToggleGroup({
  options,
  value,
  onPick,
}: {
  options: { value: string; label: string }[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const timeSelectCls = "rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-500/15";

/**
 * Native <input type="time"> renders per the browser/OS locale, not the
 * page's <html lang>, so it can still show a 12-hour AM/PM picker even with
 * lang="th" set (confirmed in the field on at least one device/browser).
 * This controls the hour/minute segments directly instead of delegating to
 * the native widget, so the display is always 24-hour everywhere. Value
 * format matches what the native input produced ("" or "HH:MM"), so nothing
 * downstream (FormState, formToUpsertPayload, findRoomConflict, …) changes.
 */
export function Time24Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value ? value.split(":") : ["", ""];

  function setHour(hh: string) {
    onChange(hh === "" && m === "" ? "" : `${hh || "00"}:${m || "00"}`);
  }
  function setMinute(mm: string) {
    onChange(h === "" && mm === "" ? "" : `${h || "00"}:${mm || "00"}`);
  }

  return (
    <div className="flex items-center gap-1">
      <select className={timeSelectCls} value={h} onChange={(e) => setHour(e.target.value)}>
        <option value="">--</option>
        {HOURS.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <span className="text-neutral-400">:</span>
      <select className={timeSelectCls} value={m} onChange={(e) => setMinute(e.target.value)}>
        <option value="">--</option>
        {MINUTES.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
      {value && (
        <button type="button" onClick={() => onChange("")} title="ล้างเวลา" className="text-xs text-neutral-400 hover:text-neutral-700">
          ✕
        </button>
      )}
    </div>
  );
}

export function CustomerCombobox({
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