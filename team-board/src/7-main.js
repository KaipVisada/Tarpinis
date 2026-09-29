/* ================= render ================= */
const VIEWS={overview:viewOverview,my:viewMy,production:viewProduction,board:viewBoard,backlog:viewBacklog,team:viewTeam,top:viewTop,insights:viewInsights,admin:viewAdmin};
function render(){
  try{
    document.title=state.settings.teamName;$("#teamName").textContent=state.settings.teamName;
    const sel=$("#sprintSel");const ss=sortedSprints();
    sel.innerHTML=ss.length?ss.map(s=>`<option value="${esc(s.id)}"${s.id===state.sprintId?" selected":""}>${esc(s.name)}${s.state==="active"?" (active)":s.state==="closed"?" (closed)":""}</option>`).join(""):'<option>None yet</option>';
    const s=sprint(state.sprintId);$("#sprintDates").textContent=s?`${fmtDate(s.start)} – ${fmtDate(s.end)}`:"";
    renderWho();renderMyTimer();saveStatus();
    if((state.view==="admin"||state.view==="erp")&&!(me()&&me().access==="admin"))state.view="overview";
    if(state.view==="erp"&&!window.__desktop)state.view="overview";
    const host=$("#erpHost");const showErp=state.view==="erp"&&!state.tv;
    if(showErp&&!host.firstChild)host.innerHTML='<iframe class="erp-frame" src="erp.html" title="ERP"></iframe>';
    host.hidden=!showErp;$("#main").hidden=showErp;
    document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.v===state.view));
    if($("#twDlg").open)renderTW();
    if(state.tv){renderTv();return}
    if(showErp)return;
    const focusId=document.activeElement&&document.activeElement.id;let pos=null;try{pos=focusId&&$("#main").contains(document.activeElement)?document.activeElement.selectionStart:null}catch(e){}
    const same=render.lastView===state.view;render.lastView=state.view;
    const keep=same?snapView():null;
    $("#main").innerHTML=(VIEWS[state.view]||viewOverview)();
    if(focusId&&["q","admQ"].includes(focusId)){const q=document.getElementById(focusId);if(q){q.focus();if(pos!=null)q.setSelectionRange(pos,pos)}}
    if(keep)restoreView(keep);
  }catch(e){showCrash(e)}
}
function snapView(){
  const k={y:window.scrollY,bx:$(".board-scroll")?.scrollLeft||0,cols:{},vals:[],foc:null};
  document.querySelectorAll(".col-body").forEach(b=>k.cols[b.parentElement.dataset.status]=b.scrollTop);
  document.querySelectorAll("#main form").forEach(f=>[...f.elements].forEach(el=>{
    if(el.id&&/INPUT|TEXTAREA|SELECT/.test(el.tagName)&&el.type!=="submit"&&(el.tagName==="SELECT"||el.value!==el.defaultValue))k.vals.push([el.id,el.type==="checkbox"?el.checked:el.value])}));
  const a=document.activeElement;
  if(a&&a.id&&$("#main").contains(a)&&a.closest("form")){let s=null,e=null;try{s=a.selectionStart;e=a.selectionEnd}catch(x){}k.foc=[a.id,s,e]}
  return k;
}
function restoreView(k){
  const bs=$(".board-scroll");if(bs)bs.scrollLeft=k.bx;
  document.querySelectorAll(".col-body").forEach(b=>{const v=k.cols[b.parentElement.dataset.status];if(v)b.scrollTop=v});
  k.vals.forEach(([id,v])=>{const el=document.getElementById(id);if(el){if(el.type==="checkbox")el.checked=v;else el.value=v}});
  if(k.foc){const el=document.getElementById(k.foc[0]);if(el){el.focus({preventScroll:true});try{if(k.foc[1]!=null)el.setSelectionRange(k.foc[1],k.foc[2])}catch(x){}}}
  if(Math.abs(window.scrollY-k.y)>1)window.scrollTo(0,k.y);
}
/* crash protection: a bug in one view never blanks the whole board or loses data */
let crashShown=false;
function showCrash(e){
  console.error(e);
  const n=Q.ops.length;
  setNotice(`Something went wrong while showing this page. ${n?`${n} unsaved change${n>1?"s are":" is"} kept and will keep retrying.`:"Everything you saved is safe."} <button class="btn small" id="crashReload">Show the board again</button>`,"err");
  crashShown=true;
}
window.addEventListener("error",e=>{if(e.error)showCrash(e.error)});
window.addEventListener("unhandledrejection",e=>{console.error(e.reason);const c=e.reason&&e.reason.code;if(c&&FATAL.includes(c))toast(errMsg(e.reason))});
document.addEventListener("click",e=>{if(e.target.id==="crashReload"){setNotice("");crashShown=false;state.view="overview";render()}});

/* ================= events ================= */
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("button");if(b){state.view=b.dataset.v;ls.set("tb.view",state.view==="admin"||state.view==="erp"?"":state.view);render()}});
function chooseSprint(id){state.sprintId=id;state.followActive=sprint(id)?.state==="active";render()}
$("#sprintSel").addEventListener("change",e=>chooseSprint(e.target.value));
$("#tvBtn").addEventListener("click",()=>{audioUnlock();enterTv()});
$("#suBtn").addEventListener("click",startStandup);
$("#newTask").addEventListener("click",()=>openNew({sprintId:["board","overview"].includes(state.view)?state.sprintId:""}));
document.addEventListener("keydown",e=>{
  if(!state.tv||su.on||document.querySelector("dialog[open]")||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(e.key===" "&&e.target.tagName==="BUTTON")return;
  if(e.key==="ArrowRight")tvGo(state.tvSlide+1);else if(e.key==="ArrowLeft")tvGo(state.tvSlide-1);
  else if(e.key==="Escape")exitTv();else if(e.key===" "){e.preventDefault();state.tvPaused=!state.tvPaused;render()}
});
const main=$("#main");
main.addEventListener("input",e=>{
  if(e.target.id==="q"){state.q=e.target.value;render()}
  if(e.target.id==="admQ"){state.adm.q=e.target.value;render()}
});
main.addEventListener("change",async e=>{
  const t=e.target;
  if(t.id==="who"){state.who=t.value;render()}
  if(t.id==="typeF"){state.type=t.value;render()}
  if(t.id==="admWho"){state.adm.who=t.value;render()}
  if(t.id==="admKind"){state.adm.kind=t.value;render()}
  if(t.id==="tplSel"){state.adm.tpl=t.value;render()}
  if(t.dataset.plan&&t.value){const id=t.dataset.plan,sid=t.value;const ok=await act(m=>taskUpdate(id,{sprintId:sid},`moved this to ${sprintName(sid)}`,m.id));if(ok)toast("Moved to "+sprintName(sid));else render()}
});
main.addEventListener("click",async e=>{
  if(Date.now()<noClickUntil){e.preventDefault();return}
  const b=e.target.closest("button,[data-id]");if(!b)return;const d=b.dataset;
  if(await adminClick(d))return;
  if(d.mysignin!=null)return who();
  if(d.tpldel){const pid=d.tpldel;act(async m=>{if(!await ask({title:"Remove this template?",body:"Existing tasks keep their checklists.",ok:"Remove",danger:true}))return;await enqueue("templates/"+pid,"delete");toast("Template removed")},{admin:true});return}
  if(d.mystatus)return moveTask(d.id2,d.mystatus);
  if(d.myform){myUi.form=d.id2;myUi.kind=d.myform;render();const f=$(d.myform==="blocked"?"#myReason":($("#myUnits")?"#myUnits":"#myHours"));if(f)f.focus();return}
  if(d.myclose!=null){myUi.form=null;return render()}
  if(d.mytap)return myTap(d.id2,+d.mytap);
  if(d.colmove){const id=d.colmove;state.menuFor=null;await moveColumn(id,state.order.indexOf(id)+Number(d.dir));return}
  if(d.tvgo!=null)return tvGo(+d.tvgo);
  if(d.tvstandup!=null)return startStandup();
  if(d.tvalerts!=null){ls.set("tb.alerts",alertsOn()?"0":"1");if(alertsOn()){audioUnlock();beep()}return render()}
  if(d.tvpause!=null){state.tvPaused=!state.tvPaused;return render()}
  if(d.tvexit!=null)return exitTv();
  if(d.scope){state.topScope=d.scope;return render()}
  if(d.mine!=null){const lm=lastMe();state.who=state.who===lm?"":lm;return render()}
  if(d.check){const t=task(d.check);if(t){const done=t.status!=="done";const ok=await moveTask(t.id,done?"done":"doing");if(ok!==false)toast(done?"Marked as done":"Moved back to In progress")}return}
  if(d.colmenu){state.menuFor=state.menuFor===d.colmenu?null:d.colmenu;return render()}
  if(d.addin){state.menuFor=null;render();return openNew({sprintId:state.sprintId,status:d.addin})}
  if(d.sprnav){const ss=sortedSprints();const i=ss.findIndex(x=>x.id===state.sprintId)+Number(d.sprnav);if(ss[i])chooseSprint(ss[i].id);return}
  if(d.finish)return finishSprint(d.finish);
  if(d.startsp)return startSprint(d.startsp);
  if(d.delsprint){const s=sprint(d.delsprint);if(s)act(async m=>{if(liveTasks().some(t=>t.sprintId===s.id)){toast("Move its tasks out first.");return}
    await enqueue("sprints/"+s.id,"update",{deleted:true,deletedAt:Date.now(),deletedBy:m.id});logEvent("sprint",`deleted ${s.name}`,m.id);toast(`${s.name} moved to Trash`)});return}
  if(d.chart){state.chartMode=d.chart;return render()}
  if(d.goview){state.view=d.goview;return render()}
  if(d.goadmin){state.view="admin";state.adm.tab=d.goadmin;return render()}
  if(d.planweek!=null){act(async m=>{const nw=nextWeek();if(await enqueue("sprints/"+uid("s"),"set",{...nw,goal:"",state:"planned"})){logEvent("sprint",`planned ${nw.name}`,m.id);toast(`${nw.name} planned`)}});return}
  if(d.export!=null)return exportCsv();
  if(d.xlsx!=null)return exportExcel();
  if(d.proddays){state.prodDays=+d.proddays;return render()}
  if(d.open)return openTW(d.open);
  if(b.classList.contains("card"))return openTW(d.id);
});
main.addEventListener("submit",async e=>{
  e.preventDefault();const f=e.target;
  if(f.id==="setForm")return saveSettings();
  if(f.id==="tplForm")return saveTemplate(f);
  if(f.id==="copyForm")return act(async m=>{try{desk.copy=await deskPost("/api/backup-copy",{dir:$("#copyDir").value});logEvent("backup",`set the extra backup folder to ${desk.copy.dir||"none"}`,m.id);render();toast(desk.copy.error?"Saved, but the copy failed: "+desk.copy.error:desk.copy.dir?"Folder saved and first copy made":"Extra copy turned off")}catch(e){toast(e.message)}},{admin:true});
  if(f.id==="remoteForm")return act(async m=>{const pw=$("#remotePw").value;try{desk.remote=await deskPost("/api/remote",{enabled:true,password:pw});logEvent("security",pw?"set the password for access from outside":"turned on access from outside",m.id);render();toast("Outside access is on")}catch(e){toast(e.message)}},{admin:true});
  if(f.dataset.myreport||f.dataset.myblock)return mySubmit(f);
  if(f.id==="sprintForm"){
    const name=$("#spName").value.trim(),start=$("#spStart").value,end=$("#spEnd").value,goal=$("#spGoal").value.trim();
    if(!name)return;if(!isoOk(start)||!isoOk(end)||end<start){toast("The end date can't be before the start date.");return}
    await act(async m=>{if(await enqueue("sprints/"+uid("s"),"set",{name,start,end,goal,state:"planned"})){logEvent("sprint",`created ${name}`,m.id);toast(`${name} created`);f.reset()}});
  }
});
main.addEventListener("keydown",e=>{const c=e.target.closest&&e.target.closest(".card");if(c&&e.target===c&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openTW(c.dataset.id)}});
document.addEventListener("click",e=>{if(state.menuFor&&!e.target.closest(".col-h")){state.menuFor=null;render()}});
/* drag and drop on the board (mouse). On touchscreens use the Status menu in the task window. */
let dragKind=null,dragId=null;
const clearMarks=()=>document.querySelectorAll(".col").forEach(c=>c.classList.remove("over","col-before","col-after","dragging"));
main.addEventListener("dragstart",e=>{
  const h=e.target.closest("[data-colid]");
  if(h){dragKind="col";dragId=h.dataset.colid;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","col:"+dragId);h.parentElement.classList.add("dragging");return}
  const c=e.target.closest(".card");if(c){dragKind="card";dragId=c.dataset.id;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",c.dataset.id)}
});
function colSide(col,e){const r=col.getBoundingClientRect();return e.clientX<r.left+r.width/2?"before":"after"}
main.addEventListener("dragover",e=>{
  const col=e.target.closest(".col");if(!col||!dragKind)return;e.preventDefault();
  if(dragKind==="card"){col.classList.add("over");return}
  if(col.dataset.status===dragId)return;
  const side=colSide(col,e);col.classList.toggle("col-before",side==="before");col.classList.toggle("col-after",side==="after");
});
main.addEventListener("dragleave",e=>{const col=e.target.closest(".col");if(col&&!col.contains(e.relatedTarget))col.classList.remove("over","col-before","col-after")});
main.addEventListener("drop",e=>{
  const col=e.target.closest(".col");if(!col||!dragKind)return;e.preventDefault();
  const kind=dragKind,id=dragId;dragKind=dragId=null;
  if(kind==="card"){clearMarks();moveTask(id,col.dataset.status);return}
  const target=col.dataset.status;if(target===id){clearMarks();return}
  const side=colSide(col,e);const rest=state.order.filter(k=>k!==id);
  clearMarks();moveColumn(id,rest.indexOf(target)+(side==="after"?1:0));
});
main.addEventListener("dragend",()=>{dragKind=dragId=null;clearMarks()});
/* touchscreens: press and hold a card for a moment, then drag it to another column */
let td=null,noClickUntil=0;
function tdEnd(){if(!td)return;clearTimeout(td.timer);if(td.ghost)td.ghost.remove();if(td.el)td.el.classList.remove("lifting");clearMarks();td=null}
main.addEventListener("touchstart",e=>{
  const c=e.target.closest(".card");if(!c||e.touches.length>1||e.target.closest("button"))return;
  const p=e.touches[0];tdEnd();
  td={id:c.dataset.id,el:c,x:p.clientX,y:p.clientY,active:false,timer:setTimeout(()=>{
    if(!td)return;td.active=true;c.classList.add("lifting");try{navigator.vibrate&&navigator.vibrate(25)}catch(x){}
    const r=c.getBoundingClientRect();const g=c.cloneNode(true);g.className+=" drag-ghost";g.style.width=r.width+"px";g.style.left=(td.x-r.width/2)+"px";g.style.top=(td.y-20)+"px";document.body.appendChild(g);td.ghost=g;td.w=r.width},380)};
},{passive:true});
main.addEventListener("touchmove",e=>{
  if(!td)return;const p=e.touches[0];
  if(!td.active){if(Math.hypot(p.clientX-td.x,p.clientY-td.y)>10)tdEnd();return}
  e.preventDefault();
  td.ghost.style.left=(p.clientX-td.w/2)+"px";td.ghost.style.top=(p.clientY-20)+"px";td.lx=p.clientX;td.ly=p.clientY;
  td.ghost.style.pointerEvents="none";const under=document.elementFromPoint(p.clientX,p.clientY);const col=under&&under.closest(".col");
  document.querySelectorAll(".col.over").forEach(x=>{if(x!==col)x.classList.remove("over")});if(col)col.classList.add("over");
  const sc=$(".board-scroll");if(sc){const r=sc.getBoundingClientRect();if(p.clientX>r.right-40)sc.scrollLeft+=12;else if(p.clientX<r.left+40)sc.scrollLeft-=12}
},{passive:false});
main.addEventListener("touchend",()=>{
  if(!td)return;if(td.active){noClickUntil=Date.now()+500;const under=td.lx!=null?document.elementFromPoint(td.lx,td.ly):null;const col=under&&under.closest(".col");const id=td.id;tdEnd();if(col)moveTask(id,col.dataset.status);return}
  tdEnd();
});
main.addEventListener("touchcancel",tdEnd);

/* ================= start ================= */
if(location.hash==="#tv"||ls.get("tb.tv")==="1"){state.tv=true;document.body.classList.add("tv")}
render();
(async()=>{
  const c=window.claude;
  const get=n=>c&&c.use?c.use(n).catch(()=>null):Promise.resolve(null);
  const [d,dl,as,u]=await Promise.all([get("db"),get("downloads"),get("assets"),get("user")]);
  downloads=dl;assets=as;userCap=u;
  if(u){try{state.isOwner=!!(await u.isOwner())}catch(e){}}
  if(!d){setNotice("Shared storage isn't available in this view, so changes stay on this screen only and are lost when you close it.");saveStatus();render();return}
  db=d;saveStatus();
  ["members","sprints","tasks"].forEach(subscribe);
  db.collection("config").onSnapshot(s=>{const r={};s.docs.forEach(x=>{r[x.id]=x.data()});raw.config=r;rebuild("config");state.loaded.config=true;render();maybeDailyBackup()},snapErr);
  db.collection("log").where("day",">=",iso(new Date(Date.now()-400*DAY))).onSnapshot(s=>{state.logs=s.docs.map(x=>({day:x.id,...x.data()}));if(state.view==="admin")render()},snapErr);
  db.collection("backups").onSnapshot(s=>{state.backups=s.docs.map(x=>{const o=x.data();return {id:x.id,kind:str(o.kind,20)||"manual",note:str(o.note,200),by:typeof o.by==="string"?o.by:null,at:num(o.at),day:str(o.day,10),parts:Math.max(1,num(o.parts,1)),size:num(o.size),counts:{tasks:0,members:0,sprints:0,...(o.counts||{})}}});state.loaded.backups=true;if(state.view==="admin")render();maybeDailyBackup()},snapErr);
  db.collection("templates").onSnapshot(s=>{state.templates=s.docs.map(x=>({id:x.id,...x.data()}));render()},()=>{});
  db.doc("erp/main").onSnapshot(s=>{state.erp=s.exists?s.data():null;if(state.view!=="erp")render();else if($("#twDlg").open)renderTW()},()=>{});
  if(Q.ops.length){toast(`Saving ${Q.ops.length} change${Q.ops.length>1?"s":""} left over from last time`);pump()}
})();
