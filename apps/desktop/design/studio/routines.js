/* ───────── routines: sentences on a week ───────── */
const DAYN=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],DAYL=["M","T","W","T","F","S","S"];
const TODAY=4,NOWH=21+14/60;
const ROUT=[
  {id:"r1",name:"Weekly numbers",a:"atlas",trig:"schedule",days:[0],time:"09:00",act:"pulls the weekly numbers",to:"#general",on:true,runs:"oooooooofooooooo",cost:"US$ 0.30",prompt:"Pegue os números da semana (MRR, VMs ativas, horas vendidas, churn) no Postgres e no Stripe. Compare com a semana passada, aponte o que mudou mais de 10% e termine com uma recomendação.",extra:[],quiet:true},
  {id:"r2",name:"Nightly capacity",a:"vex",trig:"schedule",days:[0,1,2,3,4,5,6],time:"03:00",act:"resizes the warm VM pool",to:"Vex's chat",on:true,runs:"oooooooooooooooo",cost:"US$ 0.08",prompt:"Leia a ocupação do pool nas últimas 24h e ajuste o número de VMs quentes para cobrir o pico com 15% de folga.",extra:[],fail:[2],quiet:true},
  {id:"r3",name:"Stripe disputes",a:"atlas",trig:"webhook",src:"Stripe",ev:"charge.dispute.created",act:"drafts a reply to the dispute",to:"Inbox",on:true,runs:"ooooofoooooooooo",cost:"US$ 0.12",prompt:"Leia a disputa, junte o uso da VM do cliente no período e escreva uma resposta com as evidências.",hits:[[1,14.2,1],[3,10.5,0]],extra:[]},
  {id:"r4",name:"Review every PR",a:"ada",trig:"webhook",src:"GitHub",ev:"pull_request.opened",act:"reviews the pull request",to:"a PR comment",on:true,runs:"oooooooooooooooo",cost:"US$ 0.22",prompt:"Revise o PR com o checklist de billing. Comente só o que bloquear o merge.",hits:[[0,11,1],[0,16.5,1],[1,15,1],[2,10,1],[3,14,1],[3,17.2,1],[4,9.4,1],[4,18.8,1]],extra:[]},
  {id:"r5",name:"Blog ideas",a:"leo",trig:"schedule",days:[4],time:"16:00",act:"pitches three blog ideas",to:"#launch",on:false,runs:"sssssooooooooooo",cost:"US$ 0.05",prompt:"Leia o que a Hyze lançou na semana e proponha três ideias de post com título e um parágrafo.",extra:[]},
];
const SOURCES={GitHub:["pull_request.opened","issues.opened","push","release.published"],Stripe:["charge.dispute.created","invoice.payment_failed","customer.subscription.deleted"],Linear:["issue.created","issue.updated"],Sentry:["issue.created","alert.triggered"],Custom:["POST /hooks/your-name"]};
const RTPL=[
  {name:"Morning digest",icon:"bell",d:"Weekdays at 08:00, what changed overnight.",set:{trig:"schedule",days:[0,1,2,3,4],time:"08:00",act:"sums up what changed overnight",to:"Inbox",name:"Morning digest"}},
  {name:"Weekly report",icon:"usage",d:"Mondays at 09:00, numbers against last week.",set:{trig:"schedule",days:[0],time:"09:00",act:"writes the weekly report",to:"#general",name:"Weekly report"}},
  {name:"Watch a webhook",icon:"bolt",d:"Runs when GitHub, Stripe or Sentry calls.",set:{trig:"webhook",src:"GitHub",ev:"pull_request.opened",act:"reviews the pull request",to:"a PR comment",name:"Review PRs"}},
  {name:"Nightly cleanup",icon:"moon",d:"Every night, tidy memory and stale tasks.",set:{trig:"schedule",days:[0,1,2,3,4,5,6],time:"03:00",act:"tidies its memory and closes stale tasks",to:"Inbox",name:"Nightly cleanup"}},
];
const srcMark=(v,n=16)=>({GitHub:"github",Stripe:"stripe",Linear:"linear",Sentry:"sentry"}[v]?brand({GitHub:"github",Stripe:"stripe",Linear:"linear",Sentry:"sentry"}[v],n):`<span class="brand" style="width:${n}px;height:${n}px;border-radius:${Math.round(n*.28)}px">${ic("webhook",Math.round(n*.6),"#444",2)}</span>`);
const hnum=t=>{const[h,m]=t.split(":").map(Number);return h+m/60};
const cap=s=>s[0].toUpperCase()+s.slice(1);
function whenText(r){
  const d=[...r.days].sort();
  if(d.length===7)return"every day";if(d.join()==="0,1,2,3,4")return"every weekday";if(d.join()==="5,6")return"every weekend";
  if(d.length===1)return"every "+DAYN[d[0]];return"on "+d.map(x=>DAYN[x].slice(0,3)).join(", ");
}
function nextText(r){
  if(!r.on)return"paused";if(r.trig==="webhook")return"on event";
  const h=hnum(r.time);for(let k=0;k<8;k++){const d=(TODAY+k)%7;if(r.days.includes(d)&&(k>0||h>NOWH)){return k===0?"today "+r.time:k===1?"tomorrow "+r.time:DAYN[d].slice(0,3)+" "+r.time}}return"—";
}
function sentence(r){
  const a=AG[r.a];const ck=(k,v)=>`<span class="ck" data-act="ck" data-k="${k}" data-r="${r.id}">${v}</span>`;
  const ag=`<span class="ck ag" data-act="ck" data-k="agent" data-r="${r.id}">${tileHTML(a,18)}${a.name}</span>`;
  if(r.trig==="schedule")return `${ck("days",cap(whenText(r)))} at ${ck("time",r.time)}, ${ag} ${ck("act",r.act)} and posts it in ${ck("to",r.to)}.`;
  return `When ${ck("src",r.src)} sends ${ck("ev",r.ev)}, ${ag} ${ck("act",r.act)} and puts it in ${ck("to",r.to)}.`;
}
/* The week as seven days, each holding the faces of the agents that ran (or will run) that day. */
function weekHTML(list){
  const per=Array.from({length:7},()=>[]);
  for(const r of list){
    const a=AG[r.a];const mark=(d,h,st,fresh)=>per[d].push({h,html:`<span class="wm ${st} ${fresh?"fresh":""}" data-act="runinfo" data-r="${r.id}" data-d="${d}" data-h="${h}" data-st="${st}" title="${r.name} · ${String(Math.floor(h)).padStart(2,"0")}:${String(Math.round(h%1*60)).padStart(2,"0")}">${tileHTML(a,20)}</span>`});
    if(r.trig==="schedule")r.days.forEach(d=>{const h=hnum(r.time);const past=d<TODAY||(d===TODAY&&h<NOWH);if(!r.on&&!past)return;mark(d,h,past?((r.fail||[]).includes(d)?"fail":"ok"):"next")});
    else(r.hits||[]).forEach(([d,h,ok])=>mark(d,h,ok?"ok":"fail"));
    r.extra.forEach(([d,h,fresh])=>mark(d,h,"ok",fresh));
  }
  return `<div class="week">${DAYN.map((d,i)=>`<div class="wd ${i===TODAY?"today":""}"><div class="dn">${d.slice(0,3)} <b>${19+i}</b></div><div class="runs2">${per[i].sort((x,y)=>x.h-y.h).map(m=>m.html).join("")}</div></div>`).join("")}</div>
    <div class="wnote"><span>Each face is a run</span><span>Faded ones are coming up</span><span><i class="okdot" style="background:var(--red)"></i>failed</span></div>`;
}
function routineCard(r){
  const a=AG[r.a];const last=r.runs.replace(/s/g,"").slice(-1);
  return `<div class="rc ${r.on?"":"off"} ${r.running?"running":""}" data-act="redit" data-r="${r.id}" style="--c:${a.color}">
    <span class="tile0">${tileHTML(a,34)}</span>
    <div style="flex:1;min-width:0"><div class="rn">${r.name}</div><div class="sent">${sentence(r)}</div>
      <div class="rm">${r.running?`<span class="live"><span class="spin" style="--tint:${a.color}"></span><span class="shimmer">${a.name} is running this now</span><span data-rclock>0:00</span></span>`:
        `${ic(r.trig==="webhook"?"webhook":"clock",13)}<span>${r.on?(r.trig==="webhook"?"Runs when "+r.src+" calls":"Next "+nextText(r)):"Paused"}</span>${last?`<span>·</span><span class="${last==="f"?"bad":"ok"}">${last==="f"?"last run failed":"last run ok"}</span>`:""}`}</div></div>
    <div class="rr"><button class="btn sm runbtn" data-act="rrun" data-r="${r.id}" ${r.running?"disabled":""}>${ic("play",12)} Run now</button><span class="tog ${r.on?"on":""}" data-act="rtog" data-r="${r.id}" title="${r.on?"Pause":"Turn on"}"></span><button class="ibtn" data-act="rmore" data-r="${r.id}">${ic("more",16)}</button></div>
  </div>`;
}
function renderRoutines(){
  const ws=WORKSPACES[S.ws].agents;
  const mine=ROUT.filter(r=>ws.includes(r.a)||!AG[r.a]);
  const list=mine.filter(r=>S.rfilter==="all"||r.trig===S.rfilter);
  const top=$(".pagewrap")?.scrollTop||0;
  main.innerHTML=`<div class="ptitlebar"><h1>${ic("clock",16)} Routines</h1>
      <div class="subtabs" style="margin-left:14px">${[["all","All",mine.length],["schedule","Scheduled",mine.filter(r=>r.trig==="schedule").length],["webhook","Webhooks",mine.filter(r=>r.trig==="webhook").length]].map(([k,l,n])=>`<a class="${S.rfilter===k?"on":""}" data-act="rfilter" data-v="${k}">${l} <em>${n}</em></a>`).join("")}</div>
      <div class="acts"><button class="btn solid" data-act="rnew">${ic("plus",14)} New routine</button></div></div>
    <div class="pagewrap"><div class="pageinner">
      ${list.length?weekHTML(list):""}
      <div class="rfilters"><h3>${list.length} routine${list.length===1?"":"s"}</h3><span>Click an underlined word to change it</span></div>
      <div class="rlist">${list.map(routineCard).join("")||`<div class="card" style="text-align:center;color:var(--ink3);padding:44px">No routines in ${WORKSPACES[S.ws].name} yet. <span class="lnk" data-act="rnew">Make the first one</span></div>`}</div>
    </div></div>`;
  $(".pagewrap").scrollTop=top;
}
const R=id=>ROUT.find(r=>r.id===id);
function chipPop(el,r,k){
  const re=()=>{closePop();render()};const lb=t=>"#"+t;
  if(k==="agent")return menu(el,["#Who runs it",...wsAgents().map(a=>[null,a.name,()=>{r.a=a.id;re()},{html:tileHTML(a,20),s:a.role,chk:a.id===r.a}])]);
  if(k==="to")return menu(el,["#Where the result goes",...[`${AG[r.a].name}'s chat`,...WORKSPACES[S.ws].channels.map(c=>"#"+c),"Inbox","a PR comment"].map(v=>[v.startsWith("#")?"hash":v==="Inbox"?"inbox":"reply",v,()=>{r.to=v;re()},{chk:v===r.to}])]);
  if(k==="src")return menu(el,["#Which service calls",...Object.keys(SOURCES).map(v=>[null,v,()=>{r.src=v;r.ev=SOURCES[v][0];re()},{chk:v===r.src,html:srcMark(v,18)}])]);
  if(k==="ev")return menu(el,["#Which event",...SOURCES[r.src].map(v=>[null,`<code class="mono" style="font-size:11.5px">${v}</code>`,()=>{r.ev=v;re()},{chk:v===r.ev}])]);
  if(k==="time"){
    const p=menu(el,["#At",...["06:00","08:00","09:00","12:00","16:00","18:00","22:00"].map(v=>["clock",v,()=>{r.time=v;re()},{chk:v===r.time}]),"hr"]);
    p.insertAdjacentHTML("beforeend",`<div class="pad" style="display:flex;gap:6px"><input type="time" class="input" value="${r.time}" data-t style="height:30px"><button class="btn sm solid" data-ok>Set</button></div>`);
    $("[data-ok]",p).onclick=()=>{r.time=$("[data-t]",p).value||r.time;re()};return p;
  }
  if(k==="days"){
    const p=pop(el,`<div class="lbl">Which days</div><div class="pad"><div class="days">${DAYL.map((d,i)=>`<b class="${r.days.includes(i)?"on":""}" data-d="${i}">${d}</b>`).join("")}</div>
      <div style="display:flex;gap:6px;margin-top:10px"><button class="btn sm" data-q="all">Every day</button><button class="btn sm" data-q="wk">Weekdays</button><button class="btn sm solid" data-q="ok" style="margin-left:auto">Done</button></div></div>`);
    $$("[data-d]",p).forEach(b=>b.onclick=()=>{const d=+b.dataset.d;if(r.days.includes(d)){if(r.days.length>1)r.days=r.days.filter(x=>x!==d)}else r.days.push(d);b.classList.toggle("on",r.days.includes(d));renderKeepPop()});
    $$("[data-q]",p).forEach(b=>b.onclick=()=>{if(b.dataset.q==="all")r.days=[0,1,2,3,4,5,6];if(b.dataset.q==="wk")r.days=[0,1,2,3,4];re()});
    return p;
  }
  if(k==="act"){
    const p=pop(el,`<div class="lbl">What ${AG[r.a].name} does, in a few words</div><div class="pad"><input class="input" data-v value="${esc(r.act)}"><div style="display:flex;gap:6px;margin-top:8px"><span class="lnk" style="font-size:12px;align-self:center" data-full>Edit the full prompt</span><button class="btn sm solid" data-ok style="margin-left:auto">Save</button></div></div>`);
    p.style.width="340px";const inp=$("[data-v]",p);inp.focus();inp.select();
    const ok=()=>{r.act=inp.value.trim()||r.act;re()};$("[data-ok]",p).onclick=ok;inp.onkeydown=e=>{if(e.key==="Enter")ok()};
    $("[data-full]",p).onclick=()=>{closePop();routineEditor(r)};return p;
  }
}
function renderKeepPop(){const p=popEl;popEl=null;render();popEl=p}
function runRoutine(r){
  if(r.running)return;r.running=true;render();const t0=Date.now();
  const clk=setInterval(()=>{const c=$(`.rc[data-r="${r.id}"] [data-rclock]`);if(c)c.textContent="0:0"+Math.floor((Date.now()-t0)/1000)},250);
  setTimeout(()=>{clearInterval(clk);r.running=false;r.runs=r.runs.slice(1)+"o";r.extra.forEach(x=>x[2]=0);r.extra.push([TODAY,NOWH,1]);if(S.view==="routines")render();
    toast(`${r.name} ran in 2.8s · ${r.to}`,{icon:"check",action:"See result",onAction:()=>runInfo(r,TODAY,NOWH,"ok")})},2800);
}
function runInfo(r,d,h,st){
  const a=AG[r.a];const hh=`${String(Math.floor(h)).padStart(2,"0")}:${String(Math.round(h%1*60)).padStart(2,"0")}`;
  const next=st==="next";
  const out={atlas:"MRR R$ 48.210 (+6%). VMs ativas 1.284 (+11%). Churn 2,1% (−0,4). Recomendo segurar o desconto anual mais uma semana.",vex:"Pico de 72% às 21:40. Pool ajustado de 40 para 48 VMs quentes.",ada:"Revisei 2 arquivos. Um comentário bloqueante: falta teste para minutos parciais.",leo:"1. Por que cobramos por hora · 2. Firecracker em 5 minutos · 3. O custo real de um agente"}[r.a]||"Feito.";
  const stat=(v,k,c="var(--ink)")=>`<div><div style="font-size:20px;font-weight:600;letter-spacing:-.02em;color:${c}">${v}</div><div style="font-size:12px;color:var(--ink3);margin-top:2px">${k}</div></div>`;
  drawer({title:`${r.name}`,sub:`${DAYN[d]} at ${hh} · ${next?"scheduled":st==="fail"?"failed":"ran"}`,icon:tileHTML(a,30),width:500,center:true,
    body:next?`<div class="card" style="display:flex;gap:12px;align-items:center">${ic("clock",18)}<div><div style="font-weight:550">Runs ${DAYN[d]} at ${r.time}</div><div style="font-size:12px;color:var(--ink3);margin-top:2px">${a.name} → ${r.to}</div></div></div><h4>What it will do</h4><div style="color:var(--ink2);line-height:1.65">${r.prompt}</div>`:
      `<div style="display:flex;gap:28px">${stat(st==="fail"?"0:12":"2:04","Duration")}${stat(r.cost,"Cost")}${stat(st==="fail"?"Failed":"OK","Result",st==="fail"?"var(--red)":"var(--green)")}</div>
      <h4>${st==="fail"?"What went wrong":"What "+a.name+" posted"}</h4>${st==="fail"?`<div class="cmd" style="color:var(--red)">Error: Stripe key expired (401)\nYou renewed it the same day.</div>`:`<div class="quote">${them(a,hh,`<div class="body"><p>${out}</p></div>`).replace(/<div class="bar">[\s\S]*?<\/div><\/div>$/,"</div>")}</div>`}`,
    foot:next?`<button class="btn ghost" data-act="rskip" data-r="${r.id}" data-d="${d}">Skip this one</button><button class="btn solid push" data-act="rrun" data-r="${r.id}">${ic("play",13)} Run now instead</button>`:`<button class="btn" data-act="openagent" data-id="${a.id}">Open ${a.name}'s chat</button><button class="btn solid push" data-act="rrun" data-r="${r.id}">${ic("refresh",13)} Run again</button>`});
}
let RD=null;
function routineEditor(r,prompt=""){
  const isNew=!r;
  RD=r?JSON.parse(JSON.stringify(r)):{id:"r"+Date.now(),name:"",a:wsAgents()[0]?.id||"atlas",trig:"schedule",days:[0,1,2,3,4],time:"09:00",act:"",to:"Inbox",on:true,runs:"ssssssssssssssss",cost:"—",prompt,extra:[],quiet:true,src:"GitHub",ev:"pull_request.opened"};
  const d=drawer({title:isNew?"New routine":r.name,sub:isNew?"An agent does something on its own, on a clock or a signal":`${AG[r.a].name} · ${r.trig==="webhook"?"webhook":"schedule"}`,icon:`<span class="ibtn" style="background:var(--s3);color:var(--ink2)">${ic(isNew?"plus":"clock",16)}</span>`,width:860,center:true,body:"",
    foot:`${isNew?"":`<button class="btn bad" data-act="rdel" data-r="${r.id}">${ic("trash",13)} Delete</button>`}<button class="btn ghost push" data-x2>Cancel</button><button class="btn solid" data-rsave>${isNew?"Create routine":"Save changes"}</button>`});
  const body=$(".dbd",d);
  const draw=()=>{body.innerHTML=editorBody(isNew);bindEditor(body,draw)};draw();
  $("[data-x2]",d).onclick=closeDrawer;
  $("[data-rsave]",d).onclick=()=>{
    RD.name=$("[data-rn]",body).value.trim()||RD.act||"Untitled routine";RD.act=$("[data-ra]",body).value.trim()||"does the job";RD.prompt=$("[data-rp]",body).value;
    if(isNew){ROUT.unshift(RD);S.rfilter="all"}else Object.assign(R(r.id),RD);
    closeDrawer();if(S.view!=="routines")S.view="routines";render();toast(isNew?`${RD.name} is on · next ${nextText(RD)}`:"Saved",{icon:"check"});
  };
}
const previewText=()=>{const a=AG[RD.a];const b=x=>`<b>${esc(x||"…")}</b>`;
  return RD.trig==="schedule"?`${b(cap(whenText(RD)))} at ${b(RD.time)}, ${b(a.name)} ${b(RD.act||"does something")} and posts it in ${b(RD.to)}.`:`When ${b(RD.src)} sends ${b(RD.ev)}, ${b(a.name)} ${b(RD.act||"does something")} and puts it in ${b(RD.to)}.`};
function editorBody(isNew){
  const a=AG[RD.a];
  return `${isNew?`<h4>Start from a template</h4><div class="tpls" style="margin-bottom:6px">${RTPL.map((t,i)=>`<button class="tpl" data-tpl="${i}">${ic(t.icon,18)}<b>${t.name}</b><span>${t.d}</span></button>`).join("")}</div>`:""}
  <div class="redit"><div>
    <h4>Name</h4><input class="input" data-rn value="${esc(RD.name)}" placeholder="Weekly numbers">
    <h4>Who runs it</h4><div class="pick">${wsAgents().map(x=>`<button class="${x.id===RD.a?"on":""}" data-rag="${x.id}">${tileHTML(x,26)}<span>${x.name}<em>${x.role}</em></span><span class="c">${x.id===RD.a?ic("check",11,"#111",2.6):""}</span></button>`).join("")}</div>
    <h4>When</h4><div class="seg" data-seg="rtrig"><button data-v="schedule" class="${RD.trig==="schedule"?"on":""}">${ic("clock",13)} On a schedule</button><button data-v="webhook" class="${RD.trig==="webhook"?"on":""}">${ic("webhook",13)} When a service calls</button></div>
    ${RD.trig==="schedule"?`<div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap"><div class="days">${DAYL.map((x,i)=>`<b class="${RD.days.includes(i)?"on":""}" data-rd="${i}">${x}</b>`).join("")}</div><input type="time" class="input" data-rt value="${RD.time}" style="width:110px;font-variant-numeric:tabular-nums"><span style="font-size:12px;color:var(--ink4)">São Paulo time</span></div>`:
      `<div style="margin-top:12px"><div class="seg" data-seg="rsrc">${Object.keys(SOURCES).map(x=>`<button data-v="${x}" class="${x===RD.src?"on":""}">${srcMark(x,16)}${x}</button>`).join("")}</div>
       <div class="temps" style="margin-top:10px">${SOURCES[RD.src].map(e=>`<button class="${e===RD.ev?"on":""}" data-rev="${e}" style="font-family:var(--mono);font-size:11.5px">${e}</button>`).join("")}</div>
       <div class="fl" style="margin-top:16px">Point ${RD.src} at this address</div><div class="hook">${ic("globe",14)}<span>https://hooks.hz.app/w/hyze/${RD.id}</span><button class="btn sm ghost" data-copyhook>${ic("copy",13)} Copy</button></div>
       <div class="hook" style="margin-top:6px">${ic("key",14)}<span data-sec>whsec_••••••••••••••••</span><button class="btn sm ghost" data-reveal>${ic("eye",13)} Show</button></div></div>`}
    <h4>What ${a.name} does</h4><input class="input" data-ra value="${esc(RD.act)}" placeholder="pulls the weekly numbers">
    <textarea class="fld" data-rp style="height:110px;resize:none;margin-top:8px;line-height:1.6" placeholder="The full prompt ${a.name} gets every run.">${esc(RD.prompt)}</textarea>
    <h4>Where the result goes</h4><div class="seg" data-seg="rto">${[...new Set([`${a.name}'s chat`,...WORKSPACES[S.ws].channels.map(c=>"#"+c),"Inbox",RD.to])].map(v=>`<button data-v="${v}" class="${v===RD.to?"on":""}">${v}</button>`).join("")}</div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:16px;font-size:13px"><div><div style="font-weight:500">Quiet run</div><div style="color:var(--ink3);font-size:12px;margin-top:1px">No ping unless something changed or it needs you</div></div><span class="tog ${RD.quiet?"on":""}" data-rq style="margin-left:auto"></span></div>
  </div>
  <div><div class="preview"><div class="pt">In one sentence</div><div class="ps" data-pv>${previewText()}</div>
    ${isNew?"":`<div class="pt" style="margin-top:20px">Last runs</div><div class="runs">${[...RD.runs].map(c=>`<i class="${c==="f"?"f":c==="s"?"s":""}"></i>`).join("")}</div>`}</div></div></div>`;
}
function bindEditor(body,draw){
  const keep=()=>{RD.name=$("[data-rn]",body).value;RD.act=$("[data-ra]",body).value;RD.prompt=$("[data-rp]",body).value;const t=$("[data-rt]",body);if(t)RD.time=t.value};
  $$("[data-tpl]",body).forEach(b=>b.onclick=()=>{keep();Object.assign(RD,JSON.parse(JSON.stringify(RTPL[+b.dataset.tpl].set)));RD.prompt=RD.prompt||"";draw();$$("[data-tpl]",body)[+b.dataset.tpl]?.classList.add("on")});
  $$("[data-rag]",body).forEach(b=>b.onclick=()=>{keep();RD.a=b.dataset.rag;if(RD.to.endsWith("'s chat"))RD.to=AG[RD.a].name+"'s chat";draw()});
  $$("[data-rd]",body).forEach(b=>b.onclick=()=>{keep();const d=+b.dataset.rd;RD.days=RD.days.includes(d)?(RD.days.length>1?RD.days.filter(x=>x!==d):RD.days):[...RD.days,d];draw()});
  $$("[data-rev]",body).forEach(b=>b.onclick=()=>{keep();RD.ev=b.dataset.rev;draw()});
  $$("[data-seg] button",body).forEach(b=>b.onclick=e=>{e.stopPropagation();keep();const k=b.parentElement.dataset.seg,v=b.dataset.v;if(k==="rtrig")RD.trig=v;if(k==="rsrc"){RD.src=v;RD.ev=SOURCES[v][0]}if(k==="rto")RD.to=v;draw()});
  const q=$("[data-rq]",body);q.onclick=e=>{e.stopPropagation();RD.quiet=!RD.quiet;q.classList.toggle("on",RD.quiet)};
  const c=$("[data-copyhook]",body);if(c)c.onclick=()=>{navigator.clipboard?.writeText(`https://hooks.hz.app/w/hyze/${RD.id}`).catch(()=>{});toast("Webhook URL copied",{icon:"copy"})};
  $$("[data-rn],[data-ra]",body).forEach(i=>i.oninput=()=>{keep();$("[data-pv]",body).innerHTML=previewText()});
  const rv=$("[data-reveal]",body);if(rv)rv.onclick=()=>{const s=$("[data-sec]",body);const shown=s.textContent.includes("•");s.textContent=shown?"whsec_9f2c41ad7e0b33c8a1d5":"whsec_••••••••••••••••";rv.innerHTML=`${ic("eye",13)} ${shown?"Hide":"Show"}`};
}
