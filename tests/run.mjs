/** Runs every test file in this directory and reports a single result. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

let failed = 0;

for (const file of files) {
  try {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", path.join(here, file)],
      { stdio: "inherit", cwd: path.join(here, "..") },
    );
  } catch {
    failed += 1;
    console.error(`FAILED: ${file}`);
  }
}

if (failed) {
  console.error(`\n${failed} of ${files.length} test files failed.`);
  process.exit(1);
}
console.log(`\n${files.length} test files passed.`);
