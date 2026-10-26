/**
 * Verifies the Gemini provider against a stand-in Interactions API:
 * that it sends the documented request shape, pulls the text out of the
 * steps[] -> model_output -> content[] -> text path, and turns each HTTP
 * failure into a useful message.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

let lastRequest = null;
let mode = "ok";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    lastRequest = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: JSON.parse(body || "{}"),
    };

    const send = (code, payload) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (mode === "ok") {
      // The response shape the Interactions API docs show.
      return send(200, {
        id: "v1_test",
        status: "completed",
        object: "interaction",
        model: lastRequest.body.model,
        steps: [
          { type: "thought", signature: "abc" },
          {
            type: "model_output",
            content: [{ type: "text", text: '{"title":"Cell biology","n":3}' }],
          },
        ],
      });
    }
    if (mode === "split") {
      // Text arriving in several parts across several steps.
      return send(200, {
        steps: [
          { type: "model_output", content: [{ type: "text", text: '{"a":' }] },
          { type: "model_output", content: [{ type: "text", text: "1}" }] },
        ],
      });
    }
    if (mode === "fenced") {
      return send(200, {
        steps: [
          {
            type: "model_output",
            content: [
              { type: "text", text: '```json\n{"fenced":true}\n```' },
            ],
          },
        ],
      });
    }
    if (mode === "empty") return send(200, { steps: [] });
    if (mode === "429") return send(429, { error: { message: "quota" } });
    if (mode === "401") return send(401, { error: { message: "bad key" } });
    if (mode === "404") return send(404, { error: { message: "no model" } });
    return send(500, { error: { message: "boom" } });
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

// Point the provider at the stand-in server. The copy lives next to the
// original so its relative imports still resolve.
const source = await fs.readFile(
  path.join(here, "../lib/ai/provider.ts"),
  "utf8",
);
const patched = source.replace(
  '"https://generativelanguage.googleapis.com/v1beta/interactions"',
  `"http://127.0.0.1:${port}/v1beta/interactions"`,
);
const tmp = path.join(here, "../lib/ai/.provider.under-test.ts");
await fs.writeFile(tmp, patched);

process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-3.8-flash";

const { getProvider, AIError } = await import(pathToFileURL(tmp).href);
const provider = getProvider();

const schema = {
  type: "object",
  properties: { title: { type: "string" }, n: { type: "integer" } },
  required: ["title", "n"],
};

// --- happy path -------------------------------------------------------------
const result = await provider.generateJSON(schema, {
  prompt: "Build a kit",
  system: "You are a tutor",
  maxOutputTokens: 2048,
  effort: "medium",
});
assert.deepEqual(result, { title: "Cell biology", n: 3 });

// request shape matches the documented API
assert.equal(lastRequest.method, "POST");
assert.equal(lastRequest.headers["x-goog-api-key"], "test-key");
assert.equal(lastRequest.body.model, "gemini-3.8-flash");
assert.equal(lastRequest.body.input, "Build a kit");
assert.equal(lastRequest.body.system_instruction, "You are a tutor");
assert.equal(lastRequest.body.store, false);
assert.equal(lastRequest.body.generation_config.max_output_tokens, 2048);
assert.equal(lastRequest.body.generation_config.thinking_level, "medium");
assert.equal(lastRequest.body.response_format.mime_type, "application/json");
assert.deepEqual(lastRequest.body.response_format.schema, schema);

// --- text split across parts and steps is joined ---------------------------
mode = "split";
assert.deepEqual(await provider.generateJSON({}, { prompt: "x" }), { a: 1 });

// --- markdown-fenced JSON still parses -------------------------------------
mode = "fenced";
assert.deepEqual(await provider.generateJSON({}, { prompt: "x" }), {
  fenced: true,
});

// --- plain text call omits response_format ---------------------------------
mode = "ok";
const text = await provider.generateText({ prompt: "Write a guide" });
assert.equal(text, '{"title":"Cell biology","n":3}');
assert.equal(lastRequest.body.response_format, undefined);

// --- failures become actionable errors -------------------------------------
async function expectError(label, test) {
  try {
    await provider.generateText({ prompt: "x" });
    assert.fail(`${label}: expected a throw`);
  } catch (err) {
    assert.ok(err instanceof AIError, `${label}: wrong error type`);
    test(err);
  }
}

// An empty reply must name the model and what came back, because the usual
// cause is a too-small token budget spent on thinking rather than a fault.
mode = "empty";
await expectError("empty", (e) => {
  assert.match(e.message, /returned no text/i);
  assert.match(e.message, /steps:/i);
  assert.equal(e.retryable, true, "another model is worth trying");
});

mode = "429";
await expectError("429", (e) => {
  assert.equal(e.status, 429);
  assert.match(e.message, /rate limit/i);
  assert.match(e.hint, /flash-lite/);
});

mode = "401";
await expectError("401", (e) => {
  assert.equal(e.status, 401);
  assert.match(e.hint, /aistudio\.google\.com/);
});

mode = "404";
await expectError("404", (e) => {
  assert.equal(e.status, 400);
  assert.match(e.message, /no model named/i);
  assert.match(e.hint, /GEMINI_MODEL/);
});

// A 500 reads as a capacity problem, so it is retryable rather than fatal.
mode = "500";
await expectError("500", (e) => {
  assert.equal(e.status, 503);
  assert.equal(e.retryable, true);
});

// --- falls back to the next model when one is busy -------------------------
// Free-tier capacity varies per model, so a busy model must not end the call.
let served = [];

const busyServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { model } = JSON.parse(body || "{}");
    served.push(model);
    if (model === "busy-model") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "busy-model is currently experiencing high demand" },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        steps: [{ type: "model_output", content: [{ type: "text", text: "OK" }] }],
      }),
    );
  });
});
await new Promise((r) => busyServer.listen(0, "127.0.0.1", r));
const busyPort = busyServer.address().port;

const fallbackSource = source.replace(
  '"https://generativelanguage.googleapis.com/v1beta/interactions"',
  `"http://127.0.0.1:${busyPort}/v1beta/interactions"`,
);
const fallbackTmp = path.join(here, "../lib/ai/.provider.fallback-test.ts");
await fs.writeFile(fallbackTmp, fallbackSource);

process.env.GEMINI_MODEL = "busy-model";
process.env.GEMINI_FALLBACK_MODELS = "spare-model";

const fallbackModule = await import(pathToFileURL(fallbackTmp).href);
const fallbackProvider = fallbackModule.getProvider();

served = [];
const text2 = await fallbackProvider.generateText({ prompt: "x" });
assert.equal(text2, "OK", "should have been served by the spare model");
assert.deepEqual(
  served,
  ["busy-model", "spare-model"],
  "should try the busy model first, then fall back",
);

// --- a rejected key must NOT trigger a fallback ---------------------------
const authServer = http.createServer((req, res) => {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "bad key" } }));
});
await new Promise((r) => authServer.listen(0, "127.0.0.1", r));
const authPort = authServer.address().port;

const authTmp = path.join(here, "../lib/ai/.provider.auth-test.ts");
await fs.writeFile(
  authTmp,
  source.replace(
    '"https://generativelanguage.googleapis.com/v1beta/interactions"',
    `"http://127.0.0.1:${authPort}/v1beta/interactions"`,
  ),
);
const authModule = await import(pathToFileURL(authTmp).href);
try {
  await authModule.getProvider().generateText({ prompt: "x" });
  assert.fail("a rejected key should throw");
} catch (err) {
  assert.equal(err.status, 401);
  assert.equal(err.retryable, false, "a bad key must not be retried elsewhere");
}

busyServer.close();
authServer.close();
server.close();
await fs.rm(tmp, { force: true });
await fs.rm(fallbackTmp, { force: true });
await fs.rm(authTmp, { force: true });
console.log("Gemini provider: all assertions passed");
