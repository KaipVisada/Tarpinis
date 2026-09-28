/* ================= GPAIS packaging accounting: a tab inside the DroneForge ERP =================
   Records the packaging that comes in with purchased goods (for example goods imported from EU
   suppliers) and packaging released with sold goods, and builds the quarterly packaging summary.

   Data lives in the ERP's own data (db.gp*), saved with the ERP's saveDB like everything else:
     gpMaterials   internal packaging materials + their GPAIS mapping (code/name/source, verified)
     gpCategories  internal packaging categories + GPAIS mapping
     gpPack        packaging per ERP material/product unit, with valid-from/valid-to versions
     gpDocs        shipments / invoices (incoming or outgoing) with item lines and shipment packaging
     gpRecords     calculated GPAIS accounting records (one per document line x packaging)
     gpPeriods     quarter locks;  gpSupplierInfo  supplier country / EU;  gpAudit  change history
   Official GPAIS codes, rules and the GPAIS API are NOT built in. Codes are entered by an admin
   with their source and marked verified or not. */
(function () {
  "use strict";
  const GP = window.GP = { view: "overview", recF: { q: "", quarter: "", material: "", supplier: "", status: "active", dir: "" }, repQ: "", repDir: "in", repEU: true, packItem: "", docF: { q: "", status: "" } };

  /* ---------- exact numbers: weights in whole milligrams, quantities in thousandths ---------- */
  function decToInt(v, digits) {
    if (v === null || v === undefined || v === "") return null;
    let s = String(v).trim().replace(/\s/g, "").replace(",", ".");
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === "-" || s === "." || s === "") return NaN;
    const neg = s.startsWith("-"); if (neg) s = s.slice(1);
    let [i, f = ""] = s.split("."); i = i || "0";
    const extra = f.slice(digits); f = (f + "0".repeat(digits)).slice(0, digits);
    let n = BigInt(i) * 10n ** BigInt(digits) + BigInt(f || "0"); if (extra && +extra[0] >= 5) n += 1n;
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) return NaN; return Number(neg ? -n : n);
  }
  const toMg = (v, unit) => decToInt(v, { mg: 0, g: 3, kg: 6 }[String(unit || "kg").toLowerCase()] ?? NaN);
  const qMilli = v => decToInt(v, 3);
  function lineMg(wMg, perMilli, qtyMilli) { const p = BigInt(wMg) * BigInt(perMilli) * BigInt(qtyMilli); let q = p / 1000000n; if ((p % 1000000n) * 2n >= 1000000n) q += 1n; return Number(q); }
  function mulMilli(a, b) { const p = BigInt(a) * BigInt(b); let q = p / 1000n; if ((p % 1000n) * 2n >= 1000n) q += 1n; return Number(q); }
  const kg = mg => { mg = Math.round(mg || 0); const neg = mg < 0; const s = String(Math.abs(mg)).padStart(7, "0"); return (neg ? "-" : "") + Number(s.slice(0, -6)).toLocaleString("en-US") + "." + s.slice(-6, -3); };
  const kgIn = mg => mg == null ? "" : (mg / 1e6).toString();
  const qn = m => { m = m || 0; return (m % 1000 ? (m / 1000).toFixed(3).replace(/0+$/, "") : String(m / 1000)); };
  GP.units = { decToInt, toMg, qMilli, lineMg, mulMilli, kg };

  /* ---------- helpers ---------- */
  const E = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const $ = s => document.querySelector(s);
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const isoDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const quarterOf = d => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
  const quarterMonths = q => { const [y, n] = q.split("-Q"); return [0, 1, 2].map(i => `${y}-${String((n - 1) * 3 + i + 1).padStart(2, "0")}`); };
  const dayBefore = d => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  function hash(s) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ (c + 31 * i), 2246822507) >>> 0; } return h1.toString(36) + h2.toString(36); }
  const toast = (m, t) => (typeof showToast === "function" ? showToast(m, t || "success") : alert(m));
  function who() { try { const p = window.parent; if (p && p !== window && typeof p.me === "function") { const m = p.me(); if (m) return m.name; } } catch (e) {} return "Admin"; }
  const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
  const FLAGS = { primary: "Primary", secondary: "Secondary", transport: "Transport" };

  /* ---------- data ---------- */
  const SEED_MAT = ["Plastic", "Paper", "Cardboard", "Wood", "Glass", "Steel", "Aluminium", "Composite / multi-material", "Other"];
  const SEED_CAT = [["Primary (sales) packaging", "primary"], ["Secondary (grouped) packaging", "secondary"], ["Transport packaging", "transport"]];
  function D() {
    for (const k of ["gpMaterials", "gpCategories", "gpPack", "gpDocs", "gpRecords", "gpPeriods", "gpAudit", "gpSupplierInfo"]) if (!Array.isArray(db[k])) db[k] = [];
    if (!db.gpSettings || typeof db.gpSettings !== "object" || Array.isArray(db.gpSettings)) db.gpSettings = {};
    if (!db.gpSettings.seeded) {
      const at = new Date().toISOString();
      if (!db.gpMaterials.length) SEED_MAT.forEach((n, i) => db.gpMaterials.push({ id: "GM" + (i + 1), name: n, gpaisCode: "", gpaisName: "", codeSource: "", verified: false, active: true, createdAt: at }));
      if (!db.gpCategories.length) SEED_CAT.forEach(([n, k], i) => db.gpCategories.push({ id: "GC" + (i + 1), name: n, kind: k, gpaisCode: "", gpaisName: "", codeSource: "", verified: false, active: true, createdAt: at }));
      db.gpSettings.seeded = at;
    }
    return db;
  }
  function save(what) {
    try { saveDB(); return true; }
    catch (e) { toast("Not saved: " + (e.message || "the Team Board program isn't reachable"), "error"); return false; }
  }
  function audit(type, text, data) { D().gpAudit.unshift({ id: uid("A"), at: new Date().toISOString(), by: who(), type, text: String(text).slice(0, 600), data: data || null }); if (db.gpAudit.length > 3000) db.gpAudit.length = 3000; }
  const mat = id => D().gpMaterials.find(m => m.id === id) || null;
  const cat = id => D().gpCategories.find(c => c.id === id) || null;
  const items = () => [...(db.materials || []).map(m => ({ key: "m:" + m.id, kind: "Material", name: m.name, sku: m.sku || "", unit: m.unit || "pcs", vendor: m.vendor_id })), ...(db.products || []).map(p => ({ key: "p:" + p.id, kind: "Product", name: p.name, sku: p.sku || "", unit: "pcs" }))];
  const item = key => items().find(i => i.key === key) || null;
  const supplier = id => (db.suppliers || []).find(s => Number(s.id) === Number(id)) || null;
  const sInfo = id => D().gpSupplierInfo.find(s => String(s.id) === String(id)) || null;
  const period = q => D().gpPeriods.find(p => p.id === q) || { id: q, status: "open" };
  const closed = q => period(q).status === "closed";
  const packOf = (key, date) => D().gpPack.filter(p => p.item === key && p.active !== false && (!p.validFrom || p.validFrom <= date) && (!p.validTo || p.validTo >= date));
  const packUsed = id => D().gpRecords.filter(r => r.packId === id && r.status === "active").length;

  /* ---------- calculation ---------- */
  function calcDoc(doc) {
    const rows = [];
    for (const l of doc.lines) {
      const packs = packOf(l.item, doc.date);
      if (!packs.length) rows.push({ l, p: null, error: "no_packaging" });
      for (const p of packs) rows.push({ l, p, weightMg: p.weightMg == null ? null : lineMg(p.weightMg, p.qtyPerUnitMilli || 1000, l.qtyMilli), packMilli: mulMilli(l.qtyMilli, p.qtyPerUnitMilli || 1000) });
    }
    for (const x of doc.extra || []) rows.push({ x, weightMg: lineMg(x.weightMg || 0, 1000, x.qtyMilli || 1000), packMilli: x.qtyMilli || 1000 });
    return rows;
  }
  function makeRecord(doc, row, at) {
    const p = row.p, x = row.x, l = row.l;
    const m = mat(p ? p.materialId : x ? x.materialId : null), c = cat(p ? p.categoryId : x ? x.categoryId : null);
    const errors = []; if (l && !p) errors.push("no_packaging"); if (p && p.weightMg == null) errors.push("no_weight"); if (!m && (p || x)) errors.push("no_material"); if (!c && (p || x)) errors.push("no_category");
    const it = l ? item(l.item) : null;
    return {
      id: "R" + hash(doc.id + "|" + (l ? l.key : x.key) + "|" + (p ? p.id : x ? "extra" : "none")), docId: doc.id, docNumber: doc.number, docDate: doc.date, direction: doc.direction,
      month: doc.date.slice(0, 7), quarter: quarterOf(doc.date), lineKey: l ? l.key : x.key, source: l ? "item" : "shipment",
      item: l ? l.item : null, itemName: l ? (it ? it.name : l.itemName) : "Shipment packaging", itemSku: it ? it.sku : "", itemQtyMilli: l ? l.qtyMilli : null,
      packId: p ? p.id : null, packName: p ? p.name : x ? x.name : null, materialId: m ? m.id : null, materialName: m ? m.name : null, gpaisMaterialCode: m ? m.gpaisCode || "" : "",
      categoryId: c ? c.id : null, categoryName: c ? c.name : null, gpaisCategoryCode: c ? c.gpaisCode || "" : "", reusable: !!(p ? p.reusable : x && x.reusable),
      weightPerUnitMg: p ? p.weightMg : x ? x.weightMg : null, qtyPerUnitMilli: p ? p.qtyPerUnitMilli || 1000 : null, packQtyMilli: row.packMilli || 0, weightMg: row.weightMg || 0,
      partner: doc.partner, supplierId: doc.supplierId || null, country: doc.country, eu: !!doc.eu,
      status: "active", manual: false, errors, corrections: [], auto: { weightMg: row.weightMg || 0, itemQtyMilli: l ? l.qtyMilli : null, packQtyMilli: row.packMilli || 0 },
      createdAt: at, createdBy: who()
    };
  }
  /* ---------- actions ---------- */
  function lockCheck(q, what) {
    if (!closed(q)) return true;
    return confirm(`${q} is closed. ${what} will be marked as a change after closing and logged. Continue?`) ? "after" : false;
  }
  function postDoc(id) {
    D(); const doc = db.gpDocs.find(d => d.id === id); if (!doc) return;
    if (doc.status === "posted") { toast(`${doc.number} is already posted. It was not counted twice.`, "info"); return; }
    const lk = lockCheck(quarterOf(doc.date), "Posting"); if (!lk) return;
    const missing = doc.lines.filter(l => !item(l.item)); if (missing.length) { toast(`Item "${missing[0].itemName}" no longer exists in the ERP.`, "error"); return; }
    const at = new Date().toISOString(); let n = 0, w = 0;
    for (const row of calcDoc(doc)) { const r = makeRecord(doc, row, at); if (db.gpRecords.some(x => x.id === r.id)) continue; if (lk === "after") r.afterClose = true; db.gpRecords.push(r); n++; w += r.weightMg; }
    doc.status = "posted"; doc.postedAt = at; doc.postedBy = who();
    audit("posted", `Posted ${doc.direction === "in" ? "incoming" : "outgoing"} ${doc.number} (${doc.partner || "no partner"}): ${n} record(s), ${kg(w)} kg${lk === "after" ? " after the quarter was closed" : ""}`, { docId: id });
    const miss = db.gpRecords.filter(r => r.docId === id && r.status === "active" && r.errors.includes("no_packaging")).length;
    if (save()) { toast(miss ? `Posted: ${kg(w)} kg recorded. ${miss} item(s) have no packaging yet: define it, then press Complete.` : `Posted: ${kg(w)} kg of packaging recorded`, miss ? "warning" : "success"); render(); }
  }
  function completeDoc(id) {   // packaging defined after posting: add the missing records, keep the existing ones
    D(); const doc = db.gpDocs.find(d => d.id === id); if (!doc || doc.status !== "posted") return;
    const lk = lockCheck(quarterOf(doc.date), "Completing"); if (!lk) return;
    const at = new Date().toISOString(); let n = 0;
    const recs = db.gpRecords.filter(r => r.docId === id && r.status === "active");
    for (const row of calcDoc(doc)) {
      if (!row.p) continue;
      const ph = recs.find(r => r.lineKey === row.l.key && !r.packId && r.source === "item");
      const real = recs.some(r => r.lineKey === row.l.key && r.packId);
      if (real && !ph) continue;
      const r = makeRecord(doc, row, at); if (db.gpRecords.some(x => x.id === r.id)) continue; if (lk === "after") r.afterClose = true; db.gpRecords.push(r); n++;
      if (ph) { ph.status = "void"; ph.voidReason = "Replaced: packaging was defined after posting"; ph.corrections.push({ at, by: who(), field: "status", from: "active", to: "void", reason: ph.voidReason }); }
    }
    audit("posted", `Completed ${doc.number}: ${n} record(s) added for items that had no packaging`, { docId: id });
    if (save()) { toast(n ? `${n} record(s) added` : "Nothing to add. Define packaging for the items first."); render(); }
  }
  function voidDoc(id) {
    D(); const doc = db.gpDocs.find(d => d.id === id); if (!doc) return;
    const reason = prompt(`Why is ${doc.number} being voided? Its records stay in the history, marked as voided.`); if (!reason || !reason.trim()) return;
    const lk = lockCheck(quarterOf(doc.date), "Voiding"); if (!lk) return;
    const at = new Date().toISOString();
    db.gpRecords.filter(r => r.docId === id && r.status === "active").forEach(r => { r.status = "void"; r.voidReason = reason; r.manual = true; r.corrections.push({ at, by: who(), field: "status", from: "active", to: "void", reason, afterClose: lk === "after" }); });
    doc.status = "void"; doc.voidReason = reason; doc.voidedAt = at; doc.voidedBy = who();
    audit("void", `Voided ${doc.number}: ${reason}`, { docId: id }); if (save()) render();
  }

  /* ---------- UI shell ---------- */
  const VIEWS = [["overview", "Overview"], ["docs", "Shipments & invoices"], ["packaging", "Item packaging"], ["records", "Accounting records"], ["report", "Quarterly report"], ["validation", "Data check"], ["materials", "Materials & GPAIS codes"], ["import", "Import / export"], ["audit", "History"]];
  function render() {
    const root = $("#gpais"); if (!root) return; D();
    const issues = validate();
    const nav = `<div class="gp-nav">${VIEWS.map(([k, l]) => `<button class="gp-tab${GP.view === k ? " on" : ""}" data-gpview="${k}">${l}${k === "validation" && issues.errors ? ` <span class="badge danger">${issues.errors}</span>` : ""}</button>`).join("")}</div>`;
    let body = ""; try { body = ({ overview: vOverview, docs: vDocs, packaging: vPackaging, records: vRecords, report: vReport, validation: () => vValidation(issues), materials: vMaterials, import: vImport, audit: vAudit }[GP.view] || vOverview)(issues); }
    catch (e) { console.error(e); body = `<div class="dashboard-card"><p>Something went wrong showing this page: ${E(e.message)}</p></div>`; }
    root.innerHTML = nav + body;
  }
  GP.render = render; GP.post = id => postDoc(id);
  GP.go = (v, extra) => { GP.view = v; Object.assign(GP, extra || {}); render(); const r = $("#gpais"); if (r) r.scrollIntoView({ block: "start" }); };

  /* ---------- overview ---------- */
  function sum(rs) { return rs.reduce((s, r) => s + r.weightMg, 0); }
  function vOverview(iss) {
    const q = quarterOf(today()); const y = today().slice(0, 4);
    const act = D().gpRecords.filter(r => r.status === "active");
    const inQ = act.filter(r => r.quarter === q && r.direction === "in"), inEUQ = inQ.filter(r => r.eu), inY = act.filter(r => r.docDate.startsWith(y) && r.direction === "in");
    const outQ = act.filter(r => r.quarter === q && r.direction === "out");
    const byM = {}; inQ.forEach(r => { const k = r.materialName || "No material"; byM[k] = (byM[k] || 0) + r.weightMg; });
    const max = Math.max(1, ...Object.values(byM));
    const noPack = itemsNeedingPackaging();
    const drafts = D().gpDocs.filter(d => d.status === "draft");
    return `<div class="kpi-grid">
      ${kpi(`Incoming packaging, ${q}`, kg(sum(inQ)) + " kg", `${kg(sum(inEUQ))} kg from EU suppliers`)}
      ${kpi(`Incoming packaging, ${y}`, kg(sum(inY)) + " kg", `${D().gpDocs.filter(d => d.status === "posted" && d.direction === "in" && d.date.startsWith(y)).length} documents posted`)}
      ${kpi(`Outgoing with sales, ${q}`, kg(sum(outQ)) + " kg", "packaging released with sold goods")}
      ${kpi("Needs attention", String(iss.errors), `${iss.warnings} warnings`, iss.errors ? "danger" : "", "validation")}
    </div>
    <div class="gp-two"><div class="dashboard-card"><h3 class="card-title">Incoming packaging by material, ${q}</h3>
      ${Object.keys(byM).length ? Object.entries(byM).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="gp-bar"><span>${E(k)}</span><div><i style="width:${Math.max(2, v / max * 100)}%"></i></div><b>${kg(v)} kg</b></div>`).join("") : '<p class="gp-muted">Nothing posted this quarter yet. Register an incoming shipment under "Shipments & invoices".</p>'}
      </div>
      <div class="dashboard-card"><h3 class="card-title">This quarter</h3>
        <p>${q} is <span class="badge ${closed(q) ? "danger" : "success"}">${closed(q) ? "closed" : "open"}</span></p>
        <p class="gp-link" data-gpgo="docs">${drafts.length} draft document(s) not posted yet</p>
        <p class="gp-link" data-gpgo="packaging">${noPack.length} purchased item(s) without packaging defined</p>
        <p class="gp-link" data-gpgo="records" data-gpstatus="manual">${act.filter(r => r.manual && r.quarter === q).length} manually corrected record(s)</p>
        <p class="gp-link" data-gpgo="materials">${D().gpMaterials.filter(m => m.active !== false && !m.gpaisCode).length} material(s) without a GPAIS code</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem"><button class="btn btn-primary" data-gpnewdoc="in">+ Incoming shipment</button><button class="btn btn-secondary" data-gpgo="report">Quarterly report</button></div></div></div>`;
  }
  const kpi = (l, v, sub, cls, go) => `<div class="kpi-card${go ? " gp-link" : ""}"${go ? ` data-gpgo="${go}"` : ""} ${cls === "danger" ? 'style="border-left-color:var(--danger)"' : ""}><div class="kpi-label">${E(l)}</div><div class="kpi-value">${E(v)}</div><div class="gp-muted">${E(sub || "")}</div></div>`;
  function itemsNeedingPackaging() {
    const d = today(); const used = new Set(D().gpDocs.filter(x => x.status !== "deleted").flatMap(x => x.lines.map(l => l.item)));
    const vend = new Set(D().gpSupplierInfo.filter(s => s.eu).map(s => String(s.id)));
    return items().filter(i => (used.has(i.key) || (i.vendor != null && vend.has(String(i.vendor)))) && !packOf(i.key, d).length);
  }

  /* ---------- documents (shipments / invoices) ---------- */
  function vDocs() {
    const s = GP.docF.q.toLowerCase();
    const list = D().gpDocs.filter(d => d.status !== "deleted" && (!GP.docF.status || d.status === GP.docF.status) && (!s || `${d.number} ${d.partner} ${d.country} ${d.lines.map(l => l.itemName).join(" ")}`.toLowerCase().includes(s))).sort((a, b) => (a.date < b.date ? 1 : -1));
    return `<div class="dashboard-card"><div class="card-header"><h3 class="card-title" style="margin:0;padding:0;border:0">Shipments & invoices</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-primary" data-gpnewdoc="in">+ Incoming shipment</button><button class="btn btn-secondary" data-gpnewdoc="out">+ Outgoing (sale)</button></div></div>
      <p class="gp-muted">Register each purchase invoice or delivery that brings goods in (for example from an EU supplier). The packaging is calculated from each item's packaging definition. Posting creates the accounting records; a document can only be posted once.</p>
      <div class="controls"><div class="search-box"><input id="gpDocQ" placeholder="Search number, supplier, item..." value="${E(GP.docF.q)}"></div>
        <select id="gpDocSt"><option value="">All</option><option value="draft"${GP.docF.status === "draft" ? " selected" : ""}>Drafts</option><option value="posted"${GP.docF.status === "posted" ? " selected" : ""}>Posted</option><option value="void"${GP.docF.status === "void" ? " selected" : ""}>Voided</option></select></div>
      <div class="gp-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Number</th><th>Direction</th><th>Supplier / customer</th><th>Country</th><th>Items</th><th>Packaging</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(d => { const recs = db.gpRecords.filter(r => r.docId === d.id && r.status === "active"); const errs = recs.filter(r => r.errors.length).length;
        return `<tr><td>${E(d.date)}</td><td><b>${E(d.number)}</b>${d.poNumber ? `<br><small class="gp-muted">PO ${E(d.poNumber)}</small>` : ""}</td><td>${d.direction === "in" ? "Incoming" : "Outgoing"}</td><td>${E(d.partner || "–")}</td><td>${E(d.country || "–")}${d.eu ? ' <span class="badge info">EU</span>' : ""}</td>
        <td>${d.lines.length}${d.extra && d.extra.length ? ` + ${d.extra.length} shipment pkg` : ""}</td><td>${d.status === "posted" ? kg(sum(recs)) + " kg" : "–"}${errs ? ` <span class="badge danger">${errs} error</span>` : ""}</td>
        <td><span class="badge ${d.status === "posted" ? "success" : d.status === "void" ? "danger" : "warning"}">${d.status === "posted" ? "Posted" : d.status === "void" ? "Voided" : "Draft"}</span></td>
        <td style="white-space:nowrap">${d.status === "draft" ? `<button class="btn btn-small btn-secondary" data-gpeditdoc="${d.id}">Edit</button> <button class="btn btn-small btn-primary" data-gppost="${d.id}">Post</button>` : ""}
          ${d.status === "posted" ? `<button class="btn btn-small btn-secondary" data-gpgo="records" data-gpdoc="${d.id}">Records</button> ${recs.some(r => r.errors.includes("no_packaging")) ? `<button class="btn btn-small btn-primary" data-gpcomplete="${d.id}">Complete</button> ` : ""}<button class="btn btn-small btn-danger" data-gpvoid="${d.id}">Void</button>` : ""}
          ${d.status === "draft" ? ` <button class="btn btn-small btn-danger" data-gpdeldoc="${d.id}">Delete</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="9" class="gp-muted" style="text-align:center;padding:2rem">No documents yet.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function docForm(doc) {
    D(); const isNew = !doc; doc = doc || { id: null, direction: GP.newDir || "in", number: "", date: today(), supplierId: "", partner: "", country: "", eu: false, poId: "", lines: [], extra: [], notes: "" };
    GP.draft = JSON.parse(JSON.stringify(doc)); if (!GP.draft.lines.length) GP.draft.lines.push({ key: uid("L"), item: "", itemName: "", qtyMilli: null });
    showModal(docModalHtml(isNew)); docPreview();
  }
  function docModalHtml(isNew) {
    const d = GP.draft; const its = items(); const inc = d.direction === "in";
    const orders = (db.orders || []).filter(o => !d.supplierId || Number(o.supplier) === Number(d.supplierId));
    return `<div class="modal-header"><h2>${isNew ? "New" : "Edit"} ${inc ? "incoming shipment / purchase invoice" : "outgoing sale"}</h2><button class="modal-close" data-gpclose>&times;</button></div>
      <div class="gp-form">
        <div class="form-group"><label>${inc ? "Invoice / delivery note number" : "Invoice number"} *</label><input id="gdNum" value="${E(d.number)}" placeholder="${inc ? "e.g. INV-88213" : "e.g. 2026-00125"}"></div>
        <div class="form-group"><label>Date *</label><input id="gdDate" type="date" value="${E(d.date)}"></div>
        ${inc ? `<div class="form-group"><label>Supplier</label><select id="gdSup"><option value="">Choose…</option>${(db.suppliers || []).map(s => `<option value="${s.id}"${String(s.id) === String(d.supplierId) ? " selected" : ""}>${E(s.name)}</option>`).join("")}<option value="__other"${d.supplierId === "" && d.partner ? " selected" : ""}>Other (type the name)</option></select></div>` : ""}
        <div class="form-group"><label>${inc ? "Supplier name" : "Customer"}</label><input id="gdPartner" value="${E(d.partner)}"></div>
        <div class="form-group"><label>Country (2 letters)</label><input id="gdCountry" maxlength="2" value="${E(d.country)}" placeholder="e.g. DE" style="text-transform:uppercase"></div>
        <div class="form-group"><label>&nbsp;</label><label class="gp-check"><input type="checkbox" id="gdEU"${d.eu ? " checked" : ""}> ${inc ? "Imported from another EU country" : "Sold to another EU country"}</label></div>
        ${inc ? `<div class="form-group"><label>Purchase order (optional)</label><select id="gdPO"><option value="">None</option>${orders.map(o => `<option value="${o.id}"${String(o.id) === String(d.poId) ? " selected" : ""}>${E(o.num)} · ${E((supplier(o.supplier) || {}).name || "")}</option>`).join("")}</select></div>` : ""}
      </div>
      <h4 class="gp-h4">Items ${inc ? "received" : "sold"}</h4>
      <table class="data-table gp-lines"><thead><tr><th>Item</th><th style="width:130px">Quantity</th><th>Packaging per unit</th><th></th></tr></thead><tbody>
      ${d.lines.map((l, i) => { const packs = l.item ? packOf(l.item, d.date) : [];
        return `<tr><td><select data-gdline="${i}" data-f="item"><option value="">Choose an item…</option>${its.map(x => `<option value="${x.key}"${x.key === l.item ? " selected" : ""}>${E(x.name)}${x.sku ? " (" + E(x.sku) + ")" : ""} · ${x.kind}</option>`).join("")}</select></td>
          <td><input data-gdline="${i}" data-f="qty" value="${l.qtyMilli == null ? "" : qn(l.qtyMilli)}" inputmode="decimal"></td>
          <td>${!l.item ? "" : packs.length ? packs.map(p => `${E(p.name)} ${kg(p.weightMg)} kg`).join(", ") : `<span class="badge danger">No packaging defined</span> <a href="#" class="gp-link" data-gpdefine="${l.item}">Define</a>`}</td>
          <td><button class="btn btn-small btn-danger" data-gdrm="${i}">×</button></td></tr>`; }).join("")}
      </tbody></table><button class="btn btn-small btn-secondary" data-gdadd>+ Add item</button>
      <h4 class="gp-h4">Shipment packaging <small class="gp-muted">(pallets, wrap film, crates that came with the whole delivery, not per item)</small></h4>
      <table class="data-table gp-lines"><thead><tr><th>What</th><th>Material</th><th>Category</th><th style="width:110px">Weight each (kg)</th><th style="width:90px">Pieces</th><th></th></tr></thead><tbody>
      ${(d.extra || []).map((x, i) => `<tr><td><input data-gdx="${i}" data-f="name" value="${E(x.name)}" placeholder="e.g. Wooden pallet"></td>
        <td><select data-gdx="${i}" data-f="materialId">${opts(db.gpMaterials, x.materialId)}</select></td><td><select data-gdx="${i}" data-f="categoryId">${opts(db.gpCategories, x.categoryId)}</select></td>
        <td><input data-gdx="${i}" data-f="weight" value="${kgIn(x.weightMg)}" inputmode="decimal"></td><td><input data-gdx="${i}" data-f="qty" value="${x.qtyMilli == null ? "1" : qn(x.qtyMilli)}" inputmode="decimal"></td>
        <td><button class="btn btn-small btn-danger" data-gdxrm="${i}">×</button></td></tr>`).join("")}
      </tbody></table><button class="btn btn-small btn-secondary" data-gdxadd>+ Add shipment packaging</button>
      <div class="form-group" style="margin-top:1rem"><label>Notes</label><textarea id="gdNotes" rows="2">${E(d.notes || "")}</textarea></div>
      <h4 class="gp-h4">Calculated packaging</h4><div id="gdPreview"></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-gpclose>Cancel</button><button class="btn btn-secondary" data-gdsave="draft">Save draft</button><button class="btn btn-primary" data-gdsave="post">Save and post</button></div>`;
  }
  const opts = (list, sel) => `<option value="">–</option>` + list.filter(x => x.active !== false || x.id === sel).map(x => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${E(x.name)}</option>`).join("");
  function readDocForm() {
    const d = GP.draft; if (!d) return;
    const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    d.number = (v("gdNum") || "").trim(); d.date = v("gdDate") || d.date; d.partner = (v("gdPartner") || "").trim(); d.country = (v("gdCountry") || "").trim().toUpperCase(); d.eu = !!(document.getElementById("gdEU") || {}).checked; d.notes = v("gdNotes") || "";
    if (document.getElementById("gdSup")) { const s = v("gdSup"); d.supplierId = s && s !== "__other" ? s : ""; }
    if (document.getElementById("gdPO")) d.poId = v("gdPO") || "";
  }
  function docPreview() {
    const box = $("#gdPreview"); if (!box || !GP.draft) return; readDocForm();
    const d = GP.draft; const valid = { ...d, lines: d.lines.filter(l => l.item && l.qtyMilli > 0), date: isoDate(d.date) ? d.date : today() };
    const rows = calcDoc(valid); const tot = {}; let all = 0;
    rows.forEach(r => { const m = (mat(r.p ? r.p.materialId : r.x && r.x.materialId) || {}).name || "No material"; tot[m] = (tot[m] || 0) + (r.weightMg || 0); all += r.weightMg || 0; });
    box.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Item</th><th>Packaging</th><th>Calculation</th><th style="text-align:right">kg</th></tr></thead><tbody>
      ${rows.map(r => r.x ? `<tr><td>Shipment</td><td>${E(r.x.name || "–")}</td><td>${qn(r.x.qtyMilli || 1000)} × ${kg(r.x.weightMg || 0)} kg</td><td style="text-align:right">${kg(r.weightMg)}</td></tr>`
        : !r.p ? `<tr><td>${E((item(r.l.item) || {}).name || "")}</td><td colspan="3"><span class="badge danger">No packaging defined on ${E(valid.date)}</span></td></tr>`
        : `<tr><td>${E((item(r.l.item) || {}).name || "")}</td><td>${E(r.p.name)} · ${E((mat(r.p.materialId) || {}).name || "no material")}</td><td>${qn(r.l.qtyMilli)} × ${(r.p.qtyPerUnitMilli || 1000) !== 1000 ? qn(r.p.qtyPerUnitMilli) + " × " : ""}${kg(r.p.weightMg || 0)} kg</td><td style="text-align:right">${kg(r.weightMg || 0)}</td></tr>`).join("")}
      </tbody></table><p style="margin-top:.5rem"><b>Total ${kg(all)} kg</b> · ${Object.entries(tot).map(([k, v]) => `${E(k)} ${kg(v)} kg`).join(" · ")}</p>` : '<p class="gp-muted">Add items and quantities to see the packaging.</p>';
  }
  function saveDocForm(andPost) {
    readDocForm(); const d = GP.draft; D();
    if (!d.number) return toast("Enter the document number.", "error"); if (!isoDate(d.date)) return toast("Enter the date.", "error");
    const lines = d.lines.filter(l => l.item || l.qtyMilli);
    for (const [i, l] of lines.entries()) { if (!item(l.item)) return toast(`Item line ${i + 1}: choose an item.`, "error"); if (!(l.qtyMilli > 0)) return toast(`Item line ${i + 1}: the quantity must be more than 0.`, "error"); }
    for (const [i, x] of (d.extra || []).entries()) { if (!x.name) return toast(`Shipment packaging ${i + 1}: enter what it is.`, "error"); if (!(x.weightMg > 0)) return toast(`Shipment packaging ${i + 1}: enter the weight.`, "error"); if (!(x.qtyMilli > 0)) x.qtyMilli = 1000; }
    if (!lines.length && !(d.extra || []).length) return toast("Add at least one item or shipment packaging line.", "error");
    const s = d.supplierId ? supplier(d.supplierId) : null; if (s && !d.partner) d.partner = s.name;
    const dup = db.gpDocs.find(x => x.id !== d.id && x.status !== "deleted" && x.direction === d.direction && x.number.toLowerCase() === d.number.toLowerCase() && (x.partner || "").toLowerCase() === (d.partner || "").toLowerCase());
    if (dup) return toast(`${d.number} from ${d.partner || "this partner"} is already registered (${dup.status}). It can't be counted twice.`, "error");
    if (closed(quarterOf(d.date)) && !confirm(`${quarterOf(d.date)} is closed. Add this document anyway? It will be logged.`)) return;
    if (s && (d.country || d.eu)) { const si = sInfo(s.id); if (si) { si.country = d.country; si.eu = d.eu; } else db.gpSupplierInfo.push({ id: String(s.id), country: d.country, eu: d.eu }); }
    const po = d.poId ? (db.orders || []).find(o => String(o.id) === String(d.poId)) : null;
    const at = new Date().toISOString();
    const doc = { ...d, lines: lines.map(l => ({ key: l.key || uid("L"), item: l.item, itemName: (item(l.item) || {}).name || l.itemName, qtyMilli: l.qtyMilli })), extra: (d.extra || []).map(x => ({ ...x, key: x.key || uid("X") })), poNumber: po ? po.num : "", status: "draft", modifiedAt: at, modifiedBy: who() };
    if (!doc.id) { doc.id = uid("DOC"); doc.createdAt = at; doc.createdBy = who(); db.gpDocs.push(doc); } else { const i = db.gpDocs.findIndex(x => x.id === doc.id); db.gpDocs[i] = doc; }
    audit("document", `${d.id ? "Changed" : "Registered"} ${doc.direction === "in" ? "incoming" : "outgoing"} ${doc.number} (${doc.partner || "–"}, ${doc.date})`, { docId: doc.id });
    if (!save()) return; hideModal(); GP.draft = null;
    if (andPost) postDoc(doc.id); else { toast("Draft saved"); GP.view = "docs"; render(); }
  }

  /* ---------- item packaging (versioned) ---------- */
  function vPackaging() {
    const its = items(); if (!GP.packItem && its.length) GP.packItem = (itemsNeedingPackaging()[0] || its[0]).key;
    const it = item(GP.packItem); const d = today();
    const all = D().gpPack.filter(p => p.item === GP.packItem).sort((a, b) => (a.name.localeCompare(b.name)) || ((a.validFrom || "") < (b.validFrom || "") ? -1 : 1));
    const cur = packOf(GP.packItem, d); const total = cur.reduce((s, p) => s + mulMilli(p.weightMg || 0, p.qtyPerUnitMilli || 1000), 0);
    return `<div class="dashboard-card"><div class="card-header"><h3 class="card-title" style="margin:0;padding:0;border:0">Packaging per item</h3>
      <select id="gpPackItem" style="max-width:420px">${its.map(x => `<option value="${x.key}"${x.key === GP.packItem ? " selected" : ""}>${E(x.name)}${x.sku ? " (" + E(x.sku) + ")" : ""} · ${x.kind}${packOf(x.key, d).length ? "" : " ⚠"}</option>`).join("")}</select></div>
      <p class="gp-muted">What packaging comes with ONE unit of this item: the box it's in, the bag, the share of a pallet. Keep the parts separate, because GPAIS is reported by material. When a weight changes, the new version starts on a date and older documents keep the old weight.</p>
      ${it ? `<table class="data-table"><thead><tr><th>Packaging</th><th>Material</th><th>Category</th><th style="text-align:right">Weight each</th><th style="text-align:right">Pieces per unit</th><th>Reusable</th><th>Valid</th><th></th></tr></thead><tbody>
      ${all.map(p => { const now = cur.includes(p); const used = packUsed(p.id);
        return `<tr style="${now ? "" : "opacity:.55"}"><td><b>${E(p.name)}</b>${p.notes ? `<br><small class="gp-muted">${E(p.notes)}</small>` : ""}</td><td>${E((mat(p.materialId) || {}).name || "")}${!p.materialId ? '<span class="badge danger">missing</span>' : ""}</td><td>${E((cat(p.categoryId) || {}).name || "")}${!p.categoryId ? '<span class="badge danger">missing</span>' : ""}</td>
          <td style="text-align:right">${p.weightMg == null ? '<span class="badge danger">missing</span>' : kg(p.weightMg) + " kg"}</td><td style="text-align:right">${qn(p.qtyPerUnitMilli || 1000)}</td><td>${p.reusable ? "Yes" : "No"}</td>
          <td><small>${p.validFrom || "always"} → ${p.validTo || "now"}${p.active === false ? " · inactive" : ""}${used ? ` · used ${used}×` : ""}</small></td>
          <td style="white-space:nowrap"><button class="btn btn-small btn-secondary" data-gppackedit="${p.id}">Edit</button> <button class="btn btn-small btn-secondary" data-gppackdup="${p.id}">Duplicate</button> <button class="btn btn-small btn-danger" data-gppackdel="${p.id}">${used ? "Deactivate" : "Remove"}</button></td></tr>`; }).join("") || '<tr><td colspan="8" class="gp-muted" style="text-align:center;padding:1.5rem">No packaging defined for this item yet.</td></tr>'}
      </tbody></table>
      <p style="margin-top:1rem"><b>Total packaging per unit today: ${kg(total)} kg</b></p>
      <button class="btn btn-primary" data-gppackadd>+ Add packaging</button>${GP.pending ? ` <button class="btn btn-secondary" data-gpback>← Back to document ${E(GP.pending.number || "")}</button>` : ""}` : '<p class="gp-muted">There are no materials or products in the ERP yet.</p>'}</div>`;
  }
  function packForm(p, dup) {
    const it = item(GP.packItem); const edit = p && !dup;
    const x = p ? { ...p } : { name: "", materialId: "", categoryId: "", weightMg: null, qtyPerUnitMilli: 1000, reusable: false, validFrom: "", validTo: "", notes: "", active: true };
    const used = edit ? packUsed(p.id) : 0;
    showModal(`<div class="modal-header"><h2>${edit ? "Edit" : "Add"} packaging · ${E(it ? it.name : "")}</h2><button class="modal-close" data-gpclose>&times;</button></div>
      <div class="gp-form"><div class="form-group" style="grid-column:1/-1"><label>Packaging component *</label><input id="gpName" value="${E(x.name)}" placeholder="e.g. Cardboard box, Plastic bag, Share of wooden pallet"></div>
      <div class="form-group"><label>Material</label><select id="gpMat">${opts(D().gpMaterials, x.materialId)}</select></div>
      <div class="form-group"><label>Category</label><select id="gpCat">${opts(D().gpCategories, x.categoryId)}</select></div>
      <div class="form-group"><label>Weight of one piece</label><div style="display:flex;gap:.5rem"><input id="gpW" value="${x.weightMg == null ? "" : kgIn(x.weightMg)}" inputmode="decimal" placeholder="0.350"><select id="gpWU" style="width:80px"><option value="kg">kg</option><option value="g">g</option></select></div></div>
      <div class="form-group"><label>Pieces per unit of the item</label><input id="gpQ" value="${qn(x.qtyPerUnitMilli || 1000)}" inputmode="decimal"><small class="gp-muted">e.g. 0.02 if one pallet carries 50 units</small></div>
      <div class="form-group"><label>Valid from</label><input id="gpFrom" type="date" value="${E(x.validFrom || "")}"></div>
      <div class="form-group"><label>Valid to</label><input id="gpTo" type="date" value="${E(x.validTo || "")}"></div>
      <div class="form-group"><label class="gp-check"><input type="checkbox" id="gpReu"${x.reusable ? " checked" : ""}> Reusable packaging</label><label class="gp-check"><input type="checkbox" id="gpAct"${x.active !== false ? " checked" : ""}> Active</label></div>
      <div class="form-group" style="grid-column:1/-1"><label>Notes</label><input id="gpNotes" value="${E(x.notes || "")}"></div></div>
      ${used ? `<div class="gp-note">Already used by ${used} accounting record(s). If you change the weight, material, category or pieces, the change starts on this date and older records keep the old values:
        <input id="gpEff" type="date" value="${today()}"></div>` : ""}
      <div class="modal-footer"><button class="btn btn-secondary" data-gpclose>Cancel</button><button class="btn btn-primary" data-gppacksave="${edit ? p.id : ""}">Save</button></div>`);
  }
  function savePack(id) {
    D(); const old = id ? db.gpPack.find(p => p.id === id) : null;
    const name = $("#gpName").value.trim(); if (!name) return toast("Enter the packaging name.", "error");
    const w = $("#gpW").value.trim(); const weightMg = w === "" ? null : toMg(w, $("#gpWU").value);
    if (Number.isNaN(weightMg) || (weightMg != null && weightMg < 0)) return toast("The weight must be a number, 0 or more.", "error");
    const q = qMilli($("#gpQ").value || "1"); if (Number.isNaN(q) || !(q > 0)) return toast("Pieces per unit must be more than 0.", "error");
    const vf = $("#gpFrom").value || null, vt = $("#gpTo").value || null; if (vf && vt && vt < vf) return toast("Valid to is before valid from.", "error");
    const d = { item: GP.packItem, name, materialId: $("#gpMat").value || null, categoryId: $("#gpCat").value || null, weightMg, qtyPerUnitMilli: q, reusable: $("#gpReu").checked, validFrom: vf, validTo: vt, active: $("#gpAct").checked, notes: $("#gpNotes").value.trim() };
    const at = new Date().toISOString(); const itName = (item(GP.packItem) || {}).name;
    if (!old) { db.gpPack.push({ id: uid("PK"), ...d, createdAt: at, createdBy: who() }); audit("packaging", `Added packaging "${name}" (${kg(weightMg || 0)} kg) to ${itName}`); }
    else {
      const calc = ["weightMg", "qtyPerUnitMilli", "materialId", "categoryId"].some(k => old[k] !== d[k]);
      if (calc && packUsed(old.id)) {
        const eff = ($("#gpEff") || {}).value; if (!isoDate(eff)) return toast("Choose the date the change starts.", "error");
        if (old.validFrom && eff <= old.validFrom) return toast(`The change must start after ${old.validFrom}.`, "error");
        old.validTo = dayBefore(eff); old.modifiedAt = at; old.modifiedBy = who();
        db.gpPack.push({ id: uid("PK"), ...d, validFrom: eff, validTo: d.validTo && d.validTo >= eff ? d.validTo : null, supersedes: old.id, createdAt: at, createdBy: who() });
        audit("packaging", `New version of "${name}" for ${itName} from ${eff}: ${kg(old.weightMg || 0)} → ${kg(weightMg || 0)} kg. Older documents keep the old value.`);
      } else { Object.assign(old, d, { modifiedAt: at, modifiedBy: who() }); audit("packaging", `Changed packaging "${name}" for ${itName}`); }
    }
    if (save()) { hideModal(); render(); toast("Packaging saved"); }
  }
  function delPack(id) {
    D(); const p = db.gpPack.find(x => x.id === id); if (!p) return;
    if (packUsed(id)) { if (!confirm(`"${p.name}" is used by accounting records, so it can't be removed. Deactivate it instead? It won't be used for new documents.`)) return; p.active = false; audit("packaging", `Deactivated packaging "${p.name}"`); }
    else { if (!confirm(`Remove "${p.name}"?`)) return; db.gpPack = db.gpPack.filter(x => x.id !== id); audit("packaging", `Removed packaging "${p.name}"`); }
    if (save()) render();
  }

  /* ---------- accounting records ---------- */
  function recFilter() {
    const f = GP.recF, s = f.q.toLowerCase();
    return r => (!f.quarter || r.quarter === f.quarter) && (!f.material || (r.materialId || "none") === f.material) && (!f.supplier || (r.partner || "") === f.supplier) && (!f.dir || r.direction === f.dir) && (!f.doc || r.docId === f.doc)
      && (f.status === "all" || (f.status === "active" && r.status === "active") || (f.status === "void" && r.status === "void") || (f.status === "manual" && r.manual && r.status === "active") || (f.status === "error" && r.status === "active" && r.errors.length))
      && (!s || `${r.docNumber} ${r.itemName} ${r.packName} ${r.materialName} ${r.partner}`.toLowerCase().includes(s));
  }
  function quarters() { const q = new Set(D().gpRecords.map(r => r.quarter)); q.add(quarterOf(today())); return [...q].sort().reverse(); }
  function vRecords() {
    const f = GP.recF; const all = D().gpRecords.filter(recFilter()).sort((a, b) => (a.docDate < b.docDate ? 1 : -1));
    const page = all.slice(0, GP.recMore || 300);
    return `<div class="dashboard-card"><div class="card-header"><h3 class="card-title" style="margin:0;padding:0;border:0">Accounting records · ${all.length}</h3><b>${kg(all.filter(r => r.status === "active").reduce((s, r) => s + r.weightMg, 0))} kg</b></div>
      <div class="controls gp-filters"><div class="search-box"><input id="gpRQ" placeholder="Search…" value="${E(f.q)}"></div>
        <select id="gpRQuarter"><option value="">All quarters</option>${quarters().map(q => `<option${q === f.quarter ? " selected" : ""}>${q}</option>`).join("")}</select>
        <select id="gpRDir"><option value="">In and out</option><option value="in"${f.dir === "in" ? " selected" : ""}>Incoming</option><option value="out"${f.dir === "out" ? " selected" : ""}>Outgoing</option></select>
        <select id="gpRMat"><option value="">All materials</option>${D().gpMaterials.map(m => `<option value="${m.id}"${m.id === f.material ? " selected" : ""}>${E(m.name)}</option>`).join("")}<option value="none"${f.material === "none" ? " selected" : ""}>No material</option></select>
        <select id="gpRSup"><option value="">All partners</option>${[...new Set(db.gpRecords.map(r => r.partner).filter(Boolean))].sort().map(p => `<option${p === f.supplier ? " selected" : ""}>${E(p)}</option>`).join("")}</select>
        <select id="gpRSt">${[["active", "Active"], ["manual", "Corrected"], ["error", "With errors"], ["void", "Voided"], ["all", "All"]].map(([k, l]) => `<option value="${k}"${k === f.status ? " selected" : ""}>${l}</option>`).join("")}</select>
        ${f.doc ? `<button class="btn btn-small btn-secondary" data-gpclrdoc>Only document ${E((db.gpDocs.find(d => d.id === f.doc) || {}).number || "")} ×</button>` : ""}</div>
      <div class="gp-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Document</th><th>Partner</th><th>Item</th><th style="text-align:right">Qty</th><th>Packaging</th><th>Material</th><th>Category</th><th style="text-align:right">kg</th><th>Status</th><th></th></tr></thead><tbody>
      ${page.map(r => `<tr style="${r.status === "void" ? "opacity:.5;text-decoration:line-through" : ""}"><td>${E(r.docDate)}</td><td>${E(r.docNumber)}<br><small class="gp-muted">${r.direction === "in" ? "incoming" : "outgoing"}</small></td><td>${E(r.partner || "–")}${r.eu ? ' <span class="badge info">EU</span>' : ""}</td>
        <td>${E(r.itemName)}</td><td style="text-align:right">${r.itemQtyMilli == null ? "–" : qn(r.itemQtyMilli)}</td><td>${E(r.packName || "–")}</td><td>${E(r.materialName || "–")}</td><td>${E(r.categoryName || "–")}</td><td style="text-align:right"><b>${kg(r.weightMg)}</b></td>
        <td>${r.status === "void" ? '<span class="badge danger">Voided</span>' : r.errors.length ? `<span class="badge danger">${r.errors.map(errText).join(", ")}</span>` : r.manual ? '<span class="badge warning">Corrected</span>' : '<span class="badge success">Automatic</span>'}${r.afterClose ? ' <span class="badge warning">after close</span>' : ""}</td>
        <td style="white-space:nowrap"><button class="btn btn-small btn-secondary" data-gpsrc="${r.id}">View source</button> ${r.status === "active" ? `<button class="btn btn-small btn-secondary" data-gpfix="${r.id}">Correct</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="11" class="gp-muted" style="text-align:center;padding:2rem">No records match.</td></tr>'}
      </tbody></table></div>${all.length > page.length ? `<button class="btn btn-secondary" data-gpmore>Show more (${all.length - page.length})</button>` : ""}</div>`;
  }
  const errText = e => ({ no_packaging: "no packaging defined", no_weight: "no weight", no_material: "no material", no_category: "no category" }[e] || e);
  function sourceView(id) {
    const r = D().gpRecords.find(x => x.id === id); if (!r) return; const doc = db.gpDocs.find(d => d.id === r.docId); const it = r.item ? item(r.item) : null; const pk = r.packId ? db.gpPack.find(p => p.id === r.packId) : null;
    const step = (label, value, sub) => `<div class="gp-step"><small>${E(label)}</small><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    showModal(`<div class="modal-header"><h2>Where ${kg(r.weightMg)} kg comes from</h2><button class="modal-close" data-gpclose>&times;</button></div>
      <div class="gp-trace">${step("Packaging amount", `${kg(r.weightMg)} kg ${E(r.materialName || "")}`, E(r.categoryName || ""))}
        ${r.source === "item" ? step("Calculation", `${qn(r.itemQtyMilli)} units × ${qn(r.qtyPerUnitMilli)} × ${kg(r.weightPerUnitMg || 0)} kg`, `packaging "${E(r.packName || "none")}" valid on ${E(r.docDate)}`) : step("Shipment packaging", `${qn(r.packQtyMilli)} × ${kg(r.weightPerUnitMg || 0)} kg`, E(r.packName))}
        ${r.source === "item" ? step("Item", E(r.itemName), `${E(r.itemSku || "")}${it ? "" : " · no longer in the ERP"}`) : ""}
        ${step(doc ? (doc.direction === "in" ? "Incoming document" : "Sales document") : "Document", E(r.docNumber), doc ? `${E(doc.date)} · ${doc.status}${doc.poNumber ? " · PO " + E(doc.poNumber) : ""}` : "document missing")}
        ${step(r.direction === "in" ? "Supplier" : "Customer", E(r.partner || "–"), `${E(r.country || "")}${r.eu ? " · EU" : ""}`)}
        ${step("Accounting period", E(r.quarter), closed(r.quarter) ? "closed" : "open")}</div>
      ${pk ? `<p class="gp-muted">Packaging definition now: ${E(pk.name)} ${kg(pk.weightMg || 0)} kg, valid ${pk.validFrom || "always"} → ${pk.validTo || "now"}. The record keeps the values it was calculated with.</p>` : ""}
      ${r.corrections.length ? `<h4 class="gp-h4">Changes</h4><table class="data-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>${r.corrections.map(c => `<tr><td>${E(c.at.slice(0, 16).replace("T", " "))}</td><td>${E(c.by)}</td><td>${E(c.label || c.field)}</td><td>${E(fmtVal(c.field, c.from))}</td><td>${E(fmtVal(c.field, c.to))}</td><td>${E(c.reason)}${c.afterClose ? " (after close)" : ""}</td></tr>`).join("")}</tbody></table>
        <p class="gp-muted">Originally calculated: ${kg(r.auto.weightMg)} kg${r.auto.itemQtyMilli != null ? ` for ${qn(r.auto.itemQtyMilli)} units` : ""}.</p>` : '<p class="gp-muted">Calculated automatically, not changed by hand.</p>'}
      <div class="modal-footer">${r.status === "active" ? `<button class="btn btn-secondary" data-gpfix="${r.id}">Correct</button><button class="btn btn-danger" data-gpvoidrec="${r.id}">Void record</button>` : r.status === "void" ? `<button class="btn btn-secondary" data-gprestore="${r.id}">Restore</button>` : ""}<button class="btn btn-primary" data-gpclose>Close</button></div>`);
  }
  const fmtVal = (f, v) => v == null ? "–" : f === "weightMg" ? kg(v) + " kg" : /Milli$/.test(f) ? qn(v) : f === "materialId" ? (mat(v) || {}).name || v : f === "categoryId" ? (cat(v) || {}).name || v : String(v);
  function fixForm(id) {
    const r = D().gpRecords.find(x => x.id === id); if (!r) return;
    showModal(`<div class="modal-header"><h2>Correct record · ${E(r.docNumber)} · ${E(r.itemName)}</h2><button class="modal-close" data-gpclose>&times;</button></div>
      <p class="gp-muted">The calculated values are kept. Your change, your name, the time and the reason are saved with the record.</p>
      <div class="gp-form">${r.itemQtyMilli != null ? `<div class="form-group"><label>Item quantity</label><input id="fxQty" value="${qn(r.itemQtyMilli)}"></div>` : ""}
        <div class="form-group"><label>Packaging weight (kg)</label><input id="fxW" value="${kgIn(r.weightMg)}"><small class="gp-muted">Leave as is to recalculate from the quantity</small></div>
        <div class="form-group"><label>Material</label><select id="fxMat">${opts(D().gpMaterials, r.materialId)}</select></div>
        <div class="form-group"><label>Category</label><select id="fxCat">${opts(D().gpCategories, r.categoryId)}</select></div>
        <div class="form-group" style="grid-column:1/-1"><label>Reason *</label><input id="fxWhy" placeholder="e.g. Supplier confirmed lighter boxes on this delivery"></div></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-gpclose>Cancel</button><button class="btn btn-primary" data-gpfixsave="${id}">Save correction</button></div>`);
  }
  function saveFix(id) {
    const r = D().gpRecords.find(x => x.id === id); if (!r) return;
    const reason = $("#fxWhy").value.trim(); if (!reason) return toast("Give a reason for the change.", "error");
    const lk = lockCheck(r.quarter, "This correction"); if (!lk) return;
    const at = new Date().toISOString(); const log = [];
    const set = (field, to, label) => { if (JSON.stringify(r[field]) === JSON.stringify(to)) return; log.push({ at, by: who(), field, label, from: r[field], to, reason, afterClose: lk === "after" }); r[field] = to; };
    const wIn = $("#fxW").value.trim(); const wOld = kgIn(r.weightMg);
    if ($("#fxQty")) { const q = qMilli($("#fxQty").value); if (Number.isNaN(q) || q < 0) return toast("The quantity must be 0 or more.", "error"); if (q !== r.itemQtyMilli) { set("itemQtyMilli", q, "Item quantity"); set("packQtyMilli", mulMilli(q, r.qtyPerUnitMilli || 1000), "Packaging pieces"); if (wIn === wOld && r.weightPerUnitMg != null) set("weightMg", lineMg(r.weightPerUnitMg, r.qtyPerUnitMilli || 1000, q), "Packaging weight"); } }
    if (wIn !== wOld) { const mg = toMg(wIn, "kg"); if (Number.isNaN(mg) || mg < 0) return toast("The weight must be 0 or more.", "error"); set("weightMg", mg, "Packaging weight"); }
    const m = $("#fxMat").value || null, c = $("#fxCat").value || null;
    if (m !== r.materialId) { set("materialId", m, "Material"); r.materialName = m ? mat(m).name : null; r.gpaisMaterialCode = m ? mat(m).gpaisCode || "" : ""; }
    if (c !== r.categoryId) { set("categoryId", c, "Category"); r.categoryName = c ? cat(c).name : null; r.gpaisCategoryCode = c ? cat(c).gpaisCode || "" : ""; }
    if (!log.length) return toast("Nothing was changed.", "info");
    r.corrections = [...r.corrections, ...log]; r.manual = true; r.modifiedAt = at; r.modifiedBy = who();
    r.errors = r.errors.filter(e => !(e === "no_material" && r.materialId) && !(e === "no_category" && r.categoryId) && !(e === "no_weight" && r.weightMg > 0) && !(e === "no_packaging" && r.weightMg > 0));
    audit("correction", `Corrected ${r.docNumber} / ${r.itemName} / ${r.packName || "–"}: ${log.map(l => `${l.label} ${fmtVal(l.field, l.from)} → ${fmtVal(l.field, l.to)}`).join("; ")}. Reason: ${reason}${lk === "after" ? " (closed period)" : ""}`, { recordId: id });
    if (save()) { hideModal(); render(); toast("Correction saved"); }
  }
  function voidRec(id, restore) {
    const r = D().gpRecords.find(x => x.id === id); if (!r) return;
    const reason = prompt(restore ? "Why is this record being restored?" : "Why is this record being voided? It stays in the history."); if (!reason || !reason.trim()) return;
    const lk = lockCheck(r.quarter, restore ? "Restoring" : "Voiding"); if (!lk) return;
    const at = new Date().toISOString(); const to = restore ? "active" : "void";
    r.corrections.push({ at, by: who(), field: "status", label: "Status", from: r.status, to, reason, afterClose: lk === "after" }); r.status = to; r.voidReason = restore ? null : reason; r.manual = true;
    audit(restore ? "correction" : "void", `${restore ? "Restored" : "Voided"} record ${r.docNumber} / ${r.itemName} / ${r.packName || "–"}: ${reason}`, { recordId: id });
    if (save()) { hideModal(); render(); }
  }

  /* ---------- quarterly report ---------- */
  function repRows() { const q = GP.repQ || quarterOf(today()); return D().gpRecords.filter(r => r.status === "active" && r.quarter === q && (!GP.repDir || r.direction === GP.repDir) && (!GP.repEU || r.eu)); }
  function group(rows, key, label) { const g = {}; rows.forEach(r => { const k = key(r) || "none"; const x = g[k] = g[k] || { label: label(r) || "Not set", weightMg: 0, packMilli: 0, records: 0, docs: new Set() }; x.weightMg += r.weightMg; x.packMilli += r.packQtyMilli; x.records++; x.docs.add(r.docId); }); return Object.values(g).sort((a, b) => b.weightMg - a.weightMg); }
  function vReport() {
    const q = GP.repQ || (GP.repQ = quarterOf(today())); const rows = repRows(); const total = sum(rows);
    const cats = D().gpCategories.filter(c => rows.some(r => r.categoryId === c.id)); const noCat = rows.some(r => !r.categoryId);
    const mats = group(rows, r => r.materialId, r => r.materialName);
    const cell = (mId, cId) => kg(rows.filter(r => (r.materialId || "none") === (mId || "none") && (r.categoryId || "none") === (cId || "none")).reduce((s, r) => s + r.weightMg, 0));
    const docs = [...new Set(rows.map(r => r.docId))].map(id => db.gpDocs.find(d => d.id === id)).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
    const unmapped = mats.filter(m => { const r = rows.find(x => (x.materialName || "Not set") === m.label); return !r || !r.gpaisMaterialCode; });
    const errs = rows.filter(r => r.errors.length).length;
    return `<div class="dashboard-card"><div class="card-header"><h3 class="card-title" style="margin:0;padding:0;border:0">Quarterly packaging report</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><select id="gpRepQ">${quarters().map(x => `<option${x === q ? " selected" : ""}>${x}</option>`).join("")}</select>
        <select id="gpRepDir"><option value="in"${GP.repDir === "in" ? " selected" : ""}>Incoming packaging</option><option value="out"${GP.repDir === "out" ? " selected" : ""}>Outgoing with sales</option><option value=""${!GP.repDir ? " selected" : ""}>Both</option></select>
        <label class="gp-check"><input type="checkbox" id="gpRepEU"${GP.repEU ? " checked" : ""}> EU suppliers / customers only</label>
        <button class="btn btn-secondary" data-gpexp="xlsx">Export Excel</button><button class="btn btn-secondary" data-gpexp="csv">Export CSV</button>
        ${closed(q) ? `<button class="btn btn-secondary" data-gpperiod="open">Reopen ${q}</button>` : `<button class="btn btn-primary" data-gpperiod="close">Close ${q}</button>`}</div></div>
      <p>${q}: <b>${kg(total)} kg</b> of packaging in ${docs.length} document(s), ${rows.length} record(s). Period is <span class="badge ${closed(q) ? "danger" : "success"}">${closed(q) ? "closed" : "open"}</span>
        ${errs ? ` <span class="badge danger gp-link" data-gpgo="records" data-gpstatus="error">${errs} record(s) with errors</span>` : ""}${unmapped.length ? ` <span class="badge warning gp-link" data-gpgo="materials">${unmapped.length} material(s) without a GPAIS code</span>` : ""}</p>
      <h4 class="gp-h4">By material and category (kg)</h4>
      <div class="gp-scroll"><table class="data-table"><thead><tr><th>Material</th><th>GPAIS code</th>${cats.map(c => `<th style="text-align:right">${E(c.name)}</th>`).join("")}${noCat ? '<th style="text-align:right">No category</th>' : ""}<th style="text-align:right">Total kg</th></tr></thead><tbody>
      ${mats.map(m => { const r = rows.find(x => (x.materialName || "Not set") === m.label); const mid = r ? r.materialId : null; const mm = mat(mid);
        return `<tr><td><b>${E(m.label)}</b></td><td>${mm && mm.gpaisCode ? E(mm.gpaisCode) + (mm.verified ? "" : ' <span class="badge warning">not verified</span>') : '<span class="badge warning">not mapped</span>'}</td>${cats.map(c => `<td style="text-align:right">${cell(mid, c.id)}</td>`).join("")}${noCat ? `<td style="text-align:right">${cell(mid, null)}</td>` : ""}<td style="text-align:right"><b>${kg(m.weightMg)}</b></td></tr>`; }).join("") || `<tr><td colspan="${3 + cats.length}" class="gp-muted" style="text-align:center;padding:1.5rem">No posted packaging in ${q}${GP.repEU ? " from EU partners" : ""}.</td></tr>`}
      ${mats.length ? `<tr><td><b>Total</b></td><td></td>${cats.map(c => `<td style="text-align:right"><b>${kg(rows.filter(r => r.categoryId === c.id).reduce((s, r) => s + r.weightMg, 0))}</b></td>`).join("")}${noCat ? `<td style="text-align:right"><b>${kg(rows.filter(r => !r.categoryId).reduce((s, r) => s + r.weightMg, 0))}</b></td>` : ""}<td style="text-align:right"><b>${kg(total)}</b></td></tr>` : ""}
      </tbody></table></div>
      <div class="gp-two"><div><h4 class="gp-h4">By ${GP.repDir === "out" ? "customer" : "supplier"}</h4><table class="data-table"><thead><tr><th>Name</th><th>Country</th><th style="text-align:right">Documents</th><th style="text-align:right">kg</th></tr></thead><tbody>
        ${group(rows, r => r.partner, r => r.partner).map(g => { const r = rows.find(x => (x.partner || "Not set") === g.label); return `<tr><td>${E(g.label)}</td><td>${E(r ? r.country : "")}</td><td style="text-align:right">${g.docs.size}</td><td style="text-align:right">${kg(g.weightMg)}</td></tr>`; }).join("")}</tbody></table></div>
        <div><h4 class="gp-h4">By item</h4><table class="data-table"><thead><tr><th>Item</th><th style="text-align:right">kg</th></tr></thead><tbody>
        ${group(rows, r => r.item || "shipment", r => r.itemName).map(g => `<tr><td>${E(g.label)}</td><td style="text-align:right">${kg(g.weightMg)}</td></tr>`).join("")}</tbody></table></div></div>
      <h4 class="gp-h4">Documents in this report</h4><table class="data-table"><thead><tr><th>Date</th><th>Number</th><th>Partner</th><th>Country</th><th style="text-align:right">kg</th></tr></thead><tbody>
        ${docs.map(d => `<tr><td>${E(d.date)}</td><td class="gp-link" data-gpgo="records" data-gpdoc="${d.id}">${E(d.number)}</td><td>${E(d.partner || "")}</td><td>${E(d.country || "")}</td><td style="text-align:right">${kg(rows.filter(r => r.docId === d.id).reduce((s, r) => s + r.weightMg, 0))}</td></tr>`).join("")}</tbody></table>
      <p class="gp-muted" style="margin-top:1rem">This summary is made from your own records. Check the GPAIS codes, categories and which flows must be declared against the official GPAIS instructions before submitting. The program doesn't send anything to GPAIS.</p></div>`;
  }
  function setPeriod(close) {
    D(); const q = GP.repQ || quarterOf(today()); let p = db.gpPeriods.find(x => x.id === q);
    if (close) { const drafts = db.gpDocs.filter(d => d.status === "draft" && quarterOf(d.date) === q).length; const errs = db.gpRecords.filter(r => r.quarter === q && r.status === "active" && r.errors.length).length;
      if (!confirm(`Close ${q}?${drafts ? `\n${drafts} draft document(s) in this quarter are not posted.` : ""}${errs ? `\n${errs} record(s) still have errors.` : ""}\nAfter closing, every change in ${q} asks for confirmation and is logged.`)) return; }
    else { const why = prompt(`Why is ${q} being reopened?`); if (!why || !why.trim()) return; }
    if (!p) { p = { id: q, status: "open", events: [] }; db.gpPeriods.push(p); }
    p.status = close ? "closed" : "open"; p.events = [...(p.events || []), { at: new Date().toISOString(), by: who(), action: close ? "closed" : "reopened" }]; if (close) { p.closedAt = new Date().toISOString(); p.closedBy = who(); }
    audit("period", `${close ? "Closed" : "Reopened"} ${q}`); if (save()) render();
  }
  function exportReport(fmt) {
    const q = GP.repQ || quarterOf(today()); const rows = repRows(); const name = `GPAIS-${q}-${GP.repDir === "in" ? "incoming" : GP.repDir === "out" ? "outgoing" : "all"}${GP.repEU ? "-EU" : ""}`;
    const summary = group(rows, r => (r.materialId || "none") + "|" + (r.categoryId || "none"), r => `${r.materialName || "No material"}|${r.categoryName || "No category"}`).map(g => { const [m, c] = g.label.split("|"); const mm = D().gpMaterials.find(x => x.name === m), cc = db.gpCategories.find(x => x.name === c);
      return { Quarter: q, Material: m, "GPAIS material code": mm ? mm.gpaisCode || "" : "", "Material code verified": mm && mm.gpaisCode ? (mm.verified ? "yes" : "NO") : "", Category: c, "GPAIS category code": cc ? cc.gpaisCode || "" : "", "Weight kg": +(g.weightMg / 1e6).toFixed(3), "Packaging pieces": +(g.packMilli / 1000).toFixed(3), Records: g.records }; });
    const recs = rows.map(r => ({ Date: r.docDate, Document: r.docNumber, Direction: r.direction === "in" ? "incoming" : "outgoing", Partner: r.partner, Country: r.country, EU: r.eu ? "yes" : "no", Item: r.itemName, SKU: r.itemSku, "Item quantity": r.itemQtyMilli == null ? "" : r.itemQtyMilli / 1000, Packaging: r.packName, Material: r.materialName, "GPAIS material code": r.gpaisMaterialCode, Category: r.categoryName, "Weight per piece kg": r.weightPerUnitMg == null ? "" : r.weightPerUnitMg / 1e6, Pieces: r.packQtyMilli / 1000, "Weight kg": +(r.weightMg / 1e6).toFixed(3), Corrected: r.manual ? "yes" : "no", "Record id": r.id }));
    const bySup = group(rows, r => r.partner, r => r.partner).map(g => ({ Partner: g.label, Documents: g.docs.size, "Weight kg": +(g.weightMg / 1e6).toFixed(3) }));
    try {
      if (fmt === "xlsx" && window.XLSX) {
        const wb = XLSX.utils.book_new(); const add = (rs, t) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rs.length ? rs : [{ "": "No data" }]), t);
        add(summary, "Summary"); add(bySup, fmt === "xlsx" && GP.repDir === "out" ? "By customer" : "By supplier"); add(recs, "Records");
        XLSX.writeFile(wb, name + ".xlsx");
      } else {
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`; const csv = rs => rs.length ? [Object.keys(rs[0]).map(esc).join(";"), ...rs.map(r => Object.values(r).map(esc).join(";"))].join("\r\n") : "";
        const blob = new Blob(["﻿" + csv(summary) + "\r\n\r\n" + csv(recs)], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".csv"; document.body.appendChild(a); a.click(); a.remove();
      }
      audit("export", `Exported the ${q} report (${rows.length} records) as ${fmt.toUpperCase()}`); save();
    } catch (e) { toast("Export failed: " + e.message, "error"); }
  }

  /* ---------- data check ---------- */
  function validate() {
    D(); const out = []; const add = (sev, msg, go, extra) => out.push({ sev, msg, go, extra: extra || {} });
    for (const i of itemsNeedingPackaging()) add("error", `${i.name} (${i.kind.toLowerCase()}) is bought or registered but has no packaging defined`, "packaging", { packItem: i.key });
    for (const p of db.gpPack.filter(p => p.active !== false)) { const n = `${(item(p.item) || {}).name || "Unknown item"}: "${p.name}"`;
      if (!item(p.item)) add("error", `${n} belongs to an item that no longer exists in the ERP`, "packaging", { packItem: p.item });
      if (p.weightMg == null || p.weightMg <= 0) add("error", `${n} has no weight`, "packaging", { packItem: p.item });
      if (!p.materialId) add("error", `${n} has no material`, "packaging", { packItem: p.item });
      if (!p.categoryId) add("warning", `${n} has no category`, "packaging", { packItem: p.item }); }
    const seen = {}; db.gpPack.filter(p => p.active !== false).forEach(p => { const k = p.item + "|" + p.name.toLowerCase(); (seen[k] = seen[k] || []).push(p); });
    Object.values(seen).forEach(list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i], b = list[j]; if ((!a.validTo || !b.validFrom || a.validTo >= b.validFrom) && (!b.validTo || !a.validFrom || b.validTo >= a.validFrom)) add("warning", `"${a.name}" for ${(item(a.item) || {}).name} has two versions valid at the same time, so it would be counted twice`, "packaging", { packItem: a.item }); } });
    const errs = db.gpRecords.filter(r => r.status === "active" && r.errors.length); if (errs.length) add("error", `${errs.length} accounting record(s) have errors (${[...new Set(errs.flatMap(r => r.errors))].map(errText).join(", ")})`, "records", { recF: { ...GP.recF, status: "error", quarter: "", doc: "" } });
    db.gpRecords.filter(r => r.status === "active" && (r.weightMg < 0 || (r.itemQtyMilli != null && r.itemQtyMilli < 0))).forEach(r => add("error", `Record ${r.docNumber} / ${r.itemName} has a negative amount`, "records", { recF: { ...GP.recF, doc: r.docId, status: "all" } }));
    db.gpDocs.filter(d => d.status !== "deleted").forEach(d => { d.lines.forEach(l => { if (!item(l.item)) add("error", `${d.number}: item "${l.itemName}" no longer exists in the ERP`, "docs"); });
      if (d.direction === "in" && !d.country) add("warning", `${d.number} (${d.partner || "no supplier"}) has no country, so it can't be sorted into EU / non-EU`, "docs");
      if (d.status === "draft" && d.date < today()) add("info", `${d.number} (${d.date}) is still a draft`, "docs"); });
    const byNum = {}; db.gpDocs.filter(d => d.status === "posted").forEach(d => { const k = d.number.toLowerCase(); (byNum[k] = byNum[k] || []).push(d); });
    Object.values(byNum).filter(l => l.length > 1).forEach(l => add("warning", `Document number ${l[0].number} is posted ${l.length} times (${l.map(d => d.partner || "?").join(", ")}). Check it isn't the same invoice twice.`, "docs"));
    db.gpMaterials.filter(m => m.active !== false && db.gpRecords.some(r => r.materialId === m.id && r.status === "active")).forEach(m => { if (!m.gpaisCode) add("warning", `Material "${m.name}" is used but has no GPAIS code`, "materials"); else if (!m.verified) add("info", `The GPAIS code of "${m.name}" (${m.gpaisCode}) is not marked as verified`, "materials"); });
    db.gpCategories.filter(c => c.active !== false && db.gpRecords.some(r => r.categoryId === c.id && r.status === "active") && !c.gpaisCode).forEach(c => add("warning", `Category "${c.name}" is used but has no GPAIS code`, "materials"));
    const cq = quarterOf(today()); [...new Set(db.gpRecords.map(r => r.quarter))].filter(q => q < cq && !closed(q)).forEach(q => add("info", `${q} is over and not closed yet`, "report", { repQ: q }));
    return { list: out, errors: out.filter(i => i.sev === "error").length, warnings: out.filter(i => i.sev === "warning").length };
  }
  function vValidation(iss) {
    GP.issues = iss.list;
    return `<div class="dashboard-card"><h3 class="card-title">Data check · ${iss.errors} error(s), ${iss.warnings} warning(s)</h3>
      ${iss.list.length ? `<table class="data-table"><tbody>${iss.list.map((i, n) => `<tr><td style="width:100px"><span class="badge ${i.sev === "error" ? "danger" : i.sev === "warning" ? "warning" : "info"}">${i.sev}</span></td><td>${E(i.msg)}</td><td style="text-align:right"><button class="btn btn-small btn-secondary" data-gpissue="${n}">Fix</button></td></tr>`).join("")}</tbody></table>` : '<p>No problems found.</p>'}</div>`;
  }

  /* ---------- materials, categories, GPAIS codes ---------- */
  function vMaterials() {
    const table = (list, kind) => `<table class="data-table"><thead><tr><th>Internal name</th><th>GPAIS code</th><th>GPAIS name</th><th>Where the code comes from</th><th>Verified</th><th>Active</th><th></th></tr></thead><tbody>
      ${list.map(x => `<tr><td><b>${E(x.name)}</b></td><td>${x.gpaisCode ? E(x.gpaisCode) : '<span class="badge warning">not set</span>'}</td><td>${E(x.gpaisName || "")}</td><td><small>${E(x.codeSource || "")}</small></td><td>${x.gpaisCode ? (x.verified ? '<span class="badge success">yes</span>' : '<span class="badge warning">no</span>') : ""}</td><td>${x.active !== false ? "Yes" : "No"}</td>
        <td><button class="btn btn-small btn-secondary" data-gpmedit="${kind}:${x.id}">Edit</button></td></tr>`).join("")}</tbody></table>
      <button class="btn btn-small btn-secondary" data-gpmedit="${kind}:" style="margin-top:.5rem">+ Add ${kind === "m" ? "material" : "category"}</button>`;
    return `<div class="dashboard-card"><h3 class="card-title">Packaging materials</h3><p class="gp-muted">Your own material names are used everywhere in the program. The official GPAIS code is a separate field. Fill it in from the official GPAIS classification, note where it comes from, and mark it verified. Nothing is filled in automatically, and codes can be changed later without changing existing records' materials.</p>${table(D().gpMaterials, "m")}</div>
      <div class="dashboard-card"><h3 class="card-title">Packaging categories</h3>${table(db.gpCategories, "c")}</div>`;
  }
  function matForm(ref) {
    const [k, id] = ref.split(":"); const list = k === "m" ? D().gpMaterials : db.gpCategories; const x = list.find(v => v.id === id) || { name: "", gpaisCode: "", gpaisName: "", codeSource: "", verified: false, active: true };
    showModal(`<div class="modal-header"><h2>${id ? "Edit" : "Add"} ${k === "m" ? "material" : "category"}</h2><button class="modal-close" data-gpclose>&times;</button></div>
      <div class="gp-form"><div class="form-group" style="grid-column:1/-1"><label>Internal name *</label><input id="mName" value="${E(x.name)}"></div>
      <div class="form-group"><label>GPAIS code</label><input id="mCode" value="${E(x.gpaisCode)}"></div><div class="form-group"><label>GPAIS name</label><input id="mGName" value="${E(x.gpaisName)}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>Where the code comes from (document, link, date)</label><input id="mSrc" value="${E(x.codeSource)}"></div>
      <div class="form-group"><label class="gp-check"><input type="checkbox" id="mVer"${x.verified ? " checked" : ""}> Code checked against the official list</label><label class="gp-check"><input type="checkbox" id="mAct"${x.active !== false ? " checked" : ""}> Active</label></div></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-gpclose>Cancel</button><button class="btn btn-primary" data-gpmsave="${ref}">Save</button></div>`);
  }
  function saveMat(ref) {
    const [k, id] = ref.split(":"); D(); const list = k === "m" ? db.gpMaterials : db.gpCategories;
    const name = $("#mName").value.trim(); if (!name) return toast("Enter a name.", "error");
    if (list.some(x => x.id !== id && x.active !== false && x.name.toLowerCase() === name.toLowerCase())) return toast(`"${name}" already exists.`, "error");
    const code = $("#mCode").value.trim(), src = $("#mSrc").value.trim(); if (code && !src) return toast("Enter where the GPAIS code comes from, so it can be checked later.", "error");
    const d = { name, gpaisCode: code, gpaisName: $("#mGName").value.trim(), codeSource: src, verified: !!code && $("#mVer").checked, active: $("#mAct").checked };
    const old = list.find(x => x.id === id);
    if (old) { const was = old.gpaisCode; Object.assign(old, d, { modifiedAt: new Date().toISOString(), modifiedBy: who() }); audit("mapping", `Changed ${k === "m" ? "material" : "category"} "${name}"${was !== code ? `: GPAIS code ${was || "none"} → ${code || "none"}` : ""}`); }
    else { list.push({ id: uid(k === "m" ? "GM" : "GC"), ...d, createdAt: new Date().toISOString(), createdBy: who() }); audit("mapping", `Added ${k === "m" ? "material" : "category"} "${name}"`); }
    if (save()) { hideModal(); render(); }
  }

  /* ---------- import / export ---------- */
  function vImport() {
    const p = GP.imp;
    return `<div class="dashboard-card"><h3 class="card-title">Import packaging definitions</h3>
      <p class="gp-muted">Excel (.xlsx) or CSV with a header row. Columns: <b>item</b> (SKU or name of an ERP material or product), <b>packaging</b>, <b>material</b>, <b>category</b>, <b>weight</b>, <b>unit</b> (kg or g), <b>pieces_per_unit</b> (optional, default 1), <b>reusable</b> (yes/no), <b>valid_from</b> (optional, YYYY-MM-DD), <b>notes</b>. Nothing is imported until you've seen the check below.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><label class="btn btn-primary" style="cursor:pointer">Choose file<input type="file" id="gpImpFile" accept=".xlsx,.xls,.csv" hidden></label><button class="btn btn-secondary" data-gptemplate>Download an example file</button></div>
      ${p ? `<h4 class="gp-h4">${E(p.file)}: ${p.rows.length} row(s)</h4><p><span class="badge success">${p.count.valid} valid</span> <span class="badge warning">${p.count.warning} with warnings</span> <span class="badge danger">${p.count.invalid} invalid</span> <span class="badge info">${p.count.duplicate} duplicate</span></p>
        <div class="gp-scroll" style="max-height:340px"><table class="data-table"><thead><tr><th>Row</th><th>Item</th><th>Packaging</th><th>kg</th><th>Status</th><th>Details</th></tr></thead><tbody>
        ${p.rows.map(r => `<tr><td>${r.row}</td><td>${E(r.itemName || r.raw.item || "")}</td><td>${E(r.raw.packaging || "")}</td><td>${r.weightMg == null ? "" : kg(r.weightMg)}</td><td><span class="badge ${{ valid: "success", warning: "warning", invalid: "danger", duplicate: "info" }[r.status]}">${r.status}</span></td><td><small>${E([...r.errors, ...r.warnings].join("; "))}</small></td></tr>`).join("")}</tbody></table></div>
        <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><button class="btn btn-primary" data-gpimport${p.count.valid + p.count.warning ? "" : " disabled"}>Import ${p.count.valid + p.count.warning} row(s)</button><button class="btn btn-secondary" data-gpimpclear>Cancel</button><span class="gp-muted">Invalid and duplicate rows are left out.</span></div>` : ""}</div>
      <div class="dashboard-card"><h3 class="card-title">Export</h3><p class="gp-muted">The quarterly report has its own Excel and CSV export. Here you can export all records or the packaging definitions.</p>
        <button class="btn btn-secondary" data-gpexpall="records">All accounting records (Excel)</button> <button class="btn btn-secondary" data-gpexpall="packaging">Packaging definitions (Excel)</button></div>
      <div class="dashboard-card"><h3 class="card-title">Sending to GPAIS</h3><p class="gp-muted">The program doesn't send data to GPAIS. That needs the official GPAIS API description and access, which aren't available here. Submit the quarterly figures in GPAIS yourself, using the report and export. The records are grouped by GPAIS code so a direct connection can be added later without changing how they're kept.</p></div>`;
  }
  function parseImport(file) {
    if (!window.XLSX) { toast("The spreadsheet reader isn't loaded.", "error"); return; }
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const wb = XLSX.read(rd.result, { type: "array" }); const ws = wb.Sheets[wb.SheetNames[0]]; const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
        const low = o => { const x = {}; for (const [k, v] of Object.entries(o)) x[String(k).toLowerCase().trim().replace(/[\s-]+/g, "_")] = String(v).trim(); return x; };
        const byName = (list, v) => { const s = String(v || "").toLowerCase(); return s ? list.find(x => x.active !== false && (x.name.toLowerCase() === s || (x.gpaisCode || "").toLowerCase() === s)) || null : null; };
        const its = items(); const seen = new Set(); const count = { valid: 0, warning: 0, invalid: 0, duplicate: 0 };
        const rows = raw.map((o, i) => {
          const r = low(o); const res = { row: i + 2, raw: r, errors: [], warnings: [], status: "valid" };
          const it = its.find(x => x.sku && x.sku.toLowerCase() === (r.item || "").toLowerCase()) || its.find(x => x.name.toLowerCase() === (r.item || "").toLowerCase());
          if (!r.item) res.errors.push("item is missing"); else if (!it) res.errors.push(`"${r.item}" isn't a material or product in the ERP`); res.itemName = it ? it.name : r.item; res.item = it ? it.key : null;
          if (!r.packaging) res.errors.push("packaging name is missing");
          const m = byName(db.gpMaterials, r.material), c = byName(db.gpCategories, r.category);
          if (r.material && !m) res.errors.push(`material "${r.material}" doesn't exist (add it under Materials first)`); if (!r.material) res.warnings.push("no material");
          if (r.category && !c) res.errors.push(`category "${r.category}" doesn't exist`); if (!r.category) res.warnings.push("no category");
          const w = r.weight === "" ? null : toMg(r.weight, r.unit || "kg"); if (w === null) res.warnings.push("no weight"); else if (Number.isNaN(w)) res.errors.push(`weight "${r.weight} ${r.unit || "kg"}" isn't a number in kg or g`); else if (w < 0) res.errors.push("negative weight"); res.weightMg = Number.isNaN(w) ? null : w;
          const q = r.pieces_per_unit ? qMilli(r.pieces_per_unit) : 1000; if (Number.isNaN(q) || !(q > 0)) res.errors.push("pieces_per_unit must be more than 0");
          if (r.valid_from && !isoDate(r.valid_from)) res.errors.push("valid_from must look like 2026-07-01");
          res.data = { item: res.item, name: r.packaging, materialId: m ? m.id : null, categoryId: c ? c.id : null, weightMg: res.weightMg, qtyPerUnitMilli: q, reusable: /^(1|y|yes|true|taip|x)$/i.test(r.reusable || ""), validFrom: r.valid_from || null, validTo: null, active: true, notes: r.notes || "" };
          const key = `${res.item}|${(r.packaging || "").toLowerCase()}|${r.valid_from || ""}`;
          if (res.errors.length) res.status = "invalid";
          else if (seen.has(key)) { res.status = "duplicate"; res.warnings.push("same row earlier in the file"); }
          else if (db.gpPack.some(p => p.item === res.item && p.name.toLowerCase() === r.packaging.toLowerCase() && (p.validFrom || "") === (r.valid_from || "") && p.active !== false)) { res.status = "duplicate"; res.warnings.push("already defined"); }
          else if (res.warnings.length) res.status = "warning";
          seen.add(key); count[res.status]++; return res;
        });
        GP.imp = { file: file.name, rows, count }; render();
      } catch (e) { toast("Couldn't read the file: " + e.message, "error"); }
    };
    rd.readAsArrayBuffer(file);
  }
  function doImport() {
    const p = GP.imp; if (!p) return; D(); const at = new Date().toISOString(); let n = 0;
    p.rows.filter(r => r.status === "valid" || r.status === "warning").forEach(r => { db.gpPack.push({ id: uid("PK"), ...r.data, createdAt: at, createdBy: who() }); n++; });
    audit("import", `Imported ${n} packaging definition(s) from ${p.file} (${p.count.invalid} invalid and ${p.count.duplicate} duplicate rows left out)`);
    if (save()) { GP.imp = null; toast(`${n} packaging definition(s) imported`); render(); }
  }
  function exportAll(what) {
    if (!window.XLSX) return toast("The spreadsheet library isn't loaded.", "error");
    const wb = XLSX.utils.book_new();
    if (what === "records") XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D().gpRecords.map(r => ({ Date: r.docDate, Quarter: r.quarter, Document: r.docNumber, Direction: r.direction, Partner: r.partner, Country: r.country, EU: r.eu ? "yes" : "no", Item: r.itemName, "Item qty": r.itemQtyMilli == null ? "" : r.itemQtyMilli / 1000, Packaging: r.packName, Material: r.materialName, "GPAIS material code": r.gpaisMaterialCode, Category: r.categoryName, "Weight kg": +(r.weightMg / 1e6).toFixed(3), Status: r.status, Corrected: r.manual ? "yes" : "no", Errors: r.errors.join(", "), "Record id": r.id })).concat([]) ), "Records");
    else XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D().gpPack.map(p => { const it = item(p.item) || {}; return { item: it.sku || it.name || p.item, packaging: p.name, material: (mat(p.materialId) || {}).name || "", category: (cat(p.categoryId) || {}).name || "", weight: p.weightMg == null ? "" : p.weightMg / 1e6, unit: "kg", pieces_per_unit: (p.qtyPerUnitMilli || 1000) / 1000, reusable: p.reusable ? "yes" : "no", valid_from: p.validFrom || "", valid_to: p.validTo || "", active: p.active !== false ? "yes" : "no", notes: p.notes || "" }; })), "Packaging");
    XLSX.writeFile(wb, `GPAIS-${what}-${today()}.xlsx`); audit("export", `Exported ${what}`); save();
  }
  function template() {
    if (!window.XLSX) return;
    const its = items().slice(0, 2); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { item: its[0] ? its[0].sku || its[0].name : "SKU-123", packaging: "Cardboard box", material: "Cardboard", category: "Primary (sales) packaging", weight: "0.350", unit: "kg", pieces_per_unit: 1, reusable: "no", valid_from: "", notes: "" },
      { item: its[0] ? its[0].sku || its[0].name : "SKU-123", packaging: "Plastic bag", material: "Plastic", category: "Primary (sales) packaging", weight: "25", unit: "g", pieces_per_unit: 1, reusable: "no", valid_from: "", notes: "" },
      { item: its[0] ? its[0].sku || its[0].name : "SKU-123", packaging: "Share of wooden pallet", material: "Wood", category: "Transport packaging", weight: "18", unit: "kg", pieces_per_unit: "0.02", reusable: "yes", valid_from: "", notes: "one pallet per 50 units" }]), "Packaging");
    XLSX.writeFile(wb, "GPAIS-packaging-import-example.xlsx");
  }

  /* ---------- history ---------- */
  function vAudit() {
    const s = (GP.audQ || "").toLowerCase(); const list = D().gpAudit.filter(a => !s || `${a.text} ${a.by}`.toLowerCase().includes(s)).slice(0, 500);
    return `<div class="dashboard-card"><div class="card-header"><h3 class="card-title" style="margin:0;padding:0;border:0">History of GPAIS changes</h3><div class="search-box"><input id="gpAudQ" placeholder="Search…" value="${E(GP.audQ || "")}"></div></div>
      <table class="data-table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${list.map(a => `<tr><td style="white-space:nowrap">${E(a.at.slice(0, 16).replace("T", " "))}</td><td>${E(a.by)}</td><td>${E(a.text)}</td></tr>`).join("") || '<tr><td colspan="3" class="gp-muted">Nothing yet.</td></tr>'}</tbody></table></div>`;
  }

  /* ---------- modal ---------- */
  function showModal(html) { let m = $("#gp-modal"); if (!m) { m = document.createElement("div"); m.className = "modal"; m.id = "gp-modal"; m.innerHTML = '<div class="modal-content gp-modal-content"></div>'; document.body.appendChild(m); m.addEventListener("click", e => { if (e.target === m) hideModal(); }); bind(m); } m.firstChild.innerHTML = html; m.classList.add("active"); }
  function hideModal() { const m = $("#gp-modal"); if (m) m.classList.remove("active"); GP.draft = null; }

  /* ---------- events ---------- */
  function bind(root) {
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-gpview],[data-gpgo],[data-gpnewdoc],[data-gpeditdoc],[data-gppost],[data-gpcomplete],[data-gpvoid],[data-gpdeldoc],[data-gpclose],[data-gdadd],[data-gdrm],[data-gdxadd],[data-gdxrm],[data-gdsave],[data-gpdefine],[data-gppackadd],[data-gppackedit],[data-gppackdup],[data-gppackdel],[data-gppacksave],[data-gpsrc],[data-gpfix],[data-gpfixsave],[data-gpvoidrec],[data-gprestore],[data-gpmore],[data-gpclrdoc],[data-gpexp],[data-gpperiod],[data-gpissue],[data-gpmedit],[data-gpmsave],[data-gpimport],[data-gpimpclear],[data-gpexpall],[data-gptemplate],[data-gpback]");
      if (!b) return; const d = b.dataset; if (b.tagName === "A") e.preventDefault();
      if (d.gpview) return GP.go(d.gpview);
      if (d.gpgo) { const extra = {}; if (d.gpgo === "records") extra.recF = { ...GP.recF, doc: d.gpdoc || "", status: d.gpstatus || "active", quarter: d.gpdoc || d.gpstatus ? "" : GP.recF.quarter }; hideModal(); return GP.go(d.gpgo, extra); }
      if (d.gpnewdoc) { GP.newDir = d.gpnewdoc; return docForm(null); }
      if (d.gpeditdoc) return docForm(db.gpDocs.find(x => x.id === d.gpeditdoc));
      if (d.gppost) return postDoc(d.gppost);
      if (d.gpcomplete) return completeDoc(d.gpcomplete);
      if (d.gpvoid) return voidDoc(d.gpvoid);
      if (d.gpdeldoc) { const x = db.gpDocs.find(y => y.id === d.gpdeldoc); if (x && confirm(`Delete draft ${x.number}?`)) { x.status = "deleted"; audit("document", `Deleted draft ${x.number}`); if (save()) render(); } return; }
      if (d.gpclose != null) return hideModal();
      if (d.gdadd != null) { readDocForm(); readLines(); GP.draft.lines.push({ key: uid("L"), item: "", itemName: "", qtyMilli: null }); return rerenderDoc(); }
      if (d.gdrm) { readDocForm(); readLines(); GP.draft.lines.splice(+d.gdrm, 1); return rerenderDoc(); }
      if (d.gdxadd != null) { readDocForm(); readLines(); (GP.draft.extra = GP.draft.extra || []).push({ key: uid("X"), name: "", materialId: "", categoryId: (db.gpCategories.find(c => c.kind === "transport") || {}).id || "", weightMg: null, qtyMilli: 1000 }); return rerenderDoc(); }
      if (d.gdxrm) { readDocForm(); readLines(); GP.draft.extra.splice(+d.gdxrm, 1); return rerenderDoc(); }
      if (d.gdsave) { readLines(); return saveDocForm(d.gdsave === "post"); }
      if (d.gpdefine) { readDocForm(); readLines(); GP.packItem = d.gpdefine; GP.pending = GP.draft; hideModal(); GP.view = "packaging"; render(); return; }
      if (d.gpback != null) { const dr = GP.pending; GP.pending = null; GP.view = "docs"; render(); if (dr) { GP.draft = dr; showModal(docModalHtml(!dr.id)); docPreview(); } return; }
      if (d.gppackadd != null) return packForm(null);
      if (d.gppackedit) return packForm(db.gpPack.find(p => p.id === d.gppackedit));
      if (d.gppackdup) { const p = db.gpPack.find(x => x.id === d.gppackdup); return packForm({ ...p, name: p.name + " (copy)" }, true); }
      if (d.gppackdel) return delPack(d.gppackdel);
      if (d.gppacksave != null) return savePack(d.gppacksave || null);
      if (d.gpsrc) return sourceView(d.gpsrc);
      if (d.gpfix) return fixForm(d.gpfix);
      if (d.gpfixsave) return saveFix(d.gpfixsave);
      if (d.gpvoidrec) return voidRec(d.gpvoidrec, false);
      if (d.gprestore) return voidRec(d.gprestore, true);
      if (d.gpmore != null) { GP.recMore = (GP.recMore || 300) + 300; return render(); }
      if (d.gpclrdoc != null) { GP.recF.doc = ""; return render(); }
      if (d.gpexp) return exportReport(d.gpexp);
      if (d.gpperiod) return setPeriod(d.gpperiod === "close");
      if (d.gpissue) { const i = GP.issues[+d.gpissue]; if (i) GP.go(i.go, i.extra); return; }
      if (d.gpmedit != null) return matForm(d.gpmedit);
      if (d.gpmsave) return saveMat(d.gpmsave);
      if (d.gpimport != null) return doImport();
      if (d.gpimpclear != null) { GP.imp = null; return render(); }
      if (d.gpexpall) return exportAll(d.gpexpall);
      if (d.gptemplate != null) return template();
    });
    root.addEventListener("change", e => {
      const t = e.target; const id = t.id;
      if (id === "gpPackItem") { GP.packItem = t.value; return render(); }
      if (id === "gpDocSt") { GP.docF.status = t.value; return render(); }
      if (id === "gpRQuarter") { GP.recF.quarter = t.value; return render(); } if (id === "gpRDir") { GP.recF.dir = t.value; return render(); }
      if (id === "gpRMat") { GP.recF.material = t.value; return render(); } if (id === "gpRSup") { GP.recF.supplier = t.value; return render(); } if (id === "gpRSt") { GP.recF.status = t.value; return render(); }
      if (id === "gpRepQ") { GP.repQ = t.value; return render(); } if (id === "gpRepDir") { GP.repDir = t.value; return render(); } if (id === "gpRepEU") { GP.repEU = t.checked; return render(); }
      if (id === "gpImpFile" && t.files[0]) { parseImport(t.files[0]); t.value = ""; return; }
      if (id === "gdSup") { readDocForm(); const s = supplier(t.value); if (s) { GP.draft.partner = s.name; const si = sInfo(s.id); if (si) { GP.draft.country = si.country || ""; GP.draft.eu = !!si.eu; } } return rerenderDoc(true); }
      if (id === "gdCountry") { const c = t.value.trim().toUpperCase(); const eu = $("#gdEU"); if (eu && c.length === 2) eu.checked = EU.includes(c) && c !== "LT"; docPreview(); return; }
      if (t.dataset.gdline != null || t.dataset.gdx != null || id === "gdDate") { readLines(); if (t.dataset.f === "item" || id === "gdDate") return rerenderDoc(); docPreview(); }
    });
    root.addEventListener("input", e => {
      const id = e.target.id;
      if (id === "gpDocQ") { GP.docF.q = e.target.value; keepFocus(render, id); } if (id === "gpRQ") { GP.recF.q = e.target.value; keepFocus(render, id); } if (id === "gpAudQ") { GP.audQ = e.target.value; keepFocus(render, id); }
      if (e.target.dataset.gdline != null || e.target.dataset.gdx != null) { readLines(); docPreview(); }
    });
  }
  function keepFocus(fn, id) { const el = document.getElementById(id); const p = el ? el.selectionStart : null; fn(); const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} } }
  function readLines() {
    const d = GP.draft; if (!d) return;
    document.querySelectorAll("[data-gdline]").forEach(el => { const l = d.lines[+el.dataset.gdline]; if (!l) return; if (el.dataset.f === "item") { l.item = el.value; l.itemName = (item(el.value) || {}).name || ""; } else { const q = qMilli(el.value); l.qtyMilli = Number.isNaN(q) ? null : q; } });
    document.querySelectorAll("[data-gdx]").forEach(el => { const x = d.extra[+el.dataset.gdx]; if (!x) return; const f = el.dataset.f;
      if (f === "weight") { const mg = toMg(el.value, "kg"); x.weightMg = Number.isNaN(mg) ? null : mg; } else if (f === "qty") { const q = qMilli(el.value); x.qtyMilli = Number.isNaN(q) ? null : q; } else x[f] = el.value; });
  }
  function rerenderDoc(fresh) { const m = $("#gp-modal .modal-content"); if (!m || !GP.draft) return; if (!fresh) { readDocForm(); readLines(); } const isNew = !GP.draft.id; m.innerHTML = docModalHtml(isNew); docPreview(); }

  /* ---------- hook into the ERP ---------- */
  function install() {
    const main = document.querySelector("main"); const nav = document.querySelector("nav");
    if (!main || !nav || document.getElementById("gpais")) return;
    const sec = document.createElement("div"); sec.id = "gpais"; sec.className = "tab-content"; sec.style.display = "none"; main.appendChild(sec); bind(sec);
    const h = document.createElement("h2"); h.textContent = "Compliance";
    const it = document.createElement("div"); it.className = "nav-item"; it.textContent = "♻️ GPAIS packaging"; it.setAttribute("onclick", "switchTab('gpais', this)");
    const sys = [...nav.querySelectorAll("h2")].find(x => /system/i.test(x.textContent));
    nav.insertBefore(h, sys || null); nav.insertBefore(it, sys || null);
    const orig = window.switchTab;
    window.switchTab = function (name, el) { const r = orig.apply(this, arguments); if (name === "gpais") { try { render(); } catch (e) { console.error(e); } } return r; };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
