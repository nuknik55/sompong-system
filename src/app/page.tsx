import { redirect } from "next/navigation";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";

export default async function HomePage() {
  const profile = await requireProfile();
  if (profile.role === "hr") redirect("/owner/hr");
  redirect(isAdminOrAbove(profile.role) ? "/owner" : "/staff");
}
