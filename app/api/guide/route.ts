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

    return Response.json({ markdown });
  } catch (cause) {
    return failFrom(cause);
  }
}
