import { getSession } from "@/lib/auth";
import { failFrom, unauthorized } from "@/lib/api";
import { getOrCreatePrep, nextStudyQuestion } from "@/lib/exam/prep";
import { present } from "@/lib/exam/select";
import { domain as findDomain } from "@/lib/exam/core1";

/**
 * The next question in the ongoing study stream.
 *
 * Returns the question as the student sees it and nothing more: the answer
 * stays server-side until it is submitted, so the correct option cannot be
 * read out of the response.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { supabase, user } = session;

  const url = new URL(request.url);
  const preferDomain = url.searchParams.get("domain") ?? undefined;

  try {
    const prep = await getOrCreatePrep(supabase, user.id);
    const { question, domain } = await nextStudyQuestion(supabase, prep.id, {
      preferDomain: findDomain(preferDomain ?? "") ? preferDomain : undefined,
    });

    if (!question) {
      return Response.json({ question: null, domain, empty: true });
    }

    return Response.json({
      question: present(question),
      domainName: findDomain(question.domain)?.name ?? question.domain,
    });
  } catch (cause) {
    return failFrom(cause);
  }
}
