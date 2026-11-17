import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep } from "@/lib/exam/prep";
import { interpret, detailForDisplay, type Submitted } from "@/lib/exam/select";
import { grade } from "@/lib/exam/grade";

/**
 * Marks one answer from the ongoing study stream and says why.
 *
 * Marking is arithmetic against the stored answer, so there is no AI call
 * here and no wait. Recording the result happens after the reply has gone
 * out, because the verdict is already known and the student should not be
 * waiting on a write to see it.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as {
    questionId?: string;
    submitted?: Submitted;
  };

  if (!body.questionId) return fail("questionId is required.");

  try {
    const prep = await getOrCreatePrep(supabase, user.id);

    const { data: question, error } = await supabase
      .from("exam_questions")
      .select(
        "id, kind, domain, objective, stem, options, answer_indexes, steps, pairs, explanation",
      )
      .eq("id", body.questionId)
      .eq("prep_id", prep.id)
      .single();

    if (error || !question) return fail("That question was not found.", 404);

    const mark = grade(question, interpret(question, body.submitted ?? null));

    const recorded = (async () => {
      await supabase.from("exam_responses").insert({
        prep_id: prep.id,
        user_id: user.id,
        question_id: question.id,
        sitting_id: null,
        domain: question.domain,
        response: body.submitted ?? null,
        score: mark.score,
        correct: mark.correct,
      });
    })();

    try {
      after(recorded);
    } catch {
      await recorded;
    }

    return Response.json({
      score: mark.score,
      correct: mark.correct,
      // In the order he saw the options, not the order they are stored in.
      detail: detailForDisplay(question, mark.detail),
      explanation: question.explanation,
      // Now that it has been answered, the answer itself is the point.
      answer: answerFor(question),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}

/** The correct answer, phrased for whichever shape the question is. */
function answerFor(q: {
  kind: string;
  options?: string[] | null;
  answer_indexes?: number[] | null;
  steps?: string[] | null;
  pairs?: { left: string; right: string }[] | null;
}) {
  if (q.kind === "single" || q.kind === "multiple") {
    return (q.answer_indexes ?? []).map((i) => (q.options ?? [])[i]).filter(Boolean);
  }
  if (q.kind === "ordering") return q.steps ?? [];
  if (q.kind === "matching") {
    return (q.pairs ?? []).map((p) => `${p.left} → ${p.right}`);
  }
  return [];
}
