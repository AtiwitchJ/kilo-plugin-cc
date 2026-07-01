import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../plugins/kilo/scripts/lib/args.mjs";

test("parseArgs: handles --key value", () => {
  const { options, positionals } = parseArgs(["--base", "main", "focus"], {
    valueOptions: ["base"]
  });
  assert.equal(options.base, "main");
  assert.deepEqual(positionals, ["focus"]);
});

test("parseArgs: handles --key=value", () => {
  const { options } = parseArgs(["--model=openai/gpt-5"], {
    valueOptions: ["model"]
  });
  assert.equal(options.model, "openai/gpt-5");
});

test("parseArgs: handles --boolean flag", () => {
  const { options } = parseArgs(["--background"], {
    booleanOptions: ["background"]
  });
  assert.equal(options.background, true);
});

test("parseArgs: aliases short options", () => {
  const { options } = parseArgs(["-m", "openai/gpt-5"], {
    valueOptions: ["model"],
    aliasMap: { m: "model" }
  });
  assert.equal(options.model, "openai/gpt-5");
});

test("parseArgs: separates positionals", () => {
  const { options, positionals } = parseArgs(
    ["review", "--background", "--base", "main", "extra"],
    { valueOptions: ["base"], booleanOptions: ["background"] }
  );
  assert.equal(options.background, true);
  assert.equal(options.base, "main");
  assert.deepEqual(positionals, ["review", "extra"]);
});

test("splitRawArgumentString: handles quoted spaces", () => {
  const tokens = splitRawArgumentString('--base main "extra focus text"');
  assert.deepEqual(tokens, ["--base", "main", "extra focus text"]);
});

test("splitRawArgumentString: returns empty for empty input", () => {
  assert.deepEqual(splitRawArgumentString(""), []);
  assert.deepEqual(splitRawArgumentString("   "), []);
});