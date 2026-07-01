#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function nowIso() {
  return new Date().toISOString();
}

function readEvent() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function emitOutput(payload) {
  try {
    const hookOutput = process.env.CLAUDE_HOOK_OUTPUT;
    if (hookOutput) {
      fs.appendFileSync(hookOutput, `${JSON.stringify(payload)}\n`);
    }
  } catch {
    // best-effort; do not fail the hook
  }
}

function handleSessionStart(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  emitOutput({
    hook: "kilo.SessionStart",
    workspaceRoot,
    timestamp: nowIso(),
    note: "kilo plugin is available. Run /kilo:setup to verify kilo CLI readiness."
  });
}

function handleSessionEnd(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  emitOutput({
    hook: "kilo.SessionEnd",
    workspaceRoot,
    timestamp: nowIso()
  });
}

function main() {
  const eventName = process.argv[2] ?? "SessionStart";
  const event = readEvent() ?? {};
  const cwd = event.cwd ?? process.cwd();

  if (eventName === "SessionStart") {
    handleSessionStart(cwd);
  } else if (eventName === "SessionEnd") {
    handleSessionEnd(cwd);
  }
}

main();