import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar, Notice } from "@/components/chrome";
import { getOrCreatePrep, nextStudyQuestion } from "@/lib/exam/prep";
import { present } from "@/lib/exam/select";
import { EXAM, domain as findDomain } from "@/lib/exam/core1";
import { Stream } from "./stream";

export const metadata = { title: "Study questions · Core 1" };

export default async function StudyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase, user } = session;

  const prep = await getOrCreatePrep(supabase, user.id);

  const [{ question }, { data: statRows }] = await Promise.all([
    nextStudyQuestion(supabase, prep.id),
    supabase.from("exam_answer_stats").select("answered, accuracy").eq("prep_id", prep.id),
  ]);

  // Summed here rather than read from a view: the per-domain rows are already
  // being fetched for the strip, and one query beats two.
  const stats = (statRows ?? []) as { answered: number; accuracy: number | null }[];
  const answered = stats.reduce((n, r) => n + r.answered, 0);
  const marks = stats.reduce((n, r) => n + (r.accuracy ?? 0) * r.answered, 0);

  return (
    <>
      <TopBar
        breadcrumb={
          <Link href="/prep" className="hover:text-ink">
            {EXAM.name}
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        {question ? (
          <Stream
            first={present(question)}
            firstDomainName={findDomain(question.domain)?.name ?? question.domain}
            startingAnswered={answered}
            startingAccuracy={answered ? Math.round(marks / answered) : null}
          />
        ) : (
          <div className="mt-6">
            <Notice
              title="No questions written yet."
              hint="Questions come from your own Core 1 chapters. Write a batch and this stream starts."
              tone="brass"
            />
            <Link
              href="/prep"
              className="mt-6 inline-block rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
            >
              Back to Core 1
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
