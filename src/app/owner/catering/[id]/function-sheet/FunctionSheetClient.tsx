"use client";

import type { CateringEvent, StaffOption } from "../../actions";
import {
  thFullDate, timeRange, locationLabel, fmtBaht, staffLabel,
  MUSIC_TYPE_LABEL,
} from "../../shared-utils";

export type FunctionSheetItem = {
  id: string;
  name: string;
  quantity: number;
  /** null when this item predates the event_menu_id ↔ charge link — shown as "-", not ฿0.00. */
  unit_price: number | null;
  note: string | null;
};

export function FunctionSheetClient({
  event,
  items,
  staffOptions,
}: {
  event: CateringEvent;
  items: FunctionSheetItem[];
  staffOptions: StaffOption[];
}) {
  const staffById = new Map(staffOptions.map((s) => [s.id, s]));
  const assignedStaff = event.staff_ids.map((id) => {
    const s = staffById.get(id);
    return s ? staffLabel(s) : "?";
  });

  return (
    <>
      {/* Same print pattern as QuoteClient.tsx — narrow single-column A4 doc. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm 20mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        @media screen {
          .fs-wrap { max-width: 720px; margin: 0 auto; }
        }
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
        className="fs-wrap px-6 py-8"
        style={{ fontFamily: "'Sarabun', 'TH SarabunNew', 'Angsana New', Arial, sans-serif", fontSize: "15px", lineHeight: "1.7", color: "#000" }}
      >
        {/* Title + reference */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", borderBottom: "2px solid #000", paddingBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: "bold" }}>ใบฟังก์ชั่นงาน</div>
            <div style={{ fontSize: "13px" }}>เอกสารภายใน — สำหรับครัว/บริการ ไม่ใช่เอกสารสำหรับลูกค้า</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "13px" }}>
            <div>อ้างอิงใบเสนอราคา {event.quote_number ?? "ยังไม่ออกใบเสนอราคา"}</div>
            <div>วันที่จอง {thFullDate(event.created_at.slice(0, 10))}</div>
            <div>วันที่จัดงาน {thFullDate(event.event_date)}</div>
          </div>
        </div>

        {/* Customer + venue */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "16px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>ลูกค้า</div>
            <div>{event.customer_name ?? "-"}</div>
            {event.customer_company_name && <div>{event.customer_company_name}</div>}
            {event.customer_contact_person && <div>ผู้ติดต่อ: {event.customer_contact_person}</div>}
            {event.customer_phone && <div>โทร. {event.customer_phone}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>สถานที่</div>
            {event.location_type === "in_house" ? (
              <div>{locationLabel(event)}</div>
            ) : (
              <>
                <div>นอกสถานที่</div>
                {event.offsite_address && <div>{event.offsite_address}</div>}
                {event.offsite_distance_km != null && <div>ระยะทาง {event.offsite_distance_km} กม.</div>}
                {event.floor_level != null && <div>ชั้น {event.floor_level}</div>}
              </>
            )}
            <div>เวลา {timeRange(event.start_time, event.end_time)}</div>
          </div>
        </div>

        {/* Counts */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "16px", fontSize: "14px" }}>
          <div>จำนวนโต๊ะ: {event.table_count ?? "-"}{event.reserve_tables ? ` (+${event.reserve_tables} สำรอง)` : ""}</div>
          {event.table_label && <div>หมายเลขโต๊ะ: {event.table_label}</div>}
          <div>จำนวนแขก: {event.guest_count ?? "-"} ท่าน</div>
        </div>

        {/* Food items */}
        <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รายการอาหาร</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "16px" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "left" }}>รายการ</th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", width: "12%" }}>จำนวน</th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", width: "18%" }}>ราคาต่อหน่วย</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ border: "1px solid #333", padding: "10px", textAlign: "center", color: "#888" }}>
                  ยังไม่มีรายการอาหาร
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id}>
                  <td style={{ border: "1px solid #333", padding: "6px 10px" }}>
                    {it.name}
                    {it.note && <div style={{ fontSize: "12px", color: "#555" }}>{it.note}</div>}
                  </td>
                  <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right" }}>{it.quantity}</td>
                  <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right" }}>
                    {it.unit_price != null ? fmtBaht(it.unit_price) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Music/drinks + deposit */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "16px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>ดนตรี/เครื่องดื่ม</div>
            <div>{MUSIC_TYPE_LABEL[event.music_type] ?? event.music_type}</div>
            {event.music_note && <div>{event.music_note}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>เงินมัดจำ</div>
            <div>{event.deposit_amount != null ? `฿${fmtBaht(event.deposit_amount)}` : "ยังไม่รับมัดจำ"}</div>
            {event.deposit_paid_at && <div>รับเมื่อ {thFullDate(event.deposit_paid_at)}</div>}
          </div>
        </div>

        {/* Staff */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>ผู้รับผิดชอบงาน</div>
          <div>{assignedStaff.length > 0 ? assignedStaff.join(", ") : "-"}</div>
        </div>

        {/* Notes — kept separate and clearly labeled, never merged into one block */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รายละเอียดเพิ่มเติม</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{event.detail_note || "-"}</div>
        </div>
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>แจ้งครัว</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{event.kitchen_note || "-"}</div>
        </div>

        {/* Signatures */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "32px", gap: "24px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้รับจองงาน</div>
            <div style={{ marginTop: "20px" }}>วันที่.........../.........../...........</div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้ร่วมดำเนินการ</div>
            <div style={{ marginTop: "20px" }}>วันที่.........../.........../...........</div>
          </div>
        </div>
      </div>
    </>
  );
}
