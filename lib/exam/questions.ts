import "server-only";
import { getProvider, type JSONSchema } from "@/lib/ai/provider";
import { selectMaterial, type SourceLike } from "@/lib/ai/material";
import { COMPTIA_STYLE, KIND_RULES } from "./style";
import { materialSlice, QUESTION_BUDGET } from "./select";
import { DOMAINS, OBJECTIVE_IDS, domain } from "./core1";

export type QuestionKind = "single" | "multiple" | "ordering" | "matching";

export interface ExamQuestion {
  kind: QuestionKind;
  domain: string;
  objective: string;
  stem: string;
  /** single and multiple: the options, in the order they are shown. */
  options?: string[];
  /** single and multiple: which options are correct. */
  answer_indexes?: number[];
  /** ordering: the steps, stored in their correct order. */
  steps?: string[];
  /** matching: the correct pairing. */
  pairs?: { left: string; right: string }[];
  explanation: string;
  difficulty: number;
}


const base = {
  objective: { type: "string" },
  stem: { type: "string" },
  explanation: { type: "string" },
  difficulty: { type: "integer", minimum: 1, maximum: 5 },
} as const;

function schemaFor(kind: QuestionKind): JSONSchema {
  const shapes: Record<QuestionKind, Record<string, unknown>> = {
    single: {
      ...base,
      options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
      answer_indexes: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 3 },
        minItems: 1,
        maxItems: 1,
      },
    },
    multiple: {
      ...base,
      options: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
      answer_indexes: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 4 },
        minItems: 2,
        maxItems: 3,
      },
    },
    ordering: {
      ...base,
      steps: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 6 },
    },
    matching: {
      ...base,
      pairs: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          properties: { left: { type: "string" }, right: { type: "string" } },
          required: ["left", "right"],
        },
      },
    },
  };

  const shape = shapes[kind];

  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: shape,
          required: Object.keys(shape),
        },
      },
    },
    required: ["questions"],
  };
}

/**
 * Rejects anything that would make a bad practice question.
 *
 * The model is asked for a shape; this checks it actually got one. A
 * question with two identical options, or an objective id that does not
 * exist, is worse than one question fewer — it would be sat, puzzled over
 * and counted.
 */
export function usable(q: ExamQuestion): string | null {
  if (!q.stem || q.stem.trim().length < 40) return "stem too short to be a scenario";
  if (!q.explanation || q.explanation.trim().length < 20) return "no explanation";
  if (!OBJECTIVE_IDS.has(q.objective)) return `unknown objective ${q.objective}`;

  // Asking about the material rather than the subject.
  if (/\b(the (text|passage|material|document|article|chapter|notes?))\b/i.test(q.stem)) {
    return "refers to the material instead of the subject";
  }

  if (q.kind === "single" || q.kind === "multiple") {
    const options = q.options ?? [];
    const answers = q.answer_indexes ?? [];
    if (options.length < 4) return "too few options";
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
      return "duplicate options";
    }
    if (answers.length === 0) return "no correct option";
    if (answers.some((i) => i < 0 || i >= options.length)) return "answer out of range";
    if (new Set(answers).size !== answers.length) return "repeated answer index";
    if (q.kind === "single" && answers.length !== 1) return "single must have one answer";
    if (q.kind === "multiple" && answers.length < 2) return "multiple needs two or more";
    if (options.some((o) => /\b(all|none) of the above\b/i.test(o))) {
      return "uses all/none of the above";
    }
    // A distractor that negates rather than names something real.
    if (options.some((o) => /^(other|non-|no |not )/i.test(o.trim()))) {
      return "vague negative distractor";
    }
  }

  if (q.kind === "ordering") {
    const steps = q.steps ?? [];
    if (steps.length < 3) return "too few steps";
    if (new Set(steps.map((s) => s.trim().toLowerCase())).size !== steps.length) {
      return "duplicate steps";
    }
  }

  if (q.kind === "matching") {
    const pairs = q.pairs ?? [];
    if (pairs.length < 3) return "too few pairs";
    if (new Set(pairs.map((p) => p.left.trim().toLowerCase())).size !== pairs.length) {
      return "duplicate left-hand items";
    }
    if (pairs.some((p) => !p.left?.trim() || !p.right?.trim())) return "empty pair";
  }

  return null;
}

export interface GenerateOptions {
  sources: SourceLike[];
  domainId: string;
  kind: QuestionKind;
  count: number;
  /** Moves the window over long material so questions do not all cluster. */
  rotation?: number;
  /** Stems already in the pool, so a refill does not repeat itself. */
  recentStems?: string[];
}

/**
 * Writes questions for one domain, in one of the four shapes.
 *
 * Returns only the ones that pass `usable`, so a caller asking for five may
 * get four. That is deliberate: the pool is topped up in the background and
 * can simply ask again, whereas a malformed question in a timed mock costs
 * the student a mark and their concentration.
 */
export async function generateQuestions(
  opts: GenerateOptions,
): Promise<{ questions: ExamQuestion[]; rejected: string[] }> {
  const d = domain(opts.domainId);
  if (!d) throw new Error(`Unknown domain ${opts.domainId}`);

  const material = selectMaterial(
    opts.sources,
    QUESTION_BUDGET,
    materialSlice(opts.sources, opts.rotation ?? 0) * QUESTION_BUDGET,
  );

  const objectives = d.objectives
    .map((o) => `  ${o.id} — ${o.title}`)
    .join("\n");

  const avoid = opts.recentStems?.length
    ? `\nDo not repeat or lightly reword any of these, which are already in the pool:\n${opts.recentStems
        .slice(0, 12)
        .map((s) => `- ${s.slice(0, 120)}`)
        .join("\n")}\n`
    : "";

  const result = await getProvider().generateJSON<{ questions: ExamQuestion[] }>(
    schemaFor(opts.kind),
    {
      system: COMPTIA_STYLE,
      effort: "medium",
      maxOutputTokens: 8_000,
      timeoutMs: 120_000,
      prompt: `Write ${opts.count} practice questions for domain ${d.id} ${d.name}
of CompTIA A+ Core 1 (220-1201).

${KIND_RULES[opts.kind]}

Tag each question with the objective it tests, using one of these ids
exactly:
${objectives}

Base every question on the study material below. Use only facts the material
supports — this is the student's own course content and the questions must
examine that, not something adjacent to it. Do not mention the material
itself; the student is being examined on the subject.
${avoid}
Set difficulty 1 to 5: 1 is a straightforward application, 5 requires
weighing two defensible options against a constraint in the stem.

In the explanation, say why the correct answer fits the scenario AND why the
most tempting wrong option does not. That second half is what makes the
question worth having got wrong.

MATERIAL
--------
${material}`,
    },
  );

  const questions: ExamQuestion[] = [];
  const rejected: string[] = [];

  for (const raw of result.questions ?? []) {
    const q: ExamQuestion = {
      ...raw,
      kind: opts.kind,
      domain: d.id,
      difficulty: Math.min(5, Math.max(1, Math.round(raw.difficulty ?? 3))),
    };
    const problem = usable(q);
    if (problem) rejected.push(`${problem}: ${q.stem?.slice(0, 60) ?? "(no stem)"}`);
    else questions.push(q);
  }

  return { questions, rejected };
}

/**
 * Classifies a chapter of material into the domain it belongs to.
 *
 * Done once per chapter, against the fixed official list, rather than per
 * question: a fixed taxonomy imposed on the material is reliable, whereas
 * labels invented per call are not — the same content comes back named
 * differently each time, and nothing can be grouped by it afterwards.
 */
export async function classifyMaterial(
  name: string,
  content: string,
): Promise<{ domain: string; objectives: string[] }> {
  const list = DOMAINS.map(
    (d) =>
      `${d.id} ${d.name} (${d.weight}%)\n${d.objectives.map((o) => `    ${o.id} — ${o.title}`).join("\n")}`,
  ).join("\n\n");

  const result = await getProvider().generateJSON<{
    domain: string;
    objectives: string[];
  }>(
    {
      type: "object",
      properties: {
        domain: { type: "string" },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["domain", "objectives"],
    },
    {
      effort: "low",
      maxOutputTokens: 1_000,
      timeoutMs: 60_000,
      prompt: `Which CompTIA A+ Core 1 (220-1201) domain does this study material
belong to? Answer with the single domain it mostly covers, plus every
objective id it touches.

${list}

Material is titled "${name}". Here is the start of it:

${content.slice(0, 6_000)}`,
    },
  );

  const chosen = DOMAINS.find((d) => d.id === result.domain)?.id ?? null;

  return {
    // An unrecognised answer is treated as unclassified rather than forced
    // into a domain: material in the wrong domain would skew every mock.
    domain: chosen ?? "",
    objectives: (result.objectives ?? []).filter((o) => OBJECTIVE_IDS.has(o)),
  };
}
