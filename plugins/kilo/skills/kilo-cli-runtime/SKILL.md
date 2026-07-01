---
name: kilo-cli-runtime
description: Operational guidance for calling the Kilo CLI from this plugin's companion script.
---

# Kilo CLI runtime

The `kilo-companion.mjs` script in this plugin shells out to the local `kilo` binary
to do its work. This skill explains how the wrapper invokes Kilo so the companion
behaves predictably.

## Invocation shape

All task and review commands run:

```
kilo run [flags] "<prompt>"
```

The companion always passes `--format json` so it can parse structured events from
stdout. Anything written to stderr is captured into the job log and surfaced as
progress events.

## Common flags

- `--model <provider/model>` - selects a specific model
- `--agent <name>` - picks a built-in or custom agent (e.g. `coder`, `architect`)
- `--variant <effort>` - reasoning effort hint (provider-specific; e.g. `high`)
- `--thinking` - keeps thinking blocks in the output
- `--dangerously-skip-permissions` - auto-approve non-denied permissions (read+write)
- `--auto` - auto-approve all permissions (fully autonomous)
- `--continue` - continue the latest local session
- `--session <id>` - continue a specific session id
- `--fork` - fork a session before continuing
- `--title <title>` - set a custom session title
- `--format json` - emit raw JSON events on stdout (default for the companion)

## Session lifecycle

1. The companion starts a fresh session by running `kilo run --format json ...`
   without `--continue` or `--session`.
2. It reads the JSON event stream and looks for a `session_id` (or `session.id`)
   in the first few events. The id is stored on the job record.
3. To resume later, the companion invokes `kilo run --session <id> --format json ...`.
4. To fork-and-resume, the companion adds `--fork`.

## Review vs rescue

- **Reviews** run in read-only mode (`--dangerously-skip-permissions` is *not*
  passed; Kilo is expected to inspect files only).
- **Rescue tasks** add `--dangerously-skip-permissions` unless the user explicitly
  asked for read-only behavior.

## Authentication

`kilo auth` (alias `kilo providers`) manages credentials. The companion detects
authentication by running `kilo profile` and looking for a non-empty account
identifier in the output.

## Cancellation

The companion tracks the spawned child PID and uses `taskkill /T /F` (Windows)
or `SIGTERM` (POSIX) to terminate it. There is no equivalent of Codex's
`turn/interrupt` for Kilo today.