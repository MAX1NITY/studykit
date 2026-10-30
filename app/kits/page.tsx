import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar, Stat } from "@/components/chrome";
import { masteryOf } from "@/lib/mastery";
import { since } from "@/lib/format";

export const metadata = { title: "Your kits · StudyKit" };

interface KitOverview {
  id: string;
  title: string;
  subject: string | null;
  card_count: number;
  due_count: number;
  answered_count: number;
  avg_score: number | null;
  last_attempt_at: string | null;
}

interface KitProgressRow {
  id: string;
  cards: number;
  cards_seen: number;
  cards_passed: number;
  answered: number;
  recent_scores: number[] | null;
  hard_correct: number;
  tests: number;
  best_test_percent: number | null;
}

export default async function KitsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ data, error }, { data: progressRows }] = await Promise.all([
    session.supabase
      .from("kit_overview")
      .select(
        "id, title, subject, card_count, due_count, answered_count, avg_score, last_attempt_at",
      )
      .order("created_at", { ascending: false }),
    session.supabase.from("kit_progress").select("*"),
  ]);

  const kits = (data ?? []) as KitOverview[];
  const totalDue = kits.reduce((n, k) => n + (k.due_count ?? 0), 0);

  // Smart Study, flashcards and practice tests each earn three stars of their
  // own, so the list carries the total rather than a single ladder.
  const stars = new Map<string, { earned: number; total: number }>();
  for (const row of (progressRows ?? []) as KitProgressRow[]) {
    const { stars: earned, total } = masteryOf(
      {
        cards: row.cards,
        cardsSeen: row.cards_seen,
        cardsPassed: row.cards_passed,
        answered: row.answered,
        recentScores: row.recent_scores ?? [],
        hardCorrect: row.hard_correct,
        tests: row.tests,
        bestTestPercent: row.best_test_percent,
      },
      row.id,
    );
    stars.set(row.id, { earned, total });
  }

  return (
    <>
      <TopBar
        breadcrumb={session.user.email}
        action={
          <form action="/auth/signout" method="post">
            <button className="flex min-h-[44px] shrink-0 items-center px-1 text-[13px] text-mute hover:text-ink">
              Sign out
            </button>
          </form>
        }
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="read text-[28px] leading-tight">Your kits</h1>
            {totalDue > 0 ? (
              <p className="mt-1 text-[14px] text-brass">
                {totalDue} card{totalDue === 1 ? "" : "s"} due for review
              </p>
            ) : (
              <p className="mt-1 text-[14px] text-mute">
                Nothing due right now.
              </p>
            )}
          </div>
          <Link
            href="/kits/new"
            className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
          >
            New kit
          </Link>
        </div>

        {error ? (
          <p className="mt-10 border-l-2 border-mark pl-3 text-sm text-mark">
            {error.message}
          </p>
        ) : null}

        {kits.length === 0 ? (
          <div className="mt-16 max-w-[52ch]">
            <h2 className="read text-[21px]">Start with what you are reading</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-mute">
              Paste a chapter of your notes, or upload a PDF of your course
              material. StudyKit reads it and builds the flashcards, guide and
              questions from that, so everything it asks you comes from your own
              syllabus.
            </p>
            <Link
              href="/kits/new"
              className="mt-6 inline-block rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
            >
              Build your first kit
            </Link>
          </div>
        ) : (
          <ul className="mt-8 border-t border-rule">
            {kits.map((kit) => {
              const studied = since(kit.last_attempt_at);
              return (
                <li key={kit.id} className="border-b border-rule">
                  <Link
                    href={`/kits/${kit.id}`}
                    className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-5"
                  >
                    <div className="min-w-0">
                      <h2 className="read flex flex-wrap items-baseline gap-x-2.5 text-[20px] leading-snug">
                        <span className="group-hover:underline group-hover:underline-offset-4">
                          {kit.title}
                        </span>
                        <span
                          className="shrink-0 text-[13px] text-mute"
                          aria-label={`${stars.get(kit.id)?.earned ?? 0} of ${stars.get(kit.id)?.total ?? 9} stars earned`}
                        >
                          <span aria-hidden className="text-brass">
                            {"\u2605"}
                          </span>{" "}
                          <span aria-hidden>
                            {stars.get(kit.id)?.earned ?? 0}/
                            {stars.get(kit.id)?.total ?? 9}
                          </span>
                        </span>
                      </h2>
                      <p className="mt-0.5 text-[13px] text-mute">
                        {kit.subject ?? "No subject"}
                        {studied ? ` · studied ${studied}` : " · not studied yet"}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-baseline gap-5">
                      {kit.due_count > 0 ? (
                        <Stat value={kit.due_count} label="due" tone="brass" />
                      ) : (
                        <Stat value={kit.card_count} label="cards" />
                      )}
                      {kit.answered_count > 0 ? (
                        <Stat
                          value={`${kit.avg_score ?? 0}%`}
                          label={`over ${kit.answered_count}`}
                          tone={
                            (kit.avg_score ?? 0) >= 70
                              ? "sure"
                              : (kit.avg_score ?? 0) >= 50
                                ? "brass"
                                : "mark"
                          }
                        />
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
