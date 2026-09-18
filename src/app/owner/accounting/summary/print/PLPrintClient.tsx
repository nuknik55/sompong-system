"use client";

import type { MonthlyCovers } from "../../actions";
import { completenessNotices, profitJudgementAllowed } from "../completeness";
import { buildPlFile, buildPlWorkbook, REVENUE_KEYS, REVENUE_LABELS, type PlSummary } from "./pl-workbook";

const MONTHS_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

function getThaiMonth(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null) {
  return n != null ? `${n.toFixed(1)}%` : "—";
}

// ── Excel export ─────────────────────────────────────────────────────────────
//
// The file is built in pl-workbook.ts, which imports the library nowhere and
// so runs under the test runner: what Nik opens in Excel is what
// pl-excel.test.ts reads back — the filter, the frozen rows, the widths, the
// number formats and the red marking. This function only loads the library,
// hands over the two sheets, and saves the bytes.

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function exportExcel(
  yearMonth: string,
  revenueMap: Record<string, number>,
  summary: PlSummary,
  covers: MonthlyCovers | null,
) {
  // Lazy-load the library: it is large and only this button needs it.
  import("xlsx-js-style").then((XLSX) => {
    const { full, meeting } = buildPlWorkbook(getThaiMonth(yearMonth), summary, revenueMap, covers, completenessNotices(summary));
    const { bytes } = buildPlFile(XLSX, [full, meeting]);

    // Saved here rather than by XLSX.writeFile, because the frozen panes go
    // into the file AFTER the library has written it: these bytes are the
    // patched ones. The link is put in the document because Firefox will not
    // follow a click on an element that is not in it, and the URL is released
    // on a timer because Chrome can abandon a download whose blob URL is
    // revoked in the same tick.
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `PL-${yearMonth}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PLPrintClient({
  yearMonth,
  summary,
  revenueMap,
  covers,
}: {
  yearMonth: string;
  summary: PlSummary;
  revenueMap: Record<string, number>;
  /** null = the month has no covers row; the two rows are then omitted, never zero. */
  covers: MonthlyCovers | null;
}) {
  const thaiMonth = getThaiMonth(yearMonth);
  const operatingProfit = summary.totalRevenue - summary.operatingExpense;
  const profitPct = summary.totalRevenue > 0 ? (operatingProfit / summary.totalRevenue) * 100 : null;
  // Same rule as the screen (profitJudgementAllowed): the figure prints, the
  // verdict does not. Green on July 2569's 78.2% would be the single most
  // misleading mark on a page that gets emailed to the accountant.
  const judged = profitJudgementAllowed(summary);
  const profitColor = !judged ? "#111827" : operatingProfit < 0 ? "#dc2626" : "#16a34a";
  const notices = completenessNotices(summary);

  const backHref = `/owner/accounting/summary?month=${yearMonth}`;

  const font = "'Sarabun','TH SarabunNew','Angsana New',Arial,sans-serif";
  const cellStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "4px 8px",
    fontFamily: font,
    fontSize: 14,
  };
  const numStyle: React.CSSProperties = { ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const pctStyle: React.CSSProperties = { ...numStyle, color: "#555", fontSize: 12 };

  return (
    <div style={{ fontFamily: font, fontSize: 15, color: "#111" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm 20mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Screen toolbar */}
      <div
        className="no-print"
        style={{
          position: "sticky", top: 0, background: "#f9fafb", borderBottom: "1px solid #e5e7eb",
          padding: "10px 20px", display: "flex", gap: 12, alignItems: "center",
        }}
      >
        <a href={backHref} style={{ fontSize: 14, color: "#555", textDecoration: "none" }}>← กลับ</a>
        <button
          onClick={() => window.print()}
          style={{
            background: "#18181b", color: "#fff", border: "none", borderRadius: 6,
            padding: "6px 16px", fontSize: 14, cursor: "pointer",
          }}
        >
          พิมพ์ / บันทึก PDF
        </button>
        <button
          onClick={() => exportExcel(yearMonth, revenueMap, summary, covers)}
          style={{
            background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
            padding: "6px 16px", fontSize: 14, cursor: "pointer",
          }}
        >
          Export Excel (.xlsx)
        </button>
      </div>

      {/* Print content */}
      <div style={{ maxWidth: 720, margin: "24px auto", padding: "0 24px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: font }}>งบกำไรขาดทุน (P&L)</div>
          <div style={{ fontSize: 15, color: "#555", marginTop: 4 }}>{thaiMonth}</div>
        </div>

        {notices.map((n) => (
          <div
            key={n}
            style={{
              border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e",
              padding: "8px 12px", marginBottom: 16, fontSize: 13, lineHeight: 1.5,
            }}
          >
            {n}
          </div>
        ))}

        {/* Revenue table */}
        <div style={{ marginBottom: 4, fontWeight: 700, fontSize: 15, fontFamily: font }}>รายได้</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ ...cellStyle, textAlign: "left", fontWeight: 600 }}>ประเภทรายได้</th>
              <th style={{ ...numStyle, fontWeight: 600 }}>จำนวน (฿)</th>
              <th style={{ ...pctStyle, fontWeight: 600 }}>% ของรายได้</th>
            </tr>
          </thead>
          <tbody>
            {REVENUE_KEYS.map((key) => {
              const amt = revenueMap[key] ?? 0;
              return (
                <tr key={key}>
                  <td style={cellStyle}>{REVENUE_LABELS[key]}</td>
                  <td style={numStyle}>{amt > 0 ? fmt(amt) : "—"}</td>
                  <td style={pctStyle}>
                    {summary.totalRevenue > 0 && amt > 0
                      ? `${((amt / summary.totalRevenue) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f3f4f6" }}>
              <td style={{ ...cellStyle, fontWeight: 700 }}>รวมรายได้</td>
              <td style={{ ...numStyle, fontWeight: 700 }}>{fmt(summary.totalRevenue)}</td>
              <td style={{ ...pctStyle, fontWeight: 700 }}>100%</td>
            </tr>
            {/* The two counts, when the month has them. Counts, not the POS's
                averages: the app's revenue divided by these is the screen's job. */}
            {covers && (
              <>
                <tr>
                  <td style={cellStyle}>จำนวนบิล</td>
                  <td style={numStyle}>{covers.bills.toLocaleString("th-TH")}</td>
                  <td style={pctStyle}>—</td>
                </tr>
                <tr>
                  <td style={cellStyle}>จำนวนลูกค้า</td>
                  <td style={numStyle}>{covers.customers.toLocaleString("th-TH")}</td>
                  <td style={pctStyle}>—</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>

        {/* Expense table */}
        <div style={{ marginBottom: 4, fontWeight: 700, fontSize: 15, fontFamily: font }}>ค่าใช้จ่าย</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ ...cellStyle, textAlign: "left", fontWeight: 600 }}>หมวด</th>
              <th style={{ ...numStyle, fontWeight: 600 }}>จำนวน (฿)</th>
              <th style={{ ...pctStyle, fontWeight: 600 }}>% จริง</th>
              <th style={{ ...pctStyle, fontWeight: 600 }}>% เป้า</th>
            </tr>
          </thead>
          <tbody>
            {summary.groups.map((g) => {
              if (g.total === 0) return null;
              return (
                <>
                  {/* Group header */}
                  <tr key={g.group_code} style={{ background: "#f9fafb" }}>
                    <td style={{ ...cellStyle, fontWeight: 600 }}>{g.group_name}</td>
                    <td style={{ ...numStyle, fontWeight: 600 }}>{fmt(g.total)}</td>
                    <td style={pctStyle}>{fmtPct(g.pct_of_revenue)}</td>
                    <td style={pctStyle}>{g.target_pct != null ? `${g.target_pct}%` : "—"}</td>
                  </tr>
                  {/* Account detail rows */}
                  {g.accounts.map((a) => (
                    <tr key={a.code}>
                      <td style={{ ...cellStyle, paddingLeft: 24, color: "#555" }}>{a.name}</td>
                      <td style={{ ...numStyle, color: "#555" }}>{fmt(a.total)}</td>
                      <td style={{ ...pctStyle }}>{fmtPct(a.pct_of_revenue)}</td>
                      <td style={pctStyle} />
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f3f4f6", borderTop: "2px solid #999" }}>
              <td style={{ ...cellStyle, fontWeight: 700 }}>
                รวมค่าใช้จ่ายดำเนินงาน
              </td>
              <td style={{ ...numStyle, fontWeight: 700 }}>{fmt(summary.operatingExpense)}</td>
              <td style={pctStyle}>
                {summary.totalRevenue > 0
                  ? `${((summary.operatingExpense / summary.totalRevenue) * 100).toFixed(1)}%`
                  : "—"}
              </td>
              <td style={pctStyle} />
            </tr>
            {summary.nonOperating.map((g) => (
              <tr key={g.group_code} style={{ color: "#6b7280" }}>
                <td style={cellStyle}>
                  {g.group_name} <span style={{ fontSize: "0.85em" }}>(ไม่หักจากกำไรดำเนินงาน)</span>
                </td>
                <td style={numStyle}>{fmt(g.total)}</td>
                <td style={pctStyle}>
                  {summary.totalRevenue > 0
                    ? `${((g.total / summary.totalRevenue) * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td style={pctStyle} />
              </tr>
            ))}
          </tfoot>
        </table>

        {/* Profit row */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ background: !judged ? "#f9fafb" : operatingProfit < 0 ? "#fef2f2" : "#f0fdf4", borderTop: "2px solid #333" }}>
              <td style={{ ...cellStyle, fontWeight: 700, fontSize: 16, color: profitColor }}>
                กำไรจากการดำเนินงาน
              </td>
              <td style={{ ...numStyle, fontWeight: 700, fontSize: 16, color: profitColor }}>
                {fmt(operatingProfit)}
              </td>
              <td style={{ ...pctStyle, fontWeight: 700, color: profitColor }}>
                {profitPct != null ? `${profitPct.toFixed(1)}%` : "—"}
              </td>
              <td style={pctStyle} />
            </tr>
          </tbody>
        </table>

        {/* Footer note */}
        <div style={{ marginTop: 24, fontSize: 12, color: "#888", fontFamily: font }}>
          * งบนี้จัดทำจากข้อมูลในระบบ ณ วันที่พิมพ์ ยังไม่รวมภาษีและรายการปรับปรุง
        </div>
      </div>
    </div>
  );
}
