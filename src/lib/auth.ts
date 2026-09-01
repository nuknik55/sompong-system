import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "editor" | "staff" | "hr" | "sales";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  /** Optional link to the HR employee record — null for logins with no
   *  payroll record (owner/admin accounts, system users). */
  employee_id: string | null;
};

export async function getCurrentProfile(): Promise<Profile | null> {
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

  return profile ?? null;
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

/** Admin or owner (owner is a superset of admin). Redirects editor/staff to /staff. */
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
