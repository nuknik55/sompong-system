"use client";

import { useEffect, useRef, useState } from "react";
import { CAPTION_MAX, IMAGE_TYPES, PRINT_IMAGES_MAX } from "@/lib/event-sheet";

type Picked = { id: string; url: string; name: string; caption: string };

/**
 * IMAGES FOR ONE PRINT ONLY (Nik, 2026-09-24): photos or diagrams for this
 * booking alone, picked from the computer when printing, with a caption typed
 * for this print, up to 6. They are shown from the browser's own memory
 * (object URLs) and NEVER uploaded, sent or saved: this component makes no
 * request of any kind, and each object URL is released when its image is
 * taken off and when the page is left. They print where the sheet's images
 * go, after the library's.
 *
 * The controls and the notice are on screen only; the images and their
 * captions print.
 */
export function PrintImages() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The URLs alive now, for the release on leaving: state read in a cleanup
  // would be the first render's.
  const live = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = live.current;
    return () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); };
  }, []);

  function add(files: FileList | null) {
    setWarning(null);
    if (!files) return;
    const room = PRINT_IMAGES_MAX - picked.length;
    const usable = [...files].filter((f) => (IMAGE_TYPES as readonly string[]).includes(f.type));
    const warnings: string[] = [];
    if (usable.length < files.length) warnings.push("ข้ามไฟล์ที่ไม่ใช่ JPEG, PNG หรือ WebP");
    if (usable.length > room) warnings.push(`เลือกรูปได้ไม่เกิน ${PRINT_IMAGES_MAX} รูป — รับไว้ ${Math.max(room, 0)} รูปแรก`);
    setWarning(warnings.length > 0 ? warnings.join(" · ") : null);
    const next = usable.slice(0, Math.max(room, 0)).map((f) => {
      const url = URL.createObjectURL(f);
      live.current.add(url);
      return { id: crypto.randomUUID(), url, name: f.name, caption: "" };
    });
    setPicked((p) => [...p, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function remove(id: string) {
    setPicked((p) => {
      const gone = p.find((x) => x.id === id);
      if (gone) { URL.revokeObjectURL(gone.url); live.current.delete(gone.url); }
      return p.filter((x) => x.id !== id);
    });
  }

  return (
    <div>
      <style>{`
        .pi-print-only { display: none; }
        @media print { .pi-print-only { display: block; } .pi-screen-only { display: none !important; } .pi-figure { break-inside: avoid; } }
      `}</style>

      <div className="pi-screen-only no-print" style={{ border: "1px dashed #9ab264", borderRadius: "8px", padding: "10px 12px", margin: "8px 0 12px", fontFamily: "inherit" }}>
        <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รูปเฉพาะงานนี้ (เลือกจากเครื่อง)</div>
        <p style={{ fontSize: "13px", margin: "0 0 4px" }}>
          รูปที่เลือกจากเครื่องนี้ใช้สำหรับการพิมพ์ครั้งนี้เท่านั้น ระบบไม่ได้อัปโหลดหรือเก็บไว้ — ถ้าพิมพ์ใหม่ต้องเลือกรูปอีกครั้ง
        </p>
        <p style={{ fontSize: "13px", margin: "0 0 8px" }}>
          แนะนำ: ในหน้าต่างพิมพ์ ให้เลือกปลายทางเป็น “บันทึกเป็น PDF” (Save as PDF) เพื่อเก็บสำเนาพร้อมรูปไว้ และส่งให้ลูกค้าได้
        </p>
        <p style={{ fontSize: "12px", margin: "0 0 8px", color: "#555" }}>
          รูปที่เลือกจะหายไปเมื่อออกจากหน้านี้หรือโหลดหน้าใหม่
        </p>
        <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} multiple style={{ display: "none" }}
          onChange={(e) => add(e.target.files)} aria-label="เลือกรูปจากเครื่อง" />
        <button type="button" disabled={picked.length >= PRINT_IMAGES_MAX} onClick={() => fileRef.current?.click()}
          style={{ border: "1px solid #8a8a8a", borderRadius: "6px", padding: "4px 12px", background: "#fff", cursor: "pointer" }}>
          เลือกรูปจากเครื่อง ({picked.length}/{PRINT_IMAGES_MAX})
        </button>
        {warning && <p role="alert" style={{ fontSize: "13px", color: "#b42318", margin: "6px 0 0" }}>{warning}</p>}
      </div>

      {picked.map((p) => (
        <figure key={p.id} className="pi-figure" style={{ margin: "0 0 12px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- an object URL from this browser's memory, never a network image */}
          <img src={p.url} alt={p.caption || p.name} style={{ display: "block", maxWidth: "100%", maxHeight: "120mm", objectFit: "contain", margin: "0 auto" }} />
          <div className="pi-screen-only no-print" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <input value={p.caption} maxLength={CAPTION_MAX} placeholder="คำอธิบายรูป (สำหรับการพิมพ์ครั้งนี้)" aria-label={`คำอธิบายรูป ${p.name}`}
              onChange={(e) => setPicked((all) => all.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))}
              style={{ flex: 1, border: "1px solid #8a8a8a", borderRadius: "6px", padding: "3px 8px", fontSize: "13px" }} />
            <button type="button" onClick={() => remove(p.id)} style={{ border: "none", background: "none", color: "#b42318", cursor: "pointer", fontSize: "13px" }}>เอาออก</button>
          </div>
          {p.caption.trim() && <figcaption className="pi-print-only" style={{ fontSize: "13px", textAlign: "center", marginTop: "3px" }}>{p.caption.trim()}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
