import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import { Markdown } from "@/components/markdown";
import { GuideActions } from "./actions";
import { since } from "@/lib/format";

export default async function GuidePage(props: PageProps<"/kits/[id]/guide">) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ data: kit }, { data: guide }] = await Promise.all([
    session.supabase.from("kits").select("id, title").eq("id", id).maybeSingle(),
    session.supabase
      .from("guides")
      .select("markdown, created_at")
      .eq("kit_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!kit) notFound();

  const written = since(guide?.created_at as string | null);

  return (
    <>
      <TopBar
        breadcrumb={
          <Link href={`/kits/${id}`} className="hover:text-ink">
            {kit.title}
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
          <div>
            <h1 className="read text-[27px] leading-tight">Revision guide</h1>
            <p className="mt-1 text-[13px] text-mute">
              {guide ? `Written ${written}` : "Not generated yet"}
            </p>
          </div>
          <GuideActions kitId={id} hasGuide={Boolean(guide)} />
        </div>

        {guide?.markdown ? (
          <article className="mt-8">
            <Markdown text={guide.markdown as string} />
          </article>
        ) : (
          <div className="mt-10 max-w-[54ch]">
            <p className="text-[15px] leading-relaxed text-mute">
              The guide condenses everything in this kit into sections per
              concept, calls out the pairs of ideas that get mixed up, and ends
              with a list of facts worth memorising. Generating it takes about
              twenty seconds.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
