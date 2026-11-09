import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";

const KINDS = new Set(["text", "pdf", "url", "note"]);

/**
 * Adds material to a kit that already exists.
 *
 * No AI runs here, for the same reason kit creation does not: saving what
 * the student gave us must not be able to fail because a model was slow.
 * Writing cards over the new material is a separate, retryable step.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const { name, kind, content } = (await request.json().catch(() => ({}))) as {
    name?: string;
    kind?: string;
    content?: string;
  };

  const text = (content ?? "").trim();
  if (text.length < 200) {
    return fail(
      "That is too little material to add.",
      400,
      "Aim for at least a few paragraphs.",
    );
  }

  try {
    // RLS keeps this to the caller's own kits; the check gives a clear 404
    // rather than a silent insert failure.
    const { data: kit } = await session.supabase
      .from("kits")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!kit) return fail("That kit was not found.", 404);

    const { error } = await session.supabase.from("sources").insert({
      kit_id: id,
      user_id: session.user.id,
      name: (name?.trim() || "Added material").slice(0, 200),
      kind: KINDS.has(kind ?? "") ? kind : "text",
      content: text,
      char_count: text.length,
    });

    if (error) return fail(error.message, 500);

    return Response.json({ added: true, chars: text.length });
  } catch (cause) {
    return failFrom(cause);
  }
}
