/**
 * A typed box's text as a number: "" and anything Number() cannot read are
 * null. Here rather than in shared-utils.tsx (which re-exports it) so that a
 * pure module and its node tests can import it without loading JSX.
 */
export function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
