import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "editor" | "staff" | "accounting";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
};

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

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

/** Admin/owner or editor. Redirects staff and accounting to /staff. */
export async function requireAdminOrEditor(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role === "staff" || profile.role === "accounting") redirect("/staff");
  return profile;
}

export function isAdminOrAbove(role: Role): boolean {
  return role === "admin" || role === "owner";
}
