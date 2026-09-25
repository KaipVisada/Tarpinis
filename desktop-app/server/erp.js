"use strict";
/* The ERP (DroneForge Pro) keeps all its data in one object. It lives in the store at
   "erp/main". The ERP page saves the whole object; to stop two screens (or the team board)
   overwriting each other, every save names the version it started from and the server
   merges record by record (by id) onto the current version. */
const { clone, isObj } = require("./store");

const COLLS = ["machines", "production", "materials", "suppliers", "orders", "quality", "planning", "products", "bom", "notifications", "audit"];
const defaults = () => ({ machines: [], production: [], materials: [], suppliers: [], orders: [], quality: [], planning: [], products: [], bom: [], notifications: [], audit: [], settings: { company: "DroneForge Manufacturing", currency: "EUR" } });
const S = v => JSON.stringify(v);
const hasIds = arr => arr.length > 0 && arr.every(x => isObj(x) && x.id != null);

function mergeFields(b, m, t) {
  const o = { ...t };
  for (const k of new Set([...Object.keys(b), ...Object.keys(m)])) if (S(b[k]) !== S(m[k])) { if (m[k] === undefined) delete o[k]; else o[k] = clone(m[k]); }
  return o;
}
function mergeArray(base, mine, theirs) {
  base = Array.isArray(base) ? base : []; mine = Array.isArray(mine) ? mine : []; theirs = Array.isArray(theirs) ? theirs : [];
  if (hasIds(mine) || hasIds(base) || hasIds(theirs)) {
    const key = x => String(x.id);
    const b = new Map(base.filter(isObj).map(x => [key(x), x]));
    const m = new Map(mine.filter(isObj).map(x => [key(x), x]));
    const out = theirs.filter(isObj).map(x => ({ ...x }));
    const idx = new Map(out.map((x, i) => [key(x), i]));
    for (const [k, bx] of b) if (!m.has(k) && idx.has(k)) out[idx.get(k)] = null;          // deleted by me
    for (const [k, mx] of m) {
      const bx = b.get(k);
      if (bx && S(bx) === S(mx)) continue;                                                  // untouched by me
      if (bx && idx.has(k)) { out[idx.get(k)] = mergeFields(bx, mx, out[idx.get(k)]); continue; }  // edited by me: only the fields I changed
      if (bx && !idx.has(k)) continue;                                                      // edited by me, deleted by them: keep deleted
      if (idx.has(k) && S(out[idx.get(k)]) !== S(mx)) {                                     // both added the same id: renumber mine
        const numeric = [...out, ...mine].map(x => x && Number(x.id)).filter(Number.isFinite);
        const nx = clone(mx); nx.id = (numeric.length ? Math.max(...numeric) : 0) + 1;
        out.push(nx); continue;
      }
      if (!idx.has(k)) { const nx = clone(mx); if (mine.indexOf(mx) < mine.length / 2) out.unshift(nx); else out.push(nx); }
    }
    return out.filter(Boolean);
  }
  // lists without ids (audit, notifications): add my new entries, drop the ones I removed
  const bs = new Set(base.map(S)); const ms = new Set(mine.map(S));
  const added = mine.filter(x => !bs.has(S(x)));
  const removed = new Set(base.map(S).filter(s => !ms.has(s)));
  return [...added.map(clone), ...theirs.filter(x => !removed.has(S(x)))];
}
function merge3(base, mine, theirs) {
  const out = clone(theirs);
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine || {})]);
  for (const k of keys) {
    const b = base ? base[k] : undefined, m = mine ? mine[k] : undefined;
    if (S(b) === S(m)) continue;
    if (Array.isArray(m) || Array.isArray(b)) out[k] = mergeArray(b, m, out[k]);
    else if (isObj(m) && isObj(b) && isObj(out[k])) { for (const kk of new Set([...Object.keys(b), ...Object.keys(m)])) if (S(b[kk]) !== S(m[kk])) { if (m[kk] === undefined) delete out[k][kk]; else out[k][kk] = clone(m[kk]); } }
    else if (m === undefined) delete out[k];
    else out[k] = clone(m);
  }
  return out;
}
function normalize(d) {
  const o = Object.assign(defaults(), isObj(d) ? d : {});
  o.settings = Object.assign(defaults().settings, isObj(o.settings) ? o.settings : {});
  COLLS.forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  return o;
}

class Erp {
  constructor(store, log = console) {
    this.store = store; this.log = log; this.history = new Map();
    if (!store.get("erp/main")) store.write("erp/main", "set", defaults());
    // start stock tracking at start-up, so the first report after an upgrade is counted, not baselined
    const d = this.db;
    if ((store.get("config/settings") || {}).consumeStock !== false && !isObj(d.tbStock)) { d.tbStock = { since: new Date().toISOString(), booked: this.baseline() }; store.write("erp/main", "set", d); }
    this.remember();
  }
  get db() { return normalize(this.store.get("erp/main")); }
  get version() { const d = this.store.docs.get("erp/main"); return d ? d.v : 0; }
  remember() {
    this.history.set(this.version, S(this.store.get("erp/main")));
    if (this.history.size > 300) this.history.delete(this.history.keys().next().value);
  }
  put(db) { this.store.write("erp/main", "set", db); this.remember(); }
  /* save from an ERP page: {base, db, replace} -> {v, db, merged} */
  save({ base, db, replace }) {
    if (!isObj(db)) throw { code: "invalid_argument", message: "db must be an object" };
    const cur = this.version;
    if (replace || base === cur) { this.put(db); return { v: this.version, merged: false }; }
    if (!base) throw { code: "invalid_argument", message: "The ERP screen never loaded its data, so it can't save. Reload the ERP tab." };
    const b = this.history.get(base);
    // Unknown starting point (e.g. a phone left open across a restart): apply its additions and edits, never deletions
    if (!b) this.log.warn(`ERP save from an unknown version ${base} (current ${cur}); applying without deletions`);
    const merged = merge3(b ? JSON.parse(b) : defaults(), db, this.store.get("erp/main"));
    this.put(merged);
    return { v: this.version, merged: true, db: merged };
  }
  /* units > 0 takes materials out and adds finished products; units < 0 puts them back */
  book(db, productId, units, auditAdd) {
    const r = v => Math.round(v * 10000) / 10000;
    const product = db.products.find(p => Number(p.id) === Number(productId));
    const bom = db.bom.find(b => b && Number(b.product_id) === Number(productId));
    if (bom && Array.isArray(bom.components)) for (const c of bom.components) {
      const m = db.materials.find(x => x && Number(x.id) === Number(c.id));
      if (m) m.stock = r((Number(m.stock) || 0) - (Number(c.qty) || 1) * units);
    }
    if (product) product.finishedStock = r((Number(product.finishedStock) || 0) + units);
    const name = product ? product.name : "product " + productId;
    auditAdd.push(this.audit(units > 0 ? "Stock out" : "Stock back", "Materials", units > 0 ? `Used materials for ${units} x ${name}; finished stock +${units}` : `Returned materials for ${-units} x ${name} (report corrected)`));
  }
  /* when stock tracking starts, what's already reported counts as done before tracking: nothing is taken out for it */
  baseline() {
    const out = {};
    for (const [p, d] of this.store.docs) {
      if (!/^tasks\/[^/]+$/.test(p) || !d.data || d.data.productId == null) continue;
      const u = isObj(d.data.worklogs) ? Object.values(d.data.worklogs).filter(isObj).reduce((a, w) => a + (Number(w.units) || 0), 0) : 0;
      if (u > 0) out[p.slice(6)] = { productId: Number(d.data.productId), units: Math.round(u * 100) / 100 };
    }
    return out;
  }
  audit(action, entity, details) {
    return { timestamp: new Date().toISOString(), user: "Team board", action, entity, details };
  }
  /* Keep one planning entry and one production order per team-board task with a product and quantity */
  syncTask(id) {
    const t = this.store.get("tasks/" + id);
    const db = this.db; let changed = false; const auditAdd = [];
    const product = t && !t.deleted && t.productId != null ? db.products.find(p => Number(p.id) === Number(t.productId)) : null;
    const qty = t ? Math.max(0, Number(t.qty) || 0) : 0;
    const want = product && qty > 0;
    const units = t && isObj(t.worklogs) ? Object.values(t.worklogs).filter(w => isObj(w)).reduce((a, w) => a + (Number(w.units) || 0), 0) : 0;
    const st = t ? t.status : "todo";
    const planStatus = st === "done" ? "completed" : st === "todo" ? "planned" : "in_progress";
    const prodStatus = st === "done" ? "Completed" : st === "todo" ? "Scheduled" : "In Progress";
    const nextId = arr => Math.max(0, ...arr.map(x => Number(x.id)).filter(Number.isFinite)) + 1;
    const iso = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const start = t && t.createdAt ? iso(t.createdAt) : iso(Date.now());
    const sp = t && t.sprintId ? this.store.get("sprints/" + t.sprintId) : null;
    const end = sp && sp.end && sp.end >= start ? sp.end : iso((t && t.createdAt || Date.now()) + 7 * 86400000);
    const label = t ? `${t.title}` : "";

    const pi = db.planning.findIndex(p => p && p.taskId === id);
    if (!want) { if (pi >= 0) { auditAdd.push(this.audit("DELETE", "Production Plan", `Removed plan for ${db.planning[pi].product} (task removed or has no product)`)); db.planning.splice(pi, 1); changed = true; } }
    else {
      const f = { product_id: product.id, product: product.name, qty, start, end, status: planStatus, taskId: id, source: "Team board", note: label };
      if (pi < 0) { db.planning.push({ id: nextId(db.planning), ...f, createdAt: new Date().toISOString() }); changed = true; auditAdd.push(this.audit("CREATE", "Production Plan", `${product.name} x${qty} from team board task "${label}"`)); }
      else { const p = db.planning[pi]; const keep = { start: p.start }; const nf = { ...f, start: keep.start || start };
        if (Object.keys(nf).some(k => S(p[k]) !== S(nf[k]))) { Object.assign(p, nf); changed = true; } }
    }
    const qi = db.production.findIndex(p => p && p.taskId === id);
    if (!want) { if (qi >= 0) { db.production.splice(qi, 1); changed = true; } }
    else {
      const f = { name: product.name, qty, produced: Math.min(qty, Math.round(units * 100) / 100), status: prodStatus, taskId: id, source: "Team board" };
      if (qi < 0) { db.production.unshift({ id: nextId(db.production), ...f }); changed = true; auditAdd.push(this.audit("Create", "Production", `${product.name} x${qty} from team board`)); }
      else { const p = db.production[qi]; if (Object.keys(f).some(k => S(p[k]) !== S(f[k]))) { const was = p.produced; Object.assign(p, f); changed = true;
        if (f.produced !== was) auditAdd.push(this.audit("Update", "Production", `${product.name}: ${f.produced} of ${qty} produced (team board)`)); } }
    }
    // ---- stock: reported units use up materials (per the BOM) and become finished goods
    const settings = this.store.get("config/settings") || {};
    if (settings.consumeStock !== false) {
      if (!isObj(db.tbStock) || !isObj(db.tbStock.booked)) { db.tbStock = { since: new Date().toISOString(), booked: this.baseline() }; changed = true; }
      const booked = db.tbStock.booked; const cur = booked[id] || null;
      let want;
      if (t && !t.deleted) want = t.productId != null && units > 0 ? { productId: Number(t.productId), units: Math.round(units * 100) / 100 } : null;
      else want = cur;                                   // a deleted task keeps what it used: the parts are gone
      const same = cur && want && cur.productId === want.productId;
      const delta = same ? want.units - cur.units : 0;
      if (cur && !same) { this.book(db, cur.productId, -cur.units, auditAdd); }
      if (want && !same) { this.book(db, want.productId, want.units, auditAdd); }
      if (same && Math.abs(delta) > 1e-9) this.book(db, want.productId, delta, auditAdd);
      if (S(cur) !== S(want)) { if (want) booked[id] = want; else delete booked[id]; changed = true; }
    }
    // ---- quality check from the team board goes to the ERP's Quality tab
    const qi2 = db.quality.findIndex(q => q && q.taskId === id);
    const qc = t && isObj(t.qc) && !t.deleted ? t.qc : null;
    if (qc) {
      const f = { date: qc.date || new Date().toISOString().slice(0, 10), product: (product && product.name) || t.productName || t.title, score: Math.round(Number(qc.score) || 0), status: ["Pass", "Rework", "Fail"].includes(qc.status) ? qc.status : "Pass", taskId: id, source: "Team board", note: String(qc.note || "").slice(0, 300) };
      if (qi2 < 0) { db.quality.unshift({ id: nextId(db.quality), ...f }); changed = true; auditAdd.push(this.audit("Create", "Quality", `${f.product} - Score: ${f.score} (team board)`)); }
      else if (Object.keys(f).some(k => S(db.quality[qi2][k]) !== S(f[k]))) { Object.assign(db.quality[qi2], f); changed = true; }
    } else if (qi2 >= 0 && t && !t.deleted) { db.quality.splice(qi2, 1); changed = true; }
    if (!changed) return false;
    db.audit = [...auditAdd, ...db.audit].slice(0, 100);
    this.put(db);
    return true;
  }
}
module.exports = { Erp, merge3, normalize };
