/**
 * What was left in the kitchen and in the freezer when the order was written:
 * the figures the head decides the order quantity from (Nik, 2026-09-24).
 * So it is shown at the size of the dish name, the figures in bold, and beside
 * the quantity it is compared with — never as a small grey note under the
 * name. ONE look for every screen in ordering that shows it read-only (the
 * head's review list and the two order tables); the printed sheets do not
 * show it. Plain presentational code, no hooks: server and client pages both
 * use it.
 */

/** "10 ตัว", or null when nothing was counted. */
export function stockFigure(qty: number | null, unit: string | null): string | null {
  return qty !== null ? `${qty} ${unit ?? ""}`.trim() : null;
}

/** One figure, for a table cell: bold, or a quiet dash when nothing was counted. */
export function StockFigure({ qty, unit }: { qty: number | null; unit: string | null }) {
  const text = stockFigure(qty, unit);
  return text !== null
    ? <span className="font-bold text-neutral-900">{text}</span>
    : <span className="text-neutral-500">—</span>;
}

/** Both figures, stacked and right-aligned, to sit against the quantity field. */
export function StockLeft({
  kitchenQty,
  kitchenUnit,
  freezerQty,
  freezerUnit,
  className = "",
}: {
  kitchenQty: number | null;
  kitchenUnit: string | null;
  freezerQty: number | null;
  freezerUnit: string | null;
  className?: string;
}) {
  return (
    <div className={`text-right text-sm leading-snug text-neutral-700 ${className}`}>
      <div className="whitespace-nowrap">เหลือครัว <StockFigure qty={kitchenQty} unit={kitchenUnit} /></div>
      <div className="whitespace-nowrap">เหลือตู้แช่ <StockFigure qty={freezerQty} unit={freezerUnit} /></div>
    </div>
  );
}
