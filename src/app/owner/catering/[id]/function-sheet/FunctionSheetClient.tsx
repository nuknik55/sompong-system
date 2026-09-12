"use client";

import type { CateringEvent, StaffOption } from "../../actions";
import type { SheetLine, SheetPackage, MoneyField } from "@/lib/function-sheet";
import {
  thFullDate, timeRange, locationLabel, fmtBaht, staffLabel,
} from "../../shared-utils";

// A section that reaches this component is a section WITH ROWS — groupBySection
// drops the empty ones — so there is no "no rows" branch to render here. That
// is the print contract: a section with no rows prints nothing at all.

/** A header field printed as "label : value", or as a ruled line for the
 *  service team to write on when the booking does not hold the answer. */
function HeaderField({ label, value, width }: { label: string; value: string | null; width?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flex: width ? undefined : 1, width }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <span
        style={{
          flex: 1,
          borderBottom: "1px dotted #555",
          minHeight: "1.3em",
          paddingLeft: "4px",
          // A value is the printed answer; a blank keeps the dotted rule so
          // the form stays writable on paper.
          fontWeight: value ? 600 : 400,
        }}
      >
        {value ?? " "}
      </span>
    </div>
  );
}

export function FunctionSheetClient({
  event,
  packages,
  extras,
  money,
  staffOptions,
  fontClass,
}: {
  event: CateringEvent;
  packages: SheetPackage[];
  extras: SheetLine[];
  money: MoneyField[];
  staffOptions: StaffOption[];
  /** Shared print face — ../print-font.ts. */
  fontClass: string;
}) {
  const staffById = new Map(staffOptions.map((s) => [s.id, s]));
  const assignedStaff = event.staff_ids.flatMap((id) => {
    const s = staffById.get(id);
    return s ? [staffLabel(s)] : [];
  });

  const venue =
    event.location_type === "in_house"
      ? locationLabel(event)
      : [event.offsite_address, event.offsite_distance_km != null ? `${event.offsite_distance_km} กม.` : null]
          .filter(Boolean)
          .join(" · ") || "นอกสถานที่";

  return (
    <>
      {/* Same print pattern as QuoteClient.tsx — narrow single-column A4 doc. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .fs-avoid-break { break-inside: avoid; }
        }
        @media screen {
          .fs-wrap { max-width: 760px; margin: 0 auto; }
        }
        .fs-wrap table { width: 100%; border-collapse: collapse; }
        .fs-wrap th, .fs-wrap td { border: 1px solid #333; padding: 5px 8px; }
        .fs-wrap th { font-weight: 600; }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
        <a href={`/owner/catering/${event.id}`} className="text-sm text-neutral-500 hover:text-neutral-800">← กลับ</a>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          พิมพ์
        </button>
      </div>

      <div
        className={`fs-wrap px-6 py-8 ${fontClass}`}
        style={{ fontSize: "15px", lineHeight: "1.65", color: "#000" }}
      >
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: "14px" }}>
          <div style={{ fontSize: "21px", fontWeight: "bold" }}>ใบฟังก์ชั่นงาน — ฝ่ายบริการ</div>
          <div style={{ fontSize: "12px" }}>เอกสารภายใน ไม่ใช่เอกสารสำหรับลูกค้า</div>
        </div>

        {/* Header — every field the paper form has, in its order. Anything the
            booking does not hold prints as a dotted rule to write on. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "7px", borderTop: "2px solid #000", borderBottom: "1px solid #000", padding: "12px 0", marginBottom: "14px" }}>
          <div style={{ display: "flex", gap: "20px" }}>
            <HeaderField label="ชื่อลูกค้า" value={event.customer_name} />
            <HeaderField label="ชื่อไลน์" value={event.customer_line_id} />
          </div>
          <div style={{ display: "flex", gap: "20px" }}>
            <HeaderField label="เบอร์โทร" value={event.customer_phone} />
            <HeaderField label="บริษัท" value={event.customer_company_name} />
          </div>
          <div style={{ display: "flex", gap: "20px" }}>
            <HeaderField label="วันที่จอง" value={thFullDate(event.created_at.slice(0, 10))} />
            <HeaderField label="วันที่จัดงาน" value={thFullDate(event.event_date)} />
          </div>
          <div style={{ display: "flex", gap: "20px" }}>
            <HeaderField label="เวลา" value={timeRange(event.start_time, event.end_time)} />
            <HeaderField label="สถานที่" value={venue} />
          </div>
          <div style={{ display: "flex", gap: "20px" }}>
            <HeaderField label="จำนวนแขก" value={event.guest_count != null ? `${event.guest_count} ท่าน` : null} />
            {/* ประเภทงาน (เลี้ยงสัมมนาบริษัท, งานแต่ง…) has no column on
                catering_events — booking_type is จองโต๊ะ/จองห้อง/จองงานจัดเลี้ยง,
                which is a different question — so it is always a ruled line. */}
            <HeaderField label="ประเภทงาน" value={null} />
          </div>
        </div>

        {/* The four money fields */}
        <div style={{ display: "flex", gap: "18px", marginBottom: "16px", flexWrap: "wrap" }}>
          {money.map((f) => (
            <HeaderField
              key={f.label}
              label={f.label}
              value={f.amount != null ? `฿${fmtBaht(f.amount)}` : null}
              width="calc(50% - 9px)"
            />
          ))}
        </div>

        {/* Food, by package. A package with no sections at all still prints its
            own line — the booking says it was ordered, and a service sheet
            that silently omitted it would be worse than one showing it empty. */}
        {packages.map((p) => (
          <div key={p.id} className="fs-avoid-break" style={{ marginBottom: "14px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
              {p.name}
              {p.quantity > 1 && <span style={{ fontWeight: 400 }}> × {p.quantity}</span>}
              {p.note && <span style={{ fontWeight: 400, fontSize: "13px" }}> — {p.note}</span>}
            </div>
            {p.groups.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#666", paddingLeft: "10px" }}>
                ยังไม่ได้กำหนดรายการอาหารในชุดนี้
              </div>
            ) : (
              p.groups.map((g) => (
                <div key={g.key} style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "2px" }}>{g.label}</div>
                  <table>
                    {/* Headed, as B is now — the same headerless-grid defect
                        B shipped with; a bordered grid with no headings
                        reads as an accident on paper. */}
                    <thead>
                      <tr style={{ background: "#f3f4f6" }}>
                        <th style={{ width: "6%", textAlign: "center" }}>ลำดับ</th>
                        <th style={{ textAlign: "left" }}>รายการ</th>
                        <th style={{ width: "12%", textAlign: "right" }}>จำนวน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((l, i) => (
                        <tr key={l.id}>
                          <td style={{ width: "6%", textAlign: "center" }}>{i + 1}</td>
                          <td>
                            {l.name}
                            {l.note && <div style={{ fontSize: "12px", color: "#555" }}>{l.note}</div>}
                          </td>
                          <td style={{ width: "12%", textAlign: "right" }}>{l.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        ))}

        {/* รายการเพิ่มเติม — dishes added to the booking outside any package. */}
        {extras.length > 0 && (
          <div className="fs-avoid-break" style={{ marginBottom: "14px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รายการเพิ่มเติม</div>
            <table>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ width: "6%", textAlign: "center" }}>ลำดับ</th>
                  <th style={{ textAlign: "left" }}>รายการ</th>
                  <th style={{ width: "12%", textAlign: "right" }}>จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {extras.map((l, i) => (
                  <tr key={l.id}>
                    <td style={{ width: "6%", textAlign: "center" }}>{i + 1}</td>
                    <td>
                      {l.name}
                      {l.note && <div style={{ fontSize: "12px", color: "#555" }}>{l.note}</div>}
                    </td>
                    <td style={{ width: "12%", textAlign: "right" }}>{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {packages.length === 0 && extras.length === 0 && (
          <div style={{ border: "1px solid #333", padding: "10px", textAlign: "center", color: "#666", marginBottom: "14px" }}>
            ยังไม่มีรายการอาหาร
          </div>
        )}

        {/* หมายเหตุ — the booking's own note. แจ้งครัว is NOT printed here: it
            is the kitchen's, and it goes on the kitchen function sheet. */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "3px" }}>หมายเหตุ</div>
          <div style={{ whiteSpace: "pre-wrap", borderBottom: "1px dotted #555", minHeight: "3em", paddingBottom: "2px" }}>
            {event.detail_note || " "}
          </div>
        </div>

        <div style={{ marginBottom: "20px", fontSize: "14px" }}>
          ผู้รับผิดชอบงาน: {assignedStaff.length > 0 ? assignedStaff.join(", ") : "—"}
        </div>

        {/* Signatures */}
        <div className="fs-avoid-break" style={{ display: "flex", justifyContent: "space-around", marginTop: "28px", gap: "24px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้ร่วมดำเนินการ</div>
            <div style={{ marginTop: "18px" }}>วันที่.........../.........../...........</div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้รับจองงาน</div>
            <div style={{ marginTop: "18px" }}>วันที่.........../.........../...........</div>
          </div>
        </div>
      </div>
    </>
  );
}
