import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextChoiceQuestion, nextQuestion } from "@/lib/ai/study";

export type Format = "choice" | "written" | "mixed";

/** A pooled row, shaped for the browser with the answer withheld. */
export function shapeForClient(row: {
  id: string;
  format: string;
  question: string;
  options?: unknown;
  concept: string | null;
  difficulty: number | null;
}) {
  return {
    attemptId: row.id,
    format: row.format as "choice" | "written",
    question: row.question,
    // answer_index is deliberately absent until the question is answered.
    options: (row.options as string[] | null) ?? undefined,
    concept: row.concept ?? "",
    difficulty: row.difficulty ?? 2,
    targeted: false,
  };
}

/**
 * The difficulty the student has earned: climb after a run of good answers,
 * drop after poor ones, start in the middle for a new kit.
 */
export async function pickDifficulty(
  supabase: SupabaseClient,
  kitId: string,
): Promise<number> {
  const { data } = await supabase
    .from("attempts")
    .select("score, difficulty")
    .eq("kit_id", kitId)
    .not("score", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const answered = data ?? [];
  if (answered.length < 3) return 2;

  const avg =
    answered.reduce((n, a) => n + (a.score ?? 0), 0) / answered.length;
  const last = answered[0]?.difficulty ?? 2;

  if (avg >= 80) return Math.min(5, last + 1);
  if (avg < 50) return Math.max(1, last - 1);
  return last;
}

interface BuildOptions {
  kitId: string;
  userId: string;
  format: Format;
  target: number;
  /** Shifts the slice of material used, so parallel builds differ. */
  rotationOffset?: number;
}

type BuildResult =
  | { question: ReturnType<typeof shapeForClient> }
  | { error: string; status: number; hint?: string };

/**
 * Writes one question and stores it as an unanswered attempt.
 *
 * The correct answer stays in the row and never reaches the browser until the
 * question has been answered.
 */
export async function buildQuestion(
  supabase: SupabaseClient,
  { kitId, userId, format, target, rotationOffset = 0 }: BuildOptions,
): Promise<BuildResult> {
  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("name, content")
    .eq("kit_id", kitId);

  if (sourcesError) {
    return { error: sourcesError.message, status: 500 };
  }
  if (!sources?.length) {
    return { error: "This kit has no material attached.", status: 404 };
  }

  const { data: stats } = await supabase
    .from("concept_stats")
    .select("concept, avg_score")
    .eq("kit_id", kitId)
    .order("avg_score", { ascending: true })
    .limit(5);

  const weakConcepts = (stats ?? [])
    .filter((s) => (s.avg_score ?? 100) < 70)
    .map((s) => s.concept as string);

  // Recent questions include pooled ones, so a refill does not repeat itself.
  const { data: recent } = await supabase
    .from("attempts")
    .select("question")
    .eq("kit_id", kitId)
    .order("created_at", { ascending: false })
    .limit(12);

  const { count } = await supabase
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("kit_id", kitId);

  const shared = {
    sources,
    targetDifficulty: target,
    weakConcepts,
    recentQuestions: (recent ?? []).map((a) => a.question as string),
    rotation: (count ?? 0) + rotationOffset,
  };

  const asking: "choice" | "written" =
    format === "mixed"
      ? ((count ?? 0) + rotationOffset) % 2 === 0
        ? "choice"
        : "written"
      : format;

  if (asking === "choice") {
    const q = await nextChoiceQuestion(shared);
    if (q.options.length < 2) {
      return {
        error: "The AI did not return usable options.",
        status: 502,
        hint: "Try again, or switch to written answers.",
      };
    }

    const { data: attempt, error } = await supabase
      .from("attempts")
      .insert({
        kit_id: kitId,
        user_id: userId,
        format: "choice",
        concept: q.concept,
        question: q.question,
        options: q.options,
        answer_index: q.answer_index,
        expected: q.options[q.answer_index],
        explanation: q.explanation,
        difficulty: q.difficulty,
      })
      .select("id, format, question, options, concept, difficulty")
      .single();

    if (error || !attempt) {
      return { error: error?.message ?? "Could not store the question.", status: 500 };
    }

    return {
      question: {
        ...shapeForClient(attempt),
        targeted: weakConcepts.includes(q.concept),
      },
    };
  }

  const q = await nextQuestion(shared);

  const { data: attempt, error } = await supabase
    .from("attempts")
    .insert({
      kit_id: kitId,
      user_id: userId,
      format: "written",
      concept: q.concept,
      question: q.question,
      expected: q.expected,
      difficulty: Math.min(Math.max(q.difficulty, 1), 5),
    })
    .select("id, format, question, options, concept, difficulty")
    .single();

  if (error || !attempt) {
    return { error: error?.message ?? "Could not store the question.", status: 500 };
  }

  return {
    question: {
      ...shapeForClient(attempt),
      targeted: weakConcepts.includes(q.concept),
    },
  };
}
