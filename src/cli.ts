#!/usr/bin/env node
import { classify, type Recommendation } from "./router.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function bar(n: number): string {
  const filled = Math.max(0, Math.min(10, n));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function render(r: Recommendation): string {
  return [
    "",
    `  Complexity   ${bar(r.complexity)} ${r.complexity}/10`,
    `  Model        ${r.model}  (${r.model_id})`,
    `  Effort       ${r.effort}`,
    `  Thinking     ${r.thinking ? "adaptive (on)" : "off"}`,
    `  Agentic      ${r.agentic}`,
    "",
    `  Why: ${r.reasoning}`,
    "",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const promptArgs = args.filter((a) => !a.startsWith("--"));

  let prompt = promptArgs.join(" ").trim();
  if (!prompt && !process.stdin.isTTY) {
    prompt = (await readStdin()).trim();
  }

  if (!prompt) {
    console.error(
      'Usage: prompt-router "your prompt here"  (or pipe via stdin)\n' +
        "       prompt-router --json \"...\"    (machine-readable output)\n\n" +
        "Requires ANTHROPIC_API_KEY in the environment.",
    );
    process.exit(1);
  }

  try {
    const rec = await classify(prompt);
    console.log(json ? JSON.stringify(rec, null, 2) : render(rec));
  } catch (err) {
    console.error(
      "Error:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
