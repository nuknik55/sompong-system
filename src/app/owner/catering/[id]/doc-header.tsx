// Deliberately NOT "use client": no hooks, so the quotation (a client
// component) and the event-details sheet (rendered by server pages) print
// the SAME header from one body (Nik, 2026-09-24: "its header is the
// quotation's header"). Moved out of QuoteClient.tsx verbatim. No cost in its
// imports (menu-card/cost-isolation.test.ts walks the sheet through it).
import { thFullDate, timeRange } from "../doc-dates";
import { locationLabel } from "../location";

/**
 * The greens of Nik's printed quotation, matched to the paper after he
 * rejected the first cut ("ทำไม่สวยเลย สีก็เข้มไป" — #1f7a45 was far darker
 * than the paper's soft olive/sage band). One family, three roles:
 *   BAND   the table head, white on sage — the paper's #8fae5d..#a3b86c range
 *   RULE   table borders and the letterhead rule, a paler tint of the same
 *          hue so the grid reads airy, not gridded
 *   INKG   the green used for TEXT (company name, section labels) — darker
 *          than BAND because text needs the contrast the band does not
 * White on sage is LOW contrast by web standards; it is what the paper does,
 * and the paper is the spec.
 */
export const BAND = "#9ab264";
export const RULE = "#cdd9ae";
export const INKG = "#5c7a34";

/** The company lines of the letterhead: never the bank. */
export type DocHeaderSettings = {
  company_name: string | null;
  address: string | null;
  tax_id: string | null;
  phone: string | null;
};

/** The booking fields the header prints, named as CateringEvent names them. */
export type DocHeaderEvent = {
  quote_number: string | null;
  quote_revision: number;
  quoted_at: string | null;
  customer_name: string | null;
  customer_company_name: string | null;
  customer_contact_person: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_type: string;
  venue: string | null;
  room_portion: string | null;
  offsite_address: string | null;
  guest_count: number | null;
};

export function DocHeader({ settings, event, title }: { settings: DocHeaderSettings | null; event: DocHeaderEvent; title: string }) {
  const quotedDate = event.quoted_at ? thFullDate(event.quoted_at.slice(0, 10)) : "-";
  return (
    <>
      {/* Letterhead */}
      <div className="q-avoid-break" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px", borderBottom: `2px solid ${BAND}`, paddingBottom: "8px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: INKG }}>{settings?.company_name ?? "-"}</div>
          {settings?.address && <div style={{ fontSize: "13px" }}>{settings.address}</div>}
          <div style={{ fontSize: "13px" }}>
            {settings?.tax_id && `เลขประจำตัวผู้เสียภาษี ${settings.tax_id}`}
            {settings?.tax_id && settings?.phone ? "   " : ""}
            {settings?.phone && `โทร. ${settings.phone}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: INKG, letterSpacing: "0.5px" }}>{title}</div>
          {/* ONE number across all three states, deliberately: they are the
              same agreement at three moments, and a customer matching a
              deposit slip to its quote should not have to match two
              references. The event-details sheet carries it too; before a
              quotation is issued it has none. */}
          {event.quote_number && <div style={{ fontSize: "13px" }}>เลขที่ {event.quote_number}</div>}
          {event.quote_revision > 0 && <div style={{ fontSize: "13px" }}>แก้ไขครั้งที่ {event.quote_revision}</div>}
          <div style={{ fontSize: "13px" }}>วันที่ {quotedDate}</div>
        </div>
      </div>

      {/* Customer + event */}
      <div style={{ display: "flex", gap: "24px", marginBottom: "10px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: "bold", marginBottom: "3px", color: INKG }}>เรียน</div>
          <div>{event.customer_name ?? "-"}</div>
          {event.customer_company_name && <div>{event.customer_company_name}</div>}
          {event.customer_contact_person && <div>ผู้ติดต่อ: {event.customer_contact_person}</div>}
          {event.customer_phone && <div>โทร. {event.customer_phone}</div>}
          {event.customer_address && <div>{event.customer_address}</div>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: "bold", marginBottom: "3px", color: INKG }}>รายละเอียดงาน</div>
          <div>วันที่จัดงาน {thFullDate(event.event_date)}</div>
          <div>เวลา {timeRange(event.start_time, event.end_time)}</div>
          <div>สถานที่ {event.location_type === "in_house" ? locationLabel(event) : (event.offsite_address || "นอกสถานที่")}</div>
          {event.guest_count != null && <div>จำนวนแขก {event.guest_count} ท่าน</div>}
        </div>
      </div>
    </>
  );
}
