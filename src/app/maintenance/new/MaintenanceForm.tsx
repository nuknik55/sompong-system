"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Send } from "lucide-react";
import { SopPhotoUpload } from "@/components/sop-photo-upload";
import { createReport } from "@/app/maintenance/actions";

const CATEGORIES = [
  { key: "ไฟฟ้า", icon: <Zap className="h-4 w-4" />, color: "text-amber-600" },
  { key: "ประปา", icon: <Droplets className="h-4 w-4" />, color: "text-blue-600" },
  { key: "เครื่องครัว", icon: <UtensilsCrossed className="h-4 w-4" />, color: "text-green-700" },
  { key: "อื่นๆ", icon: <MoreHorizontal className="h-4 w-4" />, color: "text-neutral-500" },
] as const;

export function MaintenanceForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [photoBefore, setPhotoBefore] = useState<string | null>(null);
  const [category, setCategory] = useState("อื่นๆ");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createReport({ category, location, description, isUrgent, photoBefore });
      if (result.error) { setError(result.error); return; }
      router.push("/maintenance");
    });
  }

  return (
    <div className="space-y-5">
      {/* Photo */}
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700">ถ่ายรูปสิ่งที่เสียหาย</p>
        {photoBefore ? (
          <div className="relative overflow-hidden rounded-xl bg-neutral-100 flex items-center justify-center max-h-60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoBefore} alt="before" className="object-contain max-h-60 max-w-full" />
            <button
              type="button"
              onClick={() => setPhotoBefore(null)}
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 text-xs"
            >
              ✕
            </button>
          </div>
        ) : (
          <SopPhotoUpload
            photoUrl={null}
            onChange={setPhotoBefore}
            bucket="sop-photos"
            filenamePrefix="maint-"
          />
        )}
      </div>

      {/* Category */}
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700">หมวดหมู่</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map(({ key, icon, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors ${
                category === key
                  ? "border-brand-green bg-green-50 text-brand-green"
                  : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
              style={category === key ? { borderColor: "#2F5A16", color: "#2F5A16" } : undefined}
            >
              <span className={category === key ? "text-brand-green" : color}>{icon}</span>
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-700">
          จุดที่เสียหาย
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="เช่น ครัวใหญ่ ใกล้อ่างล้างจาน..."
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-brand-green focus:outline-none"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-700">
          รายละเอียดเพิ่มเติม <span className="text-neutral-400 font-normal">(ถ้ามี)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="เช่น หลอดไฟกระพริบตลอดเวลา..."
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-brand-green focus:outline-none"
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
        <span className={`flex items-center gap-2 text-sm ${isUrgent ? "text-red-700 font-medium" : "text-neutral-600"}`}>
          <AlertTriangle className="h-4 w-4" />
          เร่งด่วน (กระทบการทำงานตอนนี้)
        </span>
        <div className={`h-5 w-9 rounded-full transition-colors ${isUrgent ? "bg-red-500" : "bg-neutral-300"}`}>
          <div className={`h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-all ${isUrgent ? "translate-x-4 ml-0.5" : "ml-0.5"}`} />
        </div>
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Submit */}
      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "#2F5A16" }}
      >
        <Send className="h-4 w-4" />
        {isPending ? "กำลังส่ง..." : "ส่งแจ้งซ่อม"}
      </button>
    </div>
  );
}
