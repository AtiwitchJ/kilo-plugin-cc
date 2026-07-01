import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  const filePath = path.join(rootDir, "prompts", `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing prompt template: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

export function interpolateTemplate(template, values) {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value for {{${key}}}.`);
    }
    return String(values[key]);
  });
}