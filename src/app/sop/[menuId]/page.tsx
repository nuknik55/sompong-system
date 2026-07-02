import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getSopByMenuId, getMenuOption } from "@/lib/sop-data";
import { SopPlayer } from "@/components/sop-player";
import { Pencil } from "lucide-react";

export default async function SopViewPage({
  params,
}: {
  params: Promise<{ menuId: string }>;
}) {
  const { menuId } = await params;
  const [profile, sop, menu] = await Promise.all([
    getCurrentProfile(),
    getSopByMenuId(menuId),
    getMenuOption(menuId),
  ]);

  const isAdmin = profile?.role === "admin";
  const canEdit = profile?.role === "admin" || profile?.role === "editor";

  if (!sop) {
    if (isAdmin) {
      redirect(`/sop/${menuId}/edit`);
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-neutral-500">เมนู &ldquo;{menu?.name ?? menuId}&rdquo; ยังไม่มี SOP</p>
        <Link href="/sop" className="text-sm text-brand-green underline">
          กลับหน้ารายการ
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      {canEdit && (
        <div className="no-print absolute right-4 top-3 z-30">
          <Link
            href={`/sop/${menuId}/edit`}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600 shadow-sm hover:bg-neutral-100"
          >
            <Pencil className="h-3 w-3" />
            แก้ไข
          </Link>
        </div>
      )}
      <SopPlayer sop={sop} />
    </div>
  );
}
