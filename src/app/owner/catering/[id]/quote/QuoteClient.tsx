"use client";

import type { CateringEvent, CateringCharge, CateringSettings } from "../../actions";
import { thFullDate, timeRange, locationLabel, fmtBaht } from "../../shared-utils";

export function QuoteClient({
  event,
  charges,
  settings,
}: {
  event: CateringEvent;
  charges: CateringCharge[];
  settings: CateringSettings | null;
}) {
  const total = charges.reduce((s, c) => s + c.amount, 0);
  const quotedDate = event.quoted_at ? thFullDate(event.quoted_at.slice(0, 10)) : "-";

  return (
    <>
      {/* @page reused as-is from ReceiptClient.tsx / PLPrintClient.tsx: this
          table is narrow (label/quantity/unit price/amount, 4 columns), the
          same shape those two were sized for. TransferSlipClient's tighter
          10mm/12mm margins exist only for its much wider per-day columns —
          not needed here. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm 20mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        @media screen {
          .quote-wrap { max-width: 720px; margin: 0 auto; }
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
        className="quote-wrap px-6 py-8"
        style={{ fontFamily: "'Sarabun', 'TH SarabunNew', 'Angsana New', Arial, sans-serif", fontSize: "15px", lineHeight: "1.7", color: "#000" }}
      >
        {/* Company header + quote meta */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", borderBottom: "2px solid #000", paddingBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "20px", fontWeight: "bold" }}>{settings?.company_name ?? "-"}</div>
            {settings?.address && <div style={{ fontSize: "13px" }}>{settings.address}</div>}
            <div style={{ fontSize: "13px" }}>
              {settings?.tax_id && `เลขประจำตัวผู้เสียภาษี ${settings.tax_id}`}
              {settings?.tax_id && settings?.phone ? "   " : ""}
              {settings?.phone && `โทร. ${settings.phone}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22px", fontWeight: "bold" }}>ใบเสนอราคา</div>
            <div style={{ fontSize: "13px" }}>เลขที่ {event.quote_number}</div>
            {event.quote_revision > 0 && <div style={{ fontSize: "13px" }}>แก้ไขครั้งที่ {event.quote_revision}</div>}
            <div style={{ fontSize: "13px" }}>วันที่ {quotedDate}</div>
          </div>
        </div>

        {/* Customer + event info */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "16px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>เรียน</div>
            <div>{event.customer_name ?? "-"}</div>
            {event.customer_contact_person && <div>ผู้ติดต่อ: {event.customer_contact_person}</div>}
            {event.customer_phone && <div>โทร. {event.customer_phone}</div>}
            {event.customer_address && <div>{event.customer_address}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รายละเอียดงาน</div>
            <div>วันที่จัดงาน {thFullDate(event.event_date)}</div>
            <div>เวลา {timeRange(event.start_time, event.end_time)}</div>
            <div>สถานที่ {event.location_type === "in_house" ? locationLabel(event) : (event.offsite_address || "นอกสถานที่")}</div>
            {event.guest_count != null && <div>จำนวนแขก {event.guest_count} ท่าน</div>}
          </div>
        </div>

        {/* Line items */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "left" }}>รายการ</th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", width: "10%" }}>จำนวน</th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", width: "18%" }}>ราคาต่อหน่วย</th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", width: "18%" }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td style={{ border: "1px solid #333", padding: "6px 10px" }}>
                  {c.label}
                  {c.note && <div style={{ fontSize: "12px", color: "#555" }}>{c.note}</div>}
                </td>
                <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right" }}>{c.quantity}</td>
                <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right" }}>{fmtBaht(c.unit_price)}</td>
                <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right" }}>{fmtBaht(c.amount)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ border: "1px solid #333", padding: "8px 10px", textAlign: "right", fontWeight: "bold" }}>
                รวมทั้งหมด
              </td>
              <td style={{ border: "1px solid #333", padding: "8px 10px", textAlign: "right", fontWeight: "bold" }}>
                {fmtBaht(total)} บาท
              </td>
            </tr>
          </tbody>
        </table>

        {/*
          DRAFT WORDING — not copied from any real Sompong policy document;
          no such text was ever supplied. This is generic quotation
          boilerplate (validity period / deposit % / cancellation policy)
          drafted to fill the section the user asked for. Flagged prominently
          in the chat response too — must be reviewed and edited by the
          business owner before this is used on a real customer-facing quote.
        */}
        <div style={{ fontSize: "13px", marginBottom: "20px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>เงื่อนไข</div>
          <div>1. ใบเสนอราคานี้มีอายุ 30 วันนับจากวันที่ออกเอกสาร</div>
          <div>2. กรุณาชำระเงินมัดจำ 50% ของยอดรวมทั้งหมดเพื่อยืนยันการจอง ส่วนที่เหลือชำระในวันงาน</div>
          <div>3. หากยกเลิกงานก่อนวันงานน้อยกว่า 7 วัน ขอสงวนสิทธิ์ไม่คืนเงินมัดจำ</div>
        </div>

        {/* Bank details */}
        {(settings?.bank_name || settings?.bank_account_number) && (
          <div style={{ fontSize: "13px", marginBottom: "24px", border: "1px solid #ccc", padding: "10px 14px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>ชำระเงินโอนเข้าบัญชี</div>
            <div>
              {settings?.bank_name}
              {settings?.bank_account_name ? ` ชื่อบัญชี ${settings.bank_account_name}` : ""}
            </div>
            {settings?.bank_account_number && <div>เลขที่บัญชี {settings.bank_account_number}</div>}
          </div>
        )}

        {/* Signatures */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "32px", gap: "24px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้เสนอราคา</div>
            <div style={{ marginTop: "20px" }}>วันที่.........../.........../...........</div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้อนุมัติ/ลูกค้า</div>
            <div style={{ marginTop: "20px" }}>วันที่.........../.........../...........</div>
          </div>
        </div>
      </div>
    </>
  );
}
