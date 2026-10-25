/* ───────── jump to ───────── */
function paletteItems(){
  const w=WORKSPACES[S.ws];const box=i=>`<span style="width:22px;display:grid;place-items:center;color:var(--ink3)">${ic(i,13)}</span>`;
  return [
    ...wsAgents().map(a=>({g:"Agents",ico:tileHTML(a,22),t:a.name,s:a.role+(a.live?" · working":""),k:"↵",go:()=>openAgent(a.id)})),
    ...w.channels.map(k=>({g:"Channels",ico:box("hash"),t:CH[k].name,s:CH[k].purpose,go:()=>{S.channel=k;S.view="channel";render()}})),
    ...INBOX.filter(x=>x.state==="open").map(x=>({g:"Needs you",ico:tileHTML(AG[x.a],22),t:x.t,s:KIND[x.kind][0].toLowerCase(),go:()=>{S.view="inbox";S.inbox=x.id;render()}})),
    ...NOTES.map((n,i)=>({g:"In memory",ico:box("doc"),t:n.t,s:n.s,go:()=>{S.agent="atlas";S.view="profile";S.ptab="memory";S.note=i;render()}})),
    ...ROUT.filter(r=>w.agents.includes(r.a)).map(r=>({g:"Routines",ico:box("clock"),t:r.name,s:`${AG[r.a].name} · ${nextText(r)}`,go:()=>{S.view="routines";render();routineEditor(R(r.id))}})),
    ...PLUGINS.filter(p=>p.on).map(p=>({g:"Plugins",ico:pmark(p,22),t:p.name,s:p.d,go:()=>{S.view="plugins";S.ptype="connected";render();pluginDrawer(p)}})),
    ...[["plus","Create agent","⌘N",()=>ACT.newagent()],["hash","New channel","",()=>{S.overlay="newch";render()}],["clock","New routine","",()=>{S.view="routines";render();routineEditor(null)}],["plug","Connect a plugin","",()=>{S.view="plugins";S.ptype="catalog";render()}],["gear","Settings","⌘,",()=>ACT.settings()],["inbox","Inbox","⌘⇧I",()=>{S.view="inbox";render()}]].map(([i,t,k,go])=>({g:"Do",ico:box(i),t,s:"",k,go})),
  ];
}
function renderPalette(){
  const w=WORKSPACES[S.ws];const all=paletteItems();
  layer.innerHTML=`<div class="veil top" data-close><div class="pal" onclick="event.stopPropagation()">
    <div class="in">${ic("search",15)}<input id="palin" placeholder="Jump to an agent, a channel, a note, an action…"><span class="kbd">ESC</span></div>
    <div class="res"></div>
    <div class="ft"><span>↑↓ move</span><span>↵ open</span><span style="margin-left:auto">${w.name}</span></div></div></div>`;
  const res=$(".res",layer),inp=$("#palin");let shown=[];
  const draw=()=>{
    const q=inp.value.toLowerCase();shown=all.filter(o=>!q||(o.t+" "+o.s).toLowerCase().includes(q));
    if(!q){const per={};shown=shown.filter(o=>(per[o.g]=(per[o.g]||0)+1)<=4)}
    let g="";res.innerHTML=shown.map((o,i)=>{const head=o.g!==g?`<div class="g">${o.g}</div>`:"";g=o.g;return head+`<div class="o ${i?"":"on"}" data-o="${i}">${o.ico}<span style="flex:none">${o.t}</span><span class="s">${o.s}</span><span class="k">${o.k||""}</span></div>`}).join("")||`<div style="padding:24px;text-align:center;color:var(--ink3)">Nothing called “${esc(inp.value)}”. <span class="lnk" data-mk>Create an agent with that name</span></div>`;
    $$("[data-o]",res).forEach(el=>{el.onclick=()=>run(+el.dataset.o);el.onmousemove=()=>{$$(".o.on",res).forEach(x=>x.classList.remove("on"));el.classList.add("on")}});
    const mk=$("[data-mk]",res);if(mk)mk.onclick=()=>{S.overlay=null;ACT.newagent();DRAFT.name=inp.value;render()};
  };
  const run=i=>{S.overlay=null;layer.innerHTML="";shown[i]?.go()};
  inp.oninput=draw;
  inp.onkeydown=e=>{
    const its=$$("[data-o]",res);let i=its.findIndex(x=>x.classList.contains("on"));
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();its[i]?.classList.remove("on");i=(i+(e.key==="ArrowDown"?1:-1)+its.length)%its.length;its[i]?.classList.add("on");its[i]?.scrollIntoView({block:"nearest"})}
    if(e.key==="Enter"&&i>=0){e.preventDefault();run(+its[i].dataset.o)}
  };
  draw();setTimeout(()=>inp.focus(),0);bindClose();
}

/* ───────── new agent / edit look ───────── */
const TEMPLATES={Blank:{},Developer:{role:"Dev",kind:"fox",color:"#e2814a",instr:"Você é dev sênior no meu time. Escreva o mínimo de código que resolve, rode os testes antes de me mostrar e explique só o que não for óbvio."},Researcher:{role:"Research",kind:"frog",color:"#55b884",instr:"Pesquise com fontes. Três boas valem mais que dez fracas. Sempre cite o link."},Writer:{role:"Content",kind:"ghost",color:"#4fb0c4",instr:"Escreva no tom da Hyze: direto, técnico, sem hype. Frases curtas."},Reviewer:{role:"Review",kind:"cat",color:"#6a8cf0",instr:"Revise PRs procurando bug e risco, não estilo. Comente só o que bloquear o merge."},Strategist:{role:"Strategy",kind:"owl",color:"#9a87ea",instr:"Pense como cofundador: números antes de opinião, diga quando eu estiver errado e termine sempre com uma recomendação."}};
const freshDraft=()=>({edit:null,name:"",role:"",kind:"owl",color:"#9a87ea",template:"Blank",cli:"Claude",perm:"auto",dir:"~/Projects/hyze-cloud",instr:""});
let DRAFT=freshDraft();
function renderNew(){
  const D=DRAFT;const ed=D.edit?AG[D.edit]:null;const keep=$(".na .nbody")?.scrollTop||0;
  const sec=(t,html,hint="")=>`<section class="nsec"><div class="nsh"><b>${t}</b>${hint?`<span>${hint}</span>`:""}</div>${html}</section>`;
  layer.innerHTML=`<div class="veil" data-close><div class="na" onclick="event.stopPropagation()">
    <div class="nb"><canvas id="nabanner"></canvas><button class="dice" data-dice>${ic("dice",13)} Shuffle look</button>
      <div class="nf">${tileHTML({id:"draft"+D.kind+D.color,kind:D.kind,color:D.color},88)}</div></div>
    <div class="nh"><div style="min-width:0"><h2 data-dn>${esc(D.name)||(ed?ed.name:"New agent")}</h2><div class="lead" data-dr>${esc(D.role)||(ed?"Its chat, memory and folder stay as they are":"Joins "+WORKSPACES[S.ws].name)}</div></div>
      ${ed?"":`<span class="nstep">${cliMark(D.cli,13)} ${D.cli} · ${PERM[D.perm][0]}</span>`}</div>
    <div class="nbody">
      ${ed?"":sec("Start from",`<div class="temps">${Object.keys(TEMPLATES).map(t=>`<button class="${t===D.template?"on":""}" data-t="${t}">${t}</button>`).join("")}</div>`,"Fills the role, look and instructions")}
      ${sec("Who it is",`<div class="row2 even"><label><div class="fl">Name</div><input class="fld" data-f="name" placeholder="Atlas" value="${esc(D.name)}"></label><label><div class="fl">What it does</div><input class="fld" data-f="role" placeholder="Strategy, pricing, numbers" value="${esc(D.role)}"></label></div>
        <div class="looks"><div class="faces2">${Object.keys(HEADS).map(k=>`<button class="${k===D.kind?"on":""}" data-k="${k}" title="${k}">${head(k,D.color,24)}</button>`).join("")}</div><span class="vsep"></span><div class="sw">${COLORS.map(c=>`<button class="${c===D.color?"on":""}" data-c="${c}" style="background:${c}"></button>`).join("")}</div></div>`)}
      ${ed?"":sec("Where it runs",`<div class="clis">${[["Claude","Sonnet 5.5"],["Codex","GPT-6.1"],["OpenCode","Muse 1.3"]].map(([n,x])=>`<div class="cli ${n===D.cli?"on":""}" data-cli="${n}"><div class="t">${cliMark(n,15)}${n}${n===D.cli?`<span class="c">${ic("check",10,"#111",3)}</span>`:""}</div><div class="s">${x} · ${n==="OpenCode"?"free models":"signed in"}</div></div>`).join("")}</div>
        <div class="row2 even" style="margin-top:12px"><div><div class="fl">Works in</div><button class="fld" data-folder style="display:flex;align-items:center;gap:8px;text-align:left">${ic("folder",14)}<span class="mono" style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${D.dir}</span>${ic("down",13)}</button></div>
          <div><div class="fl">Can do</div><div class="seg" style="width:100%;display:flex">${ORDER.map(k=>`<button data-perm="${k}" class="${k===D.perm?"on":""}" style="flex:1;justify-content:center" title="${PERM[k][1]}">${PERM[k][0]}</button>`).join("")}</div></div></div>
        <div class="fl" style="margin:8px 0 0;font-weight:400;color:var(--ink4)" data-pd>${PERM[D.perm][1]}. Merges and deploys always ask you.</div>`)}
      ${ed?"":sec("How it works",`<textarea class="fld" data-f="instr" style="height:96px;resize:none;line-height:1.6" placeholder="How it should think and answer. You can change this any time.">${esc(D.instr)}</textarea>`,"Its instructions")}
    </div>
    <div class="nfoot"><button class="btn ghost" data-close>Cancel</button><button class="btn solid" data-create>${ed?"Save":`${ic("spark",14)} Create and say hello`}</button></div>
  </div></div>`;
  $(".na .nbody").scrollTop=keep;
  dither(nabanner,D.color,D.kind+D.color,{cols:150,rows:28,light:.8});
  $$("[data-f]",layer).forEach(i=>i.oninput=()=>{D[i.dataset.f]=i.value;if(i.dataset.f==="name")$("[data-dn]",layer).innerHTML=esc(i.value)||(D.edit?AG[D.edit].name:"New agent");if(i.dataset.f==="role")$("[data-dr]",layer).innerHTML=esc(i.value)||"Joins "+WORKSPACES[S.ws].name});
  $$("[data-k]",layer).forEach(b=>b.onclick=()=>{D.kind=b.dataset.k;renderNew()});
  $$("[data-c]",layer).forEach(b=>b.onclick=()=>{D.color=b.dataset.c;renderNew()});
  $$("[data-t]",layer).forEach(b=>b.onclick=()=>{const t=TEMPLATES[b.dataset.t];D.template=b.dataset.t;Object.assign(D,{role:t.role??D.role,kind:t.kind??D.kind,color:t.color??D.color,instr:t.instr??D.instr});renderNew()});
  $$("[data-cli]",layer).forEach(b=>b.onclick=()=>{D.cli=b.dataset.cli;renderNew()});
  $$("[data-perm]",layer).forEach(b=>b.onclick=()=>{D.perm=b.dataset.perm;renderNew()});
  const fb=$("[data-folder]",layer);if(fb)fb.onclick=()=>folderPicker(p=>{D.dir=p;renderNew()});
  $("[data-dice]",layer).onclick=()=>{const k=Object.keys(HEADS);D.kind=k[Math.floor(Math.random()*k.length)];D.color=COLORS[Math.floor(Math.random()*COLORS.length)];renderNew()};
  $("[data-create]",layer).onclick=createAgent;
  bindClose();
  setTimeout(()=>$("[data-f=name]",layer)?.focus(),0);
}
function createAgent(){
  const D=DRAFT;
  if(!D.name.trim()){const i=$("[data-f=name]",layer);i.focus();i.style.borderColor="var(--red)";return}
  if(D.edit){const a=AG[D.edit];Object.assign(a,{name:D.name.trim(),role:D.role.trim()||a.role,kind:D.kind,color:D.color});delete CHATS[a.id];S.overlay=null;render();toast(`${a.name} has a new look`,{icon:"smile"});return}
  let id=D.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g,"")||"agent";while(AG[id])id+="2";
  const a=AG[id]={id,name:D.name.trim(),role:D.role.trim()||"Generalist",kind:D.kind,color:D.color,cli:D.cli,model:MODELS[D.cli][1]||MODELS[D.cli][0],effort:"Medium",dir:D.dir.replace(/^~\/Projects\//,""),line:"Say hello…",when:now(),perm:D.perm};
  WORKSPACES[S.ws].agents.push(id);S.agent=id;S.view="chat";S.overlay=null;DRAFT=freshDraft();
  CHATS[id]=`<div class="day">TODAY</div>`;render();
  const col=$("#feed .col");col.insertAdjacentHTML("beforeend",`<div class="msg" id="hello" style="--tint:${a.color}">${tileHTML(a,36)}<div><div class="who"><span class="n">${a.name}</span><span class="t">reading its instructions</span></div><span class="typing"><i></i><i></i><i></i></span></div></div>`);
  setTimeout(()=>{const h=document.getElementById("hello");const msg=them(a,now(),`<div class="body"><p>Oi, ${ME.name}! Sou ${a.name}, ${a.role.toLowerCase()} da ${WORKSPACES[S.ws].name}. Já li o contexto do workspace e as minhas instruções.</p><p>Por onde você quer que eu comece?</p></div>`);
    if(h){h.outerHTML=msg;save()}else CHATS[id]+=msg;a.line="Oi! Por onde você quer que eu comece?";renderSide()},1600);
}
const FOLDER_CHOICES=["~/Projects/hyze-cloud","~/Projects/api-node","~/Projects/site","~/Projects/research","~/Projects/blog","~/Documents"];
function folderPicker(cb){
  const m=modal(`<div><h2>Where it works</h2><div class="lead">The agent reads and writes inside this folder. You can't move it later.</div></div>
    <div>${FOLDER_CHOICES.map(f=>`<div class="pop" style="position:static;box-shadow:none;border:0;padding:0;animation:none;background:none;max-width:none"><div class="it" data-fp="${f}">${ic("folder",13)}<span class="mono" style="font-size:12px">${f}</span></div></div>`).join("")}</div>
    <div class="foot"><button class="btn" data-other style="margin-right:auto">Choose another…</button><button class="btn" data-x>Cancel</button></div>`);
  $$("[data-fp]",m).forEach(el=>el.onclick=()=>{closeModal();cb(el.dataset.fp)});
  $("[data-other]",m).onclick=()=>{const i=document.createElement("input");i.type="file";i.webkitdirectory=true;i.onchange=()=>{const f=i.files[0];const dir=f?f.webkitRelativePath.split("/")[0]:null;closeModal();if(dir)cb("~/"+dir)};i.click()};
}

/* ───────── new channel ───────── */
function renderNewChannel(){
  const w=WORKSPACES[S.ws];const ed=S.chedit?CH[S.chedit]:null;
  const sel=new Set(ed?ed.members:["atlas","mila","leo"].filter(k=>w.agents.includes(k)));let lead=ed?.lead||[...sel][0];
  layer.innerHTML=`<div class="veil" data-close><div class="dlg" style="width:640px" onclick="event.stopPropagation()"><div class="form">
    <div><h2>${ed?"Edit #"+ed.name:"New channel"}</h2><div class="lead">A room where you and a few agents work on one thing together.</div></div>
    <div><div class="fl">Name</div><div class="fld big" style="display:flex;gap:6px"><span style="color:var(--ink4)">#</span><input data-cn value="${ed?ed.name:""}" placeholder="launch" style="flex:1;min-width:0"></div></div>
    <div><div class="fl">What it's for</div><input class="fld" data-cp value="${ed?esc(ed.purpose):""}" placeholder="Lançamento do plano Pro em 30/10."></div>
    <div><div class="fl">Agents in it</div><div class="pick">${w.agents.map(k=>{const a=AG[k];const on=sel.has(k);return`<button class="${on?"on":""}" data-pk="${k}">${tileHTML(a,26)}<span>${a.name}<em>${a.role}</em></span><span class="c">${on?ic("check",10):""}</span></button>`}).join("")}</div></div>
    <div><div class="fl">Who answers</div><div class="modes">
      <div class="on"><b>Who you mention</b><span>@name picks who answers. Nobody else speaks.</span></div>
      <div><b>Everyone, in turns</b><span>Each agent answers once per round.</span></div>
      <div><b>The lead decides</b><span>One agent reads every message and hands it on.</span></div></div></div>
    <div class="row2 even"><div><div class="fl">Lead</div><div class="seg" data-leads></div></div><div><div class="fl">Rounds per message</div><div class="seg" data-seg="none">${[1,2,3].map(n=>`<button data-rn="${n}" class="${(ed?.rounds||3)===n?"on":""}">${n}</button>`).join("")}</div></div></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn solid" data-mk>${ed?"Save":"Create channel"}</button></div>
  </div></div></div>`;
  const leads=()=>{if(!sel.has(lead))lead=[...sel][0];$("[data-leads]",layer).innerHTML=[...sel].map(k=>`<button data-ld="${k}" class="${k===lead?"on":""}">${AG[k].name}</button>`).join("")||`<span style="color:var(--ink4);padding:0 8px;line-height:26px">Pick an agent</span>`;$$("[data-ld]",layer).forEach(b=>b.onclick=()=>{lead=b.dataset.ld;leads()})};leads();
  $$("[data-pk]",layer).forEach(b=>b.onclick=()=>{const k=b.dataset.pk;sel.has(k)?sel.delete(k):sel.add(k);b.classList.toggle("on",sel.has(k));b.querySelector(".c").innerHTML=sel.has(k)?ic("check",10):"";leads()});
  $$(".modes div",layer).forEach(d=>d.onclick=()=>{$$(".modes div",layer).forEach(x=>x.classList.remove("on"));d.classList.add("on")});
  $("[data-mk]",layer).onclick=()=>{
    const name=$("[data-cn]",layer).value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,"-");
    if(!name){$("[data-cn]",layer).focus();return}if(!sel.size)return toast("Pick at least one agent",{icon:"people"});
    const rounds=+($("[data-rn].on",layer)?.dataset.rn||3);const purpose=$("[data-cp]",layer).value||"No purpose yet.";
    if(ed&&ed.name!==name){CH[name]=ed;delete CH[S.chedit];w.channels[w.channels.indexOf(S.chedit)]=name;if(CHATS["#"+S.chedit]){CHATS["#"+name]=CHATS["#"+S.chedit]}}
    if(!ed&&CH[name])return toast(`#${name} already exists`);
    CH[name]=Object.assign(CH[name]||{},{name,purpose,members:[...sel],lead,rounds});if(!ed)w.channels.push(name);
    S.chedit=null;S.channel=name;S.view="channel";S.overlay=null;render();toast(ed?"Saved":`#${name} is open. @mention someone to start.`,{icon:"hash"});
  };
  bindClose();
}

/* ───────── settings ───────── */
const CLIS={Claude:{ver:"2.1.304",path:"/opt/homebrew/bin/claude",acct:"you@example.com · Max",via:"ACP · claude-agent-acp 0.94.0",upd:""},Codex:{ver:"0.142.0",path:"/opt/homebrew/bin/codex",acct:"you@example.com · Plus",via:"ACP · codex-acp 2.2.2",upd:"0.143.1"},OpenCode:{ver:"1.19.0",path:"~/.opencode/bin/opencode",acct:"",via:"ACP · opencode acp",upd:""}};
const MORE_CLIS={Gemini:{note:"Over ACP.",installed:false},Cursor:{note:"cursor-agent acp.",installed:false}};
const SHORTS=[["Jump to","⌘K"],["Create agent","⌘N"],["Inbox","⌘⇧I"],["Settings","⌘,"]];
let THEME="Dark";
function renderSettings(){
  const w=WORKSPACES[S.ws];const top=$(".set section")?.scrollTop||0;
  const navs=[["Account",[["profile","Profile","user"],["prefs","Preferences","gear"]]],[w.name,[["workspace","Workspace","inbox"],["defaults","Agent defaults","people"],["usage","Usage & limits","usage"]]],["App",[["clis","CLIs","term"]]]];
  const page={profile:profilePage,prefs:prefsPage,workspace:()=>wsPage(w),defaults:defaultsPage,usage:usagePage,clis:clisPage}[S.settings]();
  layer.innerHTML=`<div class="veil" data-close><div class="set" onclick="event.stopPropagation()">
    <nav>${navs.map(([h,items])=>`<div class="h">${h}</div>${items.map(([k,n,i])=>`<a class="${S.settings===k?"on":""}" data-p="${k}">${ic(i,13)} ${n}</a>`).join("")}`).join("")}
      <div style="margin-top:auto;padding:10px;font-size:11.5px;color:var(--ink4)">hz 0.21.0 · esc to close</div></nav>
    <section>${page}</section></div></div>`;
  $(".set section").scrollTop=top;
  $$("[data-p]",layer).forEach(a=>a.onclick=()=>{S.settings=a.dataset.p;$(".set section").scrollTop=0;renderSettings();$(".set section").scrollTop=0});
  $$("[data-k]",layer).forEach(b=>b.onclick=()=>{ME.kind=b.dataset.k;ME.photo=null;renderSide();renderSettings()});
  $$("[data-c]",layer).forEach(b=>b.onclick=()=>{ME.color=b.dataset.c;renderSide();renderSettings()});
  const bindIn=(sel,fn)=>{const i=$(sel,layer);if(i)i.oninput=()=>fn(i.value)};
  bindIn("[data-me-name]",v=>{ME.name=v||"You";renderSide()});
  bindIn("[data-me-calls]",v=>ME.calls=v);
  bindIn("[data-ws-name]",v=>{w.name=v||"Workspace";w.mark=(v[0]||"W").toUpperCase();renderSide();$(".set nav .h:nth-of-type(2)",layer).textContent=w.name});
  bindIn("[data-ws-ctx]",v=>w.ctx=v);
  bindClose();
}
const row=(b,s,ctl,col)=>`<div class="prow"><div class="lab"><b>${b}</b>${s?`<span>${s}</span>`:""}</div><div class="ctl ${col?"col":""}">${ctl}</div></div>`;
const seg=(items,on,key="")=>`<div class="seg" ${key?`data-seg="${key}"`:""}>${items.map((x,i)=>`<button data-v="${x}" class="${(typeof on==="number"?i===on:x===on)?"on":""}">${x}</button>`).join("")}</div>`;
const tog=on=>`<span class="tog ${on?"on":""}"></span>`;
const numIn=(v,w=110)=>`<input class="fld mono" value="${v}" style="width:${w}px;padding:6px 10px">`;
function profilePage(){
  return `<h2>Profile</h2><div class="lead">How you appear to your agents and in every chat.</div>
  ${row("Avatar","A face from the same family as your agents, or a photo.",`<div class="avpick">${meTile(72)}
      <div style="display:flex;flex-direction:column;gap:8px"><div class="heads" style="grid-template-columns:repeat(8,30px)">${Object.keys(HEADS).map(k=>`<button class="${k===ME.kind&&!ME.photo?"on":""}" data-k="${k}">${head(k,ME.color,20)}</button>`).join("")}</div>
      <div class="sw">${COLORS.map(c=>`<button class="${c===ME.color?"on":""}" data-c="${c}" style="background:${c};width:18px;height:18px"></button>`).join("")}<button class="btn sm" data-act="photo" style="margin-left:8px">${ic("up2",11)} Upload photo</button>${ME.photo?`<button class="btn sm" data-act="photorm">Remove</button>`:""}</div></div></div>`)}
  ${row("Name","What the chat shows beside your messages.",`<input class="fld" data-me-name value="${esc(ME.name)}">`)}
  ${row("What agents call you","Put in every agent's briefing.",`<input class="fld" data-me-calls value="${esc(ME.calls)}">`)}
  ${row("Language","The one agents answer in unless told otherwise.",seg(["Português","English","Español"],0))}
  ${row("Status","Agents hold “needs you” pings while you are away.",seg(Object.keys(STATUS),ME.status,"status"))}`;
}
function prefsPage(){
  const th=(n,bg,a,b)=>`<div class="${THEME===n?"on":""}" data-act="theme" data-v="${n}"><div class="pv" style="background:${bg}"><i style="width:28%;background:${a}"></i><i style="flex:1;background:${b}"></i></div><div class="lb">${n}</div></div>`;
  return `<h2>Preferences</h2><div class="lead">How hz looks and behaves on this Mac.</div>
  <h5>Appearance</h5>
  ${row("Theme","",`<div class="theme">${th("Dark","#0b0b0b","#141414","#101010")}${th("Light","#f4f3ef","#e3e2dd","#ffffff")}${th("System","linear-gradient(90deg,#0b0b0b 50%,#f4f3ef 50%)","#1c1c1c","#d8d7d2")}</div>`)}
  ${row("Density","Comfortable spaces messages out. Compact fits more on screen.",seg(["Comfortable","Compact"],0,"density"))}
  ${row("Text size","",seg(["13","14","15","16"],1,"textsize"))}
  ${row("Living faces","Blinks, the working pill and the dither shimmer.",tog(1))}
  <h5>Chat</h5>
  ${row("Send with","",seg(["⏎ Enter","⌘ ⏎"],0))}
  ${row("Show steps while working","The live checklist under a message in progress.",tog(1))}
  ${row("Open “See what it did”","Show an agent's steps expanded once it finishes.",tog(0))}
  ${row("Clock","",seg(["24h","12h"],0))}
  <h5>Notifications</h5>
  ${row("An agent needs you","Approvals and questions.",seg(["Banner and sound","Banner","Off"],0))}
  ${row("An agent finishes","",seg(["Banner","Badge only","Off"],1))}
  ${row("Mentions in channels","",seg(["Banner","Badge only","Off"],0))}
  ${row("Quiet hours","No banners between these times.",`${tog(1)}<input class="fld mono" value="22:00 – 08:00" style="width:130px;padding:6px 10px">`)}
  ${row("Try it","",`<button class="btn sm" data-act="testnote">${ic("bell",11)} Send a test notification</button>`)}
  <h5>Shortcuts</h5><div style="font-size:12px;color:var(--ink3);margin-top:6px">Click a shortcut, then press the new keys.</div>
  ${SHORTS.map(([n,k],i)=>row(n,"",`<span class="kbd" data-act="rebind" data-i="${i}" style="cursor:pointer;padding:4px 8px;font-size:11px">${k}</span>`)).join("")}`;
}
function wsPage(w){
  return `<h2>Workspace</h2><div class="lead">A workspace is a team of agents. ${w.name}'s agents are not ${WORKSPACES.find(x=>x!==w)?.name||"another workspace"}'s.</div>
  ${row("Logo","Shown on the switcher and at the top of every agent's briefing.",`<div class="avpick">${logoHTML(w,72)}<div style="display:flex;gap:8px"><button class="btn" data-act="wslogo">${ic("up2",12)} Upload image</button><button class="btn" data-act="wsgen">${ic("dice",12)} Generate</button>${w.photo?`<button class="btn" data-act="wslogorm">Remove</button>`:""}</div></div>`)}
  ${row("Name","",`<input class="fld" data-ws-name value="${esc(w.name)}">`)}
  ${row("Context","Goes before every agent's own instructions, in every conversation.",`<textarea class="fld" data-ws-ctx style="height:96px;resize:none;line-height:1.55" placeholder="What this team works on, the stack, who the customers are.">${esc(w.ctx)}</textarea>`)}
  ${row("Members","People who can talk to these agents.",`<div class="memb">${meTile(28)}<div><div>${ME.name}</div><div class="s">Owner</div></div></div>${w.members.map((m,i)=>`<div class="memb"><span style="width:28px;height:28px;border-radius:8px;border:1px dashed var(--line3);display:grid;place-items:center;color:var(--ink3)">${ic("user",12)}</span><div><div>${m}</div><div class="s">Invited · pending</div></div><button class="btn sm" data-act="uninvite" data-i="${i}" style="margin-left:auto">Revoke</button></div>`).join("")}<div><button class="btn sm" data-act="invite">${ic("plus",11)} Invite</button></div>`,1)}
  <div class="danger"><div><b>Delete workspace</b><span>Its agents and their memory go with it. Conversations stay on disk.</span></div><button class="btn bad" data-act="wsdel">Delete</button></div>`;
}
function defaultsPage(){
  return `<h2>Agent defaults</h2><div class="lead">What a new agent in this workspace starts with. Each agent can change its own.</div>
  <h5>New agents</h5>
  ${row("Runs on","",`<div class="clis" style="width:100%">${[["Claude","Sonnet 5.5"],["Codex","GPT-6.1"],["OpenCode","Muse 1.3"]].map(([n,s])=>`<div class="cli ${n===DRAFT.cli?"on":""}" data-act="defcli" data-v="${n}"><div class="t">${cliMark(n)}${n}</div><div class="s">${s}</div></div>`).join("")}</div>`)}
  ${row("Can do","How far a new agent goes before it asks.",seg(ORDER.map(k=>PERM[k][0]),PERM[DRAFT.perm][0],"defperm"))}
  ${row("Folder","Where a new agent works unless you pick another.",`<button class="fld mono" data-act="deffolder" style="font-size:12px;text-align:left;display:flex;gap:8px;align-items:center">${ic("folder",12)}${DRAFT.dir}</button>`)}
  ${row("Say hello on create","The agent introduces itself in its first message.",tog(1))}
  <h5>Memory</h5>
  ${row("Tidy memory at night","Agents merge duplicate notes and drop stale ones while you sleep.",`${tog(1)}<input type="time" class="fld mono" value="03:00" style="width:110px;padding:6px 10px">`)}
  ${row("Shared memory","Notes every agent in the workspace can read.",tog(1))}
  <h5>Working together</h5>
  ${row("Hand-offs per request","How many times one request can be passed on before it stops.",seg(["4","8","12"],1))}
  ${row("Wait for an answer","How long an agent waits when it asks another.",seg(["2 min","10 min","30 min"],1))}
  ${row("When a CLI hits its limit","",seg(["Wait","Move to Codex","Ask me"],2))}`;
}
function usagePage(){
  const bar=(pct,warn)=>`<div class="track">${Array.from({length:30},(_,i)=>`<i class="${i<Math.round(pct*30)?(warn?"warn":"on"):""}"></i>`).join("")}</div>`;
  const spend=[["ada",21.9],["atlas",12.4],["mila",6.1],["leo",4.8],["hugo",2.3]];
  return `<h2>Usage & limits</h2><div class="lead">What your agents spend, and how close each CLI is to its plan's limit.</div>
  <div class="limit" style="--tint:#d97757"><div class="h">${cliMark("Claude",18)}<b>Claude</b><span class="s">Max</span><span class="rt">window resets in 2h 41m</span></div>
    <div class="rows"><div class="lr"><span class="lb">5-hour window</span>${bar(.62)}<span class="p">62%</span></div><div class="lr"><span class="lb">This week</span>${bar(.18)}<span class="p">18%</span></div><div class="lr"><span class="lb">Opus this week</span>${bar(.84,1)}<span class="p" style="color:var(--amber)">84%</span></div></div></div>
  <div class="limit" style="--tint:#ecebe7"><div class="h">${cliMark("Codex",18)}<b>Codex</b><span class="s">Plus</span><span class="rt">resets Friday</span></div>
    <div class="rows"><div class="lr"><span class="lb">5-hour window</span>${bar(.34)}<span class="p">34%</span></div><div class="lr"><span class="lb">This week</span>${bar(.41)}<span class="p">41%</span></div></div></div>
  <div class="limit"><div class="h">${cliMark("OpenCode",18)}<b>OpenCode</b><span class="s">Free models</span><span class="rt">no limit reported</span></div></div>
  <h5>Spend this month · US$ 47.50</h5>
  <div class="spendbars">${spend.map(([k,v])=>{const a=AG[k];return`<div class="sb" data-act="openaccess" data-id="${k}" style="cursor:pointer">${tileHTML(a,20)}<span class="nm">${a.name}</span><span class="tr">${Array.from({length:50},(_,i)=>`<i style="flex:1;background:${i<Math.round(v/25*50)?a.color:"#1c1c1c"}"></i>`).join("")}</span><span class="v">US$ ${v.toFixed(2)}</span></div>`}).join("")}</div>
  <h5>Limits</h5>
  ${row("Workspace budget","When the month reaches it.",`${numIn("US$ 150")}${seg(["Pause agents","Ask me","Keep going"],1)}`)}
  ${row("Alert at","",seg(["50%","80%","95%"],1))}
  ${row("One task may cost at most","Above this an agent stops and asks.",numIn("US$ 2.00"))}
  ${row("Export","Every call this month, with agent, CLI and cost.",`<button class="btn sm" data-act="exportcsv">${ic("out",11)} Download CSV</button>`)}`;
}
function clisPage(){
  const cli=n=>{const c=CLIS[n];return `<div class="clirow"><span class="lg">${cliMark(n,20)}</span><div class="b"><div style="display:flex;align-items:center;gap:8px"><b>${n}</b><span class="okc" style="color:${c.acct?"var(--green)":"var(--ink3)"};background:${c.acct?"#59b37f1a":"#1d1d1d"}">${c.acct?"Signed in":"Ready"}</span>${c.upd?`<span class="okc" style="color:var(--amber);background:#d9a4411a">${c.upd} available</span>`:""}</div>
      <div class="meta"><span>Version</span><code>${c.ver}</code><span>Path</span><code>${c.path}</code><span>Account</span><code>${c.acct||"—"}</code><span>Talks over</span><code>${c.via}</code></div></div>
    <div class="rt">${c.upd?`<button class="btn sm solid" data-act="cliupd" data-n="${n}">Update</button>`:`<button class="btn sm" data-act="clicheck" data-n="${n}">Check</button>`}<button class="btn sm" data-act="clisign" data-n="${n}">${c.acct?"Sign out":"Sign in"}</button></div></div>`};
  return `<h2>CLIs</h2><div class="lead">The coding agents your agents run on. hz uses your own install and your own login, and never holds your keys.</div>
  ${Object.keys(CLIS).map(cli).join("")}
  ${Object.keys(MORE_CLIS).length?`<h5>More agents</h5>${Object.entries(MORE_CLIS).map(([n,c])=>`<div class="clirow dim"><span class="lg" style="font-family:var(--pix);font-size:11px">${n[0]}</span><div class="b"><b>${n}</b><div style="font-size:12px;color:var(--ink3);margin-top:4px">${c.note} Not installed.</div></div><div class="rt"><button class="btn sm" data-act="cliinstall" data-n="${n}">Install</button></div></div>`).join("")}`:""}
  <h5>Behaviour</h5>
  ${row("Check for updates","Once a day. hz never updates a CLI without asking.",tog(1))}
  ${row("Warm up","Start the agent you are about to message while you type.",tog(1))}`;
}
