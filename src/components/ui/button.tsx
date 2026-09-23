import type { ButtonHTMLAttributes } from "react";

/**
 * THE THREE BUTTON KINDS (AGENTS.md, "The app's look"). Every button and every
 * link that looks like a button is one of these; nothing else invents one.
 *
 *   primary    the one main action of an area: filled dark green, a faint
 *              shadow, darker on hover, sinks slightly when pressed.
 *   secondary  every other action: white, outlined, a lighter shadow.
 *   link       quiet actions and navigation: plain grey text.
 *
 * `danger` turns any kind red, for ลบ and nothing else. Disabled is the same
 * for all: half opacity, no shadow, no hover, never sinks.
 *
 * Each (kind, danger) pair is ONE complete class list. Two Tailwind classes
 * setting the same property do not override each other by their order in
 * the string, so the lists never mix.
 */
export type ButtonKind = "primary" | "secondary" | "link";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-heading font-medium select-none " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const BOX = "rounded-lg active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:shadow-none";

const KINDS: Record<ButtonKind, { plain: string; danger: string; dangerHover?: string }> = {
  primary: {
    plain: `${BOX} bg-primary text-white shadow-btn hover:bg-primary-hover disabled:hover:bg-primary`,
    danger: `${BOX} bg-danger text-white shadow-btn-danger hover:bg-danger-hover disabled:hover:bg-danger`,
  },
  secondary: {
    plain: `${BOX} border border-neutral-300 bg-white text-neutral-800 shadow-btn-soft hover:border-neutral-400 hover:bg-neutral-50 disabled:hover:border-neutral-300 disabled:hover:bg-white`,
    danger: `${BOX} border border-danger/40 bg-white text-danger shadow-btn-soft hover:border-danger hover:bg-danger-soft disabled:hover:border-danger/40 disabled:hover:bg-white`,
  },
  link: {
    plain: "rounded text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline disabled:hover:text-neutral-600 disabled:hover:no-underline",
    danger: "rounded text-danger underline-offset-2 hover:text-danger-hover hover:underline disabled:hover:text-danger disabled:hover:no-underline",
    // ลบ in a row of data: quiet until you mean it, grey at rest and red
    // only under the pointer (Nik, from the preview samples, 2026-09-23).
    dangerHover: "rounded text-neutral-500 underline-offset-2 hover:text-danger hover:underline disabled:hover:text-neutral-500 disabled:hover:no-underline",
  },
};

const SIZES: Record<ButtonKind, Record<ButtonSize, string>> = {
  primary: { md: "h-9 px-4 text-sm", sm: "h-8 px-3 text-sm" },
  secondary: { md: "h-9 px-4 text-sm", sm: "h-8 px-3 text-sm" },
  link: { md: "text-sm", sm: "text-xs" },
};

/** The classes for a button, or for a Link that should look like one. */
export function buttonClass(
  kind: ButtonKind,
  { size = "md", danger = false, dangerHover = false, className }: { size?: ButtonSize; danger?: boolean; dangerHover?: boolean; className?: string } = {},
): string {
  const variant = (dangerHover && KINDS[kind].dangerHover) || (danger || dangerHover ? KINDS[kind].danger : KINDS[kind].plain);
  return [BASE, variant, SIZES[kind][size], className].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind: ButtonKind;
  size?: ButtonSize;
  danger?: boolean;
  dangerHover?: boolean;
};

/** A <button>. `type` defaults to "button": no button here submits a form by accident. */
export function Button({ kind, size, danger, dangerHover, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(kind, { size, danger, dangerHover, className })} {...rest} />;
}
