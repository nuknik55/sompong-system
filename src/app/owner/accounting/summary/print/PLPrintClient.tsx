"use client";

import type { MonthlySummaryGroup } from "../../actions";

const MONTHS_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

const REVENUE_LABELS: Record<string, string> = {
  food: "อาหาร",
  drink: "เครื่องดื่ม",
  dessert: "ของหวาน",
  delivery: "เดลิเวอรี่",
  other: "อื่นๆ",
};
const REVENUE_KEYS = ["food", "drink", "dessert", "delivery", "other"];

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

function exportExcel(
  yearMonth: string,
  revenueMap: Record<string, number>,
  summary: { groups: MonthlySummaryGroup[]; totalRevenue: number; totalExpense: number }
) {
  // Lazy-load xlsx (already in package.json)
  import("xlsx").then((XLSX) => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [];

    const thaiMonth = getThaiMonth(yearMonth);

    // Title
    rows.push([`งบกำไรขาดทุน (P&L) — ${thaiMonth}`]);
    rows.push([]);

    // Revenue section
    rows.push(["รายได้", "", "จำนวน (฿)", "% ของรายได้"]);
    let revenueRowStart = rows.length;
    for (const key of REVENUE_KEYS) {
      const amt = revenueMap[key] ?? 0;
      if (amt > 0) {
        rows.push([REVENUE_LABELS[key], "", amt, summary.totalRevenue > 0 ? (amt / summary.totalRevenue) * 100 : 0]);
      }
    }
    rows.push(["รวมรายได้", "", summary.totalRevenue, 100]);
    rows.push([]);

    // Expense section
    rows.push(["ค่าใช้จ่าย", "", "จำนวน (฿)", "% จริง", "% เป้า"]);
    for (const g of summary.groups) {
      if (g.total === 0) continue;
      rows.push([g.group_name, "", g.total, g.pct_of_revenue ?? 0, g.target_pct ?? ""]);
      for (const a of g.accounts) {
        rows.push([`  ${a.name}`, "", a.total, a.pct_of_revenue ?? 0, ""]);
      }
    }
    rows.push(["รวมค่าใช้จ่าย", "", summary.totalExpense,
      summary.totalRevenue > 0 ? (summary.totalExpense / summary.totalRevenue) * 100 : 0, ""]);
    rows.push([]);

    // Profit
    const profit = summary.totalRevenue - summary.totalExpense;
    const profitPct = summary.totalRevenue > 0 ? (profit / summary.totalRevenue) * 100 : 0;
    rows.push(["กำไรก่อนภาษี", "", profit, profitPct]);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws["!cols"] = [{ wch: 36 }, { wch: 4 }, { wch: 18 }, { wch: 12 }, { wch: 10 }];

    // Number format on column C (index 2) and D/E
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = revenueRowStart; r <= range.e.r; r++) {
      const cCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      if (cCell && typeof cCell.v === "number") cCell.z = "#,##0.00";
      const dCell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
      if (dCell && typeof dCell.v === "number") dCell.z = "0.0%";
    }

    XLSX.utils.book_append_sheet(wb, ws, "P&L");
    XLSX.writeFile(wb, `PL-${yearMonth}.xlsx`);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PLPrintClient({
  yearMonth,
  summary,
  revenueMap,
}: {
  yearMonth: string;
  summary: { groups: MonthlySummaryGroup[]; totalRevenue: number; totalExpense: number };
  revenueMap: Record<string, number>;
}) {
  const thaiMonth = getThaiMonth(yearMonth);
  const profit = summary.totalRevenue - summary.totalExpense;
  const profitPct = summary.totalRevenue > 0 ? (profit / summary.totalRevenue) * 100 : null;
  const profitColor = profit < 0 ? "#dc2626" : "#16a34a";

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
          onClick={() => exportExcel(yearMonth, revenueMap, summary)}
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
              <td style={{ ...cellStyle, fontWeight: 700 }}>รวมค่าใช้จ่าย</td>
              <td style={{ ...numStyle, fontWeight: 700 }}>{fmt(summary.totalExpense)}</td>
              <td style={pctStyle}>
                {summary.totalRevenue > 0
                  ? `${((summary.totalExpense / summary.totalRevenue) * 100).toFixed(1)}%`
                  : "—"}
              </td>
              <td style={pctStyle} />
            </tr>
          </tfoot>
        </table>

        {/* Profit row */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ background: profit < 0 ? "#fef2f2" : "#f0fdf4", borderTop: "2px solid #333" }}>
              <td style={{ ...cellStyle, fontWeight: 700, fontSize: 16, color: profitColor }}>
                กำไรก่อนภาษี
              </td>
              <td style={{ ...numStyle, fontWeight: 700, fontSize: 16, color: profitColor }}>
                {fmt(profit)}
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
