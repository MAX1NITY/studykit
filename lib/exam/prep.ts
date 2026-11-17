import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceLike } from "@/lib/ai/material";
import { DOMAINS, EXAM } from "./core1";
import { fingerprint, interpret, type Answerable, type Submitted } from "./select";
import { grade } from "./grade";
import type { ExamQuestion, QuestionKind } from "./questions";

export interface PrepRow {
  id: string;
  exam_code: string;
}

/** The one Core 1 prep for this user, made on first visit. */
export async function getOrCreatePrep(
  supabase: SupabaseClient,
  userId: string,
): Promise<PrepRow> {
  const { data: found } = await supabase
    .from("exam_preps")
    .select("id, exam_code")
    .eq("exam_code", EXAM.code)
    .maybeSingle();

  if (found) return found as PrepRow;

  const { data, error } = await supabase
    .from("exam_preps")
    .insert({ user_id: userId, exam_code: EXAM.code })
    .select("id, exam_code")
    .single();

  // Two tabs opening the prep at once both insert; the unique constraint lets
  // one through and the loser just reads what the winner wrote.
  if (error) {
    const { data: raced } = await supabase
      .from("exam_preps")
      .select("id, exam_code")
      .eq("exam_code", EXAM.code)
      .single();
    if (raced) return raced as PrepRow;
    throw new Error(error.message);
  }

  return data as PrepRow;
}



/** The material rows a generator for this domain should read. */
export async function materialFor(
  supabase: SupabaseClient,
  prepId: string,
  domainId: string,
): Promise<SourceLike[]> {
  const { data } = await supabase
    .from("exam_material")
    .select("title, content, domain, objectives")
    .eq("prep_id", prepId)
    .order("ordinal");

  const rows = (data ?? []) as {
    title: string;
    content: string;
    domain: string;
    objectives: string[];
  }[];

  // A chapter counts for a domain if it is its home domain or it declares an
  // objective in it: chapter 12 is mostly troubleshooting but carries 2.8,
  // and networking questions should be able to read it.
  const relevant = rows.filter(
    (r) =>
      r.domain === domainId ||
      (r.objectives ?? []).some((o) => `${o[0]}.0` === domainId),
  );

  return (relevant.length ? relevant : rows).map((r) => ({
    name: r.title,
    content: r.content,
  }));
}

export interface PoolQuestion {
  id: string;
  kind: QuestionKind;
  domain: string;
  objective: string;
  stem: string;
  options: string[] | null;
  answer_indexes: number[] | null;
  steps: string[] | null;
  pairs: { left: string; right: string }[] | null;
  explanation: string;
  difficulty: number;
}

const SELECT =
  "id, kind, domain, objective, stem, options, answer_indexes, steps, pairs, explanation, difficulty";

/** Saves generated questions, dropping any that duplicate the pool. */
export async function saveQuestions(
  supabase: SupabaseClient,
  prepId: string,
  userId: string,
  questions: ExamQuestion[],
): Promise<number> {
  if (!questions.length) return 0;

  const rows = questions.map((q) => ({
    prep_id: prepId,
    user_id: userId,
    kind: q.kind,
    domain: q.domain,
    objective: q.objective,
    stem: q.stem.trim(),
    options: q.options ?? null,
    answer_indexes: q.answer_indexes ?? null,
    steps: q.steps ?? null,
    pairs: q.pairs ?? null,
    explanation: q.explanation.trim(),
    difficulty: q.difficulty,
    fingerprint: fingerprint(q.stem),
  }));

  // ignoreDuplicates so a batch that overlaps the pool still saves the rest,
  // rather than the whole insert failing on one repeat.
  const { data, error } = await supabase
    .from("exam_questions")
    .upsert(rows, { onConflict: "prep_id,fingerprint", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * The next question for the ongoing study stream.
 *
 * No stars, no target, no end: it keeps asking. What it does do is lean
 * towards the domains carrying the most marks and the ones going worst, and
 * towards questions never seen before. Once everything has been seen it comes
 * back round to what was got wrong, oldest first, which is the only ordering
 * that makes a stream worth continuing.
 */
export async function nextStudyQuestion(
  supabase: SupabaseClient,
  prepId: string,
  opts: { preferDomain?: string } = {},
): Promise<{ question: PoolQuestion | null; domain: string }> {
  const chosen = opts.preferDomain ?? (await weightedDomain(supabase, prepId));

  const { data: seenRows } = await supabase
    .from("exam_responses")
    .select("question_id, score, answered_at")
    .eq("prep_id", prepId)
    .is("sitting_id", null)
    .order("answered_at", { ascending: false })
    .limit(2_000);

  const seen = new Map<string, { score: number; at: string }>();
  for (const r of (seenRows ?? []) as {
    question_id: string;
    score: number;
    answered_at: string;
  }[]) {
    // Rows arrive newest first, so the first sighting of an id is its latest.
    if (!seen.has(r.question_id)) {
      seen.set(r.question_id, { score: r.score, at: r.answered_at });
    }
  }

  const { data: poolRows } = await supabase
    .from("exam_questions")
    .select(SELECT)
    .eq("prep_id", prepId)
    .eq("retired", false)
    .eq("domain", chosen)
    .limit(1_000);

  let pool = (poolRows ?? []) as PoolQuestion[];

  // Nothing written for that domain yet: take whatever exists rather than
  // showing an empty screen.
  if (!pool.length) {
    const { data: anyRows } = await supabase
      .from("exam_questions")
      .select(SELECT)
      .eq("prep_id", prepId)
      .eq("retired", false)
      .limit(1_000);
    pool = (anyRows ?? []) as PoolQuestion[];
  }

  if (!pool.length) return { question: null, domain: chosen };

  const unseen = pool.filter((q) => !seen.has(q.id));
  if (unseen.length) {
    return { question: unseen[Math.floor(Math.random() * unseen.length)], domain: chosen };
  }

  // Everything seen. Worst score first, and among equals the one not looked
  // at for longest.
  const ranked = [...pool].sort((a, b) => {
    const sa = seen.get(a.id)!;
    const sb = seen.get(b.id)!;
    return sa.score - sb.score || sa.at.localeCompare(sb.at);
  });

  // A little randomness among the worst few, so the stream does not become a
  // fixed loop of the same five questions.
  const head = ranked.slice(0, Math.min(5, ranked.length));
  return { question: head[Math.floor(Math.random() * head.length)], domain: chosen };
}

/**
 * Picks which domain to ask about: exam weight first, nudged towards whatever
 * is going worst and whatever has barely been touched.
 */
async function weightedDomain(
  supabase: SupabaseClient,
  prepId: string,
): Promise<string> {
  const { data } = await supabase
    .from("exam_answer_stats")
    .select("domain, answered, accuracy")
    .eq("prep_id", prepId);

  const stats = new Map(
    ((data ?? []) as { domain: string; answered: number; accuracy: number | null }[]).map(
      (r) => [r.domain, r],
    ),
  );

  const weights = DOMAINS.map((d) => {
    const s = stats.get(d.id);
    // Below 70% pulls a domain up, by up to half again. Untouched domains get
    // the same nudge so the stream spreads out early instead of parking on
    // whichever domain happens to be largest.
    const accuracy = s?.accuracy ?? null;
    const weakness = accuracy == null ? 1.3 : 1 + Math.max(0, 70 - accuracy) / 140;
    return { id: d.id, weight: d.weight * weakness };
  });

  const total = weights.reduce((n, w) => n + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.id;
  }
  return weights[weights.length - 1].id;
}

export interface SittingRow {
  id: string;
  prep_id: string;
  question_ids: string[];
  seconds_allowed: number;
  started_at: string;
  submitted_at: string | null;
  score_percent: number | null;
  draft: Record<string, Submitted> | null;
}

export const SITTING_COLUMNS =
  "id, prep_id, question_ids, seconds_allowed, started_at, submitted_at, score_percent, draft";

/** Milliseconds left on a sitting's clock. Negative means time is up. */
export function msRemaining(s: Pick<SittingRow, "seconds_allowed" | "started_at">) {
  return s.seconds_allowed * 1000 - (Date.now() - new Date(s.started_at).getTime());
}

export interface SittingResult {
  percent: number;
  answered: number;
  questions: number;
  byDomain: { domain: string; name: string; questions: number; percent: number | null }[];
}

/**
 * Marks a whole paper and records it.
 *
 * Shared by the submit route and the review page: a paper whose time ran out
 * while the tab was closed has to be marked by whoever notices first, and
 * both of them have to produce the same marks.
 *
 * Marking twice is not an error. A timeout and a last-second press can both
 * arrive, so the response rows are inserted ignoring duplicates and an
 * already-marked sitting simply reports what it scored.
 */
export async function markSitting(
  supabase: SupabaseClient,
  userId: string,
  sitting: SittingRow,
  extraDraft: Record<string, Submitted> = {},
): Promise<SittingResult> {
  const { data: questionRows } = await supabase
    .from("exam_questions")
    .select("id, kind, domain, objective, stem, options, answer_indexes, steps, pairs")
    .in("id", sitting.question_ids);

  const byId = new Map(
    (questionRows ?? []).map((q) => [q.id as string, q as unknown as Answerable]),
  );

  const allowed = new Set(sitting.question_ids);
  const draft: Record<string, Submitted> = { ...(sitting.draft ?? {}) };
  for (const [id, answer] of Object.entries(extraDraft)) {
    if (allowed.has(id)) draft[id] = answer;
  }

  const rows: {
    prep_id: string;
    user_id: string;
    question_id: string;
    sitting_id: string;
    domain: string;
    response: Submitted | null;
    score: number;
    correct: boolean;
  }[] = [];
  let earned = 0;

  for (const questionId of sitting.question_ids) {
    const question = byId.get(questionId);
    if (!question) continue;

    const mark = grade(
      question as Parameters<typeof grade>[0],
      interpret(question, draft[questionId] ?? null),
    );
    earned += mark.score;

    rows.push({
      prep_id: sitting.prep_id,
      user_id: userId,
      question_id: questionId,
      sitting_id: sitting.id,
      domain: question.domain,
      response: draft[questionId] ?? null,
      score: mark.score,
      correct: mark.correct,
    });
  }

  // Out of the marks available, not the questions attempted: an unanswered
  // question is a zero, exactly as it would be on the day.
  const available = sitting.question_ids.length * 100;
  const percent = available ? Math.round((earned / available) * 10_000) / 100 : 0;

  if (!sitting.submitted_at) {
    await supabase
      .from("exam_responses")
      .upsert(rows, { onConflict: "sitting_id,question_id", ignoreDuplicates: true });

    await supabase
      .from("exam_sittings")
      .update({
        draft,
        submitted_at: new Date().toISOString(),
        score_percent: percent,
      })
      .eq("id", sitting.id);
  }

  const byDomain = DOMAINS.map((d) => {
    const marks = rows.filter((r) => r.domain === d.id);
    const got = marks.reduce((n, r) => n + r.score, 0);
    return {
      domain: d.id,
      name: d.name,
      questions: marks.length,
      percent: marks.length ? Math.round(got / marks.length) : null,
    };
  }).filter((d) => d.questions > 0);

  return {
    percent: sitting.submitted_at ? Number(sitting.score_percent ?? percent) : percent,
    answered: Object.keys(draft).length,
    questions: sitting.question_ids.length,
    byDomain,
  };
}
