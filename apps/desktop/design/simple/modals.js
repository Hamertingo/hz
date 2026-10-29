/* modals: Edit agent (General / Routines / Access), New agent, channel editor. */
let EDIT=null;
const cmdOf=a=>CMD[a.cmd||S.cmd];
function editAgent(id,tab="general",page=null){
  closePop();EDIT={id,tab,page};
  EDIT.v=veil(`<div></div>`,{width:580,cls:"edit"});EDIT.v.onclose=()=>{EDIT=null};rEdit();
}
function rEdit(){
  const E=EDIT;if(!E)return;const a=AG[E.id],m=mdlOf(E.v),sc=$(".mb",m)?.scrollTop||0;
  let body="";
  if(E.page){
    const back=`<button class="btn ghost sm" data-act="edit-page" data-p="" style="margin:0 0 6px -8px">${ic("chevl",15)} ${esc(a.name)}</button>`;
    const P={
      instr:()=>`${back}${Section("Instructions",{cls:"lg"})}${Field({area:true,rows:12,in:"e-instr",id:"instr",value:a.instr||`You are ${a.name}, the ${a.role.toLowerCase()} agent for ${WS[S.ws].name}.\n\nHow you work:\n- Keep answers short and say the risk last.\n- Ask before anything that costs money or can't be undone.\n- Write what you learn to memory.`})}${Hint(`Saved as you type. ${a.name} reads it from the next message.`)}`,
      skills:()=>`${back}${Section("Skills",{cls:"lg",count:`${SKILLS.filter(s=>a["sk_"+s.n]??s.on).length} on`})}${Group(SKILLS.map(s=>Row({icon:"bolt",title:s.n,right:toggle(s.n,a["sk_"+s.n]??s.on,"agent-skill")})).join(""))}`,
      memory:()=>`${back}${Section("Memory",{cls:"lg",count:(MEMORY[a.id]||[]).length,action:"Add note",actionAct:"note-add"})}${Group((MEMORY[a.id]||[]).map((n,i)=>noteHTML(n,i,a)).join("")||`<div class="note dim">Nothing remembered yet.</div>`)}`,
      computer:()=>`${back}${Section("Computer",{cls:"lg"})}${Group([["monitor","See the screen"],["term","Use the keyboard and mouse"],["folder","Read and write files in its folders"],["globe","Browse the web"]].map(([i,n],k)=>Row({icon:i,title:n,right:tog("c"+k,k!==3||a.cli!=="OpenCode")})).join(""))}`,
      apps:()=>`${back}${Section("Connected apps",{cls:"lg"})}${Group(PLUGINS.filter(p=>p.on).map(p=>Row({lead:brand(p.id,34),title:p.name,sub:p.desc,right:toggle(p.id,p.grants.includes(a.id),"grant-me")})).join("")||`<div class="note dim">Nothing is connected yet.</div>`)}<div class="btnrow">${Btn("Connect more apps",{act:"plugins",icon:"plug"})}</div>`,
      folders:()=>`${back}${Section("Folders",{cls:"lg"})}${Group((a.dirs||[a.dir]).map(d=>Row({icon:"folder",title:"~/"+d.replace("~/","")})).join("")+Row({icon:"plus",title:"Add a folder",act:"folder-add"}))}`,
    };
    body=P[E.page]();
  }else if(E.tab==="general"){
    const sk=SKILLS.filter(s=>a["sk_"+s.n]??s.on).length;
    body=`${Section("Profile")}${Group(Row({icon:"user",title:"Name",right:`<input class="inl" data-in="e-name" value="${esc(a.name)}">`})+Row({icon:"flag",title:"Role",right:`<input class="inl" data-in="e-role" value="${esc(a.role)}">`})+Row({icon:"smile",title:"Look",right:Next(face(a,24)),act:"edit-look",id:a.id}))}
    ${Section("How it works")}${Group(Row({icon:"doc",title:"Instructions",sub:esc((a.instr||`${a.role} agent for ${WS[S.ws].name}`).split("\n")[0].slice(0,60)),act:"edit-page",k:"instr",right:Next()})+Row({icon:"cpu",title:"Engine",right:Down(ENG[a.cli]),act:"p-engine"})+Row({icon:"spark",title:"Model",right:Down(a.model),act:"p-model"})+Row({icon:"brain",title:"Effort",right:Down(a.effort),act:"p-effort"})+Row({icon:"bolt",title:"Skills",right:Next(sk),act:"edit-page",k:"skills"})+Row({icon:"book",title:"Memory",right:Next((MEMORY[a.id]||[]).length),act:"edit-page",k:"memory"}))}
    ${Section("Queue")}${Group(Row({icon:"pause",title:`Pause ${esc(a.name)}`,sub:"What it's doing finishes, the rest waits.",right:toggle(a.id,a.paused,"pause-tog")})+`<div class="note dim">${a.paused?`${a.name} is paused. Routines and messages wait here.`:`Nothing waiting. Routines and messages from other agents show up here while ${a.name} is busy or paused.`}</div>`)}`;
  }else if(E.tab==="routines"){
    const rts=ROUTINES.filter(r=>r.agent===a.id);
    body=`${Section("Routines",{cls:"lg",count:rts.length,action:"New routine",actionAct:"routine-new-e"})}${Group(rts.map(r=>Row({icon:"clock",title:esc(r.title),sub:when(r),right:toggle(r.id,r.on,"rt-tog"),act:"routine-edit",id:r.id,tag:"div"})).join("")||Empty(`No routines for ${a.name} yet.`,{action:Btn("New routine",{act:"routine-new-e",icon:"plus",size:"sm"})}))}`;
  }else{
    const n=PLUGINS.filter(p=>p.on).length,k=PLUGINS.filter(p=>p.on&&p.grants.includes(a.id)).length;
    body=`${Section("What it can reach")}${Group(Row({icon:"monitor",title:"Computer",right:Next(S.computer?"All allowed":"Off"),act:"edit-page",k:"computer"})+Row({icon:"term",title:"Commands",right:Down(cmdOf(a)),act:"agent-cmd"})+Row({icon:"app",title:"Connected apps",right:Next(`${k} of ${n}`),act:"edit-page",k:"apps"})+Row({icon:"folder",title:"Folders",right:Next((a.dirs||[a.dir]).length),act:"edit-page",k:"folders"})+Row({icon:"globe",title:"Browser logins",right:Next(LOGINS.length),act:"open-logins",id:a.id}))}
    ${Section("Permission")}${Group(Row({icon:"shield",title:PERM[a.perm][0],sub:PERM[a.perm][1],right:Down("Change"),act:"agent-perm"}))}`;
  }
  m.innerHTML=`${Head(`Edit ${esc(a.name)}`,{lead:face(a,44),right:Btn("Done",{act:"close-veil",kind:"primary"}),close:false})}${E.page?"":Tabs([["general","General"],["routines","Routines"],["access","Access"]],E.tab,{act:"edit-tab",cls:"center"})}${Body(body)}`;
  $(".mb",m).scrollTop=sc;
}
Object.assign(ACT,{
  "edit-tab":el=>{EDIT.tab=el.dataset.t;rEdit()},
  "edit-page":el=>{EDIT.page=el.dataset.k||el.dataset.p||null;rEdit()},
  "edit-look":el=>{closeAllVeils();newAgent({edit:el.dataset.id})},
  "routine-new-e":()=>routineEditor(null,"",EDIT.id),
  "agent-skill":el=>{const a=AG[EDIT.id],k="sk_"+el.dataset.id,cur=a[k]??SKILLS.find(s=>s.n===el.dataset.id).on;a[k]=!cur;el.classList.toggle("on",!cur)},
  "grant-me":el=>{const p=PLUGINS.find(x=>x.id===el.dataset.id),id=EDIT.id;p.grants=p.grants.includes(id)?p.grants.filter(g=>g!==id):[...p.grants,id];el.classList.toggle("on",p.grants.includes(id));toast(`${AG[id].name} ${p.grants.includes(id)?"can now use":"can't use"} ${p.name}`,{icon:"plug",ms:1500})},
  "pause-tog":el=>{const a=AG[el.dataset.id];a.paused=!a.paused;rEdit();rPanel()},
  "agent-cmd":el=>{const a=AG[EDIT.id];menu(el,["#Commands on this Mac",...Object.entries(CMD).map(([k,n])=>[null,n,()=>{a.cmd=k;rEdit();toast(`${a.name}: commands ${n.toLowerCase()}`,{icon:"term",ms:1500})},{chk:(a.cmd||S.cmd)===k}])],{align:"right"})},
  "agent-perm":el=>{const a=AG[EDIT.id];menu(el,["#Permission",...Object.keys(PERM).map(k=>[null,PERM[k][0],()=>{a.perm=k;rEdit();rPanel()},{chk:a.perm===k,s:PERM[k][1]}])],{align:"right"})},
});
INPUT["e-name"]=v=>{AG[EDIT.id].name=v||" ";rSide();rTop();$(".mdl.edit .mh h2").textContent="Edit "+v};
INPUT["e-role"]=v=>{AG[EDIT.id].role=v;rSide()};
INPUT["e-instr"]=v=>{AG[EDIT.id].instr=v};

/* ───────── new agent: a face built from parts over a pixel field in its colour ───────── */
const TEMPLATES=[
  {name:"Dev",role:"Developer",shape:"squircle",color:"#f58a3c",look:{eyes:"dot",mouth:"grin",acc:"headphones",pat:"none"},cli:"Claude",model:"Opus 5.5",perm:"auto",d:"Writes code, runs tests, opens pull requests",ins:"You write and test code. Open a pull request, never push to main."},
  {name:"Marketer",role:"Marketing",shape:"diamond",color:"#ee73b2",look:{eyes:"wide",mouth:"smile",acc:"bow",pat:"cheeks"},cli:"Codex",model:"GPT-6.1",perm:"manual",d:"Drafts posts and campaigns, asks before publishing",ins:"You draft marketing copy. Never publish without approval."},
  {name:"Scout",role:"Research",shape:"cloud",color:"#3ec46d",look:{eyes:"round",mouth:"o",acc:"sprout",pat:"spots"},cli:"OpenCode",model:"Muse 1.3",perm:"plan",d:"Reads sources and writes short briefs",ins:"You research and cite sources. You never change files."},
  {name:"Helper",role:"Support",shape:"drop",color:"#38bdf8",look:{eyes:"happy",mouth:"smile",acc:"cap",pat:"none"},cli:"Claude",model:"Haiku 5.5",perm:"manual",d:"Answers customer questions from your docs",ins:"You answer support questions using the docs only."},
  {name:"Ops",role:"Infra",shape:"hex",color:"#d8d8d4",look:{eyes:"visor",mouth:"flat",acc:"antenna",pat:"stripes"},cli:"Codex",model:"GPT-6.1",perm:"auto",d:"Watches pools, alerts and costs",ins:"You watch infrastructure and report anomalies first."},
  {name:"Quill",role:"Writer",shape:"ghost",color:"#a58bfa",look:{eyes:"round",mouth:"smile",acc:"glasses",pat:"none"},cli:"Claude",model:"Sonnet 5.5",perm:"auto",d:"Long-form drafts in your voice",ins:"You write long-form drafts in the founder's voice."},
  {name:"Guard",role:"Security",shape:"cat",color:"#6d6df0",look:{eyes:"sleepy",mouth:"cat",acc:"horns",pat:"belly"},cli:"Claude",model:"Sonnet 5.5",perm:"manual",d:"Scans for CVEs and risky changes",ins:"You review security risks and report them by severity."},
  {name:"Pal",role:"Assistant",shape:"star",color:"#ecb40f",look:{eyes:"dot",mouth:"cat",acc:"crown",pat:"cheeks"},cli:"Claude",model:"Haiku 5.5",perm:"plan",d:"Reminders, calendar and life admin",ins:"You keep track of reminders and dates."},
];
const PARTS=[["body","Body"],["eyes","Eyes"],["mouth","Mouth"],["acc","Extra"],["pat","Pattern"],["color","Colour"]];
const POSES=[["sleep","Resting"],["idle","Idle"],["work","Working"],["vm","Its computer"],["mac","Your Mac"]];
const pick=a=>a[Math.random()*a.length|0];
let N=null;
function newAgent(o={}){
  const base=o.edit?AG[o.edit]:null;
  N={tab:"scratch",part:"body",pose:"idle",name:base?.name||"",role:base?.role||"",shape:base?.shape||"circle",color:base?.color||COLORS[4],look:{eyes:"round",mouth:"smile",acc:"none",pat:"none",...(base?.look||{})},photo:base?.photo||null,cli:base?.cli||"Claude",model:base?.model||"Sonnet 5.5",dir:base?.dir||"hyze-cloud",perm:base?.perm||"auto",ins:"",edit:o.edit};
  closePop();N.v=veil(`<div></div>`,{width:860,cls:"newag"});rNew();
}
const nFace=(s,over={})=>mascot(over.shape||N.shape,over.color||N.color,s,{look:{...N.look,...(over.look||{})},state:over.state||"idle"});
/* the option grid for one part: each option is the whole face with that part swapped in */
function partGrid(){
  const P=N.part;
  if(P==="color")return `<div class="dots">${COLORS.map(c=>`<button class="${N.color===c?"on":""}" style="background:${c}" data-act="n-color" data-v="${c}"></button>`).join("")}</div>`;
  const opts=P==="body"?SHAPE_NAMES:{eyes:EYES,mouth:MOUTHS,acc:ACCS,pat:PATS}[P];
  const cur=P==="body"?N.shape:N.look[P];
  return `<div class="shapes">${opts.map(v=>`<button class="${cur===v?"on":""}" data-act="n-part" data-p="${P}" data-v="${v}" title="${v}">${nFace(40,P==="body"?{shape:v}:{look:{[P]:v}})}</button>`).join("")}</div>`;
}
function rNew(){
  const m=mdlOf(N.v);
  const head=Head(N.edit?"Change look":"New agent",{right:N.edit?"":Tabs([["scratch","Make one"],["ready","Ready-made"]],N.tab,{act:"new-tab",cls:"sm"})});
  if(N.tab==="ready"){
    m.innerHTML=`${head}<div class="tpls rise">${TEMPLATES.map((t,i)=>`<button class="tpl" style="--i:${i}" data-act="new-tpl" data-i="${i}">${mascot(t.shape,t.color,46,{look:t.look})}<div><b>${t.name}</b><span>${t.d}</span></div></button>`).join("")}</div>`;return;
  }
  m.innerHTML=`${head}<div class="newgrid"><div><div class="prev" id="nprev">${prevHTML()}</div><div class="poses">${POSES.map(([k,n])=>`<button class="${N.pose===k?"on":""}" data-act="n-pose" data-v="${k}">${n}</button>`).join("")}</div></div><div>
    ${Field({in:"n-name",placeholder:"Agent name",value:N.name,autofocus:true,style:"height:40px;font-size:15px;font-weight:500"})}
    <div class="lookbar">${Tabs(PARTS,N.part,{act:"n-parttab",key:"p",cls:"sm"})}<span class="sp"></span>${Btn("Shuffle",{act:"n-shuffle",icon:"dice",size:"sm",kind:"ghost"})}${N.photo?Btn("Remove photo",{act:"n-nophoto",size:"sm",kind:"ghost"}):Btn("Photo",{act:"n-photo",icon:"image",size:"sm",kind:"ghost"})}</div>
    <div id="npart" class="${N.photo?"dim":""}">${partGrid()}</div>
    ${N.edit?"":`<div style="margin-top:16px">${Group(Row({title:"Role",right:`<input class="inl" data-in="n-role" placeholder="Optional" value="${esc(N.role)}">`})+Row({title:"Brain",right:Down(`${cliMark(N.cli,14)} ${ENG[N.cli]} · ${N.model}`),act:"n-brain"})+Row({title:"Permission",right:Down(PERM[N.perm][0]),act:"n-perm"})+`<div class="row" style="display:block"><b style="font-weight:500;display:block;margin-bottom:6px">Instructions</b>${Field({area:true,rows:3,in:"n-ins",value:N.ins,placeholder:"The goal, how to work, what needs your approval"})}</div>`)}</div>`}
  </div></div>${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn(N.edit?"Save":"Create agent",{act:"n-create",kind:"primary",off:!N.name.trim(),id:"ncreate"}))}`;
}
/* the field fills the whole card; only the face and the words redraw while you pick, so the banner doesn't flicker */
const prevHTML=()=>`${Banner(N.color,"new-agent",{rows:60,cols:36})}<div class="who2"><span class="fc">${N.photo?photoMas(N.photo,128):nFace(128,{state:N.pose})}</span><b>${esc(N.name||"New agent")}</b><span>${esc(N.role||"No role yet")}</span></div>`;
const prevFace=(pop)=>{const f=$("#nprev .fc");if(!f)return;f.innerHTML=N.photo?photoMas(N.photo,128):nFace(128,{state:N.pose});if(pop){f.classList.remove("bounce");void f.offsetWidth;f.classList.add("bounce")}};
const prevText=()=>{const w=$("#nprev .who2");if(w){$("b",w).textContent=N.name||"New agent";$(":scope>span:last-child",w).textContent=N.role||"No role yet"}};
Object.assign(ACT,{
  "new-tab":el=>{N.tab=el.dataset.t;rNew()},
  "new-tpl":el=>{const t=TEMPLATES[+el.dataset.i];Object.assign(N,{name:t.name,role:t.role,shape:t.shape,color:t.color,look:{...t.look},photo:null,cli:t.cli,model:t.model,perm:t.perm,ins:t.ins,tab:"scratch"});rNew()},
  "n-parttab":el=>{N.part=el.dataset.p;$$(".lookbar .tabs button").forEach(b=>b.classList.toggle("on",b===el));$("#npart").innerHTML=partGrid()},
  "n-part":el=>{const p=el.dataset.p,v=el.dataset.v;if(p==="body")N.shape=v;else N.look[p]=v;N.photo=null;$$("#npart button").forEach(b=>b.classList.toggle("on",b===el));prevFace(true)},
  "n-color":el=>{N.color=el.dataset.v;N.photo=null;$("#nprev").innerHTML=prevHTML();$("#npart").innerHTML=partGrid()},
  "n-pose":el=>{N.pose=el.dataset.v;$$(".poses button").forEach(b=>b.classList.toggle("on",b===el));prevFace()},
  /* shuffle mixes one of every part, so the same few pieces make hundreds of faces */
  "n-shuffle":()=>{N.shape=pick(SHAPE_NAMES);N.color=pick(COLORS);N.look={eyes:pick(EYES),mouth:pick(MOUTHS),acc:pick(ACCS),pat:pick(PATS)};N.photo=null;$("#nprev").innerHTML=prevHTML();$("#nprev .fc").classList.add("bounce");$("#npart").innerHTML=partGrid()},
  "n-photo":()=>pickFile(f=>{const r=new FileReader();r.onload=()=>{N.photo=r.result;rNew()};r.readAsDataURL(f)}),
  "n-nophoto":()=>{N.photo=null;rNew()},
  "n-brain":el=>menu(el,[...Object.keys(MODELS).flatMap(c=>[`#${ENG[c]}`,...MODELS[c].map(m=>[null,m,()=>{N.cli=c;N.model=m;rNew()},{html:cliMark(c,18),chk:N.cli===c&&N.model===m}])])],{align:"right"}),
  "n-perm":el=>menu(el,["#Permission",...Object.keys(PERM).map(k=>[null,PERM[k][0],()=>{N.perm=k;rNew()},{chk:N.perm===k,s:PERM[k][1]}])],{align:"right"}),
  "n-create":()=>{
    if(!N.name.trim())return;
    if(N.edit){const a=AG[N.edit];Object.assign(a,{name:N.name,shape:N.shape,color:N.color,look:{...N.look},photo:N.photo});closeAllVeils();applyTheme();rSide();rTop();rPanel();toast("Look updated",{icon:"check"});return}
    const id=nid("a"),o={id,name:N.name.trim(),role:N.role.trim()||"Agent",shape:N.shape,color:N.color,look:{...N.look},photo:N.photo,cli:N.cli,model:N.model,effort:"Medium",dir:N.dir,perm:N.perm,line:"Just created. Say hi.",when:"now",skills:0,mem:0,budget:10,spent:0,instr:N.ins};
    AG[id]=o;WS[S.ws].convs.unshift(id);closeAllVeils();openConv(id);toast(`${o.name} is ready`,{icon:"plus",action:"Undo",onAction:()=>{WS[S.ws].convs=WS[S.ws].convs.filter(c=>c!==id);openConv(WS[S.ws].convs[0])}});
  },
});
INPUT["n-name"]=v=>{N.name=v;prevText();$("#ncreate").classList.toggle("off",!v.trim())};
INPUT["n-role"]=v=>{N.role=v;prevText()};
INPUT["n-ins"]=v=>{N.ins=v};

/* ───────── channel editor ───────── */
let C=null;
function channelEditor(id){
  closePop();const c=id?CH[id]:null;
  C={id,name:c?.name||"",purpose:c?.purpose||"",members:[...(c?.members||["atlas"])],lead:c?.lead||"atlas",rounds:c?.rounds||3};
  C.v=veil(`<div></div>`,{width:540});rChan();
}
function rChan(){
  const m=mdlOf(C.v),ids=WS[S.ws].convs.filter(i=>!isCh(i));
  m.innerHTML=`${Head(C.id?"Edit channel":"New channel",{lead:HashTile({lead:C.lead},44)})}${Body(`${Label("Name")}${Field({in:"c-name",value:C.name,placeholder:"launch",autofocus:true})}${Label("Purpose")}${Field({area:true,rows:2,in:"c-purpose",value:C.purpose,placeholder:"What is this channel for?"})}
  ${Label("Agents")}<div style="display:flex;gap:6px;flex-wrap:wrap">${ids.map(i=>`<button class="pill ${C.members.includes(i)?"on":""}" style="padding-left:5px" data-act="c-mem" data-id="${i}">${face(AG[i],20)}${AG[i].name}</button>`).join("")}</div>
  <div style="margin-top:18px">${Group(Row({title:"Lead",sub:"Answers first when nobody is mentioned.",right:Down(`${face(AG[C.lead],20)} ${AG[C.lead].name}`),act:"c-lead"})+Row({title:"Rounds",sub:"How many times agents answer each other.",right:Down(C.rounds),act:"c-rounds"}))}</div>`)}
  ${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn(C.id?"Save":"Create channel",{act:"c-save",kind:"primary",off:!(C.name.trim()&&C.members.length),id:"ccreate"}))}`;
}
Object.assign(ACT,{
  "c-mem":el=>{const id=el.dataset.id;C.members=C.members.includes(id)?C.members.filter(x=>x!==id):[...C.members,id];if(!C.members.includes(C.lead))C.lead=C.members[0]||"atlas";rChan()},
  "c-lead":el=>menu(el,["#Lead",...(C.members.length?C.members:["atlas"]).map(i=>[null,AG[i].name,()=>{C.lead=i;rChan()},{html:face(AG[i],22),chk:C.lead===i}])],{align:"right"}),
  "c-rounds":el=>menu(el,["#Rounds",...[1,2,3,4,5].map(n=>[null,String(n),()=>{C.rounds=n;rChan()},{chk:C.rounds===n}])],{align:"right"}),
  "c-save":()=>{
    const nm=C.name.trim().toLowerCase().replace(/\s+/g,"-");if(!nm||!C.members.length)return;
    const key="#"+nm,data={name:nm,purpose:C.purpose||"A new channel.",members:C.members,lead:C.lead,rounds:C.rounds};
    if(C.id){Object.assign(CH[C.id],data);closeAllVeils();rSide();rTop();rPanel();toast("Channel updated",{icon:"check"});return}
    CH[key]={...data,line:"Channel created",when:"now"};WS[S.ws].convs.push(key);closeAllVeils();openConv(key);toast(`#${nm} created`,{icon:"people"});
  },
});
INPUT["c-name"]=v=>{C.name=v;$("#ccreate").classList.toggle("off",!(v.trim()&&C.members.length))};
INPUT["c-purpose"]=v=>{C.purpose=v};
