import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { nextQuestion } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

/**
 * Picks the next Smart Study question.
 *
 * The correct answer is stored server-side on a pending `attempts` row and is
 * never sent to the browser, so the answer cannot be read out of devtools.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId } = (await request.json().catch(() => ({}))) as {
    kitId?: string;
  };
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

    const question = await nextQuestion({
      sources,
      targetDifficulty,
      weakConcepts,
      recentQuestions: (recent ?? []).map((a) => a.question as string),
      rotation: count ?? 0,
    });

    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .insert({
        kit_id: kitId,
        user_id: user.id,
        concept: question.concept,
        question: question.question,
        expected: question.expected,
        difficulty: Math.min(Math.max(question.difficulty, 1), 5),
      })
      .select("id")
      .single();

    if (attemptError || !attempt) {
      return fail(attemptError?.message ?? "Could not start the question.", 500);
    }

    return Response.json({
      attemptId: attempt.id,
      question: question.question,
      concept: question.concept,
      difficulty: question.difficulty,
      targeted: weakConcepts.includes(question.concept),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
