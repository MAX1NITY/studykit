import { getProvider, type JSONSchema } from "./provider";

/** One piece of uploaded material. */
export interface SourceLike {
  name: string;
  content: string;
}

/** Ceiling on how much material goes into a single AI call. */
const MATERIAL_BUDGET = 40_000;

/**
 * Joins the sources into one labelled block, capped at `budget` characters.
 *
 * `offset` rotates the window so that repeated calls over a long document
 * reach the later pages instead of asking about page one forever.
 */
export function selectMaterial(
  sources: SourceLike[],
  budget = MATERIAL_BUDGET,
  offset = 0,
): string {
  const joined = sources
    .map((s) => `### ${s.name}\n${s.content.trim()}`)
    .join("\n\n");

  if (joined.length <= budget) return joined;

  const start = offset % joined.length;
  const window = joined.slice(start, start + budget);
  const wrapped =
    window.length < budget ? window + "\n\n" + joined.slice(0, budget - window.length) : window;

  return `(excerpt)\n${wrapped}`;
}

const TUTOR_VOICE = `You are a rigorous, encouraging study coach.
You only ever use the student's own uploaded material as the source of truth.
If the material does not cover something, you say so rather than inventing it.
You never pad answers with filler.`;

// ------------------------------------------------------- kit construction

export interface GeneratedKit {
  title: string;
  subject: string;
  concepts: string[];
  cards: { front: string; back: string; concept: string }[];
}

const kitSchema: JSONSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title for this study kit" },
    subject: {
      type: "string",
      description: "The academic subject, e.g. Biology, CompTIA A+",
    },
    concepts: {
      type: "array",
      description: "The 5-15 distinct topics this material covers",
      items: { type: "string" },
    },
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          front: { type: "string", description: "Question or term" },
          back: { type: "string", description: "The answer, 1-3 sentences" },
          concept: { type: "string", description: "Which concept it belongs to" },
        },
        required: ["front", "back", "concept"],
      },
    },
  },
  required: ["title", "subject", "concepts", "cards"],
};

export async function generateKit(
  sources: SourceLike[],
  cardCount = 24,
): Promise<GeneratedKit> {
  const material = selectMaterial(sources);

  return getProvider().generateJSON<GeneratedKit>(kitSchema, {
    system: TUTOR_VOICE,
    effort: "medium",
    maxOutputTokens: 8192,
    prompt: `Build a study kit from the material below.

Produce about ${cardCount} flashcards. Rules for cards:
- One fact per card. Never bundle two ideas onto one card.
- The front is a real question or a term, not "Card 3".
- The back is the answer only: no restating the question.
- Favour the things an exam would actually test: definitions,
  distinctions between similar ideas, causes and effects, numbers
  that matter, procedure steps.
- Skip anything that is pure formatting, page numbers or headers.

Also list the distinct concepts covered, and give the kit a title.

MATERIAL:
${material}`,
  });
}

// ---------------------------------------------------------- study guide

export async function generateGuide(sources: SourceLike[]): Promise<string> {
  const material = selectMaterial(sources);

  return getProvider().generateText({
    system: TUTOR_VOICE,
    effort: "medium",
    maxOutputTokens: 8192,
    prompt: `Write a revision guide for the material below, in Markdown.

Structure it as:
- A two-sentence overview of what this material is about.
- One "## " section per major concept. Inside each: what it is, why it
  matters, and the detail most likely to be tested. Use short bullets.
- A "## Easily confused" section contrasting pairs of ideas students mix up,
  only if the material contains such pairs.
- A "## Quick recall" section: 8-12 one-line facts worth memorising.

Only use what is in the material. Do not add outside facts. Do not write an
introduction about what you are about to do.

MATERIAL:
${material}`,
  });
}

// --------------------------------------------------------- smart study

export interface SmartQuestion {
  question: string;
  expected: string;
  concept: string;
  difficulty: number;
}

const questionSchema: JSONSchema = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "An open-ended question the student types an answer to",
    },
    expected: {
      type: "string",
      description: "The correct answer, for grading. Not shown up front.",
    },
    concept: { type: "string" },
    difficulty: {
      type: "integer",
      description: "1 (recall) to 5 (synthesis)",
      minimum: 1,
      maximum: 5,
    },
  },
  required: ["question", "expected", "concept", "difficulty"],
};

export async function nextQuestion(opts: {
  sources: SourceLike[];
  targetDifficulty: number;
  weakConcepts: string[];
  recentQuestions: string[];
  rotation: number;
}): Promise<SmartQuestion> {
  const material = selectMaterial(opts.sources, MATERIAL_BUDGET, opts.rotation * 6000);

  const focus = opts.weakConcepts.length
    ? `Prioritise these concepts, which the student has been getting wrong: ${opts.weakConcepts.join(", ")}.`
    : "No weak areas recorded yet, so pick an important concept.";

  const avoid = opts.recentQuestions.length
    ? `Do not repeat or lightly reword any of these recently asked questions:\n${opts.recentQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  return getProvider().generateJSON<SmartQuestion>(questionSchema, {
    system: TUTOR_VOICE,
    effort: "low",
    maxOutputTokens: 1024,
    prompt: `Ask the student ONE question about the material below.

Target difficulty: ${opts.targetDifficulty} out of 5, where 1 is plain recall
and 5 asks them to apply or compare ideas.
${focus}
${avoid}

The question must be answerable from the material alone, in two or three
sentences of typing. Do not ask multiple questions at once. Do not include
the answer in the question.

MATERIAL:
${material}`,
  });
}

export interface Grading {
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  explanation: string;
  missed: string[];
}

const gradingSchema: JSONSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    explanation: {
      type: "string",
      description:
        "Address the student directly. Say what was right, what was wrong, and the correct answer.",
    },
    missed: {
      type: "array",
      description: "Key points the student left out",
      items: { type: "string" },
    },
  },
  required: ["verdict", "score", "explanation", "missed"],
};

export async function gradeAnswer(opts: {
  question: string;
  expected: string;
  answer: string;
}): Promise<Grading> {
  return getProvider().generateJSON<Grading>(gradingSchema, {
    system: TUTOR_VOICE,
    effort: "low",
    maxOutputTokens: 1024,
    prompt: `Grade the student's answer.

QUESTION: ${opts.question}

CORRECT ANSWER: ${opts.expected}

STUDENT'S ANSWER: ${opts.answer}

Mark on understanding, not wording. A right idea in clumsy words is correct.
Be honest: do not call a wrong answer partially right to be kind. If the
student wrote nothing meaningful, that is incorrect with a score of 0.

In the explanation, speak to them as "you", keep it under 80 words, and
always end by stating the correct answer plainly.`,
  });
}

// -------------------------------------------------------- practice test

export interface TestQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  concept: string;
}

const testSchema: JSONSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            description: "Exactly four options",
            items: { type: "string" },
          },
          answer_index: {
            type: "integer",
            description: "0-based index of the correct option",
            minimum: 0,
            maximum: 3,
          },
          explanation: { type: "string" },
          concept: { type: "string" },
        },
        required: ["question", "options", "answer_index", "explanation", "concept"],
      },
    },
  },
  required: ["questions"],
};

export async function generateTest(
  sources: SourceLike[],
  count = 10,
): Promise<TestQuestion[]> {
  const material = selectMaterial(sources);

  const { questions } = await getProvider().generateJSON<{
    questions: TestQuestion[];
  }>(testSchema, {
    system: TUTOR_VOICE,
    effort: "medium",
    maxOutputTokens: 8192,
    prompt: `Write a ${count}-question multiple-choice practice test on the material below.

Rules:
- Exactly four options per question.
- The three wrong options must be plausible to someone who half-learned the
  topic: common confusions, near-miss numbers, the right idea applied to the
  wrong thing. Never use filler like "none of the above".
- Vary which position the correct answer sits in.
- Spread the questions across different concepts; do not ask the same fact twice.
- Explanation: one or two sentences on why the right answer is right.

MATERIAL:
${material}`,
  });

  // Guard against a model that ignores the four-option rule.
  return questions
    .filter((q) => Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      ...q,
      answer_index: Math.min(Math.max(q.answer_index, 0), q.options.length - 1),
    }));
}
