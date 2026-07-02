import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

export default async function HomePage() {
  const profile = await requireProfile();
  // admin and editor land on owner dashboard; staff lands on recipe list
  redirect(profile.role === "staff" ? "/staff" : "/owner");
}
