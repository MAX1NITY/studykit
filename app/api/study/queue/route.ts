import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { buildQuestion, pickDifficulty, type Format } from "@/lib/study-queue";

export const maxDuration = 300;

/** How many unanswered questions to keep ready, and how many to add per call. */
const POOL_TARGET = 8;
const PER_CALL = 3;

/**
 * Tops the question pool up.
 *
 * Called in the background while studying, so the pool refills behind the
 * student rather than in front of them. Because the pool lives in the
 * database it survives between sessions: come back tomorrow and the
 * questions are already written.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId, format = "choice" } = (await request
    .json()
    .catch(() => ({}))) as { kitId?: string; format?: Format };

  if (!kitId) return fail("kitId is required.");

  const wanted =
    format === "mixed" ? ["choice", "written"] : [format as string];

  try {
    const { count } = await supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("kit_id", kitId)
      .is("score", null)
      .in("format", wanted);

    const ready = count ?? 0;
    const missing = Math.min(Math.max(POOL_TARGET - ready, 0), PER_CALL);

    if (missing === 0) {
      return Response.json({ ready, added: 0, full: true });
    }

    const target = await pickDifficulty(supabase, kitId);

    // Written in parallel. Sequentially, a refill of three took three times
    // as long as one question, which a student answering briskly outruns.
    // Each is given a different slice of the material so they do not converge
    // on the same corner of it.
    const results = await Promise.allSettled(
      Array.from({ length: missing }, (_, i) =>
        buildQuestion(supabase, {
          kitId,
          userId: user.id,
          format,
          target,
          rotationOffset: i,
        }),
      ),
    );

    const added = results.filter(
      (r) => r.status === "fulfilled" && !("error" in r.value),
    ).length;

    // Report the first real failure, but only when nothing at all was added.
    if (added === 0) {
      const firstFailure = results.find(
        (r) => r.status === "fulfilled" && "error" in r.value,
      );
      if (firstFailure && firstFailure.status === "fulfilled") {
        const problem = firstFailure.value as {
          error: string;
          status: number;
          hint?: string;
        };
        return fail(problem.error, problem.status, problem.hint);
      }
    }

    return Response.json({ ready: ready + added, added, full: ready + added >= POOL_TARGET });
  } catch (cause) {
    return failFrom(cause);
  }
}
