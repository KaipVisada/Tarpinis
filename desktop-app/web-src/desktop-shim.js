/* Desktop adapter: gives the team board the same window.claude.use("db" | "assets" | "downloads" | "user")
   interface it has as a claude.ai artifact, backed by the local Team Board server instead. */
(function () {
  "use strict";
  window.__desktop = true;
  const cache = new Map();                 // path -> {data, v}
  const subs = new Set();                  // {kind, path, filters, orderBy, limit, next}
  let ready, readyResolve; ready = new Promise(r => (readyResolve = r));
  let epoch = null;

  const err = (code, message) => ({ code, message: message || code });
  const parentOf = p => p.split("/").slice(0, -1).join("/");
  const freeze = o => o;

  function snapDoc(path) {
    const d = cache.get(path);
    return { id: path.split("/").pop(), exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d.data)) : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  const OPS = {
    "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
    in: (a, b) => Array.isArray(b) && b.includes(a), "not-in": (a, b) => Array.isArray(b) && !b.includes(a), "array-contains": (a, b) => Array.isArray(a) && a.includes(b)
  };
  function runQuery(q) {
    let rows = [];
    for (const [p, d] of cache) if (parentOf(p) === q.path && q.filters.every(([f, op, v]) => d.data && OPS[op] && OPS[op](d.data[f], v))) rows.push(p);
    rows.sort();
    if (q.orderBy) { const [f, dir] = q.orderBy; rows.sort((a, b) => { const x = cache.get(a).data[f], y = cache.get(b).data[f]; const r = x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1; return dir === "desc" ? -r : r; }); }
    if (q.limit) rows = rows.slice(0, q.limit);
    const docs = rows.map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function notify(path) {
    for (const s of subs) {
      try {
        if (s.kind === "doc" && (path == null || s.path === path)) s.next(snapDoc(s.path));
        if (s.kind === "query" && (path == null || parentOf(path) === s.path)) s.next(runQuery(s));
      } catch (e) { console.error(e); }
    }
  }
  async function post(url, body) {
    let r;
    try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { throw err("unavailable", "The Team Board program isn't reachable"); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw err(j.code || (r.status >= 500 ? "unavailable" : "invalid_argument"), j.message);
    return j;
  }
  async function loadAll() {
    const r = await fetch("/api/store", { cache: "no-store" });
    if (!r.ok) throw new Error("store " + r.status);
    const j = await r.json();
    cache.clear(); for (const [p, d] of Object.entries(j.docs)) cache.set(p, d);
    epoch = j.epoch; readyResolve(); notify(null);
  }
  function connect() {
    const es = new EventSource("/api/events");
    es.addEventListener("hello", e => { const h = JSON.parse(e.data); if (h.epoch !== epoch || cache.size === 0) loadAll().catch(() => {}); else loadAll().catch(() => {}); setBanner(false); });
    es.addEventListener("doc", e => {
      const ev = JSON.parse(e.data);
      const cur = cache.get(ev.path);
      if (ev.data == null) cache.delete(ev.path); else if (!cur || ev.v >= cur.v) cache.set(ev.path, { data: ev.data, v: ev.v }); else return;
      notify(ev.path);
    });
    es.onerror = () => setBanner(true);
  }
  let bannerEl = null;
  function setBanner(on) {
    if (!bannerEl) { bannerEl = document.createElement("div"); bannerEl.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:200;background:#ef4444;color:#fff;text-align:center;padding:6px 12px;font:600 14px 'Segoe UI',sans-serif;display:none"; bannerEl.textContent = "Lost the connection to the Team Board program. Reconnecting…"; document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bannerEl)); if (document.body) document.body.appendChild(bannerEl); }
    bannerEl.style.display = on ? "block" : "none";
  }

  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { await ready; return snapDoc(path); },
      async set(data) { await ready; const j = await post("/api/write", { path, mode: "set", data }); apply(path, j.data); },
      async update(data) { await ready; const j = await post("/api/write", { path, mode: "update", data }); apply(path, j.data); },
      async delete() { await ready; await post("/api/write", { path, mode: "delete" }); apply(path, null); },
      async acquire(o) { return post("/api/acquire", { path, holder: o && o.holder, ttlMs: o && o.ttlMs }); },
      onSnapshot(next, error) { const s = { kind: "doc", path, next }; subs.add(s); ready.then(() => subs.has(s) && next(snapDoc(path))); return () => subs.delete(s); },
      collection(c) { return query(path + "/" + c, [], null, null); }
    };
  }
  function apply(path, data) {
    const cur = cache.get(path);
    if (data == null) cache.delete(path); else cache.set(path, { data, v: (cur ? cur.v : 0) + 0.5 });
    notify(path);
  }
  function query(path, filters, orderBy, limit) {
    const q = { path, filters, orderBy, limit };
    return {
      path,
      where: (f, op, v) => query(path, [...filters, [f, op, v]], orderBy, limit),
      orderBy: (f, dir) => query(path, filters, [f, dir || "asc"], limit),
      limit: n => query(path, filters, orderBy, n),
      async get() { await ready; return runQuery(q); },
      onSnapshot(next, error) { const s = { kind: "query", ...q, next }; subs.add(s); ready.then(() => subs.has(s) && next(runQuery(s))); return () => subs.delete(s); },
      doc: id => docRef(path + "/" + (id || Math.random().toString(36).slice(2) + Date.now().toString(36))),
      async add(data) { const r = docRef(path + "/" + Math.random().toString(36).slice(2) + Date.now().toString(36)); await r.set(data); return r; }
    };
  }
  const db = { doc: docRef, collection: p => query(p, [], null, null) };

  const assets = {
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      let r; try { r = await fetch("/api/blob", { method: "POST", headers: { "Content-Type": type }, body: blob }); } catch (e) { throw err("store_unavailable"); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err(j.code === "too_large" ? "too_large" : "upstream_error");
      return j;
    },
    async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 1e9, maxBytes: 1e15 } }; },
    async delete() { return { deleted: false }; }
  };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = document.createElement("a"); a.href = url; a.download = filename || "download"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); return { saved: true };
    }
  };
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const user = { isOwner: async () => local, canEdit: async () => true, can: async () => true, id: async () => null, me: async () => ({ id: null, name: "", email: null }), profiles: async () => ({}) };

  window.claude = { use: async name => ({ db, assets, downloads, user }[name] || null) };
  loadAll().catch(() => setBanner(true)).finally(connect);
})();
