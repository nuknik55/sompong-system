"use client";

import { Fragment } from "react";
import type { CateringEvent } from "../../actions";
import { thWeekdayFullDate, kitchenHeading } from "@/lib/kitchen-sheet";
import { timeRange, locationLabel, FOOD_FORMAT_LABEL } from "../../shared-utils";

export type KitchenRow = {
  id: string;
  /** 1-based, as printed in the ลำดับ column. */
  index: number;
  name: string;
  /** "200 x 50" — price × plates for the whole job (plateCount), literal,
   *  never multiplied. null prints an empty cell. */
  price: string | null;
  note: string | null;
};

export type KitchenBlock = {
  /** The catering_event_menus row id — the React key, because a booking may
   *  legitimately carry the same package twice and names would collide. */
  id: string;
  title: string;
  /** Only sections WITH ROWS reach here — see groupBySection. */
  sections: { label: string; rows: KitchenRow[] }[];
};

/** "label : value", or a short rule where the booking holds no answer. */
function HeadLine({ label, value }: { label: string; value: string | null }) {
  return (
    // nowrap holds "label :" together only — the VALUE must wrap. With
    // nowrap on the whole span, a long offsite address ran 276px past A4's
    // printable width (found by the verification pass's geometry probe,
    // not by eye: clipped text on paper is silent).
    <span>
      <span style={{ whiteSpace: "nowrap" }}>{label} :</span>{" "}
      {value ?? <span style={{ display: "inline-block", minWidth: "90px", borderBottom: "1px dotted currentColor" }} />}
    </span>
  );
}

/**
 * ONE table per package, as the paper has it — headed ลำดับ | รายการอาหาร |
 * ราคา | หมายเหตุ.
 *
 * It previously rendered one table PER SECTION, with no <thead> at all, so a
 * package showed as a headerless grid whose fourth column looked like an
 * accident. Sections are now label rows INSIDE the one table, and only when
 * there is more than one of them: a package that is all dishes needs no
 * subheading, because the package's own name already says what the list is.
 */
function PackageTable({ sections }: { sections: { label: string; rows: KitchenRow[] }[] }) {
  const showSectionRows = sections.length > 1;
  return (
    <table>
      <colgroup>
        <col style={{ width: "8%" }} />
        <col style={{ width: "47%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "28%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ textAlign: "center" }}>ลำดับ</th>
          <th style={{ textAlign: "left" }}>รายการอาหาร</th>
          <th style={{ textAlign: "center" }}>ราคา</th>
          {/* หมายเหตุ is a real column now: the paper version has staff
              writing across the dish line. Blank cells stay writable. */}
          <th style={{ textAlign: "left" }}>หมายเหตุ</th>
        </tr>
      </thead>
      <tbody>
        {sections.map((s) => (
          <Fragment key={s.label}>
            {showSectionRows && (
              <tr>
                <td colSpan={4} style={{ fontWeight: 600, background: "#f3f4f6" }}>{s.label}</td>
              </tr>
            )}
            {s.rows.map((r) => (
              <tr key={r.id}>
                <td style={{ textAlign: "center" }}>{r.index}</td>
                <td>{r.name}</td>
                {/* Literal. See src/lib/kitchen-sheet.ts for why this is not a sum. */}
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{r.price ?? ""}</td>
                <td>{r.note ?? ""}</td>
              </tr>
            ))}
          </Fragment>
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
  fontClass,
}: {
  event: CateringEvent;
  tableCount: number | null;
  packages: KitchenBlock[];
  extras: KitchenRow[];
  /** Shared print face — ../print-font.ts. */
  fontClass: string;
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
        /* overflow-wrap: a fixed-layout cell CLIPS an unbroken run instead
           of growing — geometry probes cannot see painted overflow, so this
           is belt-and-braces from the same verification pass. */
        .ks-wrap td, .ks-wrap th { border: 1px solid #333; padding: 6px 8px; vertical-align: top; overflow-wrap: anywhere; }
        .ks-wrap th { background: #f3f4f6; font-weight: 600; }
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
        className={`ks-wrap px-6 py-8 ${fontClass}`}
        style={{ fontSize: "15px", lineHeight: "1.7", color: "#000" }}
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
          <div key={p.id} className="ks-avoid-break" style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{p.title}</div>
            {/* One table, sections as label rows inside it. A section with no
                rows never reaches here, so an absent ขนมหวาน prints nothing. */}
            {p.sections.length > 0 && <PackageTable sections={p.sections} />}
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
            <PackageTable sections={[{ label: "รายการอาหารเพิ่มเติม", rows: extras }]} />
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
