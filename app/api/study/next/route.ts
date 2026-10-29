import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import {
  buildQuestion,
  pickDifficulty,
  takeFromPool,
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
    const pooled = await takeFromPool(supabase, { kitId, format });
    if (pooled) return Response.json({ ...pooled, fromQueue: true });

    const target = await pickDifficulty(supabase, kitId);

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
