import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import {
  DIRECT_INVOCATION,
  extractDelegatePrompt,
  extractDelegateTimeoutMs,
  invokeDirect,
  isStubError
} from "../plugins/kilo/scripts/lib/delegate.mjs";

test("delegate: DIRECT_INVOCATION has all 8 agents", () => {
  const expected = ["kilo", "claude", "openclaw", "opencode", "antigravity", "cursor", "hermes", "jules"];
  for (const agent of expected) {
    assert.ok(DIRECT_INVOCATION[agent], `Missing agent: ${agent}`);
  }
});

test("delegate: each agent has binary + args function + shell flag", () => {
  for (const [agent, spec] of Object.entries(DIRECT_INVOCATION)) {
    assert.equal(typeof spec.binary, "string", `${agent} missing binary`);
    assert.ok(spec.binary.length > 0, `${agent} binary is empty`);
    assert.equal(typeof spec.args, "function", `${agent} args is not a function`);
    assert.equal(typeof spec.shell, "boolean", `${agent} shell is not boolean`);
    assert.equal(typeof spec.description, "string", `${agent} description missing`);
  }
});

test("delegate: kilo and openclaw use --shell (PowerShell wrappers)", () => {
  assert.equal(DIRECT_INVOCATION.kilo.shell, true);
  assert.equal(DIRECT_INVOCATION.openclaw.shell, true);
  assert.equal(DIRECT_INVOCATION.cursor.shell, true);
  assert.equal(DIRECT_INVOCATION.jules.shell, true);
});

test("delegate: claude and opencode do not use --shell", () => {
  assert.equal(DIRECT_INVOCATION.claude.shell, false);
  assert.equal(DIRECT_INVOCATION.opencode.shell, false);
  assert.equal(DIRECT_INVOCATION.hermes.shell, false);
  assert.equal(DIRECT_INVOCATION.antigravity.shell, false);
});

test("delegate: kilo args include --auto", () => {
  const args = DIRECT_INVOCATION.kilo.args("hello");
  assert.ok(args.includes("--auto"));
  assert.ok(args.includes("hello"));
});

test("delegate: claude args include --print", () => {
  const args = DIRECT_INVOCATION.claude.args("hello");
  assert.deepEqual(args, ["--print", "hello"]);
});

test("delegate: openclaw args include --local and --message", () => {
  const args = DIRECT_INVOCATION.openclaw.args("hello");
  assert.ok(args.includes("--local"));
  assert.ok(args.includes("--message"));
  assert.ok(args.includes("hello"));
});

test("delegate: hermes args use -z", () => {
  const args = DIRECT_INVOCATION.hermes.args("hello");
  assert.deepEqual(args, ["-z", "hello"]);
});

test("delegate: cursor args use -p", () => {
  const args = DIRECT_INVOCATION.cursor.args("hello");
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("hello"));
});

test("delegate: antigravity uses `agy --print`, not a bare positional (bug #4 - agy is print-only, not interactive-positional)", () => {
  const args = DIRECT_INVOCATION.antigravity.args("hello");
  assert.deepEqual(args, ["--print", "hello"]);
});

test("delegate: isStubError requires exit code 1 + stderr match + empty stdout (bug #11)", () => {
  assert.equal(isStubError("`foo-companion` is a stub. See ../kilo", "", 1), true);
  assert.equal(isStubError("Not implemented yet", "", 1), true);
  assert.equal(isStubError("All good!", "", 1), false);
  assert.equal(
    isStubError("`foo-companion` is a stub.", "", 0),
    false,
    "a non-1 exit code should never be treated as a stub"
  );
  assert.equal(
    isStubError("`foo-companion` is a stub.", "some real output", 1),
    false,
    "non-empty stdout alongside a stub-shaped stderr should not be treated as a stub"
  );
});

test("delegate: extractDelegatePrompt joins multi-word unquoted prompts (bug #10 - previously only the last word survived)", () => {
  // Callers pass argv with the leading subcommand (e.g. "task") already stripped.
  const prompt = extractDelegatePrompt(["--delegate-to=hermes", "fix", "the", "login", "bug"]);
  assert.equal(prompt, "fix the login bug");
});

test("delegate: extractDelegatePrompt prefers an explicit --prompt=<text>", () => {
  const prompt = extractDelegatePrompt(["task", "--background", "--prompt=fix the thing", "ignored positional"]);
  assert.equal(prompt, "fix the thing");
});

test("delegate: extractDelegatePrompt supports --prompt <text> as two argv entries", () => {
  const prompt = extractDelegatePrompt(["task", "--prompt", "fix it please"]);
  assert.equal(prompt, "fix it please");
});

test("delegate: extractDelegateTimeoutMs parses --timeout=<ms>", () => {
  assert.equal(extractDelegateTimeoutMs(["task", "--timeout=5000", "hi"]), 5000);
  assert.equal(extractDelegateTimeoutMs(["task", "hi"]), undefined);
});

test("delegate: invokeDirect respects --background by resolving immediately instead of blocking (bug #12)", async () => {
  DIRECT_INVOCATION.__test_background__ = {
    binary: process.execPath,
    args: () => ["-e", "setTimeout(() => {}, 5000)"],
    shell: false,
    stdin: false,
    description: "test background sleeper"
  };
  try {
    const start = Date.now();
    const result = await invokeDirect("__test_background__", "hi", process.cwd(), { background: true });
    const elapsed = Date.now() - start;
    assert.equal(result.background, true);
    assert.ok(Number.isInteger(result.pid));
    assert.ok(elapsed < 2000, `invokeDirect blocked for ${elapsed}ms instead of returning immediately`);
  } finally {
    delete DIRECT_INVOCATION.__test_background__;
  }
});

test("delegate: invokeDirect timeout falls back to CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS env var (bug #13)", async () => {
  DIRECT_INVOCATION.__test_timeout__ = {
    binary: process.execPath,
    args: () => ["-e", "setTimeout(() => {}, 5000)"],
    shell: false,
    stdin: false,
    description: "test slow process"
  };
  const previousEnv = process.env.CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS;
  process.env.CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS = "200";
  try {
    await assert.rejects(
      () => invokeDirect("__test_timeout__", "hi", process.cwd(), {}),
      /timed out after 200ms/
    );
  } finally {
    delete DIRECT_INVOCATION.__test_timeout__;
    if (previousEnv === undefined) delete process.env.CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS;
    else process.env.CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS = previousEnv;
  }
});
