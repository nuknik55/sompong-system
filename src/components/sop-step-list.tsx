"use client";

import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { buttonClass } from "@/components/ui/button";
import { withStepPhoto } from "@/components/sop-rules";

export type StepItem = {
  tempId: string;
  text: string;
  photoUrl: string | null;
};

export type ChecklistItem = {
  tempId: string;
  text: string;
};

function tempId() {
  return `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Generic step list (prep / cook / plating — with photo upload) ──────────

export function SopStepList({
  steps,
  onChange,
  sectionLabel,
  placeholder = "อธิบายขั้นตอน...",
  onUploadBusy,
}: {
  steps: StepItem[];
  /** A new list, or (for a photo that lands later) an update of the list as it is then. */
  onChange: (steps: StepItem[] | ((prev: StepItem[]) => StepItem[])) => void;
  sectionLabel: string;
  placeholder?: string;
  /** An upload started (true) or ended (false). */
  onUploadBusy?: (busy: boolean) => void;
}) {
  function insert(afterIndex: number) {
    const next = [...steps];
    next.splice(afterIndex + 1, 0, { tempId: tempId(), text: "", photoUrl: null });
    onChange(next);
  }

  function append() {
    onChange([...steps, { tempId: tempId(), text: "", photoUrl: null }]);
  }

  function remove(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: "up" | "down") {
    const next = [...steps];
    const target = dir === "up" ? i - 1 : i + 1;
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }

  function patchText(i: number, text: string) {
    const next = [...steps];
    next[i] = { ...next[i], text };
    onChange(next);
  }

  // Queue item 42: by the step's id, against the list as it is when the
  // upload lands — the list captured when the file was picked is stale by
  // then, and replacing the section with it reverted every edit made meanwhile.
  function patchPhoto(id: string, photoUrl: string | null) {
    onChange((prev) => withStepPhoto(prev, id, photoUrl));
  }

  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={step.tempId}>
          {/* ── Step card ── */}
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-500">
                {sectionLabel} ขั้นตอนที่ {i + 1}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, "up")}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  title="เลื่อนขึ้น"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, "down")}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  title="เลื่อนลง"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="rounded p-1 text-neutral-500 hover:bg-danger-soft hover:text-danger"
                  title="ลบขั้นตอน"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <textarea
              value={step.text}
              onChange={(e) => {
                patchText(i, e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
              ref={(el) => {
                if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
              }}
              placeholder={placeholder}
              rows={2}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-2">
              <SopPhotoUpload
                photoUrl={step.photoUrl}
                onChange={(url) => patchPhoto(step.tempId, url)}
                onBusyChange={onUploadBusy}
              />
            </div>
          </div>

          {/* ── Insert divider ── */}
          <div className="flex items-center gap-2 py-1">
            <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
            <button
              type="button"
              onClick={() => insert(i)}
              className={buttonClass("secondary", { size: "sm" })}
            >
              <Plus className="h-3 w-3" />
              แทรกที่นี่
            </button>
            <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={append}
        className={buttonClass("secondary")}
      >
        <Plus className="h-4 w-4" />
        เพิ่มขั้นตอน{sectionLabel ? ` (${sectionLabel})` : ""}
      </button>
    </div>
  );
}

// ── Checklist (text only, no photos) ────────────────────────────────────────

export function SopChecklistEditor({
  items,
  onChange,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}) {
  function append() {
    onChange([...items, { tempId: tempId(), text: "" }]);
  }

  function insert(afterIndex: number) {
    const next = [...items];
    next.splice(afterIndex + 1, 0, { tempId: tempId(), text: "" });
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: "up" | "down") {
    const next = [...items];
    const target = dir === "up" ? i - 1 : i + 1;
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }

  function patchText(i: number, text: string) {
    const next = [...items];
    next[i] = { ...next[i], text };
    onChange(next);
  }

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={item.tempId}>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <span className="shrink-0 text-sm text-neutral-500">☐</span>
            <input
              type="text"
              value={item.text}
              onChange={(e) => patchText(i, e.target.value)}
              placeholder="รายการตรวจสอบ..."
              className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, "up")}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={i === items.length - 1}
              onClick={() => move(i, "down")}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded p-1 text-neutral-500 hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Insert divider */}
          <div className="flex items-center gap-2 py-0.5">
            <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
            <button
              type="button"
              onClick={() => insert(i)}
              className={buttonClass("secondary", { size: "sm" })}
            >
              <Plus className="h-3 w-3" />
              แทรก
            </button>
            <div className="h-px flex-1 border-t border-dashed border-neutral-200" />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={append}
        className={buttonClass("secondary")}
      >
        <Plus className="h-4 w-4" />
        เพิ่มรายการตรวจสอบ
      </button>
    </div>
  );
}
