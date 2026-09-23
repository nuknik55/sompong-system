import type { ReactNode } from "react";

/**
 * A small label in one of the colour ROLES (AGENTS.md, "The app's look").
 * Each role means one thing everywhere:
 *   primary         ours, selected                 dark green on its tint
 *   primary-strong  secured, the end of the road   white on solid dark green
 *   pending         waiting on someone (รอมัดจำ)     gold ink on a gold tint
 *   success         confirmed, done well            bright-green ink on its tint
 *   info            a neutral fact worth a colour   navy on its tint
 *   neutral         no colour needed                grey
 *   danger          an error, a deletion            red on its tint
 * All pass WCAG AA for small text (the lowest is success, 6.1:1;
 * primary-strong is 8.1:1).
 */
export type Tone = "primary" | "primary-strong" | "pending" | "success" | "info" | "neutral" | "danger";

const TONES: Record<Tone, string> = {
  primary: "border-primary/20 bg-primary-soft text-primary",
  "primary-strong": "border-primary bg-primary text-white",
  pending: "border-pending/50 bg-pending-soft text-pending-ink",
  success: "border-success/25 bg-success-soft text-success-ink",
  info: "border-info/20 bg-info-soft text-info",
  neutral: "border-neutral-200 bg-neutral-100 text-neutral-700",
  danger: "border-danger/25 bg-danger-soft text-danger",
};

export function Badge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}

/**
 * ACCENT colours: the brand palette for things that are told apart, not
 * judged — category tags, summary tiles. No accent carries a meaning.
 */
export type Accent = "green" | "gold" | "navy" | "teal" | "bright";
const ACCENTS: Accent[] = ["green", "gold", "navy", "teal", "bright"];

const ACCENT_TAG: Record<Accent, string> = {
  green: "bg-brand-green-soft text-brand-green",
  gold: "bg-brand-gold-soft text-brand-gold-ink",
  navy: "bg-brand-navy-soft text-brand-navy",
  teal: "bg-brand-teal-soft text-brand-teal-ink",
  bright: "bg-brand-bright-soft text-brand-bright-ink",
};

/** The same key always gets the same accent. */
export function accentFor(key: string): Accent {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffff;
  return ACCENTS[h % ACCENTS.length];
}

export function AccentTag({ accent, children }: { accent: Accent; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${ACCENT_TAG[accent]}`}>{children}</span>;
}
