import { getSession } from "@/lib/auth";
import { failFrom, unauthorized } from "@/lib/api";

/**
 * Deletes a kit, and with it the material, cards, attempts and tests that
 * reference it.
 *
 * This lives on the server so the kit page does not have to ship the Supabase
 * browser client — 236KB of JavaScript on one of the two pages opened most
 * often, for a confirm-and-delete button at the bottom of it. The row-level
 * security policy means the delete can only ever reach the caller's own rows.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;

  try {
    const { error } = await session.supabase
      .from("kits")
      .delete()
      .eq("id", id);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ deleted: true });
  } catch (cause) {
    return failFrom(cause);
  }
}
