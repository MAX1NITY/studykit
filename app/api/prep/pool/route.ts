import { getSession } from "@/lib/auth";
import { failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep } from "@/lib/exam/prep";

/**
 * What is in the pool, broken down by domain and question type.
 *
 * The pool builder reads this before it starts so a stopped run can be
 * resumed rather than restarted.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  try {
    const prep = await getOrCreatePrep(supabase, user.id);

    const { data } = await supabase
      .from("exam_questions")
      .select("domain, kind")
      .eq("prep_id", prep.id)
      .eq("retired", false);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { domain: string; kind: string }[]) {
      const key = `${row.domain}\u0000${row.kind}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Response.json({
      rows: [...counts.entries()].map(([key, count]) => {
        const [domain, kind] = key.split("\u0000");
        return { domain, kind, count };
      }),
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
