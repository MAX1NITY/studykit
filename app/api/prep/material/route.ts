import { getSession } from "@/lib/auth";
import { fail, failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep } from "@/lib/exam/prep";
import { declaredObjectives } from "@/lib/exam/select";
import { classifyMaterial } from "@/lib/exam/questions";

export const maxDuration = 300;

interface Incoming {
  title?: string;
  content?: string;
}

/**
 * Adds syllabus material to the Core 1 prep.
 *
 * Each chapter's domain is read from the CompTIA objective header real course
 * material carries, and only classified by AI when there is no header to
 * read. That ordering is on purpose: the header is right by construction and
 * free, and a chapter filed under the wrong domain would skew the weighting
 * of every mock exam afterwards.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const body = (await request.json().catch(() => ({}))) as {
    chapters?: Incoming[];
  };

  const chapters = (body.chapters ?? []).filter(
    (c): c is { title: string; content: string } =>
      typeof c?.title === "string" &&
      c.title.trim().length > 0 &&
      typeof c?.content === "string" &&
      c.content.trim().length > 200,
  );

  if (!chapters.length) {
    return fail(
      "No usable chapters in that.",
      400,
      "Each chapter needs a title and at least a couple of hundred characters of text.",
    );
  }

  try {
    const prep = await getOrCreatePrep(supabase, user.id);

    const { data: existing } = await supabase
      .from("exam_material")
      .select("ordinal")
      .eq("prep_id", prep.id)
      .order("ordinal", { ascending: false })
      .limit(1);

    let ordinal = ((existing?.[0]?.ordinal as number | undefined) ?? 0) + 1;
    const rows = [];
    const unclassified: string[] = [];

    for (const chapter of chapters) {
      const content = chapter.content.trim();
      let { domain, objectives } = declaredObjectives(content);

      if (!domain) {
        try {
          const guess = await classifyMaterial(chapter.title, content);
          domain = guess.domain;
          objectives = guess.objectives;
        } catch {
          // Leave it unclassified rather than filing it under a guess.
          domain = "";
        }
      }

      if (!domain) unclassified.push(chapter.title);

      rows.push({
        prep_id: prep.id,
        user_id: user.id,
        ordinal: ordinal++,
        title: chapter.title.trim().slice(0, 200),
        domain,
        objectives,
        content,
        char_count: content.length,
      });
    }

    const { error } = await supabase.from("exam_material").insert(rows);
    if (error) return fail(error.message, 500);

    return Response.json({
      added: rows.length,
      chars: rows.reduce((n, r) => n + r.char_count, 0),
      unclassified,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
