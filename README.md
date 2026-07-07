# Kilo plugin for Claude Code and Codex

This plugin is for Claude Code and Codex users who want to delegate code reviews or tasks to the
**Kilo CLI** (`kilo`) — Kilo Code's autonomous coding agent. It's also the **reference
implementation** other plugins in this family (`claude-plugin-cc`, `openclaw-plugin-cc`,
`opencode-plugin-cc`, `antigravity-plugin-cc`, `cursor-plugin-cc`, `hermes-plugin-cc`,
`jules-plugin-cc`) are scaffolded from or point back to.

## What You Get

- `/kilo:review` for a normal read-only review
- `/kilo:adversarial-review` for a steerable challenge review
- `/kilo:rescue` to delegate investigation, a fix request, or follow-up work (runs `task`)
- `/kilo:transfer` to import the current Claude Code session as a resumable Kilo session
- `/kilo:status`, `/kilo:result`, and `/kilo:cancel` to track background jobs
- `/kilo:setup` to verify the CLI and authentication

## Requirements

- **`kilo` CLI** installed: `npm install -g @kilocode/cli`
- Authentication: run `kilo auth` (or `kilo providers`) once
- **Node.js 18.18 or later**

## Installing the scaffold

```bash
/plugin marketplace add <your-org>/kilo-plugin-cc
/plugin install kilo@agents-plugin-cc-kilo
```

## Cross-agent delegation

Every `task` command accepts `--delegate-to=<agent>` to route the prompt through
another plugin's companion script instead of `kilo` (e.g.
`/kilo:rescue --delegate-to=claude fix the login bug`). Behavior:

1. If the target agent's companion is fully implemented, its output is returned as-is.
2. If the target's companion is a stub, `kilo-companion.mjs` automatically falls back to
   invoking that agent's CLI binary directly (see `DIRECT_INVOCATION` in
   `scripts/lib/delegate.mjs`).

Extra flags that apply to the fallback path:

- `--prompt=<text>` — pass the prompt unambiguously instead of relying on trailing
  positional args (recommended when the prompt contains flag-like tokens).
- `--timeout=<ms>` — override the default 60s fallback timeout for a single call.
  You can also set the `CLAUDE_PLUGIN_DELEGATE_TIMEOUT_MS` environment variable to
  change the default for every delegated call.
- `--background` — when the fallback triggers, the target CLI is spawned detached and
  the command returns immediately with a PID and log file path instead of blocking.

## Reference

`plugins/kilo/scripts/lib/delegate.mjs` and `render.mjs` are intentionally duplicated
byte-for-byte into `claude-plugin-cc` and `openclaw-plugin-cc` (see
`plugins/kilo/scripts/lib/kilo.mjs` for the pattern other agent wrappers follow). If you
change the shared delegation logic here, mirror the change in those two repos.

## License

Apache-2.0
