import { getSession } from "@/lib/auth";
import { AIError, getProvider } from "@/lib/ai/provider";

export const maxDuration = 60;

/**
 * Reports whether the environment is wired up, and — with ?ping=1 — whether
 * the AI key actually works.
 *
 * The basic check is public so it still answers when the app is misconfigured
 * and nobody can sign in. The ping costs a real (tiny) API call, so it needs a
 * session: otherwise anyone could burn the key's quota.
 */
export async function GET(request: Request) {
  const session = await getSession();

  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const usingClaude = provider === "anthropic" || provider === "claude";
  const keyName = usingClaude ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";

  const report: Record<string, unknown> = {
    supabase: {
      url_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      key_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      signed_in: Boolean(session),
    },
    ai: {
      provider,
      model: usingClaude
        ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5")
        : (process.env.GEMINI_MODEL ?? "gemini-3.8-flash"),
      key_set: Boolean(process.env[keyName]),
      key_name: keyName,
    },
  };

  const wantsPing = new URL(request.url).searchParams.get("ping") === "1";

  if (wantsPing) {
    if (!session) {
      report.ping = { ran: false, reason: "Sign in first — the ping uses the key." };
      return Response.json(report);
    }

    // Try each level rather than assuming: a model that rejects one setting
    // is exactly how this check earned its place.
    const levels = ["minimal", "low", "medium", "high"] as const;
    const results: Record<string, unknown> = {};

    for (const effort of levels) {
      const startedAt = Date.now();
      try {
        const reply = await getProvider().generateText({
          prompt: "Reply with exactly: OK",
          maxOutputTokens: 16,
          effort,
          timeoutMs: 30_000,
        });
        results[effort] = {
          ok: true,
          seconds: Math.round((Date.now() - startedAt) / 100) / 10,
          reply: reply.slice(0, 20),
        };
      } catch (cause) {
        results[effort] = {
          ok: false,
          seconds: Math.round((Date.now() - startedAt) / 100) / 10,
          error: cause instanceof Error ? cause.message : String(cause),
          hint: cause instanceof AIError ? cause.hint : undefined,
        };
      }
    }

    report.ping = { ran: true, levels: results };
  }

  return Response.json(report);
}
