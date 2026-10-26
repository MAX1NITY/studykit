import { AIError } from "@/lib/ai/provider";

/** Shape every route handler returns on failure. */
export interface ApiError {
  error: string;
  hint?: string;
}

export function fail(message: string, status = 400, hint?: string) {
  return Response.json({ error: message, hint } satisfies ApiError, { status });
}

/** Turns a thrown error into a response the UI can display usefully. */
export function failFrom(cause: unknown) {
  if (cause instanceof AIError) {
    return fail(cause.message, cause.status, cause.hint);
  }
  console.error(cause);
  return fail(
    cause instanceof Error ? cause.message : "Something went wrong.",
    500,
  );
}

export const unauthorized = () => fail("You are not signed in.", 401);
