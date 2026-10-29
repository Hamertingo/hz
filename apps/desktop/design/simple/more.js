/* more: the features beyond chatting. A voice call, an agent's versions, a page's versions, browser logins,
   the computer's screen size, what's new, feedback, and the island that lives at the notch. */

/* ───────── call: the agent's face breathing in the middle, what it says underneath ───────── */
let CALL=null;
const LINES=["Hi Gabriel. I'm here.","The short version: $290 a year wins on margin.","Churn looks flat up to that price, so I'd show it.","Mila is holding the thread until you say yes.","I'll send you the funnel numbers on Friday."];
function startCall(id){
  if(CALL)return;
  const ch=isCh(id),c=ch?CH[id]:AG[id],a=ch?AG[c.lead]:c;
  CALL={id,t0:Date.now(),i:0,mute:false,spk:true};
  $(".main").insertAdjacentHTML("beforeend",`<div class="call" id="call" style="--c:${a.color}">${Banner(a.color,"call"+id)}
    <div class="orb">${mascot(a.shape,a.color,110,{look:a.look,photo:a.photo,state:"work"})}</div>
    <h2>${ch?"#"+esc(c.name):esc(c.name)}</h2><div class="t" id="calltime">Connecting…</div>
    <div class="wave">${Array.from({length:24},(_,i)=>`<i style="height:${10+((i*7)%22)}px;animation-delay:${(i%6)*.09}s"></i>`).join("")}</div>
    <p class="said" id="callsaid"></p>
    <div class="ctr">${IconBtn("mic",{act:"call-mute",title:"Mute",id:"cmute"})}${IconBtn("volume",{act:"call-spk",title:"Speaker",on:true,id:"cspk"})}${IconBtn("phoneoff",{act:"call-end",title:"End call",cls:"end"})}</div></div>`);
  CALL.iv=setInterval(()=>{
    const s=Math.floor((Date.now()-CALL.t0)/1000),t=$("#calltime");if(!t)return;
    t.textContent=s<2?"Connecting…":`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
    if(s>=2&&s%3===0){const p=$("#callsaid");if(p&&CALL.i<LINES.length&&p.dataset.s!==String(s)){p.dataset.s=s;p.textContent=LINES[CALL.i++]}}
  },500);
}
function endCall(silent){
  if(!CALL)return;clearInterval(CALL.iv);$("#call")?.remove();
  const s=Math.max(1,Math.floor((Date.now()-CALL.t0)/1000)),id=CALL.id;CALL=null;
  if(silent)return;
  const who=isCh(id)?CH[id].lead:id;
  pushMsg(id,{id:nid("k"),kind:"call",who,dur:`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`,t:clock(),sum:LINES.slice(1,4)});
  toast("Call ended. The summary is in the chat.",{icon:"phone",ms:1800});
}
Object.assign(ACT,{
  "call-mute":el=>{CALL.mute=!CALL.mute;el.classList.toggle("on",CALL.mute);el.innerHTML=ic(CALL.mute?"micoff":"mic",18);$$("#call .wave i").forEach(i=>i.style.animationPlayState=CALL.mute?"paused":"running")},
  "call-spk":el=>{CALL.spk=!CALL.spk;el.classList.toggle("on",CALL.spk)},
  "call-end":()=>endCall(),
});

/* ───────── versions: every change to an agent's setup is kept and can come back ───────── */
function openVersions(id){
  const a=AG[id],V=[["Now","Model set to "+a.model,"you · just now",1],["v12","Instructions: added the pricing rules","you · 2 days ago"],["v11","Skill on: Price a plan","Atlas · last week"],["v10","Folder added: ~/hyze-cloud","you · Oct 12"],["v9","Created from the Strategy template","you · Oct 3"]];
  veil(`${Head(`${esc(a.name)}'s versions`,{lead:face(a,36)})}${Body(`${Hint("Every change to instructions, skills, model or access is saved. Restoring keeps memory and chats.")}<div class="vers">${Group(V.map(([v,t,s,cur])=>Row({title:`${t}`,sub:`${v} · ${s}`,cls:cur?"cur":"",right:cur?Chip("Current"):Btn("Restore",{act:"ver-restore",size:"sm",kind:"ghost",icon:"restore",a:{"data-v":v}})})).join(""))}</div>`)}`,{width:540});
}
ACT["ver-restore"]=el=>confirmBox(`Restore ${el.dataset.v}?`,"The agent goes back to that setup. Memory and chats stay as they are.","Restore",()=>{closeAllVeils();toast(`Restored ${el.dataset.v}`,{icon:"restore",action:"Undo",onAction:()=>toast("Back to the current version",{ms:1300})})},{danger:false});
function openPageVersions(){
  const V=[["v3","Annual price set to $290","Atlas · 21:13",1],["v2","Added the FAQ","Atlas · 20:40"],["v1","First draft","Atlas · 19:58"]];
  veil(`${Head("Pro plan pricing page",{lead:`<span class="row" style="padding:0;min-height:0;width:auto"><span class="ico" style="width:36px;height:36px;border-radius:10px;background:var(--l3)">${ic("page",18)}</span></span>`})}${Body(`${Hint("Pages your agents build keep every version. Open one to compare, or bring it back.")}<div class="vers">${Group(V.map(([v,t,s,cur])=>Row({title:t,sub:`${v} · ${s}`,cls:cur?"cur":"",right:cur?Chip("Live",{dot:"go"}):`${Btn("Open",{act:"page-open",size:"sm",kind:"ghost"})}${Btn("Restore",{act:"ver-restore",size:"sm",kind:"ghost",a:{"data-v":v}})}`})).join(""))}</div>`)}`,{width:540});
}

/* ───────── browser logins: the sites an agent's browser stays signed in to ───────── */
const LOGINS=[["github.com","you@example.com","3 days ago"],["x.com","@hyzecloud","today"],["console.aws.amazon.com","ops@example.com","Monday"],["vercel.com","you@example.com","last week"]];
function openLogins(id){
  const a=AG[id];
  veil(`${Head("Browser logins",{lead:face(a,36)})}${Body(`${Hint(`Sites ${esc(a.name)}'s browser is signed in to. Passwords never reach the agent; only the session does.`)}${Group(LOGINS.map(([d,u,w],i)=>Row({lead:`<span class="lg">${ic("globe",14)}</span>`,title:d,sub:`${u} · used ${w}`,right:Btn("Sign out",{act:"login-out",size:"sm",kind:"ghost",a:{"data-i":i}})})).join("")+Row({icon:"plus",title:"Sign in to a site…",act:"login-add"}),{id:"logins"})}`)}`,{width:520});
}
Object.assign(ACT,{
  "login-out":el=>{const [d]=LOGINS[+el.dataset.i];el.closest(".row").remove();toast(`Signed out of ${d}`,{icon:"out",ms:1500})},
  "login-add":()=>toast("A browser opens. Sign in there and the agent keeps the session.",{icon:"globe",ms:2200}),
});

/* ───────── computer size: how much machine the agents' computer gets ───────── */
function openComputerSize(){
  const sizes=[["Small","2 CPUs · 4 GB","Browsing and light scripts"],["Medium","4 CPUs · 8 GB","Builds, tests, a few tabs"],["Large","8 CPUs · 16 GB","Heavy builds and many agents at once"]];
  const cur=S.vm||"Medium";
  veil(`${Head("Computer size")}${Body(`${Hint("The agents share one computer on this Mac. A bigger one is faster and uses more of your Mac.")}<div class="voices" style="grid-template-columns:1fr">${sizes.map(([n,s,d])=>`<button class="vc ${cur===n?"on":""}" data-act="vm-size" data-v="${n}"><span class="lg" style="width:34px;height:34px">${ic("cpu",17)}</span><div><b>${n} · <span style="font-size:12.5px">${s}</span></b><span>${d}</span></div>${cur===n?`<span style="margin-left:auto">${ic("check",16)}</span>`:""}</button>`).join("")}</div>`)}`,{width:480});
}
ACT["vm-size"]=el=>{S.vm=el.dataset.v;closeAllVeils();toast(`Computer set to ${S.vm}. It restarts when no agent is working.`,{icon:"cpu"})};

/* ───────── what's new, feedback ───────── */
function openWhatsNew(){
  const N=[["phone","Call your agents","Talk it through out loud. A summary lands in the chat when you hang up."],["pin","Pins on top","Up to four conversations sit above the list, one click away."],["folder","Folders","Group conversations and collapse what you don't need today."],["history","Versions","Every change to an agent is saved and can be restored."]];
  veil(`<div style="border-radius:var(--r4) var(--r4) 0 0;overflow:hidden">${Banner("#a58bfa","whats-new",{style:"height:110px"})}</div>${Head("What's new in hz 0.21")}${Body(`${Group(N.map(([i,t,s])=>Row({icon:i,title:t,sub:s})).join(""))}`)}${Foot(Btn("Got it",{act:"close-veil",kind:"primary"}))}`,{width:480});
}
function openFeedback(){
  veil(`${Head("Send feedback")}${Body(`${Label("What would make hz better?")}${Field({area:true,rows:5,in:"fb-text",placeholder:"An idea, something that broke, anything",autofocus:true})}<div style="display:flex;gap:6px;margin-top:10px">${["Idea","Bug","Other"].map((k,i)=>`<button class="pill chip2 ${i?"":"on"}" data-act="fb-kind" data-v="${k}">${k}</button>`).join("")}</div>${Hint("We read every note. Nothing from your chats is attached unless you paste it.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Send",{act:"fb-send",kind:"primary",off:true,id:"fbs"}))}`,{width:460});
}
INPUT["fb-text"]=v=>$("#fbs").classList.toggle("off",!v.trim());
Object.assign(ACT,{
  "fb-kind":el=>$$("[data-act=fb-kind]").forEach(b=>b.classList.toggle("on",b===el)),
  "fb-send":()=>{closeAllVeils();toast("Thanks. It's on its way.",{icon:"check"})},
});

/* ───────── the island: working and waiting agents at the notch, answerable without opening hz ───────── */
function toggleIsland(){
  const el=$("#island");if(el){el.remove();return}
  document.body.insertAdjacentHTML("beforeend",`<div class="island" id="island" data-act="island-open"></div>`);rIsland(false);
}
function rIsland(open){
  const el=$("#island");if(!el)return;el.classList.toggle("open",open);
  const live=Object.values(AG).filter(a=>a.live),wait=S.inbox.filter(i=>!i.state);
  el.innerHTML=open?`<div style="display:flex;align-items:center;gap:8px;padding-bottom:6px;color:#999">${ic("hand",14)} ${wait.length} waiting · ${live.length} working<span style="margin-left:auto;cursor:default" data-act="island-close">${ic("x",14)}</span></div>${wait.slice(0,3).map(i=>`<div class="row2">${face(AG[i.agent],24)}<div style="min-width:0;flex:1"><b>${esc(i.title)}</b><span>${AG[i.agent].name}</span></div>${i.kind==="approval"?`${Btn("Deny",{act:"isl-resolve",size:"sm",a:{"data-id":i.id,"data-o":"Deny"}})}${Btn("Approve",{act:"isl-resolve",size:"sm",kind:"primary",a:{"data-id":i.id,"data-o":"Approve"}})}`:Btn("Open",{act:"isl-open",size:"sm",a:{"data-id":i.id}})}</div>`).join("")}`
    :`<span class="w">${live.map(a=>face(a,18)).join("")}</span><span>${live.length?`${live[0].name} is working`:"All quiet"}</span><span class="t">${wait.length?`${wait.length} waiting`:""}</span>`;
}
Object.assign(ACT,{
  "island-open":()=>{if(!$("#island.open"))rIsland(true)},
  "island-close":()=>rIsland(false),
  "isl-resolve":el=>{resolveItem(el.dataset.id,el.dataset.o);rIsland(true)},
  "isl-open":el=>{const it=S.inbox.find(i=>i.id===el.dataset.id);rIsland(false);openConv(it.conv)},
});
