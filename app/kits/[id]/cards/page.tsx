import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import { CardReview } from "./review";

export default async function CardsPage(props: PageProps<"/kits/[id]/cards">) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const { data: kit } = await session.supabase
    .from("kits")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

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
          <Link href={`/kits/${id}`} className="text-[13px] text-mute hover:text-ink">
            End session
          </Link>
        }
      />
      <CardReview kitId={id} />
    </>
  );
}
