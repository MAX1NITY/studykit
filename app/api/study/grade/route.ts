import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { gradeAnswer } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

/**
 * Marks an answer.
 *
 * A multiple-choice answer is marked by comparing the chosen index with the
 * one held server-side: no AI call, so it is instant and spends no quota. A
 * written answer is marked by the AI against the expected answer.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase } = session;

  const { attemptId, answer, choiceIndex } = (await request
    .json()
    .catch(() => ({}))) as {
    attemptId?: string;
    answer?: string;
    choiceIndex?: number;
  };

  if (!attemptId) return fail("attemptId is required.");

  try {
    // RLS restricts this to the caller's own rows.
    const { data: attempt, error } = await supabase
      .from("attempts")
      .select(
        "id, question, expected, score, format, options, answer_index, explanation",
      )
      .eq("id", attemptId)
      .single();

    if (error || !attempt) return fail("That question was not found.", 404);
    // Loose comparison on purpose: an unanswered attempt reads as null from
    // Postgres, but as undefined if the column is ever absent from the row.
    if (attempt.score !== null && attempt.score !== undefined) {
      return fail("That question has already been answered.", 409);
    }

    // ---------------------------------------------------- multiple choice
    if (attempt.format === "choice") {
      if (typeof choiceIndex !== "number") {
        return fail("choiceIndex is required for a multiple-choice question.");
      }

      const options = (attempt.options ?? []) as string[];
      if (choiceIndex < 0 || choiceIndex >= options.length) {
        return fail("That option does not exist.");
      }

      const correct = choiceIndex === attempt.answer_index;
      const score = correct ? 100 : 0;

      /*
       * The verdict is already known from the row just read, so recording it
       * happens after the reply goes out.
       *
       * Marking a chosen option needs no AI at all, which meant the whole of
       * the student's wait was round trips: read, write, then reply. This
       * removes the write from that path.
       */
      const recorded = (async () => {
        await supabase
          .from("attempts")
          .update({
            user_answer: options[choiceIndex],
            verdict: correct ? "correct" : "incorrect",
            score,
          })
          .eq("id", attemptId);
      })();

      try {
        after(recorded);
      } catch {
        await recorded;
      }

      return Response.json({
        format: "choice" as const,
        verdict: correct ? "correct" : "incorrect",
        score,
        answer_index: attempt.answer_index,
        chosen_index: choiceIndex,
        explanation: attempt.explanation,
        missed: [],
        expected: attempt.expected,
      });
    }

    // ----------------------------------------------------------- written
    if (typeof answer !== "string") return fail("answer is required.");

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
      format: "written" as const,
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
