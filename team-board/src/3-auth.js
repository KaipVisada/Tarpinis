/* ================= accounts & PINs =================
   Anyone can look. Changing anything asks "who are you?" and a 4-digit PIN.
   A worker creates their own PIN the first time. The unlock lasts a few minutes
   of inactivity (Settings), so a shared touchscreen locks itself again. */
const session={id:null,until:0};
try{const s=JSON.parse(ss.get("tb.session")||"null");if(s&&s.until>Date.now()){session.id=s.id;session.until=s.until}}catch(e){}
const lockMs=()=>state.settings.lockMinutes*60000;
function me(){
  if(session.id&&Date.now()<session.until){const m=member(session.id);if(m&&!m.deleted)return m}
  return null;
}
function touchSession(){if(session.id){session.until=Date.now()+lockMs();ss.set("tb.session",JSON.stringify(session))}}
function unlock(m){session.id=m.id;touchSession();ls.set("tb.last",m.id);renderWho();render();if($("#twDlg").open)renderTW()}
function lockNow(quiet){session.id=null;session.until=0;ss.set("tb.session","");if(state.view==="admin")state.view="overview";renderWho();render();if($("#twDlg").open)renderTW();if(!quiet)toast("Locked")}
["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev,()=>{if(me())touchSession()},{passive:true}));
setInterval(()=>{if(session.id&&!me())lockNow(true)},5000);

async function hashPin(salt,pin){
  const enc=new TextEncoder();
  try{
    const key=await crypto.subtle.importKey("raw",enc.encode(pin),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode("teamboard|"+salt),iterations:60000,hash:"SHA-256"},key,256);
    return "p1$"+[...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }catch(e){ // very old browser: plain FNV-style fallback
    let h=2166136261;const s="teamboard|"+salt+"|"+pin;for(let r=0;r<5000;r++)for(let i=0;i<s.length;i++){h^=s.charCodeAt(i)+r;h=Math.imul(h,16777619)>>>0}
    return "f1$"+h.toString(16);
  }
}
const fails={get(id){try{return JSON.parse(ls.get("tb.fail."+id)||"{}")}catch(e){return{}}},set(id,v){ls.set("tb.fail."+id,v?JSON.stringify(v):"")}};

/* who(): resolves the unlocked member, asking for a PIN if needed. null = cancelled */
function who(){const m=me();if(m){touchSession();return Promise.resolve(m)}return pinFlow()}
/* act(fn): run fn(member) only for someone allowed to change the board */
async function act(fn,{admin=false}={}){
  const m=await who();if(!m)return false;
  if(m.access==="viewer"){toast("Your account can view the board but not change it. Ask an admin.");return false}
  if(admin&&m.access!=="admin"){toast("Only admins can do this.");return false}
  return fn(m);
}

let pin=null; // {stage, memberId, digits, first, resolve, err}
function pinFlow(stage){
  return new Promise(res=>{
    if(pin&&pin.resolve)pin.resolve(null);
    const noAdmin=!members().some(m=>m.access==="admin");
    pin={stage:stage||(noAdmin&&!members().length?"setup":"pick"),memberId:null,digits:"",first:null,resolve:res,err:"",q:""};
    renderPin();const d=$("#pinDlg");if(!d.open)d.showModal();
  });
}
function endPin(m){const r=pin&&pin.resolve;pin=null;const d=$("#pinDlg");if(d.open)d.close();if(r)r(m||null)}
$("#pinDlg").addEventListener("close",()=>{if(pin){const r=pin.resolve;pin=null;if(r)r(null)}});
function renderPin(){
  if(!pin)return;const b=$("#pinBody");const m=member(pin.memberId);
  const dots=`<div class="dots" id="pinDots">${[0,1,2,3].map(i=>`<i class="${i<pin.digits.length?"on":""}"></i>`).join("")}</div>`;
  const keys=`<div class="keys">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join("")}
    <button type="button" class="fn" data-k="back" aria-label="Delete last digit">⌫</button><button type="button" data-k="0">0</button><button type="button" class="fn" data-pcancel>Cancel</button></div>`;
  const whoLine=m?`<div class="pin-who">${avatar(m.id)}<span>${esc(m.name)}</span></div>`:"";
  if(pin.stage==="setup"){
    if(userCap&&!state.isOwner){b.innerHTML=`<h2>Board not set up yet</h2><p>The board owner needs to open it first and create the admin account.</p><div class="actions" style="justify-content:center"><button type="button" class="btn" data-pcancel>Close</button></div>`;return}
    b.innerHTML=`<h2>Set up the board</h2><p>Nobody has an account yet. Create the first admin account. You can add the rest of the team from the Admin tab afterwards.</p>
      <form id="setupForm" class="grid" style="grid-template-columns:1fr"><label>Your full name<input id="setupName" required maxlength="80" autocomplete="off"></label>
      <label>Job title<input id="setupTitle" maxlength="60" placeholder="e.g. Team lead"></label>
      <div class="actions"><button class="btn primary">Continue</button><button type="button" class="btn" data-pcancel>Cancel</button></div></form>`;
    setTimeout(()=>{const n=$("#setupName");if(n)n.focus()},30);return;
  }
  if(pin.stage==="pick"){
    const list=members().filter(x=>!pin.q||x.name.toLowerCase().includes(pin.q.toLowerCase()));
    b.innerHTML=`<h2>Who are you?</h2><p>Pick your name to make changes. Everyone can look without signing in.</p>
      ${members().length>12?`<input type="search" id="pinSearch" placeholder="Search names" value="${esc(pin.q)}" style="border:1px solid var(--line);background:var(--input);border-radius:7px;padding:9px 11px">`:""}
      <div class="pick">${list.map(x=>`<button type="button" data-pm="${esc(x.id)}">${avatar(x.id)}<span>${esc(x.name)}</span><small>${x.pinHash?esc(x.title||ACCESS[x.access]):"No PIN yet"}</small></button>`).join("")||'<div class="empty">No one matches.</div>'}</div>
      <div class="actions" style="justify-content:center"><button type="button" class="btn" data-pcancel>Cancel</button></div>`;
    return;
  }
  const lock=fails.get(pin.memberId);const wait=lock.until&&lock.until>Date.now()?Math.ceil((lock.until-Date.now())/1000):0;
  const heading={enter:"Enter your PIN",create:"Create your 4-digit PIN",confirm:"Enter the same PIN again"}[pin.stage];
  const hint={enter:wait?`Too many wrong tries. Try again in ${wait} seconds.`:"",create:"You'll use it every time you change something. Don't use 1234 or your birthday.",confirm:""}[pin.stage];
  b.innerHTML=`${whoLine}<h2>${heading}</h2>${hint?`<p>${esc(hint)}</p>`:""}${dots}<div class="pin-err" role="alert">${esc(pin.err)}</div>${keys}
    <div class="actions" style="justify-content:center;margin-top:0">
      <button type="button" class="btn small ghost" data-pback>Not ${esc(m?firstName(m.name):"you")}?</button>
      ${pin.stage==="enter"&&state.isOwner?`<button type="button" class="btn small ghost" data-preset>Reset this PIN (board owner)</button>`:""}
      ${pin.stage==="enter"&&!state.isOwner?`<span class="muted" style="font-size:12px">Forgot it? Ask an admin to reset your PIN.</span>`:""}</div>`;
  if(wait){clearTimeout(renderPin._t);renderPin._t=setTimeout(renderPin,1000)}
}
$("#pinBody").addEventListener("click",e=>{
  const t=e.target.closest("button");if(!t||!pin)return;
  if(t.dataset.pcancel!=null){endPin(null);return}
  if(t.dataset.pback!=null){pin.stage="pick";pin.digits="";pin.err="";renderPin();return}
  if(t.dataset.preset!=null){ownerReset();return}
  if(t.dataset.pm){const m=member(t.dataset.pm);if(!m)return;pin.memberId=m.id;pin.digits="";pin.err="";pin.stage=m.pinHash?"enter":"create";renderPin();return}
  if(t.dataset.k)pinKey(t.dataset.k);
});
$("#pinBody").addEventListener("input",e=>{if(e.target.id==="pinSearch"){pin.q=e.target.value;renderPin();const s=$("#pinSearch");s.focus();s.setSelectionRange(s.value.length,s.value.length)}});
$("#pinBody").addEventListener("submit",async e=>{
  e.preventDefault();if(e.target.id!=="setupForm")return;
  const name=$("#setupName").value.trim();if(!name)return;
  const id=uid("m");const data={name,title:$("#setupTitle").value.trim(),access:"admin",labels:[],weeklyH:40,availability:"available",timeOff:[],pinHash:null,pinSalt:"",createdAt:Date.now()};
  const ok=await enqueue("members/"+id,"set",data);if(!ok)return;
  if(!raw.members[id]){raw.members[id]=data;rebuild("members")}
  logEvent("people",`created the first admin account for ${name}`,id);
  pin.memberId=id;pin.stage="create";pin.digits="";renderPin();
});
document.addEventListener("keydown",e=>{
  if(!pin||!$("#pinDlg").open||!["enter","create","confirm"].includes(pin.stage))return;
  if(/^\d$/.test(e.key)){e.preventDefault();pinKey(e.key)}else if(e.key==="Backspace"){e.preventDefault();pinKey("back")}
});
async function pinKey(k){
  if(!pin)return;const lock=fails.get(pin.memberId);
  if(pin.stage==="enter"&&lock.until>Date.now())return;
  if(k==="back"){pin.digits=pin.digits.slice(0,-1);pin.err="";renderPin();return}
  if(pin.digits.length>=4)return;pin.digits+=k;pin.err="";renderPin();
  if(pin.digits.length<4)return;
  const m=member(pin.memberId);if(!m){pin.stage="pick";renderPin();return}
  const entered=pin.digits;
  if(pin.stage==="create"){
    if(/^(\d)\1{3}$/.test(entered)||["1234","4321","0123","9876"].includes(entered)){pin.digits="";pin.err="That PIN is too easy to guess. Pick another.";shake();return}
    pin.first=entered;pin.digits="";pin.stage="confirm";renderPin();return;
  }
  if(pin.stage==="confirm"){
    if(entered!==pin.first){pin.digits="";pin.first=null;pin.stage="create";pin.err="The PINs didn't match. Start again.";shake();return}
    const salt=uid("s");const h=await hashPin(salt,entered);
    const ok=await enqueue("members/"+m.id,"update",{pinHash:h,pinSalt:salt,pinSetAt:Date.now()});
    if(!ok){pin.digits="";pin.err="Couldn't save your PIN. Try again.";renderPin();return}
    logEvent("security",`created their PIN`,m.id);fails.set(m.id,null);
    const done=member(m.id)||m;endPin(done);unlock(done);toast(`PIN saved. Welcome, ${firstName(m.name)}.`);return;
  }
  // enter
  const h=await hashPin(m.pinSalt,entered);
  if(h===m.pinHash){fails.set(m.id,null);endPin(m);unlock(m);toast(`Unlocked for ${firstName(m.name)}`);return}
  const n=(lock.n||0)+1;const f={n};
  if(n>=5){f.until=Date.now()+60000;f.n=0;logEvent("security",`5 wrong PIN attempts for ${m.name}. Locked for 1 minute on this device`,null)}
  fails.set(m.id,f);pin.digits="";pin.err=n>=5?"Too many wrong tries.":`Wrong PIN. ${5-n} tr${5-n===1?"y":"ies"} left before a 1-minute pause.`;shake();
}
function shake(){renderPin();const d=$("#pinDots");if(d&&!matchMedia("(prefers-reduced-motion: reduce)").matches){d.classList.add("shake")}}
async function ownerReset(){
  const m=member(pin.memberId);if(!m)return;
  $("#pinDlg").close();
  if(!await ask({title:`Reset ${m.name}'s PIN?`,body:"You own this board, so you can reset any PIN. The person creates a new one the next time they change something.",ok:"Reset PIN"}))return;
  await enqueue("members/"+m.id,"update",{pinHash:null,pinSalt:"",pinSetAt:null});
  logEvent("security",`${m.name}'s PIN was reset by the board owner`,null);toast("PIN reset");
}
function renderWho(){
  const m=me();const box=$("#whoBox");if(!box)return;
  box.innerHTML=m?`<span class="who">${avatar(m.id)}<span>${esc(firstName(m.name))}${m.access==="admin"?' <small style="color:var(--amber)">admin</small>':""}</span><button type="button" id="lockBtn" title="Lock so the next person must enter their PIN">Lock</button></span>`
    :`<button type="button" class="who locked" id="signInBtn" title="Unlock with your PIN">Locked. Tap to sign in</button>`;
  $("#adminTab").hidden=!(m&&m.access==="admin");
}
document.addEventListener("click",e=>{
  if(e.target.closest("#lockBtn"))lockNow();
  else if(e.target.closest("#signInBtn"))who();
});
