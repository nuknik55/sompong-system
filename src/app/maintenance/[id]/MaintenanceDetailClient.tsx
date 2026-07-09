"use client";

import { useState, useTransition } from "react";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Camera } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { updateReportStatus } from "@/app/maintenance/actions";
import type { MaintenanceReport, MaintenanceStatus } from "@/lib/maintenance-data";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-4 w-4" />,
  ประปา: <Droplets className="h-4 w-4" />,
  เครื่องครัว: <UtensilsCrossed className="h-4 w-4" />,
  อื่นๆ: <MoreHorizontal className="h-4 w-4" />,
};
const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  new: "แจ้งแล้ว",
  in_progress: "กำลังซ่อม",
  done: "เสร็จแล้ว",
};
const STATUS_COLOR: Record<MaintenanceStatus, string> = {
  new: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-700",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Photo display — same CSS as SOP player: object-contain + neutral bg ───────
function ReportPhoto({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <div className="flex items-center justify-center overflow-hidden rounded-xl bg-neutral-100 max-h-72 md:max-h-96">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="object-contain max-h-72 md:max-h-96 max-w-full"
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MaintenanceDetailClient({
  report,
  canManage,
}: {
  report: MaintenanceReport;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // "Mark done" inline flow
  const [showDonePanel, setShowDonePanel] = useState(false);
  const [afterPhoto, setAfterPhoto] = useState<string | null>(null);
  const [resolverNote, setResolverNote] = useState("");

  function changeStatus(status: MaintenanceStatus) {
    setError(null);
    startTransition(async () => {
      const result = await updateReportStatus(report.id, status);
      if (result.error) setError(result.error);
    });
  }

  function confirmDone() {
    setError(null);
    startTransition(async () => {
      const result = await updateReportStatus(report.id, "done", {
        photoAfter: afterPhoto,
        resolverNote,
      });
      if (result.error) { setError(result.error); return; }
      setShowDonePanel(false);
    });
  }

  const icon = CAT_ICON[report.category] ?? CAT_ICON["อื่นๆ"];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{icon}</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">
            {report.category}
            {report.location ? ` — ${report.location}` : ""}
          </h1>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[report.status]}`}>
          {STATUS_LABEL[report.status]}
        </span>
      </div>

      {report.isUrgent && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          เร่งด่วน — กระทบการทำงาน
        </div>
      )}

      {report.description && (
        <p className="text-sm text-neutral-700 leading-relaxed">{report.description}</p>
      )}

      {/* Photos */}
      {report.status === "done" && report.photoBefore && report.photoAfter ? (
        // Side-by-side when done and both photos exist
        <div className="grid grid-cols-2 gap-3">
          <ReportPhoto url={report.photoBefore} label="ก่อนซ่อม" />
          <ReportPhoto url={report.photoAfter} label="หลังซ่อม" />
        </div>
      ) : (
        <>
          {report.photoBefore && <ReportPhoto url={report.photoBefore} label="รูปก่อนซ่อม" />}
          {report.photoAfter && <ReportPhoto url={report.photoAfter} label="รูปหลังซ่อม" />}
        </>
      )}

      {/* Meta */}
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3 space-y-1 text-xs text-neutral-500">
        <p>แจ้งโดย <strong className="text-neutral-700">{report.reporterName || "ไม่ระบุ"}</strong></p>
        <p>เวลาแจ้ง {formatDate(report.createdAt)}</p>
        {report.resolvedAt && <p>เสร็จเมื่อ {formatDate(report.resolvedAt)}</p>}
        {report.resolverNote && <p className="text-neutral-600">หมายเหตุช่าง: {report.resolverNote}</p>}
      </div>

      {/* Status action buttons (editor+) */}
      {canManage && report.status !== "done" && !showDonePanel && (
        <div className="flex flex-wrap gap-2">
          {report.status === "new" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => changeStatus("in_progress")}
              className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {isPending ? "..." : "รับงาน (กำลังซ่อม)"}
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowDonePanel(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "#2F5A16" }}
          >
            ✓ เสร็จแล้ว
          </button>
        </div>
      )}

      {/* "Mark done" inline panel — prompted to upload after-photo */}
      {showDonePanel && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-4">
          <p className="font-medium text-sm text-green-800">ยืนยันว่าซ่อมเสร็จแล้ว</p>

          {/* After-photo upload */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-green-700">
              <Camera className="h-3.5 w-3.5" />
              อัปโหลดรูปหลังซ่อม <span className="text-green-500">(ไม่บังคับ)</span>
            </p>
            {afterPhoto ? (
              <div className="relative overflow-hidden rounded-xl bg-neutral-100 flex items-center justify-center max-h-48">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={afterPhoto} alt="after" className="object-contain max-h-48 max-w-full" />
                <button
                  type="button"
                  onClick={() => setAfterPhoto(null)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white text-xs"
                >
                  ✕
                </button>
              </div>
            ) : (
              <SopPhotoUpload
                photoUrl={null}
                onChange={setAfterPhoto}
                bucket="sop-photos"
                filenamePrefix="maint-after-"
              />
            )}
          </div>

          {/* Optional note */}
          <div>
            <p className="mb-1 text-xs text-green-700">หมายเหตุ (ไม่บังคับ)</p>
            <textarea
              value={resolverNote}
              onChange={(e) => setResolverNote(e.target.value)}
              placeholder="เช่น เปลี่ยนหลอดใหม่ รุ่น LED 18W..."
              rows={2}
              className="w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-sm focus:border-green-400 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={confirmDone}
              className="flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "#2F5A16" }}
            >
              {isPending ? "กำลังบันทึก..." : "ยืนยันเสร็จแล้ว"}
            </button>
            <button
              type="button"
              onClick={() => { setShowDonePanel(false); setAfterPhoto(null); setResolverNote(""); }}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {!showDonePanel && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
