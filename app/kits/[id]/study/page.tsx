import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { takeFromPool } from "@/lib/study-queue";
import { TopBar } from "@/components/chrome";
import { SmartStudy } from "./session";

export default async function StudyPage(props: PageProps<"/kits/[id]/study">) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  /*
   * Take the first question here rather than letting the browser ask for one
   * after hydration. That round trip could not even begin until the page's
   * JavaScript had downloaded and run, so opening Smart Study always meant
   * watching "Writing a question…" for data that was a single read away.
   *
   * Multiple choice is the default and by far the common case; a stored
   * preference for another format is picked up on the client.
   */
  const [{ data: kit }, first] = await Promise.all([
    session.supabase.from("kits").select("title").eq("id", id).maybeSingle(),
    takeFromPool(session.supabase, { kitId: id, format: "choice" }).catch(
      () => null,
    ),
  ]);

  if (!kit) notFound();

  return (
    <>
      <TopBar
        breadcrumb={
          <Link href={`/kits/${id}`} className="hover:text-ink">
            {kit.title}
          </Link>
        }
        action={
          <Link href={`/kits/${id}`} className="flex min-h-[44px] shrink-0 items-center px-1 text-[13px] text-mute hover:text-ink">
            End session
          </Link>
        }
      />
      <SmartStudy kitId={id} initialQuestion={first} />
    </>
  );
}
