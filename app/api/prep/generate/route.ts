import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep, materialFor, saveQuestions } from "@/lib/exam/prep";
import { generateQuestions, type QuestionKind } from "@/lib/exam/questions";
import { DOMAINS } from "@/lib/exam/core1";

export const maxDuration = 300;

const KINDS = new Set<QuestionKind>(["single", "multiple", "ordering", "matching"]);

/**
 * Writes one batch of questions into the pool.
 *
 * One batch per request, rather than a whole pool, because a pool worth
 * sitting is several hundred questions and no single request should be
 * holding that. The caller loops and watches it fill, which also means a
 * failure costs one batch instead of the lot.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as {
    domain?: string;
    kind?: string;
    count?: number;
    rotation?: number;
  };

  const domainId = body.domain ?? "";
  if (!DOMAINS.some((d) => d.id === domainId)) {
    return fail(`Unknown domain ${domainId || "(none given)"}.`);
  }

  const kind = (body.kind ?? "single") as QuestionKind;
  if (!KINDS.has(kind)) return fail(`Unknown question type ${body.kind}.`);

  const count = Math.min(8, Math.max(1, Math.round(body.count ?? 5)));

  try {
    const prep = await getOrCreatePrep(supabase, user.id);
    const sources = await materialFor(supabase, prep.id, domainId);

    if (!sources.length) {
      return fail(
        "There is no material loaded yet.",
        400,
        "Add the Core 1 chapters first, then questions can be written from them.",
      );
    }

    // The stems already written for this domain, so a refill does not spend a
    // call producing the same question in different words.
    const { data: recent } = await supabase
      .from("exam_questions")
      .select("stem")
      .eq("prep_id", prep.id)
      .eq("domain", domainId)
      .order("created_at", { ascending: false })
      .limit(12);

    const { questions, rejected } = await generateQuestions({
      sources,
      domainId,
      kind,
      count,
      rotation: body.rotation ?? 0,
      recentStems: (recent ?? []).map((r) => r.stem as string),
    });

    const saved = await saveQuestions(supabase, prep.id, user.id, questions);

    return Response.json({
      domain: domainId,
      kind,
      written: questions.length,
      saved,
      duplicates: questions.length - saved,
      rejected,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
