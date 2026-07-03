import { redirect } from "next/navigation";
import { requireAdminOrEditor } from "@/lib/auth";
import { getStations } from "@/lib/inventory-data";

export default async function InventoryTemplateIndexPage() {
  await requireAdminOrEditor();
  const stations = await getStations();
  if (stations.length === 0) redirect("/staff/inventory");
  redirect(`/staff/inventory/template/${stations[0].id}`);
}
