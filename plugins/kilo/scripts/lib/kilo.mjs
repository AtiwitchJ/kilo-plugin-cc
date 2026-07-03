import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runCommand, binaryAvailable } from "./process.mjs";
import { spawnDetached } from "./process.mjs";

const SERVICE_NAME = "claude_code_kilo_plugin";
const KILO_LOG_PREFIX = "Kilo";

function cleanKiloStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line &&
        !/^(WARN|INFO|DEBUG|ERROR)/i.test(line.trim()) &&
        !line.startsWith("WARNING: proceeding, even though we could not update PATH:")
    )
    .join("\n");
}

export function getKiloAvailability(cwd) {
  const versionStatus = binaryAvailable("kilo", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }

  const runStatus = binaryAvailable("kilo", ["run", "--help"], { cwd });
  if (!runStatus.available) {
    return {
      available: false,
      detail: `${versionStatus.detail}; kilo run unavailable: ${runStatus.detail}`
    };
  }

  return {
    available: true,
    detail: `${versionStatus.detail}; kilo run available`
  };
}

export async function getKiloAuthStatus(cwd) {
  const availability = getKiloAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      source: "availability",
      provider: null
    };
  }

  const profile = runCommand("kilo", ["profile"], { cwd });
  if (profile.error) {
    return {
      available: true,
      loggedIn: false,
      detail: profile.error.message,
      source: "profile",
      provider: null
    };
  }

  const stdout = profile.stdout.trim();
  if (profile.status !== 0) {
    return {
      available: true,
      loggedIn: false,
      detail: stdout || profile.stderr.trim() || `exit ${profile.status}`,
      source: "profile",
      provider: null
    };
  }

  const emailMatch = /email\s*[:=]\s*([^\s]+)/i.exec(stdout);
  const providerMatch = /provider\s*[:=]\s*([^\s]+)/i.exec(stdout);
  const idMatch = /id\s*[:=]\s*([^\s]+)/i.exec(stdout);

  const loggedIn = Boolean(emailMatch || idMatch);
  return {
    available: true,
    loggedIn,
    detail: loggedIn
      ? `Kilo account active${emailMatch ? ` (${emailMatch[1]})` : ""}`
      : "Kilo profile reachable but no account detected; run `!kilo auth` to sign in.",
    source: "profile",
    provider: providerMatch?.[1] ?? null,
    email: emailMatch?.[1] ?? null,
    id: idMatch?.[1] ?? null
  };
}

function ensureKiloAvailable(cwd) {
  const availability = getKiloAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Kilo CLI is not installed or is missing required runtime support. Install it with `npm install -g @kilocode/cli`, then rerun `/kilo:setup`."
    );
  }
}

function buildKiloArgs({ prompt, model, agent, variant, thinking, write, format, sessionId, continueLast, fork, title, files }) {
  const args = ["run"];

  if (sessionId) {
    args.push("--session", sessionId);
  } else if (continueLast) {
    args.push("--continue");
  }

  if (fork && (sessionId || continueLast)) {
    args.push("--fork");
  }

  if (model) {
    args.push("--model", model);
  }

  if (agent) {
    args.push("--agent", agent);
  }

  if (variant) {
    args.push("--variant", variant);
  }

  if (thinking) {
    args.push("--thinking");
  }

  if (write) {
    args.push("--dangerously-skip-permissions");
  }

  if (title) {
    args.push("--title", title);
  }

  if (Array.isArray(files)) {
    for (const file of files) {
      if (file) args.push("--file", file);
    }
  }

  args.push("--format", format ?? "default");

  if (prompt) {
    args.push(prompt);
  }

  return args;
}

/**
 * Parse kilo's `--format json` event stream.
 *
 * kilo emits NDJSON where each line is a JSON event. Event shapes vary by version,
 * but the keys we care about are reasonably stable:
 *   - session_id / session.id / sessionID (real CLI output uses flat camelCase "sessionID")
 *   - type / event (e.g. "message", "tool_call", "result", "text")
 *   - text / content / part.text (real CLI output nests text under "part.text")
 *   - error / error.message
 *
 * Returns:
 *   { sessionId, text, touchedFiles, error, events }
 */
export function parseKiloEventStream(stdout) {
  const events = [];
  let sessionId = null;
  const textChunks = [];
  let error = null;

  const acceptSessionId = (value) => {
    if (typeof value === "string" && value.length > 0) {
      sessionId = value;
    }
  };

  const extractText = (parsed) =>
    parsed.text ?? parsed.content ?? parsed.part?.text ?? parsed.part?.content ?? "";

  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    events.push(parsed);

    if (!sessionId && typeof parsed.session_id === "string") {
      acceptSessionId(parsed.session_id);
    }
    if (!sessionId && typeof parsed.sessionID === "string") {
      acceptSessionId(parsed.sessionID);
    }
    if (!sessionId && parsed.session && typeof parsed.session.id === "string") {
      acceptSessionId(parsed.session.id);
    }

    const type = parsed.type ?? parsed.event ?? "";
    const partType = parsed.part?.type ?? "";
    if (type === "message" || type === "assistant" || type === "text" || partType === "text") {
      const text = extractText(parsed);
      if (typeof text === "string" && text.length > 0) {
        textChunks.push(text);
      }
    } else if (type === "result" || type === "final") {
      const text = extractText(parsed) || parsed.result || "";
      if (typeof text === "string" && text.length > 0) {
        textChunks.push(text);
      }
      if (parsed.session_id) acceptSessionId(parsed.session_id);
      if (parsed.sessionID) acceptSessionId(parsed.sessionID);
    } else if (type === "error") {
      error = parsed.error?.message ?? parsed.message ?? parsed.text ?? "unknown kilo error";
    }
  }

  return {
    sessionId,
    text: textChunks.join("\n").trim(),
    error,
    events
  };
}

function spawnKilo({ cwd, args, onProgress, logFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn("kilo", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (onProgress) {
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            const msg = evt.text ?? evt.message ?? evt.content ?? evt.part?.text ?? evt.part?.content;
            if (typeof msg === "string" && msg.length > 0) {
              onProgress({
                message: msg.slice(0, 200),
                phase: evt.type ?? evt.event ?? null
              });
            }
          } catch {
            onProgress({ message: trimmed.slice(0, 200), phase: "stdout" });
          }
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (logFile) {
        fs.appendFileSync(logFile, `[stderr] ${text}`, "utf8");
      }
      if (onProgress) {
        onProgress({ message: text.trim().split(/\r?\n/).pop() ?? "", phase: "stderr" });
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (status, signal) => {
      resolve({ status: status ?? 0, signal, stdout, stderr });
    });
  });
}

/**
 * Run a kilo task in the foreground and return its parsed result.
 *
 * @param {string} cwd
 * @param {{
 *   prompt?: string,
 *   defaultPrompt?: string,
 *   model?: string|null,
 *   agent?: string|null,
 *   variant?: string|null,
 *   thinking?: boolean,
 *   write?: boolean,
 *   sessionId?: string|null,
 *   continueLast?: boolean,
 *   fork?: boolean,
 *   title?: string|null,
 *   files?: string[],
 *   onProgress?: (update: any) => void,
 *   logFile?: string|null
 * }} options
 */
export async function runKilo(cwd, options = {}) {
  ensureKiloAvailable(cwd);

  const prompt = (options.prompt ?? "").trim() || (options.defaultPrompt ?? "").trim();
  if (!prompt && !options.sessionId && !options.continueLast) {
    throw new Error("A prompt is required for this kilo run.");
  }

  const args = buildKiloArgs({
    prompt,
    model: options.model ?? null,
    agent: options.agent ?? null,
    variant: options.variant ?? null,
    thinking: Boolean(options.thinking),
    write: Boolean(options.write),
    format: "json",
    sessionId: options.sessionId ?? null,
    continueLast: Boolean(options.continueLast),
    fork: Boolean(options.fork),
    title: options.title ?? null,
    files: options.files ?? []
  });

  const execution = await spawnKilo({
    cwd,
    args,
    onProgress: options.onProgress,
    logFile: options.logFile ?? null
  });

  const cleanedStderr = cleanKiloStderr(execution.stderr);
  const parsed = parseKiloEventStream(execution.stdout);

  return {
    status: execution.status === 0 && !parsed.error ? 0 : execution.status || 1,
    signal: execution.signal,
    sessionId: parsed.sessionId,
    text: parsed.text,
    error: parsed.error,
    stderr: cleanedStderr,
    rawStdout: execution.stdout,
    events: parsed.events
  };
}

/**
 * Spawn a kilo run as a detached background task. Returns the child PID so the
 * companion can cancel it later. The job is recorded as queued until the worker
 * flips it to running.
 */
export function spawnKiloDetached({ cwd, args }) {
  const child = spawnDetached("kilo", args, { cwd });
  return { pid: child.pid ?? null };
}

/**
 * Try to detect the latest kilo session id we can resume.
 *
 * kilo has `kilo session list` (text output) and `kilo export [sessionID]` for
 * specific sessions. We try the JSON output first via `kilo session list --format json`
 * if available, and fall back to parsing text output.
 */
export async function findLatestResumableSession(cwd) {
  ensureKiloAvailable(cwd);

  const jsonResult = runCommand("kilo", ["session", "list", "--format", "json"], { cwd });
  if (!jsonResult.error && jsonResult.status === 0) {
    try {
      const parsed = JSON.parse(jsonResult.stdout);
      const sessions = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
      if (sessions.length > 0) {
        const first = sessions[0];
        const id = first.id ?? first.session_id ?? first.sessionId ?? null;
        if (id) {
          return { id, source: "kilo session list --format json" };
        }
      }
    } catch {
      // fall through to text parsing
    }
  }

  const textResult = runCommand("kilo", ["session", "list"], { cwd });
  if (textResult.error || textResult.status !== 0) {
    return null;
  }

  const lines = textResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const idMatch = /^([A-Za-z0-9_-]{6,})/.exec(lines[0]);
  if (!idMatch) return null;

  return { id: idMatch[1], source: "kilo session list" };
}

export { buildKiloArgs, ensureKiloAvailable, SERVICE_NAME, KILO_LOG_PREFIX };