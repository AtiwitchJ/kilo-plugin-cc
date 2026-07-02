import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLUGIN_ROOT = path.join(ROOT, "plugins", "kilo");
const MANIFEST = path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
const MARKETPLACE = path.join(ROOT, ".agents", "plugins", "marketplace.json");
const FORBIDDEN_HOST_TERMS = /CLAUDE_PLUGIN_ROOT|AskUserQuestion|allowed-tools/;

test("codex plugin manifest exists and is host-neutral", () => {
  const raw = fs.readFileSync(MANIFEST, "utf8");
  assert.doesNotMatch(raw, FORBIDDEN_HOST_TERMS);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.name, "kilo");
  assert.equal(parsed.version, "0.1.0");
  assert.equal(parsed.skills, "./skills/");
  assert.equal(parsed.author.name, "agents-plugin-cc");
  assert.equal(parsed.interface.displayName, "Kilo");
  assert.ok(parsed.interface.defaultPrompt.length > 0);
});

test("codex marketplace entry points at the plugin source", () => {
  const parsed = JSON.parse(fs.readFileSync(MARKETPLACE, "utf8"));
  assert.equal(parsed.name, "agents-plugin-cc-kilo");
  const entry = parsed.plugins.find((plugin) => plugin.name === "kilo");
  assert.ok(entry, "Missing kilo entry");
  assert.equal(entry.source.source, "local");
  assert.equal(entry.source.path, "./plugins/kilo");
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.equal(entry.category, "Productivity");
});
