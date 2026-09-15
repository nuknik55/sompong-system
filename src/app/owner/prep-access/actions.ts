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

// ── Whole-person grants ─────────────────────────────────────────────────────
//
// Both people granted so far needed a SQL script, because the screen could
// only grant one recipe at a time and "all 48" is the common case for a
// section head. A third person would have meant a third script, and a screen
// that sends the owner back to SQL is a screen he stops opening.
//
// ONE statement each, the way those scripts did it — not 48 round trips from
// the client, which would be slow, would half-finish on a dropped connection,
// and would fire 48 revalidations.

export async function grantAllPreps(profileId: string): Promise<PrepAccessResult> {
  const owner = await requireOwner();
  // An empty id here would build a row set against nobody; refuse rather than
  // write something meaningless.
  if (!profileId) return { status: "error", message: "ไม่พบผู้ใช้" };
  const supabase = await createClient();

  const { data: recipes, error: readError } = await supabase.from("prep_recipes").select("id");
  if (readError) return { status: "error", message: readError.message };
  const rows = (recipes ?? []).map((r) => ({
    prep_recipe_id: r.id as string,
    profile_id: profileId,
    granted_by: owner.id,
  }));
  if (rows.length === 0) return { status: "ok" };

  // ignoreDuplicates mirrors the ON CONFLICT DO NOTHING in the grant scripts:
  // re-granting is a no-op, and a person who already holds some recipes keeps
  // the granted_at on those rather than having it reset.
  const { error } = await supabase
    .from("prep_recipe_access")
    .upsert(rows, { onConflict: "prep_recipe_id,profile_id", ignoreDuplicates: true });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/owner", "layout");
  revalidatePath("/staff", "layout");
  return { status: "ok" };
}

export async function revokeAllPreps(profileId: string): Promise<PrepAccessResult> {
  await requireOwner();
  // This one deletes by profile_id alone. Without this guard a falsy id would
  // send a delete with no usable filter — the one call on this screen whose
  // worst case is everybody's access at once.
  if (!profileId) return { status: "error", message: "ไม่พบผู้ใช้" };
  const supabase = await createClient();

  const { error } = await supabase.from("prep_recipe_access").delete().eq("profile_id", profileId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/owner", "layout");
  revalidatePath("/staff", "layout");
  return { status: "ok" };
}
