"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CategorySelect } from "@/components/category-select";

export function DuplicateButton({
  id,
  originalName,
  originalCategory,
  categories,
  duplicateAction,
  hrefPrefix,
}: {
  id: string;
  originalName: string;
  originalCategory: string | null;
  categories: string[];
  duplicateAction: (id: string, newName: string, newCategory: string) => Promise<string>;
  hrefPrefix: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${originalName} (สำเนา)`);
  const [category, setCategory] = useState(originalCategory ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
      >
        คัดลอกสูตรนี้
      </button>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ชื่อเมนู/ของเตรียมใหม่"
        className="w-56 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <div className="w-40">
        <CategorySelect value={category} categories={categories} onChange={setCategory} />
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const newId = await duplicateAction(id, name, category);
              router.push(`${hrefPrefix}/${newId}`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "คัดลอกไม่สำเร็จ");
            }
          });
        }}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {isPending ? "กำลังคัดลอก..." : "ยืนยันคัดลอก"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
        ยกเลิก
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
