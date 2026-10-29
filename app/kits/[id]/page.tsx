import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import { DeleteKit } from "./danger";
import { GenerateCards } from "./cards-action";
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

  const [{ data: kit }, { data: stats }, { data: sources }] = await Promise.all([
    supabase.from("kit_overview").select("*").eq("id", id).maybeSingle(),
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

  const studied = since(kit.last_attempt_at as string | null);
  const weak = (stats ?? []).filter((s) => (s.avg_score ?? 100) < 70);
  const strong = (stats ?? []).filter((s) => (s.avg_score ?? 0) >= 70);

  const modes = [
    {
      href: `/kits/${id}/study`,
      name: "Smart Study",
      blurb:
        "Typed answers, marked and explained. Gets harder as you get better.",
      status:
        kit.answered_count > 0
          ? `${kit.avg_score ?? 0}% over ${kit.answered_count} question${kit.answered_count === 1 ? "" : "s"}`
          : "Not started",
      tone:
        kit.answered_count > 0
          ? (kit.avg_score ?? 0) >= 70
            ? "text-sure"
            : "text-brass"
          : "text-mute",
    },
    {
      href: `/kits/${id}/cards`,
      name: "Flashcards",
      blurb: "Spaced repetition. Cards you miss come back sooner.",
      status:
        kit.card_count === 0
          ? "None yet"
          : kit.due_count > 0
            ? `${kit.due_count} due now`
            : `${kit.card_count} card${kit.card_count === 1 ? "" : "s"}, none due`,
      tone:
        kit.card_count === 0
          ? "text-brass"
          : kit.due_count > 0
            ? "text-brass"
            : "text-mute",
    },
    {
      href: `/kits/${id}/test`,
      name: "Practice test",
      blurb: "Multiple choice, marked at the end like a real paper.",
      status:
        kit.last_test_score !== null && kit.last_test_total
          ? `Last: ${kit.last_test_score}/${kit.last_test_total}`
          : "No attempts yet",
      tone:
        kit.last_test_score !== null && kit.last_test_total
          ? kit.last_test_score / kit.last_test_total >= 0.7
            ? "text-sure"
            : "text-brass"
          : "text-mute",
    },
    {
      href: `/kits/${id}/guide`,
      name: "Revision guide",
      blurb: "The material condensed, with the easily-confused pairs called out.",
      status: kit.guide_count > 0 ? "Ready to read" : "Write it",
      tone: kit.guide_count > 0 ? "text-mute" : "text-brass",
    },
  ];

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

        <ul className="mt-9 border-t border-rule">
          {modes.map((mode) => (
            <li key={mode.href} className="border-b border-rule">
              <Link
                href={mode.href}
                className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5"
              >
                <div className="min-w-0 max-w-[46ch]">
                  <h2 className="text-[16px] font-medium group-hover:underline group-hover:underline-offset-4">
                    {mode.name}
                  </h2>
                  <p className="mt-0.5 text-[13.5px] leading-relaxed text-mute">
                    {mode.blurb}
                  </p>
                </div>
                <span className={`shrink-0 text-[14px] ${mode.tone}`}>
                  {mode.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>

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
