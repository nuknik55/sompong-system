"use client";

import { RouteError } from "@/components/route-error";

/** Catches a throw in any /owner page or nested layout. The /owner layout itself is above this boundary; see global-error.tsx. */
export default function OwnerError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError error={error} retry={unstable_retry} segment="owner" />;
}
