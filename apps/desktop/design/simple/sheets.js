/* sheets: Apps, Pull requests, Routines. Centered, for things you set up rather than read beside the chat. */
let SHEET=null;
function openSheet(k,title,right=""){
  closePop();closeAllVeils();
  const v=veil(`${Head(title,{right})}<div id="sheetbody" style="display:contents"></div>`,{cls:"sheet",width:940});
  SHEET={k,v};v.onclose=()=>{SHEET=null};return v;
}
const refreshSheets=()=>{if(!SHEET)return;({plugins:rPlugins,prs:rPRs,routines:rRoutines})[SHEET.k]?.()};
/* a brand's colour for its banner; near-black marks (GitHub, Notion, Vercel) get lifted so the field still reads */
const bhex=id=>{const h=BRANDS[id]?.hex||"#7a7a80",[r,g,b]=hx(h);return r*.3+g*.6+b*.1<60?mix(h,"#9a9aa6",.55):h};

/* ───────── apps ───────── */
const PL={tab:"connected",q:""};
function openPlugins(tab="connected"){
  PL.tab=tab;PL.q="";
  openSheet("plugins","Connect apps",Btn("Add MCP server",{act:"mcp-add",icon:"plus"}));rPlugins(true);
}
function rPlugins(skeleton){
  const b=$("#sheetbody");if(!b)return;
  const n=PLUGINS.filter(p=>p.on).length;
  b.innerHTML=`<div class="sbar">${Tabs([["connected",`Connected ${n}`],["catalog","Catalog"],["skills","Skills"]],PL.tab,{act:"pl-tab"})}${Search({in:"pl-q",placeholder:`Search ${PL.tab}`,value:PL.q})}</div>${Body(`<div id="plist">${skel(4)}</div>`)}`;
  const fill=()=>{const l=$("#plist");if(l)l.innerHTML=plistHTML()};
  skeleton?later(380,fill):fill();
}
const plMatch=p=>!PL.q||(p.name+p.desc).toLowerCase().includes(PL.q.toLowerCase());
function plistHTML(){
  if(PL.tab==="skills"){
    const sk=SKILLS.filter(s=>!PL.q||s.n.toLowerCase().includes(PL.q.toLowerCase()));
    return `${Group(sk.map(s=>Row({icon:"bolt",title:s.n,sub:`${Object.values(AG).filter(a=>(a["sk_"+s.n]??s.on)).length} agents use it`,right:toggle(s.n,s.on,"skill-tog")})).join("")||Empty("No skill matches."))}<div class="btnrow">${Btn("New skill",{act:"skill-add",icon:"plus"})}</div>`;
  }
  if(PL.tab==="connected"){
    const list=PLUGINS.filter(p=>p.on&&plMatch(p)),more=PLUGINS.filter(p=>!p.on).length;
    return `<div class="pcards rise">${list.map((p,i)=>`<div class="pc" style="--i:${i}" data-act="pl-open" data-id="${p.id}">${Banner(bhex(p.id),p.id,{cols:90,rows:20})}<div class="bd"><span class="mk">${brand(p.id,40)}</span><div class="h"><b>${p.name}</b><span class="on"><i></i>Connected</span></div><div class="d">${p.desc}</div><div class="pf">${p.grants.length?`<span class="faces">${p.grants.filter(k=>AG[k]).map(k=>face(AG[k],20)).join("")}</span><span>${p.grants.length} agent${p.grants.length===1?"":"s"}</span>`:"Nobody uses it yet"}${Spark(p.id,bhex(p.id))}</div></div></div>`).join("")}
      <button class="pc more" data-act="pl-tab" data-t="catalog">${ic("plus",22)}<span>Browse ${more} more</span></button></div>`;
  }
  const cat=PLUGINS.filter(p=>!p.on&&plMatch(p)),f=cat[0];
  if(!cat.length)return Empty(PL.q?`Nothing in the catalog matches “${esc(PL.q)}”.`:"Everything is connected.",{action:Btn("Add an MCP server",{act:"mcp-add",icon:"plus",size:"sm"})});
  return `${f&&!PL.q?`<div class="feat">${Banner(bhex(f.id),f.id+"feat")}${brand(f.id,72)}<div class="fb"><span class="k">Featured</span><h2>Your agents, in ${f.name}</h2><p>${f.desc}. Give it to the agents who need it; anything that writes asks you first.</p>${Btn(`Connect ${f.name}`,{act:"pl-on",kind:"primary",a:{"data-id":f.id}})}</div></div>`:""}
    <div class="catgrid rise">${cat.slice(f&&!PL.q?1:0).map((p,i)=>`<div class="cat" style="--i:${i}"><div class="h">${brand(p.id,36)}<b>${p.name}</b>${Btn("Connect",{act:"pl-on",size:"sm",a:{"data-id":p.id}})}</div><div class="d">${p.desc}</div></div>`).join("")}</div>`;
}
/* one app up close: its banner, who may use it, what each tool may do */
function plDrawer(id){
  const p=PLUGINS.find(x=>x.id===id),ags=Object.values(AG).filter(a=>WS[S.ws].convs.includes(a.id));
  const v=veil(`<div class="pdr" style="display:contents"><div style="position:relative;flex:none">${Banner(bhex(p.id),p.id+"dr")}<div class="dfl">${IconBtn("x",{act:"close-veil",kind:"glass",size:"sm",title:"Close"})}</div></div>
    <span class="mk">${brand(p.id,60)}</span><div class="ttl"><h2>${p.name}</h2>${Chip("Connected",{dot:"go"})}</div>
    ${Body(`<p style="color:var(--ink2);margin:6px 2px 4px">${p.desc}.</p>${Section("Which agents can use it",{count:p.grants.length})}${Group(ags.map(a=>Row({lead:face(a,34),title:a.name,sub:a.role,right:toggle(p.id+":"+a.id,p.grants.includes(a.id),"pl-grant")})).join(""))}
    ${Section("What it may do")}${Group(p.tools.map((t,i)=>Row({icon:"bolt",title:t[0],right:Seg([["allow","Allow"],["ask","Ask"],["off","Off"]],t[1],{act:"pl-tool",a:{"data-id":p.id,"data-i":i}})})).join(""))}`)}
    ${Foot(Btn("Disconnect",{act:"pl-off",kind:"bad",a:{"data-id":p.id,style:"margin-right:auto"}}),Btn("Done",{act:"close-veil",kind:"primary"}))}</div>`,{width:600});
  v.plId=id;
}
Object.assign(ACT,{
  "pl-tab":el=>{PL.tab=el.dataset.t;rPlugins(true)},
  "pl-open":el=>plDrawer(el.dataset.id),
  "pl-on":el=>{const p=PLUGINS.find(x=>x.id===el.dataset.id);progress(el,"Connecting",900,()=>{p.on=true;p.grants=[S.conv].filter(i=>!isCh(i));PL.tab="connected";rPlugins();toast(`${p.name} is connected`,{icon:"plug",action:"Set up",onAction:()=>plDrawer(p.id)})})},
  "pl-off":el=>{const p=PLUGINS.find(x=>x.id===el.dataset.id);confirmBox(`Disconnect ${p.name}?`,"Agents lose access right away. You can connect it again.","Disconnect",()=>{p.on=false;$$(".veil").forEach(v=>{if(v.plId===p.id)closeVeil(v)});rPlugins();toast(`${p.name} disconnected`,{icon:"plug",action:"Undo",onAction:()=>{p.on=true;rPlugins()}})})},
  "pl-grant":el=>{const [pid,aid]=el.dataset.id.split(":"),p=PLUGINS.find(x=>x.id===pid);p.grants=p.grants.includes(aid)?p.grants.filter(g=>g!==aid):[...p.grants,aid];el.classList.toggle("on",p.grants.includes(aid));const l=$("#plist");if(l)l.innerHTML=plistHTML()},
  "pl-tool":el=>{const p=PLUGINS.find(x=>x.id===el.dataset.id);p.tools[+el.dataset.i][1]=el.dataset.v;$$("button",el.parentElement).forEach(b=>b.classList.toggle("on",b===el))},
  "skill-tog":el=>{const s=SKILLS.find(x=>x.n===el.dataset.id);s.on=!s.on;el.classList.toggle("on",s.on)},
  "skill-add":()=>{SKILLS.push({n:"New skill "+(SKILLS.length+1),on:true});$("#plist").innerHTML=plistHTML();toast("Skill added",{icon:"bolt",ms:1400})},
  "mcp-add":()=>{
    veil(`${Head("Add MCP server")}${Body(`${Label("Name")}${Field({in:"mcp-name",placeholder:"My server",autofocus:true})}${Label("Command or URL")}${Field({in:"mcp-cmd",mono:true,placeholder:"npx -y @acme/mcp  or  https://mcp.acme.com"})}${Label("Environment variable · optional")}${Field({mono:true,placeholder:"ACME_TOKEN=…"})}${Hint("It starts with no agent allowed. You choose who may use it.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Add server",{act:"mcp-save",kind:"primary",off:true,id:"mcpsave"}))}`,{width:480});
  },
  "mcp-save":el=>{const v=el.closest(".veil"),n=$("[data-in=mcp-name]",v).value.trim();PLUGINS.unshift({id:"mcp-"+n.toLowerCase(),name:n,desc:"MCP server",on:true,grants:[],tools:[["Run tools","ask"]]});closeVeil(v);PL.tab="connected";rPlugins();toast(`${n} added`,{icon:"plug"})},
});
INPUT["pl-q"]=v=>{PL.q=v;const l=$("#plist");if(l)l.innerHTML=plistHTML()};
INPUT["mcp-name"]=v=>$("#mcpsave").classList.toggle("off",!v.trim());
INPUT["mcp-cmd"]=()=>{};

/* ───────── pull requests ───────── */
function openPRs(){openSheet("prs","Pull requests",Btn("Refresh",{act:"pr-refresh",icon:"refresh"}));rPRs(true)}
function rPRs(skeleton){
  const b=$("#sheetbody");if(!b)return;
  const L=[["open","Open","var(--blue)"],["review","In review","var(--amber)"],["merged","Merged","var(--green)"]];
  b.innerHTML=Body(`<div class="lanes" id="lanes">${L.map(()=>`<div class="lane">${skel(2)}</div>`).join("")}</div>`);
  const fill=()=>{const el=$("#lanes");if(!el)return;el.innerHTML=L.map(([k,n,c])=>{const ps=PRS.filter(p=>p.lane===k);return `<div class="lane"><h4>${Dot(c)}${n} <i>${ps.length}</i></h4><div class="rise" style="display:flex;flex-direction:column;gap:8px">${ps.map((p,i)=>`<div class="prc" style="--c:${AG[p.by].color};--i:${i}" data-act="open-pr-sheet" data-id="${p.id}"><span class="rp">${p.repo} #${p.num}</span><b>${esc(p.title)}</b><div class="m">${face(AG[p.by],18)}<span class="df"><b>+${p.add}</b> <em>−${p.del}</em></span><span class="ck ${p.ck==="ok"?"":p.ck}"><i></i>${{ok:"Passing",run:"Running",bad:"Failing"}[p.ck]}</span></div></div>`).join("")||Empty("Nothing here.")}</div></div>`}).join("")};
  skeleton?later(420,fill):fill();
}
ACT["open-pr-sheet"]=el=>{closeAllVeils();S.panel={k:"pr",id:el.dataset.id};showPanel()};
ACT["pr-refresh"]=()=>{rPRs(true);toast("Pulled the latest from GitHub",{icon:"refresh",ms:1500})};

/* ───────── routines ───────── */
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],TODAY=(new Date().getDay()+6)%7;
const RS={day:null};
function ranOn(r,d){return r.when==="daily"||(r.when==="weekly"&&r.day===d)||(r.when==="once"&&d===TODAY)}
function openRoutines(){RS.day=null;openSheet("routines","Routines",Btn("New routine",{act:"routine-new-sheet",icon:"plus",kind:"primary"}));rRoutines(true)}
const cap=s=>s[0].toUpperCase()+s.slice(1);
function rRoutines(skeleton){
  const b=$("#sheetbody");if(!b)return;
  const d0=new Date(),mon=new Date(d0);mon.setDate(d0.getDate()-TODAY);
  const week=`<div class="week">${DAYS.map((n,i)=>{const dt=new Date(mon);dt.setDate(mon.getDate()+i);const c=ROUTINES.filter(r=>r.on&&ranOn(r,i)).length;return `<button class="${RS.day===i?"on":""} ${i===TODAY?"today":""}" data-act="rt-day" data-i="${i}"><span>${i===TODAY?"Today":n}</span><b>${dt.getDate()}</b><div class="d">${"<i></i>".repeat(Math.min(c,4))}</div></button>`}).join("")}</div>`;
  b.innerHTML=Body(`${week}<div id="rlist">${skel(3)}</div>`);
  const fill=()=>{const l=$("#rlist");if(!l)return;const rs=ROUTINES.filter(r=>RS.day===null||ranOn(r,RS.day));
    l.innerHTML=rs.length?`${Section(RS.day===null?"All routines":DAYS[RS.day],{count:rs.length})}${Group(`<div class="rise">${rs.map((r,i)=>Row({lead:face(AG[r.agent],34),title:`<span class="sent">${cap(when(r))}, <u>${AG[r.agent].name}</u> will ${esc(r.task)}.</span>`,sub:esc(r.title),right:`${Btn("Run now",{act:"rt-run",size:"sm",a:{"data-id":r.id}})}${IconBtn("pen",{act:"routine-edit",size:"sm",kind:"plain",title:"Edit",a:{"data-id":r.id}})}${toggle(r.id,r.on,"rt-tog")}`,a:{style:`--i:${i}`}})).join("")}</div>`)}`
      :Empty(`Nothing scheduled for ${DAYS[RS.day]}.`,{action:`<button class="link" data-act="rt-day" data-i="${RS.day}">Show all</button>`})};
  skeleton?later(360,fill):fill();
}
function routineEditor(id,text="",agent){
  closePop();const r=id?ROUTINES.find(x=>x.id===id):null;
  const R=r?{...r}:{id:null,agent:agent&&!isCh(agent)?agent:(isCh(S.conv)?CH[S.conv].lead:S.conv),title:"",when:"daily",time:"09:00",day:TODAY,on:true,task:text.slice(0,80)};
  const v=veil(`<div></div>`,{width:540});v.R=R;
  const draw=()=>{mdlOf(v).innerHTML=`${Head(r?"Edit routine":"New routine",{lead:`<span class="row" style="padding:0;min-height:0;width:auto"><span class="ico" style="width:44px;height:44px;border-radius:14px">${ic("clock",22)}</span></span>`})}${Body(`${Section("Who")}${Group(Row({title:"Agent",right:Down(`${face(AG[R.agent],22)} ${AG[R.agent].name}`),act:"re-agent"}))}
    ${Section("When")}${Group(Row({title:"Repeat",right:Down({daily:"Every day",weekly:"Every week",once:"Once"}[R.when]),act:"re-when"})+(R.when==="weekly"?Row({title:"Day",right:Down(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][R.day]),act:"re-day"}):"")+Row({title:"Time",right:`<input type="time" class="inl" data-in="re-time" value="${R.time}" style="width:120px">`}))}
    ${Section("What it does")}${Field({area:true,rows:3,in:"re-task",value:R.task,placeholder:"check the pool and report capacity"})}
    <p class="hint sent" id="resent">${cap(when(R))}, <u>${AG[R.agent].name}</u> will ${esc(R.task||"…")}.</p>`)}
    ${Foot(r?Btn("Delete",{act:"re-del",kind:"bad",a:{style:"margin-right:auto"}}):"",Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Save routine",{act:"re-save",kind:"primary",off:!R.task.trim()}))}`};
  v.draw=draw;draw();
}
const reV=()=>VEILS[VEILS.length-1];
Object.assign(ACT,{
  "routine-new-sheet":()=>routineEditor(null,""),
  "rt-day":el=>{RS.day=RS.day===+el.dataset.i?null:+el.dataset.i;rRoutines()},
  "rt-run":el=>{const r=ROUTINES.find(x=>x.id===el.dataset.id);progress(el,"Running",1300,()=>toast(`${AG[r.agent].name} ran “${r.title}”`,{icon:"check",action:"Open chat",onAction:()=>{closeAllVeils();openConv(r.agent)}}))},
  "re-agent":el=>{const v=reV();menu(el,["#Agent",...WS[S.ws].convs.filter(i=>!isCh(i)).map(i=>[null,AG[i].name,()=>{v.R.agent=i;v.draw()},{html:face(AG[i],22),chk:v.R.agent===i}])],{align:"right"})},
  "re-when":el=>{const v=reV();menu(el,["#Repeat",...[["daily","Every day"],["weekly","Every week"],["once","Once"]].map(([k,n])=>[null,n,()=>{v.R.when=k;v.draw()},{chk:v.R.when===k}])],{align:"right"})},
  "re-day":el=>{const v=reV();menu(el,["#Day",...["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((n,i)=>[null,n,()=>{v.R.day=i;v.draw()},{chk:v.R.day===i}])],{align:"right"})},
  "re-save":()=>{const v=reV(),R=v.R;if(!R.task.trim())return;R.title=R.title||cap(R.task);
    if(R.id)Object.assign(ROUTINES.find(x=>x.id===R.id),R);else ROUTINES.push({...R,id:nid("r")});
    closeVeil(v);rPanel();if(EDIT)rEdit();refreshSheets();toast(R.id?"Routine updated":"Routine created",{icon:"clock",action:"View",onAction:openRoutines});
    if(!R.id)pushMsg(S.conv,{id:nid("s"),kind:"sys",text:`Routine created · <b>${esc(R.title)}</b>`});},
  "re-del":()=>{const v=reV(),i=ROUTINES.findIndex(x=>x.id===v.R.id),r=ROUTINES[i];ROUTINES.splice(i,1);closeVeil(v);rPanel();if(EDIT)rEdit();refreshSheets();toast("Routine deleted",{icon:"trash",action:"Undo",onAction:()=>{ROUTINES.splice(i,0,r);rPanel();refreshSheets()}})},
});
INPUT["re-time"]=v=>{reV().R.time=v};
INPUT["re-task"]=v=>{const m=reV();m.R.task=v;$("#resent",m).innerHTML=`${cap(when(m.R))}, <u>${AG[m.R.agent].name}</u> will ${esc(v||"…")}.`;$("[data-act=re-save]",m).classList.toggle("off",!v.trim())};
