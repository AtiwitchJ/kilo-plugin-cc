/**
 * Cross-agent delegation with smart fallback.
 *
 * When `--delegate-to=<agent>` is invoked, we first try calling the agent's
 * companion script (rich wrapper). If the companion is a stub (throws "is a
 * stub" or is not implemented), we automatically fall back to invoking the
 * underlying CLI binary directly via the DIRECT_INVOCATION map below.
 *
 * This lets users get value from any installed agent immediately, without
 * requiring every companion to be fully implemented.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readStdinIfPiped } from "./fs.mjs";

/**
 * For each agent, define how to invoke its CLI binary directly as a fallback.
 *
 * - `binary`: the executable name to look up on PATH
 * - `args(prompt, cwd)`: function returning argv for the prompt
 * - `shell`: true if the binary is a PowerShell shim (Windows .ps1)
 * - `stdin`: true if the CLI reads the prompt from stdin instead of argv
 */
export const DIRECT_INVOCATION = {
  kilo: {
    binary: "kilo",
    args: (prompt) => ["run", "--auto", "--format", "default", prompt],
    shell: true,
    stdin: false,
    description: "kilo run --auto"
  },
  claude: {
    binary: "claude",
    args: (prompt) => ["--print", prompt],
    shell: false,
    stdin: false,
    description: "claude --print"
  },
  openclaw: {
    binary: "openclaw",
    args: (prompt) => ["agent", "--local", "--message", prompt],
    shell: true,
    stdin: false,
    description: "openclaw agent --local --message"
  },
  opencode: {
    binary: "opencode",
    args: (prompt) => ["run", prompt],
    shell: false,
    stdin: false,
    description: "opencode run"
  },
  antigravity: {
    binary: "agy",
    args: (prompt) => ["--print", prompt],
    shell: false,
    stdin: false,
    description: "agy --print <prompt>"
  },
  cursor: {
    binary: "agent",
    args: (prompt) => ["-p", prompt],
    shell: true,
    stdin: false,
    description: "agent -p <prompt>"
  },
  hermes: {
    binary: "hermes",
    args: (prompt) => ["-z", prompt],
    shell: false,
    stdin: false,
    description: "hermes -z <prompt>"
  },
  jules: {
    binary: "gh",
    args: (prompt, cwd) => buildGhIssueArgs(prompt, cwd),
    shell: true,
    stdin: false,
    description: "gh issue create --label jules"
  }
};

function parseRepoFromOrigin(cwd) {
  try {
    const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
    if (result.status !== 0) return null;
    const url = result.stdout.trim();
    const match = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

function buildGhIssueArgs(prompt, cwd) {
  const repo = parseRepoFromOrigin(cwd);
  if (!repo) {
    throw new Error(
      `Cannot delegate to jules: could not parse GitHub repo from git remote in ${cwd}.`
    );
  }
  const title = prompt.split(/\r?\n/)[0].slice(0, 80);
  return [
    "issue", "create",
    "--repo", `${repo.owner}/${repo.repo}`,
    "--label", "jules",
    "--title", title,
    "--body", `@jules\n\n${prompt}\n\nTriggered via agents-plugin-cc cross-agent delegation.`
  ];
}

function quoteForShell(arg) {
  if (typeof arg !== "string" || !/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TIMEOUT_ENV_VAR = "CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS";

function resolveTimeoutMs(requestedTimeoutMs) {
  if (Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0) {
    return requestedTimeoutMs;
  }
  const envTimeoutMs = Number(process.env[TIMEOUT_ENV_VAR]);
  if (Number.isFinite(envTimeoutMs) && envTimeoutMs > 0) {
    return envTimeoutMs;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Spawn a direct CLI invocation detached in the background, for `--background`
 * delegated tasks. Resolves as soon as the process is launched instead of
 * waiting for it to exit; output goes to `logFile` if provided, else is discarded.
 */
function invokeDirectBackground(spec, args, cwd, logFile) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === "win32" && spec.shell;
    let stdio = "ignore";
    if (logFile) {
      try {
        const fd = fs.openSync(logFile, "a");
        stdio = ["ignore", fd, fd];
      } catch (err) {
        reject(err);
        return;
      }
    }

    let child;
    try {
      child = spawn(spec.binary, args, {
        cwd,
        env: process.env,
        stdio,
        detached: true,
        windowsHide: true,
        shell: useShell
      });
    } catch (err) {
      reject(err);
      return;
    }

    child.on("error", (err) => reject(err));
    child.unref();
    resolve({ status: 0, background: true, pid: child.pid ?? null, logFile: logFile ?? null });
  });
}

/**
 * Invoke a CLI binary directly as a fallback when the companion is a stub.
 *
 * `options.background`: if true, spawn detached and resolve immediately instead
 * of blocking until the process exits (used for `--background` delegated tasks).
 * `options.logFile`: where to send output when running in the background.
 * `options.timeoutMs`: overrides the default synchronous-run timeout; falls back
 * to the `CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS` env var, then 60s.
 */
export function invokeDirect(agent, prompt, cwd, options = {}) {
  const spec = DIRECT_INVOCATION[agent];
  if (!spec) {
    throw new Error(`No direct invocation defined for agent "${agent}".`);
  }

  const rawArgs = spec.args(prompt, cwd);
  const useShell = process.platform === "win32" && spec.shell;
  const args = useShell ? rawArgs.map(quoteForShell) : rawArgs;

  if (options.background) {
    return invokeDirectBackground(spec, args, cwd, options.logFile ?? null);
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs);

  return new Promise((resolve, reject) => {
    const child = spawn(spec.binary, args, {
      cwd,
      env: process.env,
      stdio: spec.stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 2000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${spec.description} timed out after ${timeoutMs}ms (probably waiting for interactive input).`));
        return;
      }
      if (status === 0) {
        resolve({ status: 0, stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(
          new Error(
            `${spec.description} (${spec.binary} ${rawArgs.join(" ")}) exited ${status}: ${stderr.trim() || stdout.trim()}`
          )
        );
      }
    });

    if (spec.stdin && prompt) {
      try {
        child.stdin.write(prompt);
        child.stdin.end();
      } catch {
        // ignore
      }
    }
  });
}

/**
 * Resolve the prompt to hand to a direct-fallback CLI invocation from the raw
 * argv passed to `--delegate-to`.
 *
 * Prefers an explicit `--prompt=<text>` (unambiguous), then joins ALL
 * positional args (an unquoted multi-word prompt is split across several
 * argv entries - previously only the last word survived), then falls back
 * to piped stdin.
 */
export function extractDelegatePrompt(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--prompt" && typeof argv[i + 1] === "string") {
      return argv[i + 1];
    }
    if (arg.startsWith("--prompt=")) {
      return arg.slice("--prompt=".length);
    }
  }
  const positionalArgs = argv.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
  if (positionalArgs.length > 0) {
    return positionalArgs.join(" ");
  }
  return readStdinIfPiped();
}

/** Parse an explicit `--timeout=<ms>` from delegate argv, if present. */
export function extractDelegateTimeoutMs(argv) {
  const arg = argv.find((a) => a.startsWith("--timeout="));
  return arg ? Number(arg.slice("--timeout=".length)) : undefined;
}

/** Create a fresh log file path for a background-delegated task's output. */
export function createDelegateLogFile(agent) {
  const dir = path.join(os.tmpdir(), "agents-plugin-cc-delegate");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${agent}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.log`);
}

const STUB_ERROR_PATTERN = /is a stub|not implemented|is not implemented|implement `?`?scripts?\//i;

/**
 * Detect whether a companion script is a stub (returns its error output as
 * a hint to fall back to direct invocation).
 *
 * Only treated as a stub when the companion exited with status 1, its stderr
 * matches the stub-error pattern, AND it produced no stdout. Matching on
 * combined stdout+stderr text alone risked false positives whenever real task
 * output happened to mention words like "not implemented".
 */
export function isStubError(stderr, stdout, exitCode) {
  return (
    exitCode === 1 &&
    STUB_ERROR_PATTERN.test(String(stderr ?? "")) &&
    String(stdout ?? "").length === 0
  );
}