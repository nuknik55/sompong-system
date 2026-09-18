/**
 * A history line's "when", in Bangkok time, the same on the server and in the
 * browser. The component that shows it is rendered first on Vercel, where the
 * clock is UTC, and again in a Thai browser; formatting with the RUNTIME's
 * zone gave two different strings and React reported the mismatch on every
 * booking page with history (found 2026-09-17). So the zone is named, and the
 * time is formatted with a fixed 24-hour pattern rather than a locale's
 * default, which can also differ between the two ICU builds.
 */
const BANGKOK = "Asia/Bangkok";

/** `date` as YYYY-MM-DD and `time` as HH:MM, both in Bangkok time. */
export function bangkokDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-GB can print midnight as "24"; the date is right, only the hour is not.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}
