import { test } from "node:test";
import assert from "node:assert/strict";

import { buildKiloArgs, parseKiloEventStream } from "../plugins/kilo/scripts/lib/kilo.mjs";

test("buildKiloArgs: includes positional prompt and format json", () => {
  const args = buildKiloArgs({
    prompt: "fix the failing test",
    format: "json",
    write: true,
    model: "openai/gpt-5"
  });
  assert.ok(args.includes("run"));
  assert.ok(args.includes("--format"));
  assert.ok(args.includes("json"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("openai/gpt-5"));
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.ok(args.includes("fix the failing test"));
});

test("buildKiloArgs: passes session id and fork", () => {
  const args = buildKiloArgs({
    sessionId: "abc123",
    fork: true,
    format: "json"
  });
  assert.ok(args.includes("--session"));
  assert.ok(args.includes("abc123"));
  assert.ok(args.includes("--fork"));
});

test("buildKiloArgs: does not pass --dangerously-skip-permissions without --write", () => {
  const args = buildKiloArgs({ prompt: "review only", format: "json" });
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});

test("parseKiloEventStream: extracts session id and final text", () => {
  const events = [
    { type: "session_start", session_id: "session-xyz" },
    { type: "message", text: "Hello" },
    { type: "message", text: "World" },
    { type: "result", text: "Done." }
  ].map((e) => JSON.stringify(e)).join("\n");
  const result = parseKiloEventStream(events);
  assert.equal(result.sessionId, "session-xyz");
  assert.equal(result.text, "Hello\nWorld\nDone.");
});

test("parseKiloEventStream: surfaces error events", () => {
  const events = [
    { type: "error", error: { message: "rate limit" } }
  ].map((e) => JSON.stringify(e)).join("\n");
  const result = parseKiloEventStream(events);
  assert.equal(result.error, "rate limit");
});

test("parseKiloEventStream: ignores non-JSON lines", () => {
  const result = parseKiloEventStream("not json\n{\"type\":\"message\",\"text\":\"ok\"}\n");
  assert.equal(result.text, "ok");
});