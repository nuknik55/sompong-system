"use client";

import type { CateringEvent } from "../../actions";
import { thWeekdayFullDate, kitchenHeading } from "@/lib/kitchen-sheet";
import { timeRange, locationLabel, FOOD_FORMAT_LABEL } from "../../shared-utils";

export type KitchenRow = {
  id: string;
  /** 1-based, as printed in the first column. */
  index: number;
  name: string;
  /** "5 ที่/โต๊ะ", or null for the ordinary one-per-table dish. */
  perTable: string | null;
  /** "485 x 6" — literal, never multiplied. null prints an empty cell. */
  price: string | null;
  note: string | null;
};

export type KitchenBlock = {
  title: string;
  /** Only sections WITH ROWS reach here — see groupBySection. */
  sections: { label: string; rows: KitchenRow[] }[];
};

/** "label : value", or a short rule where the booking holds no answer. */
function HeadLine({ label, value }: { label: string; value: string | null }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {label} : {value ?? <span style={{ display: "inline-block", minWidth: "90px", borderBottom: "1px dotted currentColor" }} />}
    </span>
  );
}

function RowTable({ rows }: { rows: KitchenRow[] }) {
  return (
    <table>
      <colgroup>
        <col style={{ width: "7%" }} />
        <col style={{ width: "48%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "28%" }} />
      </colgroup>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={{ textAlign: "center" }}>{r.index}</td>
            <td>
              {r.name}
              {r.perTable && <span style={{ fontSize: "12px", color: "#555" }}> ({r.perTable})</span>}
            </td>
            {/* Literal. See src/lib/kitchen-sheet.ts for why this is not a sum. */}
            <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{r.price ?? ""}</td>
            {/* หมายเหตุ is a real column now: the paper version has staff
                writing across the dish line. Blank rows stay writable. */}
            <td style={{ minHeight: "1.6em" }}>{r.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KitchenSheetClient({
  event,
  tableCount,
  packages,
  extras,
}: {
  event: CateringEvent;
  tableCount: number | null;
  packages: KitchenBlock[];
  extras: KitchenRow[];
}) {
  const heading = kitchenHeading(event.location_type);

  // THE HEADER'S COLOUR CARRIES MEANING, from Nik: blue = งานภายใน, red =
  // งานภายนอก. The kitchen tells the two apart across the pass without
  // reading a word, so it is the colour of the whole block rather than a
  // label inside it. print-color-adjust: exact below keeps it through the
  // printer — without it a browser may drop the colour and take the meaning
  // with it.
  const ink = heading.offsite ? "#c1121f" : "#1d4ed8";

  const venue =
    event.location_type === "in_house"
      ? locationLabel(event)
      : event.offsite_address || "นอกสถานที่";

  const foodFormat = event.food_format ? FOOD_FORMAT_LABEL[event.food_format] ?? event.food_format : null;
  const foodLine = foodFormat && tableCount != null
    ? `${foodFormat} - จำนวน ${tableCount} โต๊ะ`
    : foodFormat ?? (tableCount != null ? `จำนวน ${tableCount} โต๊ะ` : null);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .ks-avoid-break { break-inside: avoid; }
        }
        @media screen {
          .ks-wrap { max-width: 760px; margin: 0 auto; }
        }
        .ks-wrap table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .ks-wrap td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; }
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
        className="ks-wrap px-6 py-8"
        style={{ fontFamily: "'Sarabun', 'TH SarabunNew', 'Angsana New', Arial, sans-serif", fontSize: "15px", lineHeight: "1.7", color: "#000" }}
      >
        {/* Centred, boxed, and in the colour that says which kind of job it is. */}
        <div
          className="ks-avoid-break"
          style={{
            border: `2px solid ${ink}`, color: ink, textAlign: "center",
            padding: "10px 12px", marginBottom: "16px",
            WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
          }}
        >
          <div style={{ fontSize: "19px", fontWeight: "bold" }}>
            {heading.text} {thWeekdayFullDate(event.event_date)}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "22px", flexWrap: "wrap", marginTop: "3px" }}>
            <HeadLine label="สถานที่" value={venue} />
            <HeadLine label="เวลา" value={event.start_time ? `${timeRange(event.start_time, event.end_time)} น.` : null} />
          </div>
          <div style={{ marginTop: "2px" }}>
            <HeadLine label="ประเภทอาหาร" value={foodLine} />
          </div>
          <div style={{ marginTop: "2px" }}>
            {/* ประเภทงาน (เลี้ยงสัมมนาบริษัท, งานแต่ง…) has no column on
                catering_events, so it is always a rule to write on. Same
                field the service sheet leaves blank, same reason. */}
            <HeadLine label="ประเภทงาน" value={null} />
          </div>
        </div>

        {packages.map((p) => (
          <div key={p.title} className="ks-avoid-break" style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{p.title}</div>
            {p.sections.map((s) => (
              <div key={s.label} style={{ marginBottom: "8px" }}>
                {/* Only printed when the section has rows. A package with no
                    dessert is a package with no dessert, not a blank ขนมหวาน
                    heading. */}
                <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "2px" }}>{s.label}</div>
                <RowTable rows={s.rows} />
              </div>
            ))}
            {p.sections.length === 0 && (
              <div style={{ fontSize: "13px", color: "#666", paddingLeft: "10px" }}>
                ยังไม่ได้กำหนดรายการอาหารในชุดนี้
              </div>
            )}
          </div>
        ))}

        {extras.length > 0 && (
          <div className="ks-avoid-break" style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>รายการอาหารเพิ่มเติม</div>
            <RowTable rows={extras} />
          </div>
        )}

        {packages.length === 0 && extras.length === 0 && (
          <div style={{ border: "1px solid #333", padding: "10px", textAlign: "center", color: "#666" }}>
            ยังไม่มีรายการอาหาร
          </div>
        )}

        {event.kitchen_note && (
          <div className="ks-avoid-break" style={{ marginTop: "14px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "3px" }}>แจ้งครัว</div>
            <div style={{ whiteSpace: "pre-wrap", border: "1px solid #333", padding: "8px" }}>{event.kitchen_note}</div>
          </div>
        )}
      </div>
    </>
  );
}
