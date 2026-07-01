const HORIZONTAL_RULE = "---";

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function fenceBlock(text, language = "") {
  const trimmed = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return `\`\`\`${language}\n(empty)\n\`\`\``;
  }
  return `\`\`\`${language}\n${trimmed}\n\`\`\``;
}

function renderJobHeader(job) {
  const lines = [`# ${job.title ?? "Kilo job"}`];
  if (job.id) lines.push(`- Job ID: \`${job.id}\``);
  if (job.sessionId) lines.push(`- Kilo session ID: \`${job.sessionId}\``);
  if (job.summary) lines.push(`- Summary: ${shorten(job.summary, 160)}`);
  if (job.status) lines.push(`- Status: \`${job.status}\``);
  if (job.phase) lines.push(`- Phase: \`${job.phase}\``);
  return lines.join("\n");
}

export function renderTaskResult({ text, failureMessage, reasoningSummary }, { title, jobId = null, write = false } = {}) {
  const lines = [
    `# ${title ?? "Kilo task"}`,
    jobId ? `- Job ID: \`${jobId}\`` : null,
    `- Write-enabled: ${write ? "yes" : "no"}`
  ].filter(Boolean);

  if (failureMessage) {
    lines.push("", "## Error", fenceBlock(failureMessage));
  }

  if (text) {
    lines.push("", "## Kilo output", fenceBlock(text));
  } else if (!failureMessage) {
    lines.push("", "## Kilo output", "_(no output captured)_");
  }

  return `${lines.join("\n")}\n`;
}

export function renderReviewResult(text, { reviewLabel = "Review", targetLabel = "working tree", sessionId = null } = {}) {
  const lines = [
    `# ${reviewLabel}`,
    `- Target: ${targetLabel}`,
    sessionId ? `- Kilo session ID: \`${sessionId}\`` : null,
    ""
  ].filter(Boolean);

  if (text) {
    lines.push("## Kilo output", fenceBlock(text));
  } else {
    lines.push("_(no review output captured)_");
  }

  return `${lines.join("\n")}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const lines = [renderJobHeader(job)];
  if (!storedJob) {
    lines.push("", "_No stored payload for this job._");
    return `${lines.join("\n")}\n`;
  }

  const text = storedJob.text ?? storedJob.rawOutput ?? "";
  const failure = storedJob.error?.message ?? storedJob.stderr ?? storedJob.failureMessage ?? "";

  if (text) lines.push("", "## Kilo output", fenceBlock(text));
  if (failure) lines.push("", "## Stderr / error", fenceBlock(failure));
  if (!text && !failure) lines.push("", "_No payload recorded._");

  if (job.sessionId) {
    lines.push("", HORIZONTAL_RULE, `Resume in Kilo with: kilo run --session ${job.sessionId} ...`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderStatusReport(report) {
  if (!report.jobs || report.jobs.length === 0) {
    return "_No kilo jobs recorded for this repository yet._\n";
  }
  const header = [
    "# Kilo status",
    `_Showing ${report.jobs.length} job(s)._`,
    ""
  ].join("\n");

  const table = [
    "| Job ID | Kind | Status | Phase | Title | Summary |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const job of report.jobs) {
    table.push(
      `| \`${job.id}\` | ${job.kindLabel ?? "job"} | \`${job.status ?? "?"}\` | ${job.phase ?? ""} | ${shorten(job.title ?? "", 32)} | ${shorten(job.summary ?? "", 48)} |`
    );
  }
  return `${header}${table.join("\n")}\n`;
}

export function renderJobStatusReport(job) {
  return `${renderJobHeader(job)}\n`;
}

export function renderSetupReport(report) {
  const lines = [
    "# Kilo setup",
    `- Kilo CLI: ${report.kilo.available ? "ready" : "missing"} (${report.kilo.detail})`,
    `- Authentication: ${report.auth.loggedIn ? "logged in" : "not signed in"} (${report.auth.detail})`,
    `- Workspace: \`${report.workspaceRoot}\``
  ];
  if (report.nextSteps?.length) {
    lines.push("", "## Next steps");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }
  if (report.actionsTaken?.length) {
    lines.push("", "## Actions taken");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderCancelReport(job) {
  return `# Cancellation\n- Job ID: \`${job.id}\`\n- Status: \`${job.status}\`\n- Cancelled at: ${job.completedAt ?? "(unknown)"}\n`;
}

export function renderTransferResult({ threadId, resumeCommand }) {
  return [
    "# Kilo transfer",
    `Imported Claude Code session into a kilo session.`,
    `- Kilo session ID: \`${threadId}\``,
    `- Resume: \`${resumeCommand}\``
  ].join("\n") + "\n";
}