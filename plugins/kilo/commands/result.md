---
description: Show the stored final output for a finished Kilo job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kilo-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it. Preserve all details including:
- Job ID and status
- The complete Kilo output, including any session id so the user can resume manually
- File paths and line numbers exactly as reported
- Any error messages or parse errors
- Follow-up commands such as `/kilo:status <id>` and `/kilo:review`