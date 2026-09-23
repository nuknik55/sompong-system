/**
 * TABLES (AGENTS.md, "The app's look"). The header row of every data table:
 * light grey with dark text, and a line under it (Nik chose it from the
 * samples d20ebc4 and 994babf). neutral-700 on neutral-200 is 8.6:1.
 *
 * A plain module, not "use client": a server page imports the class string
 * itself (from a client module it would get a reference, not the string).
 * The row that opens a record is RowLink, in ./row-link.
 */
export const TH_ROW = "border-b border-neutral-400 bg-neutral-200 text-left text-xs font-semibold text-neutral-700";
