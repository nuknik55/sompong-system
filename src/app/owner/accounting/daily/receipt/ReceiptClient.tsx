"use client";

import { useState, useEffect } from "react";
import type { ExpenseEntry } from "../../actions";

// ── Helpers ───────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toThaiDateShort(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}/${m}/${(y ?? 2568) + 543}`;
}

function bahtToWords(n: number): string {
  if (n === 0) return "ศูนย์บาทถ้วน";
  const ONES = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];

  function seg(num: number): string {
    if (num === 0) return "";
    const s = String(num);
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const d = parseInt(s[i]);
      const place = s.length - 1 - i;
      if (d === 0) continue;
      if (place === 1) {
        if (d === 1) out += "สิบ";
        else if (d === 2) out += "ยี่สิบ";
        else out += ONES[d] + "สิบ";
      } else if (place === 0 && s.length > 1 && d === 1) {
        out += "เอ็ด";
      } else {
        const places = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
        out += ONES[d] + (places[place] ?? "");
      }
    }
    return out;
  }

  const baht = Math.floor(n);
  const satang = Math.round((n - baht) * 100);
  let result = "";
  if (baht >= 1_000_000) {
    result = seg(Math.floor(baht / 1_000_000)) + "ล้าน" + seg(baht % 1_000_000);
  } else {
    result = seg(baht);
  }
  result += "บาท";
  result += satang > 0 ? seg(satang) + "สตางค์" : "ถ้วน";
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────

type ReceiptRow = {
  key: string;
  date: string;
  label: string;
  amount: number;
};

// ── Component ─────────────────────────────────────────────────────────

export function ReceiptClient({
  entries,
  date,
}: {
  entries: ExpenseEntry[];
  date: string;
}) {
  const [companyName, setCompanyName] = useState("ห้างหุ้นส่วนจำกัด สวนอาหารสมพงศ์");
  const [payerName, setPayerName] = useState("นายวีระ เกียรติวีระกุล");
  const [payerTitle, setPayerTitle] = useState("แคชเชียร์");
  const [approverName, setApproverName] = useState("นางสาวพรเพ็ญ เกียรติวีระกุล");
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("receipt_settings");
      if (saved) {
        const s = JSON.parse(saved) as Record<string, string>;
        if (s.companyName) setCompanyName(s.companyName);
        if (s.payerName) setPayerName(s.payerName);
        if (s.payerTitle) setPayerTitle(s.payerTitle);
        if (s.approverName) setApproverName(s.approverName);
      }
    } catch {}
  }, []);

  function saveAndPrint() {
    try {
      localStorage.setItem("receipt_settings", JSON.stringify({ companyName, payerName, payerTitle, approverName }));
    } catch {}
    window.print();
  }

  // Group entries by bill_ref (or individual if no bill_ref)
  const groupMap = new Map<string, { label: string; entries: ExpenseEntry[] }>();
  for (const e of entries) {
    const key = e.bill_ref?.trim() || e.id;
    const label = e.bill_ref?.trim() || e.note?.trim() || e.coa_name;
    if (!groupMap.has(key)) groupMap.set(key, { label, entries: [] });
    groupMap.get(key)!.entries.push(e);
  }

  const receiptRows: ReceiptRow[] = [...groupMap.entries()].map(([key, g]) => ({
    key,
    date: g.entries[0]!.entry_date,
    label: g.label,
    amount: g.entries.reduce((s, e) => s + e.amount, 0),
  }));

  const total = receiptRows.reduce((s, r) => s + r.amount, 0);
  const MIN_ROWS = 8;
  const blankCount = Math.max(0, MIN_ROWS - receiptRows.length);
  const thaiDate = toThaiDateShort(date);

  const inputStyle: React.CSSProperties = {
    fontFamily: "inherit",
    fontSize: "inherit",
    border: "none",
    borderBottom: "1px solid #555",
    background: "transparent",
    outline: "none",
    padding: "0 2px",
  };

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          input { border: none !important; background: transparent !important; outline: none !important; }
          .input-underline { border-bottom: 1px solid black !important; }
          @page { size: A4; margin: 15mm 20mm; }
          body { -webkit-print-color-adjust: exact; }
        }
        @media screen {
          .receipt-wrap { max-width: 720px; margin: 0 auto; }
        }
        input.editable:focus { outline: 2px solid #3b82f6; border-radius: 2px; }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <a href={`/owner/accounting/daily?date=${date}`}
            className="text-sm text-neutral-500 hover:text-neutral-800">
            ← กลับ
          </a>
          <span className="text-sm text-neutral-400">|</span>
          <span className="text-xs text-neutral-500">คลิกข้อความสีเทา เพื่อแก้ไขก่อนพิมพ์</span>
        </div>
        <button
          onClick={saveAndPrint}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          พิมพ์ใบรับรอง
        </button>
      </div>

      {/* Receipt */}
      <div className="receipt-wrap px-6 py-8" style={{ fontFamily: "'Sarabun', 'TH SarabunNew', 'Angsana New', Arial, sans-serif", fontSize: "15px", lineHeight: "1.7", color: "#000" }}>

        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: "6px" }}>
          <div style={{ fontSize: "20px", fontWeight: "bold", letterSpacing: "0.5px" }}>
            ใบรับรองแทนใบเสร็จรับเงิน
          </div>
          <div style={{ fontSize: "15px" }}>
            <input
              className="editable"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              style={{ ...inputStyle, textAlign: "center", minWidth: "280px" }}
            />
            {" "}(ผู้ซื้อ/ผู้รับบริการ)
          </div>
        </div>

        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "10px" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "center", width: "16%", fontWeight: "bold" }}>
                วัน เดือน ปี
              </th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "center", fontWeight: "bold" }}>
                รายละเอียดรายจ่าย
              </th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "center", width: "16%", fontWeight: "bold" }}>
                จำนวน
              </th>
              <th style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "center", width: "14%", fontWeight: "bold" }}>
                หมายเหตุ
              </th>
            </tr>
          </thead>
          <tbody>
            {receiptRows.map((row) => (
              <tr key={row.key}>
                <td style={{ border: "1px solid #333", padding: "5px 10px", textAlign: "center" }}>
                  {toThaiDateShort(row.date)}
                </td>
                <td style={{ border: "1px solid #333", padding: "5px 10px" }}>
                  {row.label}
                </td>
                <td style={{ border: "1px solid #333", padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(row.amount)}
                </td>
                <td style={{ border: "1px solid #333", padding: "5px 10px" }}>
                  <input
                    className="editable"
                    value={rowNotes[row.key] ?? ""}
                    onChange={(e) => setRowNotes((prev) => ({ ...prev, [row.key]: e.target.value }))}
                    style={{ ...inputStyle, width: "100%" }}
                    placeholder="–"
                  />
                </td>
              </tr>
            ))}
            {Array.from({ length: blankCount }).map((_, i) => (
              <tr key={`blank-${i}`}>
                <td style={{ border: "1px solid #333", padding: "5px 10px", height: "30px" }}>&nbsp;</td>
                <td style={{ border: "1px solid #333", padding: "5px 10px" }}>&nbsp;</td>
                <td style={{ border: "1px solid #333", padding: "5px 10px" }}>&nbsp;</td>
                <td style={{ border: "1px solid #333", padding: "5px 10px" }}>&nbsp;</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "center", fontWeight: "bold" }}>
                รวม
              </td>
              <td style={{ border: "1px solid #333", padding: "6px 10px", textAlign: "right", fontWeight: "bold", fontVariantNumeric: "tabular-nums" }}>
                {fmt(total)}
              </td>
              <td style={{ border: "1px solid #333", padding: "6px 10px" }}>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        {/* ตัวอักษร */}
        <div style={{ marginBottom: "16px", display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ whiteSpace: "nowrap" }}>ตัวอักษร</span>
          <span style={{ borderBottom: "1px solid #555", flex: 1, paddingBottom: "1px", paddingLeft: "8px" }}>
            {bahtToWords(total)}
          </span>
        </div>

        {/* Declaration */}
        <div style={{ marginBottom: "20px" }}>
          <div>
            ข้าพเจ้า{" "}
            <input className="editable input-underline" value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              style={{ ...inputStyle, minWidth: "180px" }} />
            {" "}(ผู้เบิกจ่าย) ตำแหน่ง{" "}
            <input className="editable input-underline" value={payerTitle}
              onChange={(e) => setPayerTitle(e.target.value)}
              style={{ ...inputStyle, minWidth: "100px" }} />
          </div>
          <div>ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และ</div>
          <div>ข้าพเจ้าได้จ่ายไปในงานของทางบริษัท/ห้างหุ้นส่วนจำกัด โดยแท้</div>
          <div style={{ marginTop: "4px" }}>
            &emsp;ตั้งแต่วันที่
            <span style={{ borderBottom: "1px solid #555", display: "inline-block", minWidth: "80px", textAlign: "center", margin: "0 4px" }}>
              {thaiDate}
            </span>
            ถึงวันที่
            <span style={{ borderBottom: "1px solid #555", display: "inline-block", minWidth: "80px", textAlign: "center", margin: "0 4px" }}>
              {thaiDate}
            </span>
          </div>
        </div>

        {/* Signatures */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: "32px", gap: "24px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้เบิกจ่าย</div>
            <div style={{ marginTop: "4px" }}>
              (<input className="editable" value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                style={{ ...inputStyle, textAlign: "center", minWidth: "160px" }} />)
            </div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div>ลงชื่อ......................................ผู้อนุมัติ</div>
            <div style={{ marginTop: "4px" }}>
              (<input className="editable" value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
                style={{ ...inputStyle, textAlign: "center", minWidth: "160px" }} />)
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
