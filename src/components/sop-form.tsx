"use client";

import { useState, useTransition } from "react";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { sopSnapshot } from "@/components/sop-dirty";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, StickyNote } from "lucide-react";
import { upsertSop } from "@/app/sop/actions";
import { bangkokToday } from "@/lib/bangkok-date";
import { SopStepList, SopChecklistEditor } from "@/components/sop-step-list";
import type { StepItem, ChecklistItem } from "@/components/sop-step-list";
import type { MenuIngredientForSop, SopFullData } from "@/lib/sop-data";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";

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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savePending, setSavePending] = useState(false);

  // ── Form state ──────────────────────────────────────────────────
  const [authorName, setAuthorName] = useState(existing?.authorName ?? "");
  const [updatedAt, setUpdatedAt] = useState(
    existing?.updatedAt ?? bangkokToday()
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

  // Any edit clears the "saved" / "sent for approval" line. Whether the
  // form is unsaved is no longer RECORDED here — it is computed below.
  function onEdit() {
    setSaveSuccess(false);
    setSavePending(false);
  }

  // UNSAVED IS A COMPARISON, NOT A FLAG (Nik, 2026-09-21). Every onChange
  // used to set a flag that only a save cleared, so a note typed and
  // deleted, or a step added and removed, read as unsaved for the rest of
  // the visit. Now: what upsertSop would write, against what was last clean
  // (see sop-dirty.ts, which mirrors the save field by field).
  //
  // The baseline is captured from the FIRST render's own state rather than
  // re-derived, because two derivations of this form are not equal: every
  // step gets a fresh tempId from Date.now and Math.random, and a new SOP's
  // date comes from the clock. Capturing what the form actually opened with
  // makes the two equal by construction.
  const current = sopSnapshot({ authorName, updatedAt, demoVideoUrl, ingredientNotes, prepSteps, cookSteps, platingSteps, checklist });
  const [cleanAt, setCleanAt] = useState<string | null>(null);
  if (cleanAt === null) setCleanAt(current);
  const dirty = cleanAt !== null && current !== cleanAt;

  // Asks before leaving by the browser, by any in-app link, and by
  // ออกจากระบบ. It had beforeunload only: every in-app link left silently.
  useLeaveGuard(dirty);

  function handleSave() {
    if (!isValidVideoUrl(demoVideoUrl)) {
      setError("URL วิดีโอไม่ถูกต้อง — ต้องขึ้นต้นด้วย https://");
      return;
    }
    setError(null);
    // What this save sends. Captured now, so anything typed while it is in
    // flight stays unsaved after it lands.
    const saving = current;
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
        // Error BEFORE the dirty flags: a failed save must leave the form
        // dirty, or navigating away would silently discard the edits the
        // save just failed to persist.
        if (result.status === "error") { setError(result.message); return; }
        setCleanAt(saving);
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
    <div className="space-y-8 pb-24">
      {/* ── Header + inline save (the shared page header) ── */}
      {/* The back link and ดู SOP are LINKS, not buttons calling
          router.push: navigation that is a real anchor is what the leave
          guard can see and ask about. As a button ดู SOP left with the edits
          and asked nothing (review, 2026-09-21). */}
      <PageHeader
        back={{ href: "/sop", label: "รายการ SOP" }}
        title={menuName}
        subtitle={
          <>
            {menuCategory && (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                {menuCategory}
              </span>
            )}
            <span>{existing ? "แก้ไข SOP" : "สร้าง SOP ใหม่"}</span>
            {dirty && (
              <span className="text-xs text-pending-ink">● มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
            )}
            {saveSuccess && <span className="text-xs text-success-ink">✓ บันทึกสำเร็จ</span>}
            {savePending && <span className="text-xs text-pending-ink">⏳ ส่งขออนุมัติแล้ว</span>}
          </>
        }
        actions={
          <>
            <Link href={`/sop/${menuId}`} className={buttonClass("secondary")}>
              ดู SOP
            </Link>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className={buttonClass("primary")}
            >
              <Save className="h-4 w-4" />
              {isPending ? "กำลังบันทึก..." : submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก SOP"}
            </button>
          </>
        }
      />

      {error && <p className="rounded-md bg-danger-soft border border-danger/40 px-3 py-2 text-sm text-danger">{error}</p>}

      {/* ── Ingredients (read-only names + notes) ── */}
      <section>
        <h2 className="mb-3 font-heading font-medium text-brand-green">วัตถุดิบ</h2>
        {ingredients.length === 0 ? (
          <p className="text-sm text-neutral-500">เมนูนี้ยังไม่มีสูตรวัตถุดิบในระบบ</p>
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
                      onEdit();
                      setIngredientNotes((prev) => ({
                        ...prev,
                        [ing.ingredientId]: e.target.value,
                      }));
                    }}
                    placeholder="หมายเหตุ..."
                    className="w-40 rounded-md border border-neutral-200 py-1 pl-7 pr-2 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Prep steps ── */}
      <section>
        <h2 className="mb-3 font-heading font-medium text-brand-green">ขั้นตอนการเตรียมวัตถุดิบ</h2>
        <SopStepList
          steps={prepSteps}
          sectionLabel={SECTION_LABEL.prep}
          placeholder="เช่น ซอยหมูบาง 3mm แช่น้ำปลาและน้ำตาล 15 นาที..."
          onChange={(s) => { onEdit(); setPrepSteps(s); }}
        />
      </section>

      {/* ── Cook steps ── */}
      <section>
        <h2 className="mb-3 font-heading font-medium text-brand-green">ขั้นตอนการปรุง</h2>
        <SopStepList
          steps={cookSteps}
          sectionLabel={SECTION_LABEL.cook}
          placeholder="เช่น ตั้งกระทะไฟแรง ใส่น้ำมัน รอควัน..."
          onChange={(s) => { onEdit(); setCookSteps(s); }}
        />
      </section>

      {/* ── Plating steps ── */}
      <section>
        <h2 className="mb-3 font-heading font-medium text-brand-green">การจัดจาน</h2>
        <SopStepList
          steps={platingSteps}
          sectionLabel={SECTION_LABEL.plating}
          placeholder="เช่น วางเนื้อตรงกลางจาน โรยผักชีด้านบน..."
          onChange={(s) => { onEdit(); setPlatingSteps(s); }}
        />
      </section>

      {/* ── Quality checklist ── */}
      <section>
        <h2 className="mb-3 font-heading font-medium text-brand-green">จุดตรวจสอบมาตรฐาน</h2>
        <SopChecklistEditor
          items={checklist}
          onChange={(items) => { onEdit(); setChecklist(items); }}
        />
      </section>

      {/* ── Video URL ── */}
      <section>
        <h2 className="mb-2 font-heading font-medium text-brand-green">วิดีโอสาธิต</h2>
        <input
          type="url"
          value={demoVideoUrl}
          onChange={(e) => { onEdit(); setDemoVideoUrl(e.target.value); }}
          placeholder="https://youtube.com/... หรือ https://drive.google.com/..."
          className={`w-full rounded-md border px-3 py-2 text-sm ${
            videoUrlInvalid ? "border-danger/40" : "border-neutral-300"
          }`}
        />
        {videoUrlInvalid && (
          <p className="mt-1 text-xs text-danger">URL ไม่ถูกต้อง — ต้องขึ้นต้นด้วย https://</p>
        )}
        <p className="mt-1 text-xs text-neutral-500">
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
            onChange={(e) => { onEdit(); setAuthorName(e.target.value); }}
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
            onChange={(e) => { onEdit(); setUpdatedAt(e.target.value); }}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      {/* ── Fixed save bar (visible on mobile scroll / bottom of long page) ── */}
      {/* lg:left-52: beside the desktop sidebar, not over its footer (the
          user name and ออกจากระบบ). */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-lg no-print lg:left-52">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="text-sm">
            {error && <span className="text-danger">{error}</span>}
            {saveSuccess && <span className="text-success-ink">✓ บันทึกสำเร็จ</span>}
            {savePending && <span className="text-pending-ink">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</span>}
            {!error && !saveSuccess && !savePending && dirty && (
              <span className="text-xs text-neutral-500">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
            )}
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className={buttonClass("primary", { className: "shrink-0" })}
          >
            <Save className="h-4 w-4" />
            {isPending ? "กำลังบันทึก..." : submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก SOP"}
          </button>
        </div>
      </div>
    </div>
  );
}
