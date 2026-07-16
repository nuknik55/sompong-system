import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Temporarily exclude /owner/accounting to test if proxy is causing 404
  matcher: ["/((?!_next/static|_next/image|favicon.ico|owner/accounting|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
