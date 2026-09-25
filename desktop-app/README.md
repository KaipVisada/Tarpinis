# Team Board desktop program

The team board and the DroneForge Pro ERP in one Windows program. It runs a small local
server on the PC connected to the TV. Its own window shows the board (ERP tab for admins),
and phones on the same network can open the board in a browser.

## How it fits together

| Part | What it does |
| --- | --- |
| `main.js` | Electron shell: starts the server, opens the window (F11 full screen), handles downloads, recovers from crashes |
| `server/store.js` | Document store saved to `data/store.json` (atomic writes, previous copy, daily backups kept 60 days) |
| `server/erp.js` | ERP data as one document. Saves are merged record by record so screens don't overwrite each other. Tasks with a product and quantity get a matching Planning entry and Production order |
| `server/index.js` | HTTP API, live updates (server-sent events), file attachments, static files |
| `web-src/desktop-shim.js` | Gives the team board the same `window.claude.use("db")` API it has as an artifact, backed by the server |
| `web-src/erp-bridge.js` | Redirects the ERP's browser storage to the server and refreshes it when data changes elsewhere |
| `build-web.js` | Builds `web/` from `../team-board/index.html` and `erp-source/DroneForge_Pro_EU.html` |

## Build

```sh
npm install
npm run build:web          # team board + ERP -> web/
npm run serve              # run the server alone: http://localhost:8080
npm start                  # run the program (Electron)
npm run dist:win           # Windows program in dist/
```

To update the ERP, replace `erp-source/DroneForge_Pro_EU.html` and rebuild. The build fails
loudly if the ERP's structure changed in a way the bridge depends on.
