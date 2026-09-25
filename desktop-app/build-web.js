"use strict";
/* Assembles web/ (what the program serves) from:
   - ../team-board/index.html  (run ../team-board/build.sh first)
   - erp-source/DroneForge_Pro_EU.html  (the ERP, unchanged except for where it stores data)
   - web-src/ (desktop adapters)  and  chart.js from node_modules */
const fs = require("fs"), path = require("path");
const root = __dirname, out = path.join(root, "web");
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
const must = (s, find, what) => { if (!s.includes(find)) throw new Error("Build: could not find " + what); return s; };

// team board
let board = fs.readFileSync(path.join(root, "..", "team-board", "index.html"), "utf8");
board = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="icon.svg"><style>[hidden]{display:none!important}</style>
<script src="desktop-shim.js"></script>
</head><body>
${board}
</body></html>`;
fs.writeFileSync(path.join(out, "index.html"), board);

// ERP
let erp = fs.readFileSync(path.join(root, "erp-source", "DroneForge_Pro_EU.html"), "utf8");
const cdn = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/[^"]+"><\/script>/;
if (!cdn.test(erp)) throw new Error("Build: Chart.js tag not found in the ERP");
erp = erp.replace(cdn, '<script src="vendor/chart.min.js"></script>\n    <script src="erp-bridge.js"></script>');
const n = (erp.match(/localStorage\./g) || []).length;
erp = erp.replace(/localStorage\./g, "erpStorage.");
const last = erp.lastIndexOf("</script>");
must(erp, "function applyImportedData", "applyImportedData"); must(erp, "function loadDB", "loadDB");
erp = erp.slice(0, last) + `
        /* desktop: imports replace the shared data instead of merging into it */
        ;(function(){ const a = applyImportedData; window.applyImportedData = function(t){ erpStorage.replaceOnNextSave(); return a(t); };
          window.__erpAdopt = function(){ loadDB(); }; })();
    ` + erp.slice(last);
fs.writeFileSync(path.join(out, "erp.html"), erp);

for (const f of fs.readdirSync(path.join(root, "web-src"))) fs.copyFileSync(path.join(root, "web-src", f), path.join(out, f));
fs.copyFileSync(require.resolve("chart.js/dist/chart.min.js"), path.join(out, "vendor", "chart.min.js"));
console.log(`web/ built. ERP storage calls redirected: ${n}.`);
