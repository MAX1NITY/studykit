import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes reachable without a session.
 *
 * /api/health is public on purpose: it is the check you run when the app is
 * misconfigured, which is exactly when you cannot sign in. It reports only
 * whether each variable is present, never a value.
 */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api/health"];

/**
 * Refreshes the Supabase auth token on every request and guards private
 * routes. Runs from proxy.ts (the Next.js 16 replacement for middleware).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Cache headers that stop a CDN caching one user's session.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not add code between createServerClient and getClaims(). getClaims()
  // verifies the JWT signature, unlike getSession(), and dropping it causes
  // users to be logged out at random.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (claims && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/kits";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Must be returned as-is so the refreshed cookies reach the browser.
  return supabaseResponse;
}
