---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the Kilo rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <provider/model>] [--agent <name>] [--variant <effort>] [what Kilo should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `kilo:kilo-rescue` subagent via the `Agent` tool (`subagent_type: "kilo:kilo-rescue"`), forwarding the raw user request as the prompt.
`kilo:kilo-rescue` is a subagent, not a skill — do not call `Skill(kilo:kilo-rescue)` (no such skill) or `Skill(kilo:rescue)` (that re-enters this command and hangs the session).
The final user-visible response must be Kilo's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `kilo:kilo-rescue` subagent in the background.
- If the request includes `--wait`, run the `kilo:kilo-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model`, `--agent`, and `--variant` are runtime-selection flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- If the request includes `--resume`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Kilo, check for a resumable task thread from this Claude session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kilo-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current Kilo thread or start a new one.
- The two choices must be:
  - `Continue current Kilo thread`
  - `Start a new Kilo thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Kilo thread (Recommended)` first.
- Otherwise put `Start a new Kilo thread (Recommended)` first.
- If the user chooses continue, add `--resume` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/kilo-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Kilo companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/kilo:status`, fetch `/kilo:result`, call `/kilo:cancel`, summarize output, or do follow-up work of its own.
- Leave `--variant` unset unless the user explicitly asks for a specific reasoning effort.
- Leave `--model` unset unless the user explicitly asks for one.
- Leave `--agent` unset unless the user explicitly asks for a specific agent.
- Leave `--resume` and `--fresh` in the forwarded request. The subagent handles that routing when it builds the `task` command.
- If the helper reports that Kilo is missing or unauthenticated, stop and tell the user to run `/kilo:setup`.
- If the user did not supply a request, ask what Kilo should investigate or fix.