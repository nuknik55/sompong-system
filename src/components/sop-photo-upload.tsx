"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Camera, X } from "lucide-react";

/** Resize to longest-side ≤ 1200px and compress to JPEG 80% client-side. */
async function resizeAndCompress(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))),
        "image/jpeg",
        0.8
      );
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = URL.createObjectURL(file);
  });
}

/** Upload blob to Supabase Storage sop-photos bucket. Returns public URL. */
async function uploadToSupabase(blob: Blob): Promise<string> {
  const supabase = createClient();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.jpg`;
  const { error } = await supabase.storage.from("sop-photos").upload(filename, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("sop-photos").getPublicUrl(filename);
  return data.publicUrl;
}

export function SopPhotoUpload({
  photoUrl,
  onChange,
}: {
  photoUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const blob = await resizeAndCompress(file);
      const url = await uploadToSupabase(blob);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (photoUrl) {
    return (
      <div className="relative inline-block w-32">
        <div className="aspect-[4/3] overflow-hidden rounded-md border border-neutral-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt="step photo"
            className="h-full w-full object-cover object-center"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
          title="ลบรูป"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 hover:border-brand-green hover:text-brand-green disabled:opacity-50"
      >
        <Camera className="h-4 w-4" />
        {uploading ? "กำลังอัปโหลด..." : "เพิ่มรูป"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
