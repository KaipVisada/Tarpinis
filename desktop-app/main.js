"use strict";
/* Start-up loader. Runs the newest installed update (Documents\Team Board\updates\<version>.asar)
   if it's newer than this installation, otherwise the built-in program. A broken update is
   skipped and remembered, so the program always starts. */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const BUILTIN = require("./package.json").version;
const cmp = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const updDir = () => path.join(app.getPath("documents"), "Team Board", "updates");
function candidates() {
  if (!app.isPackaged) return [];
  try {
    const dir = updDir(); if (!fs.existsSync(dir)) return [];
    let bad = []; try { bad = JSON.parse(fs.readFileSync(path.join(dir, "skipped.json"), "utf8")); } catch (e) {}
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d+\.\d+\.\d+\.asar$/.test(f) || bad.includes(f)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, f, "package.json"), "utf8"));
        if (pkg.name === "team-board" && cmp(pkg.version, BUILTIN) > 0) out.push({ file: f, path: path.join(dir, f), version: pkg.version });
      } catch (e) {}
    }
    return out.sort((a, b) => cmp(b.version, a.version));
  } catch (e) { return []; }
}
function skip(file) { try { const f = path.join(updDir(), "skipped.json"); let bad = []; try { bad = JSON.parse(fs.readFileSync(f, "utf8")); } catch (x) {} if (!bad.includes(file)) bad.push(file); fs.writeFileSync(f, JSON.stringify(bad)); } catch (x) {} }
global.teamBoard = { builtin: BUILTIN, builtinDir: __dirname, version: BUILTIN, update: null, updDir, cmp, failedUpdate: null };
let started = false;
for (const upd of candidates()) {          // newest first; a broken one is skipped and the next one tried
  try { global.teamBoard.version = upd.version; global.teamBoard.update = upd; require(path.join(upd.path, "app-main.js")); started = true; break; }
  catch (e) { skip(upd.file); global.teamBoard.failedUpdate = `${upd.version}: ${e.message}`; global.teamBoard.version = BUILTIN; global.teamBoard.update = null; }
}
if (!started) require("./app-main.js");
