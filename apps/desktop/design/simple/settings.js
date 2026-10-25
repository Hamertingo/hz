/* settings: a left rail and calm pages. Profile, Preferences, Workspace, Agents, Memories, Usage, CLIs, Updates. */
const PALS=[["default","Default","#e8e8e6","#2a2a2c"],["midnight","Midnight","#e6ebf8","#171f38"],["paper","Paper","#f1e9d8","#2a2622"],["forest","Forest","#e3eee6","#17221c"]];
const ACCENTS=[["agent","Agent colour","conic-gradient(#f58a3c,#ee73b2,#a58bfa,#38bdf8,#3ec46d,#f58a3c)"],["#3d66e6","Blue","#3d66e6"],["#e2a440","Yellow","#e2a440"],["#3ec46d","Green","#3ec46d"],["#ee73b2","Pink","#ee73b2"]];
const FONTS={Inter:'"Inter",system-ui,sans-serif',Geist:'"Geist",system-ui,sans-serif',System:'-apple-system,system-ui,sans-serif',Serif:'"Iowan Old Style",Georgia,serif'};
let SET={page:"prefs",v:null};
const ADV=["usage","clis"];
const VOICES=[["Sol","Warm, unhurried"],["Ravi","Clear and quick"],["Iris","Bright, friendly"],["Theo","Low and calm"],["Noa","Soft, close"],["Kit","Plain, neutral"]];
const RAIL=[["#You"],["profile","Profile","user"],["prefs","Preferences","gear"],["voice","Voice","volume"],["privacy","Privacy","lock"],["#Workspace"],["workspace","Workspace","layers"],["agents","Agents","bolt"],["memories","Memories","brain"],["usage","Usage & limits","usage"],["clis","CLIs","term"],["#hz"],["updates","Updates","download"]];

function applyTheme(){
  const dark=S.theme==="system"?matchMedia("(prefers-color-scheme: dark)").matches:S.theme==="dark";
  const r=document.documentElement;r.dataset.theme=dark?"dark":"light";
  if(S.pal==="default")delete r.dataset.pal;else r.dataset.pal=S.pal;
  r.style.setProperty("--sans",FONTS[S.font]||FONTS.Inter);
  const c=S.accent==="agent"?(isCh(S.conv)?AG[CH[S.conv].lead].color:AG[S.conv].color):S.accent;r.style.setProperty("--acc",c);
  const L=hx(c);r.style.setProperty("--accink",(L[0]*.3+L[1]*.6+L[2]*.1)>150?"#17120a":"#ffffff");
}
function setTheme(k){S.theme=k;applyTheme();if(SET.v)rSet();toast(`Theme: ${k[0].toUpperCase()+k.slice(1)}`,{icon:k==="light"?"sun":"moon",ms:1300})}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",applyTheme);

function openSettings(page="prefs"){
  closePop();closeAllVeils();if(ADV.includes(page))S.advanced=true;
  SET.page=page;SET.v=veil(`<div class="rail" id="rail"></div><div class="setmain"><div id="setbody" style="display:contents"></div></div>`,{cls:"set",width:920});
  SET.v.onclose=()=>{SET.v=null};rSet(true);
}
function rSet(skeleton){
  const v=SET.v;if(!v)return;
  $("#rail").innerHTML=RAIL.filter(r=>S.advanced||!ADV.includes(r[0])).map(([k,n,i])=>k[0]==="#"?`<div class="rh">${k.slice(1)}</div>`:`<button class="${SET.page===k?"on":""}" data-act="set-page" data-p="${k}">${ic(i,16)}${n}</button>`).join("");
  const title=RAIL.find(r=>r[0]===SET.page)[1],sc=$(".mb",v)?.scrollTop||0;
  $("#setbody").innerHTML=`${Head(title)}${Body(skeleton?skel(5):PAGES[SET.page](),{id:"setmb"})}`;
  if(skeleton)later(240,()=>{if(SET.v===v&&$("#setmb")){$("#setmb").innerHTML=PAGES[SET.page]();$("#setmb").classList.add("rise")}});else $("#setmb").scrollTop=sc;
}
const sRow=(t,s,r,o={})=>Row({title:t,sub:s,right:r,...o});
const PAGES={
  profile:()=>`<div class="profcard">${Banner("#6a8cf0","me-"+ME.name,{rows:24})}<div class="bd">${Avatar(76)}<div class="tx"><b>${esc(ME.name)}</b><span>${ME.email}</span></div><div class="acts">${Btn("Upload photo",{act:"me-photo",icon:"image",size:"sm"})}${ME.photo?Btn("Remove",{act:"me-nophoto",size:"sm",kind:"ghost"}):""}</div></div></div>
    ${Section("About you",{cls:"mt"})}${Group(sRow("Name",null,`<input class="inl" data-in="me-name" value="${esc(ME.name)}">`,{icon:"user"})+sRow("Email",null,Val(ME.email),{icon:"mail"})+sRow("Language",null,Down(ME.lang),{icon:"globe",act:"me-lang"})+sRow("Status","Tells agents whether to hold non-urgent pings.",Down(`${Dot(STATUS[ME.status])} ${ME.status}`),{icon:"bell",act:"me-status"}))}`,
  prefs:()=>{
    const P=S.pref,t=k=>tog(k,P[k]);
    return `<div class="card1"><div class="tx"><b>Advanced mode</b><span>Shows Usage & limits and CLIs, plus the technical controls: tokens, spend, raw JSON for routines. Nothing is deleted either way.</span></div>${tog("advanced",S.advanced)}</div>
    <div class="card1">${Avatar(46)}<div class="tx"><b>${esc(ME.name)}</b><span>${ME.email}</span></div>${Btn("Edit profile",{act:"set-page",a:{"data-p":"profile"}})}${Btn("Sign out",{act:"signout",kind:"ghost"})}</div>
    <div class="card1"><span class="mac">${ic("laptop",22)}<i class="${P.pause?"off":""}"></i></span><div class="tx"><b>Agents are ready on this Mac</b><span>${P.pause?"Everything is paused":"Nothing running · 2 routines today"}</span></div><span class="val" style="font-size:13px;color:var(--ink2)">Pause all</span>${tog("pause",P.pause)}</div>
    ${Section("Appearance",{cls:"mt"})}${Group(sRow("Light or dark",null,Down({system:"Follow the system",light:"Light",dark:"Dark"}[S.theme]),{act:"pick-theme"})+sRow("Theme","The tone of backgrounds and text, in light and dark.",`<span class="themes">${PALS.map(([k,n,l,d])=>`<button class="${S.pal===k?"on":""}" data-act="pick-pal" data-v="${k}"><span class="sw"><i style="background:${l}"></i><i style="background:${d}"></i></span>${n}</button>`).join("")}</span>`)+sRow("Font",null,Down(S.font),{act:"pick-font"})+sRow("Accent","Your messages and the send button.",`<span class="acc">${ACCENTS.map(([k,n,c])=>`<button class="${S.accent===k?"on":""}" style="background:${c}" title="${n}" data-act="pick-accent" data-v="${k}"></button>`).join("")}</span>`))}
    ${Section("Conversation list")}${Group(sRow("Order","Pinned first, then your own order.",Down(S.order||"My order"),{act:"pick-order"})+sRow("Engine logo","Next to each agent's name.",t("logo"))+sRow("Change many engines","Switch the engine of several agents at once.",Btn("Change…",{act:"bulk-engine"})))}
    ${Section("Notices")}${Group(sRow("Notifications","When an agent finishes, asks or needs approval.",Btn("Open Mac settings",{act:"mac-settings"}))+sRow("Agent-to-agent chat","A quiet sound when one agent answers another. Questions and approvals always notify.",t("sound"))+sRow("Agents on screen","When an agent works or waits, it shows around the notch. Hover to approve, deny or answer without opening hz.",Down(S.island||"Island at the notch"),{act:"pick-island"})+sRow("Notch on the main screen","If the main screen has no notch, the island draws one in the menu bar.",t("notch"))+sRow("Also on external screens","On screens without a notch, the island sits in the middle of the menu bar.",t("extra")))}
    ${Group(sRow("Notices on your iPhone","Push through Bark, for apps without an Apple subscription.",Btn("Set up…",{act:"bark"})))}
    ${Section("System")}${Group(sRow("Microphone","For dictating messages.",Down(S.mic||"System default"),{act:"pick-mic"})+sRow("Connect an iPhone","Shows a QR for the iPhone app.",Btn("Show QR",{act:"show-qr"}))+sRow("Introduction","The first-launch screens.",Btn("Watch again",{act:"intro"})))}
    ${Section("Privacy")}${Group(sRow("End-to-end encryption","On: only your devices read the chats.",`${Btn("QR for iPhone",{act:"show-qr"})}${Btn("Code",{act:"show-code",kind:"ghost"})}`)+sRow("Crash reports","Where the app broke and on which version, nothing you wrote.",t("crash")))}
    ${Section("Account")}${Group(sRow("Password","Sign in on other devices without waiting for email.",Btn("Set password…",{act:"set-pw"}))+sRow("Export everything","Chats, agents and files, in one folder.",Btn("Export…",{act:"export"}))+sRow("Delete my account","Your agents, chats and cloud files are erased.",Btn("Delete",{act:"del-account",kind:"danger"})))}`},
  workspace:()=>{const w=WS[S.ws];return `${Group(sRow("Name",null,`<input class="inl" data-in="ws-rename" value="${esc(w.name)}">`,{lead:wsTile(w,S.ws,34)})+`<div class="row" style="display:block"><b style="font-weight:600;display:block">Context</b><span style="display:block;color:var(--ink3);font-size:12.5px;margin:1px 0 8px">What every agent in this workspace knows.</span>${Field({area:true,rows:3,in:"ws-ctx",value:w.ctx})}</div>`)}
    ${Section("Defaults here")}${Group(sRow("Commands on this Mac",null,Down(CMD[S.cmd]),{act:"ws-cmd",icon:"term"})+sRow("Agents' computer",null,tog("computer",S.computer),{icon:"monitor"}))}
    ${Section("In this workspace",{count:w.convs.filter(i=>!isCh(i)).length})}${Group(w.convs.filter(i=>!isCh(i)).map(i=>Row({lead:face(AG[i],34),title:AG[i].name,sub:`${AG[i].role} · ${ENG[AG[i].cli]}`,right:Next(),act:"edit-agent",id:i})).join(""))}
    ${Section("Danger")}${Group(sRow("Delete this workspace","Its agents and channels move to Personal.",Btn("Delete",{act:"del-ws",kind:"danger"})))}`},
  agents:()=>`${Section("New agents start with")}${Group(sRow("Engine",null,Down(ENG[S.defCli||"Claude"]),{act:"def-cli"})+sRow("Permission",null,Down(PERM[S.defPerm||"auto"][0]),{act:"def-perm"})+sRow("Commands on this Mac",null,Down(CMD[S.cmd]),{act:"ws-cmd"}))}
    ${Section("Skills")}${Search({in:"skq",placeholder:"Search skills"})}<div style="height:10px"></div>
    ${Group(Row({icon:"book",title:"Library",sub:`Every agent uses it · ${SKILLS.filter(s=>s.on).length} skills on`,right:Btn("Manage",{act:"skills-lib",size:"sm"})})+WS[S.ws].convs.filter(i=>!isCh(i)).map(i=>Row({lead:face(AG[i],34),title:AG[i].name,right:Next(AG[i].skills),act:"edit-skills",id:i})).join(""))}
    ${Section("Keys")}${Group(keysHTML(),{id:"keys"})}
    ${Section("Payments")}${Group(sRow("Agent card","Lets agents buy things within a limit you set.",Btn("Add a card",{act:"add-card"}))+sRow("Spending limit","Per agent, per month.",Down("$50"),{act:"pick-limit"}))}`,
  memories:()=>`${Section("Teach every agent")}${Group(`<div class="row">${Field({in:"teach",id:"teach",placeholder:"e.g. I prefer short answers"})}${Btn("Teach",{act:"teach",kind:"primary"})}</div>`)}
    <div class="sec"><b>What each agent kept</b><span style="margin-left:auto;width:210px">${Search({in:"memq",placeholder:"Search agents"})}</span></div>${Group(memListHTML(""),{id:"memlist"})}`,
  voice:()=>`${Section("The voice your agents speak with")}<div class="voices">${VOICES.map(([n,d],i)=>`<div role="button" class="vc ${(S.voice||"Sol")===n?"on":""}" data-act="pick-voice" data-v="${n}"><span class="wv">${Array.from({length:7},(_,k)=>`<i style="height:${5+((i+2)*(k+3))%13}px"></i>`).join("")}</span><div><b>${n}</b><span>${d}</span></div>${IconBtn("play",{act:"voice-try",size:"sm",title:"Listen",a:{"data-v":n}})}</div>`).join("")}</div>
    ${Section("Speaking")}${Group(sRow("Read replies aloud","Agents speak their answers when you dictated the question.",tog("aloud",S.pref.aloud))+sRow("Speed",null,Down(S.speed||"Normal"),{act:"pick-speed"})+sRow("Microphone","For calls and dictation.",Down(S.mic||"System default"),{act:"pick-mic"}))}
    ${Section("Calls")}${Group(sRow("Summary after a call","A short list of what was decided lands in the chat.",tog("callsum",true))+sRow("Keep the recording","Stored on this Mac for 7 days.",tog("callrec",false)))}`,
  privacy:()=>`<div class="card1"><span class="mac">${ic("lock",18)}<i></i></span><div class="tx"><b>End-to-end encryption is on</b><span>Only your devices can read chats and files. hz's servers see nothing.</span></div>${Btn("Pair a device",{act:"show-qr"})}</div>
    ${Section("Keys")}${Group(sRow("Recovery code","Write it down. It's the only way back in if you lose every device.",Btn("Show code",{act:"show-code"}))+sRow("Devices","This Mac and an iPhone.",Next("2"),{act:"devices"}))}
    ${Section("Passwords")}${Group(sRow("1Password","Agents ask 1Password for a login; you approve each one there.",Btn("Connect",{act:"onepass"}))+sRow("Browser logins","Sites the agents' browser stays signed in to.",Next(LOGINS.length),{act:"open-logins",id:"atlas"}))}
    ${Section("Reports")}${Group(sRow("Crash reports","Where the app broke and on which version, nothing you wrote.",tog("crash",S.pref.crash)))}`,
  usage:()=>`${Group([["Claude Code","Claude",[["5-hour window",62,"resets in 2h 10m"],["Weekly",31,"resets Monday"]]],["Codex","Codex",[["5-hour window",18,"resets in 3h 40m"],["Weekly",44,"resets Tuesday"]]],["OpenCode","OpenCode",[["Monthly credits",72,"$14.40 of $20"]]]].map(([n,c,ws])=>`<div class="row usage" style="display:block;padding:14px"><div style="display:flex;align-items:center;gap:10px"><span class="ico">${cliMark(c,18)}</span><b style="font-weight:650">${n}</b></div>${ws.map(w=>`<div class="uline"><span>${w[0]}</span><span>${w[2]} · ${w[1]}%</span></div><div class="meter ${w[1]>70?"warn":""}"><i style="width:${w[1]}%"></i></div>`).join("")}</div>`).join(""))}
    ${Section("Spend this month")}${Group(Object.values(AG).filter(a=>WS[S.ws].convs.includes(a.id)).map(a=>Row({lead:face(a,34),title:a.name,sub:`<div class="bar"><i style="width:${Math.min(100,a.spent/a.budget*100)}%"></i></div>`,right:Val("$"+a.spent.toFixed(2))})).join(""))}`,
  clis:()=>`${Group([["Claude","Claude Code","2.1.4","2.1.6","you@example.com"],["Codex","Codex","0.46.0",null,"you@example.com"],["OpenCode","OpenCode","1.4.2",null,null]].map(([c,n,v,up,who])=>Row({lead:`<span class="ico">${cliMark(c,18)}</span>`,title:n,sub:`<span class="mono" style="font-size:12px">${v}${up?` · ${up} available`:" · up to date"}</span><br>${who?`Signed in as ${who}`:"Not signed in"}`,right:`${up?Btn("Update",{act:"cli-update",kind:"primary",size:"sm",a:{"data-id":c}}):""}${who?Btn("Sign out",{act:"cli-out",size:"sm",kind:"ghost",a:{"data-id":c}}):Btn("Sign in",{act:"cli-in",size:"sm",a:{"data-id":c}})}`})).join(""))}${Hint("hz uses the CLIs you already have. Nothing is installed for you.")}`,
  updates:()=>`<div class="card1"><span class="mac">${ic("download",22)}<i></i></span><div class="tx"><b>hz 0.20.16</b><span id="upstat">You're up to date. Checked a minute ago.</span></div>${Btn("Check for updates",{act:"check-update"})}</div>
    ${Group(sRow("Update automatically","Installs when no agent is mid-turn.",tog("autoup",true))+sRow("Channel",null,Down(S.channel||"Stable"),{act:"pick-channel"}),{cls:""})}
    ${Group(Row({icon:"gift",title:"What's new",act:"whatsnew",right:Next()})+Row({icon:"bulb",title:"Send feedback",act:"feedback",right:Next()}))}
    ${Section("Release notes")}${Group([["0.20.16","The feature notes move out of the prompt."],["0.20.15","Snapshots of a deleted folder no longer ask git."],["0.20.14","Sidebar redesign."]].map(([v,n])=>Row({title:v,sub:n,right:Next(),act:"notes",id:v})).join(""))}`,
};
const keysHTML=()=>`${(S.keys||(S.keys=[["GEMINI_API_KEY","····nPWQ"]])).map((k,i)=>Row({lead:`<span class="ico" style="color:var(--amber);background:color-mix(in srgb,var(--amber) 16%,var(--l3))">${ic("key",17)}</span>`,title:k[0],sub:`<span class="mono">${k[1]}</span>`,right:`${Btn("Replace",{act:"key-rep",size:"sm",a:{"data-id":i}})}${IconBtn("trash",{act:"key-del",size:"sm",kind:"plain",title:"Remove",a:{"data-id":i}})}`})).join("")}${Row({icon:"plus",title:`<span style="color:var(--blue)">New key</span>`,act:"key-new"})}`;
const memListHTML=q=>WS[S.ws].convs.filter(i=>!isCh(i)&&AG[i].name.toLowerCase().includes(q.toLowerCase())).map(i=>Row({lead:face(AG[i],34),title:AG[i].name,right:Next((MEMORY[i]||[]).length),act:"edit-mem",id:i})).join("")||Empty("No agent matches.");
const qrHTML=()=>{let h="";for(let i=0;i<225;i++){const x=i%15,y=Math.floor(i/15),f=(x<4&&y<4)||(x>10&&y<4)||(x<4&&y>10);h+=`<i class="${f?(x%3===1&&y%3===1?"w":""):((x*7+y*13+x*y)%3?"":"w")}"></i>`}return `<div class="qr">${h}</div>`};

const pickMenu=(el,label,opts,cur,set)=>menu(el,[`#${label}`,...opts.map(o=>[null,o,()=>{set(o);rSet()},{chk:o===cur}])],{align:"right"});
Object.assign(ACT,{
  "set-page":el=>{SET.page=el.dataset.p;rSet(true)},
  "me-photo":()=>pickFile(f=>{const r=new FileReader();r.onload=()=>{ME.photo=r.result;rSet();rSide()};r.readAsDataURL(f)}),
  "me-nophoto":()=>{ME.photo=null;rSet();rSide()},
  "me-lang":el=>pickMenu(el,"Language",["English","Português","Español"],ME.lang,v=>ME.lang=v),
  "me-status":el=>menu(el,["#Status",...Object.keys(STATUS).map(s=>[null,s,()=>{ME.status=s;rSet();rSide()},{chk:ME.status===s,html:`<i class="sdot" style="background:${STATUS[s]};margin:0 5px"></i>`}])],{align:"right"}),
  signout:()=>confirmBox("Sign out?","Agents keep working in the background on this Mac until you quit hz.","Sign out",()=>toast("Signed out (mockup)",{icon:"out"}),{danger:false}),
  "pick-theme":el=>menu(el,["#Light or dark",...[["system","Follow the system"],["light","Light"],["dark","Dark"]].map(([k,n])=>[null,n,()=>setTheme(k),{chk:S.theme===k}])],{align:"right"}),
  "pick-pal":el=>{S.pal=el.dataset.v;applyTheme();rSet();toast(`Theme: ${PALS.find(p=>p[0]===S.pal)[1]}`,{icon:"sun",ms:1200})},
  "pick-font":el=>pickMenu(el,"Font",Object.keys(FONTS),S.font,v=>{S.font=v;applyTheme()}),
  "pick-accent":el=>{S.accent=el.dataset.v;applyTheme();rSet()},
  "pick-order":el=>pickMenu(el,"Order",["My order","Most recent","A to Z"],S.order||"My order",v=>{S.order=v;const w=WS[S.ws];if(v==="A to Z")w.convs.sort((a,b)=>convName(a).localeCompare(convName(b)));rSide();toast(`Order: ${v}`,{ms:1200})}),
  "bulk-engine":el=>menu(el,["#Move every agent to…",...Object.keys(MODELS).map(c=>[null,ENG[c],()=>confirmBox(`Move all agents to ${ENG[c]}?`,"Each keeps its instructions and memory. The model resets to the engine's default.","Change all",()=>{Object.values(AG).forEach(a=>{a.cli=c;a.model=MODELS[c][0]});rSide();rPanel();toast(`All agents now run on ${ENG[c]}`,{icon:"cpu"})},{danger:false}),{html:cliMark(c,18)}])],{align:"right"}),
  "mac-settings":()=>toast("Opened System Settings → Notifications",{icon:"ext"}),
  "pick-island":el=>pickMenu(el,"Agents on screen",["Island at the notch","Menu bar only","Off"],S.island||"Island at the notch",v=>S.island=v),
  bark:()=>veil(`${Head("Notices on your iPhone")}${Body(`<p style="color:var(--ink2);margin-bottom:12px">Paste your Bark device key. hz sends a push when an agent finishes, asks or needs approval.</p>${Field({mono:true,placeholder:"https://api.day.app/…",autofocus:true})}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Save",{act:"bark-save",kind:"primary"}))}`,{width:460}),
  "bark-save":el=>{closeVeil(el.closest(".veil"));toast("Bark connected. Sent a test notice.",{icon:"bell"})},
  "pick-mic":el=>pickMenu(el,"Microphone",["System default","MacBook Pro Microphone","AirPods Pro"],S.mic||"System default",v=>S.mic=v),
  "show-qr":()=>veil(`${Head("Connect an iPhone")}${Body(`<div class="pat" style="border-radius:var(--r3);padding:18px 0">${qrHTML()}</div>${Hint("Open hz on your iPhone and scan this code.")}`)}`,{width:400}),
  "show-code":()=>veil(`${Head("Pairing code")}${Body(`<div class="mono pat" style="font-size:30px;text-align:center;letter-spacing:.2em;padding:26px 0;border-radius:var(--r3)">482 190</div>${Hint("Type it on your iPhone. It works for 5 minutes.")}`)}`,{width:400}),
  intro:()=>toast("Replaying the introduction…",{icon:"play"}),
  "set-pw":()=>veil(`${Head("Set a password")}${Body(`${Field({type:"password",placeholder:"New password",autofocus:true})}${Hint("At least 10 characters.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Save",{act:"pw-save",kind:"primary"}))}`,{width:420}),
  "pw-save":el=>{closeVeil(el.closest(".veil"));toast("Password set",{icon:"lock"})},
  export:el=>progress(el,"Exporting",1600,()=>toast("hz-export.zip saved to Downloads",{icon:"download",action:"Show",onAction:()=>toast("Revealed in Finder",{ms:1000})})),
  "del-account":()=>confirmBox("Delete your account?","Your agents, chats and cloud files are erased. This cannot be undone.","Delete account",()=>toast("Account deletion started (mockup)",{icon:"trash"}),{type:"delete"}),
  "ws-cmd":el=>pickMenu(el,"Commands on this Mac",Object.values(CMD),CMD[S.cmd],v=>{S.cmd=Object.keys(CMD).find(k=>CMD[k]===v)}),
  "del-ws":()=>{if(WS.length===1)return toast("You need at least one workspace",{icon:"lock"});confirmBox(`Delete ${WS[S.ws].name}?`,"Its agents and channels move to Personal.","Delete workspace",()=>{const w=WS[S.ws],to=WS.find((x,i)=>i!==S.ws&&x.name==="Personal")||WS.find((x,i)=>i!==S.ws);to.convs.push(...w.convs);WS.splice(S.ws,1);S.ws=0;S.conv=WS[0].convs[0];closeAllVeils();render({skeleton:true});toast("Workspace deleted",{icon:"trash"})},{type:WS[S.ws].name})},
  "def-cli":el=>pickMenu(el,"Engine",Object.keys(MODELS),S.defCli||"Claude",v=>S.defCli=v),
  "def-perm":el=>menu(el,["#Permission",...Object.keys(PERM).map(k=>[null,PERM[k][0],()=>{S.defPerm=k;rSet()},{chk:(S.defPerm||"auto")===k,s:PERM[k][1]}])],{align:"right"}),
  "skills-lib":()=>openPlugins("skills"),
  "edit-skills":el=>editAgent(el.dataset.id,"general","skills"),
  "edit-mem":el=>editAgent(el.dataset.id,"general","memory"),
  "key-new":()=>{veil(`${Head("New key")}${Body(`${Label("Name")}${Field({in:"key-name",mono:true,placeholder:"OPENAI_API_KEY",autofocus:true})}${Label("Value")}${Field({in:"key-val",mono:true,type:"password",placeholder:"sk-…"})}${Hint("Stored in the macOS keychain. Agents get it as an environment variable.")}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),Btn("Save key",{act:"key-save",kind:"primary"}))}`,{width:460})},
  "key-save":el=>{const v=el.closest(".veil"),n=$("[data-in=key-name]",v).value.trim()||"NEW_KEY";(S.keys=S.keys||[]).push([n,"····"+Math.random().toString(36).slice(2,6)]);closeVeil(v);$("#keys").innerHTML=keysHTML();toast(`${n} saved`,{icon:"key"})},
  "key-rep":el=>progress(el,"Replacing",900,()=>toast("Key replaced",{icon:"key",ms:1400})),
  "key-del":el=>{const i=+el.dataset.id,k=S.keys[i];S.keys.splice(i,1);$("#keys").innerHTML=keysHTML();toast(`${k[0]} removed`,{icon:"trash",action:"Undo",onAction:()=>{S.keys.splice(i,0,k);$("#keys")&&($("#keys").innerHTML=keysHTML())}})},
  "add-card":()=>toast("Card setup opens in your browser",{icon:"wallet"}),
  "pick-limit":el=>menu(el,["#Per agent, per month",...["$10","$25","$50","$100","No limit"].map(n=>[null,n,()=>toast(`Limit: ${n}`,{icon:"wallet",ms:1300}),{chk:n==="$50"}])],{align:"right"}),
  teach:()=>{const i=$("#teach"),v=i.value.trim();if(!v)return;Object.keys(MEMORY).concat(Object.keys(AG).filter(k=>!MEMORY[k])).forEach(k=>{(MEMORY[k]=MEMORY[k]||[]).unshift(v)});i.value="";$("#memlist").innerHTML=memListHTML("");toast("Every agent will remember it",{icon:"brain"})},
  "cli-update":el=>progress(el,"Updating",1500,()=>{toast("Updated to 2.1.6",{icon:"check"});rSet()}),
  "cli-out":el=>toast("Signed out of "+el.dataset.id,{icon:"out",ms:1500}),
  "cli-in":el=>progress(el,"Opening browser",1200,()=>toast("Signed in",{icon:"check"})),
  "check-update":el=>progress(el,"Checking",1300,()=>{$("#upstat").textContent="You're up to date. Checked just now.";toast("hz is up to date",{icon:"check",ms:1500})}),
  "pick-channel":el=>pickMenu(el,"Channel",["Stable","Beta"],S.channel||"Stable",v=>S.channel=v),
  "pick-voice":el=>{S.voice=el.dataset.v;rSet();toast(`Voice: ${S.voice}`,{icon:"volume",ms:1200})},
  "voice-try":el=>toast(`${el.dataset.v}: “Hi Gabriel, I'm on it.”`,{icon:"volume",ms:1800}),
  "pick-speed":el=>pickMenu(el,"Speed",["Slower","Normal","Faster"],S.speed||"Normal",v=>S.speed=v),
  devices:()=>toast("This Mac · iPhone 16 (paired Oct 2)",{icon:"lock",ms:1800}),
  onepass:el=>progress(el,"Opening 1Password",1100,()=>toast("1Password connected",{icon:"key"})),
  whatsnew:()=>openWhatsNew(),
  feedback:()=>openFeedback(),
  notes:el=>veil(`${Head("hz "+el.dataset.id)}${Body(`<p style="color:var(--ink2);line-height:1.6">What changed in this release. Fixes to the chat, the sidebar and the feature notes.</p>`)}`,{width:440}),
});
Object.assign(INPUT,{
  "me-name":v=>{ME.name=v;ME.initials=(v.trim()[0]||"?").toUpperCase()+(v.trim().split(" ")[1]?.[0]||"").toUpperCase();rSide()},
  "ws-rename":v=>{WS[S.ws].name=v;rSide()},
  "ws-ctx":v=>{WS[S.ws].ctx=v},
  skq:()=>{},teach:()=>{},
  memq:v=>{$("#memlist").innerHTML=memListHTML(v)},
});
/* every [data-k] toggle lands here: it keeps its state in S.pref and says what changed */
const TOG={advanced:v=>{S.advanced=v;rSet()},computer:v=>{S.computer=v;toast(`Agents' computer ${v?"on":"off"}`,{icon:"monitor",ms:1300})},pause:v=>{S.pref.pause=v;toast(v?"All agents paused":"Agents resumed",{icon:"pause",ms:1400});if(SET.v)rSet()},logo:v=>{S.pref.logo=v;rSide()},autoup:()=>{}};
