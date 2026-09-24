import "server-only";
import type { createClient } from "@/lib/supabase/server";

// Moved out of actions.ts on 2026-09-24, verbatim, so the menu card's save
// writes its history line the way every other booking write does, without
// importing actions.ts.

/**
 * Best-effort: a logging failure must never fail the write that already
 * succeeded by the time this runs — the user's actual change (event saved,
 * quote issued, box checked, ...) already went through.
 */
export async function logCateringActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  actorId: string,
  actionKey: string,
  description: string,
): Promise<void> {
  const { error } = await supabase.from("catering_event_activity_log").insert({
    event_id: eventId,
    actor: actorId,
    action_key: actionKey,
    description,
  });
  if (error) console.error("logCateringActivity failed:", error);
}

