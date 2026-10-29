import { getProvider, type JSONSchema } from "./provider";
import { BUDGETS, partCount, selectMaterial, type SourceLike } from "./material";

// Slicing long uploads lives in ./material so it can be tested on its own.
export { BUDGETS, partCount, selectMaterial, type SourceLike };

const TUTOR_VOICE = `You are a rigorous, encouraging study coach.
You only ever use the student's own uploaded material as the source of truth.
If the material does not cover something, you say so rather than inventing it.
You never pad answers with filler.`;

// ------------------------------------------------------- kit construction

export interface GeneratedCards {
  title: string;
  subject: string;
  concepts: string[];
  cards: { front: string; back: string; concept: string }[];
}

const cardsSchema: JSONSchema = {
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

/**
 * Reads the material and writes the flashcards.
 *
 * Runs at low thinking effort deliberately: writing recall cards is extraction
 * rather than reasoning, and the extra deliberation mostly bought latency.
 */
export async function generateCards(
  sources: SourceLike[],
  cardCount = 16,
  part = 0,
): Promise<GeneratedCards> {
  // Each run reads the next slice, so a long document is covered over
  // several runs rather than the first fifth of it over and over.
  const material = selectMaterial(
    sources,
    BUDGETS.cards,
    part * BUDGETS.cards,
  );

  return getProvider().generateJSON<GeneratedCards>(cardsSchema, {
    system: TUTOR_VOICE,
    effort: "low",
    maxOutputTokens: 8192,
    timeoutMs: 120_000,
    prompt: `Read the material below and write ${cardCount} flashcards from it.

Rules for cards:
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

/** Writes the guide for one slice of the material. */
async function generateGuidePart(
  sources: SourceLike[],
  part: number,
): Promise<string> {
  const material = selectMaterial(
    sources,
    BUDGETS.guide,
    part * BUDGETS.guide,
  );

  return getProvider().generateText({
    system: TUTOR_VOICE,
    effort: "low",
    maxOutputTokens: 8192,
    timeoutMs: 150_000,
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

/**
 * Writes a guide covering the whole kit.
 *
 * Long material is divided into slices and written in parallel, because a
 * guide that only summarises the first quarter of what you uploaded is worse
 * than useless: it looks complete.
 */
export async function generateGuide(sources: SourceLike[]): Promise<string> {
  const parts = Math.min(partCount(sources, BUDGETS.guide), 6);

  if (parts === 1) return generateGuidePart(sources, 0);

  const written = await Promise.all(
    Array.from({ length: parts }, (_, i) => generateGuidePart(sources, i)),
  );

  return written
    .map((section, i) => `# Part ${i + 1} of ${parts}\n\n${section.trim()}`)
    .join("\n\n");
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
  const material = selectMaterial(
    opts.sources,
    BUDGETS.question,
    opts.rotation * BUDGETS.question,
  );

  const focus = opts.weakConcepts.length
    ? `Prioritise these concepts, which the student has been getting wrong: ${opts.weakConcepts.join(", ")}.`
    : "No weak areas recorded yet, so pick an important concept.";

  const avoid = opts.recentQuestions.length
    ? `Do not repeat or lightly reword any of these recently asked questions:\n${opts.recentQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  return getProvider().generateJSON<SmartQuestion>(questionSchema, {
    system: TUTOR_VOICE,
    effort: "low",
    // Room for the model to think before it writes the question.
    maxOutputTokens: 2048,
    timeoutMs: 60_000,
    prompt: `Ask the student ONE question about the material below.

Target difficulty: ${opts.targetDifficulty} out of 5, where 1 is plain recall
and 5 asks them to apply or compare ideas.
${focus}
${avoid}

Write it as it would appear on an exam paper. Never refer to "the text",
"the passage" or "the material": the student is being examined on the
subject, not on their reading of a page.

The question must be answerable from the material alone, in two or three
sentences of typing. Do not ask multiple questions at once. Do not include
the answer in the question.

The concept must name the broader topic being tested, not the answer itself.

MATERIAL:
${material}`,
  });
}

/** A multiple-choice question, marked by comparison rather than by the AI. */
export interface ChoiceQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  concept: string;
  difficulty: number;
}

const choiceQuestionSchema: JSONSchema = {
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
    explanation: {
      type: "string",
      description:
        "Why the right answer is right, addressed to the student as 'you'. One or two sentences.",
    },
    concept: { type: "string" },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
  },
  required: [
    "question",
    "options",
    "answer_index",
    "explanation",
    "concept",
    "difficulty",
  ],
};

/**
 * Asks one multiple-choice question.
 *
 * The explanation is written now rather than at marking time, so answering
 * costs no second call: the result is instant and spends no quota.
 */
export async function nextChoiceQuestion(opts: {
  sources: SourceLike[];
  targetDifficulty: number;
  weakConcepts: string[];
  recentQuestions: string[];
  rotation: number;
}): Promise<ChoiceQuestion> {
  const material = selectMaterial(
    opts.sources,
    BUDGETS.question,
    opts.rotation * BUDGETS.question,
  );

  const focus = opts.weakConcepts.length
    ? `Prioritise these concepts, which the student keeps getting wrong: ${opts.weakConcepts.join(", ")}.`
    : "No weak areas recorded yet, so pick an important concept.";

  const avoid = opts.recentQuestions.length
    ? `Do not repeat or lightly reword any of these recently asked questions:\n${opts.recentQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  const result = await getProvider().generateJSON<ChoiceQuestion>(
    choiceQuestionSchema,
    {
      system: TUTOR_VOICE,
      effort: "low",
      maxOutputTokens: 2048,
      timeoutMs: 60_000,
      prompt: `Ask the student ONE multiple-choice question about the material below.

Target difficulty: ${opts.targetDifficulty} out of 5, where 1 is plain recall
and 5 asks them to apply or compare ideas.
${focus}
${avoid}

Rules for the question:
- Write it as it would appear on a real exam paper. Never refer to "the
  text", "the passage", "the material" or "the document": the student is
  being examined on the subject, not on their reading of a page.
- Do not define the answer inside the question. If the question describes the
  correct option so exactly that it names itself, rewrite it.
- Prefer asking what something does, when it is used, or how it differs from
  its neighbour, over asking what it is called.

Rules for the options:
- Exactly four.
- Each wrong option must be a real, named thing from this subject that a
  student could plausibly confuse with the answer. Never a vague negation
  ("non-X solutions", "other methods"), never "none of the above", never an
  option that is obviously filler.
- Make them tempting to someone who half-learned the topic: the neighbouring
  concept, the near-miss number, the right idea applied to the wrong thing.
- Vary which position the correct answer sits in.

The concept must name the broader topic being tested, not the correct answer.
Answer from the material alone.

MATERIAL:
${material}`,
    },
  );

  // Guard against a model that ignores the four-option rule.
  const options = Array.isArray(result.options) ? result.options : [];
  return {
    ...result,
    options,
    answer_index: Math.min(
      Math.max(result.answer_index ?? 0, 0),
      Math.max(options.length - 1, 0),
    ),
    difficulty: Math.min(Math.max(result.difficulty ?? 2, 1), 5),
  };
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
    maxOutputTokens: 2048,
    timeoutMs: 60_000,
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
  part = 0,
): Promise<TestQuestion[]> {
  const material = selectMaterial(sources, BUDGETS.test, part * BUDGETS.test);

  const { questions } = await getProvider().generateJSON<{
    questions: TestQuestion[];
  }>(testSchema, {
    system: TUTOR_VOICE,
    effort: "low",
    maxOutputTokens: 8192,
    timeoutMs: 150_000,
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
