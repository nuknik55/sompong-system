import { splitAmount } from "@/lib/kitchen-sheet";

/**
 * The จำนวน cell on both function sheets, allowed to break ONLY before "=".
 * At A4 width "0.5 กก. × 20 โต๊ะ = 10 กก." can need two lines; a free wrap
 * could split "20" from "โต๊ะ" or strand the total's unit, so the per-set
 * part and the total each stay whole: "0.5 กก. × 20 โต๊ะ" over "= 10 กก.".
 * The break point is AMOUNT_TOTAL_SEPARATOR, the one amountCell() writes.
 */
export function AmountText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const [perSet, total] = splitAmount(text);
  if (total == null) return <span style={{ whiteSpace: "nowrap" }}>{perSet}</span>;
  return (
    <>
      <span style={{ whiteSpace: "nowrap" }}>{perSet}</span>{" "}
      <span style={{ whiteSpace: "nowrap" }}>{total}</span>
    </>
  );
}
