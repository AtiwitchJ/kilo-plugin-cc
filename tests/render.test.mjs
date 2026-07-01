import { test } from "node:test";
import assert from "node:assert/strict";

import { renderTaskResult, renderStatusReport, renderSetupReport } from "../plugins/kilo/scripts/lib/render.mjs";

test("renderTaskResult: includes fenced kilo output", () => {
  const out = renderTaskResult(
    { text: "fixed it", failureMessage: "" },
    { title: "Kilo Task", jobId: "task-abc", write: true }
  );
  assert.match(out, /Kilo Task/);
  assert.match(out, /task-abc/);
  assert.match(out, /```\nfixed it\n```/);
  assert.match(out, /Write-enabled: yes/);
});

test("renderTaskResult: surfaces errors", () => {
  const out = renderTaskResult(
    { text: "", failureMessage: "kilo not installed" },
    { title: "Kilo Task" }
  );
  assert.match(out, /## Error/);
  assert.match(out, /kilo not installed/);
});

test("renderStatusReport: empty when no jobs", () => {
  const out = renderStatusReport({ jobs: [] });
  assert.match(out, /No kilo jobs/);
});

test("renderStatusReport: renders Markdown table", () => {
  const out = renderStatusReport({
    jobs: [
      {
        id: "task-1",
        kindLabel: "task",
        status: "completed",
        phase: "completed",
        title: "Fix bug",
        summary: "Fixed"
      }
    ]
  });
  assert.match(out, /\| Job ID \| Kind \|/);
  assert.match(out, /task-1/);
});

test("renderSetupReport: shows next steps when not ready", () => {
  const out = renderSetupReport({
    kilo: { available: false, detail: "not installed" },
    auth: { loggedIn: false, detail: "no account" },
    workspaceRoot: "/tmp/demo",
    nextSteps: ["Install Kilo"]
  });
  assert.match(out, /Kilo CLI: missing/);
  assert.match(out, /Install Kilo/);
});