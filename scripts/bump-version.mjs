#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKETPLACE_FILE = path.join(ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_JSON_FILES = [
  path.join(ROOT, "plugins", "kilo", ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugins", "opencode", ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugins", "antigravity", ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugins", "cursor", ".claude-plugin", "plugin.json"),
  path.join(ROOT, "plugins", "hermes", ".claude-plugin", "plugin.json")
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  const [, major, minor, patch] = match.map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const kind = args.find((arg) => ["major", "minor", "patch"].includes(arg)) ?? "patch";

  const marketplace = readJson(MARKETPLACE_FILE);
  const currentVersion = marketplace.metadata?.version;
  if (!currentVersion) {
    throw new Error(`Missing metadata.version in ${MARKETPLACE_FILE}`);
  }

  const pluginEntries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const versions = new Set([currentVersion, ...pluginEntries.map((entry) => entry.version).filter(Boolean)]);

  if (checkOnly) {
    if (versions.size !== 1) {
      console.error(`Version mismatch: ${[...versions].join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Versions aligned at ${currentVersion}`);
    return;
  }

  const nextVersion = bumpVersion(currentVersion, kind);
  marketplace.metadata = { ...(marketplace.metadata ?? {}), version: nextVersion };
  for (const entry of pluginEntries) {
    entry.version = nextVersion;
  }
  writeJson(MARKETPLACE_FILE, marketplace);

  for (const pluginFile of PLUGIN_JSON_FILES) {
    if (!fs.existsSync(pluginFile)) continue;
    const data = readJson(pluginFile);
    data.version = nextVersion;
    writeJson(pluginFile, data);
  }

  console.log(`Bumped version: ${currentVersion} -> ${nextVersion}`);
}

main();