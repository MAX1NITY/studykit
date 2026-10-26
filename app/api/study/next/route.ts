import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { nextChoiceQuestion, nextQuestion } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

type Format = "written" | "choice" | "mixed";

/**
 * Picks the next Smart Study question, written or multiple choice.
 *
 * For both kinds the answer is stored server-side on a pending `attempts` row
 * and never sent to the browser, so it cannot be read out of devtools.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId, format = "written" } = (await request
    .json()
    .catch(() => ({}))) as { kitId?: string; format?: Format };

  if (!kitId) return fail("kitId is required.");

  try {
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("name, content")
      .eq("kit_id", kitId);

    if (sourcesError) return fail(sourcesError.message, 500);
    if (!sources?.length) {
      return fail("This kit has no material attached.", 404);
    }

    // Concepts scoring under 70% are the ones worth drilling.
    const { data: stats } = await supabase
      .from("concept_stats")
      .select("concept, avg_score, attempt_count")
      .eq("kit_id", kitId)
      .order("avg_score", { ascending: true })
      .limit(5);

    const weakConcepts = (stats ?? [])
      .filter((s) => (s.avg_score ?? 100) < 70)
      .map((s) => s.concept as string);

    const { data: recent } = await supabase
      .from("attempts")
      .select("question, score, difficulty")
      .eq("kit_id", kitId)
      .order("created_at", { ascending: false })
      .limit(8);

    const answered = (recent ?? []).filter((a) => a.score !== null);

    // Adaptive difficulty: climb after a run of good answers, drop after
    // poor ones, and start in the middle for a brand-new kit.
    let targetDifficulty = 2;
    if (answered.length >= 3) {
      const avg =
        answered.slice(0, 5).reduce((n, a) => n + (a.score ?? 0), 0) /
        Math.min(answered.length, 5);
      const lastDifficulty = answered[0]?.difficulty ?? 2;
      if (avg >= 80) targetDifficulty = Math.min(5, lastDifficulty + 1);
      else if (avg < 50) targetDifficulty = Math.max(1, lastDifficulty - 1);
      else targetDifficulty = lastDifficulty;
    }

    const { count } = await supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("kit_id", kitId);

    const rotation = count ?? 0;
    const asking: Exclude<Format, "mixed"> =
      format === "mixed"
        ? rotation % 2 === 0
          ? "choice"
          : "written"
        : format;

    const shared = {
      sources,
      targetDifficulty,
      weakConcepts,
      recentQuestions: (recent ?? []).map((a) => a.question as string),
      rotation,
    };

    if (asking === "choice") {
      const q = await nextChoiceQuestion(shared);

      if (q.options.length < 2) {
        return fail(
          "The AI did not return usable options.",
          502,
          "Try again, or switch to written answers.",
        );
      }

      const { data: attempt, error } = await supabase
        .from("attempts")
        .insert({
          kit_id: kitId,
          user_id: user.id,
          format: "choice",
          concept: q.concept,
          question: q.question,
          options: q.options,
          answer_index: q.answer_index,
          expected: q.options[q.answer_index],
          explanation: q.explanation,
          difficulty: q.difficulty,
        })
        .select("id")
        .single();

      if (error || !attempt) {
        return fail(error?.message ?? "Could not start the question.", 500);
      }

      // answer_index is deliberately withheld until the student answers.
      return Response.json({
        attemptId: attempt.id,
        format: "choice" as const,
        question: q.question,
        options: q.options,
        concept: q.concept,
        difficulty: q.difficulty,
        targeted: weakConcepts.includes(q.concept),
      });
    }

    const q = await nextQuestion(shared);

    const { data: attempt, error } = await supabase
      .from("attempts")
      .insert({
        kit_id: kitId,
        user_id: user.id,
        format: "written",
        concept: q.concept,
        question: q.question,
        expected: q.expected,
        difficulty: Math.min(Math.max(q.difficulty, 1), 5),
      })
      .select("id")
      .single();

    if (error || !attempt) {
      return fail(error?.message ?? "Could not start the question.", 500);
    }

    return Response.json({
      attemptId: attempt.id,
      format: "written" as const,
      question: q.question,
      concept: q.concept,
      difficulty: q.difficulty,
      targeted: weakConcepts.includes(q.concept),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
