import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getSopList } from "@/lib/sop-data";
import { Plus } from "lucide-react";
import { SopListClient } from "@/app/sop/SopListClient";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";

export default async function SopIndexPage() {
  const [profile, items] = await Promise.all([getCurrentProfile(), getSopList()]);
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const canEdit = profile?.role === "owner" || profile?.role === "admin" || profile?.role === "editor";
  const totalMenus = items.length;
  const hasSop = items.filter((i) => i.sopId !== null).length;

  return (
    <PageShell>
      <PageHeader
        title="SOP ครัว"
        subtitle={
          <>
            <span>มี SOP แล้ว {hasSop} จาก {totalMenus} เมนู</span>
            {profile?.role === "editor" && (
              <span className="text-xs text-pending-ink">· การเปลี่ยนแปลงต้องรอ Admin อนุมัติ</span>
            )}
          </>
        }
        actions={
          isAdmin ? (
            <Link href="/sop/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              สร้าง SOP ใหม่
            </Link>
          ) : undefined
        }
      />

      {/* The progress, as the shared look's coloured tiles. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="เมนูทั้งหมด" value={totalMenus} />
        <StatTile
          accent="green"
          label="มี SOP แล้ว"
          value={hasSop}
          note={totalMenus > 0 ? `${Math.round((hasSop / totalMenus) * 100)}% เสร็จแล้ว` : "ยังไม่มีเมนู"}
        />
        <StatTile accent="gold" label="ยังไม่มี SOP" value={totalMenus - hasSop} />
      </div>

      <SopListClient items={items} canEdit={canEdit} isAdmin={isAdmin} />
    </PageShell>
  );
}
