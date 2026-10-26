import { getSession } from "@/lib/auth";
import { failFrom, fail, unauthorized } from "@/lib/api";
import { generateKit, generateGuide, type SourceLike } from "@/lib/ai/study";

export const maxDuration = 60;

const COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet"];

interface Body {
  sources?: { name?: string; kind?: string; content?: string }[];
  title?: string;
  cardCount?: number;
}

/** Builds a study kit: flashcards and a revision guide from raw material. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail("Expected a JSON body.");
  }

  const sources: SourceLike[] = (body.sources ?? [])
    .map((s) => ({
      name: (s.name ?? "Untitled").slice(0, 200),
      kind: s.kind ?? "text",
      content: (s.content ?? "").trim(),
    }))
    .filter((s) => s.content.length > 0);

  if (sources.length === 0) {
    return fail("Add some material first — paste notes or upload a file.");
  }

  const totalChars = sources.reduce((n, s) => n + s.content.length, 0);
  if (totalChars < 200) {
    return fail(
      "That is too little material to build a kit from.",
      400,
      "Aim for at least a few paragraphs.",
    );
  }

  try {
    const generated = await generateKit(sources, body.cardCount ?? 24);

    const { data: kit, error: kitError } = await supabase
      .from("kits")
      .insert({
        user_id: user.id,
        title: (body.title?.trim() || generated.title).slice(0, 200),
        subject: generated.subject,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      })
      .select("id, title, subject, color")
      .single();

    if (kitError || !kit) {
      return fail(kitError?.message ?? "Could not save the kit.", 500);
    }

    const { error: sourcesError } = await supabase.from("sources").insert(
      sources.map((s, i) => ({
        kit_id: kit.id,
        user_id: user.id,
        name: s.name,
        kind: (body.sources?.[i]?.kind ?? "text") as string,
        content: s.content,
        char_count: s.content.length,
      })),
    );
    if (sourcesError) return fail(sourcesError.message, 500);

    if (generated.cards?.length) {
      const { error: cardsError } = await supabase.from("cards").insert(
        generated.cards.slice(0, 120).map((c) => ({
          kit_id: kit.id,
          user_id: user.id,
          front: c.front,
          back: c.back,
          concept: c.concept,
        })),
      );
      if (cardsError) return fail(cardsError.message, 500);
    }

    // The guide is a second call, so a failure there must not lose the kit.
    try {
      const markdown = await generateGuide(sources);
      await supabase
        .from("guides")
        .insert({ kit_id: kit.id, user_id: user.id, markdown });
    } catch (guideError) {
      console.error("guide generation failed", guideError);
    }

    return Response.json({
      kit,
      card_count: generated.cards?.length ?? 0,
      concepts: generated.concepts ?? [],
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
