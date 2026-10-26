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

  constructor(message: string, status = 500, hint?: string) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.hint = hint;
  }
}

/** A JSON Schema subset the providers accept for structured output. */
export type JSONSchema = Record<string, unknown>;

export interface GenerateOptions {
  /** The task for this call. */
  prompt: string;
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
  error?: { message?: string };
}

/**
 * Google Gemini, via the Interactions API.
 * Free tier: https://aistudio.google.com/apikey (no credit card).
 */
class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async call(
    options: GenerateOptions,
    responseFormat?: Record<string, unknown>,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: options.prompt,
      store: false,
      generation_config: {
        max_output_tokens: options.maxOutputTokens ?? 4096,
        thinking_level: options.effort ?? "low",
      },
    };

    if (options.system) body.system_instruction = options.system;
    if (responseFormat) body.response_format = responseFormat;

    let res: Response;
    try {
      res = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new AIError(
        "Could not reach the Gemini API.",
        503,
        cause instanceof Error ? cause.message : undefined,
      );
    }

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
          `Gemini has no model named "${this.model}".`,
          400,
          "Set GEMINI_MODEL to a current model, for example gemini-3.8-flash.",
        );
      }
      throw new AIError(`Gemini request failed: ${detail}`, 502);
    }

    const text = (payload?.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("")
      .trim();

    if (!text) {
      throw new AIError(
        "Gemini returned an empty response.",
        502,
        "The material may have been blocked by a safety filter, or the response hit the token limit.",
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

  cached = new GeminiProvider(
    key,
    process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  );
  return cached;
}
