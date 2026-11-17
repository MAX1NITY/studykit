import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar, Notice } from "@/components/chrome";
import { getOrCreatePrep } from "@/lib/exam/prep";
import { DOMAINS, EXAM, domainQuota } from "@/lib/exam/core1";
import { since } from "@/lib/format";
import { PoolBuilder } from "./pool-builder";
import { LoadSyllabus } from "./load-syllabus";
import { AddChapters } from "./add-chapters";
import { readSeedChapters } from "@/lib/exam/seed";

export const metadata = { title: "CompTIA A+ Core 1 · StudyKit" };

interface Overview {
  chapters: number;
  material_chars: number;
  pool: number;
  answered: number;
  accuracy: number | null;
  last_answered_at: string | null;
  sittings: number;
  best_percent: number | null;
}

export default async function PrepPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase, user } = session;

  const prep = await getOrCreatePrep(supabase, user.id);

  // The chapters ship with the app only when they are present on disk, which
  // they are locally and are not in a deployment: the repository is public
  // and the material is a textbook. Without them the file drop is the way in.
  const seedAvailable = await readSeedChapters()
    .then((c) => c.length > 0)
    .catch(() => false);

  const [{ data: overviewRows }, { data: poolRows }, { data: answerRows }, { data: sittingRows }] =
    await Promise.all([
      supabase.from("exam_prep_overview").select("*").eq("id", prep.id),
      supabase.from("exam_pool_stats").select("domain, pool").eq("prep_id", prep.id),
      supabase
        .from("exam_answer_stats")
        .select("domain, answered, accuracy")
        .eq("prep_id", prep.id),
      supabase
        .from("exam_sittings")
        .select("id, started_at, submitted_at, score_percent, question_ids")
        .eq("prep_id", prep.id)
        .order("started_at", { ascending: false })
        .limit(6),
    ]);

  const overview = (overviewRows?.[0] ?? {
    chapters: 0,
    material_chars: 0,
    pool: 0,
    answered: 0,
    accuracy: null,
    last_answered_at: null,
    sittings: 0,
    best_percent: null,
  }) as Overview;

  const pool = new Map(
    ((poolRows ?? []) as { domain: string; pool: number }[]).map((r) => [r.domain, r.pool]),
  );
  const answers = new Map(
    ((answerRows ?? []) as { domain: string; answered: number; accuracy: number | null }[]).map(
      (r) => [r.domain, r],
    ),
  );

  const quota = domainQuota(EXAM.questions);
  const sittings = (sittingRows ?? []) as {
    id: string;
    started_at: string;
    submitted_at: string | null;
    score_percent: number | null;
    question_ids: string[];
  }[];

  const ready = DOMAINS.every((d) => (pool.get(d.id) ?? 0) >= quota[d.id]);
  const hasMaterial = overview.chapters > 0;

  return (
    <>
      <TopBar breadcrumb={<Link href="/kits" className="hover:text-ink">Kits</Link>} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <p className="font-mono text-[12px] uppercase tracking-wider text-mute">
          {EXAM.code} {"·"} {EXAM.version}
        </p>
        <h1 className="read mt-1 text-[28px] leading-tight">{EXAM.name}</h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-mute">
          {EXAM.questions} questions in {EXAM.minutes} minutes, across five
          weighted domains. CompTIA reports a scaled score out of{" "}
          {EXAM.scaleTo} with {EXAM.passScaled} to pass; that scale is theirs
          and is not something a percentage converts into, so the mocks here
          report the marks you actually got.
        </p>

        {!hasMaterial ? (
          <div className="mt-8">
            <Notice
              title="No Core 1 material loaded yet."
              hint="Questions are written from your own chapters, so nothing can be generated until they are in."
              tone="brass"
            />
            {seedAvailable ? <LoadSyllabus /> : null}
            <AddChapters />
          </div>
        ) : null}

        {/* ------------------------------------------------- the two things to do */}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/prep/study"
            className={`rounded-sm px-4 py-2.5 text-[14px] font-medium ${
              overview.pool > 0
                ? "bg-ink text-bg"
                : "pointer-events-none border border-rule text-mute"
            }`}
          >
            Study questions
          </Link>
          <Link
            href="/prep/test"
            className={`rounded-sm border px-4 py-2.5 text-[14px] font-medium ${
              ready ? "border-ink" : "pointer-events-none border-rule text-mute"
            }`}
          >
            {ready ? "Sit a mock exam" : `Mock needs a fuller question pool`}
          </Link>
        </div>

        {/* ------------------------------------------------------------- domains */}
        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="read text-[20px]">Domains</h2>
            <p className="text-[13px] text-mute">
              {overview.pool} question{overview.pool === 1 ? "" : "s"} written
            </p>
          </div>

          <ul className="mt-4 border-t border-rule">
            {DOMAINS.map((d) => {
              const written = pool.get(d.id) ?? 0;
              const need = quota[d.id];
              const stat = answers.get(d.id);
              const enough = written >= need;

              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-b border-rule py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-[15px]">
                      <span className="font-mono text-[13px] text-mute">{d.id}</span>{" "}
                      {d.name}
                    </p>
                    <p className="mt-0.5 text-[13px] text-mute">
                      {d.weight}% of the exam {"·"} {need} question
                      {need === 1 ? "" : "s"} in a full paper
                    </p>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-5 text-[13px]">
                    <span className={enough ? "text-mute" : "text-brass"}>
                      {written} written
                    </span>
                    {stat?.answered ? (
                      <span
                        className={
                          (stat.accuracy ?? 0) >= 70
                            ? "text-sure"
                            : (stat.accuracy ?? 0) >= 50
                              ? "text-brass"
                              : "text-mark"
                        }
                      >
                        {stat.accuracy}% over {stat.answered}
                      </span>
                    ) : (
                      <span className="text-mute">not studied</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {hasMaterial ? <PoolBuilder /> : null}
        </section>

        {/* -------------------------------------------------------- study so far */}
        {overview.answered > 0 ? (
          <section className="mt-12">
            <h2 className="read text-[20px]">Study questions so far</h2>
            <p className="mt-2 text-[14px] text-mute">
              {overview.answered} answered, {overview.accuracy}% of the marks
              {overview.last_answered_at
                ? `, last ${since(overview.last_answered_at)}`
                : ""}
              . This one just keeps going; there is nothing to finish.
            </p>
          </section>
        ) : null}

        {/* ------------------------------------------------------ mock exams */}
        {sittings.length ? (
          <section className="mt-12">
            <h2 className="read text-[20px]">Mock exams</h2>
            <ul className="mt-4 border-t border-rule">
              {sittings.map((s) => (
                <li key={s.id} className="border-b border-rule">
                  {s.submitted_at ? (
                    <Link
                      href={`/prep/test/${s.id}`}
                      className="group flex items-baseline justify-between gap-4 py-3.5"
                    >
                      <span className="text-[15px] group-hover:underline group-hover:underline-offset-4">
                        {s.question_ids.length} questions {"·"}{" "}
                        {since(s.started_at)}
                      </span>
                      <span
                        className={`shrink-0 text-[15px] font-medium ${
                          (s.score_percent ?? 0) >= 70 ? "text-sure" : "text-brass"
                        }`}
                      >
                        {s.score_percent}%
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-baseline justify-between gap-4 py-3.5">
                      <span className="text-[15px] text-mute">
                        {s.question_ids.length} questions {"·"}{" "}
                        started {since(s.started_at)}
                      </span>
                      <Link
                        href="/prep/test"
                        className="shrink-0 text-[13px] text-brass hover:underline"
                      >
                        resume
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ------------------------------------------------------- material */}
        <section className="mt-12">
          <h2 className="read text-[20px]">Material</h2>
          <p className="mt-2 text-[14px] text-mute">
            {hasMaterial
              ? `${overview.chapters} chapter${overview.chapters === 1 ? "" : "s"}, ${Math.round(
                  Number(overview.material_chars) / 1000,
                ).toLocaleString()}k characters. Every question is written from these.`
              : "Nothing loaded yet."}
          </p>
        </section>
      </main>
    </>
  );
}
