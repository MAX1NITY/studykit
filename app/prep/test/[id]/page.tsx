import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import {
  getOrCreatePrep,
  markSitting,
  SITTING_COLUMNS,
  type SittingRow,
} from "@/lib/exam/prep";
import {
  present,
  interpret,
  detailForDisplay,
  type Submitted,
} from "@/lib/exam/select";
import { grade } from "@/lib/exam/grade";
import { EXAM, domain as findDomain } from "@/lib/exam/core1";
import { since } from "@/lib/format";
import { Review } from "./review";

export const metadata = { title: "Mock exam result · Core 1" };

export default async function SittingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase, user } = session;
  const { id } = await params;

  const prep = await getOrCreatePrep(supabase, user.id);

  const { data } = await supabase
    .from("exam_sittings")
    .select(SITTING_COLUMNS)
    .eq("id", id)
    .eq("prep_id", prep.id)
    .maybeSingle();

  const sitting = data as SittingRow | null;
  if (!sitting) notFound();

  // A paper whose time ran out while the tab was closed is marked here, the
  // same way the submit route would have marked it.
  const result = await markSitting(supabase, user.id, sitting);

  const { data: questionRows } = await supabase
    .from("exam_questions")
    .select(
      "id, kind, domain, objective, stem, options, answer_indexes, steps, pairs, explanation",
    )
    .in("id", sitting.question_ids);

  const byId = new Map((questionRows ?? []).map((q) => [q.id as string, q]));
  const draft = (sitting.draft ?? {}) as Record<string, Submitted>;

  const items = sitting.question_ids
    .map((qid, index) => {
      const q = byId.get(qid);
      if (!q) return null;
      const submitted = draft[qid] ?? null;
      const mark = grade(q, interpret(q, submitted));
      return {
        index: index + 1,
        question: present(q),
        submitted,
        score: mark.score,
        detail: detailForDisplay(q, mark.detail),
        explanation: q.explanation as string,
        answer: answerFor(q),
        attempted: submitted != null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const right = items.filter((i) => i.score === 100).length;
  const partial = items.filter((i) => i.score > 0 && i.score < 100).length;

  return (
    <>
      <TopBar
        breadcrumb={
          <Link href="/prep" className="hover:text-ink">
            {EXAM.name}
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <p className="font-mono text-[12px] uppercase tracking-wider text-mute">
          Mock exam {"·"} {since(sitting.started_at)}
        </p>
        <h1 className="read mt-1 text-[32px] leading-none">
          {result.percent}%
          <span className="ml-2 align-middle text-[15px] font-normal text-mute">
            of the marks
          </span>
        </h1>

        <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-mute">
          {right} right outright, {partial} part-marked, {items.length - right - partial}{" "}
          wrong or unanswered, out of {items.length}.
        </p>
        <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-mute">
          CompTIA reports a scaled score out of {EXAM.scaleTo} with{" "}
          {EXAM.passScaled} to pass. That scale is theirs and a percentage does
          not convert into it, so this is the percentage of marks and nothing
          more {"—"} useful for comparing one mock against the next, not
          for predicting the day.
        </p>

        {/* ---------------------------------------------------- by domain */}
        <section className="mt-9">
          <h2 className="read text-[19px]">By domain</h2>
          <ul className="mt-3 border-t border-rule text-[14px]">
            {result.byDomain.map((d) => (
              <li
                key={d.domain}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5"
              >
                <span>
                  <span className="font-mono text-[13px] text-mute">{d.domain}</span>{" "}
                  {findDomain(d.domain)?.name ?? d.name}
                  <span className="ml-2 text-[13px] text-mute">
                    {d.questions} question{d.questions === 1 ? "" : "s"}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-medium ${
                    (d.percent ?? 0) >= 70
                      ? "text-sure"
                      : (d.percent ?? 0) >= 50
                        ? "text-brass"
                        : "text-mark"
                  }`}
                >
                  {d.percent}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Review items={items} />

        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            href="/prep/test"
            className="rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
          >
            Sit another
          </Link>
          <Link
            href="/prep/study"
            className="rounded-sm border border-rule px-4 py-2 text-[14px]"
          >
            Back to study questions
          </Link>
        </div>
      </main>
    </>
  );
}

/** The correct answer, phrased for whichever shape the question is. */
function answerFor(q: {
  kind: string;
  options?: string[] | null;
  answer_indexes?: number[] | null;
  steps?: string[] | null;
  pairs?: { left: string; right: string }[] | null;
}): string[] {
  if (q.kind === "single" || q.kind === "multiple") {
    return (q.answer_indexes ?? [])
      .map((i) => (q.options ?? [])[i])
      .filter((x): x is string => Boolean(x));
  }
  if (q.kind === "ordering") return q.steps ?? [];
  if (q.kind === "matching") {
    return (q.pairs ?? []).map((p) => `${p.left} → ${p.right}`);
  }
  return [];
}
