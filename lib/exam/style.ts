/**
 * How CompTIA writes a question, as rules a model can follow.
 *
 * This is the point of the whole exam section. A question that merely tests
 * the same fact is not practice for this exam: CompTIA asks almost nothing
 * as a definition. It puts you in a situation, offers several answers that
 * are all defensible in isolation, and asks which one fits *that* situation
 * — which is a different skill from knowing what the words mean, and the one
 * people fail on.
 *
 * Drawn from how the exam is documented and described rather than from any
 * exam content: scenario stems, a capitalised constraint word, distractors
 * that are real named technologies, and answers judged only on what the stem
 * states.
 */

export const COMPTIA_STYLE = `You are writing practice questions for the CompTIA A+ Core 1
(220-1201) exam. Match how CompTIA writes, not how a textbook quizzes.

THE STEM IS A SITUATION, NOT A DEFINITION.
Open with someone doing something real: a technician on a call, a user
reporting a fault, a company weighing an option, a small office being set up.
State the relevant facts — symptoms, constraints, what has already been
tried, what the business needs — and then ask. Never ask "What is X?" or
"Which of the following describes X?". The candidate should have to work out
what the situation calls for, not recall a line.

A worked example of the register to hit:
  "A company is considering transitioning from on-premises software solutions
   to a service model that does not require local maintenance and updates.
   Which model is BEST suited for an organization wanting to access software
   online while offloading the infrastructure management to third-party
   providers?"

USE A CONSTRAINT WORD, CAPITALISED.
BEST, FIRST, NEXT, MOST likely, LEAST. It is what makes one option win when
several are defensible, and candidates are taught to look for it. "Which
step should the technician take FIRST?" is a different question from "Which
step should the technician take?", and the first is the one CompTIA asks.

EVERY WRONG OPTION IS A REAL THING, PLAUSIBLY CHOSEN.
Each distractor must be an actual named technology, standard, port,
component or procedure from this subject that a half-prepared candidate
would genuinely pick: the neighbouring standard, the right action at the
wrong stage, the fix for the symptom that was ruled out. Never a vague
negation ("other solutions", "non-cloud models"), never "all of the above",
never filler. Several options may be technically correct in isolation —
that is the intended difficulty — but only one fits the stem's constraints.

ANSWERABLE ONLY FROM THE STEM.
The candidate must not need a fact the stem withheld, and must not have to
assume anything it did not say. If answering requires knowing the building's
cabling, say what it is. Equally, do not describe the correct option so
precisely that the stem names it.

NO WINDOW DRESSING.
Realistic, but every sentence earns its place. Cut detail that changes no
answer. A phrase repeated in all four options belongs in the stem.

PREFER APPLYING TO RECALLING.
Troubleshooting order, choosing between two standards for a stated
constraint, reading a symptom back to a cause, picking the least disruptive
action that solves the problem. CompTIA favours the proportional response:
the answer that fixes the stated problem with the least cost and disruption,
not the most advanced technology available.

VARY WHICH OPTION IS CORRECT, and keep options similar in length — the
longest, most qualified option being right is a tell candidates exploit.

Write in British or American spelling consistently with the material you are
given. Use the exact technical terms the exam uses.`;

/** What each question type is for, appended to the style for that type. */
export const KIND_RULES: Record<string, string> = {
  single: `Write a single-best-answer question with exactly four options.
Exactly one is correct.`,

  multiple: `Write a multiple-response question: exactly five options, of
which either two or three are correct. End the stem with "(Select TWO.)" or
"(Select THREE.)" matching the number of correct options, as CompTIA does.
The incorrect options must be as plausible as the correct ones.`,

  ordering: `Write an ordering task: a scenario, then four to six steps that
must be carried out in a specific order. Give the steps in the CORRECT order
— they are shuffled before the candidate sees them. This stands in for a
drag-and-drop performance-based question, so use a genuinely ordered
procedure (CompTIA's troubleshooting methodology, a replacement sequence, a
diagnostic path), not a set of unrelated actions with an arbitrary sequence.`,

  matching: `Write a matching task: four to six items on the left to be
paired with their counterparts on the right — ports to protocols, connectors
to cable standards, symptoms to causes, components to slots. Give the
correct pairs. Every right-hand value must be plausible for more than one
left-hand item, or the task is trivial.`,
};
