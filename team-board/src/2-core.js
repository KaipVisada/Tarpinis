"use strict";
/* ================= constants & helpers ================= */
const COLS={todo:"To do",doing:"In progress",blocked:"Blocked",review:"Review",done:"Done"};
const DEFAULT_ORDER=["todo","doing","blocked","review","done"];
const ACCESS={admin:"Admin",worker:"Worker",viewer:"Viewer"};
const AVAIL={available:["Available","ok"],busy:["Busy","warn"],away:["Away","bad"]};
const KIND={comment:{label:"Comment",cls:"k-comment"},issue:{label:"Issue",cls:"k-issue"},lesson:{label:"What went wrong",cls:"k-lesson"}};
const PRIO={1:"High",2:"Medium",3:"Low"};
const TYPES={story:"Story",task:"Task",bug:"Bug"};
const DEFAULT_SETTINGS={teamName:"Team board",keyPrefix:"DF",lockMinutes:3,dailyBackup:true,trashDays:30,keepDaily:14,keepOther:20};
const DAY=86400000;
const MEDAL=["#f5c451","#c9d1dc","#d08a4f"];
const hr=v=>Math.round((+v||0)*100)/100;
const fmtH=v=>{v=hr(v);return (Number.isInteger(v)?v:v.toFixed(2).replace(/0$/,""))+" h"};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(e){}}};
const ss={get(k){try{return sessionStorage.getItem(k)}catch(e){return null}},set(k,v){try{v?sessionStorage.setItem(k,v):sessionStorage.removeItem(k)}catch(e){}}};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=p=>p+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayIso=()=>iso(new Date());
const parseDate=s=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,(m||1)-1,d||1).getTime()};
const fmtDate=s=>new Date(parseDate(s)).toLocaleDateString(undefined,{month:"short",day:"numeric"});
const fmtStamp=ms=>ms?new Date(ms).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"";
const fmtDay=ms=>new Date(ms).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
const initials=n=>String(n||"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("")||"?";
const firstName=n=>String(n||"").split(/\s+/)[0]||"Someone";
const byName=(a,b)=>a.name.localeCompare(b.name);
const fmtBytes=b=>b<1024?b+" B":b<1048576?(b/1024).toFixed(0)+" KB":(b/1048576).toFixed(1)+" MB";
const clock=()=>new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
function timeAgo(ms){const s=(Date.now()-ms)/1000;if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";const d=Math.floor(s/86400);return d===1?"yesterday":d<30?d+" days ago":fmtDay(ms)}
function elapsed(ms){ms=Math.max(0,ms);const h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
const vals=o=>o&&typeof o==="object"?Object.entries(o).filter(([k,v])=>v&&typeof v==="object"&&!v.deleted).map(([k,v])=>({...v,id:k})):[];

/* ================= state ================= */
const state={tasks:[],members:[],sprints:[],logs:[],backups:[],settings:{...DEFAULT_SETTINGS},order:DEFAULT_ORDER.slice(),
  view:ls.get("tb.view")||"overview",chartMode:"burndown",type:"",menuFor:null,sprintId:null,q:"",who:"",
  topScope:"sprint",followActive:true,tv:false,tvSlide:0,tvPaused:false,
  adm:{tab:"members",q:"",who:"",kind:"",show:150},loaded:{},isOwner:false};
const raw={members:{},sprints:{},tasks:{},config:{}};   // untouched documents, for backups
let db=null,downloads=null,assets=null,userCap=null;
const clientId=ss.get("tb.client")||uid("c");ss.set("tb.client",clientId);

const live=a=>a.filter(x=>!x.deleted);
const member=id=>state.members.find(m=>m.id===id);
const sprint=id=>state.sprints.find(s=>s.id===id&&!s.deleted);
const task=id=>state.tasks.find(t=>t.id===id);
const members=()=>live(state.members).sort(byName);
const sortedSprints=()=>live(state.sprints).sort((a,b)=>parseDate(a.start)-parseDate(b.start));
const mName=id=>{const m=member(id);return m?m.name+(m.deleted?" (removed)":""):"Someone"};
const avatar=(id,cls="")=>{const m=member(id);return m?`<span class="avatar ${cls}" title="${esc(m.name)}">${esc(initials(m.name))}</span>`:`<span class="avatar none ${cls}">?</span>`};

/* ================= toast & confirm ================= */
function toast(msg,undo){
  const t=$("#toast");$("#toastMsg").textContent=msg;const b=$("#toastBtn");
  b.hidden=!undo;b.onclick=null;if(undo){b.textContent=undo.label||"Undo";b.onclick=()=>{t.classList.remove("show");undo.fn()}}
  t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),undo?7000:2800);
}
function ask({title,body="",ok="OK",danger=false,typeWord=null}){
  return new Promise(res=>{
    const d=$("#askDlg");$("#askTitle").textContent=title;$("#askBody").textContent=body;
    const okB=$("#askOk");okB.textContent=ok;okB.className="btn "+(danger?"danger":"primary");
    const tw=$("#askTypeWrap"),ti=$("#askType");tw.hidden=!typeWord;ti.value="";
    if(typeWord)$("#askTypeLbl").textContent=`Type ${typeWord} to confirm`;
    let done=false;const fin=v=>{if(done)return;done=true;d.close();res(v)};
    $("#askForm").onsubmit=e=>{e.preventDefault();if(typeWord&&ti.value.trim()!==typeWord){ti.focus();return}fin(true)};
    $("#askCancel").onclick=()=>fin(false);d.onclose=()=>fin(false);
    d.showModal();(typeWord?ti:$("#askCancel")).focus();
  });
}
function errMsg(e){
  const c=e&&e.code;
  if(c==="invalid_argument")return "The board refused this change. Your Claude account may only have view access to this board; ask the board owner to make you a Contributor.";
  if(c==="quota_exceeded")return "The board is full. An admin can empty the Trash or delete old backups to make room.";
  if(c==="resource_exhausted")return "Too many changes at once. Wait a moment and try again.";
  if(c==="revoked"||c==="not_granted")return "This view can no longer save changes. Reload the page.";
  return "Couldn't save the change. It will be retried.";
}

/* ================= write queue: retries, ordering, survives reloads ================= */
const FATAL=["invalid_argument","quota_exceeded","not_granted","revoked","capability_disabled","capability_removed","transform_error"];
const Q={ops:[],busy:false,fails:0,err:null,wait:{}};
function saveQ(){ls.set("tb.queue",Q.ops.length?JSON.stringify(Q.ops.map(({k,path,mode,data,quiet})=>({k,path,mode,data,quiet}))):"")}
try{const p=JSON.parse(ls.get("tb.queue")||"[]");if(Array.isArray(p))Q.ops=p.filter(o=>o&&o.path&&o.mode)}catch(e){}
function enqueue(path,mode,data,opts={}){
  if(!db){localApply(path,mode,data);return Promise.resolve(true)}
  const op={k:uid("q"),path,mode,data,quiet:!!opts.quiet};Q.ops.push(op);saveQ();saveStatus();
  const p=new Promise(r=>Q.wait[op.k]=r);pump();return p;
}
async function execOp(op){
  const ref=db.doc(op.path);
  if(op.mode==="set")return ref.set(op.data);
  if(op.mode==="update")return ref.update(op.data);
  if(op.mode==="delete")return ref.delete();
  if(op.mode==="merge"){try{return await ref.update(op.data)}catch(e){if(!e||e.code!=="invalid_argument")throw e;const s=await ref.get();if(s.exists)throw e;return ref.set(op.data)}}
}
async function pump(){
  if(Q.busy||!db)return;Q.busy=true;
  while(Q.ops.length){
    const op=Q.ops[0];
    try{await execOp(op);Q.ops.shift();saveQ();Q.fails=0;Q.err=null;done(op,true)}
    catch(e){
      const code=e&&e.code;
      if(FATAL.includes(code)){Q.ops.shift();saveQ();done(op,false);if(!op.quiet){Q.err=errMsg(e);toast(Q.err)}continue}
      Q.fails++;saveStatus();await sleep(Math.min(30000,800*2**Q.fails)+Math.random()*500);
    }
    saveStatus();
  }
  Q.busy=false;saveStatus();
}
function done(op,ok){const r=Q.wait[op.k];delete Q.wait[op.k];if(r)r(ok)}
function saveStatus(){
  const el=$("#saveState");if(!el)return;const n=Q.ops.length;let cls="",txt;
  if(!db){cls="warn";txt="Not connected, changes stay on this screen"}
  else if(n&&Q.fails>1){cls="warn";txt=`Offline, ${n} change${n>1?"s":""} waiting. Retrying`}
  else if(n){cls="busy";txt="Saving…"}
  else if(Q.err){cls="err";txt="Last change was not saved"}
  else txt="All changes saved";
  el.className="save "+cls;el.lastElementChild.textContent=txt;el.title=Q.err||"";
}
window.addEventListener("online",()=>{Q.fails=0;pump()});
window.addEventListener("beforeunload",e=>{if(Q.ops.length){e.preventDefault();e.returnValue=""}});
function localApply(path,mode,data){
  const [col,id]=path.split("/");if(!raw[col]||path.split("/").length!==2)return;
  if(mode==="delete")delete raw[col][id];
  else if(mode==="set"||!raw[col][id])raw[col][id]=JSON.parse(JSON.stringify(data));
  else raw[col][id]=deepMerge(raw[col][id],data);
  rebuild(col);render();
}
function deepMerge(a,b){const o={...a};for(const[k,v]of Object.entries(b)){o[k]=v&&typeof v==="object"&&!Array.isArray(v)&&a[k]&&typeof a[k]==="object"&&!Array.isArray(a[k])?deepMerge(a[k],v):v}return o}

/* ================= normalising what comes out of the store ================= */
const num=(v,d=0)=>{v=Number(v);return isFinite(v)?v:d};
const str=(v,max=500)=>typeof v==="string"?v.slice(0,max):"";
const isoOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const CLEAN={
  tasks:(id,o)=>{
    const wl=vals(o.worklogs).map(w=>({...w,hours:Math.max(0,num(w.hours)),date:isoOk(w.date)?w.date:iso(new Date(num(w.at,Date.now()))),by:str(w.by,80),note:str(w.note,300),at:num(w.at)}));
    const timers={};if(o.timers&&typeof o.timers==="object")for(const[k,v]of Object.entries(o.timers))if(v&&num(v.startedAt))timers[k]={startedAt:num(v.startedAt)};
    return {id,title:str(o.title,300)||"Untitled",type:TYPES[o.type]?o.type:"task",status:COLS[o.status]?o.status:"todo",
    points:num(o.points),priority:[1,2,3].includes(o.priority)?o.priority:2,estimateH:num(o.estimateH),
    key:o.key!=null?num(o.key,null):null,erpRef:str(o.erpRef,60),description:str(o.description,20000),blockedReason:str(o.blockedReason,200),
    labels:Array.isArray(o.labels)?o.labels.filter(x=>typeof x==="string").map(x=>x.slice(0,30)).slice(0,8):[],
    assignee:typeof o.assignee==="string"&&o.assignee?o.assignee:null,sprintId:typeof o.sprintId==="string"&&o.sprintId?o.sprintId:null,
    createdAt:num(o.createdAt,null),createdBy:str(o.createdBy,80),startedAt:num(o.startedAt)||null,doneAt:num(o.doneAt)||null,
    blockedAt:num(o.blockedAt)||null,blockedMs:num(o.blockedMs),
    checklist:vals(o.checklist).map(c=>({...c,text:str(c.text,300),done:!!c.done,order:num(c.order)})).sort((a,b)=>a.order-b.order),
    files:vals(o.files).map(f=>({...f,name:str(f.name,200)||"file",size:num(f.size),type:str(f.type,100),at:num(f.at)})).sort((a,b)=>a.at-b.at),
    comments:vals(o.comments).map(c=>({...c,kind:KIND[c.kind]?c.kind:"comment",text:str(c.text,4000),at:num(c.at),resolved:!!c.resolved,by:str(c.by,80)})).sort((a,b)=>a.at-b.at),
    activity:vals(o.activity).map(a=>({...a,text:str(a.text,400),at:num(a.at),by:str(a.by,80)})).sort((a,b)=>a.at-b.at),
    worklogs:wl.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.at-b.at),loggedH:hr(wl.reduce((s,w)=>s+w.hours,0)),timers,
    deleted:!!o.deleted,deletedAt:num(o.deletedAt)||null,deletedBy:str(o.deletedBy,80)}},
  members:(id,o)=>({id,name:str(o.name,80)||"Unnamed",title:str(o.title,60),access:ACCESS[o.access]?o.access:"worker",
    labels:Array.isArray(o.labels)?o.labels.filter(x=>typeof x==="string").map(x=>x.slice(0,30)).slice(0,10):[],
    weeklyH:Math.max(0,Math.min(80,num(o.weeklyH,40))),availability:AVAIL[o.availability]?o.availability:"available",
    timeOff:Array.isArray(o.timeOff)?o.timeOff.filter(x=>x&&isoOk(x.from)&&isoOk(x.to)).map(x=>({from:x.from,to:x.to,note:str(x.note,80)})):[],
    pinHash:typeof o.pinHash==="string"?o.pinHash:null,pinSalt:typeof o.pinSalt==="string"?o.pinSalt:"",pinSetAt:num(o.pinSetAt)||null,
    createdAt:num(o.createdAt),deleted:!!o.deleted,deletedAt:num(o.deletedAt)||null,deletedBy:str(o.deletedBy,80)}),
  sprints:(id,o)=>({id,name:str(o.name,60)||"Sprint",goal:str(o.goal,200),state:["planned","active","closed"].includes(o.state)?o.state:"planned",
    start:isoOk(o.start)?o.start:todayIso(),end:isoOk(o.end)?o.end:todayIso(),
    deleted:!!o.deleted,deletedAt:num(o.deletedAt)||null,deletedBy:str(o.deletedBy,80)})};
function rebuild(col){
  if(col==="config"){
    const b=raw.config.board||{},s=raw.config.settings||{};
    state.order=normOrder(b.order);
    const S={...DEFAULT_SETTINGS};
    if(typeof s.teamName==="string"&&s.teamName.trim())S.teamName=s.teamName.slice(0,60);
    if(typeof s.keyPrefix==="string"&&/^[A-Za-z0-9]{1,6}$/.test(s.keyPrefix))S.keyPrefix=s.keyPrefix.toUpperCase();
    if([1,2,3,5,10,15,30,60].includes(s.lockMinutes))S.lockMinutes=s.lockMinutes;
    if(typeof s.dailyBackup==="boolean")S.dailyBackup=s.dailyBackup;
    if([7,14,30,60,90].includes(s.trashDays))S.trashDays=s.trashDays;
    state.settings=S;return;
  }
  state[col]=Object.entries(raw[col]).map(([id,o])=>{try{return CLEAN[col](id,o||{})}catch(e){console.error(e);return null}}).filter(Boolean);
  if(col==="sprints")pickSprint();
}
function normOrder(o){const ok=Array.isArray(o)?o.filter((k,i)=>COLS[k]&&o.indexOf(k)===i):[];DEFAULT_ORDER.forEach(k=>{if(!ok.includes(k))ok.push(k)});return ok}
function subscribe(col){
  db.collection(col).onSnapshot(s=>{
    const r={};s.docs.forEach(d=>{r[d.id]=d.data()});raw[col]=r;rebuild(col);state.loaded[col]=true;render();maybeDailyBackup();
  },e=>snapErr(e));
}
function snapErr(e){if(e&&e.code==="revoked")setNotice("This board is read-only in this view now. Reload to reconnect.","err");else if(e&&e.code==="unavailable")setNotice("Lost the live connection to the board. Reload the page to reconnect.","err")}
function setNotice(html,cls=""){$("#notice").innerHTML=html?`<div class="notice ${cls}">${html}</div>`:""}

function pickSprint(){
  const s=sortedSprints();const active=s.find(x=>x.state==="active");
  if((state.followActive||state.tv)&&active){state.sprintId=active.id;return}
  if(state.sprintId&&sprint(state.sprintId))return;
  state.sprintId=active?active.id:(s.find(x=>x.state==="planned")||s[s.length-1]||{}).id||null;
}

/* ================= activity log (non-task events), one document per day ================= */
function logEvent(kind,text,by){
  const day=todayIso(),id=uid("e");
  return enqueue("log/"+day,"merge",{day,entries:{[id]:{at:Date.now(),by:by||null,kind,text:String(text).slice(0,400)}}},{quiet:true});
}
