"use client";

import { RouteError } from "@/components/route-error";

/**
 * A throw in the ROOT layout bypasses every segment error.tsx; this is the
 * only boundary above it, and it replaces the root layout, so it must render
 * its own <html> and <body>. The app's global stylesheet is not loaded here
 * (that lives in the layout this replaces), so the classes on RouteError may
 * render unstyled — the digest, route and time are plain text either way.
 */
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <RouteError error={error} retry={unstable_retry} segment="root layout" />
      </body>
    </html>
  );
}
