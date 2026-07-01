import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import {
  gitDiffNameOnly,
  gitStatusShort,
  resolveReviewTarget,
  collectReviewContext,
  ensureGitRepository
} from "../plugins/kilo/scripts/lib/git.mjs";

function withRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-git-"));
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "test@example.com"]);
  run("git", ["config", "user.name", "Test"]);
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("git: resolveReviewTarget defaults to working-tree", () => {
  const target = resolveReviewTarget(process.cwd(), {});
  assert.equal(target.mode, "working-tree");
});

test("git: resolveReviewTarget with --base uses branch mode", () => {
  const target = resolveReviewTarget(process.cwd(), { base: "main" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("git: ensureGitRepository throws outside a repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-nogit-"));
  try {
    assert.throws(() => ensureGitRepository(tmp), /git repository/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("git: ensureGitRepository accepts inside a repo", () => {
  withRepo((dir) => {
    assert.doesNotThrow(() => ensureGitRepository(dir));
  });
});

test("git: gitDiffNameOnly returns changed files", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v1");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "v2");
    const files = gitDiffNameOnly(dir, []);
    assert.ok(files.includes("a.txt"));
  });
});

test("git: collectReviewContext includes summary and content", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v1");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "v2");
    const target = resolveReviewTarget(dir, {});
    const ctx = collectReviewContext(dir, target);
    assert.ok(ctx.summary.includes("Files in diff"));
    assert.ok(ctx.content.includes("v2"));
  });
});

test("git: status is empty for clean repo", () => {
  withRepo((dir) => {
    assert.equal(gitStatusShort(dir), "");
  });
});