/**
 * The CapEx question on an expense entry — queue item 9 (Nik, 2026-09-18).
 *
 * The rule the restaurant works to, written down nowhere until now: a newly
 * purchased ASSET over ฿20,000 is coded to CapEx (G990), not to the group
 * that bought it. One entry has ever been miscoded that way — a ฿29,853
 * vacuum sealer booked to 810 Supply - ครัว.
 *
 * IT WARNS AND DECIDES NOTHING. "Newly purchased asset" is the part a form
 * cannot infer from a number: ฿40,000 of crab is not an asset and ฿25,000 of
 * consulting is not either. So the screen asks the question and the person
 * answers it by choosing an account. Nothing is blocked, nothing is
 * reclassified, and an entry already saved is never revisited — new and
 * edited entries only.
 *
 * SCOPED TO EQUIPMENT AND SUPPLIES, which is what Nik asked for and what the
 * data supports: G400 ซ่อมบำรุง (Maintenance) and G800 อุปกรณ์ (Supply). Food
 * (G100) is excluded by his instruction. So are payroll, rent, utilities,
 * marketing, G&A, delivery, misc and tax — groups where a large amount is
 * ordinary and a question every time would be noise people learn to click
 * past. Of the 17 entries ≥ ฿20,000 in the database when this was written,
 * these two groups held exactly one: the sealer. The other 16 are consulting
 * fees, social security, vegetable oil, crab and security-guard invoices.
 */

/** The groups the question is asked in. Both hold equipment and supplies. */
export const CAPEX_GROUPS = ["G400", "G800"] as const;

/** Where an asset belongs instead. Never chosen automatically. */
export const CAPEX_TARGET_GROUP = "G990";

/** Used when app_settings has no usable value. The owner may change it. */
export const DEFAULT_CAPEX_THRESHOLD = 20000;

/**
 * The threshold as the app should use it, from whatever app_settings gave
 * back. Three things it has to survive:
 *
 *   - **the column not existing yet.** Until
 *     capex_threshold_setting_migration.sql runs, the SELECT fails and the
 *     row comes back null, so the question works on the default 20,000 the
 *     moment the code deploys and on the owner's figure after the SQL. The
 *     code and the migration can ship in either order.
 *   - **a numeric arriving as a string.** PostgREST does that often enough
 *     to matter, and "20000" > a number is not a comparison anyone wants.
 *   - **an explicit 0**, which is the owner turning the question off and must
 *     NOT be read as "missing, use the default".
 */
export function resolveCapexThreshold(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_CAPEX_THRESHOLD;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_CAPEX_THRESHOLD;
}

export function isCapexQuestionGroup(groupCode: string | null | undefined): boolean {
  return groupCode != null && (CAPEX_GROUPS as readonly string[]).includes(groupCode);
}

/**
 * Should the entry form ask whether this is CapEx?
 *
 * A threshold of 0 or less turns the question off — the owner's switch,
 * without a second setting to keep in step with the first. A negative amount
 * never asks: it is a return or a credit against a purchase already made
 * (negative amounts stay allowed with no warning, Nik 2026-09-18), and the
 * question about the purchase was asked when the purchase was entered.
 */
export function capexWarning(input: {
  amount: number;
  groupCode: string | null | undefined;
  threshold: number;
}): boolean {
  const { amount, groupCode, threshold } = input;
  if (!Number.isFinite(amount) || !Number.isFinite(threshold) || threshold <= 0) return false;
  if (!isCapexQuestionGroup(groupCode)) return false;
  return amount > threshold;
}

/**
 * The question, in Thai. It names the two things that are NOT assets, because
 * those are what these groups mostly hold — a warning that only says "this
 * might be CapEx" is one nobody can act on.
 */
export function capexWarningText(threshold: number): string {
  return (
    `ยอดเกิน ${threshold.toLocaleString("th-TH")} บาท ในหมวดอุปกรณ์/ซ่อมบำรุง — ` +
    `ถ้าเป็นการซื้อทรัพย์สินใหม่ที่ใช้ได้หลายปี ควรลงหมวด CapEx แทน ` +
    `(ถ้าเป็นค่าซ่อม ของใช้สิ้นเปลือง หรือของที่ซื้อประจำ บันทึกต่อได้เลย)`
  );
}
