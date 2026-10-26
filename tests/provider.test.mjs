/**
 * Verifies the Gemini provider against a stand-in Interactions API:
 * that it sends the documented request shape, pulls the text out of the
 * steps[] -> model_output -> content[] -> text path, and turns each HTTP
 * failure into a useful message.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
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

mode = "empty";
await expectError("empty", (e) => assert.match(e.message, /empty response/i));

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

mode = "500";
await expectError("500", (e) => assert.equal(e.status, 502));

server.close();
await fs.rm(tmp, { force: true });
console.log("Gemini provider: all assertions passed");
