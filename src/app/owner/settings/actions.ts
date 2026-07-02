"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function updateQFactor(qFactorPct: number) {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ q_factor_pct: qFactorPct }).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/owner");
}
