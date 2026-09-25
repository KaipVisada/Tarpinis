"use strict";
/* Team Board desktop program (Electron). Starts the local server, then opens the board in
   its own window. Data lives in a "data" folder next to Team Board.exe, so the whole
   folder can be copied to another PC. */
const { app, BrowserWindow, Menu, shell, dialog, session } = require("electron");
const path = require("path");
const fs = require("fs");
const server = require("./server/index.js");

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

function pickDataDir() {
  if (!app.isPackaged) return path.join(__dirname, "data");
  const nextToExe = path.join(path.dirname(process.execPath), "data");
  try { fs.mkdirSync(nextToExe, { recursive: true }); fs.accessSync(nextToExe, fs.constants.W_OK); return nextToExe; }
  catch (e) { return path.join(app.getPath("userData"), "data"); }   // e.g. installed under Program Files
}
const dataDir = pickDataDir();
const cfgFile = path.join(dataDir, "config.json");
function readCfg() { try { return { port: 8080, fullscreen: false, ...JSON.parse(fs.readFileSync(cfgFile, "utf8")) }; } catch (e) { return { port: 8080, fullscreen: false }; } }
function writeCfg(c) { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); } catch (e) {} }
let cfg = readCfg(), srv = null, win = null;

function origin() { return `http://127.0.0.1:${srv.port}`; }

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: "#0f2817", title: "Team Board",
    autoHideMenuBar: true, fullscreen: !!cfg.fullscreen, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(origin() + "/");
  win.on("enter-full-screen", () => { cfg.fullscreen = true; writeCfg(cfg); });
  win.on("leave-full-screen", () => { cfg.fullscreen = false; writeCfg(cfg); });
  // links: our own pages open in a new window, everything else in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin())) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#0b0f14" } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin())) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // never leave a blank or frozen screen on the TV
  win.webContents.on("render-process-gone", (e, d) => { srv.log.error("Screen crashed: " + d.reason); setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000); });
  win.on("unresponsive", () => { srv.log.warn("Window stopped responding"); setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer(); }, 15000); });
  win.webContents.on("did-fail-load", (e, code, desc) => { if (code !== -3) setTimeout(() => win && !win.isDestroyed() && win.loadURL(origin() + "/"), 2000); });
}

function menu() {
  const lan = () => (srv ? srv.lan() : []);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Team Board", submenu: [
      { label: "Open the data folder", click: () => shell.openPath(dataDir) },
      { label: "Open the backups folder", click: () => shell.openPath(path.join(dataDir, "backups")) },
      { type: "separator" },
      { label: "Start with Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { type: "separator" },
      { role: "quit", label: "Quit" } ] },
    { label: "View", submenu: [
      { label: "Full screen", accelerator: "F11", click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win && win.reload() },
      { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" },
      { type: "separator" }, { role: "toggleDevTools", label: "Developer tools" } ] },
    { label: "Help", submenu: [
      { label: "Phones and other computers…", click: () => dialog.showMessageBox(win, { type: "info", title: "Open the board on other devices",
          message: "Devices on the same network can open the board in a browser:",
          detail: (lan().join("\n") || "No network connection found.") + "\n\nIf a phone can't connect, allow Team Board through Windows Firewall (Windows asks the first time the program starts)." }) },
      { label: "About Team Board", click: () => dialog.showMessageBox(win, { type: "info", title: "Team Board", message: `Team Board ${app.getVersion()}`, detail: `Data folder:\n${dataDir}` }) } ] }
  ]));
}

app.whenReady().then(async () => {
  try {
    srv = await server.start({ dataDir, staticDir: path.join(__dirname, "web"), port: cfg.port || 8080 });
  } catch (e) {
    dialog.showErrorBox("Team Board could not start", `${e.message}\n\nData folder: ${dataDir}`);
    app.quit(); return;
  }
  // downloads: the ERP's automatic backups go straight into the data folder, everything else asks where to save
  session.defaultSession.on("will-download", (e, item) => {
    const name = item.getFilename();
    if (/^DroneForge_AutoBackup_/.test(name)) { const d = path.join(dataDir, "erp-autobackups"); fs.mkdirSync(d, { recursive: true }); item.setSavePath(path.join(d, name)); }
    else item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), name) });
  });
  menu();
  createWindow();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("before-quit", () => { if (srv) srv.flush(); });
app.on("window-all-closed", () => { if (srv) srv.flush(); app.quit(); });
process.on("uncaughtException", e => { try { srv && srv.log.error("Uncaught", e); } catch (x) {} });
