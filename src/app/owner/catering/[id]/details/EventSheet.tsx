// Deliberately NOT "use client": no hooks. The quotation page (server)
// renders it as the pages after the quotation, and the sheet's own print page
// renders it alone; both from this one body.
import { BLOCK_KIND_LABEL } from "@/lib/event-sheet";
import { DocHeader, INKG, RULE } from "../doc-header";
import type { SheetContent } from "./sheet-data";

const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, ""));

/**
 * ใบรายละเอียดงาน, the event-details sheet (Nik, 2026-09-24), as it prints:
 * the quotation's header, the food (a set's dishes by section, then the food
 * ordered outside a set), รายการแถมฟรี, the job notes numbered, and the blocks
 * picked from the library — terms text, room photos, layout diagrams — each
 * kept whole on a page. No price, no cost, no kitchen note.
 */
export function EventSheet({ content, fontClass }: { content: SheetContent; fontClass: string }) {
  const { event, settings, sets, extras, free, notes, blocks } = content;
  const heading = { fontWeight: "bold", color: INKG, marginBottom: "4px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;
  const box = { marginBottom: "12px" } as const;
  return (
    <div className={`sheet-wrap px-6 py-8 ${fontClass}`} style={{ fontSize: "15px", lineHeight: "1.5", color: "#000" }}>
      <style>{`
        @media screen { .sheet-wrap { max-width: 760px; margin: 0 auto; } }
        @media print { .sheet-wrap { padding: 0 !important; } .sheet-block { break-inside: avoid; } }
      `}</style>

      <DocHeader settings={settings} event={event} title="รายละเอียดงาน" />

      {(sets.length > 0 || extras.length > 0) && (
        <div style={box}>
          <div style={heading}>รายการอาหาร</div>
          {sets.map((s, i) => (
            <div key={`${s.name}-${i}`} className="sheet-block" style={{ border: `1px solid ${RULE}`, padding: "6px 10px", marginBottom: "6px" }}>
              <div style={{ fontWeight: "bold" }}>{s.name} <span style={{ fontWeight: "normal" }}>({qty(s.quantity)} โต๊ะ)</span></div>
              {s.sections.map((sec) => (
                <div key={sec.label} style={{ marginTop: "2px" }}>
                  <span style={{ color: INKG, fontWeight: 500 }}>{sec.label}: </span>
                  {sec.dishes.join(" · ")}
                </div>
              ))}
            </div>
          ))}
          {extras.length > 0 && (
            <div className="sheet-block" style={{ border: `1px solid ${RULE}`, padding: "6px 10px" }}>
              <div style={{ fontWeight: "bold" }}>อาหารสั่งเพิ่ม</div>
              <div>{extras.map((x) => (x.quantity === 1 ? x.name : `${x.name} × ${qty(x.quantity)}`)).join(" · ")}</div>
            </div>
          )}
        </div>
      )}

      {free.length > 0 && (
        <div className="sheet-block" style={box}>
          <div style={heading}>รายการแถมฟรี</div>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {free.map((f, i) => <li key={`${f}-${i}`}>{f}</li>)}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <div className="sheet-block" style={box}>
          <div style={heading}>รายละเอียดเพิ่มเติม</div>
          <ol style={{ margin: 0, paddingLeft: "22px" }}>
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ol>
        </div>
      )}

      {blocks.map((b) => (
        <div key={b.id} className="sheet-block" style={box}>
          <div style={heading}>{b.title}</div>
          {b.kind === "terms" ? (
            <div style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>{b.body}</div>
          ) : b.url ? (
            <figure style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private image; next/image would proxy it */}
              <img src={b.url} alt={b.caption ?? b.title} style={{ display: "block", maxWidth: "100%", maxHeight: "120mm", objectFit: "contain", margin: "0 auto" }} />
              {b.caption && <figcaption style={{ fontSize: "13px", textAlign: "center", marginTop: "3px" }}>{b.caption}</figcaption>}
            </figure>
          ) : (
            <div style={{ fontSize: "13px", color: "#666" }}>({BLOCK_KIND_LABEL[b.kind]} — เปิดรูปไม่ได้)</div>
          )}
        </div>
      ))}

      {sets.length === 0 && extras.length === 0 && free.length === 0 && notes.length === 0 && blocks.length === 0 && (
        <p style={{ color: "#666", textAlign: "center" }}>ยังไม่มีรายละเอียดงาน</p>
      )}
    </div>
  );
}
