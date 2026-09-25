"use strict";
/* Local server for Team Board. Serves the app, stores data in <dataDir>, and pushes
   live changes to every open screen (the TV PC and phones on the same network).
   Run on its own with:  node server/index.js --data ./data --port 8080  */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Store, validPath } = require("./store");
const { Erp } = require("./erp");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${port}/`);
  return out;
}
function makeLogger(dataDir) {
  const dir = path.join(dataDir, "logs"); fs.mkdirSync(dir, { recursive: true });
  const w = (lvl, args) => {
    const line = `${new Date().toISOString()} ${lvl} ${args.map(a => (a && a.stack) || (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`;
    try { fs.appendFileSync(path.join(dir, `server-${new Date().toISOString().slice(0, 7)}.log`), line); } catch (e) {}
    (lvl === "ERROR" ? process.stderr : process.stdout).write(line);
  };
  return { info: (...a) => w("INFO", a), warn: (...a) => w("WARN", a), error: (...a) => w("ERROR", a) };
}

function start({ dataDir, staticDir, port = 8080, host = "0.0.0.0", tries = 10 }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const log = makeLogger(dataDir);
  const store = new Store(dataDir, log);
  const erp = new Erp(store, log);
  const blobDir = path.join(dataDir, "files"); fs.mkdirSync(blobDir, { recursive: true });
  const epoch = crypto.randomBytes(6).toString("hex");
  const clients = new Set();

  store.listeners.add(ev => {
    const msg = `event: doc\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(msg);
    if (/^tasks\/[^/]+$/.test(ev.path)) { try { erp.syncTask(ev.path.slice(6)); } catch (e) { log.error("ERP sync failed", e); } }
  });
  setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25000).unref();
  store.statusListeners.add(st => { const msg = `event: status\ndata: ${JSON.stringify(st)}\n\n`; for (const c of clients) c.write(msg); });

  const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(b); };
  const body = (req, limit) => new Promise((ok, bad) => {
    const parts = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { bad({ code: "too_large" }); req.destroy(); } else parts.push(c); });
    req.on("end", () => ok(Buffer.concat(parts))); req.on("error", bad);
  });
  const json = async (req, limit = 20 * 1024 * 1024) => JSON.parse((await body(req, limit)).toString("utf8") || "{}");
  const isLocal = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

  async function api(req, res, url) {
    const p = url.pathname;
    if (p === "/api/store" && req.method === "GET") return send(res, 200, { epoch, ...store.snapshot() });
    if (p === "/api/write" && req.method === "POST") {
      const { path: dp, mode, data } = await json(req);
      try { const out = store.write(dp, mode, data); return send(res, 200, { ok: true, data: out }); }
      catch (e) { return send(res, 400, { code: e.code || "invalid_argument", message: e.message || "" }); }
    }
    if (p === "/api/acquire" && req.method === "POST") {
      const { path: dp, holder, ttlMs } = await json(req);
      if (!validPath(dp, true)) return send(res, 400, { code: "invalid_argument" });
      return send(res, 200, store.acquire(dp, String(holder || ""), ttlMs));
    }
    if (p === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ epoch, seq: store.seq })}\n\n`);
      res.write(`event: status\ndata: ${JSON.stringify(store.status)}\n\n`);
      clients.add(res); req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/erp" && req.method === "GET") return send(res, 200, { v: erp.version, db: erp.db, flags: store.get("erp/flags") || {} });
    if (p === "/api/erp" && req.method === "POST") {
      try { return send(res, 200, erp.save(await json(req, 60 * 1024 * 1024))); }
      catch (e) { log.error("ERP save failed", e); return send(res, 400, { code: e.code || "invalid_argument", message: e.message || "" }); }
    }
    if (p === "/api/erp/flag" && req.method === "POST") {
      const { key, value } = await json(req);
      const flags = { ...(store.get("erp/flags") || {}) };
      if (value == null) delete flags[key]; else flags[key] = String(value);
      store.write("erp/flags", "set", flags); return send(res, 200, { ok: true });
    }
    if (p === "/api/blob" && req.method === "POST") {
      const type = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
      const buf = await body(req, 25 * 1024 * 1024);
      if (!buf.length) return send(res, 400, { code: "invalid_request" });
      const id = crypto.randomBytes(16).toString("hex");
      fs.writeFileSync(path.join(blobDir, id), buf);
      fs.writeFileSync(path.join(blobDir, id + ".json"), JSON.stringify({ type, size: buf.length, at: Date.now() }));
      return send(res, 200, { id, url: "/_blob/" + id, sizeBytes: buf.length, contentType: type });
    }
    if (p === "/api/info") return send(res, 200, { port: server.address().port, lan: lanAddresses(server.address().port), dataDir, local: isLocal(req), save: store.status, records: store.docs.size });
    return send(res, 404, { code: "not_found" });
  }

  function serveFile(res, file, type, extra = {}) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-cache", ...extra });
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname.startsWith("/_blob/")) {
        const id = url.pathname.slice(7);
        if (!/^[a-f0-9]{32}$/.test(id)) { res.writeHead(404); return res.end(); }
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(blobDir, id + ".json"), "utf8")); } catch (e) {}
        return serveFile(res, path.join(blobDir, id), meta.type || "application/octet-stream", { "X-Content-Type-Options": "nosniff" });
      }
      let rel = decodeURIComponent(url.pathname); if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(staticDir, rel));
      if (!file.startsWith(path.normalize(staticDir))) { res.writeHead(403); return res.end(); }
      return serveFile(res, file, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
    } catch (e) {
      log.error("Request failed", req.url, e);
      if (!res.headersSent) send(res, 500, { code: "unavailable", message: "Server error" });
    }
  });

  const flush = () => { try { store.flush(); } catch (e) { log.error(e); } };
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const listen = () => server.listen(port + attempt, host);
    server.on("error", e => {
      if (e.code === "EADDRINUSE" && attempt < tries) { attempt++; setTimeout(listen, 50); }
      else reject(e);
    });
    server.on("listening", () => {
      const pt = server.address().port;
      log.info(`Team Board is running on port ${pt}. Data folder: ${dataDir}`);
      lanAddresses(pt).forEach(a => log.info("On this network: " + a));
      resolve({ port: pt, server, store, erp, flush, lan: () => lanAddresses(pt), log });
    });
    listen();
  });
}
module.exports = { start };

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
  const dataDir = path.resolve(arg("data") || path.join(__dirname, "..", "data"));
  const staticDir = path.resolve(arg("web") || path.join(__dirname, "..", "web"));
  start({ dataDir, staticDir, port: Number(arg("port")) || 8080 }).then(s => {
    const bye = () => { s.flush(); process.exit(0); };
    process.on("SIGINT", bye); process.on("SIGTERM", bye);
  }).catch(e => { console.error(e); process.exit(1); });
}
