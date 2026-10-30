import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import { DeleteKit } from "./danger";
import { GenerateCards } from "./cards-action";
import { KitProgress } from "./progress";
import { masteryOf, type KitProgress as Progress } from "@/lib/mastery";
import { since } from "@/lib/format";

export default async function KitPage(props: PageProps<"/kits/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  // Set when card writing failed during kit creation, so the kit page can
  // explain what happened rather than just showing an empty deck.
  const failureReason = typeof search?.why === "string" ? search.why : undefined;
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase } = session;

  const [{ data: kit }, { data: progress }, { data: stats }, { data: sources }] =
    await Promise.all([
      supabase.from("kit_overview").select("*").eq("id", id).maybeSingle(),
      supabase.from("kit_progress").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("concept_stats")
        .select("concept, avg_score, attempt_count")
        .eq("kit_id", id)
        .order("avg_score", { ascending: true })
        .limit(20),
      supabase
        .from("sources")
        .select("name, kind, char_count")
        .eq("kit_id", id)
        .order("created_at"),
    ]);

  if (!kit) notFound();

  const mastery = masteryOf(
    {
      cards: progress?.cards ?? 0,
      cardsSeen: progress?.cards_seen ?? 0,
      cardsPassed: progress?.cards_passed ?? 0,
      answered: progress?.answered ?? 0,
      recentScores: (progress?.recent_scores as number[] | null) ?? [],
      hardCorrect: progress?.hard_correct ?? 0,
      tests: progress?.tests ?? 0,
      bestTestPercent: progress?.best_test_percent ?? null,
    } satisfies Progress,
    id,
  );

  const studied = since(kit.last_attempt_at as string | null);
  const weak = (stats ?? []).filter((s) => (s.avg_score ?? 100) < 70);
  const strong = (stats ?? []).filter((s) => (s.avg_score ?? 0) >= 70);

  return (
    <>
      <TopBar
        breadcrumb={
          <Link href="/kits" className="hover:text-ink">
            All kits
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="read text-[30px] leading-tight">{kit.title}</h1>
        <p className="mt-1.5 text-[13px] text-mute">
          {kit.subject ?? "No subject"}
          {studied ? ` · studied ${studied}` : " · not studied yet"}
          {kit.source_count
            ? ` · ${kit.source_count} source${kit.source_count === 1 ? "" : "s"}`
            : ""}
        </p>

        <div className="mt-9">
          <KitProgress
            mastery={mastery}
            guideHref={`/kits/${id}/guide`}
            hasGuide={kit.guide_count > 0}
          />
        </div>

        <section className="mt-10">
          <h2 className="text-[14px] font-medium">
            {kit.card_count === 0
              ? "This kit has no flashcards yet"
              : "More flashcards"}
          </h2>
          <p className="mt-1 max-w-[58ch] text-[13px] text-mute">
            {kit.card_count === 0
              ? "Your material is saved and Smart Study works without cards. Write a deck whenever you want one."
              : "Long material is read a slice at a time, so run this again to write cards for the parts not covered yet."}
          </p>
          <div className="mt-4">
            <GenerateCards
              kitId={id}
              hasCards={kit.card_count > 0}
              initialError={failureReason}
            />
          </div>
        </section>

        {weak.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-[14px] font-medium">
              Where you are losing marks
            </h2>
            <p className="mt-1 text-[13px] text-mute">
              Smart Study is already weighting its questions towards these.
            </p>
            <ul className="mt-4 space-y-2">
              {weak.map((s) => (
                <li
                  key={s.concept}
                  className="flex items-baseline gap-3 border-l-2 border-mark pl-3"
                >
                  <span className="min-w-0 flex-1 text-[14px]">{s.concept}</span>
                  <span className="shrink-0 text-[13px] text-mark">
                    {s.avg_score ?? 0}%
                  </span>
                  <span className="w-16 shrink-0 text-right text-[13px] text-mute">
                    {s.attempt_count} asked
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {strong.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-[14px] font-medium">Solid so far</h2>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {strong.map((s) => (
                <li key={s.concept} className="text-[13.5px] text-mute">
                  {s.concept}{" "}
                  <span className="text-sure">{s.avg_score ?? 0}%</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {sources?.length ? (
          <section className="mt-12 border-t border-rule pt-6">
            <h2 className="text-[14px] font-medium">Material in this kit</h2>
            <ul className="mt-3 space-y-1.5">
              {sources.map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="flex items-baseline justify-between gap-4 text-[13.5px]"
                >
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="shrink-0 text-mute">
                    {Math.round((s.char_count ?? 0) / 1000)}k characters
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12 border-t border-rule pt-6">
          <DeleteKit kitId={id} title={kit.title as string} />
        </section>
      </main>
    </>
  );
}
