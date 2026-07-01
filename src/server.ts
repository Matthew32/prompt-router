import express from "express";
import type { Express } from "express";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { classify, generateCommitMessage } from "./router.js";
import { loadDotenv } from "./env.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the project root (one level up from dist/) and the cwd.
loadDotenv([path.resolve(__dirname, ".."), process.cwd()]);

// Directories we never descend into or list.
const IGNORE = new Set([".git", "node_modules", "dist", ".DS_Store", "vendor"]);

// System prompt injected into every Claude Code session started in the right panel.
// Editable in the app (persisted to a config file) and overridable via CLAUDE_ROUTER_PROMPT.
const DEFAULT_ROUTER_PROMPT = [
  "The user's name is Matt — always address him as Matt.",
  "MANDATORY CONFIRMATION GATE — this overrides your normal tendency to act immediately:",
  "When Matt gives you a new task, your FIRST reply must contain ONLY this single line and NOTHING else:",
  '"Agent: <name, or \'default (no special agent)\'> — Proceed? (yes/no)"',
  "Then STOP and END YOUR TURN immediately. In that turn you must NOT use any tool, must NOT read or edit files, must NOT run any command, and must NOT do the task — output only that one line and hand control back to Matt.",
  "Only after Matt sends a NEW message replying \"yes\" (or an obvious affirmative) may you start the work. If he replies \"no\", ask what he'd prefer and again wait.",
  "Choose the agent from the task's specifications (type, complexity, scope, tools needed).",
  "If you later need to switch agents mid-task, stop and ask again with the same one-line format before continuing.",
  "This gate applies to every new task, with no exceptions — do not batch the question together with doing the work.",
].join(" ");

const CONFIG_DIR = path.join(os.homedir(), ".prompt-router");
const PREPROMPT_FILE = path.join(CONFIG_DIR, "preprompt.txt");

/** The effective pre-prompt: saved file → env override → built-in default. */
async function getPrePrompt(): Promise<string> {
  try {
    const saved = await fs.readFile(PREPROMPT_FILE, "utf8");
    if (saved.trim()) return saved;
  } catch {
    // no saved file
  }
  return process.env.CLAUDE_ROUTER_PROMPT || DEFAULT_ROUTER_PROMPT;
}

async function savePrePrompt(text: string): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(PREPROMPT_FILE, text, "utf8");
}

interface TreeNode {
  name: string;
  path: string; // relative to root, POSIX-style
  type: "file" | "dir";
  children?: TreeNode[];
}

/** Build an Express app scoped to a single root folder. */
export function createApp(root: string): Express {
  const ROOT = path.resolve(root);

  /** Resolve a client-supplied relative path and guarantee it stays under ROOT. */
  function safeResolve(rel: string): string {
    const abs = path.resolve(ROOT, "." + path.sep + (rel || ""));
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      throw new Error("Path escapes root");
    }
    return abs;
  }

  async function buildTree(abs: string, rel: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          path: childRel,
          type: "dir",
          children: await buildTree(path.join(abs, e.name), childRel),
        });
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: childRel, type: "file" });
      }
    }
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
    return nodes;
  }

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/root", (_req, res) => res.json({ root: ROOT }));

  app.get("/api/tree", async (_req, res) => {
    try {
      res.json({ root: ROOT, tree: await buildTree(ROOT, "") });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/file", async (req, res) => {
    try {
      const abs = safeResolve(String(req.query.path || ""));
      const content = await fs.readFile(abs, "utf8");
      res.json({ path: req.query.path, content });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/file", async (req, res) => {
    try {
      const { path: rel, content } = req.body as { path: string; content: string };
      const abs = safeResolve(rel);
      await fs.writeFile(abs, content, "utf8");
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/create-file", async (req, res) => {
    try {
      const { path: rel } = req.body as { path: string };
      if (!rel?.trim()) return res.status(400).json({ error: "Empty path" });
      const abs = safeResolve(rel);
      try {
        await fs.access(abs);
        return res.status(409).json({ error: "File already exists" });
      } catch {
        // does not exist — good
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", "utf8");
      res.json({ ok: true, path: rel });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  // --- Search ---
  async function walkFiles(abs: string, rel: string, out: string[], cap = 20000) {
    if (out.length >= cap) return;
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= cap) return;
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walkFiles(path.join(abs, e.name), childRel, out, cap);
      else if (e.isFile()) out.push(childRel);
    }
  }

  app.get("/api/search/files", async (req, res) => {
    try {
      const q = String(req.query.q || "").toLowerCase();
      const all: string[] = [];
      await walkFiles(ROOT, "", all);
      const matches = (q ? all.filter((p) => p.toLowerCase().includes(q)) : all).slice(0, 200);
      res.json({ files: matches, total: all.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/search/text", async (req, res) => {
    try {
      const q = String(req.query.q || "");
      if (!q) return res.json({ results: [], truncated: false });
      const useRegex = req.query.regex === "1";
      const caseSensitive = req.query.case === "1";
      const flags = caseSensitive ? "g" : "gi";
      const pattern = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch {
        return res.status(400).json({ error: "Invalid regular expression" });
      }

      const files: string[] = [];
      await walkFiles(ROOT, "", files);

      const MAX_MATCHES = 500;
      const MAX_FILE_BYTES = 1_000_000;
      const results: { path: string; matches: { line: number; text: string }[] }[] = [];
      let count = 0;
      let truncated = false;

      for (const rel of files) {
        if (count >= MAX_MATCHES) { truncated = true; break; }
        const abs = path.join(ROOT, rel);
        let stat;
        try { stat = await fs.stat(abs); } catch { continue; }
        if (stat.size > MAX_FILE_BYTES) continue;
        let content: string;
        try { content = await fs.readFile(abs, "utf8"); } catch { continue; }
        if (content.includes("\x00")) continue; // skip binary
        const lines = content.split("\n");
        const hits: { line: number; text: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          if (re.test(lines[i])) {
            hits.push({ line: i + 1, text: lines[i].slice(0, 400) });
            if (++count >= MAX_MATCHES) { truncated = true; break; }
          }
        }
        if (hits.length) results.push({ path: rel, matches: hits });
      }
      res.json({ results, truncated });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Git source control ---
  const git = (args: string[]) =>
    execFileAsync("git", args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });

  // Network git ops: never prompt for credentials (fail fast instead of hanging), with a timeout.
  const gitNet = (args: string[]) =>
    execFileAsync("git", args, {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo", SSH_ASKPASS: "echo" },
    });

  // Ahead/behind vs upstream (no network). Returns null upstream if none configured.
  async function syncCounts() {
    let upstream = "";
    try {
      upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).stdout.trim();
    } catch {
      return { upstream: null as string | null, ahead: 0, behind: 0 };
    }
    const { stdout } = await git(["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [behind, ahead] = stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return { upstream, ahead, behind };
  }

  app.get("/api/git/status", async (_req, res) => {
    try {
      await git(["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return res.json({ repo: false, files: [] });
    }
    try {
      const [{ stdout: statusOut }, branch] = await Promise.all([
        git(["status", "--porcelain=v1"]),
        git(["rev-parse", "--abbrev-ref", "HEAD"]).then((r) => r.stdout.trim()).catch(() => ""),
      ]);
      const files = statusOut
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line[0];
          const work = line[1];
          const p = line.slice(3);
          return {
            path: p,
            index,
            work,
            staged: index !== " " && index !== "?",
            unstaged: work !== " ",
            untracked: index === "?" && work === "?",
          };
        });
      res.json({ repo: true, branch, files });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/diff", async (req, res) => {
    try {
      const rel = String(req.query.path || "");
      const staged = req.query.staged === "1";
      const args = ["diff"];
      if (staged) args.push("--cached");
      if (rel) args.push("--", rel);
      const { stdout } = await git(args);
      res.json({ diff: stdout });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/git/stage", async (req, res) => {
    try {
      const { path: rel } = req.body as { path?: string };
      await git(rel ? ["add", "--", rel] : ["add", "-A"]);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/git/unstage", async (req, res) => {
    try {
      const { path: rel } = req.body as { path?: string };
      await git(rel ? ["restore", "--staged", "--", rel] : ["reset"]);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/git/sync", async (_req, res) => {
    try {
      await git(["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return res.json({ repo: false });
    }
    try {
      res.json({ repo: true, ...(await syncCounts()) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const netOp = (op: "fetch" | "push" | "pull") => async (_req: express.Request, res: express.Response) => {
    try {
      const { stdout, stderr } = await gitNet([op]);
      res.json({ ok: true, output: (stdout + stderr).trim(), ...(await syncCounts()) });
    } catch (err: any) {
      const msg = String(err?.stderr || err?.message || err).trim();
      const timedOut = err?.killed || /ETIMEDOUT/.test(msg);
      res.status(400).json({ error: timedOut ? `git ${op} timed out (auth prompt or network?).` : msg });
    }
  };
  app.post("/api/git/fetch", netOp("fetch"));
  app.post("/api/git/push", netOp("push"));
  app.post("/api/git/pull", netOp("pull"));

  app.get("/api/git/branches", async (_req, res) => {
    try {
      await git(["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return res.json({ repo: false, current: "", branches: [] });
    }
    try {
      const [{ stdout: cur }, { stdout: list }] = await Promise.all([
        git(["rev-parse", "--abbrev-ref", "HEAD"]),
        git(["branch", "--format=%(refname:short)"]),
      ]);
      const branches = list.split("\n").map((s) => s.trim()).filter(Boolean);
      res.json({ repo: true, current: cur.trim(), branches });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/git/checkout", async (req, res) => {
    try {
      const { branch, create } = req.body as { branch: string; create?: boolean };
      if (!branch?.trim()) return res.status(400).json({ error: "Empty branch name" });
      const args = create ? ["checkout", "-b", branch] : ["checkout", branch];
      await git(args);
      res.json({ ok: true, branch });
    } catch (err) {
      const msg = err instanceof Error && "stderr" in err ? String((err as any).stderr || err) : String(err);
      res.status(400).json({ error: msg.trim() });
    }
  });

  app.get("/api/git/blame", async (req, res) => {
    try {
      const rel = String(req.query.path || "");
      if (!rel) return res.status(400).json({ error: "Missing path" });
      await git(["rev-parse", "--is-inside-work-tree"]);
      const { stdout } = await git(["blame", "--line-porcelain", "--", rel]);
      // Parse porcelain: header "<sha> orig final [count]" then metadata, then "\t<code>".
      const lines: { author: string; time: number; summary: string; sha: string }[] = [];
      let cur: any = {};
      for (const line of stdout.split("\n")) {
        if (/^[0-9a-f]{40} /.test(line)) {
          cur = { sha: line.slice(0, 40) };
        } else if (line.startsWith("author ")) {
          cur.author = line.slice(7);
        } else if (line.startsWith("author-time ")) {
          cur.time = parseInt(line.slice(12), 10);
        } else if (line.startsWith("summary ")) {
          cur.summary = line.slice(8);
        } else if (line.startsWith("\t")) {
          const uncommitted = /^0{40}$/.test(cur.sha || "");
          lines.push({
            author: uncommitted ? "You" : cur.author || "",
            time: cur.time || 0,
            summary: uncommitted ? "Uncommitted changes" : cur.summary || "",
            sha: uncommitted ? "" : (cur.sha || "").slice(0, 8),
          });
        }
      }
      res.json({ repo: true, lines });
    } catch {
      // not a repo, file untracked, etc. — blame just unavailable
      res.json({ repo: false, lines: [] });
    }
  });

  app.get("/api/git/log", async (_req, res) => {
    try {
      await git(["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return res.json({ repo: false, commits: [] });
    }
    try {
      // Unit-separated fields, record-separated by \x1e.
      const fmt = ["%h", "%an", "%ar", "%s"].join("%x1f") + "%x1e";
      const { stdout } = await git(["log", "-n", "100", `--pretty=format:${fmt}`]);
      const commits = stdout
        .split("\x1e")
        .map((rec) => rec.replace(/^\n/, ""))
        .filter(Boolean)
        .map((rec) => {
          const [hash, author, date, subject] = rec.split("\x1f");
          return { hash, author, date, subject };
        });
      res.json({ repo: true, commits });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/show", async (req, res) => {
    try {
      const hash = String(req.query.hash || "");
      if (!/^[0-9a-f]+$/i.test(hash)) return res.status(400).json({ error: "Bad commit hash" });
      const rel = req.query.path ? String(req.query.path) : "";
      const args = rel
        ? ["show", "--patch", hash, "--", rel] // just this file's diff in the commit
        : ["show", "--stat", "--patch", hash];  // whole commit
      const { stdout } = await git(args);
      res.json({ diff: stdout });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/git/commit-files", async (req, res) => {
    try {
      const hash = String(req.query.hash || "");
      if (!/^[0-9a-f]+$/i.test(hash)) return res.status(400).json({ error: "Bad commit hash" });
      // name-status: one "STATUS\tpath" per changed file, no commit header.
      const { stdout } = await git(["show", "--name-status", "--format=", hash]);
      const files = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split("\t");
          return { status: status.trim()[0] || "?", path: rest.join("\t") };
        })
        .filter((f) => f.path);
      res.json({ files });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  // Discard (roll back) working-tree changes for one path, or all tracked changes.
  app.post("/api/git/discard", async (req, res) => {
    try {
      const { path: rel } = req.body as { path?: string };
      if (rel && rel.trim()) {
        const { stdout } = await git(["status", "--porcelain", "--", rel]);
        if (stdout.startsWith("??")) {
          await fs.rm(safeResolve(rel), { recursive: true, force: true }); // untracked → delete
        } else {
          await git(["restore", "--staged", "--worktree", "--", rel]); // tracked → back to HEAD
        }
      } else {
        await git(["restore", "--staged", "--worktree", "."]); // all tracked changes
      }
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error && "stderr" in err ? String((err as any).stderr || err) : String(err);
      res.status(400).json({ error: msg.trim() });
    }
  });

  app.post("/api/git/gen-commit-message", async (_req, res) => {
    try {
      let { stdout: diff } = await git(["diff", "--cached"]);
      if (!diff.trim()) diff = (await git(["diff"])).stdout; // fall back to unstaged
      if (!diff.trim()) return res.status(400).json({ error: "No changes to summarize — make or stage changes first." });
      res.json({ message: await generateCommitMessage(diff) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/git/commit", async (req, res) => {
    try {
      const { message } = req.body as { message: string };
      if (!message?.trim()) return res.status(400).json({ error: "Empty commit message" });
      const { stdout } = await git(["commit", "-m", message]);
      res.json({ ok: true, output: stdout.trim() });
    } catch (err) {
      const msg = err instanceof Error && "stderr" in err ? String((err as any).stderr || err) : String(err);
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/create-folder", async (req, res) => {
    try {
      const { path: rel } = req.body as { path: string };
      if (!rel?.trim()) return res.status(400).json({ error: "Empty path" });
      const abs = safeResolve(rel);
      try {
        await fs.access(abs);
        return res.status(409).json({ error: "Already exists" });
      } catch {
        // does not exist — good
      }
      await fs.mkdir(abs, { recursive: true });
      res.json({ ok: true, path: rel });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/rename", async (req, res) => {
    try {
      const { from, to } = req.body as { from: string; to: string };
      if (!from?.trim() || !to?.trim()) return res.status(400).json({ error: "Missing path" });
      const absFrom = safeResolve(from);
      const absTo = safeResolve(to);
      try {
        await fs.access(absTo);
        return res.status(409).json({ error: "Target already exists" });
      } catch {
        // free — good
      }
      await fs.mkdir(path.dirname(absTo), { recursive: true });
      await fs.rename(absFrom, absTo);
      res.json({ ok: true, from, to });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/delete", async (req, res) => {
    try {
      const { path: rel } = req.body as { path: string };
      if (!rel?.trim()) return res.status(400).json({ error: "Empty path" });
      const abs = safeResolve(rel);
      if (abs === ROOT) return res.status(400).json({ error: "Refusing to delete the root folder" });
      await fs.rm(abs, { recursive: true, force: false });
      res.json({ ok: true, path: rel });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/preprompt", async (_req, res) => {
    res.json({ prompt: await getPrePrompt(), default: DEFAULT_ROUTER_PROMPT });
  });

  app.post("/api/preprompt", async (req, res) => {
    try {
      const { prompt } = req.body as { prompt: string };
      await savePrePrompt(prompt ?? "");
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/classify", async (req, res) => {
    try {
      const { prompt } = req.body as { prompt: string };
      if (!prompt?.trim()) return res.status(400).json({ error: "Empty prompt" });
      res.json(await classify(prompt));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  root: string;
}

/**
 * Attach PTY-backed terminals over WebSocket, cwd'd to the root folder:
 *   /terminal — the user's shell (bottom panel)
 *   /claude   — a live `claude` (Claude Code) session (right panel)
 */
function attachTerminal(server: http.Server, root: string) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "", "http://x").pathname;
    if (pathname !== "/terminal" && pathname !== "/claude") return; // let other handlers deal with it
    wss.handleUpgrade(req, socket, head, (ws) => wireTerminal(ws, pathname, root));
  });
}

async function wireTerminal(ws: import("ws").WebSocket, pathname: string, root: string) {
  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch {
    ws.send("\r\n[terminal unavailable: node-pty failed to load. Run `npm run rebuild:electron` (app) or `npm rebuild node-pty` (browser).]\r\n");
    return;
  }

  // Both terminals run through a login+interactive shell so PATH (homebrew, etc.)
  // is resolved exactly like a real terminal. /claude then execs `claude`.
  const isClaude = pathname === "/claude";
  const isWin = process.platform === "win32";
  const shell = process.env.SHELL || (isWin ? "powershell.exe" : "bash");

  let file: string;
  let args: string[];
  if (isWin) {
    file = isClaude ? "claude" : shell; // Windows: no login-shell semantics
    args = [];
  } else if (isClaude) {
    file = shell;
    // login+interactive → load PATH, then become claude with our routing system prompt.
    // The prompt is passed via env var to avoid shell-quoting issues.
    args = ["-l", "-i", "-c", 'exec claude --append-system-prompt "$CLAUDE_ROUTER_PROMPT"'];
  } else {
    file = shell;
    args = ["-l", "-i"]; // interactive login shell
  }

  let term: import("node-pty").IPty;
  try {
    term = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: root,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        CLAUDE_ROUTER_PROMPT: await getPrePrompt(),
      } as { [key: string]: string },
    });
  } catch (err) {
    if (ws.readyState === ws.OPEN) {
      const hint = isClaude ? " (is the `claude` CLI installed and on your shell PATH?)" : "";
      ws.send(`\r\n[failed to start '${file}': ${err instanceof Error ? err.message : String(err)}${hint}]\r\n`);
      ws.close();
    }
    return;
  }

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  ws.on("message", (raw) => {
    const msg = raw.toString();
    if (msg.startsWith("\x00resize:")) {
      const [cols, rows] = msg.slice(8).split(",").map(Number);
      if (cols && rows) term.resize(cols, rows);
    } else {
      term.write(msg);
    }
  });
  ws.on("close", () => term.kill());
  term.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send("\r\n[claude session ended]\r\n");
      ws.close();
    }
  });
}

/** Start the editor server. `port: 0` (default) picks a free port. */
export function startServer(root: string, port = 0): Promise<RunningServer> {
  const resolvedRoot = path.resolve(root);
  const app = createApp(resolvedRoot);
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      attachTerminal(server, resolvedRoot);
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actualPort, root: resolvedRoot });
    });
  });
}

// Direct invocation: `npm run serve -- /some/dir` (browser mode).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const root = process.argv[2] || process.env.ROOT_DIR || process.cwd();
  const port = Number(process.env.PORT) || 4600;
  startServer(root, port).then(({ port, root }) => {
    console.log(`prompt-router editor  →  http://localhost:${port}`);
    console.log(`Editing folder: ${root}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("⚠  ANTHROPIC_API_KEY not set — the router panel will error until you set it.");
    }
  });
}
