import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TopBar } from "@/components/chrome";
import { PracticeTest } from "./test";

export default async function TestPage(props: PageProps<"/kits/[id]/test">) {
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
          <Link href={`/kits/${id}`} className="flex min-h-[44px] shrink-0 items-center px-1 text-[13px] text-mute hover:text-ink">
            Leave
          </Link>
        }
      />
      <PracticeTest kitId={id} />
    </>
  );
}
