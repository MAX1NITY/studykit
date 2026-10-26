import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { generateCards } from "@/lib/ai/study";

// Hobby allows up to 300s with fluid compute. Generating cards is the longest
// call in the app, so give it the room rather than cutting it off early.
export const maxDuration = 300;

/** Writes the flashcards for a kit that already holds its material. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const { id: kitId } = await params;
  const { count, replace } = (await request.json().catch(() => ({}))) as {
    count?: number;
    replace?: boolean;
  };

  const cardCount = Math.min(Math.max(count ?? 16, 6), 40);

  try {
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("name, content")
      .eq("kit_id", kitId);

    if (sourcesError) return fail(sourcesError.message, 500);
    if (!sources?.length) {
      return fail("This kit has no material attached.", 404);
    }

    const generated = await generateCards(sources, cardCount);

    if (replace) {
      const { error: clearError } = await supabase
        .from("cards")
        .delete()
        .eq("kit_id", kitId);
      if (clearError) return fail(clearError.message, 500);
    }

    const cards = (generated.cards ?? []).slice(0, 120);
    if (cards.length) {
      const { error: cardsError } = await supabase.from("cards").insert(
        cards.map((c) => ({
          kit_id: kitId,
          user_id: user.id,
          front: c.front,
          back: c.back,
          concept: c.concept,
        })),
      );
      if (cardsError) return fail(cardsError.message, 500);
    }

    // Fill in the subject, and adopt the suggested title only while the kit
    // is still carrying the placeholder name it was created with.
    const { data: kit } = await supabase
      .from("kits")
      .select("title, subject")
      .eq("id", kitId)
      .maybeSingle();

    const patch: Record<string, string> = {};
    if (generated.subject && !kit?.subject) patch.subject = generated.subject;
    if (generated.title && (kit?.title as string)?.endsWith("…")) {
      patch.title = generated.title.slice(0, 200);
    }
    if (Object.keys(patch).length) {
      await supabase.from("kits").update(patch).eq("id", kitId);
    }

    return Response.json({
      card_count: cards.length,
      concepts: generated.concepts ?? [],
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
