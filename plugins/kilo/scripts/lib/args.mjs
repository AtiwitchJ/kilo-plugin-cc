/**
 * Parse `process.argv`-style argument arrays into options/positionals.
 *
 * Supports `--key=value`, `--key value`, `--flag` (boolean), and grouped short flags.
 * The Codex-style parser used by `kilo-companion` is deliberately simple so we can
 * keep the helper free of third-party dependencies.
 */
export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};

  const options = {};
  const positionals = [];

  const takeValue = (key, raw) => {
    if (valueOptions.has(key) || aliasMap[key]) {
      options[aliasMap[key] ?? key] = raw;
      return true;
    }
    if (booleanOptions.has(key)) {
      options[key] = true;
      return true;
    }
    if (raw === "true" || raw === "false") {
      options[key] = raw === "true";
      return true;
    }
    options[key] = raw;
    return true;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") continue;

    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        const key = body.slice(0, eq);
        const value = body.slice(eq + 1);
        takeValue(key, value);
        continue;
      }
      const next = argv[i + 1];
      const looksLikeValue = typeof next === "string" && !next.startsWith("-");
      if (looksLikeValue && (valueOptions.has(body) || aliasMap[body])) {
        takeValue(body, next);
        i += 1;
        continue;
      }
      takeValue(body, "true");
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const body = arg.slice(1);
      const next = argv[i + 1];
      const looksLikeValue = typeof next === "string" && !next.startsWith("-");
      if (body.length === 1) {
        if (looksLikeValue && (valueOptions.has(body) || aliasMap[body])) {
          takeValue(body, next);
          i += 1;
          continue;
        }
        takeValue(body, "true");
        continue;
      }
      const flags = body.split("");
      let consumedValue = false;
      for (let f = 0; f < flags.length; f += 1) {
        const flag = flags[f];
        const isLast = f === flags.length - 1;
        if (isLast && looksLikeValue && (valueOptions.has(flag) || aliasMap[flag])) {
          takeValue(flag, next);
          consumedValue = true;
          break;
        }
        takeValue(flag, "true");
      }
      if (consumedValue) i += 1;
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}

/**
 * Split a raw slash-command argument string into argv-style tokens.
 *
 * Mirrors the simple shell-like splitter used by Codex's companion, with light quoting
 * support for values that contain spaces.
 */
export function splitRawArgumentString(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }

  const tokens = [];
  let buffer = "";
  let quote = null;
  let escape = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (escape) {
      buffer += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      buffer += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (buffer.length > 0) {
        tokens.push(buffer);
        buffer = "";
      }
      continue;
    }

    buffer += char;
  }

  if (buffer.length > 0) {
    tokens.push(buffer);
  }

  return tokens;
}