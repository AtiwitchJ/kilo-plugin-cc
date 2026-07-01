import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");

test("marketplace.json exists and is valid JSON", () => {
  const raw = fs.readFileSync(MARKETPLACE, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.name, "agents-plugin-cc-kilo");
  assert.ok(Array.isArray(parsed.plugins));
  assert.equal(parsed.plugins.length, 1);
  assert.equal(parsed.plugins[0].name, "kilo");
});

test("marketplace.json entry has matching source dir and plugin.json", () => {
  const parsed = JSON.parse(fs.readFileSync(MARKETPLACE, "utf8"));
  const entry = parsed.plugins[0];
  const source = path.join(ROOT, entry.source);
  assert.ok(fs.existsSync(source), `Missing source: ${source}`);
  const pluginFile = path.join(source, ".claude-plugin", "plugin.json");
  assert.ok(fs.existsSync(pluginFile), `Missing plugin.json: ${pluginFile}`);
  const json = JSON.parse(fs.readFileSync(pluginFile, "utf8"));
  assert.equal(json.name, "kilo");
  assert.equal(json.version, entry.version);
});

test("every command file exists", () => {
  const expected = ["setup", "review", "adversarial-review", "rescue", "status", "result", "cancel", "transfer"];
  const cmdDir = path.join(ROOT, "plugins", "kilo", "commands");
  for (const name of expected) {
    assert.ok(fs.existsSync(path.join(cmdDir, `${name}.md`)), `Missing command: ${name}.md`);
  }
});

test("rescue subagent exists", () => {
  const agentFile = path.join(ROOT, "plugins", "kilo", "agents", "kilo-rescue.md");
  assert.ok(fs.existsSync(agentFile), `Missing agent: ${agentFile}`);
});