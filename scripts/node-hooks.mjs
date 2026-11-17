/**
 * Lets a plain `node` script import the app's server modules.
 *
 * Three things Next.js resolves at build time and Node does not:
 *
 *   - `server-only` / `client-only`, markers that exist to fail a build which
 *     pulls server code into a client bundle. Outside Next there is nothing
 *     to resolve them to, so they point at an empty module here.
 *   - the `@/*` path alias from tsconfig.
 *   - extensionless relative imports, which TypeScript allows under
 *     `moduleResolution: bundler` but Node's ESM resolver does not.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** The first of base, base.ts, base.tsx, base/index.ts that exists. */
function probe(base) {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(isFile);
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,", format: "module", shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const found = probe(path.join(ROOT, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  try {
    return await next(specifier, context);
  } catch (cause) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = path.resolve(
        path.dirname(fileURLToPath(context.parentURL)),
        specifier,
      );
      const found = probe(base);
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    throw cause;
  }
}
