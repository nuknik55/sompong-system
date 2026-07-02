"use client";

import { useState } from "react";
import { getRecipeHistory, type RecipeHistoryEntry, type RecipeTarget } from "@/app/staff/actions";

const ACTION_LABEL: Record<RecipeHistoryEntry["action"], string> = {
  insert: "เพิ่ม",
  update: "แก้ปริมาณ",
  delete: "ลบ",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function RecipeHistory({ target, parentId }: { target: RecipeTarget; parentId: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<RecipeHistoryEntry[] | null>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!history) getRecipeHistory(target, parentId).then(setHistory);
        }}
        className="text-xs text-neutral-500 underline hover:text-neutral-800"
      >
        {open ? "ปิดประวัติสูตร" : "ดูประวัติสูตร"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-3">
          {history == null ? (
            <p className="text-sm text-neutral-400">กำลังโหลด...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-neutral-400">ยังไม่มีประวัติสูตร</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-b border-neutral-100 pb-1 last:border-0">
                  <span className="text-neutral-400">{formatDate(h.changedAt)}</span> โดย{" "}
                  <span className="font-medium">{h.changedByName}</span> — {ACTION_LABEL[h.action]}{" "}
                  <span className="font-medium">{h.ingredientName}</span>
                  {h.action === "update" && (
                    <span className="text-neutral-600">
                      {" "}
                      ({h.oldQuantity ?? "-"} → {h.newQuantity ?? "-"})
                    </span>
                  )}
                  {h.action === "insert" && <span className="text-neutral-600"> (ปริมาณ {h.newQuantity ?? "-"})</span>}
                  {h.action === "delete" && <span className="text-neutral-600"> (ปริมาณเดิม {h.oldQuantity ?? "-"})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
