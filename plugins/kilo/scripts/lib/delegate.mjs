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
    args: (prompt) => [prompt],
    shell: false,
    stdin: false,
    description: "agy <prompt> (positional)"
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

/**
 * Invoke a CLI binary directly as a fallback when the companion is a stub.
 */
export function invokeDirect(agent, prompt, cwd, options = {}) {
  const spec = DIRECT_INVOCATION[agent];
  if (!spec) {
    throw new Error(`No direct invocation defined for agent "${agent}".`);
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const rawArgs = spec.args(prompt, cwd);
  const useShell = process.platform === "win32" && spec.shell;
  const args = useShell ? rawArgs.map(quoteForShell) : rawArgs;

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
 * Detect whether a companion script is a stub (returns its error output as
 * a hint to fall back to direct invocation).
 */
export function isStubError(stderr, stdout) {
  const combined = `${stderr}\n${stdout}`;
  return /is a stub|not implemented|is not implemented|implement `?`?scripts?\//i.test(combined);
}