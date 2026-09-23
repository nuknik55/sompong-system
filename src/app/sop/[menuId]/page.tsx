import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { editAccess } from "@/lib/edit-access";
import { getSopByMenuId, getMenuOption } from "@/lib/sop-data";
import { SopPlayer } from "@/components/sop-player";
import { Pencil } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

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

  // The same rule as the SOP editor's own guard (requireAdminOrEditor):
  // owner and admin edit directly, an editor by request. The owner was
  // left out here, so it had no edit pencil and no redirect (item 34).
  const access = editAccess(profile?.role);
  const canEdit = access !== "view";

  if (!sop) {
    if (access === "direct") {
      redirect(`/sop/${menuId}/edit`);
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-neutral-500">เมนู &ldquo;{menu?.name ?? menuId}&rdquo; ยังไม่มี SOP</p>
        <Link href="/sop" className={buttonClass("link")}>
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
            className={buttonClass("secondary", { size: "sm" })}
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
