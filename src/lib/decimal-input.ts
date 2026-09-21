// A box a number is TYPED into holds the text, not the number.
//
// The recipe quantity box kept only the parsed number and showed it back, so
// a half-typed "1." became "1" before the next key arrived: 1.5 typed key by
// key was saved as 15, backspacing the 5 of 1.5 and typing 5 gave 15, 0.5
// gave 5 and 1.05 gave 105 — a tenfold quantity, so a tenfold line cost,
// with a plausible number on screen (Nik, 2026-09-21). The ingredient
// manager's number boxes — price, pack size, yield, par level — did the same.
//
// The rule for any such box: while a person is typing, it shows exactly what
// they typed ("1.", "0.", "1.50", or nothing), and the number is read from
// that text wherever it is used. Once they leave the box it shows the stored
// value again. The components call these functions for both halves, and
// decimal-input.test.ts types into them key by key.

/** Digits and the first "." — anything else typed is dropped. */
export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

/** The number the text means, or null while it means none yet ("" or "."). */
export function parseDecimalInput(text: string): number | null {
  if (text === "" || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** What a box shows: the text being typed while there is one, else the stored value. */
export function decimalBoxText(draft: string | null, value: number | null): string {
  return draft ?? (value == null ? "" : String(value));
}

/** One keystroke: the text to keep showing, and the value it means. */
export function decimalBoxInput(raw: string): { text: string; value: number | null } {
  const text = sanitizeDecimalInput(raw);
  return { text, value: parseDecimalInput(text) };
}

// The recipe quantity box. A quantity of 0 shows as an empty box (its
// placeholder reads 0) and an empty box means 0, as they always have.
export function recipeQtyText(draft: string | null, quantity: number): string {
  return decimalBoxText(draft, quantity === 0 ? null : quantity);
}

export function recipeQtyInput(raw: string): { text: string; quantity: number } {
  const { text, value } = decimalBoxInput(raw);
  return { text, quantity: value ?? 0 };
}
