"use client";

import { useMemo, useRef, useState } from "react";
import type { MenuOption } from "@/lib/sop-data";

export function MenuCombobox({
  value,
  options,
  onChange,
  placeholder = "ค้นหาชื่อเมนู...",
}: {
  value: string | null;
  options: MenuOption[];
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    const groups = new Map<string, MenuOption[]>();
    for (const opt of list) {
      const key = opt.category ?? "ไม่มีหมวด";
      const arr = groups.get(key) ?? [];
      arr.push(opt);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "th"));
  }, [options, query]);

  const totalFiltered = filtered.reduce((sum, [, opts]) => sum + opts.length, 0);

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : (selected?.name ?? "")}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => {
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
        }}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {totalFiltered === 0 && (
            <p className="px-3 py-3 text-sm text-neutral-400">ไม่พบเมนูที่ค้นหา</p>
          )}
          {filtered.map(([category, opts]) => (
            <div key={category}>
              <p className="sticky top-0 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500">
                {category}
              </p>
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
                    opt.id === value ? "bg-brand-green/10 font-medium text-brand-green" : ""
                  }`}
                >
                  {opt.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
