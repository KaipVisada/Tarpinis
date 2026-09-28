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
<script src="vendor/xlsx.full.min.js" defer></script>
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
        ;(function(){
          /* imports go through the server: it understands old and new DroneForge files and keeps a copy of what was there */
          window.applyImportedData = function(t){
            let data; try { data = JSON.parse(t); } catch (e) { showToast('That file is not a valid JSON export', 'error'); return; }
            const x = new XMLHttpRequest(); x.open('POST', '/api/erp/import', false); x.setRequestHeader('Content-Type', 'application/json');
            try { x.send(JSON.stringify({ data })); } catch (e) { showToast('Could not reach the Team Board program', 'error'); return; }
            let r = {}; try { r = JSON.parse(x.responseText); } catch (e) {}
            if (x.status !== 200) { showToast(r.message || 'Import failed', 'error'); return; }
            showToast('Imported ' + r.counts.products + ' products, ' + r.counts.materials + ' materials, ' + r.counts.suppliers + ' suppliers', 'success');
            setTimeout(function(){ location.reload(); }, 900);
          };
          window.__erpAdopt = function(){ loadDB(); };
        })();
    ` + erp.slice(last);
fs.writeFileSync(path.join(out, "erp.html"), erp);

for (const f of fs.readdirSync(path.join(root, "web-src"))) fs.copyFileSync(path.join(root, "web-src", f), path.join(out, f));
fs.copyFileSync(require.resolve("chart.js/dist/chart.min.js"), path.join(out, "vendor", "chart.min.js"));
fs.copyFileSync(require.resolve("xlsx/dist/xlsx.full.min.js"), path.join(out, "vendor", "xlsx.full.min.js"));
console.log(`web/ built. ERP storage calls redirected: ${n}.`);
