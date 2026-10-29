import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { generateGuide } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute; 60 was cutting AI calls off.
export const maxDuration = 300;

/** Regenerates the revision guide for a kit. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { kitId } = (await request.json().catch(() => ({}))) as {
    kitId?: string;
  };
  if (!kitId) return fail("kitId is required.");

  try {
    const { data: sources, error } = await supabase
      .from("sources")
      .select("name, content")
      .eq("kit_id", kitId);

    if (error) return fail(error.message, 500);
    if (!sources?.length) return fail("This kit has no material attached.", 404);

    const markdown = await generateGuide(sources);

    const { error: insertError } = await supabase
      .from("guides")
      .insert({ kit_id: kitId, user_id: user.id, markdown });

    if (insertError) return fail(insertError.message, 500);

    /*
     * Keep the newest guide and drop the rest.
     *
     * The page only ever reads the latest row, so every rewrite was leaving
     * another full guide behind it — invisible, and growing with each press.
     * Deleting after the insert means a failed insert cannot lose the guide
     * the student already had.
     */
    const { data: stale } = await supabase
      .from("guides")
      .select("id")
      .eq("kit_id", kitId)
      .order("created_at", { ascending: false })
      .range(1, 50);

    if (stale?.length) {
      await supabase
        .from("guides")
        .delete()
        .in(
          "id",
          stale.map((row) => row.id),
        );
    }

    return Response.json({ markdown });
  } catch (cause) {
    return failFrom(cause);
  }
}
