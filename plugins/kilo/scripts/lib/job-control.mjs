import fs from "node:fs";

import {
  ensureStateDir,
  resolveJobFile,
  resolveStateFile,
  resolveJobsDir,
  listJobs
} from "./state.mjs";

function findJob(jobs, reference) {
  if (!reference) {
    return jobs[0] ?? null;
  }
  return (
    jobs.find((job) => job.id === reference) ??
    jobs.find((job) => job.threadId === reference) ??
    jobs.find((job) => job.sessionId === reference) ??
    null
  );
}

export function buildSingleJobSnapshot(cwd, reference) {
  const jobs = listJobs(cwd);
  const job = findJob(jobs, reference);
  if (!job) {
    throw new Error(`No job found matching "${reference}".`);
  }
  const stored = readStoredJob(cwd, job.id);
  return { job, stored };
}

export function buildStatusSnapshot(cwd, options = {}) {
  const all = listJobs(cwd);
  const filtered = options.all ? all : all.slice(0, 20);
  return {
    jobs: filtered.map((job) => ({
      id: job.id,
      kindLabel: job.kindLabel ?? job.kind ?? "job",
      status: job.status,
      phase: job.phase ?? null,
      title: job.title ?? null,
      summary: job.summary ?? null,
      createdAt: job.createdAt ?? null,
      updatedAt: job.updatedAt ?? null,
      completedAt: job.completedAt ?? null
    }))
  };
}

export function resolveResultJob(cwd, reference) {
  const snapshot = buildSingleJobSnapshot(cwd, reference);
  if (snapshot.job.status === "running" || snapshot.job.status === "queued") {
    throw new Error(`Job ${snapshot.job.id} is still ${snapshot.job.status}.`);
  }
  return { workspaceRoot: snapshot.job.workspaceRoot, job: snapshot.job };
}

export function resolveCancelableJob(cwd, reference, _options = {}) {
  const snapshot = buildSingleJobSnapshot(cwd, reference);
  if (snapshot.job.status !== "running" && snapshot.job.status !== "queued") {
    throw new Error(`Job ${snapshot.job.id} is not running.`);
  }
  return { workspaceRoot: snapshot.job.workspaceRoot, job: snapshot.job };
}

export function readStoredJob(cwd, jobId) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(jobFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
  );
}

export { resolveStateFile, resolveJobsDir };