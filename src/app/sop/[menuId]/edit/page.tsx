import { notFound } from "next/navigation";
import { requireAdminOrEditor } from "@/lib/auth";
import { getSopByMenuId, getMenuOption, getMenuIngredientsForSop } from "@/lib/sop-data";
import { SopForm } from "@/components/sop-form";
import { PageShell } from "@/components/ui/page";

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
    // The page header (← รายการ SOP, the menu, ดู SOP and the save) is in
    // SopForm: its save state lives there.
    <PageShell>
      <SopForm
        menuId={menuId}
        menuName={menu.name}
        menuCategory={menu.category}
        ingredients={ingredients}
        existing={existing}
        submitMode={profile.role === "owner" || profile.role === "admin" ? "save" : "pending"}
      />
    </PageShell>
  );
}
