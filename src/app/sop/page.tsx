import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getSopList } from "@/lib/sop-data";
import { Plus } from "lucide-react";
import { SopListClient } from "@/app/sop/SopListClient";

export default async function SopIndexPage() {
  const [profile, items] = await Promise.all([getCurrentProfile(), getSopList()]);
  const isAdmin = profile?.role === "admin";
  const canEdit = profile?.role === "admin" || profile?.role === "editor";
  const totalMenus = items.length;
  const hasSop = items.filter((i) => i.sopId !== null).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-kanit text-xl font-semibold text-brand-green">SOP ครัว</h1>
          <p className="text-sm text-neutral-500">
            มี SOP แล้ว {hasSop} จาก {totalMenus} เมนู
            {profile?.role === "editor" && (
              <span className="ml-2 text-amber-600 text-xs">· การเปลี่ยนแปลงต้องรอ Admin อนุมัติ</span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/sop/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-2 text-sm font-medium text-white hover:bg-brand-green/90"
          >
            <Plus className="h-4 w-4" />
            สร้าง SOP ใหม่
          </Link>
        )}
      </div>

      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full bg-brand-green transition-all" style={{ width: `${(hasSop / Math.max(totalMenus, 1)) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          {totalMenus > 0 ? `${Math.round((hasSop / totalMenus) * 100)}% เสร็จแล้ว` : "ยังไม่มีเมนู"}
        </p>
      </div>

      <SopListClient items={items} canEdit={canEdit} isAdmin={isAdmin} />
    </div>
  );
}
