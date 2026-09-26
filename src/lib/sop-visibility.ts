/**
 * PER-SOP "WHO CAN SEE" (Nik, 2026-09-26). An SOP is open to everyone
 * (ทุกคน, the default) or to chosen accounts only (เฉพาะคนที่เลือก). Owner and
 * admin see every SOP; a login with no profile sees none.
 *
 * The database is the rule: public.can_see_sop() behind restrictive policies
 * on the SOP, its steps and its notes, and the one save of the setting,
 * public.sop_set_visibility() (sop_visibility_and_editor_cost_switch_migration.sql).
 * This mirror serves the one place the database cannot decide: approving an
 * editor's SOP request. The approver sees every SOP, so the approver's
 * session would carry out a request from someone who may not see it.
 *
 * Pure, so every case is a test (sop-visibility.test.ts).
 */
export type SopVisibility = "all" | "chosen";

export const SOP_VISIBILITY_LABEL: Record<SopVisibility, string> = {
  all: "ทุกคน",
  chosen: "เฉพาะคนที่เลือก",
};

export function sopVisibleTo(
  sop: { visibility: string; viewerIds: readonly string[] },
  who: { id: string; role: string | null | undefined },
): boolean {
  if (!who.role) return false;
  if (who.role === "owner" || who.role === "admin") return true;
  if (sop.visibility === "all") return true;
  // Anything else, an unknown value included, is "chosen": fails closed.
  return sop.visibility === "chosen" && sop.viewerIds.includes(who.id);
}

export const SOP_REQUEST_REFUSAL =
  "อนุมัติไม่ได้ — ผู้ส่งคำขอนี้ไม่ได้อยู่ในรายชื่อที่เห็น SOP นี้ (ตั้งให้เห็นเฉพาะคนที่เลือก) ให้ปฏิเสธคำขอ หรือเพิ่มชื่อเขาในการตั้งค่า “ใครเห็น SOP นี้” ก่อน";

/** The menu an SOP request is about: the SAME id is checked and written. */
export function sopRequestMenuId(changeType: string, payload: Record<string, unknown>): string | null {
  if (changeType === "sop_upsert") {
    const data = payload.sopData as { menuId?: unknown } | null | undefined;
    return typeof data?.menuId === "string" && data.menuId !== "" ? data.menuId : null;
  }
  if (changeType === "sop_delete") {
    return typeof payload.menuId === "string" && payload.menuId !== "" ? payload.menuId : null;
  }
  return null;
}
