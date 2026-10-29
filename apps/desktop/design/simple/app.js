/* app: one click listener, one input listener, right-click, keys, the screens bar, and the boot. */
document.addEventListener("click",e=>{
  const t=e.target,had=popEl;
  if(had&&!had.contains(t)){
    closePop();
    if(had.classList.contains("wide")&&t.closest("[data-act=inbox]"))return;
  }
  const a=t.closest("[data-act]");
  if(a&&!a.disabled&&!a.classList.contains("off")){
    const f=ACT[a.dataset.act];
    if(!f){toast(`“${a.dataset.act}” has no action yet`);return}
    f(a,e);return;
  }
  const tg=t.closest(".tog[data-k]");
  if(tg){const k=tg.dataset.k,on=!tg.classList.contains("on");tg.classList.toggle("on",on);TOG[k]?TOG[k](on):(S.pref[k]=on);return}
});
document.addEventListener("input",e=>{const k=e.target.dataset?.in;if(k)INPUT[k]?.(e.target.value,e.target)});
document.addEventListener("contextmenu",e=>{
  const cv=e.target.closest(".cv");if(cv){e.preventDefault();convMenu(e.clientX,e.clientY,cv.dataset.id);return}
  const m=e.target.closest(".msg .bub,.msg .card");if(m){e.preventDefault();msgCtx(e.clientX,e.clientY,m.closest(".msg").dataset.id)}
});
document.addEventListener("keydown",e=>{
  const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase(),top=VEILS[VEILS.length-1];
  if(mod&&k==="k"){e.preventDefault();closePop();if(top?.isPal)closeVeil(top);else openPalette();return}
  if(mod&&k==="n"){e.preventDefault();newAgent();return}
  if(mod&&e.key===","){e.preventDefault();openSettings("prefs");return}
  if(mod&&e.shiftKey&&k==="i"){e.preventDefault();openInbox();return}
  if(mod&&/^[1-9]$/.test(e.key)&&WS[+e.key-1]){e.preventDefault();switchWs(+e.key-1);return}
  if(e.key==="Escape"){
    if(popEl)return closePop();
    if(CALL)return endCall();
    if(VEILS.length)return closeVeil();
    if(suggItems.length){suggItems=[];$("#sugg").innerHTML="";return}
    if(S.sel.size){S.sel.clear();return rSide()}
    if(S.panel)return hidePanel();
    return;
  }
  if(top?.isPal){
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();PAL.i=(PAL.i+(e.key==="ArrowDown"?1:-1)+PAL.items.length)%Math.max(1,PAL.items.length);palFill()}
    else if(e.key==="Enter"){e.preventDefault();palRun(PAL.i)}
    return;
  }
  if(e.target.id==="ta"){
    if(suggItems.length&&["ArrowDown","ArrowUp","Enter","Tab"].includes(e.key)){
      e.preventDefault();
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){suggI=(suggI+(e.key==="ArrowDown"?1:-1)+suggItems.length)%suggItems.length;suggest()}
      else pickSugg(suggI);
      return;
    }
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}
  }
});

/* ───────── screens bar: jump to any surface ───────── */
const SCREENS=[
  ["Chat",()=>{openConv("atlas");S.panel=null;rPanel();rTop()}],
  ["Working",()=>openConv("ada")],
  ["Approval",()=>openConv("mila")],
  ["Channel",()=>{openConv("#launch");S.panel={k:"channel",tab:"tasks"};showPanel()}],
  ["Profile",()=>{openConv("atlas");S.panel={k:"profile",tab:"details"};showPanel()}],
  ["Library",()=>{openConv("atlas");S.panel={k:"profile",tab:"library"};showPanel()}],
  ["Computer",()=>{openConv("hugo");S.panel={k:"profile",tab:"computer"};showPanel()}],
  ["Inbox",()=>openInbox()],
  ["Search",()=>openPalette()],
  ["New agent",()=>newAgent()],
  ["Edit agent",()=>editAgent("mila")],
  ["Apps",()=>openPlugins()],
  ["PRs",()=>openPRs()],
  ["Routines",()=>openRoutines()],
  ["Settings",()=>openSettings("prefs")],
  ["Usage",()=>openSettings("usage")],
  ["Call",()=>{openConv("atlas");later(350,()=>startCall("atlas"))}],
  ["Cards",()=>openConv("nox")],
  ["Versions",()=>openVersions("atlas")],
  ["What's new",()=>openWhatsNew()],
  ["Island",()=>toggleIsland()],
  ["Components",()=>openComponents()],
  ["Light",()=>setTheme(document.documentElement.dataset.theme==="light"?"dark":"light")],
];
function goScreen(i){closePop();closeAllVeils();SCREENS[i][1]()}
$("#mock").innerHTML=`<span>SCREENS</span>`+SCREENS.map((s,i)=>`<button data-act="screen" data-i="${i}">${s[0]}</button>`).join("");
ACT.screen=el=>goScreen(+el.dataset.i);

/* ───────── boot ───────── */
applyTheme();render();
