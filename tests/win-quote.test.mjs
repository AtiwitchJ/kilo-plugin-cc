import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { buildWindowsShellCommandLine } from "../plugins/kilo/scripts/lib/win-quote.mjs";

test("buildWindowsShellCommandLine: wraps each token in quotes, joined by spaces", () => {
  const line = buildWindowsShellCommandLine("kilo", ["run", "hello world"]);
  assert.equal(line, '^"kilo^" ^"run^" ^"hello world^"');
});

test("buildWindowsShellCommandLine: handles an empty args array", () => {
  assert.equal(buildWindowsShellCommandLine("kilo"), '^"kilo^"');
});

// Round-trip the escaped command line through a real cmd.exe shell and
// confirm the child process receives each argument back byte-for-byte.
// Windows-only: cmd.exe-specific quoting has no POSIX equivalent to test.
test("buildWindowsShellCommandLine: round-trips adversarial args through a real shell", { skip: os.platform() !== "win32" }, async () => {
  const echoScript = path.join(os.tmpdir(), `win-quote-echo-${process.pid}.mjs`);
  fs.writeFileSync(echoScript, "console.log(JSON.stringify(process.argv.slice(2)));\n");

  const cases = [
    ["simple"],
    ["multi", "word", "args"],
    ["Reply with exactly: OK, done! (thanks)"],
    ['has a "quote" inside'],
    ["trailing backslash\\"],
    ["path\\like\\this\\"],
    ["ampersand & pipe | redirect > less <"],
    ["percent %VAR% sign"],
    ["caret ^ character"],
    [""],
    ["& calc.exe"],
    ['" & calc.exe & "']
  ];

  try {
    for (const args of cases) {
      const commandLine = buildWindowsShellCommandLine("node", [echoScript, ...args]);
      const actual = await new Promise((resolve, reject) => {
        const child = spawn(commandLine, { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.on("error", reject);
        child.on("close", () => {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (err) {
            reject(new Error(`could not parse child stdout: ${stdout}`));
          }
        });
      });
      assert.deepEqual(actual, args, `round-trip failed for ${JSON.stringify(args)}`);
    }
  } finally {
    fs.rmSync(echoScript, { force: true });
  }
});
