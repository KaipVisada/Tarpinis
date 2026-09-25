/* ================= task operations ================= */
const keyOf=t=>t.key||(/^t-(\d+)$/.test(t.id)?parseInt(t.id.slice(2),10):null);
const nextKey=()=>state.tasks.reduce((a,t)=>Math.max(a,keyOf(t)||0),0)+1;
const shortId=t=>{const k=keyOf(t);return k?`#${state.settings.keyPrefix}-${k}`:""};
const sprintName=id=>id?(sprint(id)?.name||"a removed sprint"):"the backlog";

/* one update to a task, with an activity line in its feed */
function taskUpdate(id,patch,text,by){
  const data={...patch};
  if(text){const eid=uid("a");data.activity={[eid]:{at:Date.now(),by:by||null,text:String(text).slice(0,400)}}}
  return enqueue("tasks/"+id,"update",data);
}
function statusPatch(t,status){
  const patch={status};const now=Date.now();
  if((status==="doing"||status==="review")&&!t.startedAt)patch.startedAt=now;
  if(status==="done"){patch.doneAt=now;if(!t.startedAt)patch.startedAt=now}
  else if(t.doneAt)patch.doneAt=null;
  if(status==="blocked"){patch.blockedAt=now;if(!t.startedAt)patch.startedAt=now}
  else if(t.status==="blocked"){patch.blockedAt=null;if(t.blockedAt)patch.blockedMs=(t.blockedMs||0)+(now-t.blockedAt)}
  return patch;
}
function moveTask(id,status){
  return act(m=>{const t=task(id);if(!t||t.status===status)return;
    return taskUpdate(id,statusPatch(t,status),`moved this from ${COLS[t.status]} to ${COLS[status]}`,m.id)});
}
const FIELD_LABEL={title:"the title",type:"the type",priority:"the priority",points:"the story points",estimateH:"the estimate",erpRef:"the ERP reference",labels:"the labels",blockedReason:"the blocked reason",description:"the description"};
function fieldText(f,v,t){
  if(f==="sprintId")return `moved this to ${sprintName(v)}`;
  if(f==="title")return `renamed this to "${v}"`;
  if(f==="description")return "updated the description";
  if(f==="type")return `changed the type to ${TYPES[v]}`;
  if(f==="priority")return `changed the priority to ${PRIO[v]}`;
  if(f==="points")return `changed the story points from ${t.points} to ${v}`;
  if(f==="estimateH")return `changed the estimate from ${fmtH(t.estimateH)} to ${fmtH(v)}`;
  if(f==="erpRef")return v?`linked this to ERP ${v}`:"removed the ERP reference";
  if(f==="labels")return v.length?`set the labels to ${v.join(", ")}`:"removed the labels";
  if(f==="blockedReason")return v?`set the blocked reason: ${v}`:"cleared the blocked reason";
  return `changed ${FIELD_LABEL[f]||f}`;
}
async function setField(id,f,v){
  const t=task(id);if(!t)return;
  if(f==="status"){const ok=await moveTask(id,v);if(!ok)renderTW();return}
  const cur=f==="labels"?t.labels.join("|"):String(t[f]??"");const nv=f==="labels"?v.join("|"):String(v??"");
  if(cur===nv)return;
  const ok=await act(m=>taskUpdate(id,{[f]:v},fieldText(f,v,t),m.id));
  if(!ok)renderTW();
}
/* several people can share a task; stored as a map so two people adding at once don't overwrite each other */
function addAssignee(id,pid){
  return act(m=>{const t=task(id);if(!t||!pid||t.assignees.includes(pid))return;
    return taskUpdate(id,{assignees:{[pid]:{at:Date.now()}}},pid===m.id?"joined this task":`added ${mName(pid)} to this task`,m.id)});
}
function removeAssignee(id,pid){
  return act(m=>{const t=task(id);if(!t||!t.assignees.includes(pid))return;
    const patch={assignees:{[pid]:null}};if(t.legacyAssignee===pid)patch.assignee=null;
    return taskUpdate(id,patch,pid===m.id?"left this task":`removed ${mName(pid)} from this task`,m.id)});
}
async function trashTask(id){
  const t=task(id);if(!t)return;
  const ok=await act(async m=>{
    if(!await ask({title:`Delete ${shortId(t)} ${t.title}?`,body:"It moves to the Trash. An admin can restore it from there.",ok:"Delete task",danger:true}))return false;
    return taskUpdate(id,{deleted:true,deletedAt:Date.now(),deletedBy:m.id},"deleted this task",m.id);
  });
  if(ok){closeTW();toast("Task moved to Trash",{fn:()=>act(m=>taskUpdate(id,{deleted:false,deletedAt:null,deletedBy:null},"restored this task",m.id))})}
}

/* ================= new task dialog ================= */
function openNew(defaults={}){
  const f=$("#newForm");f.reset();
  const who0=me();
  $("#nfPeople").innerHTML=members().filter(m=>m.access!=="viewer").map(m=>`<label class="pchk"><input type="checkbox" value="${esc(m.id)}"${who0&&who0.id===m.id?" checked":""}>${avatar(m.id)}<span>${esc(m.name)}</span></label>`).join("")||'<span class="muted">No team members yet.</span>';
  $("#nfSprint").innerHTML='<option value="">Backlog</option>'+sortedSprints().filter(s=>s.state!=="closed").map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  $("#nfStatus").innerHTML=state.order.map(k=>`<option value="${k}">${COLS[k]}</option>`).join("");
  $("#nfSprint").value=defaults.sprintId&&sprint(defaults.sprintId)&&sprint(defaults.sprintId).state!=="closed"?defaults.sprintId:"";
  $("#nfStatus").value=defaults.status||"todo";
  $("#newDlg").showModal();$("#nfTitle").focus();
}
$("#newForm").addEventListener("submit",async e=>{
  e.preventDefault();const title=$("#nfTitle").value.trim();if(!title)return;
  const id=uid("t");
  const ok=await act(async m=>{
    const now=Date.now();const st=$("#nfStatus").value;
    const data={title,type:$("#nfType").value,priority:+$("#nfPriority").value,points:+$("#nfPoints").value,estimateH:Math.max(0,+$("#nfEst").value||0),
      assignees:Object.fromEntries([...document.querySelectorAll("#nfPeople input:checked")].map((c,i)=>[c.value,{at:now+i}])),sprintId:$("#nfSprint").value||null,status:st,erpRef:$("#nfErp").value.trim(),
      key:nextKey(),createdAt:now,createdBy:m.id,startedAt:st!=="todo"?now:null,doneAt:st==="done"?now:null,blockedAt:st==="blocked"?now:null,
      description:"",labels:[],checklist:{},files:{},comments:{},worklogs:{},timers:{},activity:{[uid("a")]:{at:now,by:m.id,text:"created this task"}}};
    $("#newDlg").close();
    return enqueue("tasks/"+id,"set",data);
  });
  if(ok){toast("Task created");openTW(id)}
});
document.querySelectorAll("dialog [data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));

/* ================= task window ================= */
const tw={id:null,feed:"all",side:"details",cmtKind:"comment",cmtDraft:""};
function openTW(id,side){tw.id=id;tw.seen=false;tw.side=side||"details";tw.cmtDraft="";renderTW();const d=$("#twDlg");if(!d.open)d.showModal()}
function closeTW(){const d=$("#twDlg");if(d.open)d.close()}
$("#twDlg").addEventListener("close",()=>{tw.id=null;$("#twBody").innerHTML=""});
function keepFocus(root,fn){
  const a=document.activeElement;let k=null;
  if(a&&a.id&&root.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)){k={id:a.id,v:a.value,s:null,e:null};try{k.s=a.selectionStart;k.e=a.selectionEnd}catch(x){}}
  const sc=[...root.querySelectorAll("[data-keepscroll]")].map(el=>[el.dataset.keepscroll,el.scrollTop]);
  fn();
  sc.forEach(([n,y])=>{const el=root.querySelector(`[data-keepscroll="${n}"]`);if(el)el.scrollTop=y});
  if(k){const el=document.getElementById(k.id);if(el){if(el.tagName!=="SELECT")el.value=k.v;el.focus({preventScroll:true});try{if(k.s!=null)el.setSelectionRange(k.s,k.e)}catch(x){}}}
}
function fileKind(f){const n=f.name.toLowerCase();if(/^image\//.test(f.type))return"img";if(/pdf/.test(f.type)||n.endsWith(".pdf"))return"PDF";const x=n.split(".").pop();return x&&x.length<6?x.toUpperCase():"FILE"}
const blobCache={};
function fileSrc(f){return f.assetId?"/_blob/"+f.assetId:(blobCache[f.blobId]||null)}
async function loadBlob(f){
  if(!f.blobId||blobCache[f.blobId]||!db)return;
  try{const s=await db.doc("blobs/"+f.blobId).get();if(s.exists&&typeof s.data().data==="string"){blobCache[f.blobId]=s.data().data;if(tw.id)renderTW()}}catch(e){}
}
function renderTW(){
  const d=$("#twDlg");if(!d.open&&!tw.id)return;
  const t=task(tw.id);
  if(!t&&!tw.seen){$("#twBody").innerHTML='<div class="empty dpad">Loading the task…</div>';return}
  if(!t||t.deleted){if(d.open)closeTW();if(tw.seen)toast(t?"This task was deleted.":"This task no longer exists.");return}
  tw.seen=true;
  const m=me();const canEdit=!!m&&m.access!=="viewer";
  keepFocus(d,()=>{$("#twBody").innerHTML=twMain(t,m)+twSide(t,m,canEdit)});
  t.files.forEach(f=>{if(f.blobId&&/^image\//.test(f.type))loadBlob(f)});
}
function twMain(t,m){
  const cl=t.checklist,cd=cl.filter(c=>c.done).length;
  const files=t.files.map(f=>{const k=fileKind(f),src=fileSrc(f);
    return `<div class="file"><button type="button" class="thumb" data-fopen="${esc(f.id)}" ${k==="img"&&src?`style="background-image:url('${esc(src)}')"`:""} aria-label="Open ${esc(f.name)}">${k==="img"?(src?"":"IMG"):esc(k)}</button>
      <div class="fn" title="${esc(f.name)}">${esc(f.name)}</div>
      <div class="fm"><span>${fmtBytes(f.size)} · ${esc(firstName(mName(f.by)))}</span>${downloads?`<button type="button" class="sv" data-fsave="${esc(f.id)}">Save</button>`:""}<button type="button" class="xbtn" data-fdel="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button></div></div>`}).join("");
  const feedItems=[];
  if(tw.feed!=="activity")t.comments.forEach(c=>feedItems.push({at:c.at,html:commentHtml(c,m)}));
  if(tw.feed!=="comments")t.activity.forEach(a=>feedItems.push({at:a.at,html:`<div class="feed-item act">${avatar(a.by)}<div class="fb"><b>${esc(mName(a.by))}</b> ${esc(a.text)} · <span title="${esc(fmtStamp(a.at))}">${timeAgo(a.at)}</span></div></div>`}));
  feedItems.sort((a,b)=>b.at-a.at);
  return `<div class="tw-main" data-keepscroll="main">
    <div>
      <label style="display:block"><span class="sr" style="position:absolute;left:-9999px">Title</span><input id="twTitle" class="tw-title" value="${esc(t.title)}" maxlength="160" aria-label="Title"></label>
      <div class="tw-by"><span class="c-type" style="--tc:${t.type==="bug"?"var(--red)":t.type==="task"?"var(--cyan)":"var(--accent)"}">${TYPE_ICON[t.type]}</span>${TYPES[t.type]} created by ${esc(mName(t.createdBy))}${t.createdAt?` on ${fmtDay(t.createdAt)}`:""}</div>
    </div>
    <section class="tw-sec"><h3>Description</h3><textarea id="twDesc" rows="4" maxlength="20000" placeholder="What needs to be done, links, acceptance criteria">${esc(t.description)}</textarea></section>
    <section class="tw-sec"><h3>Checklist ${cl.length?`<small>${cd} of ${cl.length} done</small>`:""}</h3>
      ${cl.length?`<div class="bar" style="margin-bottom:8px"><i style="width:${Math.round(cd/cl.length*100)}%"></i></div>`:""}
      ${cl.map(c=>`<div class="cl-item${c.done?" done":""}"><button type="button" class="cl-box${c.done?" on":""}" data-cltoggle="${esc(c.id)}" aria-label="${c.done?"Uncheck":"Check"} ${esc(c.text)}" aria-pressed="${c.done}">${c.done?CHECK_SM:""}</button><span>${esc(c.text)}</span><button type="button" class="xbtn" data-cldel="${esc(c.id)}" aria-label="Remove item">×</button></div>`).join("")}
      <form class="add-row" id="clForm"><input id="clNew" placeholder="Add a checklist item" maxlength="300" autocomplete="off"><button class="btn small">Add</button></form></section>
    <section class="tw-sec"><h3>Files ${t.files.length?`<small>${t.files.length}</small>`:""}</h3>
      ${files?`<div class="files" style="margin-bottom:10px">${files}</div>`:""}
      <div class="drop-hint" id="twDrop"><label class="btn small" style="flex-direction:row;color:var(--ink)">Attach files<input type="file" id="twFile" multiple hidden></label><span>or drop files here. Up to 20 MB each.</span></div></section>
    <section class="tw-sec"><h3>Feed</h3>
      <div class="seg" role="group" aria-label="Show in feed">${[["all","All"],["comments","Comments"],["activity","Activity"]].map(([k,l])=>`<button type="button" data-feed="${k}" aria-pressed="${tw.feed===k}">${l}</button>`).join("")}</div>
      ${tw.feed!=="activity"?`<form class="composer" id="cmtForm"><textarea id="cmtText" maxlength="4000" placeholder="Write a comment. Note issues you ran into or what went wrong, so the team can learn from it.">${esc(tw.cmtDraft)}</textarea>
        <div class="row"><select id="cmtKind" aria-label="Kind of comment">${Object.entries(KIND).map(([k,v])=>`<option value="${k}"${tw.cmtKind===k?" selected":""}>${v.label}</option>`).join("")}</select><button class="btn primary small">Post</button></div></form>`:""}
      <div>${feedItems.map(x=>x.html).join("")||'<div class="empty">Nothing here yet.</div>'}</div></section>
  </div>`;
}
function commentHtml(c,m){
  const mine=m&&(m.id===c.by||m.access==="admin");
  return `<div class="feed-item${c.resolved?" resolved":""}">${avatar(c.by)}<div class="fb"><div class="fh"><b>${esc(mName(c.by))}</b><span class="chip ${KIND[c.kind].cls}">${KIND[c.kind].label}</span><span title="${esc(fmtStamp(c.at))}">${timeAgo(c.at)}</span>${c.resolved?"<span>· resolved</span>":""}
    <span class="acts">${c.kind==="issue"?`<button type="button" class="btn small" data-cres="${esc(c.id)}">${c.resolved?"Reopen":"Mark resolved"}</button>`:""}${mine||!m?`<button type="button" class="btn small ghost" data-cdel="${esc(c.id)}">Delete</button>`:""}</span></div><p>${esc(c.text)}</p></div></div>`;
}
function twSide(t,m,canEdit){
  const s=sprint(t.sprintId);
  const sprintOpts='<option value="">Backlog</option>'+sortedSprints().filter(x=>x.state!=="closed"||x.id===t.sprintId).map(x=>`<option value="${esc(x.id)}"${x.id===t.sprintId?" selected":""}>${esc(x.name)}${x.state==="active"?" (active)":x.state==="closed"?" (closed)":""}</option>`).join("");
  const head=`<div class="tw-head"><div class="top"><span class="key">${esc(shortId(t))}</span><span style="opacity:.85;font-size:13px">${s?esc(s.name):"Backlog"}${s&&s.state==="active"?`, ${daysLeft(s)} day${daysLeft(s)===1?"":"s"} left`:""}</span><button type="button" class="xbtn" data-twclose aria-label="Close">×</button></div>
    <div class="sel"><label>Sprint<select id="twSprint" data-f="sprintId">${sprintOpts}</select></label>
    <label>Status<select id="twStatus" data-f="status">${state.order.map(k=>`<option value="${k}"${k===t.status?" selected":""}>${COLS[k]}</option>`).join("")}</select></label></div></div>`;
  const tabs=`<div class="tw-tabs" role="tablist"><button type="button" role="tab" data-side="details" aria-selected="${tw.side==="details"}">Details</button><button type="button" role="tab" data-side="worklog" aria-selected="${tw.side==="worklog"}">Worklog · ${fmtH(t.loggedH)}</button></div>`;
  return `<aside class="tw-side" data-keepscroll="side">${head}${tabs}${tw.side==="details"?twDetails(t):twWorklog(t,m)}</aside>`;
}
function twDetails(t){
  const opt=(o,v)=>Object.entries(o).map(([k,l])=>`<option value="${k}"${String(k)===String(v)?" selected":""}>${l}</option>`).join("");
  const addable=members().filter(m=>m.access!=="viewer"&&!t.assignees.includes(m.id));
  const cyc=t.doneAt&&t.startedAt?((t.doneAt-t.startedAt)/DAY).toFixed(1)+" days":null;
  return `<div class="tw-pane"><div class="dl">
    <span style="align-self:start;padding-top:6px">People</span><div class="people-edit">${t.assignees.map(id=>`<span class="pchip">${avatar(id)}<span>${esc(mName(id))}</span><button type="button" class="xbtn" data-unassign="${esc(id)}" aria-label="Remove ${esc(mName(id))} from this task">×</button></span>`).join("")||'<span class="muted" style="font-size:13px">No one yet</span>'}
      ${addable.length?`<select id="twAddPerson" aria-label="Add a person"><option value="">+ Add a person</option>${addable.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select>`:""}</div>
    <span>Type</span><select id="twType" data-f="type">${opt(TYPES,t.type)}</select>
    <span>Priority</span><select id="twPriority" data-f="priority" data-num>${opt(PRIO,t.priority)}</select>
    <span>Story points</span><select id="twPoints" data-f="points" data-num>${[0,1,2,3,5,8,13,21].map(n=>`<option${n===t.points?" selected":""}>${n}</option>`).join("")}</select>
    <span>Estimate (h)</span><input id="twEst" data-f="estimateH" data-num type="number" min="0" step="0.5" value="${t.estimateH}">
    <span>ERP reference</span><input id="twErp" data-f="erpRef" maxlength="60" placeholder="e.g. PO-2291" value="${esc(t.erpRef)}">
    <span>Labels</span><input id="twLabels" data-f="labels" maxlength="200" placeholder="Separate with commas" value="${esc(t.labels.join(", "))}">
    ${t.status==="blocked"?`<span style="color:var(--red)">Blocked by</span><input id="twBlocked" data-f="blockedReason" maxlength="200" placeholder="What is this waiting for?" value="${esc(t.blockedReason)}">`:""}
  </div>
  <div class="dates"><span>Created ${t.createdAt?fmtStamp(t.createdAt):"unknown"}</span>${t.startedAt?`<span>Started ${fmtStamp(t.startedAt)}</span>`:""}${t.doneAt?`<span>Finished ${fmtStamp(t.doneAt)}${cyc?`, cycle time ${cyc}`:""}</span>`:""}
    ${t.blockedMs||t.blockedAt?`<span>Time blocked ${((t.blockedMs+(t.status==="blocked"&&t.blockedAt?Date.now()-t.blockedAt:0))/DAY).toFixed(1)} days</span>`:""}</div>
  <div class="actions" style="margin-top:4px"><button type="button" class="btn danger small" data-twdelete>Delete task</button></div></div>`;
}
function twWorklog(t,m){
  const mine=m&&t.timers[m.id];
  const others=Object.entries(t.timers).filter(([k])=>!m||k!==m.id);
  const pct=t.estimateH?Math.round(t.loggedH/t.estimateH*100):0;
  const people=m&&m.access==="admin"?members().filter(x=>x.access!=="viewer"):m?[m]:[];
  return `<div class="tw-pane">
    <div class="timer${mine?"":" idle"}"><div class="clock" ${mine?`data-since="${mine.startedAt}"`:""}>${mine?elapsed(Date.now()-mine.startedAt):"0:00:00"}</div>
      ${mine?`<button type="button" class="btn primary" data-tstop>Stop and log time</button><button type="button" class="btn small ghost" data-tdiscard>Discard timer</button>`
        :`<button type="button" class="btn primary" data-tstart>Start timer</button><small class="muted">${m?`Timing as ${esc(firstName(m.name))}`:"You'll be asked for your PIN"}</small>`}
      ${others.map(([k,v])=>`<small class="muted">${esc(mName(k))} is timing this: <b data-since="${v.startedAt}">${elapsed(Date.now()-v.startedAt)}</b></small>`).join("")}</div>
    <div><div class="wl-sum"><span>Logged <b>${fmtH(t.loggedH)}</b></span><span class="muted">Estimate ${fmtH(t.estimateH)}${t.estimateH?` · ${pct}%`:""}</span></div>
      <div class="bar" style="margin-top:6px"><i class="${pct>100?"over":pct>85?"warn":""}" style="width:${Math.min(100,pct)}%"></i></div></div>
    <form id="wlForm" class="panel" style="margin:0;padding:12px;box-shadow:none"><h3 style="margin:0 0 8px;font-size:14px">Add past worklog</h3>
      <div class="grid">${people.length>1?`<label class="full">Person<select id="wlWho">${people.map(x=>`<option value="${esc(x.id)}"${x.id===m.id?" selected":""}>${esc(x.name)}</option>`).join("")}</select></label>`:""}
        <label>Date<input id="wlDate" type="date" required max="${todayIso()}" value="${todayIso()}"></label>
        <label>Hours<input id="wlHours" type="number" required min="0.25" max="24" step="0.25" placeholder="e.g. 1.5"></label>
        <label class="full">What did you do?<input id="wlNote" maxlength="300" placeholder="Optional"></label></div>
      <div class="actions" style="margin-top:10px"><button class="btn small primary">Add worklog</button></div></form>
    <div>${t.worklogs.slice().reverse().map(w=>`<div class="wl">${avatar(w.by)}<div><span>${esc(mName(w.by))}</span><small>${fmtDate(w.date)}${w.note?" · "+esc(w.note):""}${w.timer?" · timer":""}</small></div><b>${fmtH(w.hours)}</b>
      ${m&&(m.id===w.by||m.access==="admin")||!m?`<button type="button" class="xbtn" data-wldel="${esc(w.id)}" aria-label="Delete worklog">×</button>`:"<span></span>"}</div>`).join("")||'<div class="empty">No time logged yet.</div>'}</div>
  </div>`;
}

/* ---- task window events ---- */
const twEl=$("#twDlg");
twEl.addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;const t=task(tw.id);if(!t)return;const d=b.dataset;
  if(d.twclose!=null)return closeTW();
  if(d.feed){tw.feed=d.feed;return renderTW()}
  if(d.side){tw.side=d.side;return renderTW()}
  if(d.twdelete!=null)return trashTask(t.id);
  if(d.unassign)return removeAssignee(t.id,d.unassign);
  if(d.cltoggle){const c=t.checklist.find(x=>x.id===d.cltoggle);if(c)act(m=>taskUpdate(t.id,{checklist:{[c.id]:{done:!c.done,doneBy:!c.done?m.id:null}}},`${c.done?"unchecked":"checked"} "${c.text}"`,m.id));return}
  if(d.cldel){const c=t.checklist.find(x=>x.id===d.cldel);if(c)act(m=>taskUpdate(t.id,{checklist:{[c.id]:null}},`removed checklist item "${c.text}"`,m.id));return}
  if(d.fopen){const f=t.files.find(x=>x.id===d.fopen);if(f)openFile(f);return}
  if(d.fsave){const f=t.files.find(x=>x.id===d.fsave);if(f)saveFile(f);return}
  if(d.fdel){const f=t.files.find(x=>x.id===d.fdel);if(f)act(async m=>{if(!await ask({title:`Remove ${f.name}?`,body:"The file is removed from this task.",ok:"Remove",danger:true}))return;return taskUpdate(t.id,{files:{[f.id]:null}},`removed the file ${f.name}`,m.id)});return}
  if(d.cres){const c=t.comments.find(x=>x.id===d.cres);if(c)act(m=>taskUpdate(t.id,{comments:{[c.id]:{resolved:!c.resolved}}},`${c.resolved?"reopened":"resolved"} an issue`,m.id));return}
  if(d.cdel){const c=t.comments.find(x=>x.id===d.cdel);if(c)act(async m=>{
    if(m.id!==c.by&&m.access!=="admin"){toast("You can only delete your own comments.");return}
    const ok=await taskUpdate(t.id,{comments:{[c.id]:{deleted:true}}},"deleted a comment",m.id);
    if(ok)toast("Comment deleted",{fn:()=>act(m2=>taskUpdate(t.id,{comments:{[c.id]:{deleted:false}}},"restored a comment",m2.id))});});return}
  if(d.tstart!=null)return startTimer(t.id);
  if(d.tstop!=null)return stopTimer(t.id,true);
  if(d.tdiscard!=null){const ok=await ask({title:"Discard the running timer?",body:"The time on it won't be logged.",ok:"Discard",danger:true});if(ok)stopTimer(t.id,false);return}
  if(d.wldel){const w=t.worklogs.find(x=>x.id===d.wldel);if(w)act(async m=>{
    if(m.id!==w.by&&m.access!=="admin"){toast("You can only delete your own worklogs.");return}
    if(!await ask({title:`Delete ${fmtH(w.hours)} logged on ${fmtDate(w.date)}?`,ok:"Delete worklog",danger:true}))return;
    return taskUpdate(t.id,{worklogs:{[w.id]:null}},`deleted a worklog of ${fmtH(w.hours)} by ${mName(w.by)}`,m.id)});return}
});
twEl.addEventListener("change",e=>{
  const el=e.target;const t=task(tw.id);if(!t)return;
  if(el.id==="twTitle"){const v=el.value.trim();if(v)setField(t.id,"title",v);else el.value=t.title;return}
  if(el.id==="twDesc")return setField(t.id,"description",el.value);
  if(el.id==="cmtKind"){tw.cmtKind=el.value;return}
  if(el.id==="twFile"){uploadFiles(t.id,[...el.files]);el.value="";return}
  if(el.id==="twAddPerson"){const pid=el.value;if(pid)addAssignee(t.id,pid).then(ok=>{if(!ok)renderTW()});return}
  const f=el.dataset.f;if(!f)return;
  let v=el.value;
  if(el.dataset.num!=null)v=Math.max(0,Number(v)||0);
  if(f==="labels")v=v.split(",").map(x=>x.trim().slice(0,30)).filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.toLowerCase()===x.toLowerCase())===i).slice(0,8);
  if(f==="sprintId")v=v||null;
  if(typeof v==="string")v=v.trim();
  setField(t.id,f,v);
});
twEl.addEventListener("input",e=>{if(e.target.id==="cmtText")tw.cmtDraft=e.target.value});
twEl.addEventListener("submit",async e=>{
  e.preventDefault();const t=task(tw.id);if(!t)return;
  if(e.target.id==="clForm"){const i=$("#clNew");const text=i.value.trim();if(!text)return;
    const ok=await act(m=>taskUpdate(t.id,{checklist:{[uid("k")]:{text,done:false,order:Date.now()}}},`added checklist item "${text}"`,m.id));
    if(ok){const n=$("#clNew");if(n){n.value="";n.focus()}}}
  if(e.target.id==="cmtForm"){const text=$("#cmtText").value.trim();if(!text){$("#cmtText").focus();return}
    const kind=$("#cmtKind").value;
    const ok=await act(m=>enqueue("tasks/"+t.id,"update",{comments:{[uid("c")]:{by:m.id,kind,text,at:Date.now(),resolved:false}}}));
    if(ok){tw.cmtDraft="";const c=$("#cmtText");if(c)c.value="";toast("Comment posted")}}
  if(e.target.id==="wlForm"){
    const hours=Math.round((+$("#wlHours").value||0)*100)/100,date=$("#wlDate").value,note=$("#wlNote").value.trim();
    if(!(hours>0)||hours>24){toast("Enter between 0.25 and 24 hours.");return}
    if(!isoOk(date)||date>todayIso()){toast("Pick a date that isn't in the future.");return}
    const ok=await act(m=>{const by=$("#wlWho")?$("#wlWho").value:m.id;if(by!==m.id&&m.access!=="admin"){toast("Only admins can log time for someone else.");return false}
      return taskUpdate(t.id,{worklogs:{[uid("w")]:{by,date,hours,note,at:Date.now()}}},`logged ${fmtH(hours)} for ${fmtDate(date)}${by!==m.id?" on behalf of "+mName(by):""}`,m.id)});
    if(ok){toast("Worklog added");["wlHours","wlNote"].forEach(i=>{const el=$("#"+i);if(el)el.value=""})}
  }
});
twEl.addEventListener("dragover",e=>{const z=e.target.closest("#twDrop");if(z&&e.dataTransfer&&[...e.dataTransfer.types].includes("Files")){e.preventDefault();z.classList.add("over")}});
twEl.addEventListener("dragleave",e=>{const z=e.target.closest("#twDrop");if(z)z.classList.remove("over")});
twEl.addEventListener("drop",e=>{const z=e.target.closest("#twDrop");if(!z)return;e.preventDefault();z.classList.remove("over");if(tw.id&&e.dataTransfer.files.length)uploadFiles(tw.id,[...e.dataTransfer.files])});

/* ---- timers ---- */
function startTimer(id){
  return act(async m=>{
    const running=state.tasks.filter(x=>!x.deleted&&x.timers[m.id]&&x.id!==id);
    for(const r of running)await stopTimer(r.id,true,m);
    return taskUpdate(id,{timers:{[m.id]:{startedAt:Date.now()}}},"started a timer",m.id);
  });
}
function stopTimer(id,log,who_){
  const run=async m=>{
    const t=task(id);const tm=t&&t.timers[m.id];if(!tm)return;
    const h=Math.round((Date.now()-tm.startedAt)/36000)/100;
    const patch={timers:{[m.id]:null}};let text="stopped the timer without logging";
    if(log&&h>=0.01){patch.worklogs={[uid("w")]:{by:m.id,date:iso(new Date(tm.startedAt)),hours:Math.min(h,24),note:"",at:Date.now(),timer:true}};text=`logged ${fmtH(Math.min(h,24))} with the timer`}
    else if(log)text="stopped the timer (under a minute, nothing logged)";
    const ok=await taskUpdate(id,patch,text,m.id);if(ok&&log)toast(h>=0.01?`Logged ${fmtH(Math.min(h,24))} on ${shortId(t)}`:"Under a minute, so nothing was logged");return ok;
  };
  return who_?run(who_):act(run);
}
setInterval(()=>{document.querySelectorAll("[data-since]").forEach(el=>{el.textContent=elapsed(Date.now()-Number(el.dataset.since))})},1000);
function renderMyTimer(){
  const m=me();const box=$("#myTimer");if(!box)return;
  const t=m&&state.tasks.find(x=>!x.deleted&&x.timers[m.id]);
  box.innerHTML=t?`<button type="button" class="tchip" data-opentimer="${esc(t.id)}" title="Open ${esc(t.title)}">⏱ ${esc(shortId(t))} <span data-since="${t.timers[m.id].startedAt}">${elapsed(Date.now()-t.timers[m.id].startedAt)}</span></button>`:"";
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-opentimer]");if(b)openTW(b.dataset.opentimer,"worklog")});

/* ---- files ---- */
const ASSET_TYPES={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",pdf:"application/pdf",mp4:"video/mp4",webm:"video/webm",csv:"text/csv",md:"text/markdown",json:"application/json",txt:"text/plain"};
function assetType(f){const ext=(f.name.split(".").pop()||"").toLowerCase();const t=ASSET_TYPES[ext];if(t)return t;return Object.values(ASSET_TYPES).includes(f.type)?f.type:null}
const readDataUrl=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
async function uploadFiles(id,list){
  if(!list.length)return;
  await act(async m=>{
    for(const f of list){
      if(f.size>20*1048576){toast(`${f.name} is larger than 20 MB.`);continue}
      const entry={name:f.name.slice(0,200),size:f.size,type:f.type||"",by:m.id,at:Date.now()};
      const at=assetType(f);
      if(assets&&at){
        toast(`Uploading ${f.name}…`);
        try{const r=await assets.upload(f,{type:at});entry.assetId=r.id;entry.type=at}
        catch(e){const c=e&&e.code;if(c==="too_large"){toast(`${f.name} is too large for this type.`);continue}
          if(c==="quota_or_state"){toast("File storage for this board is full. Remove old files first.");continue}}
      }
      if(!entry.assetId){
        if(f.size>150*1024){toast(assets?`${f.name} is a file type the board can't store. Images, PDF, video, CSV and text files work up to 20 MB; other files up to 150 KB.`:`Your account can only attach files up to 150 KB here. Ask the board owner to make you an Editor for bigger files.`);continue}
        try{const bid=uid("b");const data=await readDataUrl(f);if(!await enqueue("blobs/"+bid,"set",{name:entry.name,type:f.type||"",data,taskId:id,at:Date.now()}))continue;entry.blobId=bid;blobCache[bid]=data}
        catch(e){toast(`Couldn't read ${f.name}.`);continue}
      }
      await taskUpdate(id,{files:{[uid("f")]:entry}},`attached ${entry.name}`,m.id);
    }
  });
}
async function fileBlob(f){
  if(f.assetId){const r=await fetch("/_blob/"+f.assetId);if(!r.ok)throw new Error("missing");return r.blob()}
  if(!blobCache[f.blobId])await loadBlob(f);const u=blobCache[f.blobId];if(!u)throw new Error("missing");
  return (await fetch(u)).blob();
}
async function saveFile(f){
  if(!downloads){toast("Saving files isn't available in this view.");return}
  try{await downloads.save({filename:f.name,data:await fileBlob(f)})}catch(e){if(e&&e.message==="missing")toast("This file is no longer available.")}
}
async function openFile(f){
  if(/^image\//.test(f.type)){
    if(f.blobId&&!blobCache[f.blobId])await loadBlob(f);
    const src=fileSrc(f);if(!src){toast("This file is no longer available.");return}
    $("#lbImg").src=src;$("#lbImg").alt=f.name;$("#lbName").textContent=f.name;$("#lbSave").hidden=!downloads;$("#lbSave").onclick=()=>saveFile(f);$("#lightbox").showModal();return;
  }
  if(f.assetId){const a=document.createElement("a");a.href="/_blob/"+f.assetId;a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();return}
  saveFile(f);
}
