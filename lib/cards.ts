import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RELEARN_MINUTES } from "@/lib/srs";

export interface DueCard {
  id: string;
  front: string;
  back: string;
  concept: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
}

/*
 * last_reviewed_at comes along so the review screen can tell a card it has
 * seen from one it has not using exactly the column the progress view counts.
 * It used to infer that from repetitions, which disagrees the moment a card
 * lapses and resets them to zero.
 */
const COLUMNS =
  "id, front, back, concept, ease, interval_days, repetitions, lapses, due_at, last_reviewed_at";

/** How many cards one sitting loads at a time. */
export const SESSION_LIMIT = 60;

/**
 * Reads the cards a kit has waiting.
 *
 * The horizon reaches a little past now on purpose. A card graded "Again" is
 * scheduled ten minutes out, and a query for `due_at <= now` made those cards
 * vanish the moment the page was reloaded — the student had just failed them
 * and the app said nothing was due. They are returned here and the review
 * screen holds them until their time comes.
 *
 * `more` reports whether the kit has cards beyond this batch, so the screen
 * can carry on instead of announcing that the session is finished.
 */
export async function readDueCards(
  supabase: SupabaseClient,
  kitId: string,
  limit = SESSION_LIMIT,
): Promise<{ ready: DueCard[]; relearning: DueCard[]; more: boolean }> {
  const horizon = new Date(
    Date.now() + RELEARN_MINUTES * 60_000,
  ).toISOString();

  // RLS restricts this to the caller's own cards.
  const { data, error } = await supabase
    .from("cards")
    .select(COLUMNS)
    .eq("kit_id", kitId)
    .lte("due_at", horizon)
    .order("due_at", { ascending: true })
    .limit(limit + 1);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DueCard[];
  const batch = rows.slice(0, limit);
  const now = Date.now();

  return {
    ready: batch.filter((c) => Date.parse(c.due_at) <= now),
    relearning: batch.filter((c) => Date.parse(c.due_at) > now),
    more: rows.length > limit,
  };
}
