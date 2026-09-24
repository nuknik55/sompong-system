// BROWSER ONLY: imported by the event-details sheet's editor and the library
// page, both client components. Resizes an image and uploads it to the
// private catering-details bucket under a name the bucket's upload rule
// accepts (catering_detail_upload_allowed). No overwrite, no delete: the
// bucket refuses both, so a file once uploaded stays.
import { createClient } from "@/lib/supabase/client";
import {
  IMAGE_LONG_SIDE, IMAGE_MAX_BYTES, eventImagePath, libraryImagePath, randomName,
} from "@/lib/event-sheet";

const BUCKET = "catering-details";

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ย่อรูปไม่สำเร็จ"))), type, quality);
  });
}

/**
 * JPEG or PNG only, resized to 1600 px on the long side. A PNG stays a PNG
 * (a diagram's lines stay sharp) unless it is still over the bucket's 2 MB,
 * when it becomes a JPEG.
 */
export async function resizeForUpload(file: File): Promise<{ blob: Blob; ext: "jpg" | "png" }> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") throw new Error("รองรับเฉพาะไฟล์ JPEG หรือ PNG");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("เปิดรูปไม่ได้"));
      i.src = url;
    });
    const scale = Math.min(1, IMAGE_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ย่อรูปไม่สำเร็จ");
    if (file.type === "image/png") {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await toBlob(canvas, "image/png");
      if (png.size <= IMAGE_MAX_BYTES) return { blob: png, ext: "png" };
    }
    // A JPEG has no transparency: paint white under it, as paper is.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpg = await toBlob(canvas, "image/jpeg", 0.85);
    if (jpg.size > IMAGE_MAX_BYTES) throw new Error("รูปใหญ่เกิน 2 MB แม้ย่อแล้ว");
    return { blob: jpg, ext: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads to the library's folder (owner and admin) or a booking's (owner, admin, sales); returns the stored path. */
export async function uploadDetailImage(file: File, target: { library: true } | { eventId: string }): Promise<string> {
  const { blob, ext } = await resizeForUpload(file);
  const now = Date.now();
  const rand = randomName(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
  const path = "library" in target ? libraryImagePath(ext, now, rand) : eventImagePath(target.eventId, ext, now, rand);
  const { error } = await createClient().storage.from(BUCKET).upload(path, blob, {
    contentType: ext === "png" ? "image/png" : "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`อัปโหลดไม่สำเร็จ: ${error.message}`);
  return path;
}
