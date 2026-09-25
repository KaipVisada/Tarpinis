/* ERP bridge: DroneForge Pro was written to keep its data in the browser (localStorage).
   Here every read and save of its data goes to the Team Board server instead, so the TV PC,
   other screens and the team board all share one copy. Saves wait for the server to confirm,
   so nothing is lost if the program closes right after a change. */
(function () {
  "use strict";
  const DB_KEY = "droneforge_pro_complete";
  let base = 0, cached = null, flags = {}, replaceNext = false, lastError = 0;

  function xhr(method, url, body) {
    const x = new XMLHttpRequest();
    x.open(method, url, false);
    if (body !== undefined) x.setRequestHeader("Content-Type", "application/json");
    x.send(body === undefined ? null : JSON.stringify(body));
    let j = {}; try { j = JSON.parse(x.responseText || "{}"); } catch (e) {}
    if (x.status < 200 || x.status >= 300) { const er = new Error(j.message || "Server error " + x.status); er.code = j.code; throw er; }
    return j;
  }
  function fetchDb() {
    const r = xhr("GET", "/api/erp");
    base = r.v; flags = r.flags || {}; cached = JSON.stringify(r.db);
    return cached;
  }
  function saveDb(text, replace) {
    if (!base) { try { fetchDb(); } catch (e) {} if (!base) throw new Error("the ERP data never loaded"); }
    const body = { base, db: JSON.parse(text), replace: !!replace };
    const r = xhr("POST", "/api/erp", body);
    base = r.v;
    if (r.merged && r.db) {                       // someone else changed something meanwhile: take the merged copy
      cached = JSON.stringify(r.db);
      if (typeof window.__erpAdopt === "function") window.__erpAdopt(cached);
    } else cached = text;
    status(true);
  }
  function status(ok, msg) {
    let el = document.getElementById("erp-sync-banner");
    if (!el && document.body) { el = document.createElement("div"); el.id = "erp-sync-banner"; el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:99999;background:#ef4444;color:#fff;padding:10px 16px;border-radius:8px;font:600 14px 'Segoe UI',sans-serif;display:none;max-width:90vw"; document.body.appendChild(el); }
    if (!el) return;
    el.style.display = ok ? "none" : "block"; if (msg) el.textContent = msg;
  }

  window.erpStorage = {
    getItem(k) {
      if (k === DB_KEY) { try { return fetchDb(); } catch (e) { status(false, "Can't reach the Team Board program. Changes won't be saved until it's running."); return cached; } }
      if (/^droneforge_/.test(k)) return Object.prototype.hasOwnProperty.call(flags, k) ? flags[k] : null;
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    setItem(k, v) {
      if (k === DB_KEY) {
        const rep = replaceNext; replaceNext = false;
        try { saveDb(String(v), rep); }
        catch (e) {
          status(false, "This change was NOT saved: " + (e.message || "the Team Board program isn't reachable") + ". Check that it's running, then redo the change.");
          if (Date.now() - lastError > 4000) { lastError = Date.now(); console.error(e); }
          throw e;
        }
        return;
      }
      if (/^droneforge_/.test(k)) { flags[k] = String(v); try { xhr("POST", "/api/erp/flag", { key: k, value: String(v) }); } catch (e) {} return; }
      try { localStorage.setItem(k, v); } catch (e) {}
    },
    removeItem(k) {
      if (k === DB_KEY) { replaceNext = false; saveDb(JSON.stringify({}), true); return; }
      if (/^droneforge_/.test(k)) { delete flags[k]; try { xhr("POST", "/api/erp/flag", { key: k, value: null }); } catch (e) {} return; }
      try { localStorage.removeItem(k); } catch (e) {}
    },
    /* an import or "clear all" replaces the data instead of merging it */
    replaceOnNextSave() { replaceNext = true; }
  };

  /* live updates: when another screen or the team board changes ERP data, reload it here */
  let pendingRefresh = false;
  function refresh() {
    if (document.querySelector(".modal.active")) { pendingRefresh = true; return; }
    pendingRefresh = false;
    if (typeof window.loadDB !== "function") return;
    try {
      window.loadDB();
      if (typeof window.updateNotificationBadge === "function") window.updateNotificationBadge();
      const active = document.querySelector(".nav-item.active");
      if (active && typeof active.onclick === "function") active.onclick.call(active);
    } catch (e) { console.error("ERP refresh failed", e); }
  }
  function listen() {
    const es = new EventSource("/api/events");
    es.addEventListener("doc", e => {
      const ev = JSON.parse(e.data);
      if (ev.path === "erp/main" && ev.v > base) refresh();
    });
    es.addEventListener("hello", () => { try { const r = xhr("GET", "/api/erp"); if (r.v > base) refresh(); } catch (e) {} });
  }
  setInterval(() => { if (pendingRefresh && !document.querySelector(".modal.active")) refresh(); }, 800);
  document.addEventListener("DOMContentLoaded", listen);
})();
