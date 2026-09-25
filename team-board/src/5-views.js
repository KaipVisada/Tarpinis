/* ================= shared view bits ================= */
const TYPE_ICON={
  story:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  task:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.5l3 3 5.5-6.5"/></svg>',
  bug:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="14" rx="5" ry="6.5"/><path d="M12 8v12.5M7 11 3.5 9M17 11l3.5-2M7 15H3M17 15h4M7.5 19l-3 2M16.5 19l3 2M9.5 7.8 8 5M14.5 7.8 16 5"/></svg>'};
const CHECK='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHECK_SM='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const I_CMT='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const I_WARN='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h0"/></svg>';
const I_CLOCK='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const I_LIST='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>';
const I_CLIP='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg>';
const COL_COLOR={todo:"#4a5568",doing:"#0e8fa6",blocked:"#c53030",review:"#b7791f",done:"#3d8a6f"};
const STATUS_COLOR={todo:"var(--muted)",doing:"var(--cyan)",blocked:"var(--red)",review:"var(--amber)",done:"var(--accent)"};
const LBL=[["#5ac991","rgba(90,201,145,.16)"],["#00d9ff","rgba(0,217,255,.14)"],["#f59e0b","rgba(245,158,11,.16)"],["#f472b6","rgba(244,114,182,.16)"],["#a78bfa","rgba(167,139,250,.18)"],["#ef4444","rgba(239,68,68,.15)"]];
function lblColor(s){let x=0;for(const ch of String(s).toLowerCase())x=(x*31+ch.charCodeAt(0))>>>0;return LBL[x%LBL.length]}
const lblHtml=l=>{const [fg,bg]=lblColor(l);return `<span class="lbl" style="color:${fg};background:${bg}">${esc(l)}</span>`};
const liveTasks=()=>state.tasks.filter(t=>!t.deleted);
const sprintTasks=()=>liveTasks().filter(t=>t.sprintId===state.sprintId);
const openIssues=t=>t.comments.filter(c=>c.kind==="issue"&&!c.resolved).length;
const blockedDays=t=>t.status==="blocked"&&t.blockedAt?Math.max(0,Math.floor((Date.now()-t.blockedAt)/DAY)):null;
const daysLeft=s=>Math.max(0,Math.ceil((parseDate(s.end)+DAY-Date.now())/DAY));
const isOn=(t,id)=>t.assignees.includes(id);
const share=t=>1/Math.max(1,t.assignees.length);            // shared tasks split points and estimate evenly
const loggedBy=(t,id)=>t.worklogs.filter(w=>w.by===id).reduce((a,w)=>a+w.hours,0);
const names=t=>t.assignees.map(mName).join(", ");
function avStack(t,max=3){
  const a=t.assignees;if(!a.length)return '<span class="avatar add" title="No one assigned">+</span>';
  return `<span class="avs" title="${esc(names(t))}">${a.slice(0,max).map(id=>avatar(id)).join("")}${a.length>max?`<span class="avatar more-n">+${a.length-max}</span>`:""}</span>`;
}
const r1=v=>Math.round(v*10)/10;
const lastMe=()=>{const m=me();return m?m.id:ls.get("tb.last")||""};
function filtered(list){
  const q=state.q.toLowerCase();
  return list.filter(t=>(!state.who||(state.who==="none"?!t.assignees.length:isOn(t,state.who)))&&(!state.type||t.type===state.type)
    &&(!q||(shortId(t)+" "+t.title+" "+t.erpRef+" "+t.labels.join(" ")).toLowerCase().includes(q)));
}
function workDays(from,to){let n=0;const d=new Date(parseDate(from)),e=parseDate(to);while(d.getTime()<=e){const w=d.getDay();if(w>0&&w<6)n++;d.setDate(d.getDate()+1)}return n}
function offDays(m,from,to){return m.timeOff.reduce((a,o)=>{const f=o.from>from?o.from:from,t=o.to<to?o.to:to;return f<=t?a+workDays(f,t):a},0)}
function capacity(m,s){if(!s)return 0;return hr(Math.max(0,workDays(s.start,s.end)-offDays(m,s.start,s.end))*m.weeklyH/5)}
const offToday=m=>{const d=todayIso();return m.timeOff.find(o=>o.from<=d&&o.to>=d)};
function filterBar(extra=""){
  const lm=lastMe();
  return `<input type="search" id="q" placeholder="Search ID, title, label or ERP ref" value="${esc(state.q)}" aria-label="Search">
    <select id="typeF" aria-label="Filter by type"><option value="">All types</option>${Object.entries(TYPES).map(([k,l])=>`<option value="${k}"${state.type===k?" selected":""}>${l}</option>`).join("")}</select>
    <select id="who" aria-label="Filter by person"><option value="">Everyone</option><option value="none"${state.who==="none"?" selected":""}>Unassigned</option>
      ${members().map(m=>`<option value="${esc(m.id)}"${state.who===m.id?" selected":""}>${esc(m.name)}</option>`).join("")}</select>
    ${lm&&member(lm)?`<button class="btn small" data-mine>${state.who===lm?"Show everyone":"Only my tasks"}</button>`:""}${extra}`;
}
function card(t){
  const adm=isAdmin();const bd=blockedDays(t);const cs=t.comments.length,oi=openIssues(t);const done=t.status==="done";
  const cl=t.checklist,cd=cl.filter(c=>c.done).length;const running=Object.keys(t.timers).length;
  return `<div class="card t-${t.type}${t.status==="blocked"?" blocked":""}${done?" is-done":""}" draggable="true" data-id="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(shortId(t)+" "+t.title)}">
    <span class="c-type" title="${TYPES[t.type]}">${TYPE_ICON[t.type]}</span>
    <div class="c-title"><span class="c-id">${esc(shortId(t))}</span>${esc(t.title)}</div>
    ${avStack(t)}
    ${t.status==="blocked"&&t.blockedReason?`<div class="reason">${esc(t.blockedReason)}</div>`:""}
    ${adm&&(t.labels.length||t.erpRef)?`<div class="labels">${t.labels.map(lblHtml).join("")}${t.erpRef?`<span class="chip erp">${esc(t.erpRef)}</span>`:""}</div>`:""}
    ${t.qty?`<div class="labels"><span class="chip info">${workLine(t)}</span></div>${progHtml(t)}`:""}
    <div class="c-foot">${adm?`<span class="pts-b" title="Story points">${t.points}</span>`:""}
      ${cl.length?`<span class="ci${cd===cl.length?" ok":""}" title="Checklist">${I_LIST}${cd}/${cl.length}</span>`:""}
      ${cs?`<span class="ci" title="${cs} comment${cs>1?"s":""}">${I_CMT}${cs}</span>`:""}
      ${oi?`<span class="ci warn" title="${oi} open issue${oi>1?"s":""}">${I_WARN}${oi}</span>`:""}
      ${t.files.length?`<span class="ci" title="Files">${I_CLIP}${t.files.length}</span>`:""}
      ${running?`<span class="ci run" title="Timer running">${I_CLOCK}live</span>`:t.loggedH?`<span class="ci" title="Logged">${I_CLOCK}${fmtH(t.loggedH)}</span>`:""}
      ${bd!=null?`<span class="ci red" title="Blocked">${I_CLOCK}${bd?bd+"d":"today"}</span>`:""}
      <button class="c-check${done?" on":""}" data-check="${esc(t.id)}" aria-label="${done?"Reopen task":"Mark as done"}" title="${done?"Reopen":"Mark as done"}">${CHECK}</button></div>
  </div>`;
}

/* ================= board ================= */
function viewBoard(){
  if(!state.sprintId)return `<div class="panel empty">No sprints yet. Open Backlog to plan your first sprint.</div>`;
  const s=sprint(state.sprintId);const all=sprintTasks();const list=filtered(all);const n=state.order.length;
  const tp=all.reduce((a,t)=>a+t.points,0);
  return `<div class="board-bar"><span class="bt">${esc(s.name)} board</span><span class="bs">${all.length} items, ${tp} points${s.goal?`. Goal: ${esc(s.goal)}`:""}</span>${filterBar()}</div>
  <div class="board-scroll"><div class="board" style="grid-template-columns:repeat(${n},minmax(228px,1fr));min-width:${n*240}px">${state.order.map((k,i)=>{
    const items=list.filter(t=>t.status===k).sort((a,b)=>a.priority-b.priority||(keyOf(a)||0)-(keyOf(b)||0));
    const pts=items.reduce((a,t)=>a+t.points,0);const open=state.menuFor===k;
    return `<section class="col" data-status="${k}" aria-label="${COLS[k]}" style="--cc:${COL_COLOR[k]}">
      <header class="col-h" draggable="true" data-colid="${k}" title="Drag to move this column">
        <div class="hd"><b>${COLS[k]}</b><small>${items.length} item${items.length===1?"":"s"} | ${pts} point${pts===1?"":"s"}</small></div>
        <button class="col-menu" data-colmenu="${k}" aria-label="${COLS[k]} column options" aria-expanded="${open}">⋮</button>
        ${open?`<div class="menu" role="menu"><button role="menuitem" data-addin="${k}">Add task here</button>
          <button role="menuitem" data-colmove="${k}" data-dir="-1"${i===0?" disabled":""}>Move column left</button>
          <button role="menuitem" data-colmove="${k}" data-dir="1"${i===n-1?" disabled":""}>Move column right</button></div>`:""}
      </header>
      <div class="col-body">${items.map(card).join("")||`<div class="empty">${k==="blocked"?"Nothing is blocked":"Drag tasks here"}</div>`}
        <button class="col-add" data-addin="${k}">+ Add task</button></div></section>`}).join("")}</div></div>`;
}
async function moveColumn(id,to){
  const o=state.order.filter(k=>k!==id);to=Math.max(0,Math.min(o.length,to));o.splice(to,0,id);
  if(o.join()===state.order.join())return;
  await act(m=>{state.order=o;render();return enqueue("config/board","set",{order:o})});
}

/* ================= backlog & sprints ================= */
function nextWeek(){
  const s=sortedSprints();const d=new Date(s.length?Math.max(parseDate(s[s.length-1].end)+DAY,Date.now()-6*DAY):Date.now()-6*DAY);
  d.setHours(0,0,0,0);while(d.getDay()!==1)d.setDate(d.getDate()+1);
  const e=new Date(d);e.setDate(e.getDate()+4);
  const n=state.sprints.reduce((a,x)=>Math.max(a,parseInt((String(x.name).match(/\d+/)||["0"])[0],10)),0)+1;
  return {name:`Sprint ${n}`,start:iso(d),end:iso(e)};
}
function viewBacklog(){
  const back=filtered(liveTasks().filter(t=>!t.sprintId||!sprint(t.sprintId))).sort((a,b)=>a.priority-b.priority);
  const open=sortedSprints().filter(s=>s.state!=="closed");
  const rows=back.map(t=>`<tr><td><button class="linkish" data-open="${esc(t.id)}"><span class="c-id">${esc(shortId(t))}</span>${esc(t.title)}</button></td>
    <td>${PRIO[t.priority]}</td><td class="num">${t.points}</td><td>${esc(t.erpRef)}</td><td>${esc(names(t)||"–")}</td>
    <td><select data-plan="${esc(t.id)}" aria-label="Move to sprint"><option value="">Keep in backlog</option>${open.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></td></tr>`).join("");
  const hasActive=state.sprints.some(s=>s.state==="active"&&!s.deleted);
  const sp=sortedSprints().reverse().map(s=>{
    const ts=liveTasks().filter(t=>t.sprintId===s.id);const pts=ts.reduce((a,t)=>a+t.points,0);
    let act="";
    if(s.state==="planned"&&!hasActive)act=`<button class="btn small" data-startsp="${esc(s.id)}">Start sprint</button>`;
    if(s.state==="active")act=`<button class="btn small" data-finish="${esc(s.id)}">Finish sprint</button>`;
    if(s.state==="planned"&&!ts.length)act+=` <button class="btn small ghost" data-delsprint="${esc(s.id)}">Delete</button>`;
    return `<tr><td><b>${esc(s.name)}</b><br><small>${fmtDate(s.start)} – ${fmtDate(s.end)} · ${s.state}${s.goal?" · "+esc(s.goal):""}</small></td><td class="num">${ts.length} tasks<br>${pts} pt</td><td class="num" style="white-space:nowrap">${act}</td></tr>`}).join("");
  const nw=nextWeek();
  return `<div class="toolbar">${filterBar()}</div><div class="two">
    <div class="panel"><h2>Backlog · ${back.length}</h2>${back.length?`<div class="tbl-scroll"><table><thead><tr><th>Task</th><th>Priority</th><th class="num">Pts</th><th>ERP ref</th><th>Assignee</th><th>Plan</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty">The backlog is empty. Use New task to add work.</div>'}</div>
    <div>
      <div class="panel"><h2>Sprints</h2>${sp?`<div class="tbl-scroll"><table><tbody>${sp}</tbody></table></div>`:'<div class="empty">No sprints yet.</div>'}</div>
      <div class="panel"><h3>Create sprint</h3><p class="goal" style="margin:-4px 0 10px">Weekly sprints run Monday to Friday. The next week is filled in for you.</p>
        <form class="row-form" id="sprintForm">
        <input id="spName" name="name" placeholder="Name" required aria-label="Sprint name" style="flex:1 1 100%" value="${esc(nw.name)}">
        <input id="spStart" name="start" type="date" required aria-label="Start date" style="flex:1" value="${nw.start}">
        <input id="spEnd" name="end" type="date" required aria-label="End date" style="flex:1" value="${nw.end}">
        <input id="spGoal" name="goal" placeholder="Sprint goal" aria-label="Sprint goal" style="flex:1 1 100%" maxlength="200">
        <button class="btn primary">Create sprint</button></form></div>
    </div></div>`;
}
async function finishSprint(id){
  const s=sprint(id);if(!s)return;
  await act(async m=>{
    const open=liveTasks().filter(t=>t.sprintId===id&&t.status!=="done");
    let next=sortedSprints().find(x=>x.state==="planned"&&x.id!==id&&parseDate(x.start)>=parseDate(s.start));
    const nw=next?null:nextWeek();
    if(!await ask({title:`Finish ${s.name}?`,body:`${open.length} unfinished task${open.length===1?"":"s"} will move to ${next?next.name:nw.name+" ("+fmtDate(nw.start)+" – "+fmtDate(nw.end)+")"}, which starts now.`,ok:"Finish sprint"}))return;
    if(!next){const nid=uid("s");if(!await enqueue("sprints/"+nid,"set",{...nw,goal:"",state:"planned"}))return;next={id:nid,...nw}}
    for(const t of open)await taskUpdate(t.id,{sprintId:next.id},`carried over from ${s.name} to ${next.name}`,m.id);
    await enqueue("sprints/"+id,"update",{state:"closed"});
    await enqueue("sprints/"+next.id,"update",{state:"active"});
    logEvent("sprint",`finished ${s.name} and started ${next.name}`,m.id);
    state.sprintId=next.id;state.followActive=true;toast(`${s.name} finished. ${next.name} has started.`);render();
  });
}
function startSprint(id){
  return act(async m=>{const s=sprint(id);if(!s)return;
    if(state.sprints.some(x=>x.state==="active"&&!x.deleted)){toast("Finish the active sprint first.");return}
    await enqueue("sprints/"+id,"update",{state:"active"});logEvent("sprint",`started ${s.name}`,m.id);state.sprintId=id;state.followActive=true;toast(`${s.name} started`)});
}

/* ================= team ================= */
function cycleDays(list){const d=list.filter(t=>t.status==="done"&&t.startedAt&&t.doneAt).map(t=>(t.doneAt-t.startedAt)/DAY);return d.length?d.reduce((a,b)=>a+b,0)/d.length:null}
function viewTeam(){
  const s=sprint(state.sprintId);const st=sprintTasks();const recent=liveTasks().filter(t=>t.doneAt&&t.doneAt>Date.now()-60*DAY);
  const rows=members().filter(m=>m.access!=="viewer").map(m=>{
    const mine=st.filter(t=>isOn(t,m.id));
    const hrs=mine.reduce((a,t)=>a+t.estimateH*share(t),0);const cap=capacity(m,s);
    const pct=cap?Math.round(hrs/cap*100):(hrs?101:0);const cls=pct>100?"over":pct>85?"warn":"";
    const wip=mine.filter(t=>t.status==="doing"||t.status==="review").length;const blk=mine.filter(t=>t.status==="blocked").length;
    const done=r1(mine.filter(t=>t.status==="done").reduce((a,t)=>a+t.points*share(t),0));
    const logged=st.reduce((a,t)=>a+loggedBy(t,m.id),0);const ct=cycleDays(recent.filter(t=>isOn(t,m.id)));
    const off=offToday(m);const run=liveTasks().find(t=>t.timers[m.id]);const [al,ac]=AVAIL[m.availability];
    const offS=s?m.timeOff.filter(o=>o.to>=s.start&&o.from<=s.end):[];
    return `<tr><td><div class="mname">${avatar(m.id)}<div><b>${esc(m.name)}</b><small>${esc(m.title)}</small></div></div></td>
      <td><span class="chip ${off?"bad":ac}">${off?"Off today":al}</span>${run?`<br><button class="linkish" style="font-size:12px;color:var(--cyan)" data-open="${esc(run.id)}">⏱ ${esc(shortId(run))}</button>`:""}
        ${offS.length?`<br><small>Off ${offS.map(o=>fmtDate(o.from)+(o.to!==o.from?"–"+fmtDate(o.to):"")).join(", ")}</small>`:""}</td>
      <td><div class="load"><div class="bar"><i class="${cls}" style="width:${Math.min(pct,100)}%"></i></div><span>${cap?pct+"%":"–"}</span></div>
      <small>${cap?`${fmtH(hrs)} planned of ${fmtH(cap)} available`:`${fmtH(hrs)} planned, no hours available`}</small></td>
      <td class="num">${wip}${wip>2?' <span class="chip blk">high</span>':""}</td><td class="num"${blk?' style="color:var(--red);font-weight:600"':""}>${blk}</td><td class="num">${done}</td><td class="num">${fmtH(logged)}</td>
      <td class="num">${ct==null?"–":ct.toFixed(1)+" d"}</td></tr>`}).join("");
  const unassigned=st.filter(t=>!t.assignees.length&&t.status!=="done").length;
  const m=me();
  return `<div class="panel"><div class="panel-h"><h2>Workload${s?" · "+esc(s.name):""}</h2>${m&&m.access==="admin"?`<button class="btn small" data-goadmin="members">Manage members</button>`:""}</div>
    <p class="goal" style="margin-top:-4px">Load compares the estimated hours assigned in this sprint with each person's available hours (weekly hours, minus time off). When several people share a task, its estimate and points are split evenly between them. Logged shows each person's own worklogs. Amber means above 85%, red means overbooked.${unassigned?` ${unassigned} open task${unassigned>1?"s are":" is"} unassigned.`:""}</p>
    ${rows?`<div class="tbl-scroll"><table><thead><tr><th>Person</th><th>Status</th><th>Load</th><th class="num">In progress</th><th class="num">Blocked</th><th class="num">Done pts</th><th class="num">Logged</th><th class="num">Avg cycle (60d)</th></tr></thead><tbody>${rows}</tbody></table></div>`
      :'<div class="empty">No team members yet. An admin adds them from the Admin tab.</div>'}</div>`;
}

/* ================= insights ================= */
function burndown(s,ts){
  const start=parseDate(s.start),end=parseDate(s.end);const days=Math.round((end-start)/DAY)+1;
  const total=ts.reduce((a,t)=>a+t.points,0);if(!total||days<2)return '<div class="empty">No points committed to this sprint yet.</div>';
  const W=640,H=230,L=36,R=12,T=12,B=28;const x=i=>L+i*(W-L-R)/(days-1);const y=v=>T+(1-v/total)*(H-T-B);
  const now=Date.now();const pts=[];
  for(let i=0;i<days;i++){const dayEnd=start+(i+1)*DAY;if(start+i*DAY>now)break;
    const done=ts.filter(t=>t.status==="done"&&t.doneAt&&t.doneAt<dayEnd).reduce((a,t)=>a+t.points,0);pts.push([x(i),y(total-done)])}
  let grid="";for(let k=0;k<=4;k++){const v=Math.round(total*k/4);grid+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`}
  let labels="";const step=Math.max(1,Math.ceil(days/7));for(let i=0;i<days;i+=step){labels+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${new Date(start+i*DAY).toLocaleDateString(undefined,{day:"numeric",month:"short"})}</text>`}
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Burndown chart">${grid}${labels}
    <line x1="${x(0)}" y1="${y(total)}" x2="${x(days-1)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
    ${pts.length?`<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${pts.map(p=>p.join(",")).join(" ")}"/><circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="4" fill="var(--accent)"/>`:""}</svg>
    <div class="legend"><span><i style="background:var(--accent)"></i>Remaining points</span><span><i style="background:var(--muted)"></i>Ideal pace</span></div>`;
}
const donePts=sid=>liveTasks().filter(t=>t.sprintId===sid&&t.status==="done").reduce((a,t)=>a+t.points,0);
function velocity(){
  const s=sortedSprints().filter(x=>x.state!=="planned").slice(-6);if(!s.length)return '<div class="empty">Velocity appears after your first sprint.</div>';
  const v=s.map(sp=>({sp,done:donePts(sp.id),committed:liveTasks().filter(t=>t.sprintId===sp.id).reduce((a,t)=>a+t.points,0)}));
  const max=Math.max(1,...v.map(x=>Math.max(x.done,x.committed)));const W=640,H=220,B=28,T=16,bw=(W-40)/v.length;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Velocity chart">${v.map((x,i)=>{
    const x0=20+i*bw+bw*.2,w=bw*.6,hc=(x.committed/max)*(H-B-T),hd=(x.done/max)*(H-B-T);
    return `<rect x="${x0}" y="${H-B-hc}" width="${w}" height="${hc}" fill="var(--line)" rx="3"/>
      <rect x="${x0+w*.2}" y="${H-B-hd}" width="${w*.6}" height="${hd}" fill="${x.sp.state==="active"?"var(--amber)":"var(--accent)"}" rx="3"/>
      <text x="${x0+w/2}" y="${H-B-Math.max(hc,hd)-4}" text-anchor="middle">${x.done}/${x.committed}</text>
      <text x="${x0+w/2}" y="${H-8}" text-anchor="middle">${esc(x.sp.name)}</text>`}).join("")}</svg>
    <div class="legend"><span><i style="background:var(--accent);height:10px"></i>Done points</span><span><i style="background:var(--line);height:10px"></i>Committed</span><span><i style="background:var(--amber);height:10px"></i>Current sprint so far</span></div>`;
}
function sprintRemarks(n){
  const out=[];sprintTasks().forEach(t=>t.comments.forEach(c=>out.push({...c,task:t})));
  return out.sort((a,b)=>b.at-a.at).slice(0,n);
}
function remarkRow(c){
  return `<div class="remark"><div class="rmeta"><span class="chip ${KIND[c.kind].cls}">${KIND[c.kind].label}</span>
    <b>${esc(mName(c.by))}</b><span>on</span><button class="linkish" data-open="${esc(c.task.id)}">${esc(shortId(c.task))} ${esc(c.task.title)}</button>
    <span>${timeAgo(c.at)}</span>${c.resolved?"<span>· resolved</span>":""}</div><p>${esc(c.text)}</p></div>`;
}
function viewInsights(){
  const s=sprint(state.sprintId);if(!s)return '<div class="panel empty">Create a sprint to see insights.</div>';
  const ts=sprintTasks();const committed=ts.reduce((a,t)=>a+t.points,0);const done=ts.filter(t=>t.status==="done").reduce((a,t)=>a+t.points,0);
  const blocked=ts.filter(t=>t.status==="blocked").sort((a,b)=>(a.blockedAt||0)-(b.blockedAt||0));
  const lostDays=ts.reduce((a,t)=>a+t.blockedMs+(t.status==="blocked"&&t.blockedAt?Date.now()-t.blockedAt:0),0)/DAY;
  const recent=liveTasks().filter(t=>t.doneAt&&t.doneAt>Date.now()-60*DAY);const ct=cycleDays(recent);
  const est=ts.reduce((a,t)=>a+t.estimateH,0),logged=ts.reduce((a,t)=>a+t.loggedH,0);
  const byType=Object.keys(TYPES).map(k=>{const c=cycleDays(recent.filter(t=>t.type===k));return `<tr><td>${TYPES[k]}</td><td class="num">${c==null?"–":c.toFixed(1)+" days"}</td></tr>`}).join("");
  const erp={};ts.forEach(t=>{const k=t.erpRef||"(none)";erp[k]=erp[k]||{est:0,log:0,n:0};erp[k].est+=t.estimateH;erp[k].log+=t.loggedH;erp[k].n++});
  const erpRows=Object.entries(erp).sort((a,b)=>b[1].log-a[1].log).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${fmtH(v.est)}</td><td class="num">${fmtH(v.log)}</td></tr>`).join("");
  const rc=sprintRemarks(10);
  return `<div class="stats">
    <div class="stat"><b>${done}<small style="font-size:16px"> / ${committed}</small></b><small>Points done this sprint</small></div>
    <div class="stat"><b>${committed?Math.round(done/committed*100):0}%</b><small>Sprint completion</small></div>
    <div class="stat"><b style="color:${blocked.length?"var(--red)":"var(--cyan)"}">${blocked.length}</b><small>Blocked now · ${lostDays.toFixed(1)} task-days blocked this sprint</small></div>
    <div class="stat"><b>${ct==null?"–":ct.toFixed(1)}</b><small>Avg cycle time, days (60d)</small></div>
    <div class="stat"><b>${hr(logged)}<small style="font-size:16px"> / ${hr(est)} h</small></b><small>Logged vs estimated</small></div>
  </div>
  <div class="two"><div class="panel"><h2>Burndown · ${esc(s.name)}</h2>${burndown(s,ts)}</div>
    <div class="panel"><h2>Blocked work</h2>${blocked.length?`<table><tbody>${blocked.map(t=>`<tr><td><button class="linkish" data-open="${esc(t.id)}">${esc(t.title)}</button>${t.blockedReason?`<br><small>${esc(t.blockedReason)}</small>`:""}</td><td>${esc(names(t)||"–")}</td><td class="num">${blockedDays(t)} d</td></tr>`).join("")}</tbody></table>`:'<div class="empty">Nothing is blocked.</div>'}
    <h3 style="margin-top:18px">Cycle time by type</h3><table><tbody>${byType}</tbody></table></div></div>
  <div class="two"><div class="panel"><h2>Velocity</h2>${velocity()}</div>
    <div class="panel"><h2>Hours by ERP reference</h2>${erpRows?`<div class="tbl-scroll"><table><thead><tr><th>ERP ref</th><th class="num">Tasks</th><th class="num">Est.</th><th class="num">Logged</th></tr></thead><tbody>${erpRows}</tbody></table></div>`:'<div class="empty">No tasks in this sprint.</div>'}
    ${downloads?`<div class="actions"><button class="btn" data-export>Export worklogs for ERP (CSV)</button></div><p class="goal" style="margin:8px 0 0">One row per worklog: date, person, hours, task and ERP reference, ready for costing or payroll import.</p>`:""}</div></div>
  <div class="panel"><h2>Issues and remarks this sprint</h2>${rc.length?rc.map(remarkRow).join(""):'<div class="empty">No comments yet. Team members add them from any task.</div>'}</div>`;
}
async function exportCsv(){
  if(!downloads)return;const s=sprint(state.sprintId);
  const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const lines=[["date","person","hours","task_key","task_title","erp_reference","sprint","task_status","note"].join(",")];
  sprintTasks().forEach(t=>t.worklogs.forEach(w=>lines.push([w.date,mName(w.by),w.hours,shortId(t),t.title,t.erpRef,s?.name,COLS[t.status],w.note].map(q).join(","))));
  try{await downloads.save({filename:`erp-worklogs-${(s?.name||"sprint").replace(/\W+/g,"-")}.csv`,data:new Blob([lines.join("\n")],{type:"text/csv"})});toast("Export saved")}
  catch(e){toast("The export was not saved.")}
}

/* ================= overview ================= */
const EPIC_COLORS=[["#5ac991","rgba(90,201,145,.15)"],["#00d9ff","rgba(0,217,255,.13)"],["#f59e0b","rgba(245,158,11,.15)"],["#ef4444","rgba(239,68,68,.14)"],["#a78bfa","rgba(167,139,250,.16)"]];
const ICONS={
  team:'<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="15" cy="13" r="6"/><path d="M4 34c0-6 5-10 11-10s11 4 11 10"/><circle cx="29" cy="15" r="4.5"/><path d="M27 23.5c5 0 9 3.5 9 9"/></svg>',
  done:'<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="30" height="22" rx="3"/><path d="M14 11V7h12v4"/><path d="M13 22l5 5 9-10"/></svg>',
  blocked:'<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="20" cy="20" r="14"/><path d="M10 10l20 20"/></svg>'};
function velBars(){
  const v=sortedSprints().filter(x=>x.state!=="planned").slice(-8).map(x=>donePts(x.id));const m=Math.max(1,...v);
  return `<svg width="${Math.max(9,v.length*9)}" height="40" aria-hidden="true">${v.map((n,i)=>`<rect x="${i*9}" y="${40-Math.max(3,n/m*40)}" width="5" height="${Math.max(3,n/m*40)}" rx="1.5" fill="currentColor" opacity="${i===v.length-1?1:.55}"/>`).join("")}</svg>`;
}
function weekDots(s){
  const start=parseDate(s.start),n=Math.round((parseDate(s.end)-start)/DAY)+1,today=new Date();today.setHours(0,0,0,0);
  if(n>7){const p=Math.max(0,Math.min(1,(today-start)/(n*DAY)));return `<div class="bar" style="width:100%"><i style="width:${p*100}%"></i></div>`}
  return `<div class="week">${Array.from({length:n},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);const t=d.getTime();return `<span><i class="${t<today.getTime()?"past":t===today.getTime()?"today":""}"></i>${d.toLocaleDateString(undefined,{weekday:"narrow"})}</span>`}).join("")}</div>`;
}
function ovChart(s,ts){
  const start=parseDate(s.start),days=Math.round((parseDate(s.end)-start)/DAY)+1;
  const total=ts.reduce((a,t)=>a+t.points,0);
  if(!total)return '<div class="empty">No story points in this sprint yet. Plan tasks from the Backlog.</div>';
  const W=640,H=250,L=34,R=14,T=14,B=30;const x=i=>L+i*(W-L-R)/days;const y=v=>T+(1-v/total)*(H-T-B);
  const now=Date.now(),burn=state.chartMode==="burndown";let path=`M${x(0)},${y(burn?total:0)}`,last=0;
  for(let i=0;i<days;i++){if(start+i*DAY>now)break;
    const done=ts.filter(t=>t.status==="done"&&t.doneAt&&t.doneAt<start+(i+1)*DAY).reduce((a,t)=>a+t.points,0);
    path+=` H${x(i+1)} V${y(burn?total-done:done)}`;last=i+1}
  const area=`${path} H${x(last)} V${y(0)} H${x(0)} Z`;
  let grid="";for(let k=0;k<=4;k++){const v=Math.round(total*k/4);grid+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`}
  const step=days>7?2:1;let lbl="";for(let i=0;i<days;i+=step)lbl+=`<text x="${(x(i)+x(i+1))/2}" y="${H-8}" text-anchor="middle">${new Date(start+i*DAY).toLocaleDateString(undefined,days>7?{day:"numeric",month:"short"}:{weekday:"short"})}</text>`;
  const guide=burn?`<line x1="${x(0)}" y1="${y(total)}" x2="${x(days)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="5 5"/>`:`<line x1="${x(0)}" y1="${y(total)}" x2="${x(days)}" y2="${y(total)}" stroke="var(--muted)" stroke-dasharray="5 5"/>`;
  return `<div class="chart-legend"><span><i style="border:2px solid var(--accent)"></i>${burn?"Points remaining":"Points done"}</span><span><i style="border:2px dashed var(--muted)"></i>${burn?"Guideline":"Sprint scope"}</span></div>
  <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${burn?"Burndown":"Burnup"} chart"><defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac991" stop-opacity=".22"/><stop offset="1" stop-color="#5ac991" stop-opacity="0"/></linearGradient></defs>
  ${grid}${lbl}${guide}${last?`<path d="${area}" fill="url(#ovg)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`:""}</svg>`;
}
function ring(p,val){const r=22,c=2*Math.PI*r;p=Math.max(0,Math.min(1,p||0));
  return `<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--line)" stroke-width="4"/><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c*p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="33" text-anchor="middle" style="font:700 14px var(--font);fill:var(--ink)">${val}</text></svg>`}
function viewOverview(){
  const s=sprint(state.sprintId);
  if(!s)return `<div class="panel empty">${members().length?"No sprints yet.":"Welcome. Start by signing in to set up the admin account, then add your team from the Admin tab."} <button class="btn small ov-ctrl" data-planweek>Plan this week's sprint</button></div>`;
  const ss=sortedSprints(),idx=ss.findIndex(x=>x.id===s.id),ts=sprintTasks();
  const doneT=ts.filter(t=>t.status==="done"),pts=ts.reduce((a,t)=>a+t.points,0),dPts=doneT.reduce((a,t)=>a+t.points,0);
  const closed=ss.filter(x=>x.state==="closed").slice(-3);
  const vel=closed.length?Math.round(closed.reduce((a,x)=>a+donePts(x.id),0)/closed.length):dPts;
  const blocked=ts.filter(t=>t.status==="blocked").length,issues=ts.reduce((a,t)=>a+openIssues(t),0);
  const hasActive=ss.some(x=>x.state==="active");const dl=s.state==="active"?daysLeft(s):null;
  const timeTile=s.state==="active"?`<div class="val">${dl}<small> day${dl===1?"":"s"} left</small></div>`:s.state==="closed"?`<div class="val">Done<small> ${fmtDate(s.end)}</small></div>`:`<div class="val">${Math.max(0,Math.ceil((parseDate(s.start)-Date.now())/DAY))}<small> days to start</small></div>`;
  const rank={blocked:0,doing:1,review:2,todo:3,done:4};
  const stories=ts.slice().sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||a.priority-b.priority).slice(0,7);
  const erp={};ts.forEach(t=>{if(!t.erpRef)return;const e=erp[t.erpRef]=erp[t.erpRef]||{n:0,p:0,dp:0};e.n++;e.p+=t.points;if(t.status==="done")e.dp+=t.points});
  const epics=Object.entries(erp).sort((a,b)=>b[1].n-a[1].n).slice(0,6);
  const est=ts.reduce((a,t)=>a+t.estimateH,0),logged=ts.reduce((a,t)=>a+t.loggedH,0);
  const actBtn=s.state==="active"?`<button class="btn primary ov-ctrl" data-finish="${esc(s.id)}">Finish sprint</button>`:s.state==="planned"&&!hasActive?`<button class="btn primary ov-ctrl" data-startsp="${esc(s.id)}">Start sprint</button>`:"";
  const team=members().filter(m=>m.access!=="viewer");
  return `<div class="ov"><div style="min-width:0">
    <div class="ov-head">
      <div class="arrows ov-ctrl"><button data-sprnav="-1" aria-label="Previous sprint"${idx<=0?" disabled":""}>‹</button><button data-sprnav="1" aria-label="Next sprint"${idx>=ss.length-1?" disabled":""}>›</button></div>
      <h2>Sprint overview</h2><span class="pill${s.state==="active"?" active":""}">${esc(s.name)}, ${s.state==="active"?"current":s.state==="closed"?"finished":"planned"}</span>
      <span class="dates">${fmtDate(s.start)} – ${fmtDate(s.end)}${s.goal?`. Goal: ${esc(s.goal)}`:""}</span>${actBtn}
    </div>
    <div class="kpis">
      <div class="kpi"><div class="ico">${velBars()}</div><div><div class="lbl">Team velocity${closed.length?`, avg of last ${closed.length}`:""}</div><div class="val">${vel}<small> pts</small></div></div></div>
      <div class="kpi hi"><div class="ico">${ICONS.team}</div><div><div class="lbl">Team members</div><div class="val">${team.length}</div></div></div>
      <div class="kpi"><div class="ico">${ICONS.done}</div><div><div class="lbl">Tasks delivered</div><div class="val">${doneT.length}<small> of ${ts.length}</small></div></div></div>
      <div class="kpi"><div class="ico" style="${blocked?"color:var(--red)":""}">${ICONS.blocked}</div><div><div class="lbl">Blocked${issues?`, ${issues} open issue${issues>1?"s":""}`:""}</div><div class="val"${blocked?' style="color:var(--red)"':""}>${blocked}</div></div></div>
      <div class="kpi"><div class="ico">${weekDots(s)}</div><div><div class="lbl">${s.state==="active"?"Ends "+new Date(parseDate(s.end)).toLocaleDateString(undefined,{weekday:"long"}):"Sprint dates"}</div>${timeTile}</div></div>
    </div>
    <div class="ov-row">
      <div><div class="sec-h"><button class="alt" data-chart="burndown" aria-pressed="${state.chartMode==="burndown"}">Burndown chart</button><button class="alt" data-chart="burnup" aria-pressed="${state.chartMode==="burnup"}">Burnup chart</button></div>
        <div class="box">${ovChart(s,ts)}</div></div>
      <div><div class="sec-h"><h3>Sprint stories</h3><button class="see ov-ctrl" data-goview="board">See all</button></div>
        <div class="stories">${stories.map(t=>{return `<button class="srow" data-open="${esc(t.id)}">${avStack(t,2)}<span class="tt">${esc(t.title)}</span><span class="ss"><span class="sdot" style="background:${STATUS_COLOR[t.status]}"></span>${COLS[t.status]}</span><span class="pp">${t.points}</span></button>`}).join("")||'<div class="empty">No tasks in this sprint yet.</div>'}</div></div>
    </div>
    <div class="sec-h"><h3>Team members</h3></div>
    <div class="team-strip"><div class="ppl">${team.map(m=>{
      const mine=ts.filter(t=>isOn(t,m.id));const dp=r1(mine.filter(t=>t.status==="done").reduce((a,t)=>a+t.points*share(t),0));
      const c=offToday(m)||m.availability==="away"?"#6b7280":mine.some(t=>t.status==="blocked")?"var(--red)":mine.some(t=>t.status==="doing"||t.status==="review")?"var(--accent)":"#4a5568";
      return `<div class="tm"><span class="avatar">${esc(initials(m.name))}<i style="background:${c}"></i></span><div><b>${esc(firstName(m.name))}</b><small>${offToday(m)?"Off today":dp+" story points"}</small></div></div>`}).join("")||'<span class="empty">No team members yet.</span>'}</div>
      <button class="addm ov-ctrl" data-goview="team">Team workload</button></div>
  </div>
  <aside class="side">
    <div class="sec-h"><h3>ERP work</h3><button class="see ov-ctrl" data-goview="insights">See all</button></div>
    ${epics.map(([k,e],i)=>{const [fg,bg]=EPIC_COLORS[i%EPIC_COLORS.length];const pc=e.p?Math.round(e.dp/e.p*100):0;
      return `<div class="epic"><span class="ec" style="color:${fg};background:${bg}">${esc(k.replace(/[^A-Za-z]/g,"").slice(0,2).toUpperCase()||"#")}</span><div class="ei"><b>${esc(k)}</b><small>${e.n} task${e.n>1?"s":""}, ${pc}% done</small><div class="eb"><i style="width:${pc}%;background:${fg}"></i></div></div></div>`}).join("")||'<div class="empty">Tasks linked to ERP orders or projects appear here.</div>'}
    <div class="sec-h" style="margin-top:22px"><h3>Sprint statistics</h3></div>
    <div class="ring">${ring(pts?dPts/pts:0,pts?Math.round(dPts/pts*100):0)}<b>Sprint progress</b><small>% of points</small></div>
    <div class="ring">${ring(ts.length?doneT.length/ts.length:0,doneT.length)}<b>Tasks delivered</b><small>of ${ts.length}</small></div>
    <div class="ring">${ring(est?logged/est:0,est?Math.round(logged/est*100):0)}<b>Hours used</b><small>% of estimate</small></div>
  </aside></div>`;
}

/* ================= top 3 ================= */
function scopeSprintIds(){
  if(state.topScope==="sprint")return state.sprintId?[state.sprintId]:[];
  return sortedSprints().filter(x=>x.state!=="planned").slice(-3).map(x=>x.id);
}
function scores(){
  const ids=new Set(scopeSprintIds());const ts=liveTasks().filter(t=>ids.has(t.sprintId));
  const rows=members().map(m=>{
    const mine=ts.filter(t=>isOn(t,m.id));const done=mine.filter(t=>t.status==="done");
    const committed=mine.reduce((a,t)=>a+t.points*share(t),0),D=r1(done.reduce((a,t)=>a+t.points*share(t),0));
    const est=done.reduce((a,t)=>a+t.estimateH*share(t),0),log=done.reduce((a,t)=>a+loggedBy(t,m.id),0);
    return {m,committed,D,C:committed?D/committed:0,acc:est&&log?Math.max(0,1-Math.abs(log-est)/est):null,n:done.length};
  }).filter(r=>r.D>0);
  const maxD=Math.max(1,...rows.map(r=>r.D));
  rows.forEach(r=>{r.score=Math.round(50*r.D/maxD+30*r.C+20*(r.acc??0.5))});
  return rows.sort((a,b)=>b.score-a.score||b.D-a.D);
}
function podium(top){
  return `<div class="podium">${top.map((r,i)=>`<div class="pod r${i+1}" style="--medal:${MEDAL[i]}">
    <div class="medal" aria-label="Place ${i+1}">${i+1}</div><div class="avatar big-av">${esc(initials(r.m.name))}</div>
    <div class="pn">${esc(r.m.name)}</div><div class="sub">${esc(r.m.title)}</div>
    <div class="score">${r.score}<small>score out of 100</small></div>
    <div class="brk"><span class="chip">${r.D} pts delivered</span><span class="chip">${Math.round(r.C*100)}% of commitment done</span><span class="chip">${r.acc==null?"no hours logged":Math.round(r.acc*100)+"% estimate accuracy"}</span></div></div>`).join("")}</div>`;
}
const scopeLabel=()=>state.topScope==="sprint"?(sprint(state.sprintId)?.name||"this sprint"):"the last 3 sprints";
function viewTop(){
  const top=scores().slice(0,3);
  return `<div class="toolbar"><div class="seg" role="group" aria-label="Period">
    <button data-scope="sprint" aria-pressed="${state.topScope==="sprint"}">Selected sprint</button>
    <button data-scope="last3" aria-pressed="${state.topScope==="last3"}">Last 3 sprints</button></div>
    <span class="goal">Top performers for ${esc(scopeLabel())}</span></div>
  ${top.length?podium(top):'<div class="panel empty">No finished work in this period yet. The top 3 appears once tasks are marked done.</div>'}
  <div class="panel"><h2>How the score works</h2>
    <p style="margin:0 0 8px;max-width:72ch">Each person gets a score out of 100, built from three parts. Up to 50 points for story points delivered, compared with the highest delivery in the team. Up to 30 for finishing what they committed to in the sprint. Up to 20 for estimate accuracy: how close the hours they logged came to the estimate on finished tasks.</p>
    <p style="margin:0;max-width:72ch;color:var(--muted)">Only finished tasks count toward delivery. On a shared task the points and estimate are split evenly between the people on it, and accuracy uses each person's own logged hours. Mixing the three parts means taking lots of easy tasks, or padding estimates, doesn't win on its own.</p></div>`;
}

/* ================= TV mode ================= */
const PEOPLE_PER_PAGE=12;
function tvSlides(){
  const pages=Math.max(1,Math.ceil((members().length+(sprintTasks().some(t=>!t.assignees.length&&t.status!=="done")?1:0))/PEOPLE_PER_PAGE));
  const people=Array.from({length:pages},(_,i)=>["people:"+i,"Who's working on what"+(pages>1?` (${i+1} of ${pages})`:"")]);
  return [["overview","Sprint overview"],...people,["board","Sprint board"],["top","Top 3"],["remarks","Latest issues and remarks"]];
}
const TV_SECONDS=20;let tvElapsed=0;
function enterTv(){state.tv=true;state.followActive=true;pickSprint();ls.set("tb.tv","1");state.tvSlide=0;tvElapsed=0;document.body.classList.add("tv");
  try{const r=document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();if(r&&r.catch)r.catch(()=>{})}catch(e){}render()}
function exitTv(){state.tv=false;ls.set("tb.tv","");document.body.classList.remove("tv");try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}render()}
function tvGo(i){const n=tvSlides().length;state.tvSlide=((i%n)+n)%n;tvElapsed=0;render()}
function tvPeople(page){
  const st=sprintTasks();const rank={blocked:0,doing:1,review:2,todo:3};
  const cards=members().filter(m=>m.access!=="viewer").map(m=>{
    const mine=st.filter(t=>isOn(t,m.id));
    const open=mine.filter(t=>t.status!=="done").sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||a.priority-b.priority);
    const done=mine.length-open.length;const blocked=open.some(t=>t.status==="blocked");const off=offToday(m);
    return `<div class="person${blocked?" warn":""}"><div class="ph"><span class="avatar">${esc(initials(m.name))}</span>
      <div><div class="nm">${esc(m.name)}</div><div class="sub">${off?"Off today":esc(m.title)}</div></div><div class="pdone">${done} done</div></div>
      ${open.slice(0,5).map(t=>{const oi=openIssues(t);const run=Object.keys(t.timers).length;
        return `<div class="ptask"><span class="st st-${t.status}">${COLS[t.status]}${t.status==="blocked"?" "+(blockedDays(t)||0)+"d":""}</span><span class="pt">${esc(t.title)}${t.qty?` <span class="sub">${fmtN(t.doneUnits)}/${fmtN(t.qty)}</span>`:""}${t.assignees.length>1?`<span class="sub"> with ${esc(t.assignees.filter(x=>x!==m.id).map(x=>firstName(mName(x))).join(", "))}</span>`:""}</span>${run?'<span class="ic" style="color:var(--cyan)">⏱</span>':""}${oi?`<span class="ic">${oi} issue${oi>1?"s":""}</span>`:""}</div>`}).join("")||'<div class="ptask sub">No open tasks in this sprint</div>'}
      ${open.length>5?`<div class="more">+${open.length-5} more</div>`:""}</div>`});
  const un=st.filter(t=>!t.assignees.length&&t.status!=="done");
  if(un.length)cards.push(`<div class="person"><div class="ph"><span class="avatar none">?</span><div><div class="nm">Unassigned</div><div class="sub">Needs an owner</div></div></div>
    ${un.slice(0,5).map(t=>`<div class="ptask"><span class="st st-${t.status}">${COLS[t.status]}</span><span class="pt">${esc(t.title)}</span></div>`).join("")}</div>`);
  return `<div class="people">${cards.slice(page*PEOPLE_PER_PAGE,(page+1)*PEOPLE_PER_PAGE).join("")||'<div class="empty">No team members yet.</div>'}</div>`;
}
function tvBoard(){
  const st=sprintTasks();
  return `<div class="tvboard" style="grid-template-columns:repeat(${state.order.length},minmax(0,1fr))">${state.order.map(k=>{
    const items=st.filter(t=>t.status===k).sort((a,b)=>a.priority-b.priority);
    return `<div class="tvcol" data-status="${k}"><h3><span>${COLS[k]}</span><span>${items.length}</span></h3>
      ${items.slice(0,8).map(t=>`<div class="tvitem"><span>${esc(t.title)}${t.qty?`<span class="tvprog"><span class="prog-track"><i style="width:${Math.min(100,Math.round(t.doneUnits/t.qty*100))}%"></i></span>${Math.min(100,Math.round(t.doneUnits/t.qty*100))}%</span>`:""}</span><span style="margin-left:auto">${avStack(t,3)}</span></div>`).join("")}
      ${items.length>8?`<div class="more">+${items.length-8} more</div>`:""}</div>`}).join("")}</div>`;
}
function tvTop(){const top=scores().slice(0,3);return top.length?`<p class="sub" style="margin:-.4em 0 1em">For ${esc(scopeLabel())}: points delivered, commitment kept and estimate accuracy.</p>${podium(top)}`:'<div class="empty">The top 3 appears once tasks are finished.</div>'}
function tvRemarks(){const rc=sprintRemarks(8);return rc.length?`<div class="panel">${rc.map(remarkRow).join("")}</div>`:'<div class="empty">No comments yet this sprint.</div>'}
function renderTv(){
  const slides=tvSlides();if(state.tvSlide>=slides.length)state.tvSlide=0;
  const s=sprint(state.sprintId);const [key,title]=slides[state.tvSlide];const [kind,arg]=key.split(":");
  const body={overview:()=>viewOverview(),people:()=>tvPeople(+arg||0),board:tvBoard,top:tvTop,remarks:tvRemarks}[kind]();
  $("#main").innerHTML=`<div class="tvbar"><div><h1 class="tvtitle">${esc(state.settings.teamName)}</h1>
    <div class="sub">${s?`${esc(s.name)}, ${daysLeft(s)} day${daysLeft(s)===1?"":"s"} left${s.goal?`. Goal: ${esc(s.goal)}`:""}`:""}</div></div>
    <div class="tvdots">${slides.map((x,i)=>`<button data-tvgo="${i}" aria-label="Show ${esc(x[1])}" aria-current="${i===state.tvSlide}"><i style="width:${Math.min(100,tvElapsed/TV_SECONDS*100)}%"></i></button>`).join("")}</div>
    <div class="clock" id="tvClock">${clock()}</div>
    <button class="btn" data-tvpause>${state.tvPaused?"Resume":"Pause"}</button><button class="btn" data-tvexit>Exit TV mode</button></div>
    <h2 class="tvslide-title">${esc(title)}</h2>${body}`;
}
setInterval(()=>{
  if(!state.tv)return;const c=$("#tvClock");if(c)c.textContent=clock();
  if(state.tvPaused||document.querySelector("dialog[open]"))return;tvElapsed++;
  const bar=document.querySelector('.tvdots [aria-current="true"] i');if(bar)bar.style.width=Math.min(100,tvElapsed/TV_SECONDS*100)+"%";
  if(tvElapsed>=TV_SECONDS)tvGo(state.tvSlide+1);
},1000);
