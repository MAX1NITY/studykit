import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface Session {
  supabase: SupabaseClient;
  user: User;
}

/**
 * Resolves the signed-in user, verifying the token with Supabase rather than
 * trusting the cookie. Returns null when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}
