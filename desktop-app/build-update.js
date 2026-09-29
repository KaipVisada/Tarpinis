"use strict";
/* Builds a small update file (dist/Team Board update <version>.asar, about 1 MB).
   Install it from the program: Help > Install update from file. */
const fs = require("fs"), path = require("path");
const asar = require("@electron/asar");
const pkg = require("./package.json");
const stage = path.join(__dirname, "dist", "update-stage");
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
for (const f of ["app-main.js", "package.json"]) fs.copyFileSync(path.join(__dirname, f), path.join(stage, f));
for (const d of ["server", "web"]) fs.cpSync(path.join(__dirname, d), path.join(stage, d), { recursive: true });
const out = path.join(__dirname, "dist", `Team Board update ${pkg.version}.asar`);
asar.createPackage(stage, out).then(() => { fs.rmSync(stage, { recursive: true, force: true }); console.log("Wrote " + out + " (" + Math.round(fs.statSync(out).size / 1024) + " KB)"); });
