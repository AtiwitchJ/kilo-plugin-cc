import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

export function gitStatusShort(cwd) {
  try {
    return runGit(["status", "--short", "--untracked-files=all"], cwd).trim();
  } catch {
    return "";
  }
}

export function gitDiffShortstat(cwd, args = []) {
  try {
    return runGit(["diff", "--shortstat", ...args], cwd).trim();
  } catch {
    return "";
  }
}

export function gitDiffNameOnly(cwd, args = []) {
  try {
    return runGit(["diff", "--name-only", ...args], cwd)
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function gitCurrentBranch(cwd) {
  try {
    return runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
  } catch {
    return "HEAD";
  }
}

export function gitHeadCommit(cwd) {
  try {
    return runGit(["rev-parse", "HEAD"], cwd).trim();
  } catch {
    return "";
  }
}

/**
 * Resolve what to review: working-tree (default), staged/unstaged, or branch.
 *
 * Returns:
 *   { mode: "working-tree", label: "current uncommitted changes" }
 *   { mode: "branch", baseRef: string, label: string }
 */
export function resolveReviewTarget(cwd, options = {}) {
  const scope = options.scope ?? "auto";
  const base = options.base ? String(options.base).trim() : "";

  if (scope === "branch" || base) {
    if (!base) {
      throw new Error("`--scope branch` requires `--base <ref>`.");
    }
    return {
      mode: "branch",
      baseRef: base,
      label: `branch changes vs ${base}`
    };
  }

  if (scope === "working-tree") {
    return { mode: "working-tree", label: "current uncommitted changes" };
  }

  return { mode: "working-tree", label: "current uncommitted changes" };
}

/**
 * Build a textual review context (file list + diff snippets) for LLM consumption.
 * Used by adversarial reviews where kilo needs the actual diff as part of the prompt.
 */
export function ensureGitRepository(cwd) {
  if (!isGitRepository(cwd)) {
    throw new Error("This command must be run from inside a git repository.");
  }
}

function isGitRepository(cwd) {
  try {
    return fs.existsSync(path.join(resolveWorkspaceRoot(cwd), ".git"));
  } catch {
    return false;
  }
}

export { isGitRepository };

export function collectReviewContext(cwd, target) {
  const repoRoot = resolveWorkspaceRoot(cwd);
  const branch = gitCurrentBranch(repoRoot);
  const headCommit = gitHeadCommit(repoRoot);

  let diffText = "";
  let fileList = [];

  if (target.mode === "branch") {
    fileList = gitDiffNameOnly(repoRoot, [target.baseRef, "HEAD"]);
    diffText = runGit(["diff", target.baseRef + "...HEAD"], repoRoot);
  } else {
    fileList = [
      ...gitDiffNameOnly(repoRoot, ["--cached"]),
      ...gitDiffNameOnly(repoRoot, [])
    ];
    const staged = runGit(["diff", "--cached"], repoRoot);
    const unstaged = runGit(["diff"], repoRoot);
    diffText = [staged, unstaged].filter(Boolean).join("\n\n");
  }

  const untrackedOutput = runGit(
    ["ls-files", "--others", "--exclude-standard"],
    repoRoot
  );
  const untracked = untrackedOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((rel) => path.join(repoRoot, rel));

  const summaryLines = [
    `Repo root: ${repoRoot}`,
    `Branch: ${branch}`,
    `Head commit: ${headCommit || "(none)"}`,
    `Target: ${target.label}`,
    `Files in diff: ${fileList.length}`,
    `Untracked files: ${untracked.length}`
  ];

  return {
    repoRoot,
    branch,
    headCommit,
    target,
    fileList,
    untracked,
    summary: summaryLines.join("\n"),
    content: diffText.slice(0, 200_000),
    collectionGuidance: target.mode === "branch"
      ? `Review the diff between ${target.baseRef} and HEAD.`
      : "Review the staged + unstaged changes in the working tree."
  };
}