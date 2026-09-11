/**
 * The two rules the service function sheet (document A) turns booking data
 * into paper with. Pure and tested, because neither can be verified through
 * the app: the catering module holds one test booking, every set-menu row is
 * still `section = 'dish'`, and no booking carries a transport, service or
 * deposit figure. Fixtures can exercise what the database cannot yet.
 *
 * Nothing here reads cost. The service sheet has no prices on its food list —
 * the service team needs to know what goes out, not what it costs.
 */

/** A printed food line. No price: see the file header. */
export type SheetLine = {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
};

/**
 * A section WITH ROWS. groupBySection never emits an empty one, which is how
 * the print contract is enforced: a section with no rows prints nothing at
 * all — no heading, no empty row. A package with no dessert is a package with
 * no dessert, not a document with a blank ขนมหวาน line.
 */
export type SheetGroup = {
  key: string;
  label: string;
  lines: SheetLine[];
};

export type SheetPackage = {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
  groups: SheetGroup[];
};

/**
 * One of the paper form's four money fields. `amount: null` means "print a
 * ruled line for the service team to write on", and is NOT the same as 0 —
 * a ฿0 delivery charge is a decision someone made, a blank is a question
 * nobody has answered yet. Printing 0 for both would tell the team the
 * restaurant had decided something it had not.
 */
export type MoneyField = { label: string; amount: number | null };

/** Just enough of catering_set_menu_items for the grouping. */
type SectionRow = {
  id: string;
  menu_name: string;
  quantity: number;
  note: string | null;
  section: string;
};

/** Just enough of catering_event_charges for the money fields. */
type ChargeRow = { charge_type: string; amount: number };

/**
 * Group a package's rows into the print sections, IN THE ORDER GIVEN, dropping
 * every section with no rows.
 *
 * Order comes from the caller (SET_MENU_SECTIONS) rather than being hardcoded
 * here so the print order has one definition, beside the section values that
 * mirror the CHECK constraint.
 *
 * A row whose section is not in the list is dropped rather than shown under a
 * heading of its own: the CHECK constraint makes that unreachable from the
 * database, and inventing a heading for an impossible value would put a group
 * on a printed document that nobody chose.
 */
export function groupBySection(
  rows: SectionRow[],
  sections: { value: string; label: string }[],
): SheetGroup[] {
  const out: SheetGroup[] = [];
  for (const { value, label } of sections) {
    const lines = rows
      .filter((r) => r.section === value)
      .map((r) => ({ id: r.id, name: r.menu_name, quantity: r.quantity, note: r.note }));
    if (lines.length > 0) out.push({ key: value, label, lines });
  }
  return out;
}

/**
 * The four money fields, in the paper form's order, each either a figure the
 * booking already holds or a ruled line.
 *
 * ── WHY ค่าไฟ IS ALWAYS A RULED LINE ──────────────────────────────────────
 *
 * It is a finding, not an omission. The band's electricity exists as a rate
 * (catering_rates, rate_type 'music', "ค่าไฟวงดนตรีลูกค้า (1,000-3,000 ตามจริง)"),
 * but RATE_TYPE_TO_CHARGE_TYPE maps 'music' to charge_type 'other' — the same
 * bucket as เบี้ยเลี้ยง and every typed อื่นๆ line. So there is no structural
 * way to tell a ค่าไฟ charge from its neighbours, and matching the label text
 * would be guessing at free text someone typed. The service team writes it by
 * hand, exactly as they do today. If Nik wants it filled in automatically the
 * fix is upstream — give it a charge type of its own — not a string match here.
 */
export function moneyFields(
  charges: ChargeRow[],
  depositAmount: number | null,
): MoneyField[] {
  // No rows at all -> null (a ruled line). Rows that happen to sum to zero ->
  // 0, which prints, because somebody entered them.
  const sumOf = (type: string): number | null => {
    const rows = charges.filter((c) => c.charge_type === type);
    return rows.length > 0 ? rows.reduce((s, c) => s + c.amount, 0) : null;
  };

  return [
    // 'transport' is what rate_type 'delivery' maps to.
    { label: "ค่าขนส่ง", amount: sumOf("transport") },
    // 'service' is reachable only from the manual "+ พิมพ์รายการเอง" row's own
    // select — no rate maps to it — so a service charge is always a
    // deliberately typed line.
    { label: "Service", amount: sumOf("service") },
    { label: "ค่าไฟ", amount: null },
    { label: "ค่ามัดจำ", amount: depositAmount },
  ];
}
