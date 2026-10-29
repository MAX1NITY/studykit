import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { readDueCards } from "@/lib/cards";
import { TopBar } from "@/components/chrome";
import { CardReview } from "./review";

export default async function CardsPage(props: PageProps<"/kits/[id]/cards">) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  // Read the title and the due cards together. The queue used to be fetched
  // from the browser after hydration, which meant a spinner on every visit
  // for data the server already had in hand.
  const [{ data: kit }, due] = await Promise.all([
    session.supabase.from("kits").select("title").eq("id", id).maybeSingle(),
    readDueCards(session.supabase, id),
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
      <CardReview
        kitId={id}
        initialQueue={due.ready}
        initialRelearn={due.relearning}
        initialMore={due.more}
      />
    </>
  );
}
