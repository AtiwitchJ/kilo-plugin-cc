#!/usr/bin/env node
/**
 * kilo-companion - command-line dispatcher for the Kilo plugin.
 *
 * Mirrors the structure of codex-companion but is simpler: kilo is a
 * straightforward `kilo run [flags] "<prompt>"` CLI with `--format json`
 * for structured output. There is no JSON-RPC app server.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  binaryAvailable,
  runCommand,
  spawnDetached
} from "./lib/process.mjs";
import {
  collectReviewContext,
  ensureGitRepository,
  resolveReviewTarget
} from "./lib/git.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  buildKiloArgs,
  ensureKiloAvailable,
  findLatestResumableSession,
  getKiloAuthStatus,
  getKiloAvailability,
  runKilo
} from "./lib/kilo.mjs";
import { DEFAULT_CONTINUE_PROMPT } from "./lib/tracked-jobs.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  runTrackedJob
} from "./lib/tracked-jobs.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Known companion scripts for cross-agent delegation. */
const KNOWN_COMPANIONS = {
  kilo: "kilo-plugin-cc",
  claude: "claude-plugin-cc",
  openclaw: "openclaw-plugin-cc",
  opencode: "opencode-plugin-cc",
  antigravity: "antigravity-plugin-cc",
  cursor: "cursor-plugin-cc",
  hermes: "hermes-plugin-cc",
  jules: "jules-plugin-cc"
};

function resolveCompanionScript(agent) {
  const repo = KNOWN_COMPANIONS[agent];
  if (!repo) {
    throw new Error(`Unknown agent "${agent}". Known: ${Object.keys(KNOWN_COMPANIONS).join(", ")}`);
  }
  const candidates = [
    path.join("D:\\mind", repo, "plugins", agent, "scripts", `${agent}-companion.mjs`),
    path.join(process.cwd(), "..", repo, "plugins", agent, "scripts", `${agent}-companion.mjs`),
    path.resolve(ROOT_DIR, "..", "..", "..", "..", repo, "plugins", agent, "scripts", `${agent}-companion.mjs`)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${agent}-companion.mjs. Tried:\n  ${candidates.join("\n  ")}`
  );
}

function delegateToAgent(agent, argv) {
  const script = resolveCompanionScript(agent);
  const result = spawnSync(process.execPath, [script, ...argv], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd()
  });
  if (typeof result.status === "number") process.exit(result.status);
  process.exit(result.error ? 1 : 0);
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/kilo-companion.mjs setup [--json]",
      "  node scripts/kilo-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <provider/model>] [--agent <name>] [--variant <effort>]",
      "  node scripts/kilo-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <provider/model>] [focus text]",
      "  node scripts/kilo-companion.mjs task [--background] [--write] [--resume|--fresh] [--model <provider/model>] [--agent <name>] [--variant <effort>] [--delegate-to=<agent>] [prompt]",
      "  node scripts/kilo-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/kilo-companion.mjs result [job-id] [--json]",
      "  node scripts/kilo-companion.mjs cancel [job-id] [--json]",
      "  node scripts/kilo-companion.mjs transfer [--source <claude-jsonl>] [--json]",
      "  node scripts/kilo-companion.mjs task-resume-candidate [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(typeof value === "string" ? value : `${value}\n`);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), { ...config });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }
  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

function requireTaskRequest(prompt, resume) {
  if (!prompt && !resume) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume.");
  }
}

function buildReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
}

function buildNativeReviewPrompt(context) {
  return [
    "You are running in read-only review mode. Do not modify any files.",
    `Review target: ${context.target.label}`,
    "Repository context:",
    context.summary,
    "",
    "Provide a thorough code review of the changes. Return your findings as Markdown.",
    "",
    "Diff:",
    context.content
  ].join("\n");
}

function createCompanionJob({ prefix, kind, kindLabel, title, workspaceRoot, jobClass, summary, write = false, request = null, logFile = null }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel,
    title,
    workspaceRoot,
    jobClass,
    summary,
    write,
    request,
    logFile
  });
}

function buildTaskJobMetadata({ prompt, resume }) {
  if (resume) {
    return {
      title: "Kilo Resume",
      summary: shorten(prompt || DEFAULT_CONTINUE_PROMPT, 80)
    };
  }
  return {
    title: "Kilo Task",
    summary: shorten(prompt || "Task", 80)
  };
}

async function executeReviewRun({ cwd, base, scope, focusText, model, agent, variant, reviewName, onProgress, logFile }) {
  ensureKiloAvailable(cwd);
  ensureGitRepository(cwd);

  const target = resolveReviewTarget(cwd, { base, scope });
  const context = collectReviewContext(cwd, target);

  const prompt =
    reviewName === "Adversarial Review"
      ? buildReviewPrompt(context, focusText)
      : buildNativeReviewPrompt(context);

  const result = await runKilo(cwd, {
    prompt,
    model: model ?? null,
    agent: agent ?? null,
    variant: variant ?? null,
    write: false,
    title: `Review: ${target.label}`.slice(0, 80),
    onProgress,
    logFile
  });

  return {
    exitStatus: result.status,
    sessionId: result.sessionId,
    payload: {
      review: reviewName,
      target,
      kilo: {
        status: result.status,
        stderr: result.stderr,
        text: result.text,
        error: result.error
      }
    },
    rendered: renderReviewResult(result.text, {
      reviewLabel: reviewName,
      targetLabel: target.label,
      sessionId: result.sessionId
    }),
    summary: firstMeaningfulLine(result.text, `${reviewName} finished.`),
    jobTitle: `Kilo ${reviewName}`,
    jobClass: "review"
  };
}

async function executeTaskRun({ cwd, model, agent, variant, prompt, write, resume, jobId, onProgress, logFile }) {
  ensureKiloAvailable(cwd);

  let sessionId = null;
  let effectiveResume = Boolean(resume);
  if (effectiveResume) {
    const latest = await findLatestResumableSession(cwd);
    if (!latest) {
      throw new Error("No previous Kilo session was found for this repository.");
    }
    sessionId = latest.id;
  }

  if (!prompt && !sessionId) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume.");
  }

  const result = await runKilo(cwd, {
    prompt,
    defaultPrompt: sessionId ? DEFAULT_CONTINUE_PROMPT : "",
    model: model ?? null,
    agent: agent ?? null,
    variant: variant ?? null,
    write: Boolean(write),
    sessionId,
    continueLast: false,
    fork: false,
    title: shorten(prompt || `Kilo task ${new Date().toISOString()}`, 80),
    onProgress,
    logFile
  });

  const failureMessage = result.error ?? result.stderr ?? "";
  const rendered = renderTaskResult(
    {
      text: result.text,
      failureMessage,
      reasoningSummary: []
    },
    {
      title: effectiveResume ? "Kilo Resume" : "Kilo Task",
      jobId,
      write: Boolean(write)
    }
  );

  return {
    exitStatus: result.status,
    sessionId: result.sessionId ?? sessionId,
    payload: {
      status: result.status,
      sessionId: result.sessionId ?? sessionId,
      text: result.text,
      stderr: result.stderr,
      error: result.error,
      resumed: effectiveResume
    },
    rendered,
    summary: firstMeaningfulLine(result.text, firstMeaningfulLine(failureMessage, "Kilo task finished.")),
    jobTitle: effectiveResume ? "Kilo Resume" : "Kilo Task",
    jobClass: "task",
    write: Boolean(write)
  };
}

async function runForegroundCommand(job, runner, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  job.logFile = logFile;
  const progress = createProgressReporter({
    stderr: !options.json,
    logFile,
    onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
  });

  const execution = await runTrackedJob({ ...job, logFile }, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus || 1;
  }
  return execution;
}

function spawnDetachedWorker({ cwd, jobId }) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "kilo-companion.mjs");
  const child = spawnDetached(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], { cwd });
  return { pid: child.pid ?? null };
}

function enqueueBackgroundTask(cwd, job, request) {
  const logFile = createJobLogFile(job.workspaceRoot, job.id, job.title);
  appendLogLine(logFile, "Queued for background execution.");

  const { pid } = spawnDetachedWorker({ cwd, jobId: job.id });
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

function getCurrentSessionId() {
  return process.env.CLAUDE_SESSION_ID ?? null;
}

function findLatestResumableTaskJob(jobs, sessionId) {
  const visible = sessionId ? jobs.filter((job) => job.sessionId === sessionId || true) : jobs;
  return (
    visible.find(
      (job) =>
        job.jobClass === "task" &&
        (job.sessionId || job.threadId) &&
        job.status !== "queued" &&
        job.status !== "running"
    ) ?? null
  );
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const kiloStatus = getKiloAvailability(cwd);
  const authStatus = await getKiloAuthStatus(cwd);
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (!kiloStatus.available) {
    nextSteps.push("Install Kilo with `npm install -g @kilocode/cli`.");
  }
  if (kiloStatus.available && !authStatus.loggedIn) {
    nextSteps.push("Run `!kilo auth` (or `!kilo providers`).");
  }

  const report = {
    ready: nodeStatus.available && kiloStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    kilo: kiloStatus,
    auth: authStatus,
    workspaceRoot,
    config,
    nextSteps
  };

  outputResult(options.json ? report : renderSetupReport(report), options.json);
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "agent", "variant", "cwd"],
    booleanOptions: ["json", "background", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();

  const job = createCompanionJob({
    prefix: "review",
    kind: config.kind,
    kindLabel: config.kind,
    title: `Kilo ${config.reviewName}`,
    workspaceRoot,
    jobClass: "review",
    summary: `${config.reviewName} ${config.targetLabel ?? ""}`.trim()
  });

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        focusText,
        model: options.model ?? null,
        agent: options.agent ?? null,
        variant: options.variant ?? null,
        reviewName: config.reviewName,
        onProgress: progress,
        logFile: job.logFile
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Review",
    kind: "review",
    targetLabel: ""
  });
}

async function handleAdversarialReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Adversarial Review",
    kind: "adversarial-review",
    targetLabel: ""
  });
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "agent", "variant", "cwd", "prompt-file", "delegate-to"],
    booleanOptions: ["json", "write", "resume", "fresh", "background"]
  });

  if (options["delegate-to"]) {
    const agent = String(options["delegate-to"]);
    const subcommand = process.argv[2];
    const remaining = process.argv.slice(3).filter((arg) => !arg.startsWith("--delegate-to=") && arg !== "--delegate-to");
    delegateToAgent(agent, [subcommand, ...remaining]);
    return;
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const resume = Boolean(options.resume);
  const fresh = Boolean(options.fresh);
  if (resume && fresh) {
    throw new Error("Choose either --resume or --fresh.");
  }

  const prompt = readTaskPrompt(cwd, options, positionals);
  const write = Boolean(options.write);
  const metadata = buildTaskJobMetadata({ prompt, resume });

  if (options.background) {
    ensureKiloAvailable(cwd);
    requireTaskRequest(prompt, resume);

    const job = createCompanionJob({
      prefix: "task",
      kind: "task",
      kindLabel: "task",
      title: metadata.title,
      workspaceRoot,
      jobClass: "task",
      summary: metadata.summary,
      write,
      request: {
        cwd,
        prompt,
        model: options.model ?? null,
        agent: options.agent ?? null,
        variant: options.variant ?? null,
        write,
        resume,
        jobId: null
      }
    });

    const { payload } = enqueueBackgroundTask(cwd, job, job.request);
    outputCommandResult(payload, `Kilo task queued as ${payload.jobId}.\n`, options.json);
    return;
  }

  const job = createCompanionJob({
    prefix: "task",
    kind: "task",
    kindLabel: "task",
    title: metadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: metadata.summary,
    write
  });

  await runForegroundCommand(
    job,
    (progress) =>
      executeTaskRun({
        cwd,
        prompt,
        model: options.model ?? null,
        agent: options.agent ?? null,
        variant: options.variant ?? null,
        write,
        resume,
        jobId: job.id,
        onProgress: progress,
        logFile: job.logFile
      }),
    { json: options.json }
  );
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for task-worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(cwd, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }

  const logFile = storedJob.logFile ?? createJobLogFile(workspaceRoot, storedJob.id, storedJob.title);
  const progress = createProgressReporter({
    stderr: false,
    logFile,
    onEvent: createJobProgressUpdater(workspaceRoot, storedJob.id)
  });

  await runTrackedJob(
    { ...storedJob, workspaceRoot, logFile },
    () =>
      executeTaskRun({
        ...request,
        jobId: storedJob.id,
        onProgress: progress,
        logFile
      }),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "all"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  outputCommandResult({ job, storedJob }, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentSessionId();
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const candidate = findLatestResumableTaskJob(jobs, sessionId);

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate: candidate
      ? {
          id: candidate.id,
          status: candidate.status,
          title: candidate.title ?? null,
          summary: candidate.summary ?? null,
          sessionId: candidate.sessionId ?? candidate.threadId ?? null,
          completedAt: candidate.completedAt ?? null,
          updatedAt: candidate.updatedAt ?? null
        }
      : null
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  const completedAt = new Date().toISOString();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  appendLogLine(job.logFile, "Cancelled by user.");

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

async function handleTransfer(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "source"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const sourcePath = options.source
    ? path.resolve(cwd, options.source)
    : resolveClaudeSessionPath(cwd);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Claude session not found at ${sourcePath}.`);
  }

  const result = await runKilo(cwd, {
    prompt: `Import this Claude Code session as a kilo session and reply with a one-line acknowledgement. Source: ${sourcePath}`,
    title: "Transfer Claude session",
    agent: "architect"
  });

  const sessionId = result.sessionId ?? "unknown";
  const resumeCommand = `kilo run --session ${sessionId}`;

  const payload = {
    sessionId,
    resumeCommand,
    sourcePath
  };

  const rendered =
    `# Kilo transfer\n` +
    `- Kilo session ID: \`${sessionId}\`\n` +
    `- Resume: \`${resumeCommand}\`\n` +
    `- Source: \`${sourcePath}\`\n` +
    (result.text ? `\n${result.text}\n` : "");

  outputCommandResult(payload, rendered, options.json);
}

function resolveClaudeSessionPath(cwd) {
  const claudeProjects = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude", "projects");
  if (!fs.existsSync(claudeProjects)) {
    throw new Error("No ~/.claude/projects directory found.");
  }
  const entries = fs
    .readdirSync(claudeProjects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: path.join(claudeProjects, entry.name),
      mtime: fs.statSync(path.join(claudeProjects, entry.name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) {
    throw new Error("No Claude session directories found under ~/.claude/projects.");
  }
  const files = fs
    .readdirSync(entries[0].path)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      path: path.join(entries[0].path, name),
      mtime: fs.statSync(path.join(entries[0].path, name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    throw new Error("No .jsonl Claude session transcripts found.");
  }
  return files[0].path;
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleAdversarialReview(argv);
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    case "transfer":
      await handleTransfer(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});