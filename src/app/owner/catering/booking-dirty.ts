/**
 * "Has this booking screen been edited since it was last clean?" — one
 * definition, pure and tested, because the answer decides whether leaving
 * the page interrupts someone (Nik, 2026-09-20).
 *
 * THE SCREEN SALES USES MOST. A warning that fires on a form nobody touched,
 * or after a save that succeeded, is worse than no warning at all: it trains
 * the person to dismiss it, and then it is not there on the day it matters.
 * So the comparison is against a snapshot taken from THE SAME VALUES the
 * screen initialised itself with, not from a re-derivation of them — at
 * mount the two strings are equal by construction, and nothing but an edit
 * can separate them.
 *
 * Two things deliberately do NOT count as edits:
 *   - the device's remembered taker, seeded from localStorage on a new
 *     booking (the screen re-baselines when it seeds);
 *   - a successful save (the screen re-baselines on the way out).
 *
 * WHAT IT LOOKS AT. Every field of the form, by enumerating the object — so
 * a field added to FormState is watched without touching this file — and for
 * each price-box line the things a save would write. Numbers are compared as
 * numbers, so retyping "4500" over "4500.00" is not an edit.
 *
 * TEXT IS COMPARED AS TYPED, which OVER-warns for the fields the server
 * trims on save (the notes, the offsite address, the table label, a new
 * customer's fields, a charge label): adding a trailing space there and
 * leaving will ask, although saving would have discarded it anyway. That is
 * the safe direction and it is cheap; what it must never do is the reverse.
 *
 * The line's client `key` is left out on purpose: removing a row and adding
 * an identical one leaves the booking exactly as it was, and the person
 * should not be stopped on the way out over it.
 */
import type { FormState } from "./shared-utils";

/** Just the parts of the price box a save would write. */
export type DirtyLine = {
  kind: string;
  section: string;
  refId: string | null;
  eventMenuId: string | null;
  label: string;
  unitPrice: string;
  quantity: string;
  amount: string;
  chargeType: string;
};

/** "4500.00" and "4500" are the same money; "" stays ""; nonsense stays itself. */
function num(s: string): string {
  const t = s.trim();
  if (t === "") return "";
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : t;
}

/**
 * A stable string for the screen's whole state. Key order is forced, so two
 * forms with the same values can never differ by how they were built.
 */
export function bookingSnapshot(form: FormState, lines: DirtyLine[]): string {
  const f = form as unknown as Record<string, unknown>;
  const ordered: [string, unknown][] = Object.keys(f)
    .sort()
    .map((k) => [k, Array.isArray(f[k]) ? [...(f[k] as unknown[])] : f[k]]);
  return JSON.stringify({
    f: ordered,
    l: lines.map((l) => [
      l.kind, l.section, l.refId, l.eventMenuId, l.label,
      num(l.unitPrice), num(l.quantity), num(l.amount), l.chargeType,
    ]),
  });
}

/** The server's view of the booking as the screen compares it: its conflict token and what the screen would show. */
export type ServerView = { updatedAt: string | null; snapshot: string };

export type ServerViewAction = "same" | "ack" | "adopt" | "token" | "hold";

/**
 * What the booking screen does when the server's view of the booking arrives:
 * the menu page's rule, moved INSIDE the screen (queue item 41, Nik
 * 2026-09-21). The page used to key the screen on its charge rows, so any
 * refresh that brought changed rows — another tab's save, the menu page, a
 * second sales login — remounted it from the server, threw the person's
 * typing away, and the guard reported clean.
 *
 *   ack    the person's OWN partial save came back (the booking's fields
 *          written, the price box not): take the server's view as the new
 *          baseline and token, KEEP the draft — and the lines it is based
 *          on (seenAfter).
 *   same   nothing moved.
 *   adopt  take the server's data whole: the form is clean, or this is the
 *          person's own save landing.
 *   token  someone saved but nothing the screen shows changed: take the
 *          token, so the next save is not refused, and keep the draft.
 *   hold   what the screen shows changed elsewhere while the form holds
 *          unsaved work: keep the draft and say so. Never taken silently —
 *          the person reloads, or saves, and a save is refused if another
 *          booking-screen save came in between (saveBooking's token).
 */
export function serverViewAction(
  seen: ServerView,
  server: ServerView,
  state: { dirty: boolean; landing: boolean; ackAt: string | null },
): ServerViewAction {
  if (state.ackAt !== null && server.updatedAt === state.ackAt) return "ack";
  if (server.updatedAt === seen.updatedAt && server.snapshot === seen.snapshot) return "same";
  if (state.landing || !state.dirty) return "adopt";
  if (server.snapshot === seen.snapshot) return "token";
  return "hold";
}

/** What the screen holds of the server's view: the token, the snapshot, and
 *  the menu lines (event_menu ids) its draft is BASED ON. */
export type SeenView = ServerView & { menuIds: string[] };

/**
 * The view the screen holds after acting on new server data. `menuIds` are
 * the lines a save may remove because the draft no longer has them, so they
 * change ONLY with the draft itself, on "adopt". On "ack" the draft stays and
 * so does its basis: taking the server's lines there named a line the menu
 * page had added meanwhile, which the draft does not have, and the retry
 * removed it with its charge and courses (review, 2026-09-21). A line the
 * partial save itself created is not in the basis either; the retry sends it
 * as new, and the database takes it as that line (same set or dish).
 */
export function seenAfter(action: ServerViewAction, seen: SeenView, server: ServerView, serverMenuIds: string[]): SeenView {
  if (action === "adopt") return { ...server, menuIds: serverMenuIds };
  if (action === "ack") return { ...server, menuIds: seen.menuIds };
  if (action === "token") return { ...seen, updatedAt: server.updatedAt };
  return seen;
}
