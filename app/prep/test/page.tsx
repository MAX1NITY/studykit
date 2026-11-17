import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar, Notice } from "@/components/chrome";
import { getOrCreatePrep, msRemaining } from "@/lib/exam/prep";
import { present, composeSitting, type Submitted } from "@/lib/exam/select";
import { EXAM, DOMAINS, domainQuota } from "@/lib/exam/core1";
import { Exam } from "./exam";
import { StartMock } from "./start";

export const metadata = { title: "Mock exam · Core 1" };

interface SittingRow {
  id: string;
  question_ids: string[];
  seconds_allowed: number;
  started_at: string;
  submitted_at: string | null;
  draft: Record<string, Submitted> | null;
}

export default async function TestPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase, user } = session;

  const prep = await getOrCreatePrep(supabase, user.id);

  const { data: openRows } = await supabase
    .from("exam_sittings")
    .select("id, question_ids, seconds_allowed, started_at, submitted_at, draft")
    .eq("prep_id", prep.id)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  const open = (openRows?.[0] as SittingRow | undefined) ?? null;

  if (open) {
    const msLeft = msRemaining(open);

    // The clock ran out while he was away. Mark what was saved and show it,
    // rather than letting him reopen a paper whose time has gone.
    if (msLeft <= 0) redirect(`/prep/test/${open.id}?expired=1`);

    const { data: questionRows } = await supabase
      .from("exam_questions")
      .select("id, kind, domain, objective, stem, options, answer_indexes, steps, pairs")
      .in("id", open.question_ids);

    const byId = new Map((questionRows ?? []).map((q) => [q.id as string, q]));
    const questions = open.question_ids
      .map((id) => byId.get(id))
      .filter((q): q is NonNullable<typeof q> => q != null)
      .map((q) => present(q));

    return (
      <>
        <TopBar breadcrumb={`${EXAM.name} · mock exam`} />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
          <Exam
            sittingId={open.id}
            questions={questions}
            draft={open.draft ?? {}}
            msRemaining={msLeft}
          />
        </main>
      </>
    );
  }

  // ------------------------------------------------- nothing running yet
  const { data: poolRows } = await supabase
    .from("exam_questions")
    .select("id, domain, kind")
    .eq("prep_id", prep.id)
    .eq("retired", false);

  const { shortfall } = composeSitting(
    (poolRows ?? []) as { id: string; domain: string; kind: string }[],
    EXAM.questions,
  );
  const quota = domainQuota(EXAM.questions);
  const short = Object.entries(shortfall);

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
        <h1 className="read text-[26px] leading-tight">Mock exam</h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-mute">
          {EXAM.questions} questions, {EXAM.minutes} minutes, weighted the way
          the real paper is. The clock runs on the server, so closing the tab
          does not pause it and reopening does not reset it. Answers save as
          you go. It marks itself when you finish or when the time runs out,
          and then you can go through every question.
        </p>

        <ul className="mt-6 border-t border-rule text-[14px]">
          {DOMAINS.map((d) => (
            <li
              key={d.id}
              className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5"
            >
              <span>
                <span className="font-mono text-[13px] text-mute">{d.id}</span>{" "}
                {d.name}
              </span>
              <span className="shrink-0 text-mute">
                {quota[d.id]} question{quota[d.id] === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>

        {short.length ? (
          <div className="mt-8">
            <Notice
              title="Not enough questions written for a full paper yet."
              hint={`Still needs ${short
                .map(
                  ([d, n]) =>
                    `${n} more for ${DOMAINS.find((x) => x.id === d)?.name ?? d}`,
                )
                .join(", ")}. A short paper would misrepresent where you stand, so it is better to write them first.`}
              tone="brass"
            />
            <Link
              href="/prep"
              className="mt-6 inline-block rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
            >
              Write more questions
            </Link>
          </div>
        ) : (
          <StartMock />
        )}
      </main>
    </>
  );
}
