/**
 * The SOP form's rules that do not need a screen (Nik, 2026-09-26), shared by
 * the form (sop-form.tsx) and the save (upsertSop), and tested.
 */

export type SopStepInput = { text: string; photoUrl: string | null };
export type SopStepsInput = {
  prepSteps: SopStepInput[];
  cookSteps: SopStepInput[];
  platingSteps: SopStepInput[];
};

/** The sections as the form heads them. */
export const SOP_SECTION_NAME = { prepSteps: "ขั้นตอนการเตรียมวัตถุดิบ", cookSteps: "ขั้นตอนการปรุง", platingSteps: "การจัดจาน" } as const;

/**
 * Queue item 43: a step with a photo and no words. The save keeps only steps
 * with words, so such a step used to vanish with its photo, silently. Now the
 * save is refused and the step named, as the person counts it on screen (the
 * n-th box of that section, blank ones included). Null when there is none.
 */
export function photoOnlyStepProblem(data: SopStepsInput): string | null {
  for (const key of ["prepSteps", "cookSteps", "platingSteps"] as const) {
    const i = data[key].findIndex((s) => s.photoUrl && !s.text.trim());
    if (i >= 0) {
      return `${SOP_SECTION_NAME[key]} ขั้นที่ ${i + 1} มีรูปแต่ยังไม่มีคำอธิบาย — ใส่คำอธิบาย หรือลบรูป แล้วบันทึกอีกครั้ง`;
    }
  }
  return null;
}

/**
 * Queue item 42: a photo lands on ITS step, by id, in the list as it is when
 * the upload finishes — never on the list as it was when the file was picked.
 * A step typed, moved or removed meanwhile stays as it is now; a step removed
 * meanwhile does not come back.
 */
export function withStepPhoto<T extends { tempId: string; photoUrl: string | null }>(steps: T[], tempId: string, photoUrl: string | null): T[] {
  return steps.map((s) => (s.tempId === tempId ? { ...s, photoUrl } : s));
}

/**
 * Queue item 44: the batch yield a prep makes, as typed. A number above 0, or
 * null — never the 0 a blank, "." or "1.2.3" used to become (every dish using
 * the prep then showed a missing cost).
 */
export function parseBatchYield(typed: string): number | null {
  const t = typed.trim();
  if (!/^[0-9]+([.][0-9]+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const BATCH_YIELD_REFUSAL = "ใส่จำนวนที่ทำได้ต่อรอบเป็นตัวเลขมากกว่า 0";
