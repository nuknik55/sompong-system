"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, StickyNote } from "lucide-react";
import { upsertSop } from "@/app/sop/actions";
import { SopStepList, SopChecklistEditor } from "@/components/sop-step-list";
import type { StepItem, ChecklistItem } from "@/components/sop-step-list";
import type { MenuIngredientForSop, SopFullData } from "@/lib/sop-data";

function tempId() {
  return `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toStepItems(steps: SopFullData["prepSteps"]): StepItem[] {
  return steps.map((s) => ({ tempId: tempId(), text: s.text, photoUrl: s.photoUrl }));
}

function toChecklistItems(steps: SopFullData["checklist"]): ChecklistItem[] {
  return steps.map((s) => ({ tempId: tempId(), text: s.text }));
}

function isValidVideoUrl(url: string): boolean {
  if (!url.trim()) return true;
  try { new URL(url); return true; } catch { return false; }
}

const SECTION_LABEL: Record<"prep" | "cook" | "plating", string> = {
  prep: "เตรียมวัตถุดิบ",
  cook: "ปรุง",
  plating: "จัดจาน",
};

export function SopForm({
  menuId,
  menuName,
  menuCategory,
  ingredients,
  existing,
  submitMode = "save",
}: {
  menuId: string;
  menuName: string;
  menuCategory: string | null;
  ingredients: MenuIngredientForSop[];
  existing: SopFullData | null;
  submitMode?: "save" | "pending";
}) {
  const router = useRouter();
  const isDirty = useRef(false); // for beforeunload (no re-render needed)
  const [hasUnsaved, setHasUnsaved] = useState(false); // for visual indicator
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savePending, setSavePending] = useState(false);

  // ── Form state ──────────────────────────────────────────────────
  const [authorName, setAuthorName] = useState(existing?.authorName ?? "");
  const [updatedAt, setUpdatedAt] = useState(
    existing?.updatedAt ?? new Date().toISOString().slice(0, 10)
  );
  const [demoVideoUrl, setDemoVideoUrl] = useState(existing?.demoVideoUrl ?? "");
  const [ingredientNotes, setIngredientNotes] = useState<Record<string, string>>(
    () => {
      const map: Record<string, string> = {};
      for (const ing of ingredients) if (ing.note) map[ing.ingredientId] = ing.note;
      return map;
    }
  );
  const [prepSteps, setPrepSteps] = useState<StepItem[]>(() =>
    existing ? toStepItems(existing.prepSteps) : []
  );
  const [cookSteps, setCookSteps] = useState<StepItem[]>(() =>
    existing ? toStepItems(existing.cookSteps) : []
  );
  const [platingSteps, setPlatingSteps] = useState<StepItem[]>(() =>
    existing ? toStepItems(existing.platingSteps) : []
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    existing ? toChecklistItems(existing.checklist) : []
  );

  function markDirty() {
    isDirty.current = true;
    setHasUnsaved(true);
    setSaveSuccess(false);
    setSavePending(false);
  }

  // Warn on accidental page close / refresh while unsaved
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function handleSave() {
    if (!isValidVideoUrl(demoVideoUrl)) {
      setError("URL วิดีโอไม่ถูกต้อง — ต้องขึ้นต้นด้วย https://");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await upsertSop({
          menuId,
          authorName,
          updatedAt,
          demoVideoUrl,
          ingredientNotes,
          prepSteps: prepSteps.map((s) => ({ text: s.text, photoUrl: s.photoUrl })),
          cookSteps: cookSteps.map((s) => ({ text: s.text, photoUrl: s.photoUrl })),
          platingSteps: platingSteps.map((s) => ({ text: s.text, photoUrl: s.photoUrl })),
          checklist: checklist.map((s) => ({ text: s.text, photoUrl: null })),
        }, menuName);
        isDirty.current = false;
        setHasUnsaved(false);
        if (result.status === "pending") {
          setSavePending(true);
        } else {
          setSaveSuccess(true);
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  const videoUrlInvalid = demoVideoUrl.trim() && !isValidVideoUrl(demoVideoUrl);

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-24">
      {/* ── Header + inline save ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-kanit text-xl font-semibold text-neutral-900">{menuName}</h1>
            {menuCategory && (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                {menuCategory}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-neutral-500">
            {existing ? "แก้ไข SOP" : "สร้าง SOP ใหม่"}
          </p>
          {hasUnsaved && !saveSuccess && (
            <p className="mt-1 text-xs text-amber-600">● มีการเปลี่ยนแปลงที่ยังไม่บันทึก</p>
          )}
          {saveSuccess && <p className="mt-1 text-xs text-green-600">✓ บันทึกสำเร็จ</p>}
          {savePending && <p className="mt-1 text-xs text-amber-600">⏳ ส่งขออนุมัติแล้ว</p>}
        </div>
        {/* Save button at top — always visible on desktop */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push(`/sop/${menuId}`)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
          >
            ดู SOP
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isPending ? "กำลังบันทึก..." : submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก SOP"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* ── Ingredients (read-only names + notes) ── */}
      <section>
        <h2 className="mb-3 font-kanit font-medium text-brand-green">วัตถุดิบ</h2>
        {ingredients.length === 0 ? (
          <p className="text-sm text-neutral-400">เมนูนี้ยังไม่มีสูตรวัตถุดิบในระบบ</p>
        ) : (
          <div className="space-y-2">
            {ingredients.map((ing) => (
              <div
                key={ing.ingredientId}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{ing.name}</span>
                  <span className="ml-2 text-sm text-neutral-500 tabular-nums">
                    {ing.quantity} {ing.unit ?? ""}
                  </span>
                </div>
                <div className="relative shrink-0">
                  <StickyNote className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-300" />
                  <input
                    type="text"
                    value={ingredientNotes[ing.ingredientId] ?? ""}
                    onChange={(e) => {
                      markDirty();
                      setIngredientNotes((prev) => ({
                        ...prev,
                        [ing.ingredientId]: e.target.value,
                      }));
                    }}
                    placeholder="หมายเหตุ..."
                    className="w-40 rounded-md border border-neutral-200 py-1 pl-7 pr-2 text-xs placeholder:text-neutral-300"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Prep steps ── */}
      <section>
        <h2 className="mb-3 font-kanit font-medium text-brand-green">ขั้นตอนการเตรียมวัตถุดิบ</h2>
        <SopStepList
          steps={prepSteps}
          sectionLabel={SECTION_LABEL.prep}
          placeholder="เช่น ซอยหมูบาง 3mm แช่น้ำปลาและน้ำตาล 15 นาที..."
          onChange={(s) => { markDirty(); setPrepSteps(s); }}
        />
      </section>

      {/* ── Cook steps ── */}
      <section>
        <h2 className="mb-3 font-kanit font-medium text-brand-green">ขั้นตอนการปรุง</h2>
        <SopStepList
          steps={cookSteps}
          sectionLabel={SECTION_LABEL.cook}
          placeholder="เช่น ตั้งกระทะไฟแรง ใส่น้ำมัน รอควัน..."
          onChange={(s) => { markDirty(); setCookSteps(s); }}
        />
      </section>

      {/* ── Plating steps ── */}
      <section>
        <h2 className="mb-3 font-kanit font-medium text-brand-green">การจัดจาน</h2>
        <SopStepList
          steps={platingSteps}
          sectionLabel={SECTION_LABEL.plating}
          placeholder="เช่น วางเนื้อตรงกลางจาน โรยผักชีด้านบน..."
          onChange={(s) => { markDirty(); setPlatingSteps(s); }}
        />
      </section>

      {/* ── Quality checklist ── */}
      <section>
        <h2 className="mb-3 font-kanit font-medium text-brand-green">จุดตรวจสอบมาตรฐาน</h2>
        <SopChecklistEditor
          items={checklist}
          onChange={(items) => { markDirty(); setChecklist(items); }}
        />
      </section>

      {/* ── Video URL ── */}
      <section>
        <h2 className="mb-2 font-kanit font-medium text-brand-green">วิดีโอสาธิต</h2>
        <input
          type="url"
          value={demoVideoUrl}
          onChange={(e) => { markDirty(); setDemoVideoUrl(e.target.value); }}
          placeholder="https://youtube.com/... หรือ https://drive.google.com/..."
          className={`w-full rounded-md border px-3 py-2 text-sm ${
            videoUrlInvalid ? "border-red-400" : "border-neutral-300"
          }`}
        />
        {videoUrlInvalid && (
          <p className="mt-1 text-xs text-red-500">URL ไม่ถูกต้อง — ต้องขึ้นต้นด้วย https://</p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          รองรับทุก URL วิดีโอ เช่น YouTube, Google Drive, TikTok, Facebook
        </p>
      </section>

      {/* ── Author + Date ── */}
      <section className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">ผู้จัดทำ</label>
          <input
            type="text"
            value={authorName}
            onChange={(e) => { markDirty(); setAuthorName(e.target.value); }}
            placeholder="ชื่อผู้จัดทำ..."
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">
            วันที่ปรับปรุงล่าสุด
          </label>
          <input
            type="date"
            value={updatedAt}
            onChange={(e) => { markDirty(); setUpdatedAt(e.target.value); }}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      {/* ── Fixed save bar (visible on mobile scroll / bottom of long page) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-lg no-print">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="text-sm">
            {error && <span className="text-red-600">{error}</span>}
            {saveSuccess && <span className="text-green-600">✓ บันทึกสำเร็จ</span>}
            {savePending && <span className="text-amber-600">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</span>}
            {!error && !saveSuccess && !savePending && hasUnsaved && (
              <span className="text-xs text-neutral-400">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
            )}
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isPending ? "กำลังบันทึก..." : submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก SOP"}
          </button>
        </div>
      </div>
    </div>
  );
}
