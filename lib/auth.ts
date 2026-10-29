import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Session {
  supabase: SupabaseClient;
  user: { id: string; email?: string };
}

/**
 * Resolves the signed-in user from the request's token.
 *
 * Uses getClaims(), which verifies the JWT signature locally against a cached
 * key, rather than getUser(), which posts to Supabase's auth server on every
 * single call. The proxy has already verified the same token the same way, so
 * getUser() was spending a network round trip per page render, per API call
 * and per route prefetch to re-learn something already known. Nothing in the
 * app needs more of the user than the id and the email, both of which are in
 * the claims.
 *
 * Returns null when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  return {
    supabase,
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
    },
  };
}
