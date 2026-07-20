"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CategorySelect } from "@/components/category-select";
import { Plus, Save } from "lucide-react";

const PENDING_SENTINEL = "__pending__";

type Props = (
  | {
      kind: "menu";
      createAction: (name: string, category: string, sellingPrice: number) => Promise<string>;
      hrefPrefix: string;
    }
  | {
      kind: "prep";
      createAction: (name: string, category: string, batchYieldQty: number, batchYieldUnit: string) => Promise<string>;
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
  const [showPendingSuccess, setShowPendingSuccess] = useState(false);

  function submit() {
    setError(null);
    setShowPendingSuccess(false);
    startTransition(async () => {
      try {
        const id =
          props.kind === "menu"
            ? await props.createAction(name, category, Number(sellingPrice) || 0)
            : await props.createAction(name, category, Number(batchYieldQty) || 1, batchYieldUnit);

        if (id === PENDING_SENTINEL) {
          // Editor pending — show success, reset form
          setShowPendingSuccess(true);
          setName(""); setCategory(""); setSellingPrice("");
          setBatchYieldQty("1"); setBatchYieldUnit("กรัม");
          setOpen(false);
          return;
        }

        router.push(`${props.hrefPrefix}/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างไม่สำเร็จ");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={() => { setOpen(true); setShowPendingSuccess(false); }}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-2 text-sm font-medium text-white hover:bg-brand-green/90"
        >
          <Plus className="h-4 w-4" />
          {props.kind === "menu" ? "สร้างเมนูใหม่" : "สร้างของ prep ใหม่"}
        </button>
        {showPendingSuccess && (
          <p className="text-xs text-amber-600">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</p>
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? "กำลังสร้าง..." : props.pendingMode ? "ส่งขออนุมัติ" : "สร้างและไปดูสูตร"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
