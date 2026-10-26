import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { gradeAnswer } from "@/lib/ai/study";

export const maxDuration = 60;

/** Grades a typed answer against the expected answer held server-side. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase } = session;

  const { attemptId, answer } = (await request.json().catch(() => ({}))) as {
    attemptId?: string;
    answer?: string;
  };

  if (!attemptId) return fail("attemptId is required.");
  if (typeof answer !== "string") return fail("answer is required.");

  try {
    // RLS restricts this to the caller's own rows.
    const { data: attempt, error } = await supabase
      .from("attempts")
      .select("id, question, expected, score")
      .eq("id", attemptId)
      .single();

    if (error || !attempt) return fail("That question was not found.", 404);
    if (attempt.score !== null) {
      return fail("That question has already been answered.", 409);
    }

    const grading = await gradeAnswer({
      question: attempt.question as string,
      expected: (attempt.expected as string) ?? "",
      answer: answer.trim() || "(no answer given)",
    });

    const { error: updateError } = await supabase
      .from("attempts")
      .update({
        user_answer: answer,
        verdict: grading.verdict,
        score: Math.min(Math.max(grading.score, 0), 100),
        explanation: grading.explanation,
      })
      .eq("id", attemptId);

    if (updateError) return fail(updateError.message, 500);

    return Response.json({
      verdict: grading.verdict,
      score: grading.score,
      explanation: grading.explanation,
      missed: grading.missed ?? [],
      expected: attempt.expected,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
