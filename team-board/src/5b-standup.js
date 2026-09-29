/* ================= morning stand-up: one person at a time, with a timer ================= */
const su={on:false,i:0,start:0,paused:0,pausedAt:0,secs:90};
function suPeople(){return members().filter(m=>m.access!=="viewer")}
function startStandup(){su.on=true;su.i=0;su.start=Date.now();su.paused=0;su.pausedAt=0;su.secs=+ls.get("tb.suSecs")||90;$("#standup").hidden=false;document.body.classList.add("su-on");renderStandup();audioUnlock()}
function endStandup(){su.on=false;document.body.classList.remove("su-on");$("#standup").hidden=true;$("#standup").innerHTML=""}
function suGo(i){const n=suPeople().length+1;su.i=Math.max(0,Math.min(n-1,i));su.start=Date.now();su.paused=0;su.pausedAt=0;renderStandup()}
function suElapsed(){return ((su.pausedAt||Date.now())-su.start-su.paused)/1000}
function suYesterday(m){
  const d=prevWorkday();const items=[];
  state.tasks.forEach(t=>{
    const w=t.worklogs.filter(x=>x.by===m.id&&x.date===d);
    const u=w.reduce((a,x)=>a+x.units,0),h=w.reduce((a,x)=>a+x.hours,0);
    const moved=t.activity.filter(a=>a.by===m.id&&iso(new Date(a.at))===d&&/^moved this|^marked this/.test(a.text)).map(a=>a.text.replace(/^moved this /,"moved "));
    if(u||h||moved.length)items.push({t,u,h,moved});
  });
  return {d,items};
}
function renderStandup(){
  const box=$("#standup");if(!su.on||!box)return;
  const ppl=suPeople();const last=su.i>=ppl.length;
  const dots=`<div class="su-dots">${ppl.map((p,i)=>`<button data-sugo="${i}" aria-label="${esc(p.name)}" aria-current="${i===su.i}" class="${i<su.i?"done":""}">${esc(initials(p.name))}</button>`).join("")}<button data-sugo="${ppl.length}" aria-current="${last}" aria-label="Summary">∑</button></div>`;
  const bar=`<div class="su-bar"><b>Stand-up</b>${dots}<span class="su-clock" id="suClock"></span>
    <button class="btn" data-suprev>‹ Back</button><button class="btn" data-supause>${su.pausedAt?"Resume":"Pause"}</button><button class="btn primary" data-sunext>${last?"Finish":"Next person ›"}</button><button class="btn" data-suend>Close</button></div>`;
  if(last){
    const blocked=sprintTasks().filter(t=>t.status==="blocked");const yd=prevWorkday();
    const units=unitReports().filter(r=>r.date===yd).reduce((a,r)=>a+r.units,0);
    const shorts=materialPlan().filter(p=>p.short>0);
    box.innerHTML=`${bar}<div class="su-body"><h2 class="su-name">Summary</h2><div class="su-cols">
      <div class="su-col"><h3>Made on ${fmtDate(yd)}</h3><p class="su-big">${fmtN(units)} <small>units</small></p></div>
      <div class="su-col"><h3>Blocked now</h3>${blocked.length?blocked.map(t=>`<div class="su-item bad"><b>${esc(shortId(t))} ${esc(t.title)}</b><small>${esc(t.blockedReason||"no reason given")} · ${esc(names(t)||"no one")}</small></div>`).join(""):'<p class="muted">Nothing is blocked.</p>'}</div>
      <div class="su-col"><h3>Materials short</h3>${shorts.length?shorts.slice(0,8).map(p=>`<div class="su-item bad"><b>${esc(p.name)}</b><small>short ${fmtN(p.short)} ${esc(p.unit)}</small></div>`).join(""):'<p class="muted">Nothing is short for the open orders.</p>'}</div></div></div>`;
    tickStandup();return;
  }
  const m=ppl[su.i];const y=suYesterday(m);const off=offToday(m);
  const open=liveTasks().filter(t=>isOn(t,m.id)&&t.status!=="done").sort((a,b)=>({doing:0,blocked:1,review:2,todo:3}[a.status]??9)-({doing:0,blocked:1,review:2,todo:3}[b.status]??9));
  const issues=[];liveTasks().filter(t=>isOn(t,m.id)).forEach(t=>t.comments.filter(c=>c.kind==="issue"&&!c.resolved).forEach(c=>issues.push({t,c})));
  box.innerHTML=`${bar}<div class="su-body"><div class="su-person">${avatar(m.id,"su-av")}<div><h2 class="su-name">${esc(m.name)}</h2><p class="muted">${esc(m.title||"")}${off?` · <span class="chip bad">Off today${off.note?": "+esc(off.note):""}</span>`:""}</p></div></div>
    <div class="su-cols">
      <div class="su-col"><h3>${y.d===addDays(todayIso(),-1)?"Yesterday":fmtDate(y.d)}</h3>${y.items.length?y.items.map(x=>`<div class="su-item"><b>${esc(x.t.title)}</b><small>${[x.u?fmtN(x.u)+" "+esc(x.t.unit)+" done":"",x.h?fmtH(x.h):"",...x.moved.map(esc)].filter(Boolean).join(" · ")}</small></div>`).join(""):'<p class="muted">Nothing reported.</p>'}</div>
      <div class="su-col"><h3>Today</h3>${open.filter(t=>t.status!=="blocked").map(t=>`<div class="su-item"><b><span class="st st-${t.status}">${COLS[t.status]}</span> ${esc(t.title)}</b>${t.qty?progHtml(t):""}</div>`).join("")||'<p class="muted">No open tasks.</p>'}</div>
      <div class="su-col"><h3>Blockers</h3>${open.filter(t=>t.status==="blocked").map(t=>`<div class="su-item bad"><b>${esc(t.title)}</b><small>${esc(t.blockedReason||"no reason given")}</small></div>`).join("")}
        ${issues.map(({t,c})=>`<div class="su-item warn"><b>Issue on ${esc(t.title)}</b><small>${esc(c.text.slice(0,140))}</small></div>`).join("")}
        ${!open.some(t=>t.status==="blocked")&&!issues.length?'<p class="muted">None.</p>':""}</div>
    </div></div>`;
  tickStandup();
}
function tickStandup(){
  const c=$("#suClock");if(!c||!su.on)return;
  if(su.i>=suPeople().length){c.textContent="";return}
  const left=Math.round(su.secs-suElapsed());const a=Math.abs(left);
  c.textContent=(left<0?"+":"")+Math.floor(a/60)+":"+String(a%60).padStart(2,"0");
  c.className="su-clock"+(left<0?" over":left<=15?" warn":"");
}
setInterval(()=>{if(su.on)tickStandup()},500);
$("#standup").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;const d=b.dataset;
  if(d.sugo!=null)return suGo(+d.sugo);
  if(d.sunext!=null)return su.i>=suPeople().length?endStandup():suGo(su.i+1);
  if(d.suprev!=null)return suGo(su.i-1);
  if(d.suend!=null)return endStandup();
  if(d.supause!=null){if(su.pausedAt){su.paused+=Date.now()-su.pausedAt;su.pausedAt=0}else su.pausedAt=Date.now();renderStandup()}
});
document.addEventListener("keydown",e=>{
  if(!su.on||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(e.key==="ArrowRight"){e.preventDefault();su.i>=suPeople().length?endStandup():suGo(su.i+1)}
  else if(e.key==="ArrowLeft"){e.preventDefault();suGo(su.i-1)}
  else if(e.key==="Escape")endStandup();
},true);

/* ================= TV: production slide ================= */
function tvProduction(){
  const yd=prevWorkday();const rep=unitReports();const ydU=rep.filter(r=>r.date===yd).reduce((a,r)=>a+r.units,0);
  const tdU=rep.filter(r=>r.date===todayIso()).reduce((a,r)=>a+r.units,0);
  const plan=materialPlan();const shorts=plan.filter(p=>p.short>0);const soon=plan.filter(p=>!p.short&&p.days!=null&&p.days<7);
  return `<div class="stats"><div class="stat"><b style="color:var(--pink)">${fmtN(ydU)}</b><small>Made ${yd===addDays(todayIso(),-1)?"yesterday":"on "+fmtDate(yd)}</small></div>
      <div class="stat"><b>${fmtN(tdU)}</b><small>Made today so far</small></div>
      <div class="stat"><b style="color:${shorts.length?"var(--red)":"var(--accent)"}">${shorts.length}</b><small>Materials short</small></div></div>
    <div class="two"><div class="panel">${outputChart(outputByDay(14))}</div>
      <div class="panel"><h2>Watch out</h2>${[...shorts.map(p=>`<div class="su-item bad"><b>${esc(p.name)}</b><small>short ${fmtN(p.short)} ${esc(p.unit)} for open orders</small></div>`),
        ...soon.map(p=>`<div class="su-item warn"><b>${esc(p.name)}</b><small>runs out in ${daysText(p.days)} at the current pace</small></div>`)].slice(0,7).join("")||'<p class="muted">Materials are fine for all open orders.</p>'}</div></div>`;
}

/* ================= alert when something becomes blocked ================= */
let actx=null;
function audioUnlock(){try{if(!actx){const A=window.AudioContext||window.webkitAudioContext;if(A)actx=new A()}if(actx&&actx.state==="suspended")actx.resume()}catch(e){}}
document.addEventListener("pointerdown",audioUnlock,{once:true});
function beep(){
  try{audioUnlock();if(!actx)return;const t0=actx.currentTime;
    [[880,0],[660,.22],[880,.44]].forEach(([f,s])=>{const o=actx.createOscillator(),g=actx.createGain();o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(.0001,t0+s);g.gain.exponentialRampToValueAtTime(.35,t0+s+.02);g.gain.exponentialRampToValueAtTime(.0001,t0+s+.2);o.connect(g).connect(actx.destination);o.start(t0+s);o.stop(t0+s+.22)});
  }catch(e){}
}
const alertsOn=()=>{const v=ls.get("tb.alerts");return v?v==="1":state.tv};
let prevStatus=null;
function watchBlocked(){
  const now=new Map(state.tasks.map(t=>[t.id,t.deleted?"deleted":t.status]));
  if(prevStatus){state.tasks.forEach(t=>{if(!t.deleted&&t.status==="blocked"&&prevStatus.has(t.id)&&prevStatus.get(t.id)!=="blocked")blockedAlert(t)})}
  prevStatus=now;
}
function blockedAlert(t){
  if(!alertsOn())return;
  const el=$("#alertBar");el.innerHTML=`<b>Blocked:</b> ${esc(shortId(t))} ${esc(t.title)}${t.blockedReason?` · ${esc(t.blockedReason)}`:""}${t.assignees.length?` · ${esc(names(t))}`:""}<button type="button" aria-label="Dismiss">×</button>`;
  el.hidden=false;el.classList.remove("flash");void el.offsetWidth;el.classList.add("flash");beep();
  clearTimeout(blockedAlert._t);blockedAlert._t=setTimeout(()=>{el.hidden=true},20000);
}
$("#alertBar").addEventListener("click",()=>{$("#alertBar").hidden=true});
