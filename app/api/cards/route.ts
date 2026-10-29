import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { readDueCards } from "@/lib/cards";
import { review, type Grade } from "@/lib/srs";

const GRADES = new Set<Grade>(["again", "hard", "good", "easy"]);

/** The cards a kit has due, including any still in relearning. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const kitId = new URL(request.url).searchParams.get("kit");
  if (!kitId) return fail("kit is required.");

  try {
    return Response.json(await readDueCards(session.supabase, kitId));
  } catch (cause) {
    return failFrom(cause);
  }
}

/**
 * Records one card review.
 *
 * The schedule is computed here from the stored row rather than taken from
 * the browser, so a stale or tampered-with client cannot write an arbitrary
 * interval. The review screen moves on without waiting for this, and puts the
 * card back if it fails.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase } = session;

  const { cardId, grade } = (await request.json().catch(() => ({}))) as {
    cardId?: string;
    grade?: Grade;
  };

  if (!cardId) return fail("cardId is required.");
  if (!grade || !GRADES.has(grade)) return fail("A valid grade is required.");

  try {
    // RLS restricts both statements to the caller's own cards.
    const { data: card, error } = await supabase
      .from("cards")
      .select("id, ease, interval_days, repetitions, lapses")
      .eq("id", cardId)
      .single();

    if (error || !card) return fail("That card was not found.", 404);

    const next = review(card, grade);

    const { error: updateError } = await supabase
      .from("cards")
      .update({
        ease: next.ease,
        interval_days: next.interval_days,
        repetitions: next.repetitions,
        lapses: next.lapses,
        due_at: next.due_at,
        last_reviewed_at: next.last_reviewed_at,
      })
      .eq("id", cardId);

    if (updateError) return fail(updateError.message, 500);

    return Response.json(next);
  } catch (cause) {
    return failFrom(cause);
  }
}
