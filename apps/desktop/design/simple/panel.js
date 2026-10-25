/* panel: the docked right side. An agent's profile, a channel's tasks, and the things a chat opens beside itself. */
const ENG={Claude:"Claude Code",Codex:"Codex",OpenCode:"OpenCode"};
const EFFORT={Low:"fastest",Medium:"default",High:"thinks longer"};
const when=r=>r.when==="daily"?`every day at ${r.time}`:r.when==="once"?`once at ${r.time}`:`every ${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][r.day]} at ${r.time}`;
/* kept for the editors that still build rows by name */
const rowH=({ico,t,s,r,act,id,k,red})=>Row({lead:ico?`<span class="ico">${ico}</span>`:"",title:t,sub:s,right:r,act,id,k,red});
const chev=ic("chev",15),dn=ic("down",15);
const statusOf=a=>a.paused?["Paused","warn"]:a.live?["Working","go"]:a.ask?["Waiting for you","warn"]:a.asleep?["Resting",""]:["Free","go"];
const LIB=[
  {wk:"This week",items:[{t:"github.com",s:"hyzecloud · pull · 482",b:"github"},{t:"vercel.com",s:"hyzecloud · deployments",b:"vercel"},{t:"pricing-analysis.md",s:"Document · today",f:1}]},
  {wk:"Last week",items:[{t:"notion.so",s:"Launch plan · page",b:"notion"},{t:"figma.com",s:"Pricing page · frame",b:"figma"},{t:"drive.google.com",s:"Sandbox VMs · draft",b:"googledrive"},{t:"api.hyzecloud.com",s:"api · plans · public"},{t:"hero-v2.png",s:"Image · yesterday",f:1},{t:"launch-thread.md",s:"Document · yesterday",f:1},{t:"demo-reel.mp4",s:"Video · yesterday",f:1,v:1}]},
];
const TASKS={"#launch":[["Freeze the pricing page copy",true],["Finish the launch thread (7 posts)",true],["Match blog title to the thread",false],["Schedule everything for Oct 30, 10:00",false]]};
const taskList=id=>TASKS[id]||(TASKS[id]=[["Set up the channel",true],["Write the first update",false]]);

const tgt=()=>EDIT?EDIT.id:S.conv;
const rAll=()=>{rPanel();rSide();rTop();if(EDIT)rEdit()};
function showPanel(){rPanel();rTop()}
function hidePanel(){S.panel=null;rPanel();rTop()}
function rPanel(){
  const el=$("#panel"),P=S.panel;
  if(!P){el.classList.remove("open");return}
  const old=$(".in",el),sc=old?.scrollTop||0,same=old&&old.dataset.k===P.k+(P.id||"")+S.conv;
  el.classList.add("open");
  const docked=!["profile","channel"].includes(P.k),onBanner=["profile","channel"].includes(P.k);
  const k=onBanner?"glass":"";
  const btns=`<div class="pbtns">${docked?IconBtn("chevl",{act:"panel-back",title:"Back",kind:k,cls:"",a:{style:"margin-right:auto"}}):""}${IconBtn("share",{act:"share",title:"Share",kind:k})}${IconBtn("x",{act:"panel-close",title:"Close",kind:k})}</div>`;
  const body={profile:profileHTML,channel:channelHTML,file:fileHTML,pr:prHTML,activity:activityHTML,thread:threadHTML}[P.k]();
  el.innerHTML=`<div class="in ${same?"":"fresh"}" data-k="${P.k+(P.id||"")+(P.tab||"")+S.conv}" style="${same?"animation:none":""}">${btns}${body}</div>`;
  $(".in",el).scrollTop=sc;
  if(P.k==="profile"&&P.tab==="library"&&!P.loaded){withSkel($("#libbox"),5,420,()=>{P.loaded=1;rPanel()})}
  if(P.k==="profile"&&P.tab==="computer"&&P.waking){later(900,()=>{if(S.panel===P){P.waking=0;AG[S.conv].asleep=0;AG[S.conv].awake=1;rPanel();rSide()}})}
  if(P.k==="thread")$(".in",el).scrollTop=$(".in",el).scrollHeight;
}
/* the banner, the face sitting on its edge, the name: shared by agents and channels */
const heroHTML=(color,seed,faceHTML,name,sub)=>`<div class="pban">${Banner(color,seed,{style:"height:100%"})}</div><div class="phero"><span class="fr">${faceHTML}</span><h3>${name}</h3><div class="role">${sub}</div></div>`;

/* ───────── agent profile ───────── */
function profileHTML(){
  const a=AG[S.conv],P=S.panel,[st,sc]=statusOf(a);
  const tabs=Tabs([["details","Details"],["library","Library"],["computer","Computer"]],P.tab,{act:"ptab"});
  return heroHTML(a.color,a.id,mascot(a.shape,a.color,84,{look:a.look,photo:a.photo,state:stateOf(a)}),esc(a.name),esc(a.role))+
    `<div class="chipr">${Chip(ENG[a.cli],{html:cliMark(a.cli,15),act:"p-engine"})}${Chip(st,{dot:sc||undefined})}</div>${tabs}`+
    ({details:detailsHTML,library:libraryHTML,computer:computerHTML}[P.tab])(a);
}
function detailsHTML(a){
  const rts=ROUTINES.filter(r=>r.agent===a.id),notes=MEMORY[a.id]||[],accs=Object.keys(PERM),dirs=a.dirs||[a.dir];
  return `${Section("Instructions")}${Group(Row({icon:"doc",title:`${esc(a.role)} agent for ${esc(WS[S.ws].name)}`,sub:"Read and edit what it knows how to do.",act:"edit-instr",id:a.id,right:Next()}))}
  ${Section("Engine")}${Group(Row({icon:"cpu",title:"Engine",right:Down(ENG[a.cli]),act:"p-engine"})+Row({icon:"spark",title:"Model",right:Down(a.model),act:"p-model"})+Row({icon:"brain",title:"Effort",right:Down(a.effort),act:"p-effort"}))}
  ${Section("Routines",{count:rts.length,action:"New",actionAct:"routine-new"})}${Group(rts.length?rts.map(r=>Row({icon:"clock",title:esc(r.title),sub:when(r),right:toggle(r.id,r.on,"rt-tog"),act:"routine-edit",id:r.id,tag:"div"})).join(""):`<div class="note dim">No routines yet.</div>`)}
  ${Section("Memory",{count:notes.length,action:"Add",actionAct:"note-add"})}${Group(notes.length?notes.map((n,i)=>noteHTML(n,i,a)).join(""):`<div class="note dim">Nothing remembered yet. Say “remember this” in the chat.</div>`)}
  ${Section("Access")}${Group(`<div class="ladder">${accs.map((k,i)=>`<button class="${a.perm===k?"on":""}" data-act="p-perm" data-v="${k}">${PERM[k][0]}<span>${["reads","asks","asks risky","never asks"][i]}</span></button>`).join("")}</div>${Hint(PERM[a.perm][1]+".")}`)}
  ${Section("Folders",{count:dirs.length})}${Group(dirs.map((d,i)=>Row({icon:"folder",title:"~/"+d.replace("~/",""),right:IconBtn("x",{act:"folder-rm",size:"sm",kind:"plain",title:"Remove",a:{"data-i":i}})})).join("")+Row({icon:"plus",title:"Add a folder",act:"folder-add"}))}
  ${Section("Setup")}${Group(Row({icon:"history",title:"Versions",sub:"Every change is saved. Bring an old one back.",act:"open-versions",id:a.id,right:Next("v12")})+Row({icon:"globe",title:"Browser logins",sub:"Sites its browser stays signed in to.",act:"open-logins",id:a.id,right:Next(LOGINS.length)}))}
  ${Section("Budget")}${Group(Row({icon:"wallet",title:`$${a.spent.toFixed(2)} of $${a.budget} today`,sub:`<div class="bar"><i style="width:${Math.min(100,a.spent/a.budget*100)}%"></i></div>`,right:Stepper("budget")}))}
  ${Section("Activity",{count:"last 26 weeks"})}${Group(`<div class="heat">${rngHeat(a.id)}</div>`)}
  <div class="btnrow">${Btn("Edit agent",{act:"edit-agent",icon:"pen",cls:"grow",a:{"data-id":a.id}})}${Btn(a.paused?"Resume":"Pause",{act:"pause-agent",icon:a.paused?"play":"pause",a:{"data-id":a.id}})}</div>`;
}
const noteHTML=(n,i,a)=>S.noteEdit===a.id+":"+i
  ?`<div class="note">${Field({area:true,rows:2,value:n,id:"ne"})}<div class="m">${Btn("Save",{act:"note-save",size:"sm",kind:"primary",a:{"data-i":i}})}<button data-act="note-cancel">Cancel</button></div></div>`
  :`<div class="note"><p>${esc(n)}</p><div class="m"><button data-act="note-edit" data-i="${i}">Edit</button><button data-act="note-forget" data-i="${i}">Forget</button></div></div>`;
function rngHeat(id){const r=rng(id);let s="";for(let i=0;i<26*5;i++){const v=r()*10|0;s+=`<i style="background:${v>6?"var(--acc)":v>4?"color-mix(in srgb,var(--acc) 55%,var(--l3))":v>2?"color-mix(in srgb,var(--acc) 25%,var(--l3))":""}"></i>`}return s}
function libraryHTML(){
  const P=S.panel;if(!P.loaded)return `<div id="libbox" style="margin-top:14px">${skel(5)}</div>`;
  return LIB.map(g=>`${Section(g.wk)}${Group(g.items.map(i=>Row({lead:i.b?brand(i.b,34):`<span class="lg">${ic(i.v?"film":i.f?"doc":"link",17)}</span>`,title:i.t,sub:i.s,act:i.f?"lib-file":"lib-link",id:i.t,right:i.f?"":`<span class="val">${ic("ext",15)}</span>`})).join(""))}`).join("");
}
function computerHTML(a){
  const P=S.panel,ctl=S.ctrl?.[a.id];
  if(!S.computer)return `<div class="screen pat" data-act="computer-on" style="margin-top:14px">${ic("monitor",34)}<b>The computer is off</b><span>Agents can't see or use a screen. Click to turn it on.</span></div>`;
  if(P.waking)return `<div class="sk" style="height:240px;border-radius:15px;margin-top:14px"></div><div class="cap">Waking ${a.name}…</div>`;
  if(a.asleep&&!a.awake)return `<div class="screen pat" data-act="wake" style="margin-top:14px">${mascot(a.shape,a.color,72,{look:a.look,photo:a.photo,state:"sleep"})}<b>${a.name} is resting</b><span>Click to wake it and see the screen.</span></div><div class="cap">${a.name}'s screen</div>`;
  return `<div style="margin-top:14px">${vmScreen(a)}</div><div class="cap">${ctl?"You're in control":`${esc(a.name)}'s screen · live`}</div>
  ${ctl?`<div class="ctlbanner">${ic("hand",15)} You're driving. ${esc(a.name)} waits until you give it back.</div><div class="ctl">${Btn("Give it back",{act:"giveback",kind:"primary"})}</div>`:`<div class="ctl">${Btn("Take over",{act:"takeover",icon:"hand",kind:"primary"})}${Btn("Let it rest",{act:"rest",icon:"moon"})}</div>`}<div class="btnrow" style="justify-content:center">${Btn("Screen size",{act:"vm-open",icon:"maximize",kind:"ghost",size:"sm"})}${Btn("Pop out",{act:"pop-screen",icon:"ext",kind:"ghost",size:"sm"})}</div>`;
}

/* ───────── channel ───────── */
function channelHTML(){
  const c=CH[S.conv],P=S.panel,lead=AG[c.lead];
  const tabs=Tabs([["tasks","Tasks"],["members","Members"],["about","About"]],P.tab,{act:"ptab"});
  let b="";
  if(P.tab==="tasks"){const t=taskList(S.conv);b=`${Section("Tasks",{count:`${t.filter(x=>x[1]).length} of ${t.length}`})}${Group(t.map((x,i)=>`<button class="row hv" data-act="task-tog" data-i="${i}"><span class="step ${x[1]?"d":""}" style="padding:0"><span class="c">${x[1]?ic("check",12,"currentColor",3):""}</span></span><span class="tx"><b style="font-weight:550;${x[1]?"color:var(--ink3);text-decoration:line-through":""}">${esc(x[0])}</b></span></button>`).join("")+`<div class="row"><span class="ico">${ic("plus",17)}</span><input class="inl" style="text-align:left;flex:1;width:auto" data-in="task-new" placeholder="Add a task" id="tasknew"></div>`)}`}
  if(P.tab==="members")b=`${Section("Agents",{count:c.members.length,action:"Add",actionAct:"ch-add"})}${Group(c.members.map(id=>{const a=AG[id];return Row({lead:face(a,34),title:a.name,sub:`${a.role} · ${ENG[a.cli]}`,right:`${c.lead===id?`<span class="tag">Lead</span>`:""}${IconBtn("more",{act:"member-more",size:"sm",kind:"plain",a:{"data-id":id}})}`})}).join(""))}`;
  if(P.tab==="about")b=`${Section("Purpose")}${Group(`<div class="note"><p>${esc(c.purpose)}</p></div>`)}${Section("Settings")}${Group(Row({icon:"pen",title:"Edit channel",act:"ch-edit",right:Next()})+Row({icon:"layers",title:"Rounds",sub:"How many times agents answer each other before waiting for you.",right:Down(c.rounds),act:"ch-rounds"})+Row({icon:"bell",title:"Mute",right:toggle(S.conv,S.muted.has(S.conv),"mute-tog")})+Row({icon:"out",title:"Leave channel",act:"ch-leave",red:true}))}`;
  return heroHTML(lead.color,c.name,HashTile(c,84),"#"+esc(c.name),esc(c.purpose).slice(0,70)+(c.purpose.length>70?"…":""))+
    `<div class="chipr">${Chip(`${c.members.length} agents`,{icon:"people"})}${Chip(`${lead.name} leads`,{dot:"go"})}</div>${tabs}${b}`;
}

/* ───────── things a chat opens beside itself ───────── */
const plainHero=(icon,title,sub)=>`<div class="phero plain"><span class="fi2">${ic(icon,26)}</span><h3 class="sm">${title}</h3><div class="role">${sub}</div></div>`;
function fileHTML(){
  const m=findMsg(S.conv,S.panel.id)||{file:{name:S.panel.id,size:"",kind:"File",body:"(preview)"}},f=m.file;
  return `${plainHero("doc",esc(f.name),`${f.kind} · ${f.size}`)}
  <div class="vm" style="margin-top:16px;background:var(--l2);color:var(--ink)"><pre style="min-height:220px">${esc(f.body||"")}</pre></div>
  <div class="btnrow">${Btn("Download",{act:"file-dl",icon:"download",a:{"data-id":f.name}})}${Btn("Copy path",{act:"file-copy",icon:"copy"})}${Btn("Ask to revise",{act:"file-revise",icon:"pen",kind:"primary",cls:"grow"})}</div>`;
}
function prHTML(){
  const p=PRS.find(x=>x.id===S.panel.id),a=AG[p.by];
  const ck={ok:["All checks passed","var(--green)"],run:["Checks are running","var(--amber)"],bad:["1 check failing","var(--red)"]}[p.ck];
  return `${plainHero("pr",esc(p.title),`${face(a,18)} ${a.name} · ${p.repo} #${p.num}`)}
  <div class="chipr">${Chip(p.lane==="merged"?"Merged":p.lane==="review"?"In review":"Open",{dot:p.lane==="merged"?"":"go"})}</div>
  ${Group(Row({lead:`<span class="ico">${Dot(ck[1])}</span>`,title:ck[0],sub:"Build, tests, lint"})+Row({icon:"file2",title:`${p.files} files changed`,sub:`<span class="df"><b>+${p.add}</b> <em>−${p.del}</em></span>`}))}
  <div class="vm" style="margin-top:12px"><pre style="min-height:0"><span style="color:#777">@@ webhook.rs @@</span>
<span style="color:#e57373">- let delay = 1000;</span>
<span class="g">+ let delay = base * 2u64.pow(attempt);</span>
<span class="g">+ let delay = delay.min(60_000);</span></pre></div>
  ${p.lane==="merged"?Hint("Merged. Nothing left to do."):`<div class="btnrow">${Btn("Approve",{act:"pr-approve",icon:"check",a:{"data-id":p.id}})}${Btn("Request changes",{act:"pr-changes",a:{"data-id":p.id}})}${Btn("Merge",{act:"pr-merge",icon:"merge",kind:"primary",cls:"grow",off:p.ck==="bad",a:{"data-id":p.id}})}</div>`}
  <div class="btnrow" style="margin-top:8px">${Btn("Open in GitHub",{act:"pr-gh",icon:"ext",kind:"ghost"})}</div>`;
}
function activityHTML(){
  const live=S.panel.id==="live";
  const rows=[["file2","Read","src/webhook.rs"],["term","Ran","pnpm test --filter api"],["pen","Edited","src/webhook.rs (+12 −3)"],["term","Ran","cargo check"],["doc","Wrote","run-summary.md"]];
  return `${plainHero("activity","What it did",live?"Live, newest at the bottom":"Every tool call, in order")}
  ${Section("Steps",{count:rows.length+(live?1:0)})}${Group(`<div class="rise">${rows.map((r,i)=>Row({icon:r[0],title:r[1],sub:`<span class="mono" style="font-size:12px">${r[2]}</span>`,right:ic("check",16,"var(--green)"),a:{style:`--i:${i}`}})).join("")}${live?Row({lead:`<span class="ico"><span style="width:16px;height:16px;border:2px solid var(--primary2);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;display:block"></span></span>`,title:"Editing",sub:`<span class="mono" style="font-size:12px">src/retry.rs</span>`}):""}</div>`)}`;
}
function threadHTML(){
  const m=findMsg(S.conv,S.panel.id),a=m.from==="me"?null:AG[m.from];
  return `${plainHero("thread","Thread",`${(m.thread||[]).length} replies`)}
  <div class="msg ag" style="margin-top:16px"><div class="bub" style="max-width:none">${fmt(m.text||m.file?.name||"")}<time>${a?a.name:"You"} · ${m.t}</time></div></div>
  ${Section("Replies")}<div class="thread">${(m.thread||[]).map(t=>`<div class="msg ${t.from==="me"?"me":"ag"}"><div class="bub" style="max-width:100%">${fmt(t.text)}<time>${t.from==="me"?"You":AG[t.from].name} · ${t.t}</time></div></div>`).join("")||`<div class="note dim">No replies yet.</div>`}</div>
  <div class="cmp" style="margin-top:14px;min-height:46px"><input data-in="thread" id="thin" placeholder="Reply in thread">${IconBtn("up",{act:"thread-send",cls:"send",title:"Send"})}</div>`;
}

Object.assign(ACT,{
  "toggle-panel":()=>{if(S.panel&&["profile","channel"].includes(S.panel.k))hidePanel();else{S.panel=isCh(S.conv)?{k:"channel",tab:"tasks"}:{k:"profile",tab:"details"};showPanel()}},
  "ptab-go":el=>{S.panel={k:el.dataset.k,tab:el.dataset.t};showPanel()},
  ptab:el=>{S.panel.tab=el.dataset.t;S.panel.loaded=0;rPanel()},
  "panel-close":()=>hidePanel(),
  "panel-back":()=>{S.panel=isCh(S.conv)?{k:"channel",tab:"tasks"}:{k:"profile",tab:"details"};showPanel()},
  share:()=>{navigator.clipboard?.writeText("hz://share/"+S.conv).catch(()=>{});toast("Link copied",{icon:"link",ms:1500})},
  "p-engine":el=>{const a=AG[tgt()];menu(el,["#Engine",...Object.keys(MODELS).map(c=>[null,ENG[c],()=>{a.cli=c;a.model=MODELS[c][0];rAll();toast(`${a.name} now runs on ${ENG[c]}`,{icon:"cpu"})},{html:cliMark(c,18),chk:c===a.cli}])],{align:"right"})},
  "p-model":el=>{const a=AG[tgt()];menu(el,[`#${ENG[a.cli]} models`,...MODELS[a.cli].map(m=>[null,m,()=>{a.model=m;rAll();toast(`${a.name} uses ${m} from the next message`,{icon:"spark"})},{chk:m===a.model}])],{align:"right"})},
  "p-effort":el=>{const a=AG[tgt()];menu(el,["#Effort",...Object.keys(EFFORT).map(m=>[null,m,()=>{a.effort=m;rAll()},{chk:m===a.effort,s:EFFORT[m]}])],{align:"right"})},
  "p-perm":el=>{const a=AG[S.conv];a.perm=el.dataset.v;rPanel();toast(`${a.name}: ${PERM[a.perm][0]}. ${PERM[a.perm][1]}.`,{icon:"shield"})},
  "rt-tog":el=>{const r=ROUTINES.find(x=>x.id===el.dataset.id);r.on=!r.on;el.classList.toggle("on",r.on);toast(`${r.title} ${r.on?"on":"paused"}`,{icon:"clock",ms:1400});refreshSheets()},
  "routine-new":()=>routineEditor(null,"",S.conv),
  "routine-edit":(el,e)=>{if(!e?.target?.closest?.(".tog"))routineEditor(el.dataset.id)},
  "note-add":()=>{const a=AG[tgt()];(MEMORY[a.id]=MEMORY[a.id]||[]).unshift("New note");a.mem++;S.noteEdit=a.id+":0";rPanel();if(EDIT)rEdit();$("#ne")?.select()},
  "note-edit":el=>{S.noteEdit=tgt()+":"+el.dataset.i;rPanel();if(EDIT)rEdit();$("#ne")?.focus()},
  "note-save":el=>{MEMORY[tgt()][+el.dataset.i]=$("#ne").value.trim()||"Empty note";S.noteEdit=null;rPanel();toast("Saved. It reads this from the next message.",{icon:"check"});if(EDIT)rEdit()},
  "note-cancel":()=>{S.noteEdit=null;rPanel();if(EDIT)rEdit()},
  "note-forget":el=>{const i=+el.dataset.i,id=EDIT?.id||S.conv,n=MEMORY[id][i];MEMORY[id].splice(i,1);AG[id].mem--;rPanel();if(EDIT)rEdit();toast("Forgotten",{icon:"trash",action:"Undo",onAction:()=>{MEMORY[id].splice(i,0,n);AG[id].mem++;rPanel();if(EDIT)rEdit()}})},
  "folder-add":el=>{const a=AG[tgt()];const have=a.dirs||[a.dir];menu(el,["#Add a folder",...FOLDERS.filter(f=>!have.includes(f.replace("~/",""))).map(f=>["folder",f,()=>{a.dirs=[...have,f.replace("~/","")];rAll();toast(`${a.name} can work in ${f}`,{icon:"folder"})}]),"hr",["plus","Choose another…",()=>pickFile(f=>{a.dirs=[...have,f.name];rAll();toast(`Added ${f.name}`,{icon:"folder"})})]])},
  "folder-rm":el=>{const a=AG[tgt()];const d=[...(a.dirs||[a.dir])];if(d.length===1)return toast("An agent needs at least one folder",{icon:"lock"});const [x]=d.splice(+el.dataset.i,1);a.dirs=d;rAll();toast(`Removed ~/${x}`,{icon:"folder",action:"Undo",onAction:()=>{a.dirs=[...d,x];rAll()}})},
  budget:el=>{const a=AG[S.conv];a.budget=Math.max(5,a.budget+ +el.dataset.v);rPanel();toast(`Daily budget: $${a.budget}`,{icon:"wallet",ms:1300})},
  "edit-agent":el=>editAgent(el.dataset.id),
  "edit-instr":el=>editAgent(el.dataset.id,"general","instr"),
  "pause-agent":el=>{const a=AG[el.dataset.id];a.paused=!a.paused;rPanel();toast(a.paused?`${a.name} paused. What it's doing finishes, the rest waits.`:`${a.name} resumed`,{icon:"pause"})},
  "lib-link":el=>toast(`Opened ${el.dataset.id} in your browser`,{icon:"ext",ms:1600}),
  "lib-file":el=>{S.panel={k:"file",id:el.dataset.id};showPanel()},
  "computer-on":()=>{S.computer=true;rPanel();toast("The agents' computer is on",{icon:"monitor"})},
  wake:()=>{S.panel.waking=1;rPanel()},
  rest:()=>{const a=AG[S.conv];a.asleep=1;a.awake=0;rPanel();rSide();toast(`${a.name} is resting`,{icon:"moon",ms:1500})},
  takeover:()=>{(S.ctrl=S.ctrl||{})[S.conv]=1;rPanel();refreshVM();toast("You're driving. The agent waits.",{icon:"hand"})},
  giveback:()=>{S.ctrl[S.conv]=0;rPanel();refreshVM();toast("Control handed back",{icon:"check",ms:1500})},
  "task-tog":el=>{const t=taskList(S.conv)[+el.dataset.i];t[1]=!t[1];rPanel()},
  "ch-add":el=>{const c=CH[S.conv],out=Object.keys(AG).filter(i=>!c.members.includes(i));if(!out.length)return toast("Everyone is already in",{ms:1300});menu(el,["#Add to #"+c.name,...out.map(i=>[null,AG[i].name,()=>{c.members.push(i);rPanel();toast(`${AG[i].name} joined #${c.name}`,{icon:"people",ms:1500})},{html:face(AG[i],22),s:AG[i].role}])],{align:"right"})},
  "member-more":el=>{const c=CH[S.conv],id=el.dataset.id;menu(el,[["star","Make lead",()=>{c.lead=id;rPanel();rTop();rSide();toast(`${AG[id].name} leads #${c.name}`,{icon:"star",ms:1500})}],["send","Open chat",()=>openConv(id)],"hr",["x","Remove from channel",()=>{if(c.members.length===1)return toast("A channel needs at least one agent",{icon:"lock"});c.members=c.members.filter(m=>m!==id);if(c.lead===id)c.lead=c.members[0];rPanel();toast(`${AG[id].name} left #${c.name}`,{icon:"people",action:"Undo",onAction:()=>{c.members.push(id);rPanel()}})},{red:true}]],{align:"right"})},
  "ch-edit":()=>channelEditor(S.conv),
  "ch-rounds":el=>{const c=CH[S.conv];menu(el,["#Rounds",...[1,2,3,4,5].map(n=>[null,String(n),()=>{c.rounds=n;rPanel()},{chk:c.rounds===n}])],{align:"right"})},
  "mute-tog":el=>{S.muted.has(S.conv)?S.muted.delete(S.conv):S.muted.add(S.conv);el.classList.toggle("on");rSide()},
  "ch-leave":()=>deleteConv(S.conv),
  "file-dl":el=>toast(`${el.dataset.id} saved to Downloads`,{icon:"download"}),
  "file-copy":()=>toast("Path copied",{icon:"copy",ms:1400}),
  "file-revise":()=>{hidePanel();const t=ta();t.value="Please revise this: ";S.drafts[S.conv]=t.value;t.focus();syncSend()},
  "pr-approve":el=>{const p=PRS.find(x=>x.id===el.dataset.id);toast(`Approved #${p.num}`,{icon:"circleok"})},
  "pr-changes":el=>{const p=PRS.find(x=>x.id===el.dataset.id);toast(`Asked ${AG[p.by].name} for changes on #${p.num}`,{icon:"reply"})},
  "pr-merge":el=>{const p=PRS.find(x=>x.id===el.dataset.id),was=p.lane;p.lane="merged";rPanel();refreshSheets();toast(`Merged #${p.num} into main`,{icon:"merge",action:"Undo",onAction:()=>{p.lane=was;rPanel();refreshSheets()}})},
  "pr-gh":()=>toast("Opened in GitHub",{icon:"ext",ms:1400}),
  "thread-send":()=>sendThread(),
  "open-versions":el=>openVersions(el.dataset.id),
  "open-logins":el=>openLogins(el.dataset.id),
  "vm-open":()=>openComputerSize(),
  "pop-screen":()=>openVM(S.conv),
});
INPUT["task-new"]=()=>{};
INPUT.thread=()=>{};
function sendThread(){
  const i=$("#thin"),v=i.value.trim();if(!v)return;const m=findMsg(S.conv,S.panel.id);(m.thread=m.thread||[]).push({from:"me",text:v,t:clock()});rPanel();
  const a=m.from==="me"?AG[isCh(S.conv)?CH[S.conv].lead:S.conv]:AG[m.from];later(1100,()=>{m.thread.push({from:a.id,text:"Noted. I'll pick it up from there.",t:clock()});if(S.panel?.k==="thread")rPanel();refreshMsg(m)});refreshMsg(m);
}
document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&e.target.id==="thin")sendThread();
  if(e.key==="Enter"&&e.target.id==="tasknew"&&e.target.value.trim()){taskList(S.conv).push([e.target.value.trim(),false]);rPanel();$("#tasknew")?.focus()}
});
