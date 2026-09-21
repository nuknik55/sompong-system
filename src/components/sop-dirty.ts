/**
 * "Has this SOP been changed since it was last clean?" — for the SOP form,
 * used daily by the head chef and the prep head (Nik, 2026-09-21).
 *
 * WHAT WAS WRONG BEFORE. Every onChange called markDirty(), which set a flag
 * that only a save cleared. So a note typed and deleted again, a step added
 * and removed, a word typed and backspaced — all read as unsaved for the
 * rest of the visit. The flag never compared anything.
 *
 * WHAT IT IS NOW: a comparison of exactly what upsertSop would write against
 * what was last clean. It mirrors that function field by field:
 *   - author_name is written as-is, blank as NULL — so "" is compared as "";
 *   - demo_video_url is TRIMMED before it is written, so a trailing space
 *     is not a change;
 *   - ingredient notes are trimmed, and a blank one is not written at all —
 *     so a note typed and cleared is the same as no note;
 *   - steps and checklist lines whose text is blank are dropped by the save
 *     (`.filter((s) => s.text.trim())`), so an empty step added and left is
 *     not a change. Their text is written untrimmed, so it is compared
 *     untrimmed.
 *   - a step's client tempId is not part of it: it is regenerated from
 *     Date.now and Math.random, and a comparison that included it could
 *     never equal itself across two derivations.
 *
 * One consequence worth knowing, which is the SAVE's, not this file's: a
 * blank step that carries a photo is dropped whole on save, photo included.
 * The comparison mirrors that faithfully, so adding a photo to an empty step
 * does not count as a change — because saving would not keep it either.
 */

export type SopStep = { text: string; photoUrl: string | null };

export type SopState = {
  authorName: string;
  updatedAt: string;
  demoVideoUrl: string;
  ingredientNotes: Record<string, string>;
  prepSteps: SopStep[];
  cookSteps: SopStep[];
  platingSteps: SopStep[];
  checklist: { text: string }[];
};

const kept = (xs: SopStep[]) => xs.filter((x) => x.text.trim()).map((x) => [x.text, x.photoUrl ?? null]);

/** A stable string for what upsertSop would write. */
export function sopSnapshot(s: SopState): string {
  const notes = Object.keys(s.ingredientNotes)
    .map((k) => [k, (s.ingredientNotes[k] ?? "").trim()] as const)
    .filter(([, note]) => note !== "")
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return JSON.stringify({
    a: s.authorName,
    u: s.updatedAt,
    v: s.demoVideoUrl.trim(),
    n: notes,
    p: kept(s.prepSteps),
    c: kept(s.cookSteps),
    l: kept(s.platingSteps),
    k: s.checklist.filter((x) => x.text.trim()).map((x) => x.text),
  });
}
