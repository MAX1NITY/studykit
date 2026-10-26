import { getSession } from "@/lib/auth";
import { fail, unauthorized } from "@/lib/api";
import type { SourceLike } from "@/lib/ai/study";

const COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet"];

interface Body {
  sources?: { name?: string; kind?: string; content?: string }[];
  title?: string;
}

/**
 * Creates a kit and stores its material. No AI call happens here on purpose.
 *
 * Writing the flashcards is a second request (POST /api/kits/[id]/cards).
 * Keeping them apart means a slow or failed generation can never destroy the
 * material you just uploaded: the kit is already saved, and the cards can be
 * written again from the kit page.
 */
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

  const { data: kit, error: kitError } = await supabase
    .from("kits")
    .insert({
      user_id: user.id,
      title: (body.title?.trim() || provisionalTitle(sources)).slice(0, 200),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    })
    .select("id, title")
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

  return Response.json({ kit });
}

/**
 * A readable name to use until the AI suggests a better one: the file's name
 * without its extension, or the opening words of what was pasted.
 */
function provisionalTitle(sources: SourceLike[]): string {
  const first = sources[0];
  const fromName = first.name.replace(/\.[a-z0-9]+$/i, "").trim();
  if (fromName && fromName.toLowerCase() !== "pasted notes") return fromName;

  const opening = first.content.replace(/\s+/g, " ").trim().slice(0, 60);
  return opening ? `${opening}…` : "Untitled kit";
}
