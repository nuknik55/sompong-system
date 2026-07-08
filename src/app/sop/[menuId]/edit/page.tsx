import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrEditor } from "@/lib/auth";
import { getSopByMenuId, getMenuOption, getMenuIngredientsForSop } from "@/lib/sop-data";
import { SopForm } from "@/components/sop-form";
import { ChevronLeft } from "lucide-react";

export default async function SopEditPage({
  params,
}: {
  params: Promise<{ menuId: string }>;
}) {
  const profile = await requireAdminOrEditor();
  const { menuId } = await params;

  const menu = await getMenuOption(menuId);
  if (!menu) notFound();

  const existing = await getSopByMenuId(menuId);
  const ingredients = await getMenuIngredientsForSop(menuId, existing?.sopId);

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/sop"
          className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800"
        >
          <ChevronLeft className="h-4 w-4" />
          รายการ SOP
        </Link>
      </div>
      <SopForm
        menuId={menuId}
        menuName={menu.name}
        menuCategory={menu.category}
        ingredients={ingredients}
        existing={existing}
        submitMode={profile.role === "owner" || profile.role === "admin" ? "save" : "pending"}
      />
    </div>
  );
}
