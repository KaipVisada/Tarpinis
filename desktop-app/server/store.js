"use strict";
/* Document store kept in memory and saved to disk.
   - store.json is rewritten atomically (temp file, flush, rename) shortly after each change,
     so a power cut leaves either the old or the new file, never half of one.
   - The previous good copy is kept as store.prev.json.
   - A dated copy goes to backups/ once a day; the last 60 are kept. */
const fs = require("fs");
const path = require("path");

const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function validPath(p, even) {
  if (typeof p !== "string") return false;
  const s = p.split("/");
  if (s.length > 16 || s.some(x => !SEG.test(x) || x === "." || x === "..")) return false;
  return even ? s.length % 2 === 0 : s.length % 2 === 1;
}
function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  return o;
}
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

class Store {
  constructor(dataDir, log = console) {
    this.dir = dataDir; this.log = log;
    this.file = path.join(dataDir, "store.json");
    this.docs = new Map();            // path -> {data, v}
    this.seq = 0;                      // global change counter
    this.leases = new Map();
    this.listeners = new Set();
    this.dirty = false; this.timer = null;
    this.status = { file: this.file, lastSaved: null, error: null, recoveredFrom: null };
    this.statusListeners = new Set();
    fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
    this.load();
  }
  /* Pick the newest readable copy: store.json, an unfinished save (store.json.tmp) or the previous copy.
     If Windows blocked the last save, the .tmp file holds the newest data, so nothing is lost. */
  load() {
    let best = null;
    for (const f of [this.file, this.file + ".tmp", path.join(this.dir, "store.prev.json")]) {
      try {
        if (!fs.existsSync(f)) continue;
        const j = JSON.parse(fs.readFileSync(f, "utf8"));
        if (!j || typeof j.docs !== "object") continue;
        if (!best || (j.seq || 0) > (best.j.seq || 0)) best = { f, j };
      } catch (e) { this.log.warn(`Skipped unreadable ${path.basename(f)}: ${e.message}`); }
    }
    if (!best) return;
    this.seq = best.j.seq || 0;
    for (const [p, d] of Object.entries(best.j.docs || {})) this.docs.set(p, { data: d.data, v: d.v || 1 });
    this.log.info(`Loaded ${this.docs.size} records from ${path.basename(best.f)}`);
    if (best.f !== this.file) { this.status.recoveredFrom = path.basename(best.f); this.log.warn(`Recovered data from ${best.f}`); this.schedule(); }
  }
  snapshot() {
    const docs = {};
    for (const [p, d] of this.docs) docs[p] = d;
    return { seq: this.seq, docs };
  }
  get(p) { const d = this.docs.get(p); return d ? d.data : undefined; }
  /* mode: set | update | delete. Throws {code} like the artifact store. */
  write(p, mode, data) {
    if (!validPath(p, true)) throw { code: "invalid_argument", message: "bad path" };
    const cur = this.docs.get(p);
    let next;
    if (mode === "delete") { if (!cur) return null; this.docs.delete(p); next = null; }
    else {
      if (!isObj(data)) throw { code: "invalid_argument", message: "body must be an object" };
      if (mode === "update") { if (!cur) throw { code: "invalid_argument", message: "document does not exist" }; next = deepMerge(cur.data, clone(data)); }
      else if (mode === "set") next = clone(data);
      else throw { code: "invalid_argument", message: "bad mode" };
      if (Buffer.byteLength(JSON.stringify(next)) > 8 * 1024 * 1024) throw { code: "invalid_argument", message: "document too large" };
      this.docs.set(p, { data: next, v: (cur ? cur.v : 0) + 1 });
    }
    this.seq++;
    this.changed(p);
    return next;
  }
  changed(p) {
    const d = this.docs.get(p);
    const ev = { path: p, data: d ? d.data : null, v: d ? d.v : 0, seq: this.seq };
    for (const fn of this.listeners) { try { fn(ev); } catch (e) { this.log.error(e); } }
    this.schedule();
  }
  acquire(p, holder, ttlMs) {
    const now = Date.now(); const l = this.leases.get(p);
    ttlMs = Math.min(600000, Math.max(1000, ttlMs || 30000));
    if (l && l.until > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.until).toISOString() };
    this.leases.set(p, { holder, until: now + ttlMs });
    return { acquired: true, holder, expiresAt: new Date(now + ttlMs).toISOString() };
  }
  schedule() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 300); }
  /* Write the whole store to disk. Windows antivirus or OneDrive can briefly lock a file,
     so the final step is retried and falls back to a plain overwrite. */
  flush() {
    if (!this.dirty) return true;
    this.dirty = false;
    const json = JSON.stringify(this.snapshot());
    const tmp = this.file + ".tmp";
    const pause = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} };
    let err = null;
    try {
      const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, json); fs.fsyncSync(fd); fs.closeSync(fd);
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, path.join(this.dir, "store.prev.json")); } catch (e) { this.log.warn("Could not keep the previous copy: " + e.message); }
      let done = false;
      for (let i = 0; i < 8 && !done; i++) { try { fs.renameSync(tmp, this.file); done = true; } catch (e) { err = e; pause(60 * (i + 1)); } }
      if (!done) { fs.writeFileSync(this.file, json); try { fs.unlinkSync(tmp); } catch (e) {} this.log.warn("Saved with a direct write because the file was locked: " + (err && err.message)); }
      err = null;
      try { this.dailyBackup(json); } catch (e) { this.log.warn("Daily backup failed: " + e.message); }
    } catch (e) { err = e; }
    if (err) {
      this.log.error("SAVING FAILED: " + err.message);
      this.dirty = true; setTimeout(() => this.schedule(), 2000);
      this.setStatus({ error: `Can't save to ${this.file}: ${err.message}` });
      return false;
    }
    this.setStatus({ lastSaved: Date.now(), error: null });
    return true;
  }
  setStatus(p) {
    const before = this.status.error;
    Object.assign(this.status, p);
    if (before !== this.status.error) for (const fn of this.statusListeners) { try { fn(this.status); } catch (e) {} }
  }
  dailyBackup(json) {
    const dir = path.join(this.dir, "backups"); const f = path.join(dir, `store-${today()}.json`);
    if (fs.existsSync(f)) return;
    fs.writeFileSync(f, json);
    const old = fs.readdirSync(dir).filter(x => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
    old.slice(0, Math.max(0, old.length - 60)).forEach(x => { try { fs.unlinkSync(path.join(dir, x)); } catch (e) {} });
  }
}
module.exports = { Store, validPath, deepMerge, clone, isObj };
