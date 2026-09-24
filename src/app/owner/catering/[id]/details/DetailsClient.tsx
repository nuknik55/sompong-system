"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { thaiDate } from "@/lib/thai-date";
import {
  BLOCK_KIND_LABEL, CAPTION_MAX, SHEET_MAX_IMAGES, SHEET_NOTES_MAX, blockProblem, imageCount, isEventImagePath,
  isLibraryImagePath, sheetNoteLines, type LibraryBlock, type SheetBlock,
} from "@/lib/event-sheet";
import { uploadDetailImage } from "../../detail-image";
import { saveEventSheet } from "./actions";

export function DetailsClient({
  eventId, token: initialToken, notes: initialNotes, blocks: initialBlocks, matching, others, venueNames, urls,
  readOnly, customerName, eventDate,
}: {
  eventId: string;
  token: string;
  notes: string;
  blocks: SheetBlock[];
  matching: LibraryBlock[];
  others: LibraryBlock[];
  venueNames: string[];
  /** Signed links for every image the page shows, by stored path. */
  urls: Record<string, string>;
  readOnly: "cancelled" | "locked" | null;
  customerName: string | null;
  eventDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState(initialToken);
  const [notes, setNotes] = useState(initialNotes);
  const [blocks, setBlocks] = useState<SheetBlock[]>(initialBlocks);
  const [saved, setSaved] = useState(() => JSON.stringify([initialNotes, initialBlocks]));
  const [message, setMessage] = useState<{ error: boolean; text: string; conflict?: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<"photo" | "diagram">("photo");
  const [uploadTitle, setUploadTitle] = useState("");
  // Previews of images uploaded on this screen, before a save signs them.
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify([notes, blocks]) !== saved;
  const images = imageCount(blocks);
  const disabled = readOnly !== null || pending;
  const picked = useMemo(() => new Set(blocks.map((b) => b.block_id).filter(Boolean)), [blocks]);
  const src = (p: string | null) => (p ? localUrls[p] ?? urls[p] ?? null : null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (id: string, patch: Partial<SheetBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (index: number, by: -1 | 1) => setBlocks((bs) => {
    const j = index + by;
    if (j < 0 || j >= bs.length) return bs;
    const next = [...bs];
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });

  function addFromLibrary(lib: LibraryBlock) {
    if (lib.image_path && images >= SHEET_MAX_IMAGES) {
      setMessage({ error: true, text: `ใบรายละเอียดงานมีรูปได้ไม่เกิน ${SHEET_MAX_IMAGES} รูป` });
      return;
    }
    setMessage(null);
    setBlocks((bs) => [...bs, {
      id: crypto.randomUUID(), block_id: lib.id, kind: lib.kind, title: lib.title,
      body: lib.kind === "terms" ? lib.body : null, image_path: lib.kind === "terms" ? null : lib.image_path, caption: null,
    }]);
  }

  async function upload(file: File) {
    if (images >= SHEET_MAX_IMAGES) {
      setMessage({ error: true, text: `ใบรายละเอียดงานมีรูปได้ไม่เกิน ${SHEET_MAX_IMAGES} รูป` });
      return;
    }
    setMessage(null);
    setUploading(true);
    try {
      const path = await uploadDetailImage(file, { eventId });
      setLocalUrls((u) => ({ ...u, [path]: URL.createObjectURL(file) }));
      setBlocks((bs) => [...bs, {
        id: crypto.randomUUID(), block_id: null, kind: uploadKind,
        title: uploadTitle.trim() || BLOCK_KIND_LABEL[uploadKind], body: null, image_path: path, caption: null,
      }]);
      setUploadTitle("");
      setMessage({ error: false, text: "อัปโหลดรูปแล้ว — กดบันทึกเพื่อเก็บไว้ในใบรายละเอียดงาน" });
    } catch (err) {
      setMessage({ error: true, text: err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    const imageOk = (p: unknown) => isLibraryImagePath(p) || isEventImagePath(eventId, p);
    for (const b of blocks) {
      const problem = blockProblem(b, imageOk);
      if (problem) { setMessage({ error: true, text: problem }); return; }
    }
    setMessage(null);
    // What is SENT becomes "saved": an edit made while the save runs stays unsaved.
    const sent = JSON.stringify([notes, blocks]);
    startTransition(async () => {
      try {
        const r = await saveEventSheet(eventId, token, { notes, blocks });
        if (r.error) { setMessage({ error: true, text: r.error, conflict: r.conflict }); return; }
        if (r.token) setToken(r.token);
        setSaved(sent);
        setMessage({ error: false, text: "บันทึกใบรายละเอียดงานแล้ว" });
        router.refresh();
      } catch {
        setMessage({ error: true, text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  }

  const libraryRow = (lib: LibraryBlock) => (
    <li key={lib.id} className="flex items-start gap-3 py-2">
      {lib.image_path && src(lib.image_path) ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private image
        <img src={src(lib.image_path)!} alt="" className="h-14 w-20 flex-none rounded border border-neutral-200 object-cover" />
      ) : (
        <span className="flex h-14 w-20 flex-none items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">{BLOCK_KIND_LABEL[lib.kind]}</span>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-neutral-800">{lib.title}</div>
        {lib.body && <p className="line-clamp-2 text-xs text-neutral-600">{lib.body}</p>}
        {lib.venue_tags.length > 0 && <p className="text-xs text-neutral-500">{lib.venue_tags.join(" · ")}</p>}
      </div>
      <button type="button" disabled={disabled || picked.has(lib.id)} onClick={() => addFromLibrary(lib)} className={buttonClass("secondary", { size: "sm" })}>
        {picked.has(lib.id) ? "เพิ่มแล้ว" : "+ เพิ่ม"}
      </button>
    </li>
  );

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        back={{ href: `/owner/catering/${eventId}`, label: "กลับไปหน้างาน" }}
        title="ใบรายละเอียดงาน"
        subtitle={<span>{customerName ?? "-"} · {thaiDate(eventDate)} — พิมพ์ต่อท้ายใบเสนอราคา หรือพิมพ์แยกได้</span>}
        actions={<Link href={`/owner/catering/${eventId}/details/print`} className={buttonClass("secondary")}>ดูตัวอย่าง / พิมพ์</Link>}
      />

      {readOnly && (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
          {readOnly === "cancelled" ? "งานนี้ถูกยกเลิกแล้ว — ดูได้อย่างเดียว" : "ต้นทุนของงานนี้ถูกล็อกแล้ว — ดูได้อย่างเดียว ปลดล็อกที่หน้าต้นทุนก่อนจึงจะแก้ได้"}
        </p>
      )}

      <section className="space-y-2 rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="font-heading text-base font-semibold text-neutral-900">รายละเอียดเพิ่มเติม</h2>
        <p className="text-xs text-neutral-600">หนึ่งบรรทัดต่อหนึ่งข้อ พิมพ์ออกมาเป็นข้อ 1, 2, 3 … ลูกค้าเห็นข้อความนี้ — อย่าใส่ข้อมูลภายในหรือโน้ตถึงครัว</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} maxLength={SHEET_NOTES_MAX}
          className="input-base h-32 w-full" aria-label="รายละเอียดเพิ่มเติม" />
        {sheetNoteLines(notes).length > 0 && <p className="text-xs text-neutral-500">{sheetNoteLines(notes).length} ข้อ</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-neutral-900">หัวข้อบนใบรายละเอียดงาน</h2>
          <span className="text-xs text-neutral-600">รูป {images}/{SHEET_MAX_IMAGES}</span>
        </div>
        {blocks.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มีหัวข้อ — เพิ่มจากคลังด้านล่าง หรืออัปโหลดรูปของงานนี้</p>}
        <ol className="space-y-3">
          {blocks.map((b, i) => (
            <li key={b.id} className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5">{BLOCK_KIND_LABEL[b.kind]}</span>
                <span>{b.block_id ? "จากคลัง — แก้ที่นี่เปลี่ยนเฉพาะงานนี้" : "รูปของงานนี้"}</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนขึ้น">▲</button>
                  <button type="button" disabled={disabled || i === blocks.length - 1} onClick={() => move(i, 1)} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนลง">▼</button>
                  <button type="button" disabled={disabled} onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))} className={buttonClass("link", { size: "sm", dangerHover: true })}>เอาออก</button>
                </span>
              </div>
              <input value={b.title} onChange={(e) => update(b.id, { title: e.target.value })} disabled={disabled} aria-label="หัวข้อ" className="input-base w-full font-medium" />
              {b.kind === "terms" ? (
                <textarea value={b.body ?? ""} onChange={(e) => update(b.id, { body: e.target.value })} disabled={disabled} aria-label="ข้อความ" className="input-base h-28 w-full text-sm" />
              ) : (
                <div className="space-y-1.5">
                  {src(b.image_path) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private image
                    <img src={src(b.image_path)!} alt={b.caption ?? b.title} className="max-h-56 rounded border border-neutral-200 object-contain" />
                  ) : (
                    <p className="text-xs text-neutral-500">เปิดรูปไม่ได้</p>
                  )}
                  <input value={b.caption ?? ""} onChange={(e) => update(b.id, { caption: e.target.value })} disabled={disabled} maxLength={CAPTION_MAX}
                    placeholder="คำอธิบายรูป (ไม่ใส่ก็ได้)" aria-label="คำอธิบายรูป" className="input-base w-full text-sm" />
                </div>
              )}
            </li>
          ))}
        </ol>

        {readOnly === null && (
          <div className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3">
            <label className="text-sm text-neutral-700">อัปโหลดรูปของงานนี้
              <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value as "photo" | "diagram")} className="input-base ml-2" disabled={disabled || uploading}>
                <option value="photo">รูปภาพ</option>
                <option value="diagram">แผนผัง</option>
              </select>
            </label>
            <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="หัวข้อ เช่น ผังโต๊ะ" aria-label="หัวข้อของรูป"
              className="input-base w-48" disabled={disabled || uploading} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <button type="button" disabled={disabled || uploading || images >= SHEET_MAX_IMAGES} onClick={() => fileRef.current?.click()} className={buttonClass("secondary", { size: "sm" })}>
              {uploading ? "กำลังอัปโหลด…" : "เลือกไฟล์ (JPEG/PNG)"}
            </button>
            <span className="text-xs text-neutral-500">ย่อเหลือด้านยาว 1600 px ก่อนอัปโหลด; อัปโหลดแล้วลบไฟล์ไม่ได้ แต่เอาออกจากใบได้</span>
          </div>
        )}
      </section>

      {readOnly === null && (
        <section className="space-y-2 rounded-xl border border-neutral-300 bg-white p-4">
          <h2 className="font-heading text-base font-semibold text-neutral-900">เพิ่มจากคลัง</h2>
          {matching.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-brand-green">ตรงกับสถานที่ของงานนี้ ({venueNames.join(", ")})</h3>
              <ul className="divide-y divide-neutral-100">{matching.map(libraryRow)}</ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-neutral-600">{matching.length > 0 ? "อื่น ๆ ในคลัง" : "ในคลัง"}</h3>
              <ul className="divide-y divide-neutral-100">{others.map(libraryRow)}</ul>
            </>
          )}
          {matching.length === 0 && others.length === 0 && <p className="text-sm text-neutral-500">คลังยังว่าง — เจ้าของร้านหรือผู้จัดการเพิ่มได้ที่ ตั้งค่า › คลังรายละเอียดงาน</p>}
        </section>
      )}

      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" : "text-sm text-neutral-700"}>
          {message.text}
          {message.conflict && (
            <button type="button" className="ml-2 font-medium underline"
              onClick={() => { if (window.confirm("โหลดใบรายละเอียดงานฉบับล่าสุด — การแก้ไขบนหน้านี้ที่ยังไม่ได้บันทึกจะหายไป")) window.location.reload(); }}>
              โหลดข้อมูลล่าสุด
            </button>
          )}
        </p>
      )}

      {readOnly === null && (
        <div className="flex justify-end">
          <button type="button" disabled={disabled || !dirty} onClick={save} className={buttonClass("primary")}>
            {pending ? "กำลังบันทึก…" : dirty ? "บันทึก" : "บันทึกแล้ว"}
          </button>
        </div>
      )}
    </div>
  );
}
