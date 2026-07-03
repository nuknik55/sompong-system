import { redirect } from "next/navigation";
import { requireAdminOrEditor } from "@/lib/auth";
import { getStations } from "@/lib/inventory-data";

export default async function StationsPage() {
  await requireAdminOrEditor();
  const stations = await getStations();
  if (stations.length > 0) redirect(`/owner/stations/${stations[0].id}/template`);

  return (
    <div className="mx-auto max-w-2xl p-8 text-center text-sm text-neutral-400">
      ยังไม่มีสถานี — กรุณาเพิ่มสถานีใน Supabase ก่อน
    </div>
  );
}
