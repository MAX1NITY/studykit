import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { BUDGETS, generateTest, partCount, type TestQuestion } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

/** Creates a practice test. Correct answers stay on the server until marking. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId, count } = (await request.json().catch(() => ({}))) as {
    kitId?: string;
    count?: number;
  };
  if (!kitId) return fail("kitId is required.");

  const questionCount = Math.min(Math.max(count ?? 10, 5), 25);

  try {
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("name, content")
      .eq("kit_id", kitId);

    if (sourcesError) return fail(sourcesError.message, 500);
    if (!sources?.length) return fail("This kit has no material attached.", 404);

    // Each test covers a different slice, so sitting three tests examines
    // three parts of the material instead of the same opening three times.
    const { count: taken } = await supabase
      .from("tests")
      .select("id", { count: "exact", head: true })
      .eq("kit_id", kitId);

    const parts = partCount(sources, BUDGETS.test);
    const questions = await generateTest(
      sources,
      questionCount,
      (taken ?? 0) % parts,
    );
    if (!questions.length) {
      return fail("The AI could not build a test from this material.", 502);
    }

    const { data: test, error: testError } = await supabase
      .from("tests")
      .insert({
        kit_id: kitId,
        user_id: user.id,
        questions,
        total: questions.length,
      })
      .select("id")
      .single();

    if (testError || !test) {
      return fail(testError?.message ?? "Could not save the test.", 500);
    }

    return Response.json({
      testId: test.id,
      questions: questions.map((q) => ({
        question: q.question,
        options: q.options,
        concept: q.concept,
      })),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}

/** Marks a submitted test. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase } = session;

  const { testId, responses, durationSeconds } = (await request
    .json()
    .catch(() => ({}))) as {
    testId?: string;
    responses?: (number | null)[];
    durationSeconds?: number;
  };

  if (!testId) return fail("testId is required.");
  if (!Array.isArray(responses)) return fail("responses must be an array.");

  try {
    const { data: test, error } = await supabase
      .from("tests")
      .select("id, questions, total, submitted_at")
      .eq("id", testId)
      .single();

    if (error || !test) return fail("That test was not found.", 404);
    if (test.submitted_at) return fail("That test is already marked.", 409);

    const questions = test.questions as TestQuestion[];
    const results = questions.map((q, i) => {
      const chosen = responses[i] ?? null;
      return {
        chosen,
        answer_index: q.answer_index,
        correct: chosen === q.answer_index,
        explanation: q.explanation,
        concept: q.concept,
      };
    });

    const score = results.filter((r) => r.correct).length;

    const { error: updateError } = await supabase
      .from("tests")
      .update({
        responses,
        score,
        duration_seconds: durationSeconds ?? null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", testId);

    if (updateError) return fail(updateError.message, 500);

    return Response.json({ score, total: questions.length, results });
  } catch (cause) {
    return failFrom(cause);
  }
}
