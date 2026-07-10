"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Send } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { createReport, editReport } from "@/app/maintenance/actions";
import type { MaintenanceReport } from "@/lib/maintenance-data";

const CATEGORIES = [
  { label: "ไฟฟ้า",       icon: <Zap className="h-4 w-4" />,             color: "text-yellow-600" },
  { label: "ประปา",        icon: <Droplets className="h-4 w-4" />,        color: "text-blue-600" },
  { label: "เครื่องครัว", icon: <UtensilsCrossed className="h-4 w-4" />, color: "text-green-700" },
  { label: "อื่นๆ",        icon: <MoreHorizontal className="h-4 w-4" />,  color: "text-neutral-500" },
];

export function MaintenanceForm({
  mode,
  existing,
}: {
  mode: "create" | "edit";
  existing?: MaintenanceReport;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [photo, setPhoto] = useState<string | null>(existing?.photoBefore ?? null);
  const [category, setCategory] = useState(existing?.category ?? "อื่นๆ");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [isUrgent, setIsUrgent] = useState(existing?.isUrgent ?? false);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      let res: { error?: string };
      if (mode === "create") {
        res = await createReport({ category, location, description, isUrgent, photoBefore: photo });
      } else {
        res = await editReport(existing!.id, { category, location, description, isUrgent, photoBefore: photo });
      }
      if (res.error) { setError(res.error); return; }
      router.push("/maintenance");
    });
  }

  return (
    <div className="space-y-5">
      {/* Photo */}
      <div>
        <p className="mb-2 text-sm text-neutral-600">ถ่ายรูปสิ่งที่เสียหาย</p>
        <SopPhotoUpload
          photoUrl={photo}
          onChange={setPhoto}
          bucket="sop-photos"
          filenamePrefix="maint-"
        />
      </div>

      {/* Category */}
      <div>
        <p className="mb-2 text-sm text-neutral-600">หมวดหมู่</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(c.label)}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors ${
                category === c.label
                  ? "border-green-700 bg-green-50 font-medium text-green-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              <span className={c.color}>{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="mb-1 block text-sm text-neutral-600">จุดที่เสียหาย</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="เช่น ครัวใหญ่ — ใกล้อ่างล้างจาน"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm text-neutral-600">รายละเอียดเพิ่มเติม (ถ้ามี)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="เช่น หลอดไฟกระพริบตลอดเวลา..."
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
        />
      </div>

      {/* Urgent toggle */}
      <button
        type="button"
        onClick={() => setIsUrgent((v) => !v)}
        className={`flex w-full items-center justify-between rounded-lg px-4 py-3 transition-colors ${
          isUrgent ? "bg-red-50 border border-red-200" : "bg-neutral-50 border border-neutral-200"
        }`}
      >
        <span className={`flex items-center gap-2 text-sm font-medium ${isUrgent ? "text-red-700" : "text-neutral-600"}`}>
          <AlertTriangle className="h-4 w-4" />
          เร่งด่วน (กระทบการทำงานตอนนี้)
        </span>
        <span className={`h-6 w-11 rounded-full transition-colors ${isUrgent ? "bg-red-500" : "bg-neutral-300"}`} />
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "#2F5A16" }}
      >
        <Send className="h-4 w-4" />
        {isPending ? "กำลังส่ง..." : mode === "create" ? "ส่งแจ้งซ่อม" : "บันทึกการแก้ไข"}
      </button>
    </div>
  );
}

