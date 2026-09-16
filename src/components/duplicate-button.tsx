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
  duplicateAction: (
    id: string,
    newName: string,
    newCategory: string,
  ) => Promise<
    | { status: "ok"; id: string }
    // prep-only: copied, but closed to its creator until the owner grants it
    | { status: "hidden"; name: string }
    | { status: "pending" }
    | { status: "error"; message: string }
  >;
  hrefPrefix: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${originalName} (สำเนา)`);
  const [category, setCategory] = useState(originalCategory ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => { setOpen(true); setPendingMsg(null); }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          คัดลอกสูตรนี้
        </button>
        {/* Boxed for the same reason as CreateRecipeForm's notice: bare
            coloured text under a button reads as an error. */}
        {pendingMsg && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{pendingMsg}</p>
        )}
      </div>
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
              const result = await duplicateAction(id, name, category);
              if (result.status === "error") { setError(result.message); return; }
              if (result.status === "pending") {
                // PRE-EXISTING BUG this type change surfaced: an editor's
                // duplicate returned the "__pending__" sentinel and this
                // component navigated to /staff/menu/__pending__ — a 404.
                // Now the pending outcome is shown where the error would be.
                setError(null);
                setPendingMsg("ส่งคำขอคัดลอกแล้ว — รอเจ้าของร้านอนุมัติ");
                setOpen(false);
                return;
              }
              if (result.status === "hidden") {
                // The copy is a new recipe with no grant row, so its page
                // would answer not-found. Stay here and say why.
                setError(null);
                setPendingMsg(`คัดลอกเป็น "${result.name}" แล้ว — จะเปิดดูสูตรได้เมื่อเจ้าของร้านเปิดสิทธิ์ให้`);
                setOpen(false);
                return;
              }
              router.push(`${hrefPrefix}/${result.id}`);
            } catch (e) {
              // Unexpected only — expected failures come back as values now.
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
