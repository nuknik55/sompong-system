"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { thaiDate } from "@/lib/thai-date";
import {
  CAPTION_MAX, SHEET_NOTES_MAX, blockProblem, captionProblem, printedCaption, sheetNoteLines,
  type LibraryBlock, type LibraryImage, type SheetBlock, type SheetImage,
} from "@/lib/event-sheet";
import { saveEventSheet } from "./actions";

type Split<T> = { matching: T[]; others: T[] };

export function DetailsClient({
  eventId, token: initialToken, notes: initialNotes, blocks: initialBlocks, images: initialImages,
  terms, library, venueNames, urls, readOnly, customerName, eventDate,
}: {
  eventId: string;
  token: string;
  notes: string;
  blocks: SheetBlock[];
  images: SheetImage[];
  /** The terms library, this booking's venue first. */
  terms: Split<LibraryBlock>;
  /** The image library, this booking's venue first. */
  library: Split<LibraryImage>;
  venueNames: string[];
  /** Signed links for the library's images, by stored path. */
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
  const [images, setImages] = useState<SheetImage[]>(initialImages);
  const [saved, setSaved] = useState(() => JSON.stringify([initialNotes, initialBlocks, initialImages]));
  const [message, setMessage] = useState<{ error: boolean; text: string; conflict?: boolean } | null>(null);

  const snapshot = JSON.stringify([notes, blocks, images]);
  const dirty = snapshot !== saved;
  const disabled = readOnly !== null || pending;
  const imageById = useMemo(() => new Map([...library.matching, ...library.others].map((g) => [g.id, g])), [library]);
  const pickedBlocks = new Set(blocks.map((b) => b.block_id));
  const pickedImages = new Set(images.map((g) => g.image_id));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function moveIn<T>(list: T[], index: number, by: -1 | 1): T[] {
    const j = index + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  }

  function save() {
    for (const b of blocks) {
      const problem = blockProblem(b);
      if (problem) { setMessage({ error: true, text: problem }); return; }
    }
    for (const g of images) {
      const problem = captionProblem(g.caption);
      if (problem) { setMessage({ error: true, text: problem }); return; }
    }
    setMessage(null);
    // What is SENT becomes "saved": an edit made while the save runs stays unsaved.
    const sent = snapshot;
    startTransition(async () => {
      try {
        const r = await saveEventSheet(eventId, token, { notes, blocks, images });
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

  const venueHeading = (split: { matching: unknown[] }) =>
    split.matching.length > 0 ? `ตรงกับสถานที่ของงานนี้ (${venueNames.join(", ")})` : null;

  const termRow = (lib: LibraryBlock) => (
    <li key={lib.id} className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-neutral-800">{lib.title}</div>
        <p className="line-clamp-2 text-xs text-neutral-600">{lib.body}</p>
        {lib.venue_tags.length > 0 && <p className="text-xs text-neutral-500">{lib.venue_tags.join(" · ")}</p>}
      </div>
      <button type="button" disabled={disabled || pickedBlocks.has(lib.id)} className={buttonClass("secondary", { size: "sm" })}
        onClick={() => setBlocks((bs) => [...bs, { id: crypto.randomUUID(), block_id: lib.id, title: lib.title, body: lib.body }])}>
        {pickedBlocks.has(lib.id) ? "เพิ่มแล้ว" : "+ เพิ่ม"}
      </button>
    </li>
  );

  const imageRow = (lib: LibraryImage) => (
    <li key={lib.id} className="flex items-start gap-3 py-2">
      {urls[lib.image_path] ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private library image
        <img src={urls[lib.image_path]} alt="" className="h-14 w-20 flex-none rounded border border-neutral-200 object-cover" />
      ) : (
        <span className="flex h-14 w-20 flex-none items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">ไม่มีรูป</span>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-neutral-800">{lib.name}</div>
        {lib.caption && <p className="line-clamp-2 text-xs text-neutral-600">{lib.caption}</p>}
        {lib.venue_tags.length > 0 && <p className="text-xs text-neutral-500">{lib.venue_tags.join(" · ")}</p>}
      </div>
      <button type="button" disabled={disabled || pickedImages.has(lib.id)} className={buttonClass("secondary", { size: "sm" })}
        onClick={() => setImages((gs) => [...gs, { id: crypto.randomUUID(), image_id: lib.id, caption: null }])}>
        {pickedImages.has(lib.id) ? "เพิ่มแล้ว" : "+ เพิ่ม"}
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
        <h2 className="font-heading text-base font-semibold text-neutral-900">ข้อตกลง / เงื่อนไขบนใบรายละเอียดงาน</h2>
        {blocks.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มีหัวข้อ — เพิ่มจากคลังด้านล่าง</p>}
        <ol className="space-y-3">
          {blocks.map((b, i) => (
            <li key={b.id} className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                <span>จากคลัง — แก้ที่นี่เปลี่ยนเฉพาะงานนี้</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" disabled={disabled || i === 0} onClick={() => setBlocks((bs) => moveIn(bs, i, -1))} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนขึ้น">▲</button>
                  <button type="button" disabled={disabled || i === blocks.length - 1} onClick={() => setBlocks((bs) => moveIn(bs, i, 1))} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนลง">▼</button>
                  <button type="button" disabled={disabled} onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))} className={buttonClass("link", { size: "sm", dangerHover: true })}>เอาออก</button>
                </span>
              </div>
              <input value={b.title} disabled={disabled} aria-label="หัวข้อ" className="input-base w-full font-medium"
                onChange={(e) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, title: e.target.value } : x)))} />
              <textarea value={b.body} disabled={disabled} aria-label="ข้อความ" className="input-base h-28 w-full text-sm"
                onChange={(e) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, body: e.target.value } : x)))} />
            </li>
          ))}
        </ol>
        {readOnly === null && (
          <div className="space-y-1 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-semibold text-neutral-800">เพิ่มจากคลังข้อตกลง</h3>
            {venueHeading(terms) && <p className="text-xs font-semibold text-brand-green">{venueHeading(terms)}</p>}
            <ul className="divide-y divide-neutral-100">{terms.matching.map(termRow)}</ul>
            {terms.others.length > 0 && <p className="text-xs font-semibold text-neutral-600">{terms.matching.length > 0 ? "อื่น ๆ ในคลัง" : "ในคลัง"}</p>}
            <ul className="divide-y divide-neutral-100">{terms.others.map(termRow)}</ul>
            {terms.matching.length + terms.others.length === 0 && <p className="text-sm text-neutral-500">คลังข้อตกลงยังว่าง — เจ้าของร้านหรือผู้จัดการเพิ่มได้ที่ ตั้งค่าจัดเลี้ยง › คลังรายละเอียดงาน</p>}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="font-heading text-base font-semibold text-neutral-900">รูปจากคลังรูป</h2>
        <p className="text-xs text-neutral-600">รูปห้องและผังโต๊ะจากคลัง บันทึกไว้กับงานนี้ พิมพ์ซ้ำได้ — รูปเฉพาะงานนี้ให้เลือกจากเครื่องตอนพิมพ์ (ระบบไม่เก็บไว้)</p>
        {images.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มีรูปจากคลัง</p>}
        <ol className="space-y-3">
          {images.map((g, i) => {
            const lib = imageById.get(g.image_id);
            return (
              <li key={g.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-neutral-200 p-3">
                {lib && urls[lib.image_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private library image
                  <img src={urls[lib.image_path]} alt={lib.name} className="h-24 w-36 flex-none rounded border border-neutral-200 object-contain" />
                ) : (
                  <span className="flex h-24 w-36 flex-none items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">เปิดรูปไม่ได้</span>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-neutral-800">{lib?.name ?? "รูปในคลัง"}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" disabled={disabled || i === 0} onClick={() => setImages((gs) => moveIn(gs, i, -1))} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนขึ้น">▲</button>
                      <button type="button" disabled={disabled || i === images.length - 1} onClick={() => setImages((gs) => moveIn(gs, i, 1))} className={buttonClass("link", { size: "sm" })} aria-label="เลื่อนลง">▼</button>
                      <button type="button" disabled={disabled} onClick={() => setImages((gs) => gs.filter((x) => x.id !== g.id))} className={buttonClass("link", { size: "sm", dangerHover: true })}>เอาออก</button>
                    </span>
                  </div>
                  <input value={g.caption ?? ""} disabled={disabled} maxLength={CAPTION_MAX} aria-label="คำอธิบายรูปสำหรับงานนี้"
                    placeholder={lib?.caption ? `ค่าเดิม: ${lib.caption}` : "คำอธิบายรูป (ไม่ใส่ก็ได้)"}
                    onChange={(e) => setImages((gs) => gs.map((x) => (x.id === g.id ? { ...x, caption: e.target.value === "" ? null : e.target.value } : x)))}
                    className="input-base w-full text-sm" />
                  <p className="text-xs text-neutral-500">พิมพ์ว่า: {printedCaption(g.caption, lib?.caption ?? null) ?? "(ไม่มีคำอธิบาย)"}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {readOnly === null && (
          <div className="space-y-1 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-semibold text-neutral-800">เพิ่มจากคลังรูป</h3>
            {venueHeading(library) && <p className="text-xs font-semibold text-brand-green">{venueHeading(library)}</p>}
            <ul className="divide-y divide-neutral-100">{library.matching.map(imageRow)}</ul>
            {library.others.length > 0 && <p className="text-xs font-semibold text-neutral-600">{library.matching.length > 0 ? "อื่น ๆ ในคลัง" : "ในคลัง"}</p>}
            <ul className="divide-y divide-neutral-100">{library.others.map(imageRow)}</ul>
            {library.matching.length + library.others.length === 0 && <p className="text-sm text-neutral-500">คลังรูปยังว่าง — เจ้าของร้านหรือผู้จัดการเพิ่มได้ที่ ตั้งค่าจัดเลี้ยง › คลังรายละเอียดงาน</p>}
          </div>
        )}
      </section>

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
