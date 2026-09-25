/* ================= My work: the phone page for workers ================= */
const myUi={form:null,kind:null};       // which task has the report / blocked form open
function myTasks(m){
  const rank={doing:0,blocked:1,review:2,todo:3};
  return liveTasks().filter(t=>isOn(t,m.id)&&t.status!=="done").sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||a.priority-b.priority);
}
function viewMy(){
  const m=me();
  if(!m)return `<div class="my"><div class="my-empty"><h2>My work</h2><p>Sign in with your PIN to see your tasks and report what you've done.</p>
    <button class="btn primary my-big" data-mysignin>Sign in</button></div></div>`;
  const list=myTasks(m);const today=todayIso();
  const doneToday=[];state.tasks.forEach(t=>t.worklogs.forEach(w=>{if(w.by===m.id&&w.date===today)doneToday.push({t,w})}));
  const u=doneToday.reduce((a,x)=>a+x.w.units,0),h=doneToday.reduce((a,x)=>a+x.w.hours,0);
  return `<div class="my">
    <div class="my-head"><div>${avatar(m.id)}</div><div><b>${esc(m.name)}</b><small>${list.length} open task${list.length===1?"":"s"}${u||h?` · today: ${u?fmtN(u)+" units":""}${u&&h?", ":""}${h?fmtH(h):""}`:""}</small></div></div>
    ${list.length?list.map(t=>myCard(t,m)).join(""):'<div class="my-empty"><p>No open tasks for you right now.</p></div>'}
  </div>`;
}
function myCard(t,m){
  const open=myUi.form===t.id;const tap=t.qty>0;
  const st=`<span class="st st-${t.status}">${COLS[t.status]}</span>`;
  const actions=[];
  if(t.status==="todo")actions.push(`<button class="btn primary my-big" data-mystatus="doing" data-id2="${esc(t.id)}">Start</button>`);
  if(t.status==="doing")actions.push(`<button class="btn my-big" data-myform="blocked" data-id2="${esc(t.id)}">I'm blocked</button>`,`<button class="btn my-big" data-mystatus="review" data-id2="${esc(t.id)}">Ready for review</button>`);
  if(t.status==="blocked")actions.push(`<button class="btn primary my-big" data-mystatus="doing" data-id2="${esc(t.id)}">Unblocked, carry on</button>`);
  if(t.status==="review")actions.push(`<span class="muted" style="align-self:center">Waiting for review</span>`);
  return `<section class="my-card st-b-${t.status}">
    <div class="my-top">${st}<span class="c-id">${esc(shortId(t))}</span><button class="linkish my-open" data-open="${esc(t.id)}">Open</button></div>
    <h3>${esc(t.title)}</h3>
    ${t.status==="blocked"&&t.blockedReason?`<p class="my-blocked">Blocked: ${esc(t.blockedReason)}</p>`:""}
    ${tap?`${progHtml(t,"md")}<div class="my-taps">
      <button class="my-tap" data-mytap="1" data-id2="${esc(t.id)}" aria-label="Add 1 ${esc(t.unit)} done">+1</button>
      <button class="my-tap" data-mytap="5" data-id2="${esc(t.id)}" aria-label="Add 5 ${esc(t.unit)} done">+5</button>
      <button class="my-tap wide" data-myform="report" data-id2="${esc(t.id)}">Report…</button></div>`
      :`<div class="my-taps"><button class="my-tap wide" data-myform="report" data-id2="${esc(t.id)}">Log time…</button></div>`}
    ${open&&myUi.kind==="report"?`<form class="my-form" data-myreport="${esc(t.id)}">
        ${tap?`<label>${esc(t.unit[0].toUpperCase()+t.unit.slice(1))} done today<input id="myUnits" type="number" min="0" step="1" inputmode="numeric"></label>`:""}
        <label>Hours worked on it<input id="myHours" type="number" min="0" max="24" step="0.25" inputmode="decimal"></label>
        <label>Note<input id="myNote" maxlength="300" placeholder="Optional"></label>
        <div class="my-row"><button class="btn primary my-big">Save</button><button type="button" class="btn my-big" data-myclose>Cancel</button></div></form>`:""}
    ${open&&myUi.kind==="blocked"?`<form class="my-form" data-myblock="${esc(t.id)}">
        <label>What are you waiting for?<input id="myReason" maxlength="200" required placeholder="e.g. no M3 screws left"></label>
        <div class="my-row"><button class="btn danger my-big">Mark as blocked</button><button type="button" class="btn my-big" data-myclose>Cancel</button></div></form>`:""}
    <div class="my-row">${actions.join("")}</div>
  </section>`;
}
/* +1 / +5: one running entry per person per task per day, so a day of taps is one line in the worklog */
async function myTap(id,n){
  const t=task(id);if(!t)return;
  const ok=await act(async m=>{
    const day=todayIso();const wid=`tap-${m.id}-${day}`;const cur=t.worklogs.find(w=>w.id===wid);
    const units=Math.max(0,Math.round(((cur?cur.units:0)+n)*100)/100);
    return taskUpdate(id,{worklogs:{[wid]:{by:m.id,date:day,hours:cur?cur.hours:0,units,note:cur?cur.note:"",at:Date.now()}},
      activity:{[`a-${wid}`]:{at:Date.now(),by:m.id,text:`reported ${fmtN(units)} ${t.unit} done today`}}},null,m.id);
  });
  if(ok){const nt=task(id);const total=t.doneUnits+n;
    if(t.qty&&total>=t.qty&&t.status!=="done")toast(`Target reached: ${fmtN(total)} of ${fmtN(t.qty)}. Tell your lead it's ready.`);else toast(`+${n} saved`,{label:"Undo",fn:()=>myTap(id,-n)})}
}
async function mySubmit(form){
  const id=form.dataset.myreport||form.dataset.myblock;const t=task(id);if(!t)return;
  if(form.dataset.myblock){
    const reason=$("#myReason").value.trim();if(!reason)return;
    const ok=await act(m=>taskUpdate(id,{...statusPatch(t,"blocked"),blockedReason:reason},`marked this as blocked: ${reason}`,m.id));
    if(ok){myUi.form=null;render();toast("Marked as blocked. Your lead can see it on the board.")}return;
  }
  const units=$("#myUnits")?Math.max(0,+$("#myUnits").value||0):0,hours=Math.max(0,Math.min(24,+$("#myHours").value||0)),note=$("#myNote").value.trim();
  if(!units&&!hours){toast("Enter the units done, the hours, or both.");return}
  const ok=await act(m=>taskUpdate(id,{worklogs:{[uid("w")]:{by:m.id,date:todayIso(),hours,units,note,at:Date.now()}}},
    `reported ${[units?fmtN(units)+" "+t.unit+" done":"",hours?fmtH(hours):""].filter(Boolean).join(", ")} for today`,m.id));
  if(ok){myUi.form=null;render();toast("Report saved")}
}
