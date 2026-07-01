# Changelog

## 0.1.0

- Initial scaffold for the Kilo plugin (part of `agents-plugin-cc`).
- Slash commands: `setup`, `review`, `adversarial-review`, `rescue`, `transfer`, `status`, `result`, `cancel`.
- Subagent: `kilo:kilo-rescue`.
- Background job tracking with state stored under `${CLAUDE_PLUGIN_DATA:-<tmp>}/kilo-companion/<workspace-hash>/`.
- JSON event-stream parsing via `kilo run --format json`.