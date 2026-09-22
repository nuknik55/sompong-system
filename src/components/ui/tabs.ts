/**
 * Sub-navigation tabs (AGENTS.md, "The app's look"): text links in a row on
 * a hairline, the active one dark green with a green underline. Every
 * section's sub-nav uses these, so a tab looks the same in every section.
 */
export const TAB_ROW = "flex gap-5 overflow-x-auto border-b border-neutral-200";

export function tabClass(active: boolean): string {
  // No negative margin onto the hairline: the row scrolls sideways on a
  // phone (overflow-x-auto), and a scrolling box clips what hangs out of it.
  return `whitespace-nowrap border-b-2 pb-2 font-heading text-sm font-medium transition-colors ${
    active ? "border-primary text-primary" : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
  }`;
}
