import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep } from "@/lib/exam/prep";
import { readSeedChapters } from "@/lib/exam/seed";

export const maxDuration = 120;

/**
 * Loads the Core 1 syllabus into this account.
 *
 * Idempotent: chapters are keyed by their ordinal, so running it again
 * refreshes the text in place rather than filling the prep with duplicates.
 * The question pool is untouched either way.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  try {
    const chapters = await readSeedChapters();
    if (!chapters.length) {
      return fail(
        "The Core 1 chapters are not available in this deployment.",
        500,
        "They should be in content/core1. Paste the chapters in instead, or redeploy.",
      );
    }

    const prep = await getOrCreatePrep(supabase, user.id);

    const { error } = await supabase.from("exam_material").upsert(
      chapters.map((c) => ({
        prep_id: prep.id,
        user_id: user.id,
        ordinal: c.ordinal,
        title: c.title,
        domain: c.domain,
        objectives: c.objectives,
        content: c.content,
        char_count: c.content.length,
      })),
      { onConflict: "prep_id,ordinal" },
    );

    if (error) return fail(error.message, 500);

    const unclassified = chapters.filter((c) => !c.domain).map((c) => c.title);

    return Response.json({
      chapters: chapters.length,
      chars: chapters.reduce((n, c) => n + c.content.length, 0),
      unclassified,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
