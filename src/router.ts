import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

/** Run `claude` with stdin closed (/dev/null) so it never blocks waiting for input. */
function runClaude(args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out."));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err: any) => {
      clearTimeout(timer);
      if (err?.code === "ENOENT") {
        reject(new Error("`claude` CLI not found on PATH. Install Claude Code, or set ROUTER_BACKEND=api."));
      } else reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Resolve with stdout whenever we got any — the CLI reports its own
      // errors (e.g. low credit) as JSON on stdout with a non-zero exit.
      if (stdout.trim()) resolve(stdout);
      else reject(new Error(`claude CLI exited ${code}: ${stderr.trim() || "no output"}`));
    });
  });
}

type RecordInput = Omit<Recommendation, "model_id">;

/**
 * Which backend does the classification:
 *   "cli" (default) — shell out to the `claude` CLI (uses your Claude Code
 *          subscription auth; no API credits needed).
 *   "api"  — the Anthropic API SDK (needs ANTHROPIC_API_KEY + billing credits).
 * Override with ROUTER_BACKEND=api|cli.
 */
export const BACKEND = (process.env.ROUTER_BACKEND || "cli").toLowerCase();
const CLI_MODEL = process.env.CLASSIFIER_CLI_MODEL || "haiku";

/**
 * The classifier model. Haiku 4.5 is fast and cheap — ideal for a routing
 * decision that runs on every prompt before the "real" call.
 */
export const CLASSIFIER_MODEL = "claude-haiku-4-5";

export type ModelChoice = "haiku" | "sonnet" | "opus" | "fable";
export type EffortChoice = "low" | "medium" | "high" | "xhigh" | "max";
export type AgenticChoice = "single-shot" | "workflow" | "subagents";

export interface Recommendation {
  model: ModelChoice;
  model_id: string;
  effort: EffortChoice;
  thinking: boolean;
  agentic: AgenticChoice;
  complexity: number; // 1-10
  reasoning: string;
}

/** Maps the friendly model tier to the exact API model id. */
export const MODEL_IDS: Record<ModelChoice, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};

const RECOMMENDATION_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    complexity: {
      type: "integer",
      enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      description: "Overall task difficulty, 1 (trivial) to 10 (frontier).",
    },
    model: {
      type: "string",
      enum: ["haiku", "sonnet", "opus", "fable"],
      description:
        "haiku=fast/cheap simple tasks; sonnet=balanced; opus=hard reasoning & agentic; fable=most demanding long-horizon work.",
    },
    effort: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh", "max"],
      description:
        "Reasoning depth. low=simple/latency-sensitive; high=most intelligence-sensitive work; xhigh=coding/agentic; max=hardest correctness-critical.",
    },
    thinking: {
      type: "boolean",
      description: "Whether adaptive thinking should be enabled.",
    },
    agentic: {
      type: "string",
      enum: ["single-shot", "workflow", "subagents"],
      description:
        "single-shot=one call; workflow=code-orchestrated multi-step; subagents=parallel/independent workstreams.",
    },
    reasoning: {
      type: "string",
      description: "One or two sentences justifying the choices.",
    },
  },
  required: [
    "complexity",
    "model",
    "effort",
    "thinking",
    "agentic",
    "reasoning",
  ],
};

const SYSTEM_PROMPT = `You are a routing classifier for Claude Code. Given a user's prompt, decide the cheapest configuration that will still do the job well. Do NOT solve the task — only classify it.

Guidance:
- complexity 1-3: lookups, formatting, short edits, simple Q&A -> haiku, effort low, thinking off, single-shot.
- complexity 4-6: normal coding, refactors, multi-file edits, analysis -> sonnet, effort medium/high, thinking on, single-shot.
- complexity 7-8: hard debugging, architecture, deep reasoning, tool-heavy agentic work -> opus, effort high/xhigh, thinking on. Use subagents for parallel/independent workstreams; workflow for multi-step code-orchestrated pipelines.
- complexity 9-10: long-horizon autonomous work, large migrations, frontier reasoning -> fable, effort xhigh/max, subagents.

Prefer the smallest model that fits. Reserve max effort for correctness-critical tasks. Only recommend subagents/workflow when the work genuinely fans out or has independent steps.`;

const TOOL_NAME = "record_recommendation";

const VALID_MODELS = new Set(Object.keys(MODEL_IDS));
const VALID_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);
const VALID_AGENTIC = new Set(["single-shot", "workflow", "subagents"]);

/** Validate + normalize a raw recommendation object into a typed Recommendation. */
function finalize(raw: any): Recommendation {
  const model: ModelChoice = VALID_MODELS.has(raw?.model) ? raw.model : "sonnet";
  const effort: EffortChoice = VALID_EFFORT.has(raw?.effort) ? raw.effort : "medium";
  const agentic: AgenticChoice = VALID_AGENTIC.has(raw?.agentic) ? raw.agentic : "single-shot";
  const complexity = Math.max(1, Math.min(10, Math.round(Number(raw?.complexity) || 5)));
  return {
    model,
    model_id: MODEL_IDS[model],
    effort,
    thinking: Boolean(raw?.thinking),
    agentic,
    complexity,
    reasoning: String(raw?.reasoning || "").slice(0, 600),
  };
}

/** Public entry — dispatches to the configured backend. */
export async function classify(prompt: string): Promise<Recommendation> {
  return BACKEND === "api" ? classifyViaApi(prompt) : classifyViaCli(prompt);
}

function stripFences(text: string): string {
  const m = text.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

/** Generate a git commit message from a staged diff (uses the configured backend). */
export async function generateCommitMessage(diff: string): Promise<string> {
  const clipped = diff.slice(0, 12000);
  const instruction =
    "Write a git commit message for the following staged diff. Use Conventional Commits style " +
    "(e.g. 'fix: …', 'feat: …'), an imperative subject line under 72 chars, and a short body only if it adds value. " +
    "Output ONLY the commit message — no code fences, no preamble, no quotes.\n\nDIFF:\n" + clipped;

  if (BACKEND === "api") {
    const client = new Anthropic();
    const r = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: instruction }],
    });
    const t = r.content.find((b) => b.type === "text");
    return (t && t.type === "text" ? t.text : "").trim();
  }

  const out = await runClaude(["-p", instruction, "--output-format", "json", "--model", CLI_MODEL]);
  let outer: any;
  try { outer = JSON.parse(out); } catch { return stripFences(out); }
  if (outer?.is_error) throw new Error(outer?.result || "claude CLI returned an error.");
  return stripFences(String(outer?.result ?? out));
}

/** Classify via the `claude` CLI (Claude Code subscription auth, no API credits). */
export async function classifyViaCli(prompt: string): Promise<Recommendation> {
  const instruction =
    SYSTEM_PROMPT +
    "\n\nRespond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys: " +
    'complexity (integer 1-10), model (one of "haiku","sonnet","opus","fable"), ' +
    'effort (one of "low","medium","high","xhigh","max"), thinking (boolean), ' +
    'agentic (one of "single-shot","workflow","subagents"), reasoning (one short sentence).';

  const stdout = await runClaude([
    "-p", `Classify this prompt:\n\n"""${prompt}"""`,
    "--output-format", "json",
    "--model", CLI_MODEL,
    "--append-system-prompt", instruction,
  ]);

  let outer: any;
  try {
    outer = JSON.parse(stdout);
  } catch {
    throw new Error("Could not parse claude CLI output.");
  }
  if (outer?.is_error) throw new Error(outer?.result || "claude CLI returned an error.");
  const text: string = outer?.result ?? stdout;
  return finalize(extractJson(text));
}

/** Pull a JSON object out of text that may be wrapped in ``` fences or prose. */
function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

/** Classify via the Anthropic API SDK (needs ANTHROPIC_API_KEY + credits). */
export async function classifyViaApi(
  prompt: string,
  client = new Anthropic(),
): Promise<Recommendation> {
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Record the routing recommendation for the prompt.",
        input_schema: RECOMMENDATION_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `Classify this prompt:\n\n"""${prompt}"""` }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Classifier did not return a tool call.");
  }
  return finalize(toolUse.input as RecordInput);
}
