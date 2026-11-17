/**
 * The Core 1 prep's selection logic.
 *
 * What matters here: the domain of a chapter is read from the chapter rather
 * than guessed, a mock exam is shaped like the real paper, and a question
 * shuffled for display stays shuffled the same way on reload.
 */
import assert from "node:assert/strict";

const { declaredObjectives, fingerprint, composeSitting, displayOrder } =
  await import("../lib/exam/select.ts");
const { domainQuota, EXAM } = await import("../lib/exam/core1.ts");

// --------------------------------------------- reading a chapter's header
const header = `Virtualization and
Cloud Computing
THE FOLLOWING COMPTIA A+ 220-1201
EXAM OBJECTIVES ARE COVERED IN THIS
CHAPTER:
 | 4.0 Virtualization and Cloud Computing
 | 4.1 Explain virtualization concepts.
 | Purpose of virtual machines
 | 4.2 Summarize cloud computing concepts.
`;

assert.deepEqual(declaredObjectives(header), {
  domain: "4.0",
  objectives: ["4.1", "4.2"],
});

// A chapter covering two domains belongs to the one it declares most of.
const mixed = `Core Hardware and Network Troubleshooting
 | 2.0 Networking
 | 2.8 Given a scenario, troubleshoot a network.
 | 5.0 Hardware and Network Troubleshooting
 | 5.1 Apply best practice methodology.
 | 5.2 Troubleshoot storage drives.
 | 5.5 Troubleshoot wired and wireless networks.
`;
const m = declaredObjectives(mixed);
assert.equal(m.domain, "5.0", "three objectives in 5.0 beats one in 2.0");
assert.deepEqual(m.objectives, ["2.8", "5.1", "5.2", "5.5"]);

// Material with no header gets no domain rather than a guessed one.
assert.deepEqual(declaredObjectives("Just some notes about RAM timings."), {
  domain: "",
  objectives: [],
});

// An id that is not on the official list cannot invent an objective.
assert.deepEqual(declaredObjectives("| 1.9 Something made up.").objectives, []);

// ------------------------------------------------------- fingerprinting
const a = "A technician is asked to move a company from on-premises software to a hosted model.";
const b = "A technician is asked to move a company from on-premises software to a hosted model.";
assert.equal(fingerprint(a), fingerprint(b));

// Reordered filler and different punctuation is the same question.
assert.equal(
  fingerprint("Which cloud model BEST suits an organization offloading infrastructure?"),
  fingerprint("which cloud model best suits an organization offloading infrastructure"),
);

// Genuinely different questions must not collide.
assert.notEqual(
  fingerprint("A technician replaces a failing SATA drive in a desktop."),
  fingerprint("A technician configures a wireless access point for a small office."),
);

// ------------------------------------------------------ composing a mock
const kinds = ["single", "single", "single", "multiple", "ordering", "matching"];
const pool = [];
let n = 0;
for (const d of ["1.0", "2.0", "3.0", "4.0", "5.0"]) {
  for (let i = 0; i < 40; i += 1) {
    pool.push({ id: `q${n}`, domain: d, kind: kinds[n % kinds.length] });
    n += 1;
  }
}

const sitting = composeSitting(pool, EXAM.questions);
assert.equal(sitting.ids.length, EXAM.questions, "a full paper is 90 questions");
assert.deepEqual(sitting.shortfall, {}, "a full pool leaves nothing short");
assert.equal(new Set(sitting.ids).size, EXAM.questions, "no question twice in one sitting");

const quota = domainQuota(EXAM.questions);
const got = {};
for (const id of sitting.ids) {
  const d = pool.find((q) => q.id === id).domain;
  got[d] = (got[d] ?? 0) + 1;
}
assert.deepEqual(got, quota, "domain counts follow the published weights");

const pbqs = sitting.ids.filter((id) => {
  const k = pool.find((q) => q.id === id).kind;
  return k === "ordering" || k === "matching";
}).length;
assert.ok(pbqs <= 5, `performance-based shapes capped at five, got ${pbqs}`);
assert.ok(pbqs >= 1, "a pool with them should put some in");

// A pool that is mostly performance-based must still yield a full paper
// rather than refuse one: the cap is a preference, not a reason to fail.
const lopsided = [];
let k = 0;
for (const d of ["1.0", "2.0", "3.0", "4.0", "5.0"]) {
  for (let i = 0; i < 40; i += 1) {
    lopsided.push({
      id: `p${k}`,
      domain: d,
      // Only a quarter of the pool is single-answer.
      kind: i % 4 === 0 ? "single" : i % 2 === 0 ? "ordering" : "matching",
    });
    k += 1;
  }
}
const stretched = composeSitting(lopsided, EXAM.questions);
assert.deepEqual(stretched.shortfall, {}, "a lopsided pool still fills a paper");
assert.equal(stretched.ids.length, EXAM.questions);
assert.equal(new Set(stretched.ids).size, EXAM.questions);

// And when the pool really is too thin, it says so rather than setting a
// short paper that looks complete.
const genuinelyThin = lopsided.filter((q) => q.domain !== "4.0").slice(0, 60);
const thinResult = composeSitting(genuinelyThin, EXAM.questions);
assert.ok(
  Object.keys(thinResult.shortfall).length > 0,
  "a thin pool reports a shortfall",
);
assert.ok(thinResult.ids.length < EXAM.questions);

// A thin pool reports exactly what is missing instead of a short paper that
// looks complete.
const thin = pool.filter((q) => q.domain !== "2.0");
const short = composeSitting(thin, EXAM.questions);
assert.equal(short.shortfall["2.0"], quota["2.0"]);
assert.equal(short.ids.length, EXAM.questions - quota["2.0"]);

// ------------------------------------------------------- display order
const first = displayOrder("question-abc", 5);
assert.deepEqual(first, displayOrder("question-abc", 5), "same question, same order");
assert.notDeepEqual(first, displayOrder("question-xyz", 5), "different questions differ");
assert.deepEqual([...first].sort(), [0, 1, 2, 3, 4], "a permutation, nothing dropped");

// Four steps must not come out already in order, or an ordering question
// would be answered by leaving it alone.
let identity = 0;
for (let i = 0; i < 200; i += 1) {
  const o = displayOrder(`seed-${i}`, 4);
  if (o.every((v, idx) => v === idx)) identity += 1;
}
assert.ok(identity < 40, `shuffle is not degenerate (${identity}/200 were identity)`);

console.log("prep: ok");

// -------------------------------------------- showing and reading back
const { present, interpret } = await import("../lib/exam/select.ts");
const { grade } = await import("../lib/exam/grade.ts");

/** Answers q the way a student who knows the answer would, and marks it. */
function answerCorrectly(q) {
  const shown = present(q);

  if (q.kind === "single" || q.kind === "multiple") {
    // Pick the shown options whose text is a correct one.
    const right = (q.answer_indexes ?? []).map((i) => q.options[i]);
    const picked = shown.options
      .map((text, i) => (right.includes(text) ? i : -1))
      .filter((i) => i >= 0);
    return grade(q, interpret(q, { picked }));
  }

  if (q.kind === "ordering") {
    // Arrange the shown steps into the order the stored steps are in.
    const arranged = q.steps.map((text) => shown.steps.indexOf(text));
    return grade(q, interpret(q, { arranged }));
  }

  // For each left-hand item, choose the shown value that belongs to it.
  const chose = q.pairs.map((p) => shown.rights.indexOf(p.right));
  return grade(q, interpret(q, { chose }));
}

const samples = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "single",
    domain: "4.0",
    objective: "4.2",
    stem: "A company wants to access software online while a third party runs the infrastructure.",
    options: ["SaaS", "PaaS", "IaaS", "On-premises"],
    answer_indexes: [0],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "multiple",
    domain: "3.0",
    objective: "3.5",
    stem: "Which two memory types are used in laptops rather than desktops?",
    options: ["SODIMM", "DIMM", "LPDDR", "RDIMM", "ECC UDIMM"],
    answer_indexes: [0, 2],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "ordering",
    domain: "5.0",
    objective: "5.1",
    stem: "Put the troubleshooting methodology in order.",
    steps: [
      "Identify the problem",
      "Establish a theory of probable cause",
      "Test the theory",
      "Establish a plan of action",
      "Verify full functionality",
      "Document findings",
    ],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "matching",
    domain: "3.0",
    objective: "3.1",
    stem: "Match each connector to what it carries.",
    pairs: [
      { left: "RJ45", right: "Ethernet" },
      { left: "RJ11", right: "Telephone" },
      { left: "LC", right: "Fibre" },
      { left: "DB9", right: "Serial" },
    ],
  },
];

for (const q of samples) {
  const shown = present(q);

  // Nothing in what the student sees may give the answer away.
  const leaked = JSON.stringify(shown);
  assert.ok(!leaked.includes("answer_indexes"), `${q.kind} leaks answer_indexes`);
  assert.ok(!("pairs" in shown), `${q.kind} leaks the pairing`);

  assert.equal(answerCorrectly(q).score, 100, `${q.kind} round trip must mark 100`);
  assert.deepEqual(present(q), shown, `${q.kind} must present identically on reload`);
}

// An ordering question must not arrive already solved.
const steps6 = samples[2];
assert.notDeepEqual(
  present(steps6).steps,
  steps6.steps,
  "the correct order must not be the shown order",
);

// A wrong answer still has to lose the marks it should.
const multi = samples[1];
const shownMulti = present(multi);
const oneRight = shownMulti.options.indexOf("SODIMM");
assert.equal(
  grade(multi, interpret(multi, { picked: [oneRight] })).score,
  50,
  "one of two right is half",
);
assert.equal(
  grade(multi, interpret(multi, { picked: [0, 1, 2, 3, 4] })).score,
  0,
  "ticking everything scores nothing after the round trip too",
);

// Junk indexes from a tampered client must not crash or score.
assert.equal(grade(multi, interpret(multi, { picked: [99, -3] })).score, 0);
assert.equal(grade(steps6, interpret(steps6, { arranged: [9, 9, 9, 9, 9, 9] })).score, 0);
assert.equal(grade(samples[3], interpret(samples[3], { chose: [null, 77, -1, null] })).score, 0);
assert.equal(grade(multi, interpret(multi, null)).score, 0);
// A submission of the wrong shape for the question earns nothing.
assert.equal(grade(multi, interpret(multi, { arranged: [0, 1] })).score, 0);
assert.equal(grade(steps6, interpret(steps6, { picked: [0] })).score, 0);

console.log("present/interpret: ok");

// Two questions differing only in a figure are different questions: short
// tokens are dropped from the fingerprint, so numbers have to survive that.
assert.notEqual(
  fingerprint("Which partitioning scheme is required to boot from a 4TB drive?"),
  fingerprint("Which partitioning scheme is required to boot from a 2TB drive?"),
);
assert.notEqual(
  fingerprint("A technician configures a port for 100 Mbps."),
  fingerprint("A technician configures a port for 10 Mbps."),
);
// And a figure written the same way is still the same question.
assert.equal(
  fingerprint("Boot from a 4TB drive: which scheme?"),
  fingerprint("boot from a 4tb drive which scheme"),
);

console.log("fingerprint figures: ok");

// ------------------------------------------- marking lines up with the screen
const { detailForDisplay } = await import("../lib/exam/select.ts");

// A wrong pick must be crossed against the option he actually clicked, not
// whichever option happens to sit at that index in storage.
for (const q of [samples[0], samples[1]]) {
  const shown = present(q);
  const wrongAt = shown.options.findIndex(
    (text) => !(q.answer_indexes ?? []).map((i) => q.options[i]).includes(text),
  );
  const mark = grade(q, interpret(q, { picked: [wrongAt] }));
  const display = detailForDisplay(q, mark.detail);

  assert.equal(display.length, shown.options.length);
  assert.equal(display[wrongAt], false, `${q.kind}: the clicked wrong option is marked wrong`);

  // Every correct option he failed to tick is marked, and nothing else is.
  const rightText = (q.answer_indexes ?? []).map((i) => q.options[i]);
  shown.options.forEach((text, i) => {
    const expected = !(rightText.includes(text) || i === wrongAt);
    assert.equal(
      display[i],
      expected,
      `${q.kind}: option ${i} (${text}) marked ${display[i]}, expected ${expected}`,
    );
  });
}

// A fully correct answer leaves nothing crossed.
const perfect = grade(samples[0], interpret(samples[0], {
  picked: [present(samples[0]).options.indexOf("SaaS")],
}));
assert.deepEqual(
  detailForDisplay(samples[0], perfect.detail),
  [true, true, true, true],
);

// Ordering and matching are already in screen order and must pass through.
const ord = grade(samples[2], interpret(samples[2], { arranged: [1, 0, 2, 3, 4, 5] }));
assert.deepEqual(detailForDisplay(samples[2], ord.detail), ord.detail);

console.log("detail alignment: ok");
