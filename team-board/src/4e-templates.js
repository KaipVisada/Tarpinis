/* ================= product templates and quality checks ================= */
const linesOf=v=>String(v||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,60);
function tplFor(pid){const t=tplOf(pid);if(!t)return null;
  return {hoursPerUnit:Math.max(0,+t.hoursPerUnit||0),unit:typeof t.unit==="string"&&t.unit.trim()?t.unit.trim().slice(0,20):"",steps:Array.isArray(t.steps)?t.steps.filter(x=>typeof x==="string").slice(0,60):[],qcItems:Array.isArray(t.qcItems)?t.qcItems.filter(x=>typeof x==="string").slice(0,40):[]}}
/* the parts of a new task that come from the product's template */
function templatePatch(pid,qty,existingSteps=[]){
  const t=tplFor(pid);if(!t)return null;const now=Date.now();const have=new Set(existingSteps.map(x=>x.toLowerCase()));
  const checklist={};t.steps.forEach((s,i)=>{if(!have.has(s.toLowerCase()))checklist[uid("k")]={text:s,done:false,order:now+i}});
  const p={checklist};if(t.hoursPerUnit&&qty)p.estimateH=Math.round(t.hoursPerUnit*qty*100)/100;if(t.unit)p.unit=t.unit;return p;
}
function applyTemplate(id){
  const t=task(id);if(!t)return;const p=templatePatch(t.productId,t.qty,t.checklist.map(c=>c.text));if(!p)return;
  return act(m=>taskUpdate(id,p,`applied the ${t.productName} template`,m.id),{admin:true}).then(ok=>{if(ok)toast("Template applied")});
}
/* ---- admin: Templates tab ---- */
function admTemplates(){
  const ps=erpProducts();
  if(!state.erp)return `<div class="panel empty">Templates are made for products from the ERP, so they need the desktop program.</div>`;
  if(!ps.length)return `<div class="panel empty">There are no products in the ERP yet. Add products and their bills of materials in the ERP tab first.</div>`;
  const sel=state.adm.tpl&&erpProduct(state.adm.tpl)?state.adm.tpl:ps[0].id;const t=tplFor(sel)||{hoursPerUnit:0,unit:"",steps:[],qcItems:[]};const p=erpProduct(sel);
  return `<div class="two"><div class="panel"><div class="panel-h"><h2>Template for</h2><select id="tplSel" aria-label="Product" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:6px 8px">${ps.map(x=>`<option value="${esc(x.id)}"${Number(x.id)===Number(sel)?" selected":""}>${esc(x.name)}${tplOf(x.id)?" ✓":""}</option>`).join("")}</select></div>
    <form id="tplForm" class="grid" data-pid="${esc(sel)}">
      <label>Standard hours per unit<input id="tplHours" type="number" min="0" step="0.05" value="${t.hoursPerUnit||""}" placeholder="e.g. 1.5"></label>
      <label>Unit name<input id="tplUnit" maxlength="20" value="${esc(t.unit)}" placeholder="units"></label>
      <label class="full">Work steps, one per line (become the task checklist)<textarea id="tplSteps" rows="8" placeholder="Fit frame arms&#10;Mount motors&#10;Solder ESCs&#10;Flash firmware&#10;Test flight">${esc(t.steps.join("\n"))}</textarea></label>
      <label class="full">Quality check items, one per line (asked when the task is finished)<textarea id="tplQc" rows="6" placeholder="Frame straight, no cracks&#10;All screws tight&#10;Motors spin the right way&#10;Battery holds charge">${esc(t.qcItems.join("\n"))}</textarea></label>
      <div class="full actions"><button class="btn primary">Save template</button>${tplOf(sel)?`<button type="button" class="btn ghost" data-tpldel="${esc(sel)}">Remove template</button>`:""}</div></form></div>
    <div class="panel"><h2>How templates are used</h2><p style="margin:0 0 8px;max-width:60ch">When someone creates a task for <b>${esc(p?p.name:"this product")}</b>, the task gets these work steps as its checklist, and its estimate is the quantity times the standard hours.</p>
      <p style="margin:0 0 8px;max-width:60ch">When the task is marked as done, the quality check items are asked one by one. The result goes to the ERP's Quality tab.</p>
      <p class="muted" style="margin:0;max-width:60ch">The Production tab compares the real hours per unit with this standard.</p></div></div>`;
}
async function saveTemplate(form){
  const pid=form.dataset.pid;
  await act(async m=>{
    const data={hoursPerUnit:Math.max(0,+$("#tplHours").value||0),unit:$("#tplUnit").value.trim().slice(0,20),steps:linesOf($("#tplSteps").value),qcItems:linesOf($("#tplQc").value),updatedAt:Date.now(),updatedBy:m.id};
    if(await enqueue("templates/"+pid,"set",data)){logEvent("settings",`saved the template for ${(erpProduct(pid)||{}).name||"a product"}`,m.id);toast("Template saved")}
  },{admin:true});
}
/* ---- quality check dialog ---- */
const qcs={id:null,res:{}};
function openQc(id){
  const t=task(id);if(!t)return;const tp=tplFor(t.productId);const items=tp&&tp.qcItems.length?tp.qcItems:[];
  qcs.id=id;qcs.res={};items.forEach((x,i)=>qcs.res[i]="pass");
  $("#qcForm").innerHTML=`<h2>Quality check: ${esc(t.title)}</h2>
    ${items.length?`<div class="qc-list">${items.map((x,i)=>`<div class="qc-row"><span>${esc(x)}</span><div class="seg" role="group" aria-label="${esc(x)}"><button type="button" data-qc="${i}" data-v="pass" aria-pressed="true">Pass</button><button type="button" data-qc="${i}" data-v="fail" aria-pressed="false">Fail</button></div></div>`).join("")}</div>`
      :`<p class="muted" style="margin:0 0 10px">This product has no check items yet (Admin, Templates). Record an overall result instead.</p><label>Score (%)<input id="qcScore" type="number" min="0" max="100" value="100"></label>`}
    <div class="grid" style="margin-top:12px"><label>Result<select id="qcStatus"><option>Pass</option><option>Rework</option><option>Fail</option></select></label><label>Checked on<input id="qcDate" type="date" value="${todayIso()}" max="${todayIso()}"></label>
      <label class="full">Note<input id="qcNote" maxlength="300" placeholder="Optional, e.g. which unit failed"></label></div>
    <div class="actions"><button class="btn primary">Save quality check</button><button type="button" class="btn" data-qcskip>Later</button></div>`;
  $("#qcDlg").showModal();
}
function qcAuto(){const v=Object.values(qcs.res);if(!v.length)return;const f=v.filter(x=>x==="fail").length;$("#qcStatus").value=!f?"Pass":f/v.length>0.5?"Fail":"Rework"}
$("#qcForm").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.qcskip!=null){$("#qcDlg").close();toast("You can record the quality check later from the task.");return}
  if(b.dataset.qc!=null){qcs.res[b.dataset.qc]=b.dataset.v;b.parentElement.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));qcAuto()}
});
$("#qcForm").addEventListener("submit",async e=>{
  e.preventDefault();const t=task(qcs.id);if(!t)return;const tp=tplFor(t.productId);const items=tp?tp.qcItems:[];
  const v=Object.values(qcs.res);const score=v.length?Math.round(v.filter(x=>x==="pass").length/v.length*100):Math.max(0,Math.min(100,+($("#qcScore")||{}).value||0));
  const status=$("#qcStatus").value,note=$("#qcNote").value.trim(),date=$("#qcDate").value||todayIso();
  const ok=await act(m=>taskUpdate(t.id,{qc:{score,status,note,date,by:m.id,at:Date.now(),items:items.map((x,i)=>({item:x,result:qcs.res[i]||"pass"}))}},`recorded a quality check: ${status} (${score}%)`,m.id));
  if(ok){$("#qcDlg").close();toast(`Quality check saved: ${status}. It's in the ERP's Quality tab.`)}
});
const qcWanted=t=>t.productId!=null&&state.settings.qcOnDone!==false&&!t.qc;
