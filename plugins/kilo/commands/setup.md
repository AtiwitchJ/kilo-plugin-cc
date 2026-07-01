---
description: Check whether the local Kilo CLI is ready and authenticated
argument-hint: '[]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kilo-companion.mjs" setup --json $ARGUMENTS
```

If the result says Kilo is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Kilo now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Kilo (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @kilocode/cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kilo-companion.mjs" setup --json $ARGUMENTS
```

If Kilo is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Kilo is installed but not authenticated, preserve the guidance to run `!kilo auth`.