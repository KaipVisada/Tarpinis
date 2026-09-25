/* ================= work orders: product from the ERP, quantity, daily progress ================= */
const isAdmin=()=>{const m=me();return !!m&&m.access==="admin"};
const fmtN=v=>{v=Math.round((+v||0)*100)/100;return Number.isInteger(v)?String(v):v.toFixed(2).replace(/0$/,"")};
/* ERP data arrives through the same store (desktop app only); null in the web version */
const erpProducts=()=>state.erp&&Array.isArray(state.erp.products)?state.erp.products.filter(p=>p&&p.name).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))):[];
const erpProduct=id=>id==null?null:erpProducts().find(p=>Number(p.id)===Number(id))||null;
const erpMaterial=id=>state.erp&&Array.isArray(state.erp.materials)?state.erp.materials.find(m=>m&&Number(m.id)===Number(id))||null:null;
function erpNeeds(t){
  if(!state.erp||t.productId==null||!t.qty)return null;
  const bom=(state.erp.bom||[]).find(b=>b&&Number(b.product_id)===Number(t.productId));
  if(!bom||!Array.isArray(bom.components)||!bom.components.length)return [];
  return bom.components.map(c=>{const mat=erpMaterial(c.id);const per=+c.qty||1;const need=per*t.qty;const left=per*Math.max(0,t.qty-t.doneUnits);
    const stock=mat?+mat.stock||0:0;return {name:mat?mat.name:c.name||"Unknown material",unit:mat&&mat.unit||"",per,need,left,stock,short:Math.max(0,left-stock)}});
}
function workLine(t){
  if(!t.qty&&!t.productName)return "";
  return `${t.qty?fmtN(t.qty)+" ":""}${esc(t.productName||t.unit)}`;
}
function progHtml(t,size="sm"){
  if(!t.qty)return "";
  const p=Math.min(100,Math.round(t.doneUnits/t.qty*100));
  return `<div class="prog prog-${size}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="${fmtN(t.doneUnits)} of ${fmtN(t.qty)} ${esc(t.unit)} done">
    <div class="prog-l">${p}%</div><div class="prog-track"><i style="width:${p}%"></i></div>
    ${size!=="sm"?`<div class="prog-s">${fmtN(t.doneUnits)} of ${fmtN(t.qty)} ${esc(t.unit)} done${t.doneUnits>=t.qty?" · target reached":""}</div>`:""}</div>`;
}
function productOptions(sel){
  const ps=erpProducts();
  return `<option value="">No product</option>${ps.map(p=>`<option value="${esc(p.id)}"${Number(sel)===Number(p.id)?" selected":""}>${esc(p.name)}${p.sku?" ("+esc(p.sku)+")":""}</option>`).join("")}`;
}
function workSection(t){
  const admin=isAdmin();const hasErp=!!state.erp;
  const needs=erpNeeds(t);
  const edit=admin?`<div class="work-grid">
      ${hasErp?`<label class="wg-prod">Product from the ERP<select id="twProduct">${productOptions(t.productId)}</select></label>`:""}
      <label>Quantity<input id="twQty" type="number" min="0" step="1" value="${t.qty||""}" placeholder="e.g. 15"></label>
      <label>Unit<input id="twUnit" maxlength="20" value="${esc(t.unit)}"></label></div>`
    :(t.qty||t.productName?`<div class="work-line">${t.qty?`<b>${fmtN(t.qty)}</b> `:""}${esc(t.productName||t.unit)}</div>`:"");
  if(!admin&&!t.qty&&!t.productName)return "";
  const mats=needs===null?"":needs.length?`<details class="needs"${needs.some(n=>n.short)?" open":""}><summary>Materials for the ${fmtN(Math.max(0,t.qty-t.doneUnits))} ${esc(t.unit)} still to make${needs.some(n=>n.short)?` <span class="chip bad">${needs.filter(n=>n.short).length} short</span>`:` <span class="chip ok">in stock</span>`}</summary>
      <div class="tbl-scroll"><table><thead><tr><th>Material</th><th class="num">Per unit</th><th class="num">Still needed</th><th class="num">In stock</th><th></th></tr></thead><tbody>
      ${needs.map(n=>`<tr><td>${esc(n.name)}</td><td class="num">${fmtN(n.per)} ${esc(n.unit)}</td><td class="num">${fmtN(n.left)}</td><td class="num">${fmtN(n.stock)}</td><td>${n.short?`<span class="chip bad">short ${fmtN(n.short)}</span>`:'<span class="chip ok">OK</span>'}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Stock and bill of materials come from the ERP. The ERP's Planning tab shows this order with the same check.</p></details>`
    :`<p class="muted" style="font-size:13px;margin:6px 0 0">This product has no bill of materials in the ERP yet, so materials can't be calculated.</p>`;
  return `<section class="tw-sec work"><h3>Work order ${t.productId!=null&&hasErp?'<small class="chip info">linked to ERP</small>':""}</h3>${edit}
    ${progHtml(t,"lg")}
    ${t.qty?`<div><button type="button" class="btn small primary" data-side="worklog">Report today's work</button></div>`:""}
    ${mats}</section>`;
}
function setWork(id,patch,text){
  return act(m=>taskUpdate(id,patch,text,m.id),{admin:true}).then(ok=>{if(!ok)renderTW();return ok});
}
