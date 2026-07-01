---
name: kilo-result-handling
description: How to render the result of a Kilo run for the user.
---

# Kilo result handling

When `kilo-companion` finishes a foreground run, it returns a rendered Markdown
report. Background jobs are stored under `~/.kilo-companion/<workspace-hash>/jobs/`
and replayed verbatim by `/kilo:result`.

## Foreground output

The companion emits:

- A header line with the kind of job (`review`, `adversarial-review`, `task`,
  `transfer`).
- The Kilo session id so the user can resume manually with `kilo run --session <id>`.
- The Kilo assistant message, trimmed and rendered as a fenced block.
- A short summary line plus a "Next steps" hint pointing to `/kilo:status`,
  `/kilo:result`, or `/kilo:review`.

Do **not** paraphrase the assistant output. If Kilo returned an error, surface
the stderr message verbatim so the user can debug the underlying call.

## Background output

For background runs the companion only prints a short "queued" message and the
job id. The actual output is written to the job's log file. `/kilo:status`
summarizes running and recent jobs and `/kilo:result` reads the final payload
back from disk.

## Error states

- `kilo not installed` - tell the user to run `npm install -g @kilocode/cli`.
- `kilo not authenticated` - tell the user to run `!kilo auth` (or
  `!kilo providers`).
- `permission denied` - mention that `--dangerously-skip-permissions` is needed
  for write-capable rescue runs.
- `unknown session id` - the companion could not parse a session id from the
  JSON stream; ask the user to retry and include `--format json` if they are
  invoking `kilo` manually.