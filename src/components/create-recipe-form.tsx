"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CategorySelect } from "@/components/category-select";
import { Plus, Save } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

// Item 12: the action returns its outcome as a value (ok/pending/error), so
// the Thai message reaches the user in production — a thrown Server Action
// message is redacted there. "pending" replaces the "__pending__" magic id.
// "hidden" is prep-only: created, but closed to its own creator until the
// owner grants it (see PrepCreateResult in staff/prep/actions.ts).
type CreateResult =
  | { status: "ok"; id: string }
  | { status: "hidden"; name: string }
  | { status: "pending" }
  | { status: "error"; message: string };

type Props = (
  | {
      kind: "menu";
      createAction: (name: string, category: string, sellingPrice: number) => Promise<CreateResult>;
      hrefPrefix: string;
    }
  | {
      kind: "prep";
      createAction: (name: string, category: string, batchYieldQty: number, batchYieldUnit: string) => Promise<CreateResult>;
      hrefPrefix: string;
    }
) & { categories: string[]; pendingMode?: boolean };

export function CreateRecipeForm(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [batchYieldQty, setBatchYieldQty] = useState("1");
  const [batchYieldUnit, setBatchYieldUnit] = useState("กรัม");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What happened to a create that did not navigate: sent for approval, or
  // created but not yet open to its creator.
  const [notice, setNotice] = useState<string | null>(null);

  function submit() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result =
          props.kind === "menu"
            ? await props.createAction(name, category, Number(sellingPrice) || 0)
            : await props.createAction(name, category, Number(batchYieldQty) || 1, batchYieldUnit);

        if (result.status === "error") { setError(result.message); return; }
        if (result.status === "pending" || result.status === "hidden") {
          // Neither has a page to go to: an editor's request is not a recipe
          // yet, and a hidden prep would answer not-found. Say which, reset.
          setNotice(
            result.status === "pending"
              ? "⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ"
              : `สร้าง "${result.name}" แล้ว — จะเปิดดูสูตรได้เมื่อเจ้าของร้านเปิดสิทธิ์ให้`,
          );
          setName(""); setCategory(""); setSellingPrice("");
          setBatchYieldQty("1"); setBatchYieldUnit("กรัม");
          setOpen(false);
          return;
        }

        router.push(`${props.hrefPrefix}/${result.id}`);
      } catch (e) {
        // Unexpected only — expected failures come back as values now.
        setError(e instanceof Error ? e.message : "สร้างไม่สำเร็จ");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={() => { setOpen(true); setNotice(null); }}
          className={buttonClass("primary")}
        >
          <Plus className="h-4 w-4" />
          {props.kind === "menu" ? "สร้างเมนูใหม่" : "สร้างของ prep ใหม่"}
        </button>
        {/* A BOX, not bare coloured text. Bare text-amber-600 is #dd7400 in
            Tailwind 4, and sitting where an error would, it was read as one
            (Nik, 2026-09-16) — a success in error colours teaches people to
            distrust the colour. Same shape as the app's other amber notices. */}
        {notice && (
          <p className="rounded-md border border-pending/60 bg-pending-soft px-3 py-2 text-xs text-pending-ink">{notice}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      <input
        placeholder={props.kind === "menu" ? "ชื่อเมนู *" : "ชื่อของ prep *"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <CategorySelect value={category} categories={props.categories} onChange={setCategory} />
      {props.kind === "menu" ? (
        <input
          placeholder="ราคาขาย (บาท)"
          type="text"
          inputMode="decimal"
          value={sellingPrice}
          onChange={(e) => setSellingPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
      ) : (
        <div className="flex gap-2">
          <input
            placeholder="ทำได้กี่หน่วย"
            type="text"
            inputMode="decimal"
            value={batchYieldQty}
            onChange={(e) => setBatchYieldQty(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="หน่วย เช่น กรัม"
            value={batchYieldUnit}
            onChange={(e) => setBatchYieldUnit(e.target.value)}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className={buttonClass("primary")}
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? "กำลังสร้าง..." : props.pendingMode ? "ส่งขออนุมัติ" : "สร้างและไปดูสูตร"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
