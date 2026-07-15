"use client";

import { useState, useTransition, useRef } from "react";
import { bulkInsertEntries } from "../actions";
import { unstable_rethrow } from "next/navigation";

// Category name → COA code mapping from อู๋'s Excel file
const CATEGORY_MAP: Record<string, string> = {
  "ผักสด": "110",
  "ของสด": "120",
  "ของแห้ง": "130",
  "ข้าวสาร": "140",
  "มะม่วง": "150",
  "กะทิ": "151",
  "ถั่วเหลือง": "152",
  "ข้าวเหนียวสาร": "153",
  "เครื่องดื่ม": "160",
  "น้ำแข็ง": "161",
  "ค่าขนส่งวัตถุดิบ": "170",
  "วัสดุหีบห่อ": "171",
  "วัสดุหีบห่อ(กล่อง)": "171",
  "วัสดุหีบห่อ(ถุงซีล)": "172",
  "เงินเดือนพนักงาน": "220",
  "ค่าอาหารพนักงาน": "221",
  "ประกันสังคม": "230",
  "ค่าเช่าที่ดิน": "310",
  "ค่าเสื่อมราคา": "320",
  "ค่าซ่อมบำรุง": "340",
  "ค่าถังขยะ": "350",
  "ค่ายาม": "370",
  "ค่าแก๊ส": "510",
  "ค่าไฟ": "520",
  "ค่าน้ำประปา": "530",
  "ค่าเก็บขยะ": "540",
  "ค่าน้ำ": "530",
  "ค่าอินเตอร์เน็ต": "560",
  "ค่าโทรศัพท์": "560",
  "ค่าโฆษณา": "610",
  "ค่าขนส่ง": "751",
  "ค่าขนส่ง(ลูกค้า)": "751",
  "ค่าธรรมเนียม": "760",
  "ค่าธรรมเนียมธนาคาร": "760",
  "ค่าธรรมเนียม GP": "761",
  "เบ็ดเตล็ด": "790",
  "อื่นๆ": "790",
};

const THAI_MONTHS: Record<string, number> = {
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
  "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
  "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
};

type PreviewRow = {
  date: string;
  category: string;
  coa_code: string | null;
  amount: number;
  note?: string;
};

export function ImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearMonth, setYearMonth] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null);
    setUnmapped([]);
    setResult(null);
    setError(null);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });

      const rows: PreviewRow[] = [];
      const missing = new Set<string>();

      for (const sheetName of wb.SheetNames) {
        // Parse sheet name for month/year (e.g. "มกราคม 69", "มค.69", "1")
        let sheetMonth: number | null = null;
        let sheetYear = 2026; // default BE 2569 → CE 2026
        for (const [thName, thNum] of Object.entries(THAI_MONTHS)) {
          if (sheetName.includes(thName)) {
            sheetMonth = thNum;
            break;
          }
        }
        // Also try numeric sheet names (1-12)
        if (!sheetMonth) {
          const n = parseInt(sheetName);
          if (!isNaN(n) && n >= 1 && n <= 12) sheetMonth = n;
        }
        // Extract year from sheet name (69 → 2026, 2569 → 2026)
        const yearMatch = sheetName.match(/(\d{2,4})/);
        if (yearMatch) {
          const raw = parseInt(yearMatch[1]!);
          sheetYear = raw > 2500 ? raw - 543 : raw > 100 ? raw : raw + 2500 - 543;
        }

        if (!sheetMonth) continue; // skip non-month sheets

        const ws = wb.Sheets[sheetName]!;
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1, defval: "" });

        for (const rawRow of data) {
          const cells = Object.values(rawRow as Record<number, unknown>);
          // Expect: [date-or-empty, category-name, amount, note?]
          // Find category (string) and amount (number > 0)
          let category: string | null = null;
          let amount: number | null = null;
          let dateStr: string | null = null;
          let note: string | null = null;

          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (typeof cell === "string" && cell.trim().length > 1 && !category) {
              // Check if it's a date string like "1/1/69" or a number-encoded date
              if (/^\d{1,2}\/\d{1,2}/.test(cell.trim())) {
                dateStr = cell.trim();
              } else if (Object.keys(CATEGORY_MAP).some((k) => cell.includes(k))) {
                // exact or partial match
                const match = Object.keys(CATEGORY_MAP).find((k) => cell.includes(k));
                category = match ?? cell.trim();
              } else {
                category = cell.trim();
                // Could be a note if there's already a category
              }
            }
            if (typeof cell === "number" && cell > 0 && !amount) {
              amount = cell;
            }
          }

          // Fallback: try first string col as category, first number as amount
          if (!category) {
            for (const cell of cells) {
              if (typeof cell === "string" && cell.trim().length > 1) { category = cell.trim(); break; }
            }
          }
          if (!amount) {
            for (const cell of cells) {
              if (typeof cell === "number" && cell > 0) { amount = cell; break; }
            }
          }

          if (!category || !amount) continue;
          if (amount < 1) continue; // skip zero/tiny amounts

          // Build date: default to 15th of month if no specific date
          let entryDate: string;
          if (dateStr) {
            const parts = dateStr.split("/");
            const d = parseInt(parts[0] ?? "15");
            const m = parseInt(parts[1] ?? String(sheetMonth));
            const y = parts[2] ? (parseInt(parts[2]!) > 2500 ? parseInt(parts[2]!) - 543 : parseInt(parts[2]!) + 2500 - 543) : sheetYear;
            entryDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          } else {
            entryDate = `${sheetYear}-${String(sheetMonth).padStart(2, "0")}-15`;
          }

          const coaCode = Object.entries(CATEGORY_MAP).find(([k]) => category!.includes(k))?.[1] ?? null;
          if (!coaCode) missing.add(category);

          rows.push({ date: entryDate, category, coa_code: coaCode, amount, note: note ?? undefined });
        }
      }

      setPreview(rows);
      setUnmapped([...missing]);
      // Guess yearMonth from first row
      if (rows.length > 0) setYearMonth(rows[0]!.date.slice(0, 7));
    } catch (err) {
      setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
    }
  }

  function handleImport() {
    if (!preview) return;
    const valid = preview.filter((r) => r.coa_code !== null);
    if (valid.length === 0) { setError("ไม่มีรายการที่แมปได้"); return; }

    startTransition(async () => {
      try {
        const entries = valid.map((r) => ({
          entry_date: r.date,
          coa_code: r.coa_code!,
          amount: r.amount,
          note: r.category !== r.note ? r.category : undefined,
          payment_method: "cash" as const,
        }));
        const n = await bulkInsertEntries(entries);
        setResult({ imported: n, skipped: (preview?.length ?? 0) - valid.length });
        setPreview(null);
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "นำเข้าไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* File picker */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-3">
        <p className="text-sm font-medium text-neutral-700">เลือกไฟล์ Excel ของอู๋ (ม.ค.–มิ.ย. 69)</p>
        <p className="text-xs text-neutral-400">รองรับ .xlsx / .xls — แต่ละ sheet = 1 เดือน ชื่อ sheet ควรมีชื่อเดือนภาษาไทยหรือตัวเลข</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFile}
          className="block text-sm text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-neutral-200"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          นำเข้าสำเร็จ {result.imported} รายการ
          {result.skipped > 0 && ` (ข้าม ${result.skipped} รายการที่ไม่มีรหัสบัญชี)`}
        </div>
      )}

      {unmapped.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-medium text-amber-800 mb-2">หมวดที่ไม่พบในระบบ (จะข้ามไป):</p>
          <div className="flex flex-wrap gap-2">
            {unmapped.map((u) => (
              <span key={u} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{u}</span>
            ))}
          </div>
        </div>
      )}

      {/* COA mapping reference */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 border-b border-neutral-200">
          ตารางแมปหมวดบัญชี
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-neutral-400">
                <th className="px-3 py-1.5">ชื่อในไฟล์</th>
                <th className="px-3 py-1.5">รหัสบัญชี</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(CATEGORY_MAP).map(([k, v]) => (
                <tr key={k} className="border-t border-neutral-50">
                  <td className="px-3 py-1 text-neutral-600">{k}</td>
                  <td className="px-3 py-1 tabular-nums text-neutral-400">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview table */}
      {preview && preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-700">
              ตัวอย่างข้อมูล ({preview.length} รายการ, แมปได้ {preview.filter((r) => r.coa_code).length} รายการ)
            </p>
            <button
              type="button"
              onClick={handleImport}
              disabled={isPending}
              className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              {isPending ? "กำลังนำเข้า..." : `นำเข้า ${preview.filter((r) => r.coa_code).length} รายการ`}
            </button>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200">
                  <tr className="text-left text-neutral-400">
                    <th className="px-3 py-2">วันที่</th>
                    <th className="px-3 py-2">หมวด</th>
                    <th className="px-3 py-2">รหัสบัญชี</th>
                    <th className="px-3 py-2 text-right">จำนวน (฿)</th>
                    <th className="px-3 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-neutral-50">
                      <td className="px-3 py-1 tabular-nums text-neutral-500">{r.date}</td>
                      <td className="px-3 py-1 text-neutral-700">{r.category}</td>
                      <td className="px-3 py-1 tabular-nums">{r.coa_code ?? "—"}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {r.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-1">
                        {r.coa_code ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-amber-500">ข้าม</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {preview.length > 200 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-center text-neutral-400">
                        แสดง 200 รายการแรก จาก {preview.length} รายการทั้งหมด
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {preview && preview.length === 0 && (
        <p className="text-center text-sm text-neutral-400 py-4">
          ไม่พบข้อมูลในไฟล์ — ตรวจสอบชื่อ sheet ว่ามีชื่อเดือนภาษาไทยหรือตัวเลข 1-12
        </p>
      )}
    </div>
  );
}
