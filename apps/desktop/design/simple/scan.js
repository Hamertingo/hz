/* scan: open every surface and list anything that looks pressable but has no handler.
   Run `await scanDead()` in the console; it prints and returns {checked, dead}. */
async function scanDead(){
  const dead=[],seen=new Set();let checked=0;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const look=where=>{
    $$("button,[data-act],[role=button],.tog,.it,.cv",document).forEach(el=>{
      if(el.closest("#mock,.toasts"))return;
      const lab=(el.getAttribute("title")||el.textContent||el.className).trim().slice(0,32);
      const key=where+"|"+(el.dataset.act||lab);if(seen.has(key))return;seen.add(key);checked++;
      let ok=false;
      if(el.dataset.act)ok=!!ACT[el.dataset.act];
      else if(el.classList.contains("tog"))ok=!!el.dataset.k;
      else if(el.matches(".it,.cv"))ok=!!el.onclick||el.matches(".cv");
      else if(el.tagName==="BUTTON")ok=!!el.onclick;
      else ok=true;
      if(!ok)dead.push(`${where}: ${el.tagName.toLowerCase()} “${lab}”`);
    });
  };
  const stages=[
    ["chat",()=>SCREENS[0][1]()],["working",()=>SCREENS[1][1]()],["approval",()=>SCREENS[2][1]()],["channel",()=>SCREENS[3][1]()],
    ["profile",()=>SCREENS[4][1]()],["library",()=>SCREENS[5][1]()],["computer",()=>{SCREENS[6][1]()}],
    ["channel-members",()=>{openConv("#launch");S.panel={k:"channel",tab:"members"};showPanel()}],["channel-about",()=>{S.panel={k:"channel",tab:"about"};showPanel()}],
    ["file",()=>{openConv("atlas");S.panel={k:"file",id:chatOf("atlas").find(m=>m.file).id};showPanel()}],["pr",()=>{S.panel={k:"pr",id:"pr1"};showPanel()}],["activity",()=>{S.panel={k:"activity",id:"live"};showPanel()}],
    ["thread",()=>{const m=chatOf("atlas").find(x=>x.from==="atlas");const had=m.thread;m.thread=[{from:"me",text:"ok",t:"21:00"}];setTimeout(()=>{m.thread=had},2000);S.panel={k:"thread",id:m.id};showPanel()}],
    ["palette",()=>openPalette()],["new-agent",()=>newAgent()],["new-ready",()=>{newAgent();N.tab="ready";rNew()}],["new-channel",()=>channelEditor()],
    ["edit-general",()=>editAgent("mila")],["edit-routines",()=>{editAgent("mila");EDIT.tab="routines";rEdit()}],["edit-access",()=>{editAgent("mila");EDIT.tab="access";rEdit()}],
    ...["instr","skills","memory","computer","apps","folders"].map(p=>["edit-"+p,()=>{editAgent("mila");EDIT.page=p;rEdit()}]),
    ["plugins-connected",()=>openPlugins()],["plugins-open",()=>{openPlugins();PL.open="github";rPlugins()}],["plugins-catalog",()=>{openPlugins("catalog")}],["plugins-skills",()=>{openPlugins("skills")}],
    ["prs",()=>openPRs()],["routines",()=>openRoutines()],["routine-editor",()=>routineEditor(null,"check the pool")],
    ...RAIL.filter(([k])=>k[0]!=="#").map(([k])=>["settings-"+k,()=>openSettings(k)]),
  ];
  for(const [name,fn] of stages){
    closePop();closeAllVeils();S.panel=null;fn();await wait(700);look(name);
  }
  /* menus: every item must carry a handler or a submenu */
  window.DEAD_ITEMS=[];closeAllVeils();SCREENS[0][1]();await wait(500);
  const menus=[()=>wsMenu(),()=>meMenu($(".avatar")),()=>plusMenu($("[data-act=plusmenu]")),()=>openInbox(),()=>convMenu(300,200,"atlas"),()=>convMenu(300,200,"#launch"),()=>msgCtx(500,300,chatOf("atlas").find(m=>m.from==="atlas").id),()=>ACT.plus($(".cmp .ibtn")),()=>ACT.msgmore({dataset:{id:chatOf("atlas").find(m=>m.from==="atlas").id},getBoundingClientRect:()=>$(".bub").getBoundingClientRect()}),()=>ACT.react($(".hov button"))];
  for(const m of menus){try{m();await wait(80);look("menu");closePop()}catch(err){dead.push("menu threw: "+err.message)}}
  window.DEAD_ITEMS.forEach(n=>dead.push("menu item without handler: "+n));
  closePop();closeAllVeils();SCREENS[0][1]();
  console.log(`scanned ${checked} controls, ${dead.length} dead`,dead);
  return {checked,dead};
}
