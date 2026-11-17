/**
 * Writes a starter question pool from the Core 1 chapters on disk.
 *
 * Run locally rather than in the app: a pool worth sitting is a few hundred
 * AI calls, which is a long wait to hold a browser tab open for. The result
 * ships as content/core1/pool.json and the seed route loads it, so a new
 * account starts with something answerable instead of an empty screen.
 *
 *   node --experimental-strip-types scripts/build-pool.mjs [--papers 3]
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { generateQuestions } = await import("../lib/exam/questions.ts");
const { declaredObjectives, fingerprint } = await import("../lib/exam/select.ts");
const { DOMAINS, EXAM, domainQuota } = await import("../lib/exam/core1.ts");

const args = process.argv.slice(2);
const papers = Number(args[args.indexOf("--papers") + 1]) || 3;
const only = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : null;

const DIR = path.join(process.cwd(), "content", "core1");
const OUT = path.join(DIR, "pool.json");

// Same mix the in-app pool builder uses.
const MIX = [
  ["single", 0.72],
  ["multiple", 0.18],
  ["ordering", 0.05],
  ["matching", 0.05],
];

const index = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const chapters = index.map((e) => {
  const content = fs.readFileSync(path.join(DIR, e.file), "utf8").trim();
  return { ...e, content, ...declaredObjectives(content) };
});

/** Chapters a domain's questions may be written from. */
function sourcesFor(domainId) {
  const relevant = chapters.filter(
    (c) => c.domain === domainId || c.objectives.some((o) => `${o[0]}.0` === domainId),
  );
  return (relevant.length ? relevant : chapters).map((c) => ({
    name: c.title,
    content: c.content,
  }));
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const pool = [...existing];
const seen = new Set(pool.map((q) => fingerprint(q.stem)));
console.log(`starting from ${pool.length} question(s) already written`);

const quota = domainQuota(EXAM.questions);
const work = [];
for (const d of DOMAINS) {
  if (only && d.id !== only) continue;
  const target = quota[d.id] * papers;
  for (const [kind, share] of MIX) {
    const need = Math.max(1, Math.round(target * share));
    const have = pool.filter((q) => q.domain === d.id && q.kind === kind).length;
    if (have < need) work.push({ domain: d.id, kind, missing: need - have });
  }
}

const BATCH = 5;
const batches = [];
const rotation = new Map();
for (const item of work) {
  let left = item.missing;
  while (left > 0) {
    const key = `${item.domain}:${item.kind}`;
    const r = rotation.get(key) ?? 0;
    rotation.set(key, r + 1);
    batches.push({ ...item, count: Math.min(BATCH, left), rotation: r });
    left -= BATCH;
  }
}

console.log(`${batches.length} batch(es) to run\n`);

let saved = 0;
let dupes = 0;
let failed = 0;

const save = () => fs.writeFileSync(OUT, JSON.stringify(pool, null, 1));

for (let i = 0; i < batches.length; i += 1) {
  const b = batches[i];
  const name = DOMAINS.find((d) => d.id === b.domain).name;
  const label = `[${String(i + 1).padStart(3)}/${batches.length}] ${b.domain} ${b.kind}`;

  try {
    const recent = pool
      .filter((q) => q.domain === b.domain && q.kind === b.kind)
      .slice(-12)
      .map((q) => q.stem);

    const { questions, rejected } = await generateQuestions({
      sources: sourcesFor(b.domain),
      domainId: b.domain,
      kind: b.kind,
      count: b.count,
      rotation: b.rotation,
      recentStems: recent,
    });

    let added = 0;
    for (const q of questions) {
      const fp = fingerprint(q.stem);
      if (seen.has(fp)) {
        dupes += 1;
        continue;
      }
      seen.add(fp);
      pool.push(q);
      added += 1;
    }
    saved += added;
    save();
    console.log(
      `${label}  +${added}${rejected.length ? ` (${rejected.length} rejected)` : ""}  pool ${pool.length}  ${name}`,
    );
    if (rejected.length) for (const r of rejected) console.log(`      dropped: ${r}`);
  } catch (cause) {
    failed += 1;
    console.log(`${label}  FAILED: ${cause.message}`);
    // A quota or capacity wobble should not throw away everything written so
    // far; the run is resumable, so stop politely if it keeps happening.
    if (failed > 8) {
      console.log("\ntoo many failures in a row, stopping");
      break;
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

save();
console.log(
  `\nwrote ${pool.length} question(s) to content/core1/pool.json ` +
    `(+${saved} this run, ${dupes} repeats dropped, ${failed} batch failures)`,
);

const byDomain = {};
for (const q of pool) {
  byDomain[q.domain] ??= {};
  byDomain[q.domain][q.kind] = (byDomain[q.domain][q.kind] ?? 0) + 1;
}
for (const d of DOMAINS) {
  const counts = byDomain[d.id] ?? {};
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  console.log(
    `  ${d.id} ${String(total).padStart(3)}  need ${String(quota[d.id] * papers).padStart(3)}  ` +
      Object.entries(counts).map(([k, c]) => `${k} ${c}`).join(", "),
  );
}
