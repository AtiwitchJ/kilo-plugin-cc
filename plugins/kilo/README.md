# Kilo plugin for Claude Code

Use [Kilo](https://kilo.ai) from inside Claude Code for code reviews or to delegate tasks.

This plugin is for Claude Code users who want an easy way to start using Kilo from the workflow
they already have.

> Part of the [agents-plugin-cc](../README.md) collection, alongside plugins for OpenCode,
> Antigravity, Cursor agent, and Hermes.

## What You Get

- `/kilo:review` for a normal read-only Kilo review
- `/kilo:adversarial-review` for a steerable challenge review
- `/kilo:rescue`, `/kilo:transfer`, `/kilo:status`, `/kilo:result`, and `/kilo:cancel` to delegate work, hand off sessions, and manage background jobs
- `/kilo:setup` to verify the Kilo CLI and authentication

## Requirements

- **Kilo account** (API key or hosted login). The companion calls the local `kilo` binary,
  so it uses whichever authentication method you already configured.
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add <your-org>/agents-plugin-cc
```

Install the plugin:

```bash
/plugin install kilo@agents-plugin-cc
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/kilo:setup
```

`/kilo:setup` will tell you whether Kilo is ready. If Kilo is missing and npm is available,
it can offer to install Kilo for you.

If you prefer to install Kilo yourself, use:

```bash
npm install -g @kilocode/cli
```

If Kilo is installed but not logged in yet, run:

```bash
!kilo auth
```

After install, you should see:

- the slash commands listed below
- the `kilo:kilo-rescue` subagent in `/agents`

A first run:

```bash
/kilo:review --background
/kilo:status
/kilo:result
```

## Usage

### `/kilo:review`

Runs a normal Kilo review on your current work. The companion sends the working-tree (or
`--base <ref>`) diff to Kilo with read-only semantics and returns Kilo's output verbatim.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Examples:

```bash
/kilo:review
/kilo:review --base main
/kilo:review --background
```

This command is read-only and will not perform any changes.

### `/kilo:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design. It uses
the same review target selection as `/kilo:review` and additionally accepts free-form
focus text after the flags.

Examples:

```bash
/kilo:adversarial-review
/kilo:adversarial-review --base main challenge whether this was the right caching and retry design
/kilo:adversarial-review --background look for race conditions
```

### `/kilo:rescue`

Hands a task to Kilo through the `kilo:kilo-rescue` subagent.

It supports `--background`, `--wait`, `--resume`, `--fresh`, `--model <provider/model>`,
`--agent <name>`, and `--variant <effort>`.

Examples:

```bash
/kilo:rescue investigate why the tests started failing
/kilo:rescue fix the failing test with the smallest safe patch
/kilo:rescue --resume apply the top fix from the last run
/kilo:rescue --model openai/gpt-5 --variant high investigate the flaky integration test
/kilo:rescue --agent coder --background investigate the regression
```

### `/kilo:transfer`

Imports the current Claude Code session into a fresh Kilo session and prints a
`kilo run --session <session-id>` command.

Examples:

```bash
/kilo:transfer
/kilo:transfer --source ~/.claude/projects/-Users-me-repo/<session-id>.jsonl
```

### `/kilo:status`

Shows running and recent Kilo jobs for the current repository.

```bash
/kilo:status
/kilo:status task-abc123
```

### `/kilo:result`

Shows the stored final Kilo output for a finished job. When available it includes the
Kilo session id so you can resume manually with `kilo run --session <id>`.

```bash
/kilo:result
/kilo:result task-abc123
```

### `/kilo:cancel`

Cancels an active background Kilo job.

```bash
/kilo:cancel
/kilo:cancel task-abc123
```

### `/kilo:setup`

Checks whether the local Kilo CLI is installed and authenticated. If Kilo is missing
and npm is available, it can offer to install Kilo for you.

## Architecture

The companion is a small Node.js dispatcher (`plugins/kilo/scripts/kilo-companion.mjs`)
that shells out to the local `kilo` binary:

- **Reviews**: `kilo run --format json "<review prompt>"`
- **Tasks**: `kilo run --format json [--dangerously-skip-permissions] "<task>"`
- **Resumes**: `kilo run --session <id> --format json "..."`
- **Status**: read state files under `~/.kilo-companion/<workspace-hash>/jobs/`

The companion parses Kilo's JSON event stream (with `--format json`) to capture the
session id, assistant text, and error events. Job state lives in
`${CLAUDE_PLUGIN_DATA:-<tmp>}/kilo-companion/<workspace-hash>/`.

## Related Plugins

- `opencode-plugin-cc` - OpenCode CLI wrapper
- `antigravity-plugin-cc` - Antigravity CLI wrapper
- `cursor-plugin-cc` - Cursor `agent` CLI wrapper
- `hermes-plugin-cc` - Hermes Agent wrapper

## License

Apache-2.0