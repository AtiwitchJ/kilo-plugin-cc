import fs from "node:fs";
import path from "node:path";

/**
 * Walk up the directory tree looking for the nearest git repository root.
 * Returns the original `cwd` if no git root is found.
 */
export function resolveWorkspaceRoot(cwd) {
  const start = path.resolve(cwd);
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

export function isGitRepository(cwd) {
  try {
    const resolved = resolveWorkspaceRoot(cwd);
    return fs.existsSync(path.join(resolved, ".git"));
  } catch {
    return false;
  }
}

export function ensureGitRepository(cwd) {
  if (!isGitRepository(cwd)) {
    throw new Error("This command must be run from inside a git repository.");
  }
}