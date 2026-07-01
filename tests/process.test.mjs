import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { resolveWorkspaceRoot } from "../plugins/kilo/scripts/lib/workspace.mjs";
import { runCommand, binaryAvailable, formatCommandFailure } from "../plugins/kilo/scripts/lib/process.mjs";

test("workspace: returns cwd when not in a git repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ws-"));
  try {
    const root = resolveWorkspaceRoot(tmp);
    assert.equal(root, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("workspace: walks up to nearest git repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ws-"));
  try {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    fs.mkdirSync(path.join(repo, ".git"));
    const nested = path.join(repo, "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(resolveWorkspaceRoot(nested), path.resolve(repo));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("process: binaryAvailable detects node", () => {
  const status = binaryAvailable("node", ["--version"]);
  assert.equal(status.available, true);
});

test("process: binaryAvailable flags missing binaries", () => {
  const status = binaryAvailable("definitely-not-a-real-binary-xyz", ["--version"]);
  assert.equal(status.available, false);
  assert.ok(status.detail.length > 0, "expected a non-empty detail");
});

test("process: formatCommandFailure includes exit code", () => {
  const msg = formatCommandFailure({
    command: "kilo",
    args: ["--bogus"],
    status: 2,
    stderr: "unknown flag",
    stdout: ""
  });
  assert.match(msg, /exit=2/);
  assert.match(msg, /unknown flag/);
});

test("process: runCommand captures stdout/stderr", () => {
  if (process.platform === "win32") {
    const result = runCommand("cmd.exe", ["/c", "echo hello"], {});
    assert.match(result.stdout, /hello/);
  } else {
    const result = runCommand("/bin/sh", ["-c", "echo hello"]);
    assert.match(result.stdout, /hello/);
  }
});