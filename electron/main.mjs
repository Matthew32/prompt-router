import { app, BrowserWindow, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "../dist/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");

let win = null;
let running = null; // { server, port, root }

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#1e1e1e",
    title: "prompt-router",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.on("closed", () => (win = null));
  // Allow microphone (for speech-to-text) and media.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media" || permission === "audioCapture" || permission === "microphone");
  });
  showLanding();
  return win;
}

/** Guarantee we have a live window. */
function ensureWindow() {
  if (!win || win.isDestroyed()) createWindow();
  return win;
}

function showLanding() {
  const html =
    '<body style="background:#1e1e1e;color:#d4d4d4;font-family:sans-serif;display:flex;' +
    'height:100vh;margin:0;align-items:center;justify-content:center">' +
    "<div style='text-align:center'><h2>prompt-router</h2>" +
    "<p>Use <b>File → Open Folder…</b> (⌘/Ctrl+O) to get started.</p></div></body>";
  win.loadURL("data:text/html," + encodeURIComponent(html)).catch(() => {});
}

async function serveFolder(root) {
  if (running) {
    await new Promise((r) => running.server.close(r));
    running = null;
  }
  running = await startServer(root, 0);
  return running;
}

async function loadFolder(root) {
  try {
    const { port } = await serveFolder(root);
    ensureWindow();
    await win.loadURL(`http://localhost:${port}`);
    win.setTitle(`prompt-router — ${path.basename(root)}`);
  } catch (err) {
    console.error("Failed to open folder:", err);
    dialog.showErrorBox("Could not open folder", String(err?.message || err));
  }
}

async function pickFolder() {
  ensureWindow();
  const res = await dialog.showOpenDialog(win, {
    title: "Open Folder",
    properties: ["openDirectory"],
  });
  if (!res.canceled && res.filePaths[0]) await loadFolder(res.filePaths[0]);
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => pickFolder() },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** A directory arg to open on launch — an existing dir that isn't the app itself. */
function cliRoot() {
  for (const a of process.argv.slice(1)) {
    if (a.startsWith("-") || a === "." || a.endsWith(".mjs") || a === process.execPath) continue;
    try {
      const abs = path.resolve(a);
      if (abs !== APP_DIR && fs.statSync(abs).isDirectory()) return abs;
    } catch {
      // not a path
    }
  }
  return null;
}

app.whenReady().then(async () => {
  buildMenu();
  createWindow();

  const root = cliRoot();
  if (root) await loadFolder(root);
  else await pickFolder();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  if (running) {
    await new Promise((r) => running.server.close(r));
    running = null;
  }
  if (process.platform !== "darwin") app.quit();
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
