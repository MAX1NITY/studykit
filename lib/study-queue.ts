import "server-only";
import { after } from "next/server";
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
 * Takes the best waiting question out of the pool, or null if it is empty.
 *
 * Shared by the API route and the study page itself: the page can hand the
 * student a question in its first response instead of rendering a spinner and
 * then asking for one from the browser after hydration.
 */
export async function takeFromPool(
  supabase: SupabaseClient,
  { kitId, format }: { kitId: string; format: Format },
): Promise<ReturnType<typeof shapeForClient> | null> {
  const wanted =
    format === "mixed" ? ["choice", "written"] : [format as string];

  // Both reads are independent, so they go together rather than one after the
  // other: every round trip to the database costs real time.
  const [target, { data: pooled }] = await Promise.all([
    pickDifficulty(supabase, kitId),
    supabase
      .from("attempts")
      .select("id, format, question, options, concept, difficulty, served_at")
      .eq("kit_id", kitId)
      .is("score", null)
      .in("format", wanted)
      .order("served_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(8),
  ]);

  if (!pooled?.length) return null;

  // Prefer questions never shown. Choosing purely by difficulty is
  // deterministic, so without this, skipping a question handed the same one
  // straight back.
  const unseen = pooled.filter((q) => q.served_at === null);
  const candidates = unseen.length ? unseen : [pooled[0]];

  const best = candidates.reduce((a, b) =>
    Math.abs((b.difficulty ?? 2) - target) <
    Math.abs((a.difficulty ?? 2) - target)
      ? b
      : a,
  );

  // Bookkeeping, not something the student should wait on. Letting the
  // response go first turns a round trip into no wait at all.
  const markServed = (async () => {
    await supabase
      .from("attempts")
      .update({ served_at: new Date().toISOString() })
      .eq("id", best.id);
  })();

  try {
    after(markServed);
  } catch {
    // No request context to defer into. Wait for it rather than skip it: an
    // unmarked question is eligible to be served again straight away.
    await markServed;
  }

  return shapeForClient(best);
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
  /** True when this question is being handed straight to the student. */
  serve?: boolean;
  /** Kit context already read, so a parallel refill reads it only once. */
  context?: QuestionContext;
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
/** Everything a question needs to know about the kit before it is written. */
export interface QuestionContext {
  sources: { name: string; content: string }[];
  weakConcepts: string[];
  recentQuestions: string[];
  asked: number;
}

/**
 * Gathers the kit context one question needs.
 *
 * The four reads are independent, so they go together. They were running one
 * after another, and a pool refill writes three questions at once — so a
 * single top-up was making twelve queries where four would do, with four
 * round trips of pure waiting before the AI call even started.
 */
export async function readQuestionContext(
  supabase: SupabaseClient,
  kitId: string,
): Promise<QuestionContext | { error: string; status: number }> {
  const [sources, stats, recent, total] = await Promise.all([
    supabase.from("sources").select("name, content").eq("kit_id", kitId),
    supabase
      .from("concept_stats")
      .select("concept, avg_score")
      .eq("kit_id", kitId)
      .order("avg_score", { ascending: true })
      .limit(5),
    // Recent questions include pooled ones, so a refill does not repeat itself.
    supabase
      .from("attempts")
      .select("question")
      .eq("kit_id", kitId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("kit_id", kitId),
  ]);

  if (sources.error) return { error: sources.error.message, status: 500 };
  if (!sources.data?.length) {
    return { error: "This kit has no material attached.", status: 404 };
  }

  return {
    sources: sources.data as { name: string; content: string }[],
    weakConcepts: (stats.data ?? [])
      .filter((s) => (s.avg_score ?? 100) < 70)
      .map((s) => s.concept as string),
    recentQuestions: (recent.data ?? []).map((a) => a.question as string),
    asked: total.count ?? 0,
  };
}

export async function buildQuestion(
  supabase: SupabaseClient,
  {
    kitId,
    userId,
    format,
    target,
    rotationOffset = 0,
    serve = false,
    context,
  }: BuildOptions,
): Promise<BuildResult> {
  // Reused across a parallel refill: the kit's material and history are the
  // same for every question in the batch, so they are read once.
  const gathered = context ?? (await readQuestionContext(supabase, kitId));
  if ("error" in gathered) {
    return { error: gathered.error, status: gathered.status };
  }

  const { sources, weakConcepts, recentQuestions, asked } = gathered;

  const shared = {
    sources,
    targetDifficulty: target,
    weakConcepts,
    recentQuestions,
    rotation: asked + rotationOffset,
  };

  const asking: "choice" | "written" =
    format === "mixed"
      ? (asked + rotationOffset) % 2 === 0
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
        served_at: serve ? new Date().toISOString() : null,
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
      served_at: serve ? new Date().toISOString() : null,
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
