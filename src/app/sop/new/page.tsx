import { requireAdminOrEditor } from "@/lib/auth";
import { getAllMenuOptions } from "@/lib/sop-data";
import { MenuPickerClient } from "@/app/sop/new/MenuPickerClient";

export default async function SopNewPage() {
  await requireAdminOrEditor();
  const menus = await getAllMenuOptions();
  return (
    <div className="px-4 py-6">
      <MenuPickerClient menus={menus} />
    </div>
  );
}
