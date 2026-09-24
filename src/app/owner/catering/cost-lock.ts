import "server-only";
import type { createClient } from "@/lib/supabase/server";

// Moved out of actions.ts on 2026-09-24, verbatim, so the menu card's save
// applies the SAME lock rule without importing actions.ts. Every save in
// actions.ts still calls it before writing (save-booking-lock.test.ts).

/**
 * Throws if the event's cost has been locked (see lockCateringEventCost in
 * [id]/cost/actions.ts) — called before any write that would change what a
 * locked P&L was computed from (menu quantities, charges, labor entries).
 * The UI already disables the controls that reach these functions, but that
 * alone isn't a "permanently frozen" guarantee — this is the server-side
 * backstop. cost_locked_at is sales-readable (see its comment on
 * CateringEvent in the type above), so this check works under either role's
 * RLS without needing admin access to catering_event_cost_snapshots.
 */
export async function assertCostNotLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("catering_events")
    .select("cost_locked_at")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  // maybeSingle() returns { data: null, error: null } for zero matching
  // rows — distinguish that from "found, but unlocked" explicitly, so a
  // bad/stale eventId fails with a clear message instead of silently
  // passing the guard and only failing later (or not at all, for a delete
  // matching zero rows) inside the caller's own write.
  if (!data) throw new Error("ไม่พบข้อมูลงาน");
  if (data.cost_locked_at) {
    throw new Error("ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ไขได้");
  }
}

