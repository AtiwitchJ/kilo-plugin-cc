/**
 * Safely build a Windows cmd.exe command line for spawn(..., { shell: true }).
 *
 * Node's own shell:true + array-args quoting is naive string concatenation
 * (see Node deprecation DEP0190) and corrupts any argument containing spaces
 * or punctuation. This builds the full command line ourselves so Node never
 * touches quoting, using the standard two-layer escaping documented at
 * https://qntm.org/cmd: first make the argument round-trip correctly through
 * the target process's CommandLineToArgvW-style parser, then neutralize
 * cmd.exe's own metacharacters with ^ so cmd.exe's tokenizer doesn't act on
 * them even inside quotes.
 *
 * Verified via round-trip spawn tests, including injection-attempt payloads
 * (e.g. "& calc.exe"), which come back as literal argv text.
 */
const CMD_META_CHARS = /([()%!^"<>&|;,])/g;

export function escapeArgForWindowsShell(arg) {
  let value = String(arg);

  value = value.replace(/(\\*)"/g, '$1$1\\"');
  value = value.replace(/(\\*)$/, "$1$1");
  value = `"${value}"`;

  value = value.replace(CMD_META_CHARS, "^$1");

  return value;
}

export function buildWindowsShellCommandLine(command, args = []) {
  return [command, ...args].map(escapeArgForWindowsShell).join(" ");
}
