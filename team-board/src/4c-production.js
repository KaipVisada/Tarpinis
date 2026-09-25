/* ================= production: output, finished goods, materials, people ================= */
const addDays=(iso0,n)=>{const d=new Date(parseDate(iso0));d.setDate(d.getDate()+n);return iso(d)};
function prevWorkday(ref){let d=addDays(ref||todayIso(),-1);while([0,6].includes(new Date(parseDate(d)).getDay()))d=addDays(d,-1);return d}
const tplOf=pid=>pid==null?null:(state.templates||[]).find(x=>Number(x.id)===Number(pid))||null;
/* every report with units, flattened */
function unitReports(){
  const out=[];
  state.tasks.forEach(t=>{if(!t.qty)return;t.worklogs.forEach(w=>{if(w.units>0||w.hours>0)out.push({date:w.date,by:w.by,units:w.units,hours:w.hours,task:t,productId:t.productId,product:t.productName||t.title})})});
  return out;
}
function bomOf(pid){return state.erp&&pid!=null?(state.erp.bom||[]).find(b=>b&&Number(b.product_id)===Number(pid))||null:null}
/* what all open orders still need, against stock, with how fast each material is being used */
function materialPlan(){
  if(!state.erp)return [];
  const need=new Map();
  const add=(pid,units,label)=>{const b=bomOf(pid);if(!b||!Array.isArray(b.components)||units<=0)return;
    b.components.forEach(c=>{const k=Number(c.id);const e=need.get(k)||{need:0,orders:new Set()};e.need+=(+c.qty||1)*units;e.orders.add(label);need.set(k,e)})};
  liveTasks().forEach(t=>{if(t.productId!=null&&t.status!=="done")add(t.productId,Math.max(0,t.qty-t.doneUnits),shortId(t))});
  (state.erp.planning||[]).forEach(p=>{if(p&&!p.taskId&&p.status!=="completed")add(p.product_id,+p.qty||0,"ERP plan "+(p.product||""))});
  // use per day over the last 14 days, from what was reported
  const from=addDays(todayIso(),-14),use=new Map();
  unitReports().forEach(r=>{if(r.date<from||r.productId==null)return;const b=bomOf(r.productId);if(!b)return;(b.components||[]).forEach(c=>use.set(Number(c.id),(use.get(Number(c.id))||0)+(+c.qty||1)*r.units))});
  const ids=new Set([...need.keys(),...use.keys()]);
  return [...ids].map(id=>{const m=erpMaterial(id);const n=need.get(id);const stock=m?+m.stock||0:0;const perDay=(use.get(id)||0)/14;
    return {id,name:m?m.name:"Material "+id,unit:m&&m.unit||"",stock,need:n?n.need:0,orders:n?[...n.orders]:[],short:Math.max(0,(n?n.need:0)-stock),perDay,days:perDay>0?stock/perDay:null,reorder:m?+m.reorder||0:0}})
    .sort((a,b)=>(b.short>0)-(a.short>0)||(a.days??1e9)-(b.days??1e9)||b.need-a.need);
}
function outputByDay(days){
  const start=addDays(todayIso(),-(days-1));const map={};for(let i=0;i<days;i++)map[addDays(start,i)]=0;
  unitReports().forEach(r=>{if(map[r.date]!=null)map[r.date]+=r.units});return map;
}
function peopleStats(days){
  const from=addDays(todayIso(),-(days-1));const rows={};
  unitReports().forEach(r=>{if(r.date<from)return;const x=rows[r.by]=rows[r.by]||{units:0,hours:0,tasks:new Set()};x.units+=r.units;x.hours+=r.hours;x.tasks.add(r.task.id)});
  return Object.entries(rows).map(([id,x])=>({id,units:x.units,hours:x.hours,rate:x.hours?x.units/x.hours:null,tasks:x.tasks.size})).sort((a,b)=>b.units-a.units);
}
function productStats(days){
  const from=addDays(todayIso(),-(days-1));const rows={};
  unitReports().forEach(r=>{if(r.date<from)return;const k=r.productId!=null?"p"+r.productId:"t"+r.product;const x=rows[k]=rows[k]||{pid:r.productId,name:r.product,units:0,hours:0};x.units+=r.units;x.hours+=r.hours});
  return Object.values(rows).map(x=>{const tp=tplOf(x.pid);const std=tp&&tp.hoursPerUnit>0?tp.hoursPerUnit:null;const act=x.units>0&&x.hours>0?x.hours/x.units:null;
    return {...x,name:(erpProduct(x.pid)||{}).name||x.name,act,std,diff:act!=null&&std?Math.round((act/std-1)*100):null}}).sort((a,b)=>b.units-a.units);
}
function daysText(d){if(d==null)return "–";if(d<1)return "under a day";return Math.floor(d)+" day"+(Math.floor(d)===1?"":"s")}
function outputChart(map){
  const days=Object.keys(map),vals=Object.values(map);const max=Math.max(1,...vals);
  const W=640,H=200,L=30,B=26,T=14,bw=(W-L-8)/days.length;const y=v=>T+(1-v/max)*(H-T-B);
  let grid="";for(let k=0;k<=4;k++){const v=Math.round(max*k/4);grid+=`<line x1="${L}" x2="${W-4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`}
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Units made per day">${grid}${days.map((d,i)=>{const v=map[d],x=L+i*bw+bw*.18,w=bw*.64,h=(H-T-B)*(v/max);const wk=[0,6].includes(new Date(parseDate(d)).getDay());
    return `<rect x="${x}" y="${y(v)}" width="${w}" height="${Math.max(0,h)}" rx="3" fill="${d===todayIso()?"var(--cyan)":"var(--pink)"}" opacity="${wk?.45:1}"><title>${fmtDate(d)}: ${fmtN(v)} units</title></rect>
      ${v?`<text x="${x+w/2}" y="${y(v)-4}" text-anchor="middle">${fmtN(v)}</text>`:""}<text x="${x+w/2}" y="${H-8}" text-anchor="middle">${new Date(parseDate(d)).toLocaleDateString(undefined,{day:"numeric",month:"numeric"})}</text>`}).join("")}</svg>
    <div class="legend"><span><i style="background:var(--pink);height:10px"></i>Units reported</span><span><i style="background:var(--cyan);height:10px"></i>Today so far</span></div>`;
}
function viewProduction(){
  const span=state.prodDays||30;const yd=prevWorkday();
  const rep=unitReports();const ydUnits=rep.filter(r=>r.date===yd);const today=rep.filter(r=>r.date===todayIso());
  const wkFrom=addDays(todayIso(),-6);const week=rep.filter(r=>r.date>=wkFrom).reduce((a,r)=>a+r.units,0);
  const byProd=list=>{const m={};list.forEach(r=>{m[r.product]=(m[r.product]||0)+r.units});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  const plan=materialPlan();const shorts=plan.filter(p=>p.short>0);const soon=plan.filter(p=>p.short===0&&p.days!=null&&p.days<7);
  const orders=liveTasks().filter(t=>t.qty>0&&t.status!=="done").sort((a,b)=>(b.doneUnits/b.qty)-(a.doneUnits/a.qty));
  const fg=erpProducts().filter(p=>+p.finishedStock);
  const people=peopleStats(span),prods=productStats(span);
  return `<div class="toolbar"><div class="seg" role="group" aria-label="Period">${[7,30,90].map(n=>`<button data-proddays="${n}" aria-pressed="${span===n}">Last ${n} days</button>`).join("")}</div>
    <span class="goal">People and products tables cover the last ${span} days.</span><span class="spacer"></span>
    ${isAdmin()&&downloads?`<button class="btn small" data-xlsx>Export to Excel</button>`:""}</div>
  <div class="stats">
    <div class="stat"><b style="color:var(--pink)">${fmtN(ydUnits.reduce((a,r)=>a+r.units,0))}</b><small>Made ${yd===addDays(todayIso(),-1)?"yesterday":"on "+fmtDate(yd)}${ydUnits.length?": "+byProd(ydUnits).map(([k,v])=>`${fmtN(v)} ${esc(k)}`).join(", "):""}</small></div>
    <div class="stat"><b>${fmtN(today.reduce((a,r)=>a+r.units,0))}</b><small>Made today so far</small></div>
    <div class="stat"><b>${fmtN(week)}</b><small>Made in the last 7 days</small></div>
    <div class="stat"><b>${fmtN(fg.reduce((a,p)=>a+(+p.finishedStock||0),0))}</b><small>Finished products in stock</small></div>
    <div class="stat"><b style="color:${shorts.length?"var(--red)":"var(--accent)"}">${shorts.length}</b><small>Materials short for open orders${soon.length?` · ${soon.length} run out within a week`:""}</small></div>
  </div>
  <div class="two"><div class="panel"><h2>Units made per day</h2>${outputChart(outputByDay(14))}</div>
    <div class="panel"><h2>Finished products</h2>${state.erp?(erpProducts().length?`<table><tbody>${erpProducts().map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.sku||"")}</small></td><td class="num"><b>${fmtN(+p.finishedStock||0)}</b></td></tr>`).join("")}</tbody></table>
      <p class="goal" style="margin:10px 0 0;font-size:12px">Goes up when workers report units done. Materials are taken out of stock by the bill of materials at the same time.</p>`:'<div class="empty">No products in the ERP yet.</div>'):'<div class="empty">Product stock comes from the ERP in the desktop program.</div>'}</div></div>
  <div class="panel"><h2>Open work orders · ${orders.length}</h2>${orders.length?`<div class="orders">${orders.map(t=>`<button class="order" data-open="${esc(t.id)}"><span class="o-t">${esc(shortId(t))} ${esc(t.title)}</span>${avStack(t,3)}<span class="o-p">${progHtml(t)}</span><span class="o-n">${fmtN(t.doneUnits)}/${fmtN(t.qty)}</span></button>`).join("")}</div>`:'<div class="empty">No open tasks with a quantity.</div>'}</div>
  <div class="panel"><h2>Materials for open orders</h2>${state.erp?(plan.length?`<div class="tbl-scroll"><table><thead><tr><th>Material</th><th class="num">Still needed</th><th class="num">In stock</th><th class="num">Short</th><th class="num">Used per day</th><th>Runs out in</th></tr></thead><tbody>
    ${plan.map(p=>`<tr><td>${esc(p.name)}${p.orders.length?`<br><small>${esc(p.orders.slice(0,4).join(", "))}${p.orders.length>4?" +"+(p.orders.length-4):""}</small>`:""}</td><td class="num">${fmtN(p.need)} ${esc(p.unit)}</td><td class="num">${fmtN(p.stock)}</td>
      <td class="num">${p.short?`<span class="chip bad">${fmtN(p.short)}</span>`:'<span class="chip ok">0</span>'}</td><td class="num">${p.perDay?fmtN(Math.round(p.perDay*10)/10):"–"}</td>
      <td>${p.days==null?'<span class="muted">not used lately</span>':`<span class="chip ${p.days<3?"bad":p.days<7?"warn":"ok"}">${daysText(p.days)}</span>`}</td></tr>`).join("")}</tbody></table></div>
    <p class="goal" style="margin:10px 0 0;font-size:12px">"Still needed" adds up every open order together: team board tasks and ERP plans. "Runs out in" uses the average of the last 14 days.</p>`
    :'<div class="empty">No bills of materials for the open orders yet. Add them in the ERP under BOM.</div>'):'<div class="empty">Material planning needs the ERP (desktop program).</div>'}</div>
  <div class="two"><div class="panel"><h2>Output per person</h2>${people.length?`<div class="tbl-scroll"><table><thead><tr><th>Person</th><th class="num">Units</th><th class="num">Hours</th><th class="num">Units per hour</th><th class="num">Tasks</th></tr></thead><tbody>
      ${people.map(p=>`<tr><td><div class="mname">${avatar(p.id)}<b>${esc(mName(p.id))}</b></div></td><td class="num">${fmtN(p.units)}</td><td class="num">${fmtN(p.hours)}</td><td class="num">${p.rate==null?"–":fmtN(Math.round(p.rate*100)/100)}</td><td class="num">${p.tasks}</td></tr>`).join("")}</tbody></table></div>
      <p class="goal" style="margin:10px 0 0;font-size:12px">Units per hour only counts reports that include hours.</p>`:'<div class="empty">No reports in this period.</div>'}</div>
    <div class="panel"><h2>Time per product</h2>${prods.length?`<div class="tbl-scroll"><table><thead><tr><th>Product</th><th class="num">Units</th><th class="num">Hours per unit</th><th class="num">Standard</th><th class="num">Difference</th></tr></thead><tbody>
      ${prods.map(p=>`<tr><td>${esc(p.name)}</td><td class="num">${fmtN(p.units)}</td><td class="num">${p.act==null?"–":fmtN(Math.round(p.act*100)/100)}</td><td class="num">${p.std?fmtN(p.std):"–"}</td>
        <td class="num">${p.diff==null?"–":`<span class="chip ${p.diff>15?"bad":p.diff< -5?"ok":"warn"}">${p.diff>0?"+":""}${p.diff}%</span>`}</td></tr>`).join("")}</tbody></table></div>
      <p class="goal" style="margin:10px 0 0;font-size:12px">The standard comes from the product template (Admin, Templates).</p>`:'<div class="empty">No reports in this period.</div>'}</div></div>`;
}
/* ---- Excel export ---- */
async function exportExcel(){
  if(!downloads)return;const span=state.prodDays||30;const from=addDays(todayIso(),-(span-1));
  const wl=[];state.tasks.forEach(t=>t.worklogs.forEach(w=>{if(w.date>=from)wl.push({Date:w.date,Person:mName(w.by),Task:shortId(t),Title:t.title,Product:t.productName||"",Units:w.units||0,Hours:w.hours||0,Note:w.note||"","ERP reference":t.erpRef||"",Status:COLS[t.status]})}));
  wl.sort((a,b)=>a.Date<b.Date?-1:1);
  const orders=liveTasks().filter(t=>t.qty>0).map(t=>({Task:shortId(t),Title:t.title,Product:t.productName||"",Quantity:t.qty,Done:t.doneUnits,"% done":Math.round(t.doneUnits/t.qty*100),Status:COLS[t.status],People:names(t),Sprint:sprint(t.sprintId)?.name||"Backlog"}));
  const people=peopleStats(span).map(p=>({Person:mName(p.id),Units:p.units,Hours:p.hours,"Units per hour":p.rate==null?"":Math.round(p.rate*100)/100,Tasks:p.tasks}));
  const prods=productStats(span).map(p=>({Product:p.name,Units:p.units,Hours:p.hours,"Hours per unit":p.act==null?"":Math.round(p.act*100)/100,Standard:p.std||"","Difference %":p.diff??""}));
  const mats=materialPlan().map(p=>({Material:p.name,Unit:p.unit,"Still needed":p.need,"In stock":p.stock,Short:p.short,"Used per day":Math.round(p.perDay*100)/100,"Days left":p.days==null?"":Math.floor(p.days)}));
  const name=`team-board-${todayIso()}`;
  try{
    if(window.XLSX){
      const wb=XLSX.utils.book_new();const add=(rows,title)=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{"":"No data"}]);ws["!cols"]=Object.keys(rows[0]||{a:1}).map(k=>({wch:Math.max(10,Math.min(40,k.length+4))}));XLSX.utils.book_append_sheet(wb,ws,title)};
      add(wl,"Worklogs");add(orders,"Work orders");add(people,"People");add(prods,"Products");add(mats,"Materials");
      const buf=XLSX.write(wb,{type:"array",bookType:"xlsx"});
      await downloads.save({filename:name+".xlsx",data:new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})});
    }else{
      const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv=rows=>rows.length?[Object.keys(rows[0]).map(q).join(";"),...rows.map(r=>Object.values(r).map(q).join(";"))].join("\r\n"):"";
      await downloads.save({filename:name+"-worklogs.csv",data:new Blob(["﻿"+csv(wl)],{type:"text/csv"})});
    }
    toast("Export saved");
  }catch(e){toast("The export was not saved.")}
}
