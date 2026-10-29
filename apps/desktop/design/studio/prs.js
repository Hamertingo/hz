/* ───────── pull requests: a board of who is waiting on whom ───────── */
const PRS=[
  {id:"p2",n:208,t:"vm pool: reuse warm VMs",repo:"hyze/api-node",by:"ada",add:96,del:31,files:4,lane:"you",checks:"pass",rev:["atlas"],ask:"You asked Ada to review before merge. She suggested a fix for release().",age:"2h",branch:"feat/warm-pool"},
  {id:"p1",n:212,t:"pricing page for Pro",repo:"hyze/site",by:"atlas",add:184,del:12,files:3,lane:"you",checks:"pass",rev:["mila"],ask:"Atlas asked Mila to review the copy. Needs your approval to merge.",age:"41m",branch:"feat/pro-pricing"},
  {id:"p3",n:214,t:"fix(billing): meter rounds per minute",repo:"hyze/api-node",by:"ada",add:12,del:4,files:1,lane:"work",checks:"run",rev:[],ask:"Ada is waiting for the test run to finish.",age:"6m",branch:"fix/billing-meter",draft:true},
  {id:"p5",n:203,t:"blog: sandbox VMs, explained",repo:"hyze/site",by:"leo",add:240,del:0,files:2,lane:"work",checks:"pass",rev:["mila"],ask:"Mila asked for changes. Leo is rewriting the intro.",age:"1d",branch:"post/sandbox-vms",changes:true},
  {id:"p4",n:209,t:"chore: bump firecracker to 1.9",repo:"hyze/hyzevm",by:"vex",add:8,del:8,files:2,lane:"ready",checks:"pass",rev:["nox"],ask:"Nox approved. Checks are green.",age:"3h",branch:"chore/fc-1.9",approved:true},
];
const PRLANES=[["you","Needs you","Review or approve",null],["work","Agents working","Still being written or checked",null],["ready","Ready to merge","Approved, checks green",null]];
const prChecks=p=>p==="pass"?`<span class="chk2 ok">${ic("circleok",13)}Checks passing</span>`:p==="run"?`<span class="chk2"><span class="spin" style="--tint:var(--amber)"></span>Checks running</span>`:`<span class="chk2 bad">${ic("circlex",13)}Checks failing</span>`;
function prCard(p){
  const a=AG[p.by];
  return `<div class="prc" data-act="propen" data-id="${p.id}" style="--c:${a.color}">
    <div class="prh"><span class="prn">${ic("pr",13)}${p.repo.split("/")[1]} #${p.n}</span>${p.draft?`<span class="ntag">Draft</span>`:""}${p.changes?`<span class="ntag" style="color:var(--amber)">Changes requested</span>`:""}<span class="age">${p.age}</span></div>
    <div class="prt">${p.t}</div>
    <div class="prm"><span class="by">${tileHTML(a,18)}${a.name}</span><span class="df"><b>+${p.add}</b> <i>−${p.del}</i></span><span class="fl2">${p.files} file${p.files>1?"s":""}</span></div>
    <div class="prf">${prChecks(p.checks)}<span class="faces">${p.rev.map(k=>`<span>${tileHTML(AG[k],18)}</span>`).join("")}</span></div>
  </div>`;
}
function renderPRs(){
  const f=S.prfilter||"all";const list=PRS.filter(p=>!p.merged&&(f==="all"||p.by===f));
  const authors=[...new Set(PRS.map(p=>p.by))];
  main.innerHTML=`<div class="ptitlebar"><h1>${ic("pr",16)} Pull requests</h1>
    <div class="subtabs" style="margin-left:14px"><a class="${f==="all"?"on":""}" data-act="prfilter" data-v="all">All <em>${PRS.filter(p=>!p.merged).length}</em></a>${authors.map(k=>`<a class="${f===k?"on":""}" data-act="prfilter" data-v="${k}">${tileHTML(AG[k],16)}${AG[k].name}</a>`).join("")}</div>
    <div class="acts"><span style="font-size:12px;color:var(--ink4)">${brand("github",16)}</span><button class="btn" data-act="prsync">${ic("refresh",14)} Refresh</button></div></div>
    <div class="board">${PRLANES.map(([k,h,s])=>{const items=list.filter(p=>p.lane===k);return `<div class="lane"><div class="lh"><b>${h}</b><span class="count">${items.length}</span></div><div class="ls">${s}</div>
      <div class="lc">${items.map(prCard).join("")||`<div class="lempty">${k==="you"?"Nothing waiting on you":k==="ready"?"Nothing ready yet":"No agent is mid-PR"}</div>`}</div></div>`}).join("")}</div>`;
}
function prDrawer(id){
  const p=PRS.find(x=>x.id===id);const a=AG[p.by];
  const files=[["src/vms/pool.ts",p.add-20,p.del-10],["src/vms/pool.spec.ts",20,10],["README.md",0,0]].slice(0,Math.min(3,p.files+1)).filter(x=>x[1]+x[2]>0||p.files<3);
  drawer({title:`#${p.n} ${p.t}`,sub:`${p.repo} · ${p.branch}`,icon:brand("github",28),width:880,center:true,
    body:`<div class="pdet" style="grid-template-columns:1fr 280px"><div>
      <div class="inl" style="max-width:none;background:var(--s1);box-shadow:inset 0 0 0 1px var(--line)"><div class="h">${tileHTML(a,22)}<span><b style="color:var(--ink)">${a.name}</b> · ${p.ask}</span></div></div>
      <h4 style="margin-top:22px">Changes<span class="r"><b style="color:var(--green)">+${p.add}</b> <b style="color:var(--red)">−${p.del}</b> in ${p.files} files</span></h4>
      ${files.map(([f,ad,de])=>`<div class="diff" style="margin-top:8px"><div class="h">${f}</div><div class="d">- ${de?"this.free.push(vm)":"(unchanged)"}</div><div class="a">+ ${ad?"if (await vm.snapshot().catch(()=>false)) this.free.push(vm)":"(unchanged)"}</div></div>`).join("")}
    </div><div class="side2">
      <div><div class="fl">Checks</div>${prChecks(p.checks)}<div style="font-size:12px;color:var(--ink3);margin-top:6px">build · test · lint</div></div>
      <div><div class="fl">Reviewers</div>${p.rev.map(k=>`<div class="mrow">${tileHTML(AG[k],24)}<span>${AG[k].name}</span><span class="r">${p.approved?"Approved":"Requested"}</span></div>`).join("")||`<span style="color:var(--ink4)">None yet</span>`}<button class="btn sm" style="margin-top:8px" data-act="pask" data-id="${p.id}">${ic("plus",13)} Ask an agent to review</button></div>
      <div class="facts"><div>Opened<b>${p.age} ago</b></div><div>Branch<b class="mono" style="font-size:11.5px">${p.branch}</b></div></div></div></div>`,
    foot:`<button class="btn" data-act="pgh">${ic("ext",14)} Open on GitHub</button><button class="btn ghost" data-act="pask" data-id="${p.id}">${ic("reply",14)} Ask ${a.name}</button><button class="btn push" data-act="papprove" data-id="${p.id}">${ic("check",14)} Approve</button><button class="btn solid" data-act="pmerge" data-id="${p.id}" ${p.checks!=="pass"?"disabled":""}>${ic("merge",14)} Merge</button>`});
}
const PR_ACT={
  prfilter:el=>{S.prfilter=el.dataset.v;render()},
  prsync:el=>progress(el,"Refreshing",900,()=>toast("Up to date with GitHub",{icon:"check",ms:1600})),
  propen:el=>prDrawer(el.dataset.id),
  pgh:()=>toast("Opened on github.com",{icon:"ext",ms:1600}),
  pask:el=>{const p=PRS.find(x=>x.id===el.dataset.id);closeDrawer();openAgent(p.by);const ta=$("[data-ta]");ta.value=`Sobre o PR #${p.n}: `;ta.focus()},
  papprove:el=>{const p=PRS.find(x=>x.id===el.dataset.id);p.approved=true;p.lane=p.checks==="pass"?"ready":p.lane;closeDrawer();render();toast(`Approved #${p.n}`,{icon:"check"})},
  pmerge:el=>{const p=PRS.find(x=>x.id===el.dataset.id);confirmBox(`Merge #${p.n}?`,`${p.t} goes into main on ${p.repo}. ${AG[p.by].name} deletes the branch after.`,"Merge",()=>{p.merged=true;closeDrawer();render();toast(`Merged #${p.n} into main`,{icon:"merge",action:"Undo",onAction:()=>{p.merged=false;render()}})},{danger:false})},
};
