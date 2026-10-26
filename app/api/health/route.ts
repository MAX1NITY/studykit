import { getSession } from "@/lib/auth";
import { getProvider, pingGeminiModel } from "@/lib/ai/provider";

export const maxDuration = 120;

/** Models worth trying when the configured one is busy. */
const CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];

/**
 * Reports whether the environment is wired up, and — with ?ping=1 — which
 * Gemini models this key can actually reach.
 *
 * The basic check is public so it still answers when the app is misconfigured
 * and nobody can sign in. The ping spends real (tiny) API calls, so it needs a
 * session: an unauthenticated endpoint that burns the key's quota is an
 * invitation.
 */
export async function GET(request: Request) {
  const session = await getSession();

  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const usingClaude = provider === "anthropic" || provider === "claude";
  const keyName = usingClaude ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";

  let chain: string[] = [];
  try {
    chain = [getProvider().model];
  } catch {
    // No key configured; the report below says so.
  }

  const report: Record<string, unknown> = {
    supabase: {
      url_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      key_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      signed_in: Boolean(session),
    },
    ai: {
      provider,
      model: chain[0] ?? null,
      key_set: Boolean(process.env[keyName]),
      key_name: keyName,
    },
  };

  if (new URL(request.url).searchParams.get("ping") === "1") {
    if (!session) {
      report.ping = { ran: false, reason: "Sign in first — the ping uses the key." };
      return Response.json(report);
    }
    if (usingClaude) {
      report.ping = { ran: false, reason: "Model probing is Gemini-only." };
      return Response.json(report);
    }

    const models: Record<string, unknown> = {};
    for (const model of CANDIDATES) {
      models[model] = await pingGeminiModel(model);
    }

    const working = Object.entries(models)
      .filter(([, r]) => (r as { ok: boolean }).ok)
      .map(([name]) => name);

    report.ping = { ran: true, working, models };
  }

  return Response.json(report);
}
