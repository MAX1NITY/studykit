import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import {
  buildQuestion,
  pickDifficulty,
  shapeForClient,
  type Format,
} from "@/lib/study-queue";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

/**
 * Hands over the next Smart Study question.
 *
 * Questions are kept as a pool of unanswered rows, so the usual path is a
 * database read and the question appears instantly. Only an empty pool falls
 * back to writing one on the spot.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId, format = "choice" } = (await request
    .json()
    .catch(() => ({}))) as { kitId?: string; format?: Format };

  if (!kitId) return fail("kitId is required.");

  try {
    const target = await pickDifficulty(supabase, kitId);

    const wanted =
      format === "mixed" ? ["choice", "written"] : [format as string];

    // Take from the pool, preferring the question closest to the difficulty
    // the student has earned, so a queued question still adapts.
    const { data: pooled } = await supabase
      .from("attempts")
      .select(
        "id, format, question, options, concept, difficulty, created_at",
      )
      .eq("kit_id", kitId)
      .is("score", null)
      .in("format", wanted)
      .order("created_at", { ascending: true })
      .limit(25);

    if (pooled?.length) {
      const best = pooled.reduce((a, b) =>
        Math.abs((b.difficulty ?? 2) - target) <
        Math.abs((a.difficulty ?? 2) - target)
          ? b
          : a,
      );
      return Response.json({ ...shapeForClient(best), fromQueue: true });
    }

    const built = await buildQuestion(supabase, {
      kitId,
      userId: user.id,
      format,
      target,
    });

    if ("error" in built) return fail(built.error, built.status, built.hint);

    return Response.json({ ...built.question, fromQueue: false });
  } catch (cause) {
    return failFrom(cause);
  }
}
