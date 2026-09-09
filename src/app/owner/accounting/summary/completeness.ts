/**
 * Warnings about a month whose expense side is not a full month.
 *
 * Shared by the summary screen and the printable P&L so the two cannot drift.
 * The xlsx export is the reason this matters: a styled banner exists only on
 * screen, but the exported file travels — to the outsourced accountant, to
 * anyone who does not know the history — and July 2569's 78.2% operating
 * profit and 16.7% COGS read as fact once they are cells in a spreadsheet.
 *
 * Two conditions, deliberately worded apart because the causes differ and the
 * reader can do something about one of them:
 *
 *   expenseDataIncomplete  the record itself starts mid-month (July 2569, and
 *                          only ever that month) — permanent, nothing to wait
 *                          for, the figures will never be right
 *   monthInProgress        the month has not ended — temporary, the figures
 *                          become right on their own
 *
 * Both can hold at once, and then both lines are shown.
 */
export type MonthCompleteness = {
  expenseDataIncomplete: boolean;
  monthInProgress: boolean;
};

/** The notices that apply, in the order they should be shown. Empty when the month is sound. */
export function completenessNotices(c: MonthCompleteness): string[] {
  const notices: string[] = [];
  if (c.expenseDataIncomplete) {
    notices.push(
      "ข้อมูลไม่ครบ — เดือนนี้บันทึกรายจ่ายไม่ครบทั้งเดือน แต่รายได้เป็นของทั้งเดือน " +
        "ตัวเลข % ต้นทุนและ % กำไรทั้งหมดในหน้านี้จึงต่ำกว่าความจริง ห้ามใช้เทียบกับเดือนอื่น",
    );
  }
  if (c.monthInProgress) {
    notices.push(
      "เดือนนี้ยังไม่จบ — รายจ่ายยังบันทึกไม่ครบเดือนตามปกติ ตัวเลข % จะเปลี่ยนจนถึงสิ้นเดือน",
    );
  }
  return notices;
}

/**
 * Whether the profit figure may carry its usual red/amber/green judgement.
 *
 * On an incomplete month the colour is the most misleading element on the
 * page: July 2569 shows 78.2% and renders green, which reads as an excellent
 * month rather than as half the costs. The number still shows — hiding it
 * would be its own distortion — but without the verdict attached.
 */
export function profitJudgementAllowed(c: MonthCompleteness): boolean {
  return !c.expenseDataIncomplete && !c.monthInProgress;
}
