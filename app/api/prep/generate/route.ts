import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep, materialFor, saveQuestions } from "@/lib/exam/prep";
import { generateQuestions, type QuestionKind } from "@/lib/exam/questions";
import { planBatches, planRemaining, type PoolCount } from "@/lib/exam/plan";
import type { SourceLike } from "@/lib/ai/material";

export const maxDuration = 300;

// Four rather than six. A batch is one structured answer, and a bigger one
// is likelier to run past the model's output budget and come back as
// unparseable JSON — which costs the whole batch, not the extra questions.
const BATCH = 4;

/**
 * Stop starting new batches at this point, so one already running still has
 * room to finish. A batch's own AI call times out at 120s, which this plus
 * that keeps inside the 300s the function is allowed.
 */
const START_DEADLINE_MS = 165_000;

/** A single hiccup must not cost the run; a broken key should not be retried. */
const RETRY_WAIT_MS = 4_000;
const GIVE_UP_AFTER = 3;

/**
 * A rate limit is not a bad batch, so it gets longer and more patience.
 *
 * The provider's own advice on a 429 is to wait a minute. Twenty seconds,
 * twice, is enough to ride out a per-minute limit without spending the whole
 * request waiting on a key that has hit a daily one.
 */
const RATE_LIMIT_WAIT_MS = 20_000;
const RATE_LIMIT_RETRIES = 2;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Writes questions into the pool until its time is nearly up.
 *
 * It used to write one batch of six and return, which made filling a pool
 * fifteen round trips held open in a browser tab, and any one of them failing
 * ended the lot. Now each request keeps going for as long as it safely can —
 * normally five to eight batches — and a batch that fails is retried once and
 * then skipped rather than taken as the end of the job.
 *
 * What to write next is worked out from the pool itself rather than passed in,
 * so there is no run state to lose: calling this again after any interruption
 * simply carries on.
 */
export async function POST(request: Request) {
  const started = Date.now();

  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as { papers?: number };
  const papers = Math.min(5, Math.max(1, Math.round(body.papers ?? 1)));

  try {
    const prep = await getOrCreatePrep(supabase, user.id);

    const { data: materialRows } = await supabase
      .from("exam_material")
      .select("id")
      .eq("prep_id", prep.id)
      .limit(1);

    if (!materialRows?.length) {
      return fail(
        "There is no material loaded yet.",
        400,
        "Add the Core 1 chapters first, then questions can be written from them.",
      );
    }

    const counts = await poolCounts(supabase, prep.id);
    const plan = planBatches(counts, papers, BATCH);

    if (!plan.length) {
      return Response.json({
        saved: 0,
        duplicates: 0,
        rejected: 0,
        batches: 0,
        remaining: 0,
        done: true,
      });
    }

    // The chapters for a domain are the same every batch, so they are read
    // once per request rather than once per batch.
    const sources = new Map<string, SourceLike[]>();
    const recentStems = new Map<string, string[]>();

    let saved = 0;
    let duplicates = 0;
    let rejected = 0;
    // Why questions were thrown away, counted by reason. Without this a batch
    // that generates fine and is then discarded looks exactly like a batch
    // that never generated, and there is no way to tell from the outside.
    const reasons = new Map<string, number>();
    let batches = 0;
    let consecutiveFailures = 0;
    let lastError: string | null = null;
    let throttled = false;

    for (const item of plan) {
      if (Date.now() - started > START_DEADLINE_MS) break;
      if (consecutiveFailures >= GIVE_UP_AFTER) break;
      // A throttled key will refuse the next batch just as readily, so there
      // is nothing to gain by working through the rest of the plan into the
      // same wall. Stop and let the caller come back.
      if (throttled) break;

      if (!sources.has(item.domain)) {
        sources.set(item.domain, await materialFor(supabase, prep.id, item.domain));
      }
      const material = sources.get(item.domain)!;
      if (!material.length) continue;

      const key = `${item.domain}:${item.kind}`;
      if (!recentStems.has(key)) {
        const { data } = await supabase
          .from("exam_questions")
          .select("stem")
          .eq("prep_id", prep.id)
          .eq("domain", item.domain)
          .eq("kind", item.kind)
          .order("created_at", { ascending: false })
          .limit(12);
        recentStems.set(key, (data ?? []).map((r) => r.stem as string));
      }

      let attempt = 0;
      for (;;) {
        try {
          const result = await generateQuestions({
            sources: material,
            domainId: item.domain,
            kind: item.kind as QuestionKind,
            count: item.count,
            rotation: item.rotation,
            recentStems: recentStems.get(key) ?? [],
          });

          const written = await saveQuestions(
            supabase,
            prep.id,
            user.id,
            result.questions,
          );

          saved += written;
          duplicates += result.questions.length - written;
          rejected += result.rejected.length;
          batches += 1;
          consecutiveFailures = 0;

          for (const note of result.rejected) {
            const reason = note.split(":")[0];
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
          }

          console.log(
            `[prep] ${item.domain} ${item.kind} rot=${item.rotation} ` +
              `returned=${result.returned} kept=${result.questions.length} ` +
              `saved=${written} dupes=${result.questions.length - written} ` +
              `rejected=${result.rejected.length}`,
          );
          for (const note of result.rejected.slice(0, 4)) {
            console.log(`[prep]   dropped - ${note}`);
          }

          // Keep the no-repeats list current within the request too.
          recentStems.set(key, [
            ...result.questions.map((q) => q.stem),
            ...(recentStems.get(key) ?? []),
          ].slice(0, 12));
          break;
        } catch (cause) {
          attempt += 1;
          lastError = cause instanceof Error ? cause.message : String(cause);
          console.log(
            `[prep] ${item.domain} ${item.kind} rot=${item.rotation} FAILED ` +
              `attempt=${attempt}: ${lastError}`,
          );
          const status = (cause as { status?: number } | null)?.status;

          if (status === 429) {
            if (attempt > RATE_LIMIT_RETRIES || Date.now() - started > START_DEADLINE_MS) {
              throttled = true;
              break;
            }
            await wait(RATE_LIMIT_WAIT_MS);
            continue;
          }

          if (attempt > 1 || Date.now() - started > START_DEADLINE_MS) {
            // This batch is the problem, not the key: skip it so the rest of
            // the plan still gets written.
            consecutiveFailures += 1;
            break;
          }
          await wait(RETRY_WAIT_MS);
        }
      }
    }

    const after = await poolCounts(supabase, prep.id);
    const remaining = planRemaining(after, papers);

    return Response.json({
      saved,
      duplicates,
      rejected,
      batches,
      remaining,
      done: remaining === 0,
      // Reported rather than thrown: the questions already written are real
      // and the caller should keep them and come back for the rest.
      stalled: consecutiveFailures >= GIVE_UP_AFTER,
      throttled,
      // Surfaced, not just counted: "18 written, 6 discarded for an unknown
      // objective" is actionable; "0 saved" is not.
      reasons: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([reason, count]) => ({ reason, count })),
      lastError: saved === 0 || throttled ? lastError : null,
      elapsedMs: Date.now() - started,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}

/** What the pool holds, by domain and question type. */
async function poolCounts(
  supabase: SupabaseClient,
  prepId: string,
): Promise<PoolCount[]> {
  const { data } = await supabase
    .from("exam_questions")
    .select("domain, kind")
    .eq("prep_id", prepId)
    .eq("retired", false);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { domain: string; kind: string }[]) {
    const key = `${row.domain}\u0000${row.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].map(([key, count]) => {
    const [domain, kind] = key.split("\u0000");
    return { domain, kind, count };
  });
}
