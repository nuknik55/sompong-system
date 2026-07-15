"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";

export type ComboboxOption = {
  id: string;
  name: string;
  category: string | null;
  is_prep: boolean;
};

export function IngredientCombobox({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: ComboboxOption[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    function updatePos() {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom, left: rect.left, width: rect.width });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    const groups = new Map<string, ComboboxOption[]>();
    for (const opt of list) {
      const key = opt.category ?? "ไม่มีหมวด";
      const arr = groups.get(key) ?? [];
      arr.push(opt);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "th"));
  }, [options, query]);

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  const dropdown =
    open && pos ? (
      <div
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: Math.max(pos.width, 260),
          zIndex: 9999,
        }}
        className="max-h-72 overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg"
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            if (blurTimeout.current) clearTimeout(blurTimeout.current);
            onChange(null);
            setOpen(false);
            setQuery("");
          }}
          className="block w-full px-3 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-100"
        >
          — ไม่เลือก —
        </button>
        {filtered.length === 0 && <p className="px-3 py-2 text-sm text-neutral-400">ไม่พบวัตถุดิบที่ค้นหา</p>}
        {filtered.map(([category, opts]) => (
          <div key={category}>
            <p className="bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500">{category}</p>
            {opts.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimeout.current) clearTimeout(blurTimeout.current);
                  select(opt.id);
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 ${
                  opt.id === value ? "bg-neutral-100 font-medium" : ""
                }`}
              >
                {opt.is_prep ? `🧪 ${opt.name}` : opt.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected?.name ?? "")}
        placeholder="ค้นหาวัตถุดิบ..."
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => {
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
        }}
        className="w-full min-w-[220px] rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
