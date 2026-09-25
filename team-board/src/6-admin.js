/* ================= backups =================
   A backup is one metadata document plus the data split into parts
   (documents are capped at 256 KB). Parts are written first, the
   metadata last, so a half-written backup never shows up. */
const PART=60000;
function snapshotData(){
  const pick=col=>Object.fromEntries(Object.entries(raw[col]).map(([k,v])=>[k,v]));
  return {format:"teamboard",version:2,at:Date.now(),members:pick("members"),sprints:pick("sprints"),tasks:pick("tasks"),config:pick("config")};
}
const countsOf=d=>({tasks:Object.values(d.tasks||{}).filter(t=>t&&!t.deleted).length,members:Object.values(d.members||{}).filter(m=>m&&!m.deleted).length,sprints:Object.values(d.sprints||{}).filter(s=>s&&!s.deleted).length});
async function makeBackup(kind,note,by,{quiet=false}={}){
  const data=snapshotData();const json=JSON.stringify(data);const id=`${kind==="daily"?"d":"b"}-${todayIso()}-${Date.now().toString(36)}`;
  const n=Math.max(1,Math.ceil(json.length/PART));
  for(let i=0;i<n;i++){if(!await enqueue(`backups/${id}/parts/${i}`,"set",{i,json:json.slice(i*PART,(i+1)*PART)},{quiet}))return null}
  const ok=await enqueue("backups/"+id,"set",{kind,note:note||"",by:by||null,at:Date.now(),day:todayIso(),parts:n,size:json.length,counts:countsOf(data)},{quiet});
  if(!ok)return null;
  pruneBackups(id);return id;
}
async function deleteBackup(b){
  await enqueue("backups/"+b.id,"delete");
  for(let i=0;i<b.parts;i++)await enqueue(`backups/${b.id}/parts/${i}`,"delete",null,{quiet:true});
}
function pruneBackups(justMade){
  const all=state.backups.filter(b=>b.id!==justMade).sort((a,b)=>b.at-a.at);
  const daily=all.filter(b=>b.kind==="daily"),other=all.filter(b=>b.kind!=="daily");
  [...daily.slice(Math.max(0,state.settings.keepDaily-1)),...other.slice(Math.max(0,state.settings.keepOther-1))].forEach(b=>deleteBackup(b));
}
async function readBackup(b){
  const parts=[];
  for(let i=0;i<b.parts;i++){const s=await db.doc(`backups/${b.id}/parts/${i}`).get();if(!s.exists)throw new Error("A part of this backup is missing.");parts.push(s.data().json)}
  return validBackup(JSON.parse(parts.join("")));
}
function validBackup(d){
  if(!d||d.format!=="teamboard"||typeof d.tasks!=="object"||typeof d.members!=="object"||typeof d.sprints!=="object")throw new Error("This isn't a Team board backup.");
  return d;
}
let dailyChecked=false;
async function maybeDailyBackup(){
  if(dailyChecked||!db||!["tasks","members","sprints","config","backups"].every(c=>state.loaded[c]))return;
  dailyChecked=true;
  if(!state.settings.dailyBackup||!Object.keys(raw.tasks).length&&!Object.keys(raw.members).length)return;
  if(state.backups.some(b=>b.kind==="daily"&&b.day===todayIso()))return;
  try{
    const r=await db.doc("config/backup-lease").acquire({holder:clientId,ttlMs:120000});if(!r.acquired)return;
    const again=await db.collection("backups").where("day","==",todayIso()).get();
    if(again.docs.some(d=>d.data().kind==="daily"))return;
    await makeBackup("daily","Automatic daily backup",null,{quiet:true});
  }catch(e){/* view-only viewers can't write; someone else will */}
}
async function restoreData(d,label,m){
  toast("Restoring…");
  await makeBackup("safety",`Before restoring ${label}`,m.id);
  for(const col of ["members","sprints","tasks"]){
    const keep=d[col]||{};
    for(const [id,doc] of Object.entries(keep))if(doc&&typeof doc==="object")await enqueue(`${col}/${id}`,"set",doc);
    for(const id of Object.keys(raw[col]))if(!keep[id])await enqueue(`${col}/${id}`,"delete");
  }
  for(const [id,doc] of Object.entries(d.config||{}))if(["board","settings"].includes(id)&&doc)await enqueue("config/"+id,"set",doc);
  logEvent("backup",`restored ${label}`,m.id);
  toast(`Restored ${label}. A backup of what was there before was saved first.`);
}

/* ================= admin: data retention ================= */
async function purgeTrash(m,silent){
  const cut=Date.now()-state.settings.trashDays*DAY;let n=0;
  for(const col of ["tasks","members","sprints"])for(const x of state[col])if(x.deleted&&x.deletedAt&&x.deletedAt<cut){await enqueue(`${col}/${x.id}`,"delete",null,{quiet:true});n++}
  const oldLogs=state.logs.filter(l=>l.day<iso(new Date(Date.now()-365*DAY)));for(const l of oldLogs)await enqueue("log/"+l.day,"delete",null,{quiet:true});
  if(n&&!silent)logEvent("backup",`emptied ${n} item${n>1?"s":""} older than ${state.settings.trashDays} days from the Trash`,m&&m.id);
}

/* ================= admin view ================= */
function viewAdmin(){
  const m=me();if(!m||m.access!=="admin"){state.view="overview";return viewOverview()}
  const tabs=[["members","Members"],["activity","Activity log"],["backups","Backups"],["trash","Trash"],["settings","Settings"]];
  const trashN=["tasks","members","sprints"].reduce((a,c)=>a+state[c].filter(x=>x.deleted).length,0);
  const body={members:admMembers,activity:admActivity,backups:admBackups,trash:admTrash,settings:admSettings}[state.adm.tab]();
  return `<div class="adm-nav"><div class="seg" role="group" aria-label="Admin sections">${tabs.map(([k,l])=>`<button data-adm="${k}" aria-pressed="${state.adm.tab===k}">${l}${k==="trash"&&trashN?` (${trashN})`:""}</button>`).join("")}</div>
    <span class="goal">Signed in as ${esc(m.name)} (admin)</span></div>${body}`;
}
function admMembers(){
  const q=state.adm.q.toLowerCase();const list=members().filter(x=>!q||(x.name+" "+x.title+" "+x.labels.join(" ")).toLowerCase().includes(q));
  const s=sprint(state.sprintId);
  const rows=list.map(x=>{const [al,ac]=AVAIL[x.availability];const off=offToday(x);
    const upcoming=x.timeOff.filter(o=>o.to>=todayIso()).sort((a,b)=>a.from<b.from?-1:1);
    return `<tr class="mrow"><td><div class="mname">${avatar(x.id)}<div><b>${esc(x.name)}</b><small>${esc(x.title||"No job title")}</small></div></div></td>
    <td><span class="chip ${x.access==="admin"?"warn":x.access==="viewer"?"":"info"}">${ACCESS[x.access]}</span></td>
    <td><div class="tags">${x.labels.map(lblHtml).join("")||'<span class="muted">–</span>'}</div></td>
    <td class="num">${x.weeklyH} h${s?`<br><small>${fmtH(capacity(x,s))} this sprint</small>`:""}</td>
    <td><span class="chip ${off?"bad":ac}">${off?"Off today":al}</span></td>
    <td>${upcoming.length?upcoming.slice(0,3).map(o=>`<small style="display:block">${fmtDate(o.from)}${o.to!==o.from?" – "+fmtDate(o.to):""}${o.note?" · "+esc(o.note):""}</small>`).join(""):'<span class="muted">–</span>'}</td>
    <td>${x.pinHash?`<span class="chip ok">Set</span><br><small>${x.pinSetAt?fmtDay(x.pinSetAt):""}</small>`:'<span class="chip warn">Not set yet</span>'}</td>
    <td class="num" style="white-space:nowrap"><button class="btn small" data-medit="${esc(x.id)}">Edit</button>${x.pinHash?` <button class="btn small ghost" data-mpin="${esc(x.id)}">Reset PIN</button>`:""}</td></tr>`}).join("");
  const counts={admin:0,worker:0,viewer:0};members().forEach(x=>counts[x.access]++);
  return `<div class="panel"><div class="panel-h"><h2>Members · ${members().length}</h2>
      <input type="search" id="admQ" placeholder="Search name, title or label" value="${esc(state.adm.q)}" aria-label="Search members" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:6px 10px">
      <button class="btn primary small" data-madd>Add member</button></div>
    <p class="adm-note">${counts.admin} admin${counts.admin===1?"":"s"}, ${counts.worker} worker${counts.worker===1?"":"s"}, ${counts.viewer} viewer${counts.viewer===1?"":"s"}. Workers change tasks and log time. Viewers can only look. Admins also see this tab. Each person creates their own PIN the first time they change something.</p>
    ${rows?`<div class="tbl-scroll"><table><thead><tr><th>Member</th><th>Role</th><th>Labels</th><th class="num">Weekly hours</th><th>Availability</th><th>Time off</th><th>PIN</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty">No one matches.</div>'}</div>`;
}
const LOG_KINDS={task:"Tasks",people:"People",sprint:"Sprints",security:"Sign-in and PINs",backup:"Backups and trash",settings:"Settings"};
function allActivity(){
  const out=[];
  state.tasks.forEach(t=>t.activity.forEach(a=>out.push({at:a.at,by:a.by,kind:"task",text:a.text,task:t})));
  state.logs.forEach(l=>Object.values(l.entries||{}).forEach(e=>{if(e&&e.at)out.push({at:num(e.at),by:typeof e.by==="string"?e.by:null,kind:LOG_KINDS[e.kind]?e.kind:"settings",text:str(e.text,400)})}));
  return out.sort((a,b)=>b.at-a.at);
}
function admActivity(){
  const A=state.adm;const q=A.q.toLowerCase();
  const list=allActivity().filter(e=>(!A.who||e.by===A.who)&&(!A.kind||e.kind===A.kind)&&(!q||(e.text+" "+(e.task?shortId(e.task)+" "+e.task.title:"")).toLowerCase().includes(q)));
  return `<div class="panel"><div class="panel-h"><h2>Activity log</h2>
    <input type="search" id="admQ" placeholder="Search" value="${esc(A.q)}" aria-label="Search activity" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:6px 10px">
    <select id="admWho" aria-label="Person" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:6px 8px"><option value="">Everyone</option>${state.members.slice().sort(byName).map(x=>`<option value="${esc(x.id)}"${A.who===x.id?" selected":""}>${esc(x.name)}${x.deleted?" (removed)":""}</option>`).join("")}</select>
    <select id="admKind" aria-label="Kind" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:6px 8px"><option value="">All kinds</option>${Object.entries(LOG_KINDS).map(([k,l])=>`<option value="${k}"${A.kind===k?" selected":""}>${l}</option>`).join("")}</select></div>
    <p class="adm-note">Who changed what, newest first. Task changes are kept with each task. Other events are kept for a year.</p>
    <div>${list.slice(0,A.show).map(e=>`<div class="log-row"><time title="${esc(fmtStamp(e.at))}">${fmtStamp(e.at)}</time>${e.by?avatar(e.by):'<span class="avatar none">·</span>'}
      <div><b>${e.by?esc(mName(e.by)):"System"}</b> ${esc(e.text)}${e.task?` <button class="linkish" style="color:var(--accent)" data-open="${esc(e.task.id)}">${esc(shortId(e.task))} ${esc(e.task.title)}</button>${e.task.deleted?' <span class="chip">in Trash</span>':""}`:""}</div></div>`).join("")||'<div class="empty">Nothing matches.</div>'}</div>
    ${list.length>A.show?`<div class="actions"><button class="btn small" data-admmore>Show more (${list.length-A.show} older)</button></div>`:""}</div>`;
}
function admBackups(){
  const bs=state.backups.slice().sort((a,b)=>b.at-a.at);const KL={daily:"Daily",manual:"Manual",safety:"Safety copy",import:"Imported"};
  const docs=Object.keys(raw.tasks).length+Object.keys(raw.members).length+Object.keys(raw.sprints).length+state.logs.length+state.backups.reduce((a,b)=>a+1+b.parts,0)+3;
  return `<div class="panel"><div class="panel-h"><h2>Backups</h2><button class="btn primary small" data-bnow>Back up now</button>
      ${downloads?`<button class="btn small" data-bexport>Download all data (JSON)</button>`:""}<button class="btn small" data-bimport>Restore from a file</button></div>
    <p class="adm-note">${state.settings.dailyBackup?"A backup is made automatically once a day, the first time someone opens the board. ":"Daily backups are off (Settings). "}The last ${state.settings.keepDaily} daily and ${state.settings.keepOther} other backups are kept. Restoring first saves a safety copy of the current board, so a restore can be undone. For a copy outside this board, download the data now and then.</p>
    ${bs.length?`<div class="tbl-scroll"><table><thead><tr><th>When</th><th>Kind</th><th>Contents</th><th class="num">Size</th><th></th></tr></thead><tbody>${bs.map(b=>`<tr>
      <td><b>${fmtStamp(b.at)}</b><br><small>${timeAgo(b.at)}${b.by?" · "+esc(mName(b.by)):""}</small></td><td><span class="chip ${b.kind==="daily"?"ok":b.kind==="safety"?"warn":"info"}">${KL[b.kind]||b.kind}</span>${b.note&&b.kind!=="daily"?`<br><small>${esc(b.note)}</small>`:""}</td>
      <td><small>${b.counts.tasks} tasks, ${b.counts.members} people, ${b.counts.sprints} sprints</small></td><td class="num">${fmtBytes(b.size)}</td>
      <td class="num" style="white-space:nowrap"><button class="btn small" data-brestore="${esc(b.id)}">Restore</button>${downloads?` <button class="btn small ghost" data-bdl="${esc(b.id)}">Download</button>`:""} <button class="xbtn" data-bdel="${esc(b.id)}" aria-label="Delete backup">×</button></td></tr>`).join("")}</tbody></table></div>`
      :'<div class="empty">No backups yet. Use Back up now to make the first one.</div>'}
    <p class="goal" style="margin:12px 0 0">Storage: about ${docs} of 5,000 records used.</p></div>`;
}
function admTrash(){
  const items=[];
  state.tasks.filter(t=>t.deleted).forEach(t=>items.push({col:"tasks",id:t.id,name:`${shortId(t)} ${t.title}`,what:"Task",at:t.deletedAt,by:t.deletedBy}));
  state.members.filter(x=>x.deleted).forEach(x=>items.push({col:"members",id:x.id,name:x.name,what:"Member",at:x.deletedAt,by:x.deletedBy}));
  state.sprints.filter(x=>x.deleted).forEach(x=>items.push({col:"sprints",id:x.id,name:x.name,what:"Sprint",at:x.deletedAt,by:x.deletedBy}));
  items.sort((a,b)=>(b.at||0)-(a.at||0));
  return `<div class="panel"><div class="panel-h"><h2>Trash · ${items.length}</h2>${items.length?`<button class="btn small danger" data-tempty>Empty trash</button>`:""}</div>
    <p class="adm-note">Deleted tasks, members and sprints stay here for ${state.settings.trashDays} days, then they are removed for good. Restore puts them back exactly as they were.</p>
    ${items.length?`<div class="tbl-scroll"><table><thead><tr><th>Item</th><th>Deleted</th><th>Removed for good</th><th></th></tr></thead><tbody>${items.map(x=>`<tr>
      <td><span class="chip">${x.what}</span> ${esc(x.name)}</td><td><small>${x.at?fmtStamp(x.at):""}${x.by?" by "+esc(mName(x.by)):""}</small></td>
      <td><small>${x.at?fmtDay(x.at+state.settings.trashDays*DAY):""}</small></td>
      <td class="num" style="white-space:nowrap"><button class="btn small" data-trestore="${x.col}/${esc(x.id)}">Restore</button> <button class="btn small ghost" data-tkill="${x.col}/${esc(x.id)}">Delete for good</button></td></tr>`).join("")}</tbody></table></div>`
    :'<div class="empty">The trash is empty.</div>'}</div>`;
}
function admSettings(){
  const S=state.settings;
  return `<div class="two"><div class="panel"><h2>Settings</h2><form id="setForm" class="grid">
    <label class="full">Board name<input id="setName" maxlength="60" value="${esc(S.teamName)}"></label>
    <label>Task number prefix<input id="setPrefix" maxlength="6" pattern="[A-Za-z0-9]{1,6}" value="${esc(S.keyPrefix)}"></label>
    <label>Lock after inactivity<select id="setLock">${[1,2,3,5,10,15,30,60].map(n=>`<option value="${n}"${S.lockMinutes===n?" selected":""}>${n} minute${n>1?"s":""}</option>`).join("")}</select></label>
    <label>Keep deleted items<select id="setTrash">${[7,14,30,60,90].map(n=>`<option value="${n}"${S.trashDays===n?" selected":""}>${n} days</option>`).join("")}</select></label>
    <label class="check" style="align-self:end"><input type="checkbox" id="setDaily"${S.dailyBackup?" checked":""}> Automatic daily backup</label>
    <div class="full actions" style="margin-top:4px"><button class="btn primary">Save settings</button></div></form>
    <p class="adm-note" style="margin-top:12px">A short lock time suits a shared TV or tablet. Task numbers look like #${esc(S.keyPrefix)}-12.</p></div>
    <div class="panel"><h2>Danger zone</h2><div class="danger-zone"><h3>Delete all board data</h3>
      <p style="margin:0;color:var(--muted);font-size:14px">Removes every task, sprint, member, PIN and log entry. Backups are kept, and a safety backup is made first, so you can restore from the Backups tab after setting up a new admin.</p>
      <div><button class="btn danger" data-wipe>Delete all data</button></div></div></div></div>`;
}

/* ---- member editor ---- */
let md=null;
function openMember(id){
  const x=id?member(id):null;
  md={id:x?x.id:null,timeOff:x?x.timeOff.map(o=>({...o})):[]};
  const f=$("#memForm");
  f.innerHTML=`<h2>${x?"Edit "+esc(x.name):"Add member"}</h2><div class="grid">
    <label class="full">Full name<input id="mfName" required maxlength="80" value="${esc(x?x.name:"")}" autocomplete="off"></label>
    <label>Job title<input id="mfTitle" maxlength="60" value="${esc(x?x.title:"")}" placeholder="e.g. Backend dev"></label>
    <label>Role<select id="mfAccess">${Object.entries(ACCESS).map(([k,l])=>`<option value="${k}"${(x?x.access:"worker")===k?" selected":""}>${l}</option>`).join("")}</select></label>
    <label>Weekly hours<input id="mfHours" type="number" min="0" max="80" step="1" value="${x?x.weeklyH:40}"></label>
    <label>Availability<select id="mfAvail">${Object.entries(AVAIL).map(([k,[l]])=>`<option value="${k}"${(x?x.availability:"available")===k?" selected":""}>${l}</option>`).join("")}</select></label>
    <label class="full">Labels (skills, team), separated by commas<input id="mfLabels" maxlength="200" value="${esc(x?x.labels.join(", "):"")}" placeholder="e.g. Backend, ERP, Night shift"></label>
    <div class="full"><div style="font-size:13px;color:var(--muted);margin-bottom:6px">Time off</div><div class="to-list" id="mfTo"></div>
      <div class="to-row" style="margin-top:8px"><input type="date" id="toFrom" aria-label="From"><span>to</span><input type="date" id="toTo" aria-label="To"><input id="toNote" placeholder="Note, e.g. Holiday" maxlength="80" style="flex:1;min-width:120px"><button type="button" class="btn small" data-toadd>Add</button></div></div>
  </div>
  <div class="actions"><button class="btn primary">${x?"Save changes":"Add member"}</button><button type="button" class="btn" data-mclose>Cancel</button><span class="spacer"></span>${x?`<button type="button" class="btn danger small" data-mremove>Remove member</button>`:""}</div>`;
  renderTimeOff();$("#memDlg").showModal();$("#mfName").focus();
}
function renderTimeOff(){
  const box=$("#mfTo");if(!box||!md)return;
  box.innerHTML=md.timeOff.sort((a,b)=>a.from<b.from?-1:1).map((o,i)=>`<div class="to-row"><span class="chip">${fmtDate(o.from)}${o.to!==o.from?" – "+fmtDate(o.to):""}</span><span>${esc(o.note)}</span><button type="button" class="xbtn" data-todel="${i}" aria-label="Remove">×</button></div>`).join("")||'<span class="muted" style="font-size:13px">None planned.</span>';
}
$("#memForm").addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.mclose!=null){$("#memDlg").close();return}
  if(b.dataset.toadd!=null){const f=$("#toFrom").value,t=$("#toTo").value||f,n=$("#toNote").value.trim();
    if(!isoOk(f)){toast("Pick the first day off.");return}if(t<f){toast("The last day can't be before the first.");return}
    md.timeOff.push({from:f,to:t,note:n});["toFrom","toTo","toNote"].forEach(i=>$("#"+i).value="");renderTimeOff();return}
  if(b.dataset.todel!=null){md.timeOff.splice(+b.dataset.todel,1);renderTimeOff();return}
  if(b.dataset.mremove!=null){const x=member(md.id);if(!x)return;
    await act(async m=>{
      if(x.access==="admin"&&members().filter(y=>y.access==="admin").length<2){toast("Add another admin before removing the last one.");return}
      if(x.id===m.id){toast("You can't remove yourself. Ask another admin.");return}
      $("#memDlg").close();
      if(!await ask({title:`Remove ${x.name}?`,body:"They move to the Trash and can no longer sign in. Their tasks keep their name. You can restore them from the Trash.",ok:"Remove member",danger:true}))return;
      await enqueue("members/"+x.id,"update",{deleted:true,deletedAt:Date.now(),deletedBy:m.id});logEvent("people",`removed ${x.name}`,m.id);toast(`${x.name} removed`);
    },{admin:true});
  }
});
$("#memForm").addEventListener("submit",async e=>{
  e.preventDefault();const name=$("#mfName").value.trim();if(!name)return;
  const data={name,title:$("#mfTitle").value.trim(),access:$("#mfAccess").value,weeklyH:Math.max(0,Math.min(80,+$("#mfHours").value||0)),availability:$("#mfAvail").value,
    labels:$("#mfLabels").value.split(",").map(x=>x.trim().slice(0,30)).filter(Boolean).slice(0,10),timeOff:md.timeOff};
  await act(async m=>{
    const x=md.id&&member(md.id);
    if(x&&x.access==="admin"&&data.access!=="admin"&&members().filter(y=>y.access==="admin").length<2){toast("Keep at least one admin. Make someone else an admin first.");return}
    if(x){
      const ch=[];if(x.name!==data.name)ch.push(`renamed ${x.name} to ${data.name}`);if(x.access!==data.access)ch.push(`changed ${data.name}'s role to ${ACCESS[data.access]}`);
      if(x.weeklyH!==data.weeklyH)ch.push(`set ${data.name}'s weekly hours to ${data.weeklyH}`);if(x.availability!==data.availability)ch.push(`marked ${data.name} as ${AVAIL[data.availability][0].toLowerCase()}`);
      if(JSON.stringify(x.timeOff)!==JSON.stringify(data.timeOff))ch.push(`updated ${data.name}'s time off`);if(x.title!==data.title||x.labels.join()!==data.labels.join())ch.push(`updated ${data.name}'s details`);
      if(!await enqueue("members/"+x.id,"update",data))return;ch.forEach(c=>logEvent(c.includes("role")?"security":"people",c,m.id));toast("Member saved");
    }else{
      const id=uid("m");if(!await enqueue("members/"+id,"set",{...data,pinHash:null,pinSalt:"",createdAt:Date.now()}))return;
      logEvent("people",`added ${data.name} as ${ACCESS[data.access]}`,m.id);toast(`${data.name} added. They create their PIN the first time they change something.`);
    }
    $("#memDlg").close();
  },{admin:true});
});

/* ---- admin clicks ---- */
async function adminClick(d){
  if(d.adm){state.adm.tab=d.adm;state.adm.q="";state.adm.show=150;render();
    if(d.adm==="trash"||d.adm==="activity")act(m=>purgeTrash(m),{admin:true});return true}
  if(d.madd!=null){act(()=>openMember(null),{admin:true});return true}
  if(d.medit){act(()=>openMember(d.medit),{admin:true});return true}
  if(d.mpin){const x=member(d.mpin);if(x)act(async m=>{if(!await ask({title:`Reset ${x.name}'s PIN?`,body:"They create a new PIN the next time they change something.",ok:"Reset PIN"}))return;
    await enqueue("members/"+x.id,"update",{pinHash:null,pinSalt:"",pinSetAt:null});logEvent("security",`reset ${x.name}'s PIN`,m.id);if(x.id===m.id)lockNow(true);toast("PIN reset")},{admin:true});return true}
  if(d.admmore!=null){state.adm.show+=300;render();return true}
  if(d.bnow!=null){act(async m=>{toast("Making a backup…");const id=await makeBackup("manual","Made by hand",m.id);if(id){logEvent("backup","made a backup",m.id);toast("Backup saved")}},{admin:true});return true}
  if(d.bexport!=null){act(async m=>{const json=JSON.stringify(snapshotData(),null,1);
    try{await downloads.save({filename:`team-board-${todayIso()}.json`,data:new Blob([json],{type:"application/json"})});logEvent("backup","downloaded all data",m.id)}catch(e){toast("The download was not saved.")}},{admin:true});return true}
  if(d.bimport!=null){act(()=>$("#importFile").click(),{admin:true});return true}
  if(d.bdl){const b=state.backups.find(x=>x.id===d.bdl);if(b)act(async()=>{try{const data=await readBackup(b);await downloads.save({filename:`team-board-backup-${b.day||todayIso()}.json`,data:new Blob([JSON.stringify(data,null,1)],{type:"application/json"})})}catch(e){toast(e.message||"Couldn't read the backup.")}},{admin:true});return true}
  if(d.bdel){const b=state.backups.find(x=>x.id===d.bdel);if(b)act(async m=>{if(!await ask({title:"Delete this backup?",body:`From ${fmtStamp(b.at)}. This can't be undone.`,ok:"Delete backup",danger:true}))return;await deleteBackup(b);logEvent("backup",`deleted the backup from ${fmtStamp(b.at)}`,m.id)},{admin:true});return true}
  if(d.brestore){const b=state.backups.find(x=>x.id===d.brestore);if(b)act(async m=>{
    if(!await ask({title:`Restore the backup from ${fmtStamp(b.at)}?`,body:`The board goes back to how it was then: ${b.counts.tasks} tasks, ${b.counts.members} people, ${b.counts.sprints} sprints. Changes made since are replaced. A safety backup of the current board is made first.`,ok:"Restore",danger:true}))return;
    try{const data=await readBackup(b);await restoreData(data,`the backup from ${fmtStamp(b.at)}`,m)}catch(e){toast(e.message||"Couldn't read the backup.")}},{admin:true});return true}
  if(d.trestore){const [col,id]=d.trestore.split("/");act(async m=>{await enqueue(`${col}/${id}`,"update",{deleted:false,deletedAt:null,deletedBy:null});
    const x=state[col].find(y=>y.id===id);if(col==="tasks")taskUpdate(id,{},"restored this task from the Trash",m.id);else logEvent(col==="members"?"people":"sprint",`restored ${x?x.name:"an item"} from the Trash`,m.id);toast("Restored")},{admin:true});return true}
  if(d.tkill){const [col,id]=d.tkill.split("/");act(async m=>{const x=state[col].find(y=>y.id===id);const nm=x?(x.title||x.name):"item";
    if(!await ask({title:`Delete "${nm}" for good?`,body:"It can only come back by restoring a backup.",ok:"Delete for good",danger:true}))return;
    await enqueue(`${col}/${id}`,"delete");logEvent("backup",`deleted "${nm}" for good`,m.id)},{admin:true});return true}
  if(d.tempty!=null){act(async m=>{const n=["tasks","members","sprints"].reduce((a,c)=>a+state[c].filter(x=>x.deleted).length,0);
    if(!await ask({title:`Empty the trash (${n} item${n>1?"s":""})?`,body:"They can only come back by restoring a backup.",ok:"Empty trash",danger:true}))return;
    for(const c of ["tasks","members","sprints"])for(const x of state[c].filter(y=>y.deleted))await enqueue(`${c}/${x.id}`,"delete");logEvent("backup",`emptied the trash (${n} items)`,m.id);toast("Trash emptied")},{admin:true});return true}
  if(d.wipe!=null){act(async m=>{
    if(!await ask({title:"Delete all board data?",body:"Every task, sprint, member, PIN and log entry is removed. Backups are kept and a safety backup is made first.",ok:"Delete everything",danger:true,typeWord:"DELETE"}))return;
    toast("Making a safety backup…");const bid=await makeBackup("safety","Before deleting all data",m.id);if(!bid){toast("The safety backup failed, so nothing was deleted.");return}
    for(const col of ["tasks","sprints","members"])for(const id of Object.keys(raw[col]))await enqueue(`${col}/${id}`,"delete");
    for(const l of state.logs)await enqueue("log/"+l.day,"delete");
    await enqueue("config/board","delete");await enqueue("config/settings","delete");
    lockNow(true);state.view="overview";render();toast("All data deleted. Sign in to set up a new admin.");
  },{admin:true});return true}
  return false;
}
$("#importFile").addEventListener("change",async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;
  await act(async m=>{
    let data;try{data=validBackup(JSON.parse(await f.text()))}catch(x){toast(x.message&&x.message.includes("backup")?x.message:"That file isn't a readable Team board backup.");return}
    const c=countsOf(data);
    if(!await ask({title:`Restore from ${f.name}?`,body:`It holds ${c.tasks} tasks, ${c.members} people and ${c.sprints} sprints, saved ${data.at?fmtStamp(data.at):"at an unknown time"}. It replaces the current board. A safety backup is made first.`,ok:"Restore",danger:true}))return;
    await restoreData(data,`the file ${f.name}`,m);
  },{admin:true});
});
function saveSettings(){
  return act(async m=>{
    const p=$("#setPrefix").value.trim().toUpperCase();if(!/^[A-Z0-9]{1,6}$/.test(p)){toast("The prefix can be 1 to 6 letters or digits.");return}
    const data={teamName:$("#setName").value.trim()||"Team board",keyPrefix:p,lockMinutes:+$("#setLock").value,trashDays:+$("#setTrash").value,dailyBackup:$("#setDaily").checked};
    if(await enqueue("config/settings","set",data)){logEvent("settings","changed the settings",m.id);toast("Settings saved")}
  },{admin:true});
}
