/**
 * AI provider abstraction.
 *
 * Everything in the app talks to `getProvider()`, never to a vendor directly,
 * so swapping Gemini for Claude, Groq or a local model means adding one class
 * here and changing the AI_PROVIDER env var. Nothing else moves.
 */

export class AIError extends Error {
  readonly status: number;
  readonly hint?: string;
  /** True when another model might succeed where this one did not. */
  readonly retryable: boolean;

  constructor(message: string, status = 500, hint?: string, retryable = false) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.hint = hint;
    this.retryable = retryable;
  }
}

/** A JSON Schema subset the providers accept for structured output. */
export type JSONSchema = Record<string, unknown>;

export interface GenerateOptions {
  /** The task for this call. */
  prompt: string;
  /** Give up after this long and report it, rather than hanging. */
  timeoutMs?: number;
  /** Persistent role/behaviour instruction. */
  system?: string;
  /** Upper bound on response length. */
  maxOutputTokens?: number;
  /** How much the model should deliberate before answering. */
  effort?: "minimal" | "low" | "medium" | "high";
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** Returns a value matching `schema`, already parsed. */
  generateJSON<T>(schema: JSONSchema, options: GenerateOptions): Promise<T>;
  /** Returns free-form text. */
  generateText(options: GenerateOptions): Promise<string>;
}

// --------------------------------------------------------------- utilities

/**
 * Parses model output that should be JSON. Models occasionally wrap JSON in
 * markdown fences or add a sentence around it, so fall back to extracting the
 * outermost JSON value before giving up.
 */
function parseJSON<T>(raw: string): T {
  const text = raw.trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // fall through
  }

  const firstBrace = unfenced.search(/[[{]/);
  const lastBrace = Math.max(
    unfenced.lastIndexOf("}"),
    unfenced.lastIndexOf("]"),
  );
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      // fall through
    }
  }

  throw new AIError(
    "The AI returned something that was not valid JSON.",
    502,
    "This is usually a truncated response. Try again, or use shorter source material.",
  );
}

// ------------------------------------------------------------------ Gemini

const GEMINI_DEFAULT_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/**
 * Overridable so the provider can be pointed at a stand-in during testing,
 * or at a regional or proxied endpoint. Unset in normal use.
 */
const GEMINI_ENDPOINT =
  process.env.GEMINI_BASE_URL?.trim() || GEMINI_DEFAULT_ENDPOINT;

/** One text block inside a step's content array. */
interface InteractionContent {
  type?: string;
  text?: string;
}

interface InteractionStep {
  type?: string;
  content?: InteractionContent[];
}

interface InteractionResponse {
  status?: string;
  steps?: InteractionStep[];
  usage?: { total_tokens?: number; total_output_tokens?: number };
  error?: { message?: string };
}

/**
 * Google Gemini, via the Interactions API.
 * Free tier: https://aistudio.google.com/apikey (no credit card).
 */
class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly model: string;
  /** Tried in order when the one before is unavailable. */
  private readonly models: string[];
  private readonly apiKey: string;

  constructor(apiKey: string, models: string[]) {
    this.apiKey = apiKey;
    this.models = models;
    this.model = models[0];
  }

  /**
   * Runs the call against each model in turn.
   *
   * Free-tier capacity is not guaranteed: a model can answer in a second one
   * minute and reply "experiencing high demand" the next. Rather than failing,
   * move to the next model and tell the logs which one served the request.
   */
  private async call(
    options: GenerateOptions,
    responseFormat?: Record<string, unknown>,
  ): Promise<string> {
    let lastError: AIError | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, options, responseFormat);
      } catch (cause) {
        if (!(cause instanceof AIError) || !cause.retryable) throw cause;
        console.log(`[ai] ${model} unavailable (${cause.message}); trying the next model`);
        lastError = cause;
      }
    }

    throw (
      lastError ??
      new AIError("No Gemini model was available.", 503)
    );
  }

  private async callModel(
    model: string,
    options: GenerateOptions,
    responseFormat?: Record<string, unknown>,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      input: options.prompt,
      store: false,
      generation_config: {
        // Thinking tokens come out of this budget too, so a tight limit can
        // consume the lot and return nothing.
        max_output_tokens: options.maxOutputTokens ?? 4096,
        thinking_level: options.effort ?? "low",
      },
    };

    if (options.system) body.system_instruction = options.system;
    if (responseFormat) body.response_format = responseFormat;

    const timeoutMs = options.timeoutMs ?? 90_000;
    const abort = AbortSignal.timeout(timeoutMs);
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: abort,
      });
    } catch (cause) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new AIError(
          `${model} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
          504,
          "Usually means the model is busy, or too much material in one go.",
          true,
        );
      }
      throw new AIError(
        `Could not reach the Gemini API (after ${elapsed}s).`,
        503,
        cause instanceof Error ? cause.message : undefined,
      );
    }

    console.log(
      `[ai] ${model} responded ${res.status} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );

    const payload = (await res.json().catch(() => null)) as
      | InteractionResponse
      | null;

    if (!res.ok) {
      const detail = payload?.error?.message ?? `HTTP ${res.status}`;

      if (res.status === 429) {
        throw new AIError(
          "Gemini's free-tier rate limit was hit.",
          429,
          "Wait a minute and try again, or set GEMINI_MODEL=gemini-3.5-flash-lite for a higher quota.",
          true,
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new AIError(
          "Gemini rejected the API key.",
          401,
          "Check GEMINI_API_KEY. Get a free one at https://aistudio.google.com/apikey",
        );
      }
      if (res.status === 404) {
        throw new AIError(
          `Gemini has no model named "${model}".`,
          400,
          "Set GEMINI_MODEL to a current model, for example gemini-3.5-flash-lite.",
          true,
        );
      }

      // Capacity problems read as prose rather than a distinct status code,
      // so match on the message as well as 500/503.
      const overloaded =
        res.status === 503 ||
        res.status === 500 ||
        /high demand|overloaded|try again later|unavailable/i.test(detail);

      throw new AIError(
        `Gemini request failed: ${detail}`,
        overloaded ? 503 : 502,
        overloaded
          ? "The model is busy on the free tier. Another was tried."
          : undefined,
        overloaded,
      );
    }

    const text = (payload?.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("")
      .trim();

    if (!text) {
      // A thinking model spends part of its output budget before writing any
      // text, so too small a maxOutputTokens yields a valid response with
      // nothing in it. Report what came back rather than just "empty".
      const steps = (payload?.steps ?? []).map((s) => s.type ?? "?").join(", ");
      const usage = payload?.usage;
      throw new AIError(
        `${model} returned no text (steps: ${steps || "none"}).`,
        502,
        usage
          ? `Used ${usage.total_output_tokens ?? "?"} of ${options.maxOutputTokens ?? 4096} output tokens. If that is at the limit, the budget was spent on thinking — raise maxOutputTokens.`
          : "Raise maxOutputTokens, or the material may have hit a safety filter.",
        true,
      );
    }

    return text;
  }

  async generateJSON<T>(
    schema: JSONSchema,
    options: GenerateOptions,
  ): Promise<T> {
    const text = await this.call(options, {
      type: "text",
      mime_type: "application/json",
      schema,
    });
    return parseJSON<T>(text);
  }

  async generateText(options: GenerateOptions): Promise<string> {
    return this.call(options);
  }
}

// ------------------------------------------------------------------ Claude
// Not wired up by default: the Claude API is billed per token and is separate
// from a Claude.ai subscription. Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY
// to use it instead.

class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async call(options: GenerateOptions, jsonSchema?: JSONSchema) {
    const system = jsonSchema
      ? `${options.system ?? ""}\n\nReply with JSON only, matching this schema:\n${JSON.stringify(jsonSchema)}`.trim()
      : options.system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxOutputTokens ?? 4096,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: options.prompt }],
      }),
    });

    const payload = (await res.json().catch(() => null)) as {
      content?: { type?: string; text?: string }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      throw new AIError(
        `Claude request failed: ${payload?.error?.message ?? res.status}`,
        res.status === 429 ? 429 : 502,
      );
    }

    const text = (payload?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!text) throw new AIError("Claude returned an empty response.", 502);
    return text;
  }

  async generateJSON<T>(schema: JSONSchema, options: GenerateOptions) {
    return parseJSON<T>(await this.call(options, schema));
  }

  async generateText(options: GenerateOptions) {
    return this.call(options);
  }
}

/**
 * Sends a trivial prompt to one named Gemini model.
 *
 * Used by the health check to find out which models a key can actually reach,
 * since free-tier availability differs per model and changes through the day.
 */
export async function pingGeminiModel(
  model: string,
): Promise<{ ok: boolean; seconds: number; reply?: string; error?: string }> {
  const key = process.env.GEMINI_API_KEY;
  const startedAt = Date.now();
  const seconds = () => Math.round((Date.now() - startedAt) / 100) / 10;

  if (!key) return { ok: false, seconds: 0, error: "GEMINI_API_KEY is not set." };

  try {
    const reply = await new GeminiProvider(key, [model]).generateText({
      prompt: "Reply with exactly: OK",
      // Generous on purpose: thinking is billed against this budget, and a
      // tight limit makes a working model look broken.
      maxOutputTokens: 512,
      effort: "low",
      timeoutMs: 20_000,
    });
    return { ok: true, seconds: seconds(), reply: reply.slice(0, 20) };
  } catch (cause) {
    return {
      ok: false,
      seconds: seconds(),
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

// ----------------------------------------------------------------- factory

let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const which = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();

  if (which === "anthropic" || which === "claude") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new AIError(
        "ANTHROPIC_API_KEY is not set.",
        500,
        "Add it in your Vercel project settings, or set AI_PROVIDER=gemini.",
      );
    }
    cached = new AnthropicProvider(
      key,
      process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    );
    return cached;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new AIError(
      "GEMINI_API_KEY is not set.",
      500,
      "Get a free key at https://aistudio.google.com/apikey, then add it in Vercel -> Settings -> Environment Variables.",
    );
  }

  // Free-tier capacity varies by model and by hour, so keep a chain rather
  // than a single name. Lite models are built for throughput and tend to be
  // the ones still answering when the larger Flash models are saturated.
  const chain = (
    process.env.GEMINI_MODEL
      ? [process.env.GEMINI_MODEL]
      : ["gemini-3.5-flash-lite"]
  ).concat(
    (process.env.GEMINI_FALLBACK_MODELS ??
      "gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.1-flash-lite")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  );

  cached = new GeminiProvider(key, [...new Set(chain)]);
  return cached;
}
