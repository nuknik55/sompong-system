"use client";

import { useState } from "react";

export function CategorySelect({
  value,
  categories,
  onChange,
}: {
  value: string;
  categories: string[];
  onChange: (v: string) => void;
}) {
  const [addingNew, setAddingNew] = useState(false);

  if (addingNew) {
    return (
      <input
        autoFocus
        placeholder="พิมพ์ชื่อหมวดใหม่"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value.trim()) setAddingNew(false);
        }}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm w-full"
      />
    );
  }

  return (
    <select
      value={categories.includes(value) ? value : ""}
      onChange={(e) => {
        if (e.target.value === "__new__") {
          onChange("");
          setAddingNew(true);
        } else {
          onChange(e.target.value);
        }
      }}
      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm w-full"
    >
      <option value="">ไม่มีหมวด</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value="__new__">+ เพิ่มหมวดใหม่...</option>
    </select>
  );
}
