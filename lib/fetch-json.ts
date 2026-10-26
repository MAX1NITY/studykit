"use client";

/**
 * Calls one of our API routes and returns either the parsed body or an error
 * the UI can show.
 *
 * The reason this exists: a Vercel function that times out or crashes replies
 * with an HTML error page, not JSON. Calling res.json() on that throws, and if
 * you catch it alongside a genuine network failure you end up telling someone
 * to check their connection when the real problem was on the server. Here the
 * two are kept apart and the status code is reported.
 */

export interface ApiFailure {
  title: string;
  hint?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiFailure };

export async function postJSON<T>(
  url: string,
  body: unknown,
  method: "POST" | "PUT" = "POST",
): Promise<ApiResult<T>> {
  let res: Response;

  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: {
        title: "Could not reach StudyKit.",
        hint: "That one is usually the connection. Check it and try again.",
      },
    };
  }

  const text = await res.text().catch(() => "");

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the function itself failed before our code could reply.
    if (res.status === 504) {
      return {
        ok: false,
        error: {
          title: "The AI took too long and the request was cut off.",
          hint: "Try again with fewer cards, or split long material into two kits.",
        },
      };
    }
    return {
      ok: false,
      error: {
        title: `The server failed with a ${res.status} error.`,
        hint: "Nothing was lost. Try again, and if it keeps happening the Vercel logs will say why.",
      },
    };
  }

  const data = payload as T & { error?: string; hint?: string };

  if (!res.ok) {
    return {
      ok: false,
      error: {
        title: data?.error ?? `The server replied with ${res.status}.`,
        hint: data?.hint,
      },
    };
  }

  return { ok: true, data };
}
