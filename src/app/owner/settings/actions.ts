"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The CapEx question's threshold (queue item 9). OWNER ONLY, as Nik asked:
 * an admin sees the figure on /owner and cannot change it.
 *
 * The guard here is the one that holds today. `app_settings_owner_write`
 * calls `is_owner()`, which has admitted admins since migrations/006, so an
 * admin's direct PostgREST update still reaches the table — the same gap the
 * q-factor has (queue item 23, whose held migration closes it for the whole
 * table, this column included).
 */
export async function updateCapexThreshold(threshold: number): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  await requireOwner();
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { status: "error", message: "จำนวนเงินไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ capex_threshold: threshold }).eq("id", 1);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/owner");
  revalidatePath("/owner/accounting/daily");
  return { status: "ok" };
}

// Item 12: returned, not thrown — production redacts thrown messages.
export async function updateQFactor(qFactorPct: number): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ q_factor_pct: qFactorPct }).eq("id", 1);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/owner");
  return { status: "ok" };
}
