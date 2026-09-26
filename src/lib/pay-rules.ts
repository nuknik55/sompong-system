/**
 * Pay that a role may not see is NULL, never 0 (Nik, 2026-09-26).
 *
 * Since security_fixes_and_menu_save_lock_migration.sql (applied 2026-09-26)
 * the four pay columns of `employees` are served to owner and hr only
 * (the view employee_pay). Admin reads every employee without them. A 0 in
 * their place reads as "this person earns nothing", and a 0 is a number
 * something can compute from and save; a null is neither. So: hidden pay is
 * null, a screen shows it as "—", and no save accepts a pay figure that is
 * not a real number, so nothing derived from unread pay can be written.
 */

export type PayFigures = {
  base_salary: number | null;
  position_allowance: number | null;
  social_security_monthly: number | null;
  daily_wage: number | null;
};

/** What a role that may not see pay gets in its place. */
export const NO_PAY: PayFigures = { base_salary: null, position_allowance: null, social_security_monthly: null, daily_wage: null };

/** A pay figure that may be saved: a finite number, 0 or more. */
export function isPayFigure(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export const PAY_UNREAD_REFUSAL =
  "ไม่ได้บันทึก — ข้อมูลเงินเดือนของพนักงานคนนี้อ่านไม่ได้หรือยังไม่ได้ใส่ (ต้องเป็นตัวเลข 0 ขึ้นไป) กรุณารีเฟรช (F5) แล้วลองใหม่";

/**
 * Null when the three monthly figures are real numbers and the daily wage is
 * one or empty; otherwise the refusal. Checked by every save of an employee.
 */
export function payFiguresProblem(e: { base_salary: unknown; position_allowance: unknown; social_security_monthly: unknown; daily_wage?: unknown }): string | null {
  if (!isPayFigure(e.base_salary) || !isPayFigure(e.position_allowance) || !isPayFigure(e.social_security_monthly)) return PAY_UNREAD_REFUSAL;
  if (e.daily_wage != null && !isPayFigure(e.daily_wage)) return PAY_UNREAD_REFUSAL;
  return null;
}

