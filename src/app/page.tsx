import { redirect } from "next/navigation";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";

export default async function HomePage() {
  const profile = await requireProfile();
  // owner/admin land on cost dashboard; editor and staff land on recipe list
  redirect(isAdminOrAbove(profile.role) ? "/owner" : "/staff");
}
