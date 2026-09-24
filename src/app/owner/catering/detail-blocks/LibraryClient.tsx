"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import {
  BLOCK_BODY_MAX, BLOCK_KINDS, BLOCK_KIND_LABEL, parseVenueTags, type BlockKind, type LibraryBlock,
} from "@/lib/event-sheet";
import { uploadDetailImage } from "../detail-image";
import { deleteLibraryBlock, saveLibraryBlock } from "./actions";

type Draft = { id: string | null; kind: BlockKind; title: string; body: string; image_path: string | null; tags: string; sort_order: string };

const EMPTY: Draft = { id: null, kind: "terms", title: "", body: "", image_path: null, tags: "", sort_order: "0" };

export function LibraryClient({ blocks, usage, urls, suggestions }: {
  blocks: LibraryBlock[];
  usage: Record<string, number>;
  urls: Record<string, string>;
  suggestions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (b: LibraryBlock | null) => {
    setMessage(null);
    setLocalUrl(null);
    setDraft(b ? { id: b.id, kind: b.kind, title: b.title, body: b.body ?? "", image_path: b.image_path, tags: b.venue_tags.join(", "), sort_order: String(b.sort_order) } : EMPTY);
  };

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const path = await uploadDetailImage(file, { library: true });
      setLocalUrl(URL.createObjectURL(file));
      setDraft((d) => (d ? { ...d, image_path: path } : d));
    } catch (err) {
      setMessage({ error: true, text: err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    if (!draft) return;
    const sort = Number(draft.sort_order);
    startTransition(async () => {
      try {
        const r = await saveLibraryBlock(draft.id, {
          kind: draft.kind, title: draft.title, body: draft.kind === "terms" ? draft.body : null,
          image_path: draft.kind === "terms" ? null : draft.image_path,
          venue_tags: parseVenueTags(draft.tags), sort_order: Number.isInteger(sort) ? sort : 0,
        });
        if (r.error) { setMessage({ error: true, text: r.error }); return; }
        setDraft(null);
        setMessage({ error: false, text: "บันทึกแล้ว" });
        router.refresh();
      } catch {
        setMessage({ error: true, text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  }

  function remove(b: LibraryBlock) {
    if (!window.confirm(`ลบ “${b.title}” ออกจากคลัง?`)) return;
    startTransition(async () => {
      const r = await deleteLibraryBlock(b.id);
      if (r.error) { setMessage({ error: true, text: r.error }); return; }
      setMessage({ error: false, text: "ลบแล้ว" });
      router.refresh();
    });
  }

  const preview = draft?.image_path ? localUrl ?? urls[draft.image_path] ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/owner/catering/settings", label: "ตั้งค่าจัดเลี้ยง" }}
        title="คลังรายละเอียดงาน"
        subtitle={<span>ข้อตกลง รูปห้อง และแผนผัง สำหรับใบรายละเอียดงานที่แนบกับใบเสนอราคา — งานที่เลือกไปแล้วเก็บฉบับของตัวเอง แก้ที่นี่ไม่กระทบงานเดิม</span>}
        actions={<button type="button" onClick={() => open(null)} className={buttonClass("primary")}>+ เพิ่มหัวข้อ</button>}
      />

      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" : "text-sm text-neutral-700"}>{message.text}</p>}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {blocks.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-500">คลังยังว่าง</p>}
        <ul className="divide-y divide-neutral-100">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-start gap-3 px-4 py-3">
              {b.image_path && urls[b.image_path] ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private image
                <img src={urls[b.image_path]} alt="" className="h-16 w-24 flex-none rounded border border-neutral-200 object-cover" />
              ) : (
                <span className="flex h-16 w-24 flex-none items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-xs text-neutral-500">{BLOCK_KIND_LABEL[b.kind]}</span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium text-neutral-800">{b.title} <span className="text-xs font-normal text-neutral-500">· {BLOCK_KIND_LABEL[b.kind]}</span></div>
                {b.body && <p className="line-clamp-2 text-xs text-neutral-600">{b.body}</p>}
                <p className="text-xs text-neutral-500">
                  {b.venue_tags.length > 0 ? `สถานที่: ${b.venue_tags.join(" · ")}` : "ไม่ระบุสถานที่ (แสดงในกลุ่มอื่น ๆ)"}
                  {(usage[b.id] ?? 0) > 0 && ` · ใช้ใน ${usage[b.id]} งาน`}
                </p>
              </div>
              <div className="flex flex-none gap-2">
                <button type="button" onClick={() => open(b)} disabled={pending} className={buttonClass("link", { size: "sm" })}>แก้ไข</button>
                <button type="button" onClick={() => remove(b)} disabled={pending || (usage[b.id] ?? 0) > 0}
                  title={(usage[b.id] ?? 0) > 0 ? "มีงานใช้หัวข้อนี้อยู่ จึงลบไม่ได้" : undefined}
                  className={buttonClass("link", { size: "sm", dangerHover: true })}>ลบ</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={draft.id ? "แก้ไขหัวข้อ" : "เพิ่มหัวข้อ"}>
          <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-heading text-lg font-semibold text-neutral-900">{draft.id ? "แก้ไขหัวข้อ" : "เพิ่มหัวข้อ"}</h2>
            <label className="block text-sm text-neutral-700">ชนิด
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as BlockKind })} className="input-base mt-1 block w-full">
                {BLOCK_KINDS.map((k) => <option key={k} value={k}>{BLOCK_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block text-sm text-neutral-700">หัวข้อ
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="input-base mt-1 block w-full" />
            </label>
            {draft.kind === "terms" ? (
              <label className="block text-sm text-neutral-700">ข้อความ
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} maxLength={BLOCK_BODY_MAX} className="input-base mt-1 block h-40 w-full" />
              </label>
            ) : (
              <div className="space-y-2 text-sm text-neutral-700">
                <div>รูป (JPEG/PNG ย่อเหลือด้านยาว 1600 px)</div>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link or a local preview
                  <img src={preview} alt="" className="max-h-48 rounded border border-neutral-200 object-contain" />
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className={buttonClass("secondary", { size: "sm" })}>
                  {uploading ? "กำลังอัปโหลด…" : draft.image_path ? "เปลี่ยนรูป" : "เลือกไฟล์"}
                </button>
                {draft.id && draft.image_path && <p className="text-xs text-neutral-500">เปลี่ยนรูปแล้ว งานที่ใช้รูปเดิมยังเห็นรูปเดิม</p>}
              </div>
            )}
            <label className="block text-sm text-neutral-700">ใช้กับสถานที่ (คั่นด้วยจุลภาค)
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} list="venue-suggestions" placeholder="เช่น ห้อง V1, แอร์รวม" className="input-base mt-1 block w-full" />
              <datalist id="venue-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
              <span className="mt-1 block text-xs text-neutral-500">พิมพ์ชื่อสถานที่ได้อิสระ ตรงกับชื่อห้องของงาน (เช่น {suggestions.slice(0, 3).join(", ")}) จะขึ้นเป็นอันดับแรก</span>
            </label>
            <label className="block text-sm text-neutral-700">ลำดับในคลัง
              <input value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} inputMode="numeric" className="input-base mt-1 block w-24" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className={buttonClass("secondary")}>ยกเลิก</button>
              <button type="button" disabled={pending || uploading} onClick={save} className={buttonClass("primary")}>บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
