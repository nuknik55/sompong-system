"use server";

import { revalidatePath } from "next/cache";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { manualLinesProblem, parseManualLines, storedManualLines } from "@/lib/menu-card";
import { assertCostNotLocked } from "../../cost-lock";
import { logCateringActivity } from "../../activity-log";

export type SaveMenuCardResult = { error?: string; saved?: string };

/**
 * Saves the menu card's hand-typed lines with the booking
 * (catering_events.menu_card_lines), so a reprint keeps them.
 *
 * The same rules as the booking's other non-price fields (saveBooking):
 * owner, admin and sales (requireSales; the database's catering_events_rw
 * admits the same three), and NOTHING on a cost-locked booking, for anyone —
 * the app's lock rule, stricter than the database, which still lets owner and
 * admin write a locked row (catering_events_lock_update); owner and admin
 * unlock on the cost page first. On top of that, the card itself: not for a
 * cancelled booking. One history line after the write, as every booking
 * write logs. Imports nothing that computes cost (menu-card/cost-isolation.test.ts).
 */
export async function saveMenuCardLines(eventId: string, text: string): Promise<SaveMenuCardResult> {
  const profile = await requireSales();
  if (typeof eventId !== "string" || typeof text !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const problem = manualLinesProblem(text);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data: event, error: readError } = await supabase
    .from("catering_events")
    .select("status")
    .eq("id", eventId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!event) return { error: "ไม่พบข้อมูลงาน" };
  if (event.status === "cancelled") return { error: "งานนี้ถูกยกเลิกแล้ว จึงไม่มีการ์ดเมนู" };
  try {
    await assertCostNotLocked(supabase, eventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "ต้นทุนของงานนี้ถูกล็อกแล้ว" };
  }

  const stored = storedManualLines(text);
  // Counted: a write the table's policy refuses updates 0 rows and no error.
  const { error, count } = await supabase
    .from("catering_events")
    .update({ menu_card_lines: stored }, { count: "exact" })
    .eq("id", eventId);
  if (error) return { error: error.message };
  if (count !== 1) return { error: "ไม่ได้บันทึก — ฐานข้อมูลไม่อนุญาต" };

  const n = parseManualLines(stored).length;
  await logCateringActivity(
    supabase,
    eventId,
    profile.id,
    "menu_card_edited",
    n > 0 ? `แก้รายการที่พิมพ์เพิ่มบนการ์ดเมนู (${n} บรรทัด)` : "ลบรายการที่พิมพ์เพิ่มบนการ์ดเมนูทั้งหมด",
  );
  revalidatePath(`/owner/catering/${eventId}/menu-card`);
  revalidatePath(`/owner/catering/${eventId}`);
  return { saved: stored ?? "" };
}
