# prompt-router

A tiny CLI that reads a prompt and tells you **which Claude model, effort level, thinking setting, and agentic strategy** to use for it. It runs a fast, cheap classifier (Claude Haiku 4.5) that analyzes the prompt — it does **not** solve the task — and returns a schema-validated recommendation.

## Why

Not every prompt needs Opus at `max` effort with subagents. A one-line lookup should route to Haiku; a large migration should route to Fable with parallel subagents. This picks the cheapest configuration that still does the job.

## Router backend

The Router panel can classify prompts two ways:

- **`cli` (default)** — shells out to the `claude` CLI (Claude Code). Uses whatever account Claude Code is logged into. If that's a **Pro/Max subscription**, it costs no API credits. Requires the `claude` CLI on your PATH.
- **`api`** — the Anthropic API SDK. Needs `ANTHROPIC_API_KEY` **and** a positive credit balance (pay-as-you-go).

Switch with `ROUTER_BACKEND=api` or `ROUTER_BACKEND=cli`. CLI model via `CLASSIFIER_CLI_MODEL` (default `haiku`).

> If you see **"Credit balance is too low"**, the account in use has no API credits. In `cli` mode this means Claude Code is logged into a credit-billed account — log it into a Pro/Max plan (`claude` → `/login`) to avoid credits, or add credits. In `api` mode, add credits at console.anthropic.com → Billing.

## API key

The editor works without a key; only the **Router** panel needs one. Set it either way:

- **`.env` file (easiest):** `cp .env.example .env` and put your key in it. The app loads `.env` automatically on startup — no need to export anything. This is the fix for the *"Could not resolve authentication method"* error, which means the app was launched without a key in its environment.
- **Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...` in the terminal you launch from.

> Packaged/installed apps (`npm run dist:*`) don't read the project `.env` — set `ANTHROPIC_API_KEY` in your OS environment, or run from source with `.env` during development.

## Install

```sh
cd prompt-router
npm install
npm run build            # compiles to dist/
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```sh
# as an argument
npm run dev -- "rename the getUser function to fetchUser across the repo"

# piped via stdin
echo "audit this codebase for security bugs and fix them" | npm run dev

# machine-readable
npm run dev -- --json "explain what a closure is"
```

After `npm run build` you can also run `node dist/cli.js "..."` or link the `prompt-router` bin.

### Example output

```
  Complexity   ████░░░░░░ 4/10
  Model        sonnet  (claude-sonnet-4-6)
  Effort       medium
  Thinking     adaptive (on)
  Agentic      single-shot

  Why: A scoped multi-file rename is routine coding work — balanced model,
  moderate effort, no need to fan out.
```

## Web editor

A browser-based editor (Monaco — the engine behind VS Code) that opens any local folder, with the router built into a side panel.

```sh
export ANTHROPIC_API_KEY=sk-ant-...
npm run serve -- /path/to/folder      # open any folder; omit to use the cwd
# → http://localhost:4600
```

- **Explorer** (left): collapsible file tree of the opened folder. Click a file to open it. `.git`, `node_modules`, `dist`, `vendor`, and dotfiles are hidden. The **＋** button creates a new file (accepts a nested path like `src/foo.ts` — parent folders are created). **Right-click** a folder to create a file or folder inside it, a file to create alongside it, or empty space to create at the root. The right-click menu on a file or folder also offers **Rename…** and **Delete** (delete asks for confirmation; open tabs for the affected path are closed automatically).
- **Editor** (center): Monaco editor with **tabs**, **Vim mode** (nvim-style — relative line numbers, block cursor, command line in the status bar; toggle it on/off with the **VIM: on/off** button in the status bar, and the choice is remembered), and **autosave** (writes ~0.8s after you stop typing; toggle with the **autosave: on/off** button in the status bar — when off, ⌘/Ctrl+S still saves; both remembered). When the cursor is on a line, the **git blame** for that line (author, date, commit summary) shows both inline (dimmed, end of line) and in the status bar.
- **Router** (right): describe the task you're about to hand an AI and hit *Analyze* — it returns the same model/effort/thinking/agentic recommendation as the CLI.

File access is sandboxed to the opened folder (path-traversal attempts are rejected). Set `PORT` to change the port. Run against the compiled build with `npm run build && npm run serve:build -- /path/to/folder`.

## Desktop app (Electron)

Run it as a real double-click desktop app (same tech as VS Code) instead of a browser tab.

```sh
export ANTHROPIC_API_KEY=sk-ant-...
npm run app                 # builds + launches the desktop app
```

On launch it shows a native **Open Folder** dialog; pick any folder and it opens in the editor window. Use **File → Open Folder…** (⌘/Ctrl+O) to switch folders. The embedded server runs in-process on a random free port — no browser, no port conflicts.

### Integrated terminal & Source Control

- **Claude Code panel (right)** — a live `claude` session started automatically in the opened folder, launched with a system prompt (`claude --append-system-prompt …`) that tells it to address you as **Matt**, analyze each prompt to route to the best-fit agent/subagent, and re-evaluate/switch agents as the task progresses. By default the pre-prompt makes it a hard gate — it announces the agent it will use (even "default / none") and asks **Proceed? (yes/no)**, waiting for your reply before running anything. The **🔈/🔊** button toggles **text-to-speech** of the AI's output (browser speech synthesis; off by default, remembered). The **🎤** button dictates: click it, speak, and the transcript is typed into the Claude prompt (it doesn't press Enter, so you can review/edit first). Type into it like any Claude Code session; ⟳ restarts it. Uses your existing Claude Code login. Edit the injected instructions in-app with the **⚙** button in the panel header — write your own routing rules (which agent/effort to recommend for which kind of prompt), **Save & restart Claude**, or **Reset to default**. It's persisted to `~/.prompt-router/preprompt.txt` and reused on every session; `CLAUDE_ROUTER_PROMPT` env var still works as a fallback when no file is saved. Requires the `claude` CLI on PATH.

The whole UI uses a **terminal-style theme** (monospace, phosphor-green on black) — including the Monaco editor and both terminals.
- **Terminal** — click **⌥ Terminal** in the status bar (or the ✕ to hide). It's a real shell (PTY) rooted in the open folder, backed by `node-pty` + xterm.js over a WebSocket.
- **Search** — the *Search* tab in the left sidebar. **⌘/Ctrl+P** jumps straight to project-wide **file-name** search (Go to File); **⌘/Ctrl+Shift+F** opens **text** search across every file (string or regex, with an Aa case toggle) — click a match to jump to that line. Binaries, `node_modules`, `.git`, `dist`, `vendor`, and dotfiles are skipped.
- **Source Control** — the *Source Control* tab in the left sidebar shows `git status` for the folder: staged vs. changed files, per-file **stage/unstage** (＋/−), a per-file **rollback** (↩ discard changes, with confirm), **Stage all**, **↩ Discard all changes**, a commit message box, **✨ Generate message (AI)** (writes a Conventional-Commits message from the staged/working diff using the configured backend), and **Commit staged**. Click a changed file to view its diff in a read-only tab; click an untracked file to open it. The header has a **branch switcher** dropdown — pick a branch to check it out, or choose *＋ New branch…* to create one. A **sync bar** shows ahead/behind counts vs. the upstream (⭱ ahead / ⭳ behind) with **Pull**, **Push**, and **Fetch** buttons (credential prompts are disabled and network ops time out, so they never hang the app). Below that, **History** lists recent commits (hash · author · relative date · subject) — click one to view its full diff (`git show`) in a read-only tab.

> **Native module note (terminal only):** `node-pty` is a native addon and can only be compiled for one runtime at a time.
> - `npm install` builds it for **system Node** → the terminal works in browser mode (`npm run serve`).
> - Packaged apps (`npm run dist:*`) rebuild it for Electron automatically, so the terminal works in the installed app.
> - For the **dev** desktop app (`npm run app`), run `npm run rebuild:electron` once to make the terminal work there (then `npm run rebuild:node` to switch back for browser mode). If it's built for the wrong runtime, the terminal panel just shows an "unavailable" message — the rest of the app is unaffected.

### Building installers

```sh
npm run dist:app            # build for the current OS
npm run dist:mac            # .dmg + .zip
npm run dist:win            # .exe (NSIS installer)
npm run dist:linux          # .AppImage
```

Output lands in `dist/` (the packaged apps) via electron-builder. Cross-OS note: building a Windows `.exe` or Linux `.AppImage` is most reliable when run on that OS (or CI); macOS can build its own `.dmg` locally.

> **API key in the packaged app:** the router panel reads `ANTHROPIC_API_KEY` from the environment. Launch the app from a shell that has it exported, or set it in your OS environment, so the packaged app inherits it.

## How it maps

| Complexity | Model  | Effort      | Agentic                 |
| ---------- | ------ | ----------- | ----------------------- |
| 1–3        | haiku  | low         | single-shot             |
| 4–6        | sonnet | medium/high | single-shot             |
| 7–8        | opus   | high/xhigh  | subagents / workflow    |
| 9–10       | fable  | xhigh/max   | subagents               |

Model IDs, the classifier model, and the mapping guidance live in `src/router.ts` — edit there to tune routing.
