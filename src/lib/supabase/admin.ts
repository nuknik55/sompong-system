import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Uses the service_role key — full admin access, bypasses RLS.
 * Never import this from a Client Component or expose it to the browser.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
