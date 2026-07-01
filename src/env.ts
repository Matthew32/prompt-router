import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines from the first
 * .env found in the given directories and sets any keys not already present
 * in process.env. Existing environment variables always win.
 */
export function loadDotenv(dirs: string[]): void {
  for (const dir of dirs) {
    const file = path.join(dir, ".env");
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
