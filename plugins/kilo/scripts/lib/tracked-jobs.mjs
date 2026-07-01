import fs from "node:fs";
import path from "node:path";

import { readJsonFile } from "./fs.mjs";
import { ensureStateDir, resolveJobFile, resolveJobLogFile, nowIso } from "./state.mjs";

const KILO_TASK_THREAD_PREFIX = "Kilo Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current session state. Pick the next highest-value step and follow through until the task is resolved.";

export { KILO_TASK_THREAD_PREFIX, DEFAULT_CONTINUE_PROMPT };

export function appendLogLine(logFile, line) {
  if (!logFile) return;
  ensureStateDir(path.dirname(logFile));
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

export function createJobLogFile(cwd, jobId, title) {
  const logFile = resolveJobLogFile(cwd, jobId);
  ensureStateDir(cwd);
  const header = [
    `# Kilo companion log`,
    `# job: ${jobId}`,
    `# title: ${title ?? "(untitled)"}`,
    `# created: ${nowIso()}`,
    ""
  ].join("\n");
  fs.writeFileSync(logFile, header, "utf8");
  return logFile;
}

export function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  return function report(update) {
    const message =
      typeof update === "string"
        ? update
        : update?.message ?? "";
    const phase = typeof update === "object" && update ? update.phase ?? null : null;

    if (message) {
      const line = phase ? `[${phase}] ${message}` : message;
      if (logFile) {
        appendLogLine(logFile, line);
      }
      if (stderr) {
        process.stderr.write(`${line}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    }
    if (typeof onEvent === "function") {
      try {
        onEvent(update);
      } catch {
        // ignore reporter errors so the runner keeps moving
      }
    }
  };
}

export function createJobProgressUpdater(cwd, jobId) {
  return function update(update) {
    if (!update || typeof update !== "object") return;
    const jobFile = resolveJobFile(cwd, jobId);
    if (!fs.existsSync(jobFile)) return;
    try {
      const stored = readJsonFile(jobFile);
      const merged = {
        ...stored,
        phase: update.phase ?? stored.phase ?? null,
        lastMessage: update.message ?? stored.lastMessage ?? null,
        updatedAt: nowIso()
      };
      fs.writeFileSync(jobFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    } catch {
      // ignore persistence errors; we still want progress events to flow
    }
  };
}

export function createJobRecord({
  id,
  kind,
  kindLabel,
  title,
  workspaceRoot,
  jobClass,
  summary,
  write = false,
  request = null,
  logFile = null
}) {
  return {
    id,
    kind,
    kindLabel,
    title,
    summary,
    workspaceRoot,
    jobClass,
    write,
    request,
    logFile,
    status: "pending",
    phase: "queued",
    pid: null,
    threadId: null,
    sessionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

const SESSION_ID_ENV = "CLAUDE_SESSION_ID";
export { SESSION_ID_ENV };

/**
 * Run a job to completion, recording its start/end timestamps and persisting
 * the final payload. Returns `{ exitStatus, payload, rendered, summary }`.
 */
export async function runTrackedJob(job, runner, options = {}) {
  const logFile = options.logFile ?? job.logFile ?? null;
  const startedAt = nowIso();
  appendLogLine(logFile, `Started at ${startedAt}`);

  let result;
  try {
    result = await runner();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLogLine(logFile, `Failed: ${message}`);
    throw error;
  }

  const completedAt = nowIso();
  appendLogLine(logFile, `Completed at ${completedAt}`);

  return {
    ...result,
    startedAt,
    completedAt,
    logFile
  };
}