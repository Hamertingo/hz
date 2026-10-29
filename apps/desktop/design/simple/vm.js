/* vm: the agents' computer as it looks, a small Linux desktop with the agent's browser open and its cursor moving.
   The screen is drawn at 960×600 and scaled to whatever box it sits in, so the thumbnail and the full view
   are the same picture. */
const VMW=960,VMH=600;
/* what each agent is looking at; anyone not listed is searching */
const VMPAGE={atlas:"docs",ada:"review",mila:"post",hugo:"sheet"};
const VMSITE={docs:["stripe.com/docs/billing/usage","Usage-based billing"],review:["git.hyzecloud.com/api-node/pull/482","Add usage-based billing endpoint"],post:["x.com/compose","Compose post"],sheet:["sheets.example.com/d/sandbox-pricing","Sandbox pricing"],search:["search.example.com/?q=sandbox+vm+pricing","sandbox vm pricing"]};
const bars=(n,w=[90,70,82,60,76])=>Array.from({length:n},(_,i)=>`<i style="width:${w[i%w.length]}%"></i>`).join("");
const PAGES_VM={
  docs:()=>`<div class="pg docs"><aside>${["Overview","Products","Prices","Usage-based billing","Meters","Invoices","Taxes"].map((t,i)=>`<b class="${i===3?"on":""}">${t}</b>`).join("")}</aside><main><h1>Usage-based billing</h1><p class="lead">Charge for what customers use: API calls, minutes, gigabytes.</p><div class="ln">${bars(4)}</div><h2>Report usage</h2><div class="ln">${bars(3)}</div><pre>meter_events.create(
  event_name="vm_minutes",
  payload={"value": 42}
)</pre><div class="ln">${bars(3)}</div></main></div>`,
  review:()=>`<div class="pg review"><h1>Add usage-based billing endpoint <span>#482</span></h1><div class="meta"><em>Open</em> Ada wants to merge 7 commits into <code>main</code></div><div class="tb"><b class="on">Conversation</b><b>Commits 7</b><b>Files changed 7</b></div><div class="diff"><div class="fh">src/billing/usage.rs</div>${[["",`pub async fn report(usage: Usage) -> Result<()> {`],["-","    let delay = 1000;"],["+","    let delay = base * 2u64.pow(attempt);"],["+","    let delay = delay.min(60_000);"],["","    meter.send(usage).await?;"],["","}"]].map(([k,l])=>`<div class="dl ${k==="+"?"add":k==="-"?"del":""}"><span>${k}</span>${l}</div>`).join("")}</div></div>`,
  post:()=>`<div class="pg post"><div class="cmp2"><span class="av" style="background:#ee73b2"></span><div><p>Sandbox VMs by the hour, built for agents.</p><p>The Pro plan opens Oct 30. Spin up a VM, let your agent work, pay for the minutes it ran.<i class="caret"></i></p><div class="img"></div></div></div><div class="pbar"><span>1/7</span><b>Post</b></div></div>`,
  sheet:()=>`<div class="pg sheet2"><table>${[["","Provider","Unit","Price","Per hour"],["1","E2B","second","$0.000014","$0.05"],["2","Modal","second","$0.000016","$0.06"],["3","Fly Machines","second","$0.0000022","$0.008"],["4","Hyze Cloud","minute","$0.0012","$0.072"],["5","","","",""],["6","","","",""]].map((r,i)=>`<tr>${r.map((c,k)=>i===0||k===0?`<th>${c}</th>`:`<td class="${i===4&&k===4?"sel":""}">${c}</td>`).join("")}</tr>`).join("")}</table></div>`,
  search:()=>`<div class="pg search2"><div class="wm">find</div><div class="box">sandbox vm pricing<i class="caret"></i></div><div class="sug">${["sandbox vm pricing per hour","sandbox vm pricing comparison","sandbox vm for ai agents"].map(s=>`<span>${s}</span>`).join("")}</div></div>`,
};
function vmScreen(a,{big=false}={}){
  const kind=VMPAGE[a.id]||"search",[url,title]=VMSITE[kind],ctl=S.ctrl?.[a.id];
  const cur=ctl?`<span class="vcur you" style="--c:#f2f2f0"><svg viewBox="0 0 16 16"><path d="M2 1l11 6.5-5 1-2.5 5z"/></svg><b>You</b></span>`:`<span class="vcur" style="--c:${a.color}"><svg viewBox="0 0 16 16"><path d="M2 1l11 6.5-5 1-2.5 5z"/></svg><b>${esc(a.name)}</b></span>`;
  return `<div class="vms ${big?"big":""} ${ctl?"ctl":""}" ${big?"":`data-act="vm-view" data-id="${a.id}"`}><div class="vmi" style="width:${VMW}px;height:${VMH}px">
    <div class="dtop"><span>Chromium</span><span class="r">${ic("globe",11)} ${ic("volume",11)} 21:14</span></div>
    <div class="win"><div class="tabs2"><span class="tab on"><i style="background:${a.color}"></i>${esc(title)}<em>×</em></span><span class="tab">New tab</span><span class="add">+</span></div>
      <div class="tbar">${ic("back",14)}${ic("fwd",14)}${ic("refresh",13)}<span class="url">${ic("lock",11)}${esc(url)}</span>${ic("more",14)}</div>
      <div class="vpage">${PAGES_VM[kind]()}</div></div>${cur}</div>
    ${big?"":`<span class="open">${ic("expand",15)}Open</span>`}</div>`;
}
/* scale every screen to its box after it lands */
function fitVMs(){$$(".vms").forEach(v=>{const s=v.clientWidth/VMW;$(".vmi",v).style.transform=`scale(${s})`})}
const _rPanel=rPanel;rPanel=function(){_rPanel();fitVMs()};
addEventListener("resize",fitVMs);

/* the full view: the same screen, big, with the controls under it */
function openVM(id){
  const a=AG[id],ctl=S.ctrl?.[id],kind=VMPAGE[id]||"search";
  const v=veil(`${Head(`${esc(a.name)}'s computer`,{lead:face(a,32),right:Chip(ctl?"You're in control":"Live",{dot:ctl?"warn":"go"})})}${Body(vmScreen(a,{big:true}))}
    ${Foot(`<span style="margin-right:auto;font-size:12.5px;color:var(--ink3)">${ctl?`${esc(a.name)} waits until you give it back.`:`Browsing ${VMSITE[kind][0].split("/")[0]}`}</span>`,Btn("Screen size",{act:"vm-open",icon:"maximize",kind:"ghost"}),Btn("Copy screen",{act:"vm-copy",icon:"copy",kind:"ghost"}),ctl?Btn("Give it back",{act:"giveback",kind:"primary"}):Btn("Take over",{act:"takeover",icon:"hand",kind:"primary"}))}`,{width:Math.min(980,innerWidth-120),cls:"vmview"});
  v.vmId=id;requestAnimationFrame(fitVMs);
}
const refreshVM=()=>{const v=VEILS.find(x=>x.vmId);if(v){const id=v.vmId;closeVeil(v);openVM(id)}};
Object.assign(ACT,{
  "vm-view":el=>openVM(el.dataset.id),
  "vm-copy":()=>toast("Screenshot copied",{icon:"copy",ms:1300}),
});
