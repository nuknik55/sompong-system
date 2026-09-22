import type { ReactNode } from "react";
import type { Accent } from "./badge";

/**
 * A coloured summary tile (AGENTS.md, "The app's look"): a filled brand
 * accent, the figure large, the label small. Text on each fill passes WCAG AA
 * for small text: white on dark green 8.1:1, navy 12.5:1, bright green 5.0:1;
 * near-black on gold 8.8:1 and teal 8.1:1 (white on those fails, 2.0 and 2.2).
 */
const FILLS: Record<Accent | "plain", string> = {
  green: "bg-brand-green text-white",
  navy: "bg-brand-navy text-white",
  bright: "bg-brand-bright text-white",
  gold: "bg-brand-gold text-neutral-900",
  teal: "bg-brand-teal text-neutral-900",
  plain: "border border-neutral-200 bg-white text-neutral-900",
};

export function StatTile({
  label,
  value,
  accent = "plain",
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  accent?: Accent | "plain";
  note?: ReactNode;
}) {
  return (
    // min-w-0 and break-words: a long figure (฿207,850.00 on a phone) wraps
    // inside the tile instead of running out of it.
    <div className={`min-w-0 rounded-xl p-4 shadow-tile ${FILLS[accent]}`}>
      <p className={`text-xs font-medium ${accent === "plain" ? "text-neutral-500" : ""}`}>{label}</p>
      <p className="mt-1 break-words font-heading text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      {note && <p className={`mt-1 text-xs ${accent === "plain" ? "text-neutral-500" : ""}`}>{note}</p>}
    </div>
  );
}
