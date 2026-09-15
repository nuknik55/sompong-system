"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ── OWNER-ONLY, AND DELIBERATELY NOT requireAdmin() ─────────────────────────
//
// Every other management screen in this app is admin-or-above. This one is
// not, by Nik's decision of 2026-09-14: admins are named on prep recipes like
// everyone else and cannot name themselves. Do not "fix" these guards to match
// the other screens — requireAdmin() here would let เฮง, อู๋ and the admin
// account grant themselves every secret recipe in the restaurant.
//
// The database says the same thing independently: prep_recipe_access_write is
// USING public.is_owner(), so a non-owner session is refused by RLS even if
// these guards were wrong. Two layers, on purpose.
//
// Item 12: expected failures are RETURNED, not thrown — production redacts
// thrown Server Action messages, so the Thai text would never reach the owner.
export type PrepAccessResult = { status: "ok" } | { status: "error"; message: string };

export async function grantPrepAccess(prepRecipeId: string, profileId: string): Promise<PrepAccessResult> {
  const owner = await requireOwner();
  const supabase = await createClient();

  // ignoreDuplicates: granting twice is a no-op rather than an error. The
  // screen can fire a second time from a double tap, and the honest result of
  // "make sure this person can see this recipe" is success either way.
  const { error } = await supabase
    .from("prep_recipe_access")
    .upsert(
      { prep_recipe_id: prepRecipeId, profile_id: profileId, granted_by: owner.id },
      { onConflict: "prep_recipe_id,profile_id", ignoreDuplicates: true },
    );
  if (error) return { status: "error", message: error.message };

  // The prep screens read this on every render, and a grant changes what half
  // the app shows this person — revalidate broadly rather than one path.
  revalidatePath("/owner", "layout");
  revalidatePath("/staff", "layout");
  return { status: "ok" };
}

export async function revokePrepAccess(prepRecipeId: string, profileId: string): Promise<PrepAccessResult> {
  await requireOwner();
  const supabase = await createClient();

  const { error } = await supabase
    .from("prep_recipe_access")
    .delete()
    .eq("prep_recipe_id", prepRecipeId)
    .eq("profile_id", profileId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/owner", "layout");
  revalidatePath("/staff", "layout");
  return { status: "ok" };
}
