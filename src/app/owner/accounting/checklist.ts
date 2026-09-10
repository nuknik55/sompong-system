/**
 * The start-of-month checklist: five steps for the month that just closed,
 * each marked from EVIDENCE the imports leave behind, never from a tick
 * somebody set. Pure — the server action gathers the evidence, this decides.
 *
 * Where the evidence is exact (a provenance row per month) the step gets a
 * tick. Where it is partial — one "last" row with no history, a table that
 * says "uploaded" but not "the right range" — the step shows a date and says
 * what the date is, so nobody reads a weak signal as a strong one.
 *
 * No imports: this runs under `node --test`.
 */

export type StepState = "done" | "open" | "partial";

export type ChecklistStep = {
  key: "prices" | "sales" | "classify" | "revenue" | "monthly";
  title: string;
  href: string;
  /** Owner-only link: hidden for admins, the step still shows. */
  ownerOnly: boolean;
  state: StepState;
  /** What the evidence says, in words. */
  detail: string;
};

export type ChecklistEvidence = {
  /** pos_receipt_deliveries: the newest document date and the newest upload time. */
  deliveries: { newestDocumentDate: string | null; newestImportedAt: string | null };
  /** pos_import_meta "last", with its Thai period already resolved by the caller. null = no row. */
  salesImport: { yearMonth: string | null; period: string; importedAt: string | null } | null;
  /** pos_revenue_imports row for the month. */
  revenueImportedAt: string | null;
  /** outsource_imports row for the month. */
  outsource: { importedAt: string; expensesWritten: boolean } | null;
  /** budget69_imports row for the month (Jan–Jul 2569 only). */
  budget69ImportedAt: string | null;
};

export type Checklist = {
  yearMonth: string;
  steps: ChecklistStep[];
  openCount: number;
  allDone: boolean;
  /** Fewer than three steps open: show one line, expand on demand. */
  collapsed: boolean;
};

export function previousMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}
export function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export function thaiMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 0) + 543}`;
}
function thaiDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 0) + 543}`;
}

export function deriveChecklist(ev: ChecklistEvidence, yearMonth: string): Checklist {
  const firstOfNext = `${nextMonth(yearMonth)}-01`;

  // 1. Prices from the receipt report. The importer upserts on conflict and
  //    keeps the first insert's imported_at, so "uploaded after the month
  //    closed" cannot be read from that column. The honest rule: the
  //    deliveries record reaches past the end of the month.
  const d = ev.deliveries;
  const prices: ChecklistStep = {
    key: "prices", title: "ราคาวัตถุดิบ จากรายงานรับของ (POS)", href: "/owner/ingredients", ownerOnly: false,
    ...(d.newestDocumentDate !== null && d.newestDocumentDate >= firstOfNext
      ? { state: "done" as const, detail: `รายการรับของถึง ${thaiDate(d.newestDocumentDate)}${d.newestImportedAt ? ` (อัปโหลด ${thaiDate(d.newestImportedAt)})` : ""}` }
      : d.newestDocumentDate !== null
        ? { state: "open" as const, detail: `รายการรับของล่าสุดถึง ${thaiDate(d.newestDocumentDate)} — ยังไม่พ้นสิ้นเดือน` }
        : { state: "open" as const, detail: "ยังไม่เคยอัปโหลดรายงานรับของ" }),
  };

  // 2. Menu sales from SaleData. One "last" row, no history: an exact match
  //    is a tick, a later month is a date (this month may have been done and
  //    overwritten), anything else is open.
  const s = ev.salesImport;
  const sales: ChecklistStep = {
    key: "sales", title: "ยอดขายเมนู จาก SaleData (หน้าแรก)", href: "/owner", ownerOnly: false,
    ...(s === null
      ? { state: "open" as const, detail: "ยังไม่เคยนำเข้ายอดขาย" }
      : s.yearMonth === yearMonth
        ? { state: "done" as const, detail: `นำเข้า ${s.period}${s.importedAt ? ` เมื่อ ${thaiDate(s.importedAt)}` : ""}` }
        : s.yearMonth !== null && s.yearMonth > yearMonth
          ? { state: "partial" as const, detail: `ครั้งล่าสุดเป็น ${s.period} — ระบบเก็บเฉพาะครั้งล่าสุด จึงบอกไม่ได้ว่าเดือนนี้ทำแล้วหรือไม่` }
          : { state: "open" as const, detail: `ครั้งล่าสุดเป็น ${s.period}` }),
  };

  // 4. Revenue import: exact.
  const revenue: ChecklistStep = {
    key: "revenue", title: "นำเข้ารายได้ POS", href: "/owner/accounting/revenue-import", ownerOnly: false,
    ...(ev.revenueImportedAt
      ? { state: "done" as const, detail: `นำเข้าเมื่อ ${thaiDate(ev.revenueImportedAt)}` }
      : { state: "open" as const, detail: "ยังไม่ได้นำเข้า" }),
  };

  // 3. Classification: implied by 4 — the revenue import refuses unstored
  //    items, so a successful import means every item in the file was classified.
  const classify: ChecklistStep = {
    key: "classify", title: "จัดหมวดสินค้า POS", href: "/owner/accounting/coffee-items", ownerOnly: false,
    ...(revenue.state === "done"
      ? { state: "done" as const, detail: "ครบ — การนำเข้ารายได้ผ่านแล้ว จึงไม่มีสินค้าที่ยังไม่จัดหมวด" }
      : { state: "open" as const, detail: "ตรวจตอนนำเข้ารายได้ — ถ้ามีสินค้าใหม่ การนำเข้าจะหยุดให้จัดหมวดก่อน" }),
  };

  // 5. Monthly costs and `other` from the accountant's file. The outsource
  //    row is the tick. A budget69 row alone (Jan–Jul 2569) is the expenses
  //    without `other`, and says so.
  const o = ev.outsource;
  const monthly: ChecklistStep = {
    key: "monthly", title: "นำเข้ารายจ่ายรายเดือน + รายได้อื่นๆ (ไฟล์บัญชี)", href: "/owner/accounting/import", ownerOnly: true,
    ...(o
      ? { state: "done" as const, detail: `นำเข้าเมื่อ ${thaiDate(o.importedAt)}${o.expensesWritten ? "" : " (เฉพาะรายได้อื่นๆ — รายจ่ายจาก budget69)"}` }
      : ev.budget69ImportedAt
        ? { state: "partial" as const, detail: `รายจ่ายจาก budget69 เมื่อ ${thaiDate(ev.budget69ImportedAt)} — รายได้อื่นๆ ยังไม่ได้นำเข้าจากไฟล์บัญชี` }
        : { state: "open" as const, detail: "ยังไม่ได้นำเข้า — ต้องใช้บัญชีเจ้าของร้าน" }),
  };

  const steps = [prices, sales, classify, revenue, monthly];
  const openCount = steps.filter((x) => x.state !== "done").length;
  return { yearMonth, steps, openCount, allDone: openCount === 0, collapsed: openCount < 3 };
}
