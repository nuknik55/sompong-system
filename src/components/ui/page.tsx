import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "./button";

/**
 * ONE PAGE LAYOUT (AGENTS.md, "The app's look"). Every page's content sits in
 * the same container and uses its whole width, so the sub-nav, the title, the
 * content and the header's actions start and stop at the same place on every
 * page. The width is the booking list's, the widest page in daily use, so the
 * page Nik uses most did not move.
 *
 * Tried and dropped, 2026-09-22: a narrower column for the forms (the booking
 * screen, the customer page) inside the same container. It kept the left edge
 * but left the header's actions floating a hand's width beyond the content on
 * a laptop, and it is not "the same content width".
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6${className ? ` ${className}` : ""}`}>{children}</div>;
}

/**
 * ONE PAGE HEADER: the back link top LEFT, above the title; the title and a
 * subtitle; the page's actions top RIGHT. The back link is a plain <a>, so
 * the unsaved-changes guard (useLeaveGuard, capture phase) catches it like
 * any other link on the page.
 */
export function PageHeader({
  back,
  title,
  subtitle,
  actions,
}: {
  back?: { href: string; label: string };
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="space-y-1.5">
      {back && (
        <Link href={back.href} className={buttonClass("link", { size: "md" })}>
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold leading-snug text-balance text-neutral-900">{title}</h1>
          {subtitle && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A labelled row of buttons: "พิมพ์", "ดูข้อมูลเพิ่ม". */
export function ButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-2">
      <p className="font-heading text-xs font-medium tracking-wide text-neutral-500">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
