import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import type { Submitted } from "@/lib/exam/select";
import {
  markSitting,
  msRemaining,
  SITTING_COLUMNS,
  type SittingRow,
} from "@/lib/exam/prep";

export const maxDuration = 120;

type Draft = Record<string, Submitted>;

async function load(supabase: SupabaseClient, id: string) {
  const { data } = await supabase
    .from("exam_sittings")
    .select(SITTING_COLUMNS)
    .eq("id", id)
    .single();
  return (data as SittingRow | null) ?? null;
}

/**
 * Saves answers given so far, without marking any of them.
 *
 * Drafts live on the sitting rather than in exam_responses, which only ever
 * holds marked answers: a half-finished paper must not show up in his
 * accuracy. Saving as he goes means a closed tab does not cost the paper.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { draft?: Draft };

  try {
    const sitting = await load(session.supabase, id);
    if (!sitting) return fail("That mock exam was not found.", 404);
    if (sitting.submitted_at) return fail("That mock exam is already marked.", 409);

    const allowed = new Set(sitting.question_ids);
    const draft: Draft = {};
    for (const [questionId, answer] of Object.entries(body.draft ?? {})) {
      if (allowed.has(questionId)) draft[questionId] = answer;
    }

    const { error } = await session.supabase
      .from("exam_sittings")
      .update({ draft, draft_saved_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return fail(error.message, 500);

    return Response.json({
      saved: Object.keys(draft).length,
      msRemaining: Math.max(0, msRemaining(sitting)),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}

/**
 * Marks the paper.
 *
 * Called when he finishes and also when the clock hits zero, which is why it
 * takes a final draft in the same request: whatever was on screen the moment
 * time expired still counts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { draft?: Draft };

  try {
    const sitting = await load(supabase, id);
    if (!sitting) return fail("That mock exam was not found.", 404);

    const result = await markSitting(supabase, user.id, sitting, body.draft ?? {});
    return Response.json({ id, ...result });
  } catch (cause) {
    return failFrom(cause);
  }
}
