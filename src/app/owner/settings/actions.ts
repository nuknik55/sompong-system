"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Item 12: returned, not thrown — production redacts thrown messages.
export async function updateQFactor(qFactorPct: number): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ q_factor_pct: qFactorPct }).eq("id", 1);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/owner");
  return { status: "ok" };
}
