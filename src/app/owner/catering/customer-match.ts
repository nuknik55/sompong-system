/**
 * Which customer a TYPED name means — the name box filled in without picking
 * from the list. One rule for the booking screen, which says what the save
 * will do before it runs, and for saveBooking, which applies it to every
 * customer on file (queue item 50, Nik 2026-09-22: the booking attaches to
 * exactly the customer meant).
 *
 * The save used to take the first customer of that name, whatever the phone
 * said: with two customers of one name, a booking could attach to the other
 * one. Now nothing is guessed:
 *
 *   same       exactly one customer has this name AND this phone: that one.
 *   new        nobody has this name; or those who do each have ANOTHER real
 *              phone on file: a new customer, with the name and phone typed.
 *   ambiguous  otherwise — refused before anything is written, with the way
 *              out (`reason`):
 *                no-phone        no usable phone typed: pick from the list,
 *                                or give the new customer's phone;
 *                phoneless-twin  a customer of this name has no usable phone
 *                                on file, so the phone typed cannot tell them
 *                                apart: pick, or make the new name distinct;
 *                twins           several customers of this name share the
 *                                phone: pick from the list;
 *                phone-as-name   the name box holds a phone number: pick, or
 *                                type the name with the phone in its own box.
 *
 * A name is the same name after Unicode NFC, with zero-width characters
 * dropped, every run of whitespace (a no-break space too) read as one space,
 * trimmed, and case aside; a near-same name ("คุณป้อม", "ป้อม") is another
 * customer's. A phone is its digits, Thai digits read as digits and +66 as 0,
 * and only a phone of at least 9 digits proves anything: "000" or "123" is no
 * phone at all, so a placeholder can never make two people one (review,
 * 2026-09-22).
 */
export type CustomerMatch =
  | { kind: "same"; id: string }
  | { kind: "new"; sameName: number }
  | { kind: "ambiguous"; sameName: number; reason: "no-phone" | "phoneless-twin" | "twins" | "phone-as-name" };

export type CustomerForMatch = { id: string; name: string; phone: string | null };

/**
 * What a copy and paste can carry into a name unseen: zero-width space,
 * non-joiner and joiner, word joiner, byte-order mark. By code point, so that
 * no invisible character sits in this source.
 */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

export function normalizeCustomerName(s: string): string {
  const visible = [...s.normalize("NFC")].filter((ch) => !ZERO_WIDTH.has(ch.codePointAt(0) ?? 0)).join("");
  return visible.replace(/\s+/g, " ").trim().toLowerCase();
}

export function sameCustomerName(a: string, b: string): boolean {
  return normalizeCustomerName(a) === normalizeCustomerName(b);
}

/** A phone's digits, Thai digits read as digits and +66 as a leading 0; "" when it has too few to prove anything. */
export function usablePhone(p: string | null | undefined): string {
  const d = [...(p ?? "")]
    .map((ch) => { const c = ch.codePointAt(0) ?? 0; return c >= 0x0e50 && c <= 0x0e59 ? String(c - 0x0e50) : ch; })
    .join("")
    .replace(/[^0-9]/g, "");
  const local = d.length === 11 && d.startsWith("66") ? `0${d.slice(2)}` : d;
  return local.length >= 9 ? local : "";
}

/** A name box holding a phone number rather than a name: no letter at all, and a phone's worth of digits. */
function looksLikePhone(name: string): boolean {
  return !/[\p{L}]/u.test(name) && usablePhone(name) !== "";
}

export function matchTypedCustomer(name: string, phone: string | null | undefined, customers: readonly CustomerForMatch[]): CustomerMatch {
  const named = customers.filter((c) => sameCustomerName(c.name, name));
  if (looksLikePhone(name)) return { kind: "ambiguous", sameName: named.length, reason: "phone-as-name" };
  if (named.length === 0) return { kind: "new", sameName: 0 };
  const typed = usablePhone(phone);
  if (typed === "") return { kind: "ambiguous", sameName: named.length, reason: "no-phone" };
  const both = named.filter((c) => usablePhone(c.phone) === typed);
  if (both.length === 1) return { kind: "same", id: both[0].id };
  if (both.length > 1) return { kind: "ambiguous", sameName: named.length, reason: "twins" };
  if (named.some((c) => usablePhone(c.phone) === "")) return { kind: "ambiguous", sameName: named.length, reason: "phoneless-twin" };
  return { kind: "new", sameName: named.length };
}

/** Why a typed name was refused, in Thai, with the way out. */
export function ambiguousCustomerMessage(name: string, match: Extract<CustomerMatch, { kind: "ambiguous" }>): string {
  const many = match.sameName > 1 ? ` ${match.sameName} ราย` : "";
  switch (match.reason) {
    case "phone-as-name":
      return "ช่องนี้เป็นชื่อลูกค้า — ถ้าค้นด้วยเบอร์ ให้เลือกลูกค้าจากรายการ ถ้าเป็นลูกค้าใหม่ ให้พิมพ์ชื่อ แล้วใส่เบอร์ในช่องเบอร์โทร";
    case "twins":
      return `มีลูกค้าชื่อ “${name}” ที่ใช้เบอร์นี้อยู่แล้ว${many} — เลือกจากรายการชื่อลูกค้า`;
    case "phoneless-twin":
      return `มีลูกค้าชื่อ “${name}” ที่ยังไม่มีเบอร์โทรในระบบ จึงบอกไม่ได้ว่าเป็นคนเดียวกันหรือไม่ — ถ้าเป็นคนเดิม ให้เลือกจากรายการ (เพิ่มเบอร์ได้ที่หน้าลูกค้า) ถ้าเป็นคนละคน ให้ตั้งชื่อให้ต่างกัน เช่น เพิ่มนามสกุลหรือชื่อบริษัท`;
    default:
      return `มีลูกค้าชื่อ “${name}” อยู่แล้ว${many} — ถ้าเป็นคนเดิม ให้เลือกจากรายการชื่อลูกค้า ถ้าเป็นลูกค้าใหม่ ให้ใส่เบอร์โทรของลูกค้าใหม่ (อย่างน้อย 9 หลัก)`;
  }
}

/**
 * What saving a typed name will do, in Thai, shown under the name box before
 * the save. `bookingCustomerId`: the customer the booking belongs to now, if
 * any — a result that is another customer moves the booking off it.
 */
export function typedCustomerHint(match: CustomerMatch, name: string, bookingCustomerId: string | null): string {
  if (match.kind === "ambiguous") return ambiguousCustomerMessage(name, match);
  const away = bookingCustomerId ? " (งานนี้จะไม่เป็นของลูกค้าเดิมแล้ว — ถ้าจะแก้ชื่อลูกค้าเดิม ให้แก้ที่หน้าลูกค้า)" : "";
  if (match.kind === "same") {
    const moves = bookingCustomerId && match.id !== bookingCustomerId ? " แทนลูกค้าเดิม" : "";
    return `ตรงกับลูกค้า “${name}” ที่มีอยู่แล้ว (ชื่อและเบอร์โทรเดียวกัน) — บันทึกแล้วงานนี้จะเป็นของลูกค้าคนนั้น${moves}`;
  }
  if (match.sameName > 0) return `มีลูกค้าชื่อ “${name}” อยู่แล้วแต่คนละเบอร์ — บันทึกแล้วจะเพิ่มเป็นลูกค้าใหม่ ถ้าเป็นคนเดิม ให้เลือกจากรายการ${away}`;
  return `ลูกค้าใหม่ — บันทึกแล้วจะเพิ่ม “${name}” เป็นลูกค้า${away}`;
}
