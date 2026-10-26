import { getSession } from "@/lib/auth";

/** Quick check that the environment variables are wired up correctly. */
export async function GET() {
  const session = await getSession();

  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const keyName =
    provider === "anthropic" || provider === "claude"
      ? "ANTHROPIC_API_KEY"
      : "GEMINI_API_KEY";

  return Response.json({
    supabase: {
      url_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      key_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      signed_in: Boolean(session),
    },
    ai: {
      provider,
      model:
        provider === "anthropic" || provider === "claude"
          ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5")
          : (process.env.GEMINI_MODEL ?? "gemini-3.8-flash"),
      key_set: Boolean(process.env[keyName]),
      key_name: keyName,
    },
  });
}
