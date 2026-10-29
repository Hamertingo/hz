/* ───────── inbox: a reading pane, one decision at a time ───────── */
const KIND={approval:["Approval","var(--amber)","shield"],question:["Question","var(--blue)","q"],mention:["Mention","var(--ink2)","at"],done:["Done","var(--green)","check"]};
const VERDICT={PUBLISHED:["Published","Mila is posting the thread now."],ALLOWED:["Allowed","Ada is pushing the branch."],DENIED:["Denied","Ada keeps the branch local."],"NOT NOW":["Not now","Mila holds the thread for later."],ANSWERED:["Answered","Hugo picked the task back up."],REPLIED:["Replied","Your answer is in #launch."],READ:["Read",""],SKIPPED:["Skipped","It stays in Done if you want it back."],FINISHED:["Finished",""]};
const INBOX=[
  {id:"i1",kind:"approval",sub:"post",a:"mila",t:"Publish the launch thread on X",s:"5 posts · goes public as @hyzecloud",w:"21:02",state:"open",
    why:"Posting in public is on Mila's always-ask list.",path:[["You asked in #launch","“Mila fica com a thread de anúncio”","20:10"],["Mila drafted five posts","with Atlas's price table in the third","20:31"],["Mila stopped to ask","posting in public always asks you","21:02"]]},
  {id:"i2",kind:"approval",sub:"cmd",a:"ada",t:"Push fix/billing-meter to origin",s:"~/api-node · 1 commit · tests green",w:"20:58",state:"open",
    why:"Pushing is on Ada's always-ask list.",path:[["You asked Ada","“Roda os testes da API e corrige o billing”","20:31"],["Ada fixed meter.ts","9 steps · 51 tests pass","20:44"],["Ada stopped to ask","pushing always asks you","20:58"]]},
  {id:"i3",kind:"question",a:"hugo",t:"Should Modal be in the price comparison?",s:"It charges per GPU-second, so it does not line up with E2B or Daytona.",w:"18:40",state:"open",
    choices:["Yes, include it","No, leave it out","Put it in a footnote"],why:"Hugo paused the task until you answer.",path:[["Atlas asked Hugo","“O que a concorrência cobra?”","18:31"],["Hugo found three sources","E2B, Daytona, Modal","18:36"],["Hugo stopped to ask","not sure what you want included","18:40"]]},
  {id:"i4",kind:"mention",a:"leo",ch:"launch",t:"“@Gabriel o título ficou bom?”",s:"#launch · Plano Pro: VMs por hora, sem surpresa no fim do mês",w:"17:15",state:"open",
    why:"Leo mentioned you in #launch.",path:[["You asked in #launch","“Leo com o post no blog”","20:10"],["Leo wrote a title","and three alternatives","17:12"],["Leo asked you","in #launch","17:15"]]},
  {id:"i5",kind:"done",a:"atlas",t:"Pricing page is up for review",s:"PR #212 · 4 steps · 18s",w:"21:14",state:"done",res:"FINISHED",ok:true,file:"pr212",
    path:[["You asked Atlas","“Escreve a página de preço com isso”","21:12"],["Atlas wrote the page","3 files · +184 −12","21:13"],["Atlas opened PR #212","and asked Mila to review","21:14"]]},
  {id:"i6",kind:"done",a:"vex",t:"Pool resized to 48 warm VMs",s:"HyzeVM · routine “Nightly capacity”",w:"03:00",state:"done",res:"FINISHED",ok:true,
    path:[["Routine fired","every day at 03:00","03:00"],["Vex read the pool","72% busy at the peak","03:00"],["Vex resized it","40 → 48 warm VMs","03:02"]]},
];
const INBOX_FILTERS=[["all","All"],["needs","Needs you"],["mentions","Mentions"],["done","Done"]];
function inboxGroups(){
  const live=INBOX.filter(x=>!x.archived);
  const g=[["Needs you",live.filter(x=>x.state==="open"&&x.kind!=="mention"),"needs"],["Mentions",live.filter(x=>x.state==="open"&&x.kind==="mention"),"mentions"],["Earlier today",live.filter(x=>x.state!=="open"),"done"]];
  return S.ifilter==="all"?g:g.filter(x=>x[2]===S.ifilter);
}
function renderInbox(){
  const groups=inboxGroups();const order=groups.flatMap(g=>g[1]);
  let it=order.find(x=>x.id===S.inbox);
  if(!it&&S.inbox!==null){it=order.find(x=>x.state==="open")||null;S.inbox=it?.id??null}
  const live=INBOX.filter(x=>!x.archived);
  const counts={all:live.length,needs:live.filter(x=>x.state==="open"&&x.kind!=="mention").length,mentions:live.filter(x=>x.state==="open"&&x.kind==="mention").length,done:live.filter(x=>x.state!=="open").length};
  main.innerHTML=`<div class="ptitlebar"><h1>${ic("inbox",16)} Inbox</h1>
      <div class="subtabs" style="margin-left:14px">${INBOX_FILTERS.map(([k,l])=>`<a class="${S.ifilter===k?"on":""}" data-act="ifilter" data-v="${k}">${l} <em>${counts[k]}</em></a>`).join("")}</div>
      <div class="acts"><span style="font-size:12px;color:var(--ink4);margin-right:4px">${S.cleared} cleared today</span><button class="btn ghost sm" data-act="readall">${ic("check",13)} Mark mentions read</button></div></div>
    <div class="inbox">
      <div class="ilist">${groups.map(([h,items])=>items.length?`<div class="igh">${h}</div>${items.map(inboxRow).join("")}`:"").join("")||`<div style="padding:30px 12px;color:var(--ink4)">Nothing here.</div>`}</div>
      <div class="pane" style="--tint:${it?AG[it.a].color:"var(--green)"}">${it?readerHTML(it,order):`<div class="pscroll">${zeroHTML()}</div>`}</div>
    </div>`;
}
function inboxRow(x){
  const a=AG[x.a];const [,col,icn]=KIND[x.state==="open"?x.kind:"done"];const v=VERDICT[x.res];
  return `<div class="ir ${x.id===S.inbox?"on":""} ${x.state!=="open"?"done":""}" data-act="iopen" data-id="${x.id}">
    <span class="av">${tileHTML(a,32)}<span class="gl" style="background:${col}">${ic(icn,9,"#111",2.6)}</span></span>
    <div class="tx"><div class="tt"><span>${x.t}</span><span class="tm">${x.resAt||x.w}</span></div><div class="ss">${a.name} · ${x.s}</div>
    ${x.state!=="open"&&x.res!=="FINISHED"?`<span class="res" style="color:${x.ok?"var(--green)":"var(--red)"}">${ic(x.ok?"check":"x",11)} ${v[0]}</span>`:""}</div></div>`;
}
function readerHTML(it,order){
  const a=AG[it.a];const [lab,col,icn]=KIND[it.kind];const idx=order.indexOf(it);const open=it.state==="open";
  const verb={approval:"wants your ok",question:"has a question",mention:"mentioned you",done:"finished something"}[it.kind];
  let ctx="",acts="";
  if(it.kind==="approval"&&it.sub==="cmd"){
    ctx=`<div class="cmd"><span class="k">$ git push origin fix/billing-meter</span>
1 commit · fix(billing): meter rounds per minute
<span style="color:var(--green)">+12</span> <span style="color:var(--red)">−4</span>  src/billing/meter.ts</div>
      <div style="display:flex;gap:6px;margin-top:10px"><button class="btn sm" data-act="meterdiff">${ic("code",13)} See the diff</button><button class="btn sm ghost" data-act="askwhy" data-id="${it.id}">${ic("reply",13)} Ask ${a.name} something</button></div>`;
    acts=`<button class="btn solid" data-act="iresolve" data-id="${it.id}" data-v="ALLOWED" data-key="a">Allow once <span class="kbd">A</span></button><button class="btn" data-act="ialways" data-id="${it.id}">Always allow fix/*</button><button class="btn bad push" data-act="iresolve" data-id="${it.id}" data-v="DENIED" data-key="d">Deny <span class="kbd">D</span></button>`;
  }else if(it.kind==="approval"){
    ctx=`<div class="posts">${THREAD.slice(0,2).map((p,i)=>`<div class="post">${logoHTML(WORKSPACES[0],30)}<div style="flex:1;min-width:0"><div class="ph"><b>Hyze Cloud</b><em>@hyzecloud · ${i+1}/5</em></div><div class="pc2">${p}</div><div class="cnt">${p.length} / 280</div></div></div>`).join("")}</div><button class="btn sm ghost" style="margin-top:8px" data-act="file" data-f="thread">${ic("plus",13)} 3 more posts</button>`;
    acts=`<button class="btn solid" data-act="iresolve" data-id="${it.id}" data-v="PUBLISHED" data-key="a">Approve and publish <span class="kbd">A</span></button><button class="btn" data-act="file" data-f="thread" data-key="e">Edit first <span class="kbd">E</span></button><button class="btn bad push" data-act="iresolve" data-id="${it.id}" data-v="NOT NOW" data-key="d">Not now <span class="kbd">D</span></button>`;
  }else if(it.kind==="question"){
    ctx=`<div class="choices">${it.choices.map((c,i)=>`<button class="choice" data-act="ianswer" data-id="${it.id}" data-c="${c}" data-key="${i+1}"><span class="n">${i+1}</span>${c}</button>`).join("")}</div>
      <div class="replybox"><input data-ifree placeholder="Or answer in your own words…"><button class="send" data-act="ifree" data-id="${it.id}">${ic("up",15,"#111",2.2)}</button></div>`;
    acts=`<button class="btn" data-act="openagent" data-id="${a.id}">${ic("reply",13)} Open ${a.name}'s chat</button><button class="btn ghost push" data-act="iresolve" data-id="${it.id}" data-v="SKIPPED" data-key="d">Skip for now <span class="kbd">D</span></button>`;
  }else if(it.kind==="mention"){
    ctx=`<div class="quote">${them(a,"17:15",`<div class="body"><p><span class="at">@${ME.name}</span> o título ficou bom? <b>“Plano Pro: VMs por hora, sem surpresa no fim do mês”</b>. Tenho mais três se quiser.</p></div>`).replace(/<div class="bar">[\s\S]*?<\/div><\/div>$/,"</div>")}</div>
      <div class="replybox"><input data-ifree placeholder="Reply in #${it.ch}…"><button class="send" data-act="ireply" data-id="${it.id}">${ic("up",15,"#111",2.2)}</button></div>`;
    acts=`<button class="btn" data-act="ich" data-v="${it.ch}">${ic("hash",13)} Open #${it.ch}</button><button class="btn ghost push" data-act="iresolve" data-id="${it.id}" data-v="READ" data-key="d">Mark read <span class="kbd">D</span></button>`;
  }else{
    ctx=it.file?fileCard(it.file,"code","PR #212 · pricing page for Pro","GitHub · 3 files · +184 −12","Review"):`<div class="cmd">pool.warm   40 → 48
pool.peak   72% busy at 21:40
cost/day    + R$ 18,40</div>`;
    acts=`${it.file?`<button class="btn solid" data-act="file" data-f="${it.file}">${ic("ext",13)} Open</button>`:`<button class="btn" data-act="openagent" data-id="${a.id}">Open ${a.name}'s chat</button>`}<button class="btn ghost push" data-act="iarchive" data-id="${it.id}" data-key="d">${ic("archive",13)} Archive <span class="kbd">D</span></button>`;
  }
  if(!open&&it.kind!=="done"){const v=VERDICT[it.res];acts=`<span style="display:flex;align-items:center;gap:8px;color:${it.ok?"var(--green)":"var(--red)"};font-weight:500">${ic(it.ok?"check":"x",15)} ${v[0]} at ${it.resAt}</span><button class="btn ghost push" data-act="iundo" data-id="${it.id}">${ic("refresh",13)} Undo</button>`}
  return `<div class="ptop"><span><span class="kbd">J</span> <span class="kbd">K</span> to move${open?" · letters on the buttons act":""}</span><span class="pos">${idx+1} of ${order.length}</span>
      <button class="ibtn" data-act="inav" data-d="-1" title="Previous (K)">${ic("chev",15).replace("<svg",'<svg style="transform:rotate(-90deg)"')}</button><button class="ibtn" data-act="inav" data-d="1" title="Next (J)">${ic("chev",15).replace("<svg",'<svg style="transform:rotate(90deg)"')}</button></div>
    <div class="pscroll"><div class="reader">
      <div class="from"><span data-act="openagentp" data-id="${a.id}" style="cursor:pointer;display:flex">${tileHTML(a,38)}</span><div><div class="nm">${a.name}</div><div class="rl">${a.role} · ${verb}</div></div><span class="when">${it.w}</span></div>
      <span class="kindpill" style="color:${col};background:color-mix(in srgb,${col} 12%,transparent)">${ic(icn,12)} ${lab}</span>
      <h1>${it.t}</h1><div class="sub">${it.s}</div>
      <div class="ctx">${ctx}</div>
      ${it.why?`<div class="why">${ic("lock",13)} ${it.why}${it.kind==="approval"?` <span class="lnk" data-act="openaccess" data-id="${a.id}">Change this</span>`:""}</div>`:""}
      <details class="hist"><summary>${ic("chev",13)} How it got here</summary><div class="tl">${it.path.map(([t,s,w],i)=>`<div class="e ${i===it.path.length-1?"hi":""}" ${i===it.path.length-1?'style="padding-bottom:0"':""}><div class="h">${t}<span class="t">${w}</span></div><div class="x">${s}</div></div>`).join("")}</div></details>
    </div></div>
    <div class="actbar"><div class="in">${acts}</div></div>`;
}
function zeroHTML(){
  const ags=wsAgents();
  return `<div class="zero"><div class="stack">${ags.slice(0,5).map(a=>`<span>${tileHTML(a,40)}</span>`).join("")}</div>
    <h2>You're all caught up</h2><p>${S.cleared} things cleared today. Your agents will knock when they need a decision.</p>
    <div class="who">${ags.map(a=>`<span data-act="openagent" data-id="${a.id}">${tileHTML(a,22)}${a.name}<em style="font-style:normal;color:var(--ink4)">${a.live?"working":a.when}</em></span>`).join("")}</div></div>`;
}
/* Settle an inbox item from anywhere: the reading pane, a chat card, a drawer. */
function resolve(id,verdict,extra=""){
  const it=INBOX.find(x=>x.id===id);if(!it||it.state!=="open")return;
  const ok=!/DENIED|NOT NOW|SKIPPED/.test(verdict);
  Object.assign(it,{state:"done",res:verdict,resAt:now(),ok});S.cleared++;
  if(id==="i1"){AG.mila.ask=false;AG.mila.line=ok?"The thread is live on X.":"Holding the thread for later."}
  if(id==="i2"){AG.ada.line=ok?"Pushed fix/billing-meter.":"Push cancelled. Branch kept."}
  if(id==="i3"){AG.hugo.line=`Got it: ${extra||verdict.toLowerCase()}. Back on it.`}
  const undo=()=>{Object.assign(it,{state:"open",res:null,resAt:null});S.cleared--;if(id==="i1")AG.mila.ask=true;S.inbox=id;render()};
  const [word,line]=VERDICT[verdict]||[verdict,""];
  const pane=$(".pane .pscroll");
  if(S.view==="inbox"&&pane&&S.inbox===id){
    $(".reader").classList.add("out");$(".actbar").style.visibility="hidden";
    setTimeout(()=>{pane.innerHTML=`<div class="settled"><span class="ring" style="background:color-mix(in srgb,${ok?"var(--green)":"var(--red)"} 14%,transparent);color:${ok?"var(--green)":"var(--red)"}">${ic(ok?"check":"x",24,"currentColor",2.2)}</span><b>${word}</b><span>${line}</span></div>`},200);
    setTimeout(()=>{const next=inboxGroups().flatMap(g=>g[1]).find(x=>x.state==="open");S.inbox=next?next.id:null;render()},1100);
  }else render();
  renderSide();toast(`${word} · ${it.t}`,{icon:ok?"check":"x",action:"Undo",onAction:undo});
}
function inboxNav(d){
  const order=inboxGroups().flatMap(g=>g[1]);if(!order.length)return;
  let i=order.findIndex(x=>x.id===S.inbox);i=(i+d+order.length)%order.length;S.inbox=order[i].id;render();
}
function meterDiff(){
  drawer({title:"fix/billing-meter",sub:"1 commit by Ada · tests green",icon:tileHTML(AG.ada,28),width:600,
    body:`<div class="doc2"><p><b>fix(billing): meter rounds per minute</b></p><p style="color:var(--ink3)">The meter rounded every session up to a full hour, so a 5-minute run billed 60.</p></div>
    <div class="diff"><div class="h">@@ src/billing/meter.ts:18 @@</div><div>  export function billable(ms: number) {</div><div class="d">-   return Math.ceil(ms / 3_600_000) * HOUR</div><div class="a">+   const minutes = Math.ceil(ms / 60_000)</div><div class="a">+   return minutes * MINUTE</div><div>  }</div></div>`,
    foot:`<button class="btn" data-act="iresolve" data-id="i2" data-v="DENIED">Deny</button><button class="btn solid push" data-act="iresolve" data-id="i2" data-v="ALLOWED">Allow once</button>`});
}
