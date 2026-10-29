/* ───────── every action, by name ───────── */
const cur=()=>AG[S.agent];
const msgText=el=>$(".body",el.closest(".msg"))?.innerText.trim()||"";
const ACT={
  palette:()=>{S.overlay="pal";render()},
  newch:()=>{S.chedit=null;S.overlay="newch";render()},
  newagent:()=>{DRAFT=freshDraft();S.overlay="new";render()},
  settings:()=>{closeDrawer();S.overlay="settings";render()},
  settingsp:el=>{closeDrawer();S.settings=el.dataset.p;S.overlay="settings";render()},
  status:el=>menu(el,["#Status",...Object.keys(STATUS).map(s=>[null,s,()=>{ME.status=s;renderSide();toast(s==="Available"?"You're available":s==="Focus"?"Focus: agents hold non-urgent pings":"Away: agents queue what needs you",{icon:"bell"})},{html:`<i style="width:8px;height:8px;border-radius:50%;background:${STATUS[s]}"></i>`,chk:ME.status===s}]),"hr",["user","Profile",()=>{S.settings="profile";ACT.settings()}],["gear","Settings",()=>ACT.settings(),{s:"⌘,"}]],{place:"above"}),
  go:el=>{closeDrawer();S.view=el.dataset.v;render()},
  openprofile:()=>{S.view="profile";S.ptab="overview";render()},
  openagentp:el=>{closeDrawer();closeModal();S.agent=el.dataset.id;S.view="profile";S.ptab="overview";render()},
  openagent:el=>{closeDrawer();openAgent(el.dataset.id)},
  openaccess:el=>{closeDrawer();S.agent=el.dataset.id;S.view="profile";S.ptab="access";render();$("#prof").scrollTop=380},
  backchat:()=>{S.view="chat";render()},
  tab:el=>{S.ptab=el.dataset.tab;render()},
  model:el=>{const a=cur();menu(el,[`#${a.cli} models`,...MODELS[a.cli].map(m=>[null,m,()=>{a.model=m;render();toast(`${a.name} uses ${m} from the next message`,{icon:"spark"})},{chk:m===a.model}])])},
  effort:el=>{const a=cur();menu(el,["#Effort",...["Low","Medium","High"].map(m=>[null,m,()=>{a.effort=m;render()},{chk:m===a.effort,s:{Low:"fastest",Medium:"default",High:"thinks longer"}[m]}])])},
  perm:()=>{S.view="profile";S.ptab="access";render()},
  lockinfo:()=>toast("An agent's CLI and folder are fixed. Make a new agent to change them.",{icon:"lock"}),
  movews:el=>{const a=cur();menu(el,["#Move to workspace",...WORKSPACES.map((w,i)=>[null,w.name,()=>{if(i===S.ws)return;WORKSPACES[S.ws].agents=WORKSPACES[S.ws].agents.filter(k=>k!==a.id);w.agents.push(a.id);S.ws=i;render();toast(`${a.name} moved to ${w.name}`,{icon:"out"})},{html:logoHTML(w,18),chk:i===S.ws}])])},
  agentmore:el=>{const a=cur();menu(el,[["pin","Pin to top",()=>{const l=WORKSPACES[S.ws].agents;l.splice(l.indexOf(a.id),1);l.unshift(a.id);renderSide();toast(`${a.name} pinned`,{icon:"pin"})}],["bell",a.muted?"Unmute":"Mute",()=>{a.muted=!a.muted;render();toast(a.muted?`${a.name} muted. It still works, quietly.`:`${a.name} unmuted`,{icon:"bell"})}],["out","Export chat",()=>toast(`Saved ${a.id}-chat.md to Downloads`,{icon:"out"})],"hr",["trash","Clear chat",()=>confirmBox(`Clear ${a.name}'s chat?`,`The page goes blank. ${a.name} keeps its memory and instructions.`,"Clear",clearChat)],["x",`Remove ${a.name}`,()=>confirmBox(`Remove ${a.name}?`,`Its memory and instructions are deleted. Its conversations stay on disk.`,"Remove agent",()=>{const l=WORKSPACES[S.ws].agents;l.splice(l.indexOf(a.id),1);S.agent=l[0];S.view=l.length?"chat":"inbox";render();toast(`${a.name} removed`,{icon:"trash"})},{type:a.name}),{red:true}]],{align:"right"})},
  react:el=>emojiPop(el,e=>addReaction(el.closest(".msg"),e),{align:"right"}),
  rx:el=>toggleRx(el),
  reply:el=>startReply(el.closest(".msg")),
  replyx:()=>{cancelReply();$("[data-ta]")?.focus()},
  jump:el=>{const m=document.getElementById(el.dataset.to);if(!m)return toast("That message is no longer here",{ms:1600});m.scrollIntoView({block:"center",behavior:"smooth"});m.classList.remove("flash");void m.offsetWidth;m.classList.add("flash")},
  copy:el=>{navigator.clipboard?.writeText(msgText(el)).catch(()=>{});toast("Copied",{icon:"copy",ms:1600})},
  msgmore:el=>{const m=el.closest(".msg");const a=AG[m.dataset.a]||cur();menu(el,[["spark","Remember this",()=>{const t=msgText(el);NOTES.unshift({t:t.slice(0,38)+(t.length>38?"…":""),tag:"Project",w:"just now",s:t.slice(0,90),used:0,body:`<p>${esc(t)}</p>`});toast(`${a.name} saved it to memory`,{icon:"spark",action:"Open",onAction:()=>{S.agent=a.id;S.view="profile";S.ptab="memory";S.note=0;render()}})}],["link","Copy link",()=>toast("Link copied",{icon:"link",ms:1600})],["clock","Make it a routine",()=>{S.view="routines";render();routineEditor(null,msgText(el))}],"hr",["trash","Delete message",()=>{const html=m.outerHTML,prev=m.previousElementSibling;m.remove();save();toast("Message deleted",{action:"Undo",onAction:()=>{prev?prev.insertAdjacentHTML("afterend",html):$("#feed .col").insertAdjacentHTML("afterbegin",html);save()}})},{red:true}]],{align:"right"})},
  fmt:el=>wrapSel($("[data-ta]",el.closest("[data-dock]")),el.dataset.f),
  attach:el=>pickFile("*/*",f=>{$(".atts",el.closest("[data-dock]")).insertAdjacentHTML("beforeend",`<span class="att" data-name="${esc(f.name)}">${ic("clip",12)}${esc(f.name)}<em>${kb(f.size)}</em><button data-act="att-x">${ic("x",10)}</button></span>`)}),
  "att-x":el=>el.closest(".att").remove(),
  emoji:el=>{const ta=$("[data-ta]",el.closest("[data-dock]"));emojiPop(el,e=>{const p=ta.selectionStart;ta.value=ta.value.slice(0,p)+e+ta.value.slice(p);ta.focus();ta.selectionStart=ta.selectionEnd=p+e.length},{place:"above"})},
  at:el=>{const ta=$("[data-ta]",el.closest("[data-dock]"));const p=ta.selectionStart;const pre=ta.value.slice(0,p);const add=(pre&&!/\s$/.test(pre)?" ":"")+"@";ta.value=pre+add+ta.value.slice(p);ta.focus();ta.selectionStart=ta.selectionEnd=p+add.length;suggest(ta)},
  mic:el=>toggleMic(el),
  send:el=>send(el.closest("[data-dock]")),
  file:el=>openFile(el.dataset.f),
  takeover:()=>takeOver(),
  stop:()=>stopAgent(),
  xchg:()=>xchgDrawer(),
  "inl-approve":el=>resolve(el.dataset.id,"PUBLISHED"),
  "inl-deny":el=>resolve(el.dataset.id,"NOT NOW"),
  chmembers:()=>channelMembers(),
  chm:el=>{const c=CH[S.channel];const id=el.dataset.id;if(c.members.includes(id)){if(c.members.length===1)return toast("A channel needs at least one agent");c.members=c.members.filter(k=>k!==id);if(c.lead===id)c.lead=c.members[0]}else c.members.push(id);el.classList.toggle("on",c.members.includes(id));toast(`${AG[id].name} ${c.members.includes(id)?"joined":"left"} #${c.name}`,{icon:"people",ms:1600})},
  chmore:el=>{const c=CH[S.channel];menu(el,[["pen","Edit channel",()=>{S.chedit=S.channel;S.overlay="newch";render()}],["bell",c.muted?"Unmute":"Mute",()=>{c.muted=!c.muted;render()}],["out","Export",()=>toast(`Saved ${c.name}.md to Downloads`,{icon:"out"})],"hr",["trash","Archive channel",()=>confirmBox(`Archive #${c.name}?`,"It leaves the sidebar. Agents stop answering in it. You can bring it back from Jump to.","Archive",()=>{const w=WORKSPACES[S.ws];w.channels=w.channels.filter(k=>k!==S.channel);S.view="inbox";render();toast(`#${c.name} archived`)}),{red:true}]],{align:"right"})},
  task:el=>taskDrawer(+el.dataset.t),
  taskmsg:el=>{closeDrawer();openAgent(el.dataset.id)},
  editlook:()=>{const a=cur();DRAFT={...freshDraft(),edit:a.id,name:a.name,role:a.role,kind:a.kind,color:a.color};S.overlay="new";render()},
  note:el=>{S.ptab="memory";S.note=+el.dataset.n;S.mtag="all";S.mq="";render()},
  noteopen:el=>{S.note=+el.dataset.n;render()},
  mtag:el=>{S.mtag=el.dataset.v;render()},
  tidy:el=>progress(el,"Tidying",1400,()=>{$("[data-tidied]").textContent="Tidied just now";toast("Merged 2 notes that said the same thing, dropped 1 stale one",{icon:"moon"})}),
  newnote:()=>{NOTES.unshift({t:"New note",tag:"Project",w:"just now",s:"",used:0,body:"<p>Write what the agent should remember.</p>"});S.note=0;S.mtag="all";S.mq="";render();ACT.noteedit($("[data-act=noteedit]"))},
  noteedit:el=>{const t=$("[data-nt]"),b=$("[data-nb]");[t,b].forEach(x=>{x.contentEditable="true";x.style.outline="none";x.style.borderRadius="6px";x.style.boxShadow="0 0 0 1px var(--line3)";x.style.padding="2px 6px"});b.focus();el.outerHTML=`<button class="btn sm solid" data-act="notesave">${ic("check",11)} Save</button>`},
  notesave:()=>{const n=NOTES[S.note];n.t=$("[data-nt]").innerText.trim()||n.t;n.body=$("[data-nb]").innerHTML;n.s=$("[data-nb]").innerText.slice(0,90);n.w="just now";render();toast("Saved. The agent reads it from the next message.",{icon:"check"})},
  noteforget:()=>{const n=NOTES[S.note];confirmBox(`Forget “${n.t}”?`,`${cur().name} stops knowing this from the next message.`,"Forget",()=>{const i=S.note;NOTES.splice(i,1);S.note=0;render();toast("Forgotten",{icon:"trash",action:"Undo",onAction:()=>{NOTES.splice(i,0,n);S.note=i;render()}})})},
  snip:el=>{const db=$(".doc .db");db.insertAdjacentHTML("beforeend",`<p>${el.textContent.replace("+ ","")}.</p>`);db.dispatchEvent(new Event("input"));el.remove()},
  version:el=>{const v=el.dataset.v;menu(el,[["eye","Compare with now",()=>drawer({title:`${v} → V${IVER}`,sub:"instructions.md",width:560,body:`<div class="diff"><div class="h">@@ instructions.md @@</div><div>  ## Como responder</div><div class="d">- Respostas longas com todo o raciocínio.</div><div class="a">+ Português, direto, frases curtas.</div><div class="a">+ Termine sempre com uma recomendação e o risco dela.</div><div>  ## Não faça</div></div>`,foot:`<button class="btn solid push" data-x2>Close</button>`})],["refresh",`Restore ${v}`,()=>{IVER++;VERS.unshift([`V${IVER}`,`Restored ${v}`,"just now"]);render();toast(`Restored ${v} as V${IVER}`,{icon:"refresh"})}]],{align:"right"})},
  "perm-set":el=>{const a=cur();a.perm=el.dataset.v;render();toast(`${a.name}: ${PERM[a.perm][0]} — ${PERM[a.perm][1].toLowerCase()}`,{icon:"shield"})},
  addrule:()=>{const m=modal(`<div><h2>Always ask before…</h2><div class="lead">${cur().name} stops and asks you whenever it is about to do this.</div></div><input class="input" data-v placeholder="Sending money, emailing a customer…"><div class="foot"><button class="btn" data-x>Cancel</button><button class="btn solid" data-ok>Add</button></div>`);$("[data-ok]",m).onclick=()=>{const v=$("[data-v]",m).value.trim();if(!v)return;ALWAYS.push([v,true]);closeModal();render()}},
  addfolder:()=>folderPicker(p=>{FOLDERS.push([p,"read only"]);render();toast(`${cur().name} can read ${p}`,{icon:"folder"})}),
  folderrw:el=>{const f=FOLDERS[+el.dataset.i];f[1]=f[1]==="read only"?"read · write":"read only";render()},
  folderrm:el=>{const i=+el.dataset.i;const f=FOLDERS.splice(i,1)[0];render();toast(`Removed ${f[0]}`,{action:"Undo",onAction:()=>{FOLDERS.splice(i,0,f);render()}})},
  budget:()=>{const m=modal(`<div><h2>${cur().name}'s monthly budget</h2><div class="lead">At 80% you get a ping. At 100% ${cur().name} pauses and asks.</div></div><div style="display:flex;align-items:center;gap:8px"><span class="mono">US$</span><input class="input mono" data-v type="number" value="${BUDGET}" style="width:120px"></div><div class="foot"><button class="btn" data-x>Cancel</button><button class="btn solid" data-ok>Save</button></div>`);$("[data-ok]",m).onclick=()=>{BUDGET=Math.max(1,+$("[data-v]",m).value||BUDGET);closeModal();render()}},
  afilter:el=>{S.afilter=el.dataset.v;render()},
  heat:el=>toast(`${el.dataset.v} messages that day`,{ms:1400}),
  ifilter:el=>{S.ifilter=el.dataset.v;S.inbox=undefined;render()},
  iopen:el=>{S.inbox=el.dataset.id;render()},
  iresolve:el=>{closeDrawer();resolve(el.dataset.id,el.dataset.v)},
  ialways:el=>{toast("Ada won't ask again for pushes to fix/* branches",{icon:"shield"});resolve(el.dataset.id,"ALLOWED")},
  ianswer:el=>resolve(el.dataset.id,"ANSWERED",el.dataset.c),
  ifree:el=>{const v=$("[data-ifree]").value.trim();if(!v)return $("[data-ifree]").focus();resolve(el.dataset.id,"ANSWERED",v)},
  ireply:el=>{const v=$("[data-ifree]").value.trim();if(!v)return $("[data-ifree]").focus();const k="#launch";CHATS[k]=(CHATS[k]??channelBody(CH.launch))+you(fmtText("@Leo "+v),now());resolve(el.dataset.id,"REPLIED")},
  ich:el=>{S.channel=el.dataset.v;S.view="channel";render()},
  iarchive:el=>{const it=INBOX.find(x=>x.id===el.dataset.id);it.archived=true;S.inbox=undefined;render();toast("Archived",{action:"Undo",onAction:()=>{it.archived=false;S.inbox=it.id;render()}})},
  iundo:el=>{const it=INBOX.find(x=>x.id===el.dataset.id);Object.assign(it,{state:"open",res:null,resAt:null});S.cleared--;if(it.id==="i1")AG.mila.ask=true;render()},
  inav:el=>inboxNav(+el.dataset.d),
  readall:()=>{const ms=INBOX.filter(x=>x.state==="open"&&x.kind==="mention");if(!ms.length)return toast("No mentions to mark",{ms:1400});ms.forEach(x=>Object.assign(x,{state:"done",res:"READ",resAt:now(),ok:true}));render();toast(`${ms.length} mention${ms.length>1?"s":""} marked read`,{icon:"check"})},
  meterdiff:()=>meterDiff(),
  askwhy:el=>{const it=INBOX.find(x=>x.id===el.dataset.id);S.agent=it.a;S.view="chat";render();const ta=$("[data-ta]");ta.value="Antes do push: ";ta.focus()},
  rfilter:el=>{S.rfilter=el.dataset.v;render()},
  rnew:()=>routineEditor(null),
  redit:el=>routineEditor(R(el.dataset.r)),
  ck:el=>chipPop(el,R(el.dataset.r),el.dataset.k),
  rrun:el=>{closeDrawer();runRoutine(R(el.dataset.r))},
  rtog:el=>{const r=R(el.dataset.r);r.on=!r.on;render();toast(r.on?`${r.name} is on. Next: ${nextText(r)}`:`${r.name} paused`,{icon:r.on?"play":"pause"})},
  rmore:el=>{const r=R(el.dataset.r);menu(el,[["pen","Edit",()=>routineEditor(r)],["play","Run now",()=>runRoutine(r)],["dup","Duplicate",()=>{const c=JSON.parse(JSON.stringify(r));c.id="r"+Date.now();c.name+=" copy";c.on=false;c.extra=[];ROUT.splice(ROUT.indexOf(r)+1,0,c);render();toast(`${c.name} made, paused`,{icon:"dup"})}],"hr",["trash","Delete",()=>ACT.rdel(el),{red:true}]],{align:"right"})},
  runinfo:el=>runInfo(R(el.dataset.r),+el.dataset.d,+el.dataset.h,el.dataset.st),
  rskip:el=>{const r=R(el.dataset.r);closeDrawer();r.days=r.days.length>1?r.days.filter(d=>d!==+el.dataset.d):r.days;render();toast(`Skipped ${DAYN[+el.dataset.d]}'s run`,{icon:"x"})},
  rdel:el=>{const r=R(el.dataset.r);confirmBox(`Delete ${r.name}?`,`${AG[r.a].name} stops doing this. Past results stay where they were posted.`,"Delete routine",()=>{const i=ROUT.indexOf(r);ROUT.splice(i,1);closeDrawer();render();toast(`${r.name} deleted`,{icon:"trash",action:"Undo",onAction:()=>{ROUT.splice(i,0,r);render()}})})},
  ptab:el=>{S.ptype=el.dataset.v;S.pq="";render()},
  popen:el=>pluginDrawer(P(el.dataset.p)),
  pconnect:el=>connectFlow(P(el.dataset.p)),
  cell:el=>{const p=P(el.dataset.p),a=AG[el.dataset.a];const on=!p.used.includes(a.id);p.used=on?[...p.used,a.id]:p.used.filter(k=>k!==a.id);el.classList.toggle("on",on);el.innerHTML=on?ic("check",12,"#111",3):"";const c=$("[data-mcount]");if(c){const n=$$(".matrix .cell.on").length;c.textContent=`${n} of ${$$(".matrix .cell").length} on`}toast(`${a.name} ${on?"can":"can no longer"} use ${p.name}`,{icon:on?"check":"x",ms:1600})},
  ptog:el=>{const p=P(el.dataset.p),id=el.dataset.a;p.used=p.used.includes(id)?p.used.filter(k=>k!==id):[...p.used,id];el.classList.toggle("on",p.used.includes(id))},
  pdisconnect:el=>{const p=P(el.dataset.p);confirmBox(`Disconnect ${p.name}?`,`${p.used.length} agent${p.used.length===1?"":"s"} lose its tools from the next message. hz forgets the token.`,"Disconnect",()=>{p.on=false;p.used=[];closeDrawer();render();toast(`${p.name} disconnected`,{icon:"plug"})})},
  reconnect:el=>progress(el,"Reconnecting",1000,()=>toast("Reconnected. Token refreshed.",{icon:"refresh"})),
  addmcp:()=>addMcp(),
  sopen:el=>skillDrawer(SKILLS.find(s=>s.id===el.dataset.s)),
  snew:()=>skillDrawer(null),
  theme:el=>{THEME=el.dataset.v;renderSettings();toast(THEME==="Dark"?"Dark it is":`${THEME} theme will follow in the build — the mockup stays dark`,{icon:"moon"})},
  rebind:el=>{el.textContent="Press keys…";el.style.borderColor="var(--ink2)";const h=e=>{e.preventDefault();e.stopPropagation();if(["Meta","Shift","Control","Alt"].includes(e.key))return;const k=(e.metaKey?"⌘":"")+(e.shiftKey?"⇧":"")+(e.altKey?"⌥":"")+(e.ctrlKey?"⌃":"")+e.key.toUpperCase();SHORTS[+el.dataset.i][1]=k;document.removeEventListener("keydown",h,true);renderSettings();toast(`${SHORTS[+el.dataset.i][0]} is now ${k}`,{icon:"check"})};document.addEventListener("keydown",h,true)},
  photo:()=>pickFile("image/*",f=>readImage(f,u=>{ME.photo=u;renderSide();renderSettings()})),
  photorm:()=>{ME.photo=null;renderSide();renderSettings()},
  wslogo:()=>pickFile("image/*",f=>readImage(f,u=>{WORKSPACES[S.ws].photo=u;renderSide();renderSettings()})),
  wslogorm:()=>{WORKSPACES[S.ws].photo=null;renderSide();renderSettings()},
  wsgen:()=>{const w=WORKSPACES[S.ws];w.photo=null;w.color=COLORS[(COLORS.indexOf(w.color)+1)%COLORS.length];w.name=w.name;renderSide();renderSettings()},
  invite:()=>{const m=modal(`<div><h2>Invite to ${WORKSPACES[S.ws].name}</h2><div class="lead">They can talk to these agents and see the channels. Only you change settings.</div></div><input class="input" data-v type="email" placeholder="name@example.com"><div class="foot"><button class="btn" data-x>Cancel</button><button class="btn solid" data-ok>Send invite</button></div>`);$("[data-ok]",m).onclick=()=>{const v=$("[data-v]",m).value.trim();if(!/.+@.+\..+/.test(v))return $("[data-v]",m).focus();WORKSPACES[S.ws].members.push(v);closeModal();renderSettings();toast(`Invite sent to ${v}`,{icon:"user"})}},
  uninvite:el=>{WORKSPACES[S.ws].members.splice(+el.dataset.i,1);renderSettings()},
  wsdel:()=>{const w=WORKSPACES[S.ws];if(WORKSPACES.length===1)return toast("You need at least one workspace");confirmBox(`Delete ${w.name}?`,`${w.agents.length} agents and their memory are deleted. Conversations stay on disk.`,"Delete workspace",()=>{WORKSPACES.splice(S.ws,1);S.ws=0;S.agent=WORKSPACES[0].agents[0];S.view="inbox";S.overlay=null;render();toast(`${w.name} deleted`,{icon:"trash"})},{type:w.name})},
  defcli:el=>{DRAFT.cli=el.dataset.v;renderSettings()},
  deffolder:()=>folderPicker(p=>{DRAFT.dir=p;renderSettings()}),
  testnote:()=>toast(`${AG.atlas.name}: “Weekly numbers are in #general.”`,{icon:"bell"}),
  exportcsv:()=>toast("Saved hz-usage-october.csv to Downloads",{icon:"out"}),
  cliupd:el=>{const c=CLIS[el.dataset.n];progress(el,"Updating",1600,()=>{c.ver=c.upd;c.upd="";renderSettings();toast(`${el.dataset.n} updated to ${c.ver}`,{icon:"check"})})},
  clicheck:el=>progress(el,"Checking",900,()=>toast(`${el.dataset.n} ${CLIS[el.dataset.n].ver} is the latest`,{icon:"check"})),
  clisign:el=>{const n=el.dataset.n,c=CLIS[n];if(c.acct)confirmBox(`Sign out of ${n}?`,`Agents on ${n} stop until you sign in again.`,"Sign out",()=>{c.acct="";renderSettings()});else progress(el,"Waiting for browser",1400,()=>{c.acct="you@example.com";renderSettings();toast(`Signed in to ${n}`,{icon:"check"})})},
  cliinstall:el=>{const n=el.dataset.n;progress(el,"Installing",1800,()=>{CLIS[n]={ver:"1.0.0",path:`~/.hz/adapters/${n.toLowerCase()}`,acct:"",via:`ACP · ${n.toLowerCase()} acp`,upd:""};delete MORE_CLIS[n];renderSettings();toast(`${n} installed. Sign in to use it.`,{icon:"check"})})},
};
Object.assign(ACT,PR_ACT);
const SEGS={
  status:v=>{ME.status=v;renderSide()},
  chlead:v=>{CH[S.channel].lead=v},
  chrounds:v=>{CH[S.channel].rounds=+v},
  tool:(v,b)=>{const s=b.parentElement;P(s.dataset.p).tools[+s.dataset.i][1]=v},
  defperm:v=>{DRAFT.perm=ORDER.find(k=>PERM[k][0]===v)},
  textsize:v=>{document.documentElement.style.fontSize="";document.body.style.zoom=({13:.93,14:1,15:1.07,16:1.14})[v]},
  density:v=>{document.body.classList.toggle("compact",v==="Compact")},
};
function bindClose(){layer.querySelectorAll("[data-close]").forEach(b=>b.onclick=e=>{if(e.target===b||b.tagName==="BUTTON"){S.overlay=null;S.chedit=null;render()}})}
function fillSlots(){$$("[data-inlslot]").forEach(s=>s.innerHTML=inlineInner(s.dataset.inlslot))}

/* One listener answers every click: named actions first, then toggles and segments.
   Anything left that looks pressable says what it would do, so no button is dead. */
document.addEventListener("click",e=>{
  if(popFresh)popFresh=false;else if(popEl&&!popEl.contains(e.target))closePop();
  if(S.menu&&!e.target.closest(".menu")&&!e.target.closest("#wsbtn")){S.menu=false;layer.innerHTML=""}
  const t=e.target;
  const a=t.closest("[data-act]");
  if(a&&!a.disabled){ACT[a.dataset.act]?ACT[a.dataset.act](a,e):toast(`“${a.dataset.act}” has no action yet`);return}
  const tg=t.closest(".tog");if(tg&&!tg.onclick){tg.classList.toggle("on");return}
  const sb=t.closest(".seg button");if(sb&&!sb.onclick){const s=sb.parentElement;$$("button",s).forEach(x=>x.classList.toggle("on",x===sb));SEGS[s.dataset.seg]?.(sb.dataset.v??sb.textContent.trim(),sb);return}
  const b=t.closest("button");
  if(b&&!b.onclick&&!b.getAttribute("onclick")&&!b.closest("[data-close],.mock,.pop")&&!b.disabled)toast(`${(b.title||b.textContent).trim()||"Done"}`,{ms:1400});
});
document.addEventListener("keydown",e=>{
  const typing=e.target.matches("input,textarea,[contenteditable=true]");const mod=e.metaKey||e.ctrlKey;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();closePop();closeDrawer();closeModal();S.overlay="pal";render();return}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();closeDrawer();ACT.newagent();return}
  if(mod&&e.key===","){e.preventDefault();ACT.settings();return}
  if(mod&&e.shiftKey&&e.key.toLowerCase()==="i"){e.preventDefault();S.overlay=null;S.view="inbox";render();return}
  if(e.key==="Escape"){if(popEl)return closePop();if(modalEl)return closeModal();if(drawerEl)return closeDrawer();if(S.overlay||S.menu){S.overlay=null;S.menu=false;S.chedit=null;render()}return}
  if(typing||mod)return;
  if(S.view==="inbox"&&!S.overlay&&!modalEl&&!drawerEl){
    const k=e.key.toLowerCase();if(k==="j")return inboxNav(1);if(k==="k")return inboxNav(-1);
    $(`.dcard [data-key="${k}"]`)?.click();
  }
});

/* ───────── shell ───────── */
const VIEWS=[["chat","Chat"],["working","Working"],["profile","Profile"],["channel","Channel"],["inbox","Inbox"],["routines","Routines"],["prs","Pull requests"],["plugins","Plugins"],["pal","Jump to"],["new","New agent"],["newch","New channel"],["settings","Settings"],["switcher","Switcher"]];
function renderMock(){
  const cur2=S.overlay||(S.menu?"switcher":S.view==="chat"&&AG[S.agent].live?"working":S.view);
  mock.innerHTML=`<span>MOCKUP</span>`+VIEWS.map(([k,n])=>`<button class="${k===cur2?"on":""}" data-v="${k}">${n}</button>`).join("");
  mock.querySelectorAll("[data-v]").forEach(b=>b.onclick=e=>{
    e.stopPropagation();const v=b.dataset.v;S.overlay=null;S.menu=false;closePop();closeDrawer();closeModal();
    if(v==="chat"){S.agent="atlas";S.view="chat"}
    else if(v==="working"){S.agent="ada";AG.ada.live=true;S.view="chat"}
    else if(v==="profile"){S.agent="atlas";S.view="profile";S.ptab="overview"}
    else if(["channel","inbox","routines","prs","plugins"].includes(v))S.view=v;
    else if(v==="switcher")S.menu=true;
    else if(v==="new")DRAFT=freshDraft(),S.overlay="new";
    else S.overlay=v;
    render();
  });
}
function render(){
  if(S.view==="working")S.view="chat";
  if(!WORKSPACES[S.ws].agents.includes(S.agent)&&["chat","profile"].includes(S.view))S.agent=WORKSPACES[S.ws].agents[0]||S.agent;
  if(["chat","profile"].includes(S.view)&&!WORKSPACES[S.ws].agents.length)S.view="inbox";
  renderSide();
  ({chat:renderChat,profile:renderProfile,channel:renderChannel,inbox:renderInbox,routines:renderRoutines,prs:renderPRs,plugins:renderPlugins})[S.view]();
  fillSlots();if(["chat","channel"].includes(S.view))scrollFeed();
  layer.innerHTML=renderMenu();
  layer.querySelectorAll("[data-ws]").forEach(el=>el.onclick=()=>{S.ws=+el.dataset.ws;const w=WORKSPACES[S.ws];S.agent=w.agents[0];S.channel=w.channels[0]||S.channel;S.view=w.agents.length?"chat":"inbox";S.menu=false;render()});
  const wsx=layer.querySelector("[data-ws-set]");if(wsx)wsx.onclick=()=>{S.menu=false;S.overlay="settings";S.settings="workspace";render()};
  const wsn=layer.querySelector("[data-ws-new]");if(wsn)wsn.onclick=()=>{S.menu=false;layer.innerHTML="";newWorkspace()};
  ({new:renderNew,newch:renderNewChannel,pal:renderPalette,settings:renderSettings})[S.overlay]?.();
  renderMock();
}
render();
