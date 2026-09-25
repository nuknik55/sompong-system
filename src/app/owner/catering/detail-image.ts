// BROWSER ONLY: imported by the image library's screen, a client component.
// Resizes an image and uploads it to the private catering-details bucket
// under a name its upload rule accepts (catering_detail_upload_allowed): the
// library's folder only, owner and admin only, 100 files at most. No
// overwrite, no delete: the bucket refuses both, so a file once uploaded
// stays. An image for one booking is never uploaded (the print page keeps it
// in the browser).
import { createClient } from "@/lib/supabase/client";
import { IMAGE_LONG_SIDE, IMAGE_MAX_BYTES, IMAGE_TYPES, libraryImagePath, randomName } from "@/lib/event-sheet";

const BUCKET = "catering-details";

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * JPEG, PNG or WebP only, resized to 1600 px on the long side. A PNG stays a
 * PNG (a diagram's lines stay sharp) and a WebP stays a WebP, unless still
 * over the bucket's 2 MB or the browser cannot write that type; then JPEG.
 */
export async function resizeForUpload(file: File): Promise<{ blob: Blob; ext: "jpg" | "png" | "webp" }> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG หรือ WebP");
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
    if (file.type === "image/png" || file.type === "image/webp") {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const kept = await toBlob(canvas, file.type, file.type === "image/webp" ? 0.9 : undefined);
      // A browser that cannot write the type hands back a PNG or nothing: take it only as asked.
      if (kept && kept.type === file.type && kept.size <= IMAGE_MAX_BYTES) return { blob: kept, ext: file.type === "image/png" ? "png" : "webp" };
    }
    // A JPEG has no transparency: paint white under it, as paper is.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpg = await toBlob(canvas, "image/jpeg", 0.85);
    if (!jpg) throw new Error("ย่อรูปไม่สำเร็จ");
    if (jpg.size > IMAGE_MAX_BYTES) throw new Error("รูปใหญ่เกิน 2 MB แม้ย่อแล้ว");
    return { blob: jpg, ext: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads a library image (owner and admin); returns the stored path. */
export async function uploadLibraryImage(file: File): Promise<string> {
  const { blob, ext } = await resizeForUpload(file);
  const rand = randomName(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
  const path = libraryImagePath(ext, Date.now(), rand);
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const { error } = await createClient().storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(`อัปโหลดไม่สำเร็จ: ${error.message}`);
  return path;
}
