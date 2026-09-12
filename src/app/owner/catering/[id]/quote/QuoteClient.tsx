"use client";

import type { CateringEvent, CateringSettings } from "../../actions";
import type { DocState, DocMoney } from "@/lib/quote-doc";
import { DOC_TITLE, conditionsFor, moneyRowsFor } from "@/lib/quote-doc";
import { thFullDate, timeRange, locationLabel, fmtBaht } from "../../shared-utils";

export type QuoteLine = {
  id: string;
  label: string;
  note: string | null;
  unitPrice: number;
  quantity: number;
  amount: number;
  /** Dish names inside a package line, in section order. Empty for every
   *  other kind of charge. */
  dishes: string[];
};

/**
 * The green of the header band on Nik's printed quotation. Defined once and
 * used for the band, its border and the section rules, so "the document's
 * green" is one value rather than three that drift apart.
 */
const BAND = "#1f7a45";

export function QuoteClient({
  event,
  doc,
  lines,
  money,
  settings,
}: {
  event: CateringEvent;
  doc: DocState;
  lines: QuoteLine[];
  money: DocMoney;
  settings: CateringSettings | null;
}) {
  const quotedDate = event.quoted_at ? thFullDate(event.quoted_at.slice(0, 10)) : "-";
  const conditions = conditionsFor(doc, money.percent);
  const moneyRows = moneyRowsFor(doc, money);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm 16mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .q-avoid-break { break-inside: avoid; }
        }
        @media screen {
          .quote-wrap { max-width: 760px; margin: 0 auto; }
        }
        .quote-wrap table { width: 100%; border-collapse: collapse; }
        .quote-wrap th, .quote-wrap td { border: 1px solid #9aa39c; padding: 6px 9px; vertical-align: top; }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3">
        <a href={`/owner/catering/${event.id}`} className="text-sm text-neutral-500 hover:text-neutral-800">← กลับ</a>
        {/* One route, three states. Plain links so each is its own URL and
            prints as itself — the browser's print dialog acts on the page it
            is on, not on a tab a component is holding in state. */}
        <div className="flex gap-1 text-sm">
          {(["quote", "deposit", "invoice"] as const).map((s) => (
            <a
              key={s}
              href={`/owner/catering/${event.id}/quote?doc=${s}`}
              className={`rounded-md px-3 py-1.5 ${s === doc ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {DOC_TITLE[s]}
            </a>
          ))}
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          พิมพ์
        </button>
      </div>

      <div
        className="quote-wrap px-6 py-8"
        style={{ fontFamily: "'Sarabun', 'TH SarabunNew', 'Angsana New', Arial, sans-serif", fontSize: "15px", lineHeight: "1.65", color: "#000" }}
      >
        {/* Letterhead */}
        <div className="q-avoid-break" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", borderBottom: `3px solid ${BAND}`, paddingBottom: "10px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
          <div>
            <div style={{ fontSize: "19px", fontWeight: "bold", color: BAND }}>{settings?.company_name ?? "-"}</div>
            {settings?.address && <div style={{ fontSize: "13px" }}>{settings.address}</div>}
            <div style={{ fontSize: "13px" }}>
              {settings?.tax_id && `เลขประจำตัวผู้เสียภาษี ${settings.tax_id}`}
              {settings?.tax_id && settings?.phone ? "   " : ""}
              {settings?.phone && `โทร. ${settings.phone}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22px", fontWeight: "bold" }}>{DOC_TITLE[doc]}</div>
            {/* ONE number across all three states, deliberately: they are the
                same agreement at three moments, and a customer matching a
                deposit slip to its quote should not have to match two
                references. */}
            <div style={{ fontSize: "13px" }}>เลขที่ {event.quote_number}</div>
            {event.quote_revision > 0 && <div style={{ fontSize: "13px" }}>แก้ไขครั้งที่ {event.quote_revision}</div>}
            <div style={{ fontSize: "13px" }}>วันที่ {quotedDate}</div>
          </div>
        </div>

        {/* Customer + event */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "14px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "3px" }}>เรียน</div>
            <div>{event.customer_name ?? "-"}</div>
            {event.customer_company_name && <div>{event.customer_company_name}</div>}
            {event.customer_contact_person && <div>ผู้ติดต่อ: {event.customer_contact_person}</div>}
            {event.customer_phone && <div>โทร. {event.customer_phone}</div>}
            {event.customer_address && <div>{event.customer_address}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "bold", marginBottom: "3px" }}>รายละเอียดงาน</div>
            <div>วันที่จัดงาน {thFullDate(event.event_date)}</div>
            <div>เวลา {timeRange(event.start_time, event.end_time)}</div>
            <div>สถานที่ {event.location_type === "in_house" ? locationLabel(event) : (event.offsite_address || "นอกสถานที่")}</div>
            {event.guest_count != null && <div>จำนวนแขก {event.guest_count} ท่าน</div>}
          </div>
        </div>

        {/* Line items. Column order is the paper's: ราคาต่อหน่วย BEFORE จำนวน. */}
        <table style={{ marginBottom: "10px" }}>
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "45%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <thead>
            {/* The green band, white on green. print-color-adjust is set here
                as well as on body: a browser that drops it would leave white
                text on white paper, i.e. no header at all. */}
            <tr style={{ background: BAND, color: "#fff", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
              <th style={{ textAlign: "center", borderColor: BAND }}>ลำดับ</th>
              <th style={{ textAlign: "left", borderColor: BAND }}>รายละเอียด</th>
              <th style={{ textAlign: "right", borderColor: BAND }}>ราคาต่อหน่วย</th>
              <th style={{ textAlign: "center", borderColor: BAND }}>จำนวน</th>
              <th style={{ textAlign: "right", borderColor: BAND }}>ยอดรวม</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "#666" }}>ยังไม่มีรายการ</td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={l.id}>
                  <td style={{ textAlign: "center" }}>{i + 1}</td>
                  <td>
                    {l.label}
                    {l.note && <div style={{ fontSize: "12px", color: "#555" }}>{l.note}</div>}
                    {/* What is inside the package, for the customer. Names
                        only — pricing them again would double count against
                        the package line they sit under. */}
                    {l.dishes.length > 0 && (
                      <ul style={{ margin: "3px 0 0", paddingLeft: "18px", fontSize: "13px", color: "#333" }}>
                        {l.dishes.map((d) => <li key={d}>{d}</li>)}
                      </ul>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtBaht(l.unitPrice)}</td>
                  <td style={{ textAlign: "center" }}>{l.quantity}</td>
                  <td style={{ textAlign: "right" }}>{fmtBaht(l.amount)}</td>
                </tr>
              ))
            )}
            {moneyRows.map((r) => (
              <tr key={r.label}>
                <td colSpan={4} style={{ textAlign: "right", fontWeight: r.strong ? "bold" : undefined }}>{r.label}</td>
                <td style={{ textAlign: "right", fontWeight: r.strong ? "bold" : undefined }}>{fmtBaht(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Conditions.
            PROVENANCE: this wording is read off photographs of ONE job's
            paperwork — Nik's own text, not invented boilerplate, but also not
            a policy document he has stated and reviewed. It replaced earlier
            text that WAS invented (30 days, 50%, 7-day cancellation), which
            was worse. He is being asked to confirm the final wording; treat
            every line as provisional and do not add to it. The list itself
            lives in @/lib/quote-doc. */}
        <div className="q-avoid-break" style={{ fontSize: "13px", marginBottom: "16px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "3px", color: BAND, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>เงื่อนไข</div>
          <ol style={{ margin: 0, paddingLeft: "20px" }}>
            {conditions.map((c) => <li key={c}>{c}</li>)}
          </ol>
        </div>

        {/* Bank block — on the two documents that ask for money. */}
        {doc !== "quote" && (settings?.bank_name || settings?.bank_account_number) && (
          <div className="q-avoid-break" style={{ fontSize: "13px", marginBottom: "20px", border: `1px solid ${BAND}`, padding: "9px 13px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
            <div style={{ fontWeight: "bold", marginBottom: "3px" }}>ชำระเงินโอนเข้าบัญชี</div>
            <div>
              {settings?.bank_name}
              {settings?.bank_account_name ? ` ชื่อบัญชี ${settings.bank_account_name}` : ""}
            </div>
            {settings?.bank_account_number && <div>เลขที่บัญชี {settings.bank_account_number}</div>}
          </div>
        )}

        {/* Signatures */}
        <div className="q-avoid-break" style={{ display: "flex", justifyContent: "space-around", marginTop: "28px", gap: "24px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้เสนอราคา</div>
            <div style={{ marginTop: "18px" }}>วันที่.........../.........../...........</div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้อนุมัติ/ลูกค้า</div>
            <div style={{ marginTop: "18px" }}>วันที่.........../.........../...........</div>
          </div>
        </div>
      </div>
    </>
  );
}
