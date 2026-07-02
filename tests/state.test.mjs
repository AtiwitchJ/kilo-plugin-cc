import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  generateJobId,
  loadState,
  saveState,
  updateState,
  upsertJob,
  resolveStateDir,
  resolveStateFile,
  ensureStateDir
} from "../plugins/kilo/scripts/lib/state.mjs";

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-state-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("state: generateJobId returns prefixed ids", () => {
  const id = generateJobId("task");
  assert.match(id, /^task-[a-z0-9]+-[a-z0-9]+$/);
});

test("state: resolveStateDir is stable for the same workspace", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    const a = resolveStateDir(dir);
    const b = resolveStateDir(dir);
    assert.equal(a, b);
    assert.ok(a.length > 0);
    assert.ok(path.basename(a).length > 0);
  });
});

test("state: upsertJob adds and updates", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    ensureStateDir(dir);
    upsertJob(dir, {
      id: "task-1",
      kind: "task",
      kindLabel: "task",
      title: "Demo",
      workspaceRoot: dir,
      jobClass: "task",
      summary: "demo",
      status: "queued"
    });
    let state = loadState(dir);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].id, "task-1");

    upsertJob(dir, { id: "task-1", status: "running", phase: "running" });
    state = loadState(dir);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].status, "running");
  });
});

test("state: saveState prunes beyond MAX_JOBS", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    ensureStateDir(dir);
    const jobs = [];
    for (let i = 0; i < 60; i += 1) {
      jobs.push({
        id: `task-${i}`,
        kind: "task",
        kindLabel: "task",
        title: `Job ${i}`,
        workspaceRoot: dir,
        jobClass: "task",
        summary: `Job ${i}`,
        status: "completed",
        updatedAt: new Date(Date.now() - i * 1000).toISOString()
      });
    }
    saveState(dir, { jobs });
    const state = loadState(dir);
    assert.ok(state.jobs.length <= 50);
  });
});

test("state: updateState mutates and persists", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    ensureStateDir(dir);
    updateState(dir, (state) => {
      state.config = { ...state.config, foo: "bar" };
    });
    const reloaded = loadState(dir);
    assert.equal(reloaded.config.foo, "bar");
  });
});

test("state: resolveStateFile points inside resolveStateDir", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    const stateFile = resolveStateFile(dir);
    assert.ok(stateFile.endsWith("state.json"));
    assert.equal(path.dirname(stateFile), resolveStateDir(dir));
  });
});

test("state: resolveStateDir uses CODEX_PLUGIN_DATA when Claude data is absent", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(path.join(dir, ".git"));
    const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-codex-data-"));
    const previousClaudeData = process.env.CLAUDE_PLUGIN_DATA;
    const previousCodexData = process.env.CODEX_PLUGIN_DATA;
    delete process.env.CLAUDE_PLUGIN_DATA;
    process.env.CODEX_PLUGIN_DATA = pluginDataDir;
    try {
      const stateDir = resolveStateDir(dir);
      assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    } finally {
      fs.rmSync(pluginDataDir, { recursive: true, force: true });
      if (previousClaudeData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = previousClaudeData;
      if (previousCodexData === undefined) delete process.env.CODEX_PLUGIN_DATA;
      else process.env.CODEX_PLUGIN_DATA = previousCodexData;
    }
  });
});
