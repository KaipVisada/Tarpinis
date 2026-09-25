"use strict";
/* Access from outside the office network, and the extra backup copy.
   - Requests from this PC and from private networks (office Wi-Fi) are let in as before.
   - Anything else (the internet, or Tailscale's 100.x addresses) is refused unless the
     admin has set a remote-access password; then it gets a sign-in page first.
   Settings live in files in the data folder, never in the shared store. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function isPrivate(ip) {
  ip = String(ip || "").replace(/^::ffff:/, "");
  if (ip === "::1" || ip.startsWith("127.")) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + ".tmp", JSON.stringify(v, null, 2)); fs.renameSync(f + ".tmp", f); };

class Remote {
  constructor(dataDir) { this.file = path.join(dataDir, "remote-access.json"); this.fails = new Map(); this.cfg = readJson(this.file, {}); if (!this.cfg.secret) { this.cfg.secret = crypto.randomBytes(32).toString("hex"); this.save(); } }
  save() { try { writeJson(this.file, this.cfg); } catch (e) {} }
  get enabled() { return !!(this.cfg.enabled && this.cfg.hash); }
  status() { return { enabled: this.enabled, setAt: this.cfg.setAt || null }; }
  set(enabled, password) {
    if (enabled) {
      if (password) { if (String(password).length < 8) throw { code: "invalid_argument", message: "Use at least 8 characters." }; this.cfg.salt = crypto.randomBytes(16).toString("hex"); this.cfg.hash = crypto.scryptSync(String(password), this.cfg.salt, 32).toString("hex"); this.cfg.setAt = Date.now(); this.cfg.secret = crypto.randomBytes(32).toString("hex"); }
      else if (!this.cfg.hash) throw { code: "invalid_argument", message: "Choose a password." };
    }
    this.cfg.enabled = !!enabled; this.save(); return this.status();
  }
  check(password) { if (!this.cfg.hash) return false; const h = crypto.scryptSync(String(password || ""), this.cfg.salt, 32); return crypto.timingSafeEqual(h, Buffer.from(this.cfg.hash, "hex")); }
  token() { const exp = Date.now() + 30 * 86400000; const sig = crypto.createHmac("sha256", this.cfg.secret).update(String(exp)).digest("hex"); return `${exp}.${sig}`; }
  valid(cookie) {
    const m = /(?:^|;\s*)tb_auth=(\d+)\.([a-f0-9]{64})/.exec(cookie || ""); if (!m || +m[1] < Date.now()) return false;
    const sig = crypto.createHmac("sha256", this.cfg.secret).update(m[1]).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2]));
  }
  limited(ip) { const f = this.fails.get(ip); return f && f.n >= 5 && Date.now() - f.at < 5 * 60000; }
  failed(ip) { const f = this.fails.get(ip) || { n: 0, at: 0 }; if (Date.now() - f.at > 5 * 60000) f.n = 0; f.n++; f.at = Date.now(); this.fails.set(ip, f); }
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f2817;color:#e5e7eb;font:16px 'Segoe UI',system-ui,sans-serif;padding:16px}
form,div.box{background:#1a2332;border:1px solid #2d3748;border-top:3px solid #5ac991;border-radius:10px;padding:24px;width:min(380px,100%);display:grid;gap:12px}
h1{font-size:20px;margin:0;color:#5ac991}p{margin:0;color:#8b92b1}input{padding:12px;border-radius:8px;border:1px solid #2d3748;background:#1a1f2e;color:#e5e7eb;font-size:16px}
button{padding:12px;border:0;border-radius:8px;background:#5ac991;color:#0b1f15;font-weight:700;font-size:16px;cursor:pointer}.err{color:#ef4444;font-weight:600}</style></head><body>${body}</body></html>`;
const loginPage = err => page("Team Board sign-in", `<form method="post" action="/api/remote-login"><h1>Team Board</h1><p>You're connecting from outside the office network. Enter the remote access password.</p>
${err ? `<p class="err">${err}</p>` : ""}<input type="password" name="password" autocomplete="current-password" required autofocus aria-label="Password"><button>Sign in</button></form>`);
const offPage = () => page("Team Board", `<div class="box"><h1>Team Board</h1><p>Access from outside the office network is turned off. An admin can turn it on in Admin, Settings, on the office PC.</p></div>`);

/* ---- extra backup copy to a folder the admin chooses (USB stick, OneDrive, network drive) ---- */
class Copy {
  constructor(dataDir, store, log) { this.dataDir = dataDir; this.store = store; this.log = log; this.file = path.join(dataDir, "backup-copy.json"); this.cfg = readJson(this.file, {}); }
  status() { return { dir: this.cfg.dir || "", lastCopy: this.cfg.lastCopy || null, lastDay: this.cfg.lastDay || null, error: this.cfg.error || null }; }
  setDir(dir) { dir = String(dir || "").trim(); this.cfg.dir = dir; this.cfg.error = null; this.cfg.lastDay = null; try { writeJson(this.file, this.cfg); } catch (e) {} return dir ? this.run(true) : this.status(); }
  run(force) {
    const dir = this.cfg.dir; if (!dir) return this.status();
    const day = new Date().toISOString().slice(0, 10);
    if (!force && this.cfg.lastDay === day) return this.status();
    try {
      this.store.flush();
      const target = path.join(dir, "Team Board backups"); fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(path.join(this.dataDir, "store.json"), path.join(target, `store-${day}.json`));
      // attached files: copy the ones not there yet
      const src = path.join(this.dataDir, "files"), dst = path.join(target, "files"); fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) if (!fs.existsSync(path.join(dst, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
      const old = fs.readdirSync(target).filter(x => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
      old.slice(0, Math.max(0, old.length - 30)).forEach(x => { try { fs.unlinkSync(path.join(target, x)); } catch (e) {} });
      Object.assign(this.cfg, { lastCopy: Date.now(), lastDay: day, error: null });
    } catch (e) { this.cfg.error = `${e.message}`; this.log.error("Backup copy failed", e); }
    try { writeJson(this.file, this.cfg); } catch (e) {}
    return this.status();
  }
}
module.exports = { isPrivate, Remote, Copy, loginPage, offPage };
