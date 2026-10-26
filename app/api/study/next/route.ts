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
    const wanted =
      format === "mixed" ? ["choice", "written"] : [format as string];

    // Both reads are independent, so they go together rather than one after
    // the other: every round trip to the database costs real time.
    const [target, { data: pooled }] = await Promise.all([
      pickDifficulty(supabase, kitId),
      supabase
        .from("attempts")
        .select(
          "id, format, question, options, concept, difficulty, created_at, served_at",
        )
        .eq("kit_id", kitId)
        .is("score", null)
        .in("format", wanted)
        .order("served_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .limit(25),
    ]);

    if (pooled?.length) {
      // Prefer questions never shown. Choosing purely by difficulty is
      // deterministic, so without this, skipping a question handed the same
      // one straight back.
      const unseen = pooled.filter((q) => q.served_at === null);
      const candidates = unseen.length ? unseen : [pooled[0]];

      const best = candidates.reduce((a, b) =>
        Math.abs((b.difficulty ?? 2) - target) <
        Math.abs((a.difficulty ?? 2) - target)
          ? b
          : a,
      );

      await supabase
        .from("attempts")
        .update({ served_at: new Date().toISOString() })
        .eq("id", best.id);

      return Response.json({ ...shapeForClient(best), fromQueue: true });
    }

    const built = await buildQuestion(supabase, {
      kitId,
      userId: user.id,
      format,
      target,
      serve: true,
    });

    if ("error" in built) return fail(built.error, built.status, built.hint);

    return Response.json({ ...built.question, fromQueue: false });
  } catch (cause) {
    return failFrom(cause);
  }
}
