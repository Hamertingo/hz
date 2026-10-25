/* side: the left column (pinned faces, filters, folders, you), its menus, the inbox popover, the jump palette, drag to reorder. */
const WSCOL=["#6a8cf0","#55b884","#e2a440","#ee73b2"];
const wsTile=(w,i,s=24)=>`<span style="width:${s}px;height:${s}px;border-radius:${Math.round(s*.3)}px;background:${WSCOL[i%4]};display:grid;place-items:center;color:#fff;font-weight:600;font-size:${Math.round(s*.48)}px;flex:none">${w.name[0]}</span>`;
const CMD={ask:"Ask always",decide:"Decide for me",allow:"Allow all",off:"Off"};
S.cmd="allow";S.shut=new Set();

/* pinned conversations live in the strip on top, so the list below holds everything else */
function visibleConvs(){
  const w=WS[S.ws];
  return w.convs.filter(id=>!w.pins.includes(id)&&!S.hidden.has(id)).filter(id=>{
    if(S.filter==="unread")return S.unread.has(id);
    if(S.filter==="channels")return isCh(id);
    if(S.filter==="agents")return !isCh(id);
    return true;
  });
}
const statusLine=c=>c.live?"Working…":c.ask?"Waiting for you":c.paused?"Paused":c.asleep?"Resting":"";
function cvHTML(id,i){
  const ch=isCh(id),c=ch?CH[id]:AG[id],un=S.unread.has(id);
  const role=ch?`${c.members.length} agents`:c.role;
  const mark=un?`<span class="dot"></span>`:S.muted.has(id)?ic("bell",12):"";
  const line=!ch&&c.live?`<span class="wk"><i></i><i></i><i></i></span><span>${esc(c.line)}</span>`:`<span>${esc(c.line)}</span>`;
  return `<div class="cv ${S.conv===id?"on":""} ${S.sel.has(id)?"sel":""} ${!ch&&c.live?"live":""}" style="--i:${i}" data-id="${id}" data-act="open">${Lead(id,34)}<div class="mid"><div class="t1"><span class="nm">${esc(c.name)}</span>${!ch&&S.pref.logo?`<span class="eng" title="${ENG[c.cli]}">${cliMark(c.cli,11)}</span>`:""}<span class="rl">${esc(role)}</span><span class="tm">${c.when}</span></div><div class="ln ${un?"unr":""}">${line}${mark}</div></div></div>`;
}
function pinHTML(id){
  const c=isCh(id)?CH[id]:AG[id];
  return `<button class="pin ${S.conv===id?"on":""} ${!isCh(id)&&c.live?"live":""}" data-act="open" data-id="${id}" title="${esc(c.name)}">${Lead(id,40)}<b>${esc(c.name)}</b>${S.unread.has(id)?`<span class="dot"></span>`:""}</button>`;
}
/* the list replays its arrival only when it is new (boot, workspace, filter), never on every refresh */
function rSide({fresh=false}={}){
  const w=WS[S.ws],ids=visibleConvs(),hid=w.convs.filter(i=>S.hidden.has(i)).length,pend=S.inbox.filter(i=>!i.state).length;
  const pins=w.pins.filter(p=>w.convs.includes(p)).slice(0,4);
  const inFold=new Set((w.folders||[]).flatMap(f=>f.ids));
  const loose=ids.filter(i=>!inFold.has(i));
  let n=0;const rows=list=>list.map(id=>cvHTML(id,n++)).join("");
  const folds=(w.folders||[]).map((f,k)=>{const its=ids.filter(i=>f.ids.includes(i));if(!its.length&&S.filter!=="all")return "";const shut=S.shut.has(f.name);return `<button class="fold ${shut?"shut":""}" data-act="fold" data-i="${k}">${ic("down",12)}${esc(f.name)}<i>${its.length}</i></button>${shut?"":rows(its)}`}).join("");
  $("#side").innerHTML=`<div class="shead">${IconBtn("hand",{act:"inbox",title:"Waiting for you",badge:pend})}${IconBtn("search",{act:"palette",title:"Search  ⌘K"})}${IconBtn("plus",{act:"plusmenu",title:"New"})}</div>
  ${pins.length||S.filter==="all"?`<div class="pins">${pins.map(pinHTML).join("")}${pins.length<4?`<button class="pin add" data-act="pin-add" title="Pin a conversation"><span class="plus">${ic("plus",16)}</span><b>Pin</b></button>`:""}</div>`:""}
  <div class="pills">${[["all","All"],["unread","Unread"],["channels","Channels"],["agents","Agents"]].map(([k,nm])=>Pill(nm,{act:"filter",on:S.filter===k,count:k==="unread"?S.unread.size:0,a:{"data-v":k}})).join("")}</div>
  ${S.sel.size?`<div class="selbar"><span>${S.sel.size} selected</span><span class="sp"></span>${Btn("Read",{act:"sel-read",size:"sm",kind:"ghost"})}${Btn("Hide",{act:"sel-hide",size:"sm",kind:"ghost"})}${Btn("Done",{act:"sel-done",size:"sm",kind:"primary"})}</div>`:""}
  <div class="list ${fresh?"rise":""}" id="list">${ids.length?rows(loose)+folds:Empty("Nothing here.",{action:`<button class="link" data-act="filter" data-v="all">Show everything</button>`})}${hid?`<div style="text-align:center;padding:8px"><button class="link" data-act="show-hidden">Show ${hid} hidden</button></div>`:""}</div>
  <div class="sfoot"><button class="me" data-act="me">${Avatar(30,{dot:STATUS[ME.status]})}<span class="tx"><b>${esc(ME.name)}</b><span>${esc(w.name)}${ic("caret",11)}</span></span></button>${IconBtn("plug",{act:"plugins",title:"Connect apps",badge:PLUGINS.filter(p=>p.on).length})}${IconBtn("gear",{act:"settings",title:"Settings  ⌘,"})}</div>`;
  $("#side [data-act=plugins] .badge")?.setAttribute("style","background:var(--l4);color:var(--ink2)");
  bindDrag();
}
function rBadge(){const n=S.inbox.filter(i=>!i.state).length,b=$("#side [data-act=inbox] .badge");if(b){b.classList.toggle("hide",!n);b.textContent=n||""}}

function openConv(id,{jumpTo}={}){
  closePop();closeAllVeils();endCall(true);
  S.conv=id;S.unread.delete(id);S.recent=[id,...S.recent.filter(x=>x!==id)];const was=S.panel;
  if(was&&["profile","channel"].includes(was.k))S.panel={k:isCh(id)?"channel":"profile",tab:isCh(id)?"tasks":"details"};
  else S.panel=null;
  applyTheme();rSide();rTop();rDock();rPanel();rFeed({skeleton:true});
  if(jumpTo)later(320,()=>ACT.jump({dataset:{to:jumpTo}}));
}
function rTop(){
  const c=cur(),ch=isCh(S.conv),open=S.panel&&["profile","channel"].includes(S.panel.k),st=ch?`${c.members.length} agents`:statusLine(c);
  $("#top").innerHTML=`<button class="namepill ${open?"open":""}" data-act="toggle-panel" title="${open?"Hide":"Show"} details">${Lead(S.conv,22)}${ch?"#":""}${esc(c.name)}${st?`<span class="st">· ${st}</span>`:""}${ic("down",13)}</button>
  <div class="topr">${IconBtn("phone",{act:"call",title:ch?"Call the channel":`Call ${c.name}`})}${ch?`${IconBtn("tasks",{act:"ptab-go",title:"Tasks",a:{"data-k":"channel","data-t":"tasks"}})}${IconBtn("people",{act:"ptab-go",title:"Members",a:{"data-k":"channel","data-t":"members"}})}`:`${IconBtn("image",{act:"ptab-go",title:"Photos and files",a:{"data-k":"profile","data-t":"library"}})}${IconBtn("monitor",{act:"ptab-go",title:"Computer",a:{"data-k":"profile","data-t":"computer"}})}`}</div>`;
}
function render({skeleton=false}={}){
  applyTheme();rSide({fresh:true});rTop();rDock();rPanel();rFeed({skeleton});
}

/* ───────── drag to reorder: hold, then drag ───────── */
let drag=null;
function bindDrag(){
  $$("#list .cv").forEach(el=>el.onpointerdown=e=>{
    if(e.button!==0)return;
    const d={el,y0:e.clientY,x0:e.clientX,on:false};drag=d;
    d.timer=setTimeout(()=>{d.on=true;el.classList.add("drag");el.style.animation="none";try{el.setPointerCapture(e.pointerId)}catch{}document.body.style.cursor="grabbing"},320);
  });
}
document.addEventListener("pointermove",e=>{
  if(!drag)return;
  if(!drag.on){if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>6){clearTimeout(drag.timer);drag=null}return}
  const {el}=drag;el.style.transform=`translateY(${e.clientY-drag.y0}px)`;
  const r=el.getBoundingClientRect(),mid=r.top+r.height/2;
  const nx=el.nextElementSibling,pv=el.previousElementSibling;
  const nr=nx?.classList.contains("cv")&&nx.getBoundingClientRect(),pr=pv?.classList.contains("cv")&&pv.getBoundingClientRect();
  if(nr&&mid>nr.top+nr.height/2){nx.after(el);drag.y0+=nr.height}
  else if(pr&&mid<pr.top+pr.height/2){pv.before(el);drag.y0-=pr.height}
  el.style.transform=`translateY(${e.clientY-drag.y0}px)`;
});
document.addEventListener("pointerup",()=>{
  if(!drag)return;clearTimeout(drag.timer);
  if(drag.on){
    const ids=$$("#list .cv").map(x=>x.dataset.id),w=WS[S.ws],slots=w.convs.map((c,i)=>ids.includes(c)?i:-1).filter(i=>i>=0);
    const next=[...w.convs];slots.forEach((s,i)=>next[s]=ids[i]);w.convs=next;
    S.justDragged=true;later(0,()=>S.justDragged=false);document.body.style.cursor="";
    rSide();toast("Order saved",{icon:"check",ms:1200});
  }
  drag=null;
});

/* ───────── pins, folders ───────── */
const pinConv=id=>{const w=WS[S.ws];if(w.pins.includes(id)){w.pins=w.pins.filter(p=>p!==id);toast("Unpinned",{icon:"pin",ms:1300})}else{if(w.pins.length>=4)return toast("Four pins at most. Unpin one first.",{icon:"pin"});w.pins.push(id);toast("Pinned to the top",{icon:"pin",ms:1300})}rSide()};
function moveToFolder(id,k){
  const w=WS[S.ws];w.folders.forEach(f=>f.ids=f.ids.filter(x=>x!==id));
  if(k!=null){w.folders[k].ids.push(id);S.shut.delete(w.folders[k].name)}
  rSide();toast(k==null?"Taken out of the folder":`Moved to ${w.folders[k].name}`,{icon:"folder",ms:1500});
}
function newFolder(id){
  veil(`${Head("New folder")}${Body(`${Label("Name")}${Field({in:"fold-name",placeholder:"e.g. Launch week",autofocus:true})}${Hint("Folders group conversations in the sidebar. Collapse one to keep it quiet.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Create folder",{act:"fold-create",kind:"primary",off:true,id:"foldc",a:{"data-id":id||""}}))}`,{width:420});
}
INPUT["fold-name"]=v=>$("#foldc").classList.toggle("off",!v.trim());
ACT["fold-create"]=el=>{const n=$("[data-in=fold-name]").value.trim();if(!n)return;const w=WS[S.ws];w.folders.push({name:n,ids:[]});closeAllVeils();if(el.dataset.id)moveToFolder(el.dataset.id,w.folders.length-1);else{rSide();toast(`${n} created. Drag or move conversations into it.`,{icon:"folder"})}};
ACT.fold=el=>{const f=WS[S.ws].folders[+el.dataset.i];S.shut.has(f.name)?S.shut.delete(f.name):S.shut.add(f.name);rSide()};
ACT["pin-add"]=el=>{const w=WS[S.ws];menu(el,["#Pin to the top",...w.convs.filter(i=>!w.pins.includes(i)).map(i=>["",convName(i),()=>pinConv(i),{html:Lead(i,22)}])]);};

/* ───────── context menu on a conversation ───────── */
function convMenu(x,y,id){
  const w=WS[S.ws],pin=w.pins.includes(id),ch=isCh(id),c=ch?CH[id]:AG[id],fk=w.folders.findIndex(f=>f.ids.includes(id));
  const folderSub=[...w.folders.map((f,k)=>["folder",f.name,()=>moveToFolder(id,k),{chk:k===fk}]),...(fk>=0?[["x","Out of the folder",()=>moveToFolder(id,null)]]:[]),"hr",["folderplus","New folder…",()=>newFolder(id)]];
  const wsSub=WS.map((o,i)=>["",o.name,()=>moveConv(id,i),{html:wsTile(o,i,20),chk:i===S.ws}]);
  menu(atPoint(x,y),[
    ["pin",pin?"Unpin":"Pin to the top",()=>pinConv(id)],
    ["select","Select",()=>{S.sel.add(id);rSide()}],
    ["folder","Move to folder",null,{sub:folderSub}],
    ["bell",S.unread.has(id)?"Mark as read":"Mark as unread",()=>{S.unread.has(id)?S.unread.delete(id):S.unread.add(id);rSide()}],
    "hr",
    ["pen",ch?"Edit channel…":`Edit ${c.name}…`,()=>ch?channelEditor(id):editAgent(id)],
    ...(ch?[]:[["phone",`Call ${c.name}`,()=>{openConv(id);later(300,()=>startCall(id))}],["history","Versions…",()=>openVersions(id)]]),
    "hr",
    ["copy","Copy ID",()=>{navigator.clipboard?.writeText(ch?"ch_"+c.name:"ag_"+id).catch(()=>{});toast("ID copied",{icon:"copy",ms:1400})}],
    ["more","More",null,{sub:[["layers","Move to workspace",null,{sub:wsSub}],["bell",S.muted.has(id)?"Unmute":"Mute",()=>{S.muted.has(id)?S.muted.delete(id):S.muted.add(id);rSide();toast(S.muted.has(id)?"Muted. It still works, quietly.":"Unmuted",{icon:"bell",ms:1500})}],["out","Export chat",()=>toast(`Saved ${ch?c.name:id}-chat.md to Downloads`,{icon:"download"})],["trash","Clear chat",()=>confirmBox("Clear this chat?","The page goes blank. Memory and instructions stay.","Clear",()=>{CHATS[id]=[{id:nid("d"),kind:"day",text:"Today"}];if(S.conv===id)rFeed();toast("Chat cleared",{icon:"trash"})})],...(ch?[]:[["dup","Duplicate",()=>dupAgent(id)]])]}],
    "hr",
    ["eyeoff","Hide from sidebar",()=>{S.hidden.add(id);if(S.conv===id)openConv(visibleConvs()[0]||id);else rSide();toast("Hidden from the sidebar",{icon:"eyeoff",action:"Undo",onAction:()=>{S.hidden.delete(id);rSide()}})}],
    ["trash","Delete",()=>deleteConv(id),{red:true}],
  ]);
}
function moveConv(id,i){
  if(i===S.ws)return;const w=WS[S.ws];w.convs=w.convs.filter(c=>c!==id);w.pins=w.pins.filter(c=>c!==id);w.folders.forEach(f=>f.ids=f.ids.filter(x=>x!==id));WS[i].convs.push(id);
  if(S.conv===id)S.conv=w.convs[0]||id;rSide();if(S.conv!==id)openConv(S.conv);
  toast(`Moved to ${WS[i].name}`,{icon:"layers",action:"Undo",onAction:()=>{WS[i].convs=WS[i].convs.filter(c=>c!==id);w.convs.push(id);rSide()}});
}
function deleteConv(id){
  const c=isCh(id)?CH[id]:AG[id],nm=isCh(id)?"#"+c.name:c.name;
  confirmBox(`Delete ${nm}?`,isCh(id)?"The channel and its history are removed for everyone.":`${c.name}'s chat, memory and instructions are deleted.`,"Delete",()=>{
    const w=WS[S.ws],i=w.convs.indexOf(id),was=S.conv;w.convs.splice(i,1);w.pins=w.pins.filter(p=>p!==id);
    if(was===id)openConv(w.convs[0]||"atlas");else rSide();
    toast(`${nm} deleted`,{icon:"trash",action:"Undo",onAction:()=>{w.convs.splice(i,0,id);rSide()}});
  },{type:isCh(id)?undefined:c.name});
}
function dupAgent(id){
  const a=AG[id],n=nid("a"),b={...a,id:n,name:a.name+" 2",line:"Just created",when:"now",unread:0};AG[n]=b;WS[S.ws].convs.splice(WS[S.ws].convs.indexOf(id)+1,0,n);rSide();toast(`${b.name} created`,{icon:"dup",action:"Open",onAction:()=>openConv(n)});
}

/* ───────── you: status, workspaces, settings ───────── */
const switchWs=i=>{const w=WS[i];S.ws=i;S.conv=w.convs[0];S.panel=null;S.filter="all";S.sel.clear();render({skeleton:true})};
function meMenu(el){
  menu(el,[
    ...WS.map((w,i)=>["",w.name,()=>switchWs(i),{html:wsTile(w,i,20),chk:i===S.ws,s:`⌘${i+1}`}]),
    ["plus","New workspace…",newWorkspace],
    "hr","#Status",
    ...Object.keys(STATUS).map(s=>["",s,()=>{ME.status=s;rSide();toast(s==="Available"?"You're available":s==="Focus"?"Focus: agents hold non-urgent pings":"Away: agents queue what needs you",{icon:"bell"})},{html:`<i class="sdot" style="background:${STATUS[s]};margin:0 6px"></i>`,chk:ME.status===s}]),
    "hr",["user","Profile",()=>openSettings("profile")],["gift","What's new",()=>openWhatsNew()],["bulb","Send feedback",()=>openFeedback()],["gear","Settings",()=>openSettings("prefs"),{s:"⌘,"}],
  ],{place:"above"});
}
const wsMenu=()=>meMenu($("#side .me"));
function newWorkspace(){
  veil(`${Head("New workspace")}${Body(`${Label("Name")}${Field({in:"ws-name",placeholder:"e.g. Side project",autofocus:true})}${Hint("A workspace holds its own agents, channels and apps.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Create",{act:"ws-create",kind:"primary",off:true,id:"wsc"}))}`,{width:420});
}
INPUT["ws-name"]=(v)=>$("#wsc").classList.toggle("off",!v.trim());
ACT["ws-create"]=el=>{const n=$("[data-in=ws-name]").value.trim();if(!n)return;WS.push({name:n,lead:"bia",convs:["bia"],pins:[],folders:[],ctx:""});closeAllVeils();switchWs(WS.length-1);toast(`${n} created`,{icon:"plus"})};
function plusMenu(el){
  menu(el,[["plus","New agent",()=>newAgent(),{s:"⌘N"}],["people","New channel",()=>channelEditor()],["folderplus","New folder",()=>newFolder()],["clock","New routine",()=>routineEditor()],"hr",["plug","Connect apps",()=>openPlugins()],["pr","Pull requests",()=>openPRs()],["cal","Routines",()=>openRoutines()]],{align:"right"});
}
function openInbox(){
  const a=$("#side [data-act=inbox]"),pend=S.inbox.filter(i=>!i.state),done=S.inbox.filter(i=>i.state);
  const row=i=>{const ag=AG[i.agent];return `<div class="ibi ${i.state?"done":""}">${face(ag,30)}<div class="mid"><b>${esc(i.title)}</b><p>${esc(i.detail)}</p>${i.state?`<span class="dim" style="font-size:12px">${i.kind==="mention"?"Opened":i.state}</span>`:`<div class="acts">${i.opts.map((o,k)=>Btn(esc(o),{act:"resolve",size:"sm",kind:k?"":"primary",a:{"data-id":i.id,"data-o":o}})).join("")}${Btn("Open chat",{act:"ib-open",size:"sm",kind:"ghost",a:{"data-id":i.id}})}</div>`}</div></div>`};
  const html=`<div class="lbl">Waiting for you · ${pend.length}</div>${pend.length?pend.map(row).join(""):Empty("Nothing waiting. You're all caught up.",{mascot:mascot("cloud","#a58bfa",46,{asleep:true})})}${done.length?`<hr><div class="lbl">Handled</div>${done.map(row).join("")}<div style="padding:4px 6px">${Btn("Clear handled",{act:"ib-clear",size:"sm",kind:"ghost"})}</div>`:""}`;
  const p=pop(a,html,{cls:"wide"});S.ibOpen=true;return p;
}
Object.assign(ACT,{
  inbox:()=>{S.ibOpen?closePop():openInbox()},
  "ib-open":el=>{const it=S.inbox.find(i=>i.id===el.dataset.id);openConv(it.conv)},
  "ib-clear":()=>{S.inbox=S.inbox.filter(i=>!i.state);openInbox()},
  palette:()=>openPalette(),
  plusmenu:el=>plusMenu(el),
  wsmenu:()=>wsMenu(),
  me:el=>meMenu(el),
  settings:()=>openSettings("prefs"),
  open:el=>{if(S.justDragged)return;const id=el.dataset.id;if(S.sel.size&&el.classList.contains("cv")){S.sel.has(id)?S.sel.delete(id):S.sel.add(id);return rSide()}openConv(id)},
  filter:el=>{S.filter=el.dataset.v;rSide({fresh:true})},
  "sel-read":()=>{S.sel.forEach(i=>S.unread.delete(i));S.sel.clear();rSide();toast("Marked as read",{icon:"check",ms:1400})},
  "sel-hide":()=>{const ids=[...S.sel];ids.forEach(i=>S.hidden.add(i));S.sel.clear();if(S.hidden.has(S.conv))openConv(visibleConvs()[0]||S.conv);else rSide();toast(`${ids.length} hidden`,{icon:"eyeoff",action:"Undo",onAction:()=>{ids.forEach(i=>S.hidden.delete(i));rSide()}})},
  "sel-done":()=>{S.sel.clear();rSide()},
  "show-hidden":()=>{S.hidden.clear();rSide();toast("All chats shown",{ms:1300})},
  plugins:()=>openPlugins(),
});

/* ───────── jump palette: recent faces when empty, grouped matches with the query lit up ───────── */
const PAL={tab:"all",q:"",i:0,items:[]};
S.recent=["atlas","ada","#launch","mila","hugo"];
const hl=t=>{const e=esc(t);if(!PAL.q.trim())return e;const q=PAL.q.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return e.replace(new RegExp(`(${q})`,"ig"),"<mark>$1</mark>")};
function openPalette(tab="all"){
  closePop();PAL.tab=tab;PAL.q="";PAL.i=0;
  const tabs=[["all","All"],["agents","Agents"],["channels","Channels"],["messages","Messages"],["files","Files"],["routines","Routines"]];
  const v=veil(`<div class="pal"><div class="q">${ic("search",18)}<input data-in="pal-q" placeholder="Search or jump to…" autofocus>${Kbd("esc")}</div><div class="filt">${tabs.map(([k,n])=>Pill(n,{act:"pal-tab",on:k===tab,a:{"data-t":k}})).join("")}</div><div class="res" id="palres">${skel(4)}</div><div class="kb"><span>${Kbd("↑")}${Kbd("↓")}to move</span><span>${Kbd("↵")}to open</span><span style="margin-left:auto">${Kbd("⌘")}${Kbd("K")}anywhere</span></div></div>`,{top:true});
  v.isPal=true;later(120,()=>palFill());
}
function palItems(){
  const q=PAL.q.toLowerCase().trim(),w=WS[S.ws],T=PAL.tab,out=[];const has=s=>!q||s.toLowerCase().includes(q);
  const add=(g,html,sub,run,{chk,meta}={})=>out.push({g,html,sub,run,chk,meta});
  const icn=n=>`<span class="ico">${ic(n,17)}</span>`;
  if(["all","agents"].includes(T)&&(q||T==="agents"))w.convs.filter(i=>!isCh(i)).forEach(i=>{const a=AG[i];if(has(a.name+" "+a.role))add("Agents",face(a,28),`<b>${hl(a.name)}</b><span class="s">${hl(a.role)} · ${ENG[a.cli]} · ${a.model}</span>`,()=>openConv(i),{meta:statusLine(a)})});
  if(["all","channels"].includes(T)&&(q||T==="channels"))w.convs.filter(isCh).forEach(i=>{const c=CH[i];if(has(c.name+" "+c.purpose))add("Channels",HashTile(c,28),`<b>#${hl(c.name)}</b><span class="s">${hl(c.purpose)}</span>`,()=>openConv(i),{meta:`${c.members.length} agents`})});
  if(["all","messages"].includes(T)&&q.length>1)w.convs.forEach(cv=>chatOf(cv).forEach(m=>{if(m.text&&!m.kind&&m.text.toLowerCase().includes(q))add("Messages",Lead(cv,28),`<b>${convName(cv)}</b><span class="s">${hl(m.text.replace(/\*\*/g,"").slice(0,90))}</span>`,()=>openConv(cv,{jumpTo:m.id}),{meta:m.t})}));
  if(T==="files"||(T==="all"&&q.length>1))w.convs.forEach(cv=>chatOf(cv).forEach(m=>{if(m.file&&has(m.file.name))add("Files",icn("doc"),`<b>${hl(m.file.name)}</b><span class="s">${convName(cv)} · ${m.file.size}</span>`,()=>{openConv(cv);later(300,()=>{S.panel={k:"file",id:m.id};showPanel()})})}));
  if(T==="files")PRS.forEach(p=>{if(has(p.title))add("Files",icn("pr"),`<b>${hl(p.title)}</b><span class="s">${p.repo} #${p.num}</span>`,()=>{S.panel={k:"pr",id:p.id};showPanel()})});
  if(["all","routines"].includes(T))ROUTINES.forEach(r=>{if(has(r.title))if(T==="routines"||q)add("Routines",icn("clock"),`<b>${hl(r.title)}</b><span class="s">${AG[r.agent].name} · ${when(r)}</span>`,()=>openRoutines())});
  if(T==="all"){
    const A=[["plus","New agent",()=>newAgent(),"⌘N"],["people","New channel",()=>channelEditor()],["clock","New routine",()=>routineEditor()],["phone",`Call ${convName(S.conv)}`,()=>startCall(S.conv)],["hand","What's waiting for you",()=>setTimeout(openInbox,50),"⇧⌘I"],["plug","Connect apps",()=>openPlugins()],["pr","Pull requests",()=>openPRs()],["gear","Settings",()=>openSettings("prefs"),"⌘,"],
      ["monitor",S.computer?"Turn the computer off":"Turn the computer on",()=>{S.computer=!S.computer;toast(`Agents' computer is ${S.computer?"on":"off"}`,{icon:"monitor"})}],
      ...Object.entries(CMD).map(([k,n])=>["term",`Commands on this Mac: ${n}`,()=>{S.cmd=k;toast(`Commands: ${n}`,{icon:"term"})},"",S.cmd===k]),
      ...[["system","System"],["dark","Dark"],["light","Light"]].map(([k,n])=>["sun",`Theme: ${n}`,()=>setTheme(k),"",S.theme===k])];
    A.filter(a=>q?has(a[1]):!/^(Commands|Theme)/.test(a[1])).forEach(a=>add(q?"Actions":"Suggested",icn(a[0]),`<b>${hl(a[1])}</b>`,a[2],{chk:a[4],meta:a[3]?Kbd(a[3]):""}));
  }
  return out;
}
function palFill(){
  const box=$("#palres");if(!box)return;PAL.items=palItems();
  const recent=!PAL.q.trim()&&PAL.tab==="all"?`<div class="gl">Jump back in</div><div class="recent">${S.recent.filter(id=>WS[S.ws].convs.includes(id)).slice(0,5).map(id=>`<button class="rc" data-act="pal-open" data-id="${id}">${Lead(id,34)}<b>${esc(isCh(id)?CH[id].name:AG[id].name)}</b></button>`).join("")}</div>`:"";
  if(!PAL.items.length&&!recent){box.innerHTML=Empty(`Nothing matches “${esc(PAL.q)}”.`,{action:Btn(`Ask ${convName(S.conv)} instead`,{act:"pal-ask",size:"sm"})});return}
  let g="";box.innerHTML=recent+PAL.items.map((it,i)=>{const h=it.g!==g?`<div class="gl">${it.g}</div>`:"";g=it.g;return `${h}<div class="it ${i===PAL.i?"on":""}" data-act="pal-run" data-i="${i}">${it.html}<div style="min-width:0">${it.sub}</div><span class="go">${it.chk?ic("check",15):""}${it.meta?`<span class="meta">${it.meta}</span>`:""}<span class="ent">${Kbd("↵")}</span></span></div>`}).join("");
  $(".it.on",box)?.scrollIntoView({block:"nearest"});
}
const palRun=i=>{const it=PAL.items[i];if(!it)return;closeAllVeils();it.run()};
Object.assign(ACT,{
  "pal-tab":el=>{PAL.tab=el.dataset.t;PAL.i=0;$$(".pal .filt .pill").forEach(b=>b.classList.toggle("on",b===el));$("#palres").innerHTML=skel(3);later(100,palFill);$(".pal .q input").focus()},
  "pal-run":el=>palRun(+el.dataset.i),
  "pal-open":el=>{closeAllVeils();openConv(el.dataset.id)},
  "pal-ask":()=>{const q=PAL.q;closeAllVeils();const t=ta();t.value=q;S.drafts[S.conv]=q;t.focus();syncSend()},
});
INPUT["pal-q"]=v=>{PAL.q=v;PAL.i=0;palFill()};
document.addEventListener("mousemove",e=>{const it=e.target.closest?.(".pal .it");if(it&&!it.classList.contains("on")){PAL.i=+it.dataset.i;$$(".pal .it").forEach(x=>x.classList.toggle("on",x===it))}});
