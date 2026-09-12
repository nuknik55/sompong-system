/**
 * The quote / deposit / invoice document's rules (document C). One route, one
 * number, three states — pure and tested, because the money on these three
 * pages is the money a customer is asked to pay and the arithmetic must not
 * be something only a screenshot can check.
 */

export const DOC_STATES = ["quote", "deposit", "invoice"] as const;
export type DocState = (typeof DOC_STATES)[number];

/**
 * The ?doc= parameter, defaulting to the quote.
 *
 * Defaulting rather than rejecting is deliberate: the booking screen's
 * existing link carries no parameter at all, and a stray value should show
 * the quote rather than a blank page — the quote is the document that always
 * exists, since a quote_number is what makes any of the three renderable.
 */
export function parseDocState(raw: string | undefined): DocState {
  return (DOC_STATES as readonly string[]).includes(raw ?? "") ? (raw as DocState) : "quote";
}

export const DOC_TITLE: Record<DocState, string> = {
  quote: "ใบเสนอราคา",
  deposit: "ใบมัดจำ",
  invoice: "ใบแจ้งหนี้",
};

export type DocMoney = {
  /** Sum of the charge lines. */
  total: number;
  /**
   * The agreed percentage. THREE states, from Nik:
   *   null  = not yet discussed — the conditions print "______%" to write in
   *   0     = agreed: NO deposit — every deposit clause and row is omitted;
   *           not a blank and not "0%"
   *   1-100 = agreed percent — clause and computed figure print
   */
  percent: number | null;
  /** total × percent, or null when there is no agreed percentage. */
  depositDue: number | null;
  /** What was actually received, from catering_events.deposit_amount. */
  depositPaid: number | null;
  /**
   * total − depositPaid. Uses what was RECEIVED, never what was due: a
   * customer who rounded ฿4,500 up to ฿5,000 owes the smaller balance, and an
   * invoice that billed them the computed figure instead would be wrong by
   * the rounding. null when nothing has been received, because "balance" then
   * means the same as the total and printing it twice invites a double
   * payment.
   */
  balance: number | null;
};

export function docMoney(
  total: number,
  percent: number | null,
  depositPaid: number | null,
): DocMoney {
  const depositDue = percent == null ? null : Math.round(total * percent) / 100;
  return {
    total,
    percent,
    depositDue,
    depositPaid,
    balance: depositPaid == null ? null : total - depositPaid,
  };
}

/**
 * The conditions printed beneath the table.
 *
 * ── PROVENANCE, AND IT MATTERS ────────────────────────────────────────────
 *
 * This is Nik's wording, read off photographs of ONE job's paperwork — 15
 * days' validity and a deposit to confirm on the quote; 7 days' notice to
 * cancel or postpone, no refund of deposit, balance due on completion on the
 * invoice. It is NOT a policy document he has stated, and it has not been
 * reviewed as one.
 *
 * It replaces earlier text that was invented outright (30 days, 50%, 7-day
 * cancellation), which was worse: that was boilerplate nobody at Sompong had
 * ever written, printing on a customer-facing document as if it were policy.
 * Observed-from-one-job is a weaker claim than stated-policy but a much
 * stronger one than invented.
 *
 * Nik is being asked to confirm the final wording. Until he does, treat every
 * line here as provisional and do not add to it.
 *
 * The deposit percentage is the one part that is NOT fixed text: it comes from
 * the event, and where no percentage has been agreed the line leaves a blank
 * rather than naming a number.
 */
export function conditionsFor(state: DocState, percent: number | null): string[] {
  // 0 = agreed no deposit. Every line that presumes a deposit exists is
  // omitted — no "0%", no blank. The 7-day notice term survives (it is Nik's
  // term regardless of deposit), but without its no-refund tail: asserting
  // "no refund of the deposit" on a job with no deposit reads as a threat
  // about money that was never taken.
  const noDeposit = percent === 0;
  const pct = percent == null ? "______" : trimPercent(percent);
  const cancel = noDeposit
    ? "แจ้งยกเลิกหรือเลื่อนงานล่วงหน้าอย่างน้อย 7 วัน"
    : "แจ้งยกเลิกหรือเลื่อนงานล่วงหน้าอย่างน้อย 7 วัน มิฉะนั้นขอสงวนสิทธิ์ไม่คืนเงินมัดจำ";
  switch (state) {
    case "quote":
      return [
        "ใบเสนอราคานี้มีอายุ 15 วันนับจากวันที่ออกเอกสาร",
        ...(noDeposit ? [] : [`ชำระเงินมัดจำ ${pct}% ของยอดรวม เพื่อยืนยันการจอง`]),
      ];
    case "deposit":
      return [
        ...(noDeposit ? [] : [
          `ยอดมัดจำคิดจาก ${pct}% ของยอดรวมตามใบเสนอราคา`,
          "เมื่อชำระมัดจำแล้ว ถือว่ายืนยันการจองงาน",
        ]),
        cancel,
      ];
    case "invoice":
      return [
        "ชำระยอดคงเหลือเมื่อเสร็จงาน",
        cancel,
      ];
  }
}

/** 30 -> "30", 33.5 -> "33.5". Never "30.00" on a customer document. */
function trimPercent(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Money on the CUSTOMER documents: whole baht prints whole, satang prints
 * only when present — 2,500 not 2,500.00, but 547.06 stays 547.06 (and
 * 547.5 prints 547.50, because half-written satang reads as a typo). Forced
 * .00 everywhere reads as machine output, not a document someone prepared.
 * Staff screens keep fmtBaht's fixed two decimals; this is print-only.
 */
export function fmtMoneyDoc(n: number): string {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Which money rows print under the table, in order, for each state.
 *
 * The quote shows only the total: nothing has been received, and a deposit
 * line there would read as a demand rather than a term. The deposit document
 * shows what is due. The invoice shows what was received and what is left.
 */
export function moneyRowsFor(state: DocState, m: DocMoney): { label: string; amount: number; strong?: boolean }[] {
  const rows: { label: string; amount: number; strong?: boolean }[] = [
    { label: "รวมทั้งหมด", amount: m.total, strong: true },
  ];
  // percent 0 (agreed no deposit) prints no deposit row anywhere — the guard
  // is on the percent being a positive agreement, not on depositDue, which is
  // honestly 0 in that case and would otherwise print "เงินมัดจำ 0% ... 0.00".
  if (state === "deposit" && m.percent != null && m.percent > 0 && m.depositDue != null) {
    rows.push({ label: `เงินมัดจำ ${trimPercent(m.percent)}%`, amount: m.depositDue, strong: true });
  }
  if (state === "invoice") {
    // The POSITIVE figure under a หัก label — the label already carries the
    // sign, and "หัก ... -5,000.00" was double negation on a customer
    // document. The balance arithmetic is unchanged; only the printed sign.
    if (m.depositPaid != null) rows.push({ label: "หัก เงินมัดจำที่ชำระแล้ว", amount: m.depositPaid });
    if (m.balance != null) rows.push({ label: "ยอดคงเหลือ", amount: m.balance, strong: true });
  }
  return rows;
}
