"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import {
  BLOCK_BODY_MAX, CAPTION_MAX, IMAGE_TYPES, LIBRARY_FILES_MAX, parseVenueTags, type LibraryBlock, type LibraryImage,
} from "@/lib/event-sheet";
import { uploadLibraryImage } from "../detail-image";
import { deleteLibraryBlock, deleteLibraryImage, saveLibraryBlock, saveLibraryImage } from "./actions";

type TermDraft = { id: string | null; title: string; body: string; tags: string; sort_order: string };
/** image_path: the file once uploaded; file: the one picked, uploaded only on Save (a cancelled pick spends no slot). */
type ImageDraft = { id: string | null; name: string; caption: string; image_path: string | null; file: File | null; tags: string; sort_order: string };
type Result = { error?: string };

export function LibraryClient({ blocks, images, usage, urls, fileCount, suggestions }: {
  blocks: LibraryBlock[];
  images: LibraryImage[];
  usage: Record<string, number>;
  urls: Record<string, string>;
  /** Files in the library's folder of the bucket (null when the listing failed). */
  fileCount: number | null;
  suggestions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState<TermDraft | null>(null);
  const [image, setImage] = useState<ImageDraft | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = fileCount !== null && fileCount >= LIBRARY_FILES_MAX;

  // The local preview of a picked file is released when it is replaced or the dialog closes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function run(work: () => Promise<Result>, done: string, close: () => void) {
    startTransition(async () => {
      try {
        const r = await work();
        if (r.error) { setMessage({ error: true, text: r.error }); return; }
        close();
        setMessage({ error: false, text: done });
        router.refresh();
      } catch {
        setMessage({ error: true, text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  }

  // A picked file is only previewed here; it is uploaded when the image is saved.
  function pick(file: File) {
    setMessage(null);
    setPreview(URL.createObjectURL(file));
    setImage((d) => (d ? { ...d, file, image_path: null, name: d.name || file.name.replace(/[.][^.]+$/, "") } : d));
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Uploads the picked file, once: a retry after a failed save reuses the path. */
  async function uploadFor(d: ImageDraft): Promise<string | null> {
    if (d.image_path) return d.image_path;
    if (!d.file) { setMessage({ error: true, text: "เลือกไฟล์รูปก่อน" }); return null; }
    setUploading(true);
    try {
      const path = await uploadLibraryImage(d.file);
      setImage((x) => (x ? { ...x, image_path: path } : x));
      return path;
    } catch (err) {
      const text = err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ";
      setMessage({ error: true, text: /row-level security/i.test(text) ? `อัปโหลดไม่ได้ — คลังรูปเต็ม (${LIBRARY_FILES_MAX} ไฟล์) หรือไม่มีสิทธิ์` : text });
      return null;
    } finally {
      setUploading(false);
    }
  }

  const tagsField = (value: string, onChange: (v: string) => void) => (
    <label className="block text-sm text-neutral-700">ใช้กับสถานที่ (คั่นด้วยจุลภาค)
      <input value={value} onChange={(e) => onChange(e.target.value)} list="venue-suggestions" placeholder="เช่น ห้อง V1, แอร์รวม" className="input-base mt-1 block w-full" />
      <span className="mt-1 block text-xs text-neutral-500">พิมพ์ชื่อสถานที่ได้อิสระ ตรงกับชื่อห้องของงาน (เช่น {suggestions.slice(0, 3).join(", ")}) จะขึ้นเป็นอันดับแรก</span>
    </label>
  );
  const usedNote = (id: string) => ((usage[id] ?? 0) > 0 ? ` · ใช้ใน ${usage[id]} งาน` : "");
  const tagsNote = (tags: string[]) => (tags.length > 0 ? `สถานที่: ${tags.join(" · ")}` : "ไม่ระบุสถานที่ (แสดงในกลุ่มอื่น ๆ)");

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/owner/catering/settings", label: "ตั้งค่าจัดเลี้ยง" }}
        title="คลังรายละเอียดงาน"
        subtitle={<span>ข้อตกลง และรูปห้อง/ผังโต๊ะ สำหรับใบรายละเอียดงานที่แนบกับใบเสนอราคา — งานที่เลือกไปแล้วเก็บข้อความและคำอธิบายรูปของตัวเอง แก้ที่นี่ไม่กระทบงานเดิม</span>}
      />
      <datalist id="venue-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>

      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" : "text-sm text-neutral-700"}>{message.text}</p>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-neutral-900">ข้อตกลง / เงื่อนไข</h2>
          <button type="button" onClick={() => { setMessage(null); setTerm({ id: null, title: "", body: "", tags: "", sort_order: "0" }); }} className={buttonClass("primary", { size: "sm" })}>+ เพิ่มข้อตกลง</button>
        </div>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {blocks.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-500">ยังไม่มีข้อตกลงในคลัง</p>}
          <ul className="divide-y divide-neutral-100">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-neutral-800">{b.title}</div>
                  <p className="line-clamp-2 text-xs text-neutral-600">{b.body}</p>
                  <p className="text-xs text-neutral-500">{tagsNote(b.venue_tags)}{usedNote(b.id)}</p>
                </div>
                <div className="flex flex-none gap-2">
                  <button type="button" disabled={pending} className={buttonClass("link", { size: "sm" })}
                    onClick={() => { setMessage(null); setTerm({ id: b.id, title: b.title, body: b.body, tags: b.venue_tags.join(", "), sort_order: String(b.sort_order) }); }}>แก้ไข</button>
                  <button type="button" disabled={pending || (usage[b.id] ?? 0) > 0} title={(usage[b.id] ?? 0) > 0 ? "มีงานใช้ข้อตกลงนี้อยู่ จึงลบไม่ได้" : undefined}
                    className={buttonClass("link", { size: "sm", dangerHover: true })}
                    onClick={() => { if (window.confirm(`ลบ “${b.title}” ออกจากคลัง?`)) run(() => deleteLibraryBlock(b.id), "ลบแล้ว", () => {}); }}>ลบ</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-neutral-900">รูปห้องและผังโต๊ะ</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-600">{fileCount === null ? "" : `ไฟล์ในคลัง ${fileCount}/${LIBRARY_FILES_MAX}`}</span>
            <button type="button" disabled={full} onClick={() => { setMessage(null); setPreview(null); setImage({ id: null, name: "", caption: "", image_path: null, file: null, tags: "", sort_order: "0" }); }}
              className={buttonClass("primary", { size: "sm" })}>+ เพิ่มรูป</button>
          </div>
        </div>
        <p className="text-xs text-neutral-500">อัปโหลดรูปครั้งเดียวใช้ได้ทุกงาน · JPEG, PNG หรือ WebP ย่อเหลือด้านยาว 1600 px ก่อนอัปโหลด · ไฟล์ที่อัปโหลดแล้วลบหรือเปลี่ยนไม่ได้ (ถ้าจะเปลี่ยนรูป ให้เพิ่มรูปใหม่) และนับรวมใน {LIBRARY_FILES_MAX} ไฟล์ แม้ลบรูปออกจากคลังแล้ว · รูปที่มีงานใช้อยู่ลบออกจากคลังไม่ได้</p>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {images.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-500">ยังไม่มีรูปในคลัง</p>}
          <ul className="divide-y divide-neutral-100">
            {images.map((g) => (
              <li key={g.id} className="flex items-start gap-3 px-4 py-3">
                {urls[g.image_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private library image
                  <img src={urls[g.image_path]} alt="" className="h-16 w-24 flex-none rounded border border-neutral-200 object-cover" />
                ) : (
                  <span className="flex h-16 w-24 flex-none items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">เปิดรูปไม่ได้</span>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-neutral-800">{g.name}</div>
                  {g.caption && <p className="line-clamp-2 text-xs text-neutral-600">คำอธิบาย: {g.caption}</p>}
                  <p className="text-xs text-neutral-500">{tagsNote(g.venue_tags)}{usedNote(g.id)}</p>
                </div>
                <div className="flex flex-none gap-2">
                  <button type="button" disabled={pending} className={buttonClass("link", { size: "sm" })}
                    onClick={() => { setMessage(null); setPreview(null); setImage({ id: g.id, name: g.name, caption: g.caption ?? "", image_path: g.image_path, file: null, tags: g.venue_tags.join(", "), sort_order: String(g.sort_order) }); }}>แก้ไข</button>
                  <button type="button" disabled={pending || (usage[g.id] ?? 0) > 0} title={(usage[g.id] ?? 0) > 0 ? "มีงานใช้รูปนี้อยู่ จึงลบไม่ได้" : undefined}
                    className={buttonClass("link", { size: "sm", dangerHover: true })}
                    onClick={() => { if (window.confirm(`ลบ “${g.name}” ออกจากคลัง? (ไฟล์ยังอยู่ในที่เก็บ)`)) run(() => deleteLibraryImage(g.id), "ลบแล้ว", () => {}); }}>ลบ</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {term && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={term.id ? "แก้ไขข้อตกลง" : "เพิ่มข้อตกลง"}>
          <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-heading text-lg font-semibold text-neutral-900">{term.id ? "แก้ไขข้อตกลง" : "เพิ่มข้อตกลง"}</h2>
            <label className="block text-sm text-neutral-700">หัวข้อ
              <input value={term.title} onChange={(e) => setTerm({ ...term, title: e.target.value })} className="input-base mt-1 block w-full" />
            </label>
            <label className="block text-sm text-neutral-700">ข้อความ
              <textarea value={term.body} onChange={(e) => setTerm({ ...term, body: e.target.value })} maxLength={BLOCK_BODY_MAX} className="input-base mt-1 block h-40 w-full" />
            </label>
            {tagsField(term.tags, (v) => setTerm({ ...term, tags: v }))}
            <label className="block text-sm text-neutral-700">ลำดับในคลัง
              <input value={term.sort_order} onChange={(e) => setTerm({ ...term, sort_order: e.target.value })} inputMode="numeric" className="input-base mt-1 block w-24" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTerm(null)} className={buttonClass("secondary")}>ยกเลิก</button>
              <button type="button" disabled={pending} className={buttonClass("primary")}
                onClick={() => {
                  const sort = Number(term.sort_order);
                  run(() => saveLibraryBlock(term.id, { title: term.title, body: term.body, venue_tags: parseVenueTags(term.tags), sort_order: Number.isInteger(sort) ? sort : 0 }),
                    "บันทึกแล้ว", () => setTerm(null));
                }}>บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {image && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={image.id ? "แก้ไขรูป" : "เพิ่มรูป"}>
          <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-heading text-lg font-semibold text-neutral-900">{image.id ? "แก้ไขรูป" : "เพิ่มรูป"}</h2>
            <div className="space-y-2 text-sm text-neutral-700">
              {(preview ?? (image.image_path ? urls[image.image_path] : null)) && (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed link
                <img src={(preview ?? urls[image.image_path as string]) as string} alt="" className="max-h-48 rounded border border-neutral-200 object-contain" />
              )}
              {image.id === null && (
                <>
                  <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
                  <button type="button" disabled={uploading || image.image_path !== null} onClick={() => fileRef.current?.click()} className={buttonClass("secondary", { size: "sm" })}>
                    {image.image_path ? "อัปโหลดแล้ว" : image.file ? "เปลี่ยนไฟล์" : "เลือกไฟล์ (JPEG, PNG, WebP)"}
                  </button>
                  <span className="block text-xs text-neutral-500">ไฟล์จะอัปโหลดเมื่อกดบันทึก</span>
                </>
              )}
              {image.id !== null && <p className="text-xs text-neutral-500">เปลี่ยนไฟล์รูปไม่ได้ — งานที่เลือกรูปนี้พิมพ์รูปนี้อยู่ ถ้าจะใช้รูปใหม่ให้เพิ่มรูปใหม่</p>}
            </div>
            <label className="block text-sm text-neutral-700">ชื่อรูป
              <input value={image.name} onChange={(e) => setImage({ ...image, name: e.target.value })} className="input-base mt-1 block w-full" />
            </label>
            <label className="block text-sm text-neutral-700">คำอธิบายรูป (ค่าเริ่มต้น — แต่ละงานแก้ของตัวเองได้)
              <input value={image.caption} onChange={(e) => setImage({ ...image, caption: e.target.value })} maxLength={CAPTION_MAX} className="input-base mt-1 block w-full" />
            </label>
            {tagsField(image.tags, (v) => setImage({ ...image, tags: v }))}
            <label className="block text-sm text-neutral-700">ลำดับในคลัง
              <input value={image.sort_order} onChange={(e) => setImage({ ...image, sort_order: e.target.value })} inputMode="numeric" className="input-base mt-1 block w-24" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setImage(null); setPreview(null); }} className={buttonClass("secondary")}>ยกเลิก</button>
              <button type="button" disabled={pending || uploading || (image.image_path === null && image.file === null)} className={buttonClass("primary")}
                onClick={async () => {
                  if (image.name.trim() === "") { setMessage({ error: true, text: "ใส่ชื่อรูป" }); return; }
                  const path = await uploadFor(image);
                  if (!path) return;
                  const sort = Number(image.sort_order);
                  run(() => saveLibraryImage(image.id, {
                    name: image.name, caption: image.caption.trim() === "" ? null : image.caption, image_path: path,
                    venue_tags: parseVenueTags(image.tags), sort_order: Number.isInteger(sort) ? sort : 0,
                  }), "บันทึกแล้ว", () => { setImage(null); setPreview(null); });
                }}>{uploading ? "กำลังอัปโหลด…" : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
