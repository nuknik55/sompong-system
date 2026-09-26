import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canOrder } from "@/lib/order-rules";
import { isMissingRelation } from "@/lib/schema-fallback";

export type Role ="owner" | "admin" | "editor" | "staff" | "hr" | "sales";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  /** Optional link to the HR employee record — null for logins with no
   *  payroll record (owner/admin accounts, system users). */
  employee_id: string | null;
  /** The เห็นต้นทุน switch: true for owner and admin, for an editor whose
   *  switch is on, false for everyone else. Read seesCost() (lib/cost-access),
   *  never this field alone. */
  sees_cost: boolean;
};

// ONE lookup per request (React cache): every guard calls this, and a page
// that runs a dozen guarded reads at once (the HR employee page, since each
// read action guards itself, 2026-09-25) would otherwise ask the auth server
// and the profiles table a dozen times. Outside a render (a server action) it
// simply runs each time.
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // maybeSingle, and the error is checked. Two outcomes that used to look
  // identical must not:
  //   - no row for this user  -> null, and requireProfile sends them to /login.
  //     Legitimate: some auth users have no profile row.
  //   - the query FAILED      -> throw. Previously the error was discarded, so
  //     a broken profiles read (RLS change, outage, typo in a column) returned
  //     null and presented to the user as a silent logout, on every guarded
  //     page in the app. Failing loudly is the only way that is diagnosable.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, employee_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`อ่านข้อมูลผู้ใช้ไม่สำเร็จ: ${error.message}`);
  if (!profile) return null;

  return { ...profile, sees_cost: await readCostSwitch(supabase, profile.role, profile.id) } as Profile;
});

/**
 * The เห็นต้นทุน switch (Nik, 2026-09-26). Owner and admin always see cost;
 * an editor when the owner has switched it on (a row in profile_cost_access,
 * which an editor may read for itself only); nobody else. Before
 * sop_visibility_and_editor_cost_switch_migration.sql makes the table, every
 * editor sees cost, as they always had. Fails loudly on any other error, as
 * the profile read above does.
 */
async function readCostSwitch(supabase: Awaited<ReturnType<typeof createClient>>, role: string, id: string): Promise<boolean> {
  if (role === "owner" || role === "admin") return true;
  if (role !== "editor") return false;
  const { data, error } = await supabase.from("profile_cost_access").select("profile_id").eq("profile_id", id).maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return true;
    throw new Error(`อ่านสิทธิ์ดูต้นทุนไม่สำเร็จ: ${error.message}`);
  }
  return data !== null;
}

/**
 * Another account's profile as the app sees it, its เห็นต้นทุน switch
 * included, read with the caller's own session (owner and admin read every
 * profile and every switch). Null when it cannot be read: a caller deciding
 * by it must treat that as "no".
 */
export async function readProfileById(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, role, employee_id").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return { ...data, sees_cost: await readCostSwitch(supabase, data.role as string, data.id as string) } as Profile;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Owner-only: the restaurant proprietor. Redirects everyone else to /owner. */
export async function requireOwner(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/owner");
  return profile;
}

/** Admin or owner (owner is a superset of admin). Redirects every other role (editor, staff, hr, sales) to /staff. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "owner") redirect("/staff");
  return profile;
}

/**
 * Admin/owner or editor. Redirects everyone else to /staff.
 * Positive allowlist on purpose: a negative check (block staff/hr) silently
 * admits every role added later.
 */
export async function requireAdminOrEditor(): Promise<Profile> {
  const profile = await requireProfile();
  if (!["owner", "admin", "editor"].includes(profile.role)) redirect("/staff");
  return profile;
}

/** HR full access: owner or hr only (salary-sensitive pages). */
export async function requireHR(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "owner" && profile.role !== "hr") redirect("/owner");
  return profile;
}

/** Leave/attendance access: owner, hr, or admin (no salary data). */
export async function requireHROrAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!["owner", "hr", "admin"].includes(profile.role)) redirect("/staff");
  return profile;
}

/** Catering access: owner, admin, or sales. Redirects everyone else to /staff. */
export async function requireSales(): Promise<Profile> {
  const profile = await requireProfile();
  if (!["owner", "admin", "sales"].includes(profile.role)) redirect("/staff");
  return profile;
}

export function isAdminOrAbove(role: Role): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Supply ordering (README item 35, decision 9): owner, admin, editor and
 * staff. hr and sales are sent home; the database's can_order() refuses
 * them as well, so the menu is not the only thing keeping them out.
 */
export async function requireOrdering(): Promise<Profile> {
  const profile = await requireProfile();
  if (!canOrder(profile.role)) redirect("/");
  return profile;
}
