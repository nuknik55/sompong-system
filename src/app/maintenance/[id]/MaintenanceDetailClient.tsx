"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Camera } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { updateReportStatus } from "@/app/maintenance/actions";
import type { MaintenanceReport, MaintenanceStatus } from "@/lib/maintenance-data";

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-4 w-4 text-yellow-500" />,
  ประปา: <Droplets className="h-4 w-4 text-blue-500" />,
  เครื่องครัว: <UtensilsCrossed className="h-4 w-4 text-green-700" />,
  อื่นๆ: <MoreHorizontal className="h-4 w-4 text-neutral-500" />,
};

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  new: "แจ้งแล้ว", in_progress: "กำลังซ่อม", done: "เสร็จแล้ว",
};
const STATUS_CLS: Record<MaintenanceStatus, string> = {
  new: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

function ReportPhoto({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex-1">
      <p className="mb-1 text-xs font-medium text-neutral-500">{label}</p>
      <div className="overflow-hidden rounded-xl bg-neutral-100 flex items-center justify-center"
        style={{ maxHeight: "280px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label}
          className="object-contain max-w-full"
          style={{ maxHeight: "280px" }} />
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function MaintenanceDetailClient({
  report,
  canManage,
  isOwn,
}: {
  report: MaintenanceReport;
  canManage: boolean;
  isOwn: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDonePanel, setShowDonePanel] = useState(false);
  const [afterPhoto, setAfterPhoto] = useState<string | null>(null);
  const [resolverNote, setResolverNote] = useState("");

  function changeStatus(status: MaintenanceStatus) {
    setError(null);
    if (status === "done") { setShowDonePanel(true); return; }
    startTransition(async () => {
      const res = await updateReportStatus(report.id, status);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function confirmDone() {
    setError(null);
    startTransition(async () => {
      const res = await updateReportStatus(report.id, "done", {
        photoAfter: afterPhoto ?? undefined,
        resolverNote,
      });
      if (res.error) { setError(res.error); return; }
      setShowDonePanel(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            {CAT_ICON[report.category] ?? CAT_ICON["อื่นๆ"]}
            {report.category}
          </div>
          <p className="text-sm text-neutral-600 mt-0.5">{report.location || "ไม่ระบุจุด"}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${STATUS_CLS[report.status]}`}>
          {STATUS_LABEL[report.status]}
        </span>
      </div>

      {/* Urgent */}
      {report.isUrgent && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> เร่งด่วน — กระทบการทำงาน
        </div>
      )}

      {/* Description */}
      {report.description && (
        <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2.5">
          <p className="text-xs text-neutral-400 mb-0.5">รายละเอียด</p>
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">{report.description}</p>
        </div>
      )}

      {/* Photos */}
      {report.photoBefore || report.photoAfter ? (
        <div className={`flex gap-3 ${report.photoBefore && report.photoAfter ? "flex-row" : ""}`}>
          {report.photoBefore && <ReportPhoto url={report.photoBefore} label="ก่อนซ่อม" />}
          {report.photoAfter && <ReportPhoto url={report.photoAfter} label="หลังซ่อม" />}
        </div>
      ) : null}

      {/* Meta */}
      <div className="text-xs text-neutral-400 space-y-0.5">
        <p>แจ้งโดย <span className="font-medium text-neutral-600">{report.reporterName || "ไม่ระบุ"}</span> · {fmtDate(report.createdAt)}</p>
        {report.resolvedAt && <p>ดำเนินการเสร็จ {fmtDate(report.resolvedAt)}</p>}
        {report.resolverNote && <p className="text-green-600">✓ {report.resolverNote}</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Status actions (editor+) */}
      {canManage && report.status !== "done" && !showDonePanel && (
        <div className="flex gap-2 pt-1">
          {report.status === "new" && (
            <button type="button" disabled={isPending}
              onClick={() => changeStatus("in_progress")}
              className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              รับเรื่อง — กำลังซ่อม
            </button>
          )}
          <button type="button" disabled={isPending}
            onClick={() => changeStatus("done")}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "#2F5A16" }}>
            ✓ เสร็จแล้ว
          </button>
        </div>
      )}

      {/* Done confirmation panel — uploads after photo before confirming */}
      {showDonePanel && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="text-sm font-medium text-green-800">ยืนยันซ่อมเสร็จ</p>

          <div>
            <p className="mb-1.5 text-xs text-green-700">รูปหลังซ่อม (ไม่บังคับ)</p>
            <SopPhotoUpload photoUrl={afterPhoto} onChange={setAfterPhoto}
              bucket="sop-photos" filenamePrefix="maint-after-" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-green-700">หมายเหตุ (ไม่บังคับ)</label>
            <input type="text" value={resolverNote} onChange={(e) => setResolverNote(e.target.value)}
              placeholder="เช่น เปลี่ยนหลอดใหม่แล้ว"
              className="w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={confirmDone}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "#2F5A16" }}>
              {isPending ? "กำลังบันทึก..." : "ยืนยันเสร็จแล้ว"}
            </button>
            <button type="button" onClick={() => setShowDonePanel(false)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Edit button for own "new" reports */}
      {isOwn && report.status === "new" && (
        <a href={`/maintenance/${report.id}/edit`}
          className="inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
          แก้ไขรายการ
        </a>
      )}
    </div>
  );
}
