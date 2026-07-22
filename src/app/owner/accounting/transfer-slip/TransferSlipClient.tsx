"use client";

import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import type { WeeklySupplierRow } from "../actions";

const MONTHS_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

function thDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

function fmt(n: number | null | undefined): string {
  if (!n) return "";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tuesday 7 days before the given date
function prevWeekTuesday(tuesday: string): string {
  const d = new Date(tuesday);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function nextWeekTuesday(tuesday: string): string {
  const d = new Date(tuesday);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const DAY_LABELS = ["อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา.", "จ."];

export function TransferSlipClient({
  tuesday,
  rows,
  days,
  unlinkedCount,
}: {
  tuesday: string;
  rows: WeeklySupplierRow[];
  days: string[];
  unlinkedCount: number;
}) {
  const router = useRouter();
  const weekInputRef = useRef<HTMLInputElement>(null);
  const [sourceAccount, setSourceAccount] = useState("SCB สมพงศ์");

  // ── Sections ────────────────────────────────────────────────────

  // Section A: credit=true, payment_mode='transfer'
  const sectionA = rows.filter((r) => r.supplier.credit && r.supplier.payment_mode === "transfer" && r.total > 0);

  // Section B: credit=true, payment_mode='cash'
  const sectionB = rows.filter((r) => r.supplier.credit && r.supplier.payment_mode === "cash" && r.total > 0);

  // Section C: credit=false (โอนทันที)
  const sectionC = rows.filter((r) => !r.supplier.credit && r.total > 0);

  const totalA = sectionA.reduce((s, r) => s + r.total, 0);
  const totalB = sectionB.reduce((s, r) => s + r.total, 0);
  const totalC = sectionC.reduce((s, r) => s + r.total, 0);
  const grandTotal = totalA + totalB + totalC;

  const weekLabel = `${thDate(days[0]!)} – ${thDate(days[6]!)}`;
  const nextTuesday = (() => {
    const d = new Date(days[6]!);
    d.setDate(d.getDate() + 1);
    return thDate(d.toISOString().slice(0, 10));
  })();

  // ── Export Excel ────────────────────────────────────────────────

  async function exportExcel() {
    const { utils, writeFile } = await import("xlsx");
    const wb = utils.book_new();

    const headerRow = ["ซัพพลายเออร์", ...DAY_LABELS.map((l, i) => `${l} ${thDate(days[i]!)}`), "รวม", "ธนาคาร", "เลขบัญชี", "รายละเอียด"];

    function makeRows(section: WeeklySupplierRow[]) {
      return section.map((r) => [
        r.supplier.name,
        ...r.days.map((v) => v ?? 0),
        r.total,
        r.supplier.bank ?? "",
        r.supplier.account_number ?? "",
        r.supplier.description ?? "",
      ]);
    }

    const wsData: (string | number)[][] = [
      [`ใบโอนเงิน — ${weekLabel}`],
      [`โอนวัน: ${nextTuesday} | บัญชีต้นทาง: ${sourceAccount}`],
      [],
      ["─── เครดิต (โอน) ───"],
      headerRow,
      ...makeRows(sectionA),
      ["รวม A", ...Array(7).fill(""), totalA],
      [],
      ["─── เครดิต (จ่ายสด) ───"],
      headerRow,
      ...makeRows(sectionB),
      ["รวม B", ...Array(7).fill(""), totalB],
      [],
      ["─── โอนทันที ───"],
      headerRow,
      ...makeRows(sectionC),
      ["รวม C", ...Array(7).fill(""), totalC],
      [],
      ["รวมทั้งสิ้น", ...Array(7).fill(""), grandTotal],
    ];

    const ws = utils.aoa_to_sheet(wsData);
    utils.book_append_sheet(wb, ws, "โอนเงิน");
    writeFile(wb, `transfer-${tuesday}.xlsx`);
  }

  // ── Supplier rows in a section ──────────────────────────────────

  function SupplierRows({ section }: { section: WeeklySupplierRow[] }) {
    return (
      <>
        {section.map((r, i) => {
          const isEven = i % 2 === 0;
          const bg = isEven ? "bg-white" : "bg-neutral-100";
          return (
            <tr key={r.supplier.id} className={`border-t border-neutral-200 ${bg} hover:brightness-95`}>
              <td className="px-3 py-2 text-sm font-medium text-neutral-800">
                {r.supplier.name}
              </td>
              <td className="px-2 py-2 text-xs text-neutral-400">{r.supplier.description ?? ""}</td>
              {r.days.map((v, di) => (
                <td key={di} className={`px-2 py-2 text-right tabular-nums text-sm ${v ? "text-neutral-800 font-medium" : "text-neutral-300"}`}>
                  {fmt(v) || "–"}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-neutral-900 border-l border-neutral-200">
                {fmt(r.total)}
              </td>
              <td className="px-2 py-2 text-xs text-neutral-500">
                {r.supplier.bank && `${r.supplier.bank} ${r.supplier.account_number ?? ""}`}
                {r.supplier.internal_account && <span className="font-medium text-blue-600">{r.supplier.internal_account}</span>}
              </td>
            </tr>
          );
        })}
      </>
    );
  }

  function TotalRow({ label, total }: { label: string; total: number }) {
    return (
      <tr className="border-t-2 border-neutral-400 bg-neutral-200 font-bold text-sm">
        <td colSpan={2} className="px-3 py-2 text-right text-neutral-700">{label}</td>
        {Array(7).fill(null).map((_, i) => <td key={i} />)}
        <td className="px-3 py-2 text-right tabular-nums text-neutral-900 border-l border-neutral-300">{fmt(total)}</td>
        <td />
      </tr>
    );
  }

  function SectionTable({ title, section, total, note }: { title: string; section: WeeklySupplierRow[]; total: number; note?: string }) {
    if (section.length === 0) return null;
    return (
      <div className="rounded-xl border border-neutral-300 bg-white overflow-hidden">
        <div className="border-b-2 border-neutral-300 bg-neutral-800 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">{title}</span>
          {note && <span className="text-xs text-neutral-400">{note}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-neutral-500 border-b-2 border-neutral-200 bg-neutral-50">
                <th className="px-3 py-2 text-left w-44">ซัพพลายเออร์</th>
                <th className="px-2 py-2 text-left">รายละเอียด</th>
                {DAY_LABELS.map((l, i) => (
                  <th key={i} className="px-2 py-2 text-right w-20">
                    <div className="font-semibold text-neutral-700">{l}</div>
                    <div className="text-neutral-400 font-normal">{days[i]?.slice(5).replace("-", "/")}</div>
                  </th>
                ))}
                <th className="px-3 py-2 text-right w-24 border-l border-neutral-200 text-neutral-700 font-semibold">รวม</th>
                <th className="px-2 py-2 text-left w-32">บัญชี</th>
              </tr>
            </thead>
            <tbody>
              <SupplierRows section={section} />
              <TotalRow label={`รวม ${title}`} total={total} />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Print layout ─────────────────────────────────────────────────

  function PrintTable({ title, section, total }: { title: string; section: WeeklySupplierRow[]; total: number }) {
    if (!section.length) return null;
    // Portrait A4 usable ≈ 186mm: name 52mm + 7×18mm(126mm) + total 20mm = 198mm → use 9px font + tight padding
    return (
      <div style={{ marginBottom: "10px" }}>
        <div style={{ fontWeight: 700, fontSize: "10px", marginBottom: "2px", borderBottom: "1px solid #aaa", paddingBottom: "2px", letterSpacing: "0.02em" }}>{title}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
          <colgroup>
            <col style={{ width: "27%" }} />
            {DAY_LABELS.map((_, i) => <col key={i} style={{ width: "9%" }} />)}
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc", color: "#666" }}>
              <th style={{ textAlign: "left", padding: "1px 3px 2px 0" }}>ซัพพลายเออร์</th>
              {DAY_LABELS.map((l, i) => (
                <th key={i} style={{ textAlign: "right", padding: "1px 2px 2px" }}>
                  {l}<br />
                  <span style={{ fontSize: "7.5px", color: "#bbb" }}>{days[i]?.slice(5).replace("-", "/")}</span>
                </th>
              ))}
              <th style={{ textAlign: "right", padding: "1px 0 2px 2px" }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {section.map((r, ri) => {
              const bankInfo = r.supplier.bank
                ? `${r.supplier.bank} ${r.supplier.account_number ?? ""}`
                : r.supplier.internal_account ?? "";
              const zebra = ri % 2 === 0 ? "#ffffff" : "#efefef";
              return (
                <tr key={r.supplier.id} style={{ borderBottom: "1px solid #ddd", backgroundColor: zebra }}>
                  <td style={{ padding: "2px 3px 2px 0", lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 600 }}>{r.supplier.name}</div>
                    {bankInfo && <div style={{ fontSize: "7.5px", color: "#888" }}>{bankInfo}</div>}
                  </td>
                  {r.days.map((v, di) => (
                    <td key={di} style={{ textAlign: "right", padding: "2px", fontVariantNumeric: "tabular-nums", color: v ? "#111" : "#ccc" }}>
                      {fmt(v) || "–"}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", padding: "2px 0 2px 2px", fontWeight: 700, fontVariantNumeric: "tabular-nums", borderLeft: "1px solid #bbb" }}>
                    {fmt(r.total)}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid #888", fontWeight: 700, backgroundColor: "#d4d4d4" }}>
              <td colSpan={8} style={{ textAlign: "right", padding: "2px 2px" }}>รวม</td>
              <td style={{ textAlign: "right", padding: "2px 0 2px 2px", fontVariantNumeric: "tabular-nums", borderLeft: "1px solid #999" }}>{fmt(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { size: A4 portrait; margin: 10mm 12mm; }
        }
        .print-only { display: none; }
      `}</style>

      {/* ── Print layout ─────────────────────────────── */}
      <div className="print-only" style={{ fontFamily: "Sarabun, TH SarabunNew, Arial, sans-serif", fontSize: "9.5px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", borderBottom: "2px solid #333", paddingBottom: "5px" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700 }}>ใบโอนเงิน</div>
            <div style={{ fontSize: "9.5px", color: "#555" }}>สัปดาห์ {weekLabel}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "9.5px", color: "#555" }}>
            <div>โอนวันอังคาร: <strong>{nextTuesday}</strong></div>
            <div>บัญชีต้นทาง: {sourceAccount}</div>
          </div>
        </div>
        <PrintTable title="เครดิต (โอน)" section={sectionA} total={totalA} />
        <PrintTable title="เครดิต (จ่ายสด)" section={sectionB} total={totalB} />
        <PrintTable title="โอนทันที (ออกจากบัญชีร้าน)" section={sectionC} total={totalC} />
        <div style={{ borderTop: "2px solid #333", paddingTop: "5px", display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "12px", marginTop: "4px" }}>
          <span>รวมทั้งสิ้น</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(grandTotal)} บาท</span>
        </div>
      </div>

      {/* ── Screen controls ─────────────────────────── */}
      <div className="no-print space-y-4">
        {/* Week picker */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => router.push(`/owner/accounting/transfer-slip?week=${prevWeekTuesday(tuesday)}`)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
            ← สัปดาห์ก่อน
          </button>

          <button type="button"
            onClick={() => weekInputRef.current?.showPicker?.() ?? weekInputRef.current?.click()}
            className="relative flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            <svg className="h-4 w-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            สัปดาห์ {weekLabel}
            <input ref={weekInputRef} type="date" value={tuesday}
              onChange={(e) => router.push(`/owner/accounting/transfer-slip?week=${e.target.value}`)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full" tabIndex={-1} />
          </button>

          <button onClick={() => router.push(`/owner/accounting/transfer-slip?week=${nextWeekTuesday(tuesday)}`)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
            สัปดาห์ถัดไป →
          </button>

          <div className="ml-auto flex gap-2">
            <button onClick={exportExcel}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              Export Excel
            </button>
            <button onClick={() => window.print()}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              พิมพ์
            </button>
          </div>
        </div>

        {/* Source account */}
        <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-sm">
          <span className="text-neutral-600 font-medium">บัญชีต้นทาง:</span>
          <input type="text" value={sourceAccount} onChange={(e) => setSourceAccount(e.target.value)}
            className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm focus:border-blue-400 focus:outline-none w-48" />
          <span className="text-neutral-400 text-xs">โอนวัน: {nextTuesday}</span>
        </div>

        {rows.every((r) => r.total === 0) ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-10 text-center space-y-2">
            <p className="text-sm text-neutral-500 font-medium">ไม่มีรายการที่ผูกซัพพลายเออร์ในสัปดาห์นี้</p>
            {unlinkedCount > 0 ? (
              <p className="text-sm text-amber-600">
                พบ <strong>{unlinkedCount}</strong> รายการในสัปดาห์นี้ที่ยังไม่ได้เลือกซัพ —{" "}
                <a href={`/owner/accounting/daily?date=${days[0]}`} className="underline hover:text-amber-800">
                  ไปแก้ไขในหน้าบันทึกรายวัน
                </a>
              </p>
            ) : (
              <p className="text-xs text-neutral-400">ยังไม่มีรายการในสัปดาห์นี้เลย</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <SectionTable title="เครดิต (โอน)" section={sectionA} total={totalA}
              note="โอนวันอังคาร" />
            <SectionTable title="เครดิต (จ่ายสด)" section={sectionB} total={totalB}
              note="วิยะดา / หนึ่งฤทัย — จ่ายสดในวันนัดรับ" />
            <SectionTable title="โอนทันที (ออกจากบัญชีร้าน)" section={sectionC} total={totalC} />

            {/* Grand total */}
            <div className="rounded-xl border border-neutral-300 bg-neutral-50 px-5 py-4 flex items-center justify-between">
              <span className="font-semibold text-neutral-700">รวมทั้งสิ้น (โอน + สด + ทันที)</span>
              <span className="text-2xl font-bold tabular-nums text-neutral-900">{fmt(grandTotal)} ฿</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
