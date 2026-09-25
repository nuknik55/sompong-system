"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { cancelReport, updateReportStatus } from "@/app/maintenance/actions";
import type { MaintenanceReport } from "@/lib/maintenance-data";
import {
  CANCEL_NOTE_MAX, STATUS_CLASS, STATUS_LABEL, canCancel, canEditReport, canMarkDone, canTake,
} from "@/lib/maintenance-rules";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { thaiDateTime } from "@/lib/thai-date";

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-4 w-4 text-yellow-500" />,
  ประปา: <Droplets className="h-4 w-4 text-blue-500" />,
  เครื่องครัว: <UtensilsCrossed className="h-4 w-4 text-success-ink" />,
  อื่นๆ: <MoreHorizontal className="h-4 w-4 text-neutral-500" />,
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
  return thaiDateTime(iso);
}

export function MaintenanceDetailClient({
  report,
  role,
  isReporter,
}: {
  report: MaintenanceReport;
  role: string;
  isReporter: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDonePanel, setShowDonePanel] = useState(false);
  const [afterPhoto, setAfterPhoto] = useState<string | null>(null);
  const [resolverNote, setResolverNote] = useState("");
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelNote, setCancelNote] = useState("");

  // Every control by the rules module, the screen's mirror of the maint_*
  // functions. None of them holds on a done or cancelled report.
  const mayTake = canTake(role, report.status);
  const mayDone = canMarkDone(role, report.status);
  const mayEdit = canEditReport(role, isReporter, report.status);
  const mayCancel = canCancel(role, isReporter, report.status);
  const cancelled = report.status === "cancelled";

  function takeReport() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateReportStatus(report.id, "in_progress");
        if (res.error) { setError(res.error); return; }
        router.refresh();
      } catch {
        setError("เปลี่ยนสถานะไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่");
      }
    });
  }

  function confirmDone() {
    setError(null);
    startTransition(async () => {
      // The done panel stays OPEN on failure: the after-photo and the note
      // are in it, and closing it would throw away work the person cannot
      // retake. setShowDonePanel(false) belongs to the success path only.
      try {
        const res = await updateReportStatus(report.id, "done", {
          photoAfter: afterPhoto ?? undefined,
          resolverNote,
        });
        if (res.error) { setError(res.error); return; }
        setShowDonePanel(false);
        router.refresh();
      } catch {
        setError("บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่");
      }
    });
  }

  function confirmCancel() {
    setError(null);
    startTransition(async () => {
      // Like the done panel, the confirm box stays open on failure, with the
      // note in it, and the database's message is shown as it came.
      try {
        const res = await cancelReport(report.id, cancelNote);
        if (res.error) { setError(res.error); return; }
        setShowCancelForm(false);
        router.refresh();
      } catch {
        setError("ยกเลิกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่");
      }
    });
  }

  return (
    <div className="max-w-lg space-y-5">
      {/* Header: the shared page header */}
      <PageHeader
        back={{ href: "/maintenance", label: "รายการแจ้งซ่อม" }}
        title={
          <span className="flex items-center gap-2">
            {CAT_ICON[report.category] ?? CAT_ICON["อื่นๆ"]}
            {report.category}
          </span>
        }
        subtitle={
          <span className={`break-words text-neutral-600 ${cancelled ? "line-through" : ""}`}>
            {report.location || "ไม่ระบุจุด"}
          </span>
        }
        actions={
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${STATUS_CLASS[report.status]}`}>
            {STATUS_LABEL[report.status]}
          </span>
        }
      />

      {/* Urgent */}
      {report.isUrgent && (
        <div className="flex items-center gap-2 rounded-lg bg-danger-soft border border-danger/40 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" /> เร่งด่วน — กระทบการทำงาน
        </div>
      )}

      {/* Description */}
      {report.description && (
        <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2.5">
          <p className="text-xs text-neutral-500 mb-0.5">รายละเอียด</p>
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
      <div className="text-xs text-neutral-500 space-y-0.5">
        <p>แจ้งโดย <span className="font-medium text-neutral-600">{report.reporterName || "ไม่ระบุ"}</span> · {fmtDate(report.createdAt)}</p>
        {/* A cancelled report names its taker only if someone took it. */}
        {(report.status === "in_progress" || report.status === "done" || (cancelled && report.resolverName)) && (
          <p>{report.status === "done" ? "ซ่อมโดย" : "รับเรื่องโดย"} <span className="font-medium text-neutral-600">{report.resolverName || "ไม่ระบุชื่อ"}</span></p>
        )}
        {report.resolvedAt && <p>ดำเนินการเสร็จ {fmtDate(report.resolvedAt)}</p>}
        {report.resolverNote && <p className="text-success-ink">✓ {report.resolverNote}</p>}
      </div>

      {/* Cancelled: who, when, why. Grey, never red: a cancel is not a delete. */}
      {cancelled && (
        <div className="space-y-1 rounded-lg border border-neutral-300 bg-neutral-100 p-3">
          <p className="text-sm font-medium text-neutral-800">ยกเลิกแล้ว</p>
          <p className="text-xs text-neutral-600">
            ยกเลิกโดย <span className="font-medium">{report.cancelledByName || "ไม่ระบุชื่อ"}</span>
            {report.cancelledAt && <> · {fmtDate(report.cancelledAt)}</>}
          </p>
          {report.cancelNote && (
            <p className="whitespace-pre-wrap break-words text-xs text-neutral-600">เหตุผล: {report.cancelNote}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Status actions: a head (owner, admin, editor) on an open report */}
      {(mayTake || mayDone) && !showDonePanel && !showCancelForm && (
        <div className="flex flex-wrap gap-2 pt-1">
          {mayTake && (
            <button type="button" disabled={isPending}
              onClick={takeReport}
              className={buttonClass("secondary")}>
              รับเรื่อง — กำลังซ่อม
            </button>
          )}
          {mayDone && (
            <button type="button" disabled={isPending}
              onClick={() => { setError(null); setShowDonePanel(true); }}
              className={buttonClass("primary")}>
              ✓ เสร็จแล้ว
            </button>
          )}
        </div>
      )}

      {/* Done confirmation panel — uploads after photo before confirming */}
      {showDonePanel && (
        <div className="rounded-xl border border-success/30 bg-success-soft p-4 space-y-3">
          <p className="text-sm font-medium text-success-ink">ยืนยันซ่อมเสร็จ</p>

          <div>
            <p className="mb-1.5 text-xs text-success-ink">รูปหลังซ่อม (ไม่บังคับ)</p>
            <SopPhotoUpload photoUrl={afterPhoto} onChange={setAfterPhoto}
              bucket="sop-photos" filenamePrefix="maint-after-" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-success-ink">หมายเหตุ (ไม่บังคับ)</label>
            <input type="text" value={resolverNote} onChange={(e) => setResolverNote(e.target.value)}
              placeholder="เช่น เปลี่ยนหลอดใหม่แล้ว"
              className="w-full rounded-lg border border-success/30 bg-white px-3 py-2 text-sm" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={isPending} onClick={confirmDone}
              className={buttonClass("primary")}>
              {isPending ? "กำลังบันทึก..." : "ยืนยันเสร็จแล้ว"}
            </button>
            {/* "ปิด", not "ยกเลิก": beside ยกเลิกรายการ, "ยกเลิก" here would
                read as cancelling the report. */}
            <button type="button" onClick={() => setShowDonePanel(false)}
              className={buttonClass("secondary")}>
              ปิด
            </button>
          </div>
        </div>
      )}

      {/* Edit: the reporter or a head, while the report is new */}
      {mayEdit && !showDonePanel && !showCancelForm && (
        <Link href={`/maintenance/${report.id}/edit`}
          className={buttonClass("secondary")}>
          แก้ไขรายการ
        </Link>
      )}

      {/* Cancel, instead of delete (Nik, 2026-09-25), the way the supply-order
          cancel does it: a quiet link, then an inline confirm with an
          optional note. Not red-filled: a cancel is not a delete. */}
      {mayCancel && !showDonePanel && (
        <div className="space-y-2">
          {!showCancelForm ? (
            <button type="button" disabled={isPending} onClick={() => { setError(null); setShowCancelForm(true); }}
              className={buttonClass("link", { size: "sm", dangerHover: true })}>
              ยกเลิกรายการ
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
              <p className="text-sm font-medium text-neutral-800">ยกเลิกรายการแจ้งซ่อมนี้? ยกเลิกแล้วแก้กลับไม่ได้</p>
              <input type="text" placeholder="เหตุผล (ไม่บังคับ)" maxLength={CANCEL_NOTE_MAX}
                value={cancelNote} onChange={(e) => setCancelNote(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={isPending} onClick={confirmCancel}
                  className={buttonClass("secondary", { size: "sm" })}>
                  {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
                </button>
                <button type="button" disabled={isPending} onClick={() => setShowCancelForm(false)}
                  className={buttonClass("link", { size: "sm" })}>
                  ไม่ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
