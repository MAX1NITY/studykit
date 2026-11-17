import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep, type PoolQuestion } from "@/lib/exam/prep";
import { composeSitting } from "@/lib/exam/select";
import { EXAM, domain as findDomain } from "@/lib/exam/core1";

export const maxDuration = 60;

/**
 * Starts a mock exam: 90 questions in 90 minutes, weighted like the real
 * paper.
 *
 * A pool too thin to fill a domain's quota is refused, with the exact
 * shortfall, rather than handed over as a 78-question paper. A mock that
 * silently under-weights the biggest domain would teach the wrong thing about
 * where he stands.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  try {
    const prep = await getOrCreatePrep(supabase, user.id);

    // An unfinished sitting is resumed rather than replaced: the clock on it
    // is still running.
    const { data: open } = await supabase
      .from("exam_sittings")
      .select("id, started_at, seconds_allowed")
      .eq("prep_id", prep.id)
      .is("submitted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);

    const running = open?.[0];
    if (running) {
      const left =
        running.seconds_allowed * 1000 -
        (Date.now() - new Date(running.started_at).getTime());
      if (left > 0) {
        return Response.json({ id: running.id, resumed: true });
      }
    }

    const { data: poolRows } = await supabase
      .from("exam_questions")
      .select("id, domain, kind")
      .eq("prep_id", prep.id)
      .eq("retired", false);

    const pool = (poolRows ?? []) as Pick<PoolQuestion, "id" | "domain" | "kind">[];
    const { ids, shortfall } = composeSitting(pool, EXAM.questions);

    if (Object.keys(shortfall).length) {
      const missing = Object.entries(shortfall)
        .map(([d, n]) => `${n} more for ${findDomain(d)?.name ?? d}`)
        .join(", ");
      return fail(
        `Not enough questions written yet for a full ${EXAM.questions}-question paper.`,
        409,
        `Needs ${missing}. Write more questions, then start the mock.`,
      );
    }

    const { data, error } = await supabase
      .from("exam_sittings")
      .insert({
        prep_id: prep.id,
        user_id: user.id,
        question_ids: ids,
        seconds_allowed: EXAM.minutes * 60,
      })
      .select("id")
      .single();

    if (error || !data) return fail(error?.message ?? "Could not start the mock.", 500);

    return Response.json({ id: data.id, resumed: false });
  } catch (cause) {
    return failFrom(cause);
  }
}
