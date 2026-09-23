import { requireAdminOrEditor } from "@/lib/auth";
import { getAllMenuOptions } from "@/lib/sop-data";
import { MenuPickerClient } from "@/app/sop/new/MenuPickerClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function SopNewPage() {
  await requireAdminOrEditor();
  const menus = await getAllMenuOptions();
  return (
    <PageShell>
      <PageHeader back={{ href: "/sop", label: "รายการ SOP" }} title="สร้าง SOP ใหม่" />
      <MenuPickerClient menus={menus} />
    </PageShell>
  );
}
