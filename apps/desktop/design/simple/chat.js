/* chat: the feed, bubbles, steps, cards, inline approvals, composer, send -> typing -> reply. */
const mk=(from,text,t,x={})=>({id:nid("m"),from,text,t,...x});
S.inbox=[
  {id:"i1",kind:"approval",agent:"mila",conv:"mila",title:"Publish the launch thread on X?",detail:"7 posts, scheduled for Oct 30 at 10:00. Needs your OK.",opts:["Approve","Deny"],state:null},
  {id:"i2",kind:"approval",agent:"ada",conv:"ada",title:"Run pnpm db:migrate on staging?",detail:"Adds the usage_events table. Reversible.",opts:["Approve","Deny"],state:null},
  {id:"i3",kind:"question",agent:"atlas",conv:"atlas",title:"Which annual price should the page show?",detail:"Both beat the monthly plan on margin.",opts:["$290 / year","$278 / year"],state:null},
  {id:"i4",kind:"mention",agent:"leo",conv:"#launch",title:"Leo mentioned you in #launch",detail:"“@Gabriel can you check the blog title before I schedule it?”",opts:["Open"],state:null},
];
const askMsg=(iid,t)=>({id:nid("m"),kind:"ask",iid,t});
const CHATS={
  atlas:[
    {id:"e1",kind:"earlier",n:12},
    {id:"d1",kind:"day",text:"Today"},
    mk("atlas","Morning, Gabriel. I closed the pricing analysis for the Pro plan. The annual plan at **$290** beats $278 on margin by 4 points.","21:02"),
    {id:"c1",from:"atlas",t:"21:02",card:{type:"chart",title:"Margin by annual price",unit:"%",bars:[["$250",31],["$265",36],["$278",40],["$290",44],["$310",43]],hi:3,note:"Churn stays flat up to $290, then rises."}},
    {id:"c2",from:"atlas",t:"21:03",card:{type:"sources",items:[["stripe.com","Stripe Billing docs"],["paddle.com","SaaS pricing report 2026"],["hyzecloud.com","Our usage data, last 90 days"]]}},
    mk("me","Good. Can you also check what Mila has queued for launch day?","21:05"),
    {id:"r1",kind:"run",who:"atlas",steps:4,secs:44,t:"21:05"},
    {id:"h1",kind:"handoff",with:"mila",n:2},
    mk("atlas","Mila has the launch thread, the blog post and two stories queued. The thread needs your OK before it goes out, so I asked her to wait.","21:06",{rx:{"👍":["me"]},see:1}),
    {id:"s1",kind:"sys",text:"Routine created · <b>Weekly pricing review</b>, Mondays at 09:00"},
    {id:"st1",kind:"steps",title:"Prepare launch day",t:"now",stopped:1,items:[["Pull the pricing numbers from Stripe","d"],["Map the posts that are already queued","d"],["Check the pricing page copy against the plan","d"],["Confirm the thread timing with Mila",""],["Draft the launch-day checklist",""],["Set up the signup funnel dashboard",""],["Review it with Gabriel",""]]},
    {id:"p1",from:"atlas",t:"21:13",card:{type:"page",title:"Pro plan pricing page",url:"pages.hz/hyze/pro",v:3}},
    mk("atlas","The pricing analysis is saved. Open it when you have a minute.","21:14",{file:{name:"pricing-analysis.md",size:"4.2 KB",kind:"Document",body:"# Pro plan pricing\n\nMonthly      $29\nAnnual       $290  (saves 16.6%)\nAnnual alt   $278  (saves 20%)\n\nMargin at $290 beats $278 by 4 points.\nChurn risk is flat in both cases.\n\nRecommendation: show $290, test $278 after launch."}}),
    mk("atlas","And the pricing page change is up for review.","21:14",{pr:"pr3"}),
    {id:"k1",kind:"call",who:"atlas",dur:"2:14",t:"21:15",sum:["Show $290 a year on the page, test $278 after launch.","Mila holds the thread until you approve it.","Atlas sends the funnel numbers on Friday."]},
    askMsg("i3","21:15"),
  ],
  ada:[
    {id:"d2",kind:"day",text:"Today"},
    mk("me","Run the api tests and fix whatever fails.","20:58"),
    mk("ada","On it. I'll run the filtered suite first, then the full one if it's clean.","20:58"),
    {id:"a0",kind:"approved",who:"ada",what:"Terminal command",cmd:"pnpm test --filter api",t:"20:58"},
    {id:"cd1",from:"ada",t:"21:00",card:{type:"code",file:"src/webhook.rs",lang:"rust",code:"let delay = base * 2u64.pow(attempt);\nlet delay = delay.min(60_000);\nsleep(Duration::from_millis(delay)).await;"}},
    {id:"st2",kind:"steps",title:"Fix failing api tests",t:"now",live:1,items:[["Run pnpm test --filter api","d"],["Read the failing case","d"],["Patch the retry backoff","run"],["Re-run the filtered suite",""],["Run the full suite",""]]},
    askMsg("i2","21:01"),
  ],
  mila:[
    {id:"d3",kind:"day",text:"Today"},
    mk("mila","The launch thread is ready: 7 posts, one image. I won't publish without you.","20:50"),
    {id:"dr1",from:"mila",t:"20:51",card:{type:"draft",to:"X · @hyzecloud",subj:"Post 1 of 7",body:"Sandbox VMs by the hour, built for agents.\n\nThe Pro plan opens Oct 30. Spin up a VM, let your agent work, pay for the minutes it ran."}},
    mk("me","Show me the first post.","20:55",{failed:1}),
    mk("mila","“Sandbox VMs by the hour, built for agents. The Pro plan opens Oct 30.”","20:56",{rx:{"🔥":["atlas"]}}),
    askMsg("i1","21:02"),
  ],
  hugo:[
    {id:"d5",kind:"day",text:"Today"},
    mk("me","What are people paying for sandboxes by the hour?","18:20"),
    {id:"vm1",from:"hugo",t:"18:38",card:{type:"voice",dur:"0:42"}},
    mk("hugo","3 sources on usage-based billing. Short version: per-minute billing wins trust, per-hour wins margin.","18:40"),
    {id:"c5",from:"hugo",t:"18:40",card:{type:"sources",items:[["e2b.dev","E2B pricing"],["modal.com","Modal pricing"],["fly.io","Fly Machines pricing"]]}},
  ],
  leo:[
    {id:"d6",kind:"day",text:"Tuesday"},
    mk("me","Make a cover image for the Sandbox VMs post.","16:02"),
    {id:"g1",from:"leo",t:"16:03",card:{type:"gen",prompt:"A small VM floating over a desk, flat, soft light"}},
    mk("leo","Draft is in Drive: Sandbox VMs. The cover is still rendering.","16:04"),
  ],
  vex:[
    {id:"d7",kind:"day",text:"Today"},
    mk("vex","Firecracker pool is at 72%. I can add a second region, but I need a key.","20:51"),
    {id:"kr1",from:"vex",t:"20:51",card:{type:"key",name:"HETZNER_API_TOKEN",why:"To create the second pool in Falkenstein."}},
  ],
  nox:[
    {id:"d8",kind:"day",text:"Monday"},
    mk("nox","No new CVEs in the base image. One thing needs you: the AWS console wants a second factor.","09:12"),
    {id:"to1",from:"nox",t:"09:12",card:{type:"takeover",site:"console.aws.amazon.com",why:"Sign in needs your phone. Take over the browser, finish it, then give it back."}},
    {id:"qr1",from:"nox",t:"09:13",card:{type:"qr",site:"WhatsApp Web",why:"Scan this with your phone so I can read the support group."}},
  ],
  "#launch":[
    {id:"d4",kind:"day",text:"Today"},
    mk("atlas","Goal for today: freeze the copy. Mila owns the thread, Leo the blog.","19:40"),
    mk("mila","Thread draft is in. @Leo can you match the blog title to it?","20:05"),
    mk("leo","Done. Title is “Sandbox VMs, explained”. @Gabriel can you check it before I schedule it?","20:11",{men:1}),
    {id:"s2",kind:"sys",text:"Round 2 of 3 · <b>Mila</b>, <b>Atlas</b>, <b>Leo</b>"},
    mk("mila","I'll hold the thread until Gabriel approves.","21:20"),
  ],
};
const chatOf=id=>CHATS[id]||(CHATS[id]=[{id:nid("d"),kind:"day",text:"Today"},...(isCh(id)?[mk(CH[id].lead,"Hi. "+CH[id].purpose,"09:00")]:[mk(id,AG[id].line,AG[id].when.includes(":")?AG[id].when:"09:00")])]);
const findMsg=(conv,id)=>chatOf(conv).find(m=>m.id===id);
const mood=a=>a.asleep?" (resting)":"";

function stepsHTML(m){
  const done=m.items.filter(i=>i[1]==="d").length,all=done===m.items.length,open=S.steps[m.id];
  const state=m.live?"Working":all?"Finished":"Stopped at";
  const lab=m.live||!all?`${done} of ${m.items.length} steps`:`${m.items.length} steps`;
  const pill=`<button class="spill ${m.live?"live":""}" data-act="steps" data-id="${m.id}"><span class="pa">${ic(m.live?"play":all?"check":"pause",10)}</span>${state} ${lab} <i>${m.t}</i>${ic("down",14)}</button>`;
  const card=`<div class="scard"><div class="h" data-act="steps" data-id="${m.id}">${esc(m.title)}<i>${done} of ${m.items.length} · ${m.t} ${ic("up3",14)}</i></div>${m.items.map(i=>`<div class="step ${i[1]}"><span class="c">${i[1]==="d"?ic("check",10,"currentColor",3):""}</span><span>${esc(i[0])}</span></div>`).join("")}${m.live?Btn("Stop",{act:"stop-run",icon:"stop",size:"sm",kind:"bad",a:{"data-id":m.id}}):m.stopped?Btn("Resume",{act:"resume-run",icon:"play",size:"sm",a:{"data-id":m.id}}):""}</div>`;
  return `<div class="msg" data-id="${m.id}">${open?card:pill}</div>`;
}
/* a question asks for one of a few answers; an approval shows exactly what will run */
function askHTML(m){
  const it=S.inbox.find(i=>i.id===m.iid),a=AG[it.agent];
  if(it.state)return `<div class="sys">${ic("circleok",14)}<span>${it.kind==="question"?"You chose":it.state==="Approve"?"Approved":"Denied"} · <b>${esc(it.kind==="question"?it.state:it.title)}</b></span></div>`;
  if(it.kind==="question")return `<div class="msg" data-id="${m.id}">${Card({icon:"q",label:`${a.name} asks`,right:m.t,body:`<p class="t">${esc(it.title)}</p><p class="s">${esc(it.detail)}</p><div class="choices">${it.opts.map((o,i)=>Choice(i+1,esc(o),{act:"resolve",note:i?"":"recommended",a:{"data-id":it.id,"data-o":o}})).join("")}</div>`})}</div>`;
  const cmd=it.cmd||({i1:"x.post  --thread launch.md  --schedule 2026-10-30T10:00",i2:"pnpm db:migrate --env staging"}[it.id]||"");
  return `<div class="msg" data-id="${m.id}">${Card({icon:"shield",label:`${a.name} needs your OK`,right:m.t,body:`<p class="t">${esc(it.title)}</p><p class="s">${esc(it.detail)}</p>${cmd?`<div class="cmd"><span class="p">$ </span>${esc(cmd)}</div>`:""}`,foot:`${Btn("Approve",{act:"resolve",kind:"primary",size:"sm",a:{"data-id":it.id,"data-o":"Approve"}})}${Btn("Deny",{act:"resolve",size:"sm",kind:"ghost",a:{"data-id":it.id,"data-o":"Deny"}})}<span class="grow note2">${Btn("Always allow this",{act:"always-allow",size:"sm",kind:"ghost",a:{"data-id":it.id}})}</span>`})}</div>`;
}
/* the rich cards an agent can post, one renderer each */
const CARDS={
  chart:c=>Card({icon:"chart",label:c.title,body:`<div class="chart">${c.bars.map(([k,v],i)=>`<div><span>${v}${c.unit}</span><i class="${i===c.hi?"hi":""}" style="height:${v*2}px;animation-delay:${i*50}ms"></i></div>`).join("")}</div><div class="chartl">${c.bars.map(b=>`<span>${b[0]}</span>`).join("")}</div><p class="s" style="margin-top:8px">${c.note}</p>`}),
  sources:c=>Card({icon:"globe",label:`${c.items.length} sources`,body:`<div class="src" style="margin-top:4px">${c.items.map(([d,t])=>`<a data-act="lib-link" data-id="${d}" title="${esc(t)}"><i>${d[0].toUpperCase()}</i>${d}</a>`).join("")}</div>`}),
  page:c=>Card({icon:"page",label:`Page · version ${c.v}`,body:`<div class="page"><span class="th"><i></i><i></i><i></i><i></i></span><div><b>${esc(c.title)}</b><span>${c.url}</span></div></div>`,foot:`${Btn("Open page",{act:"page-open",size:"sm",kind:"primary"})}${Btn("Versions",{act:"page-versions",size:"sm",kind:"ghost",icon:"history"})}`}),
  draft:c=>Card({icon:"pen",label:"Draft",body:`<div class="draft"><div class="hd"><span>To</span><b>${esc(c.to)}</b><span>Part</span><b>${esc(c.subj)}</b></div>${fmt(c.body)}</div>`,foot:`${Btn("Edit",{act:"draft-edit",size:"sm",icon:"pen"})}${Btn("Copy",{act:"copy-text",size:"sm",kind:"ghost",icon:"copy"})}`}),
  code:c=>Card({icon:"code",label:c.file,right:IconBtn("copy",{act:"copy-text",size:"sm",title:"Copy"}),body:`<div class="cmd" style="margin-top:2px">${esc(c.code)}</div>`}),
  voice:c=>`<div class="voice"><button class="pl" data-act="voice-play" title="Play">${ic("play",12)}</button><span class="wv">${Array.from({length:34},(_,i)=>`<i style="height:${4+Math.abs(Math.sin(i*1.7))*16}px"></i>`).join("")}</span><span>${c.dur}</span></div>`,
  gen:c=>`<div class="gen">${Banner("#38bdf8","gen"+c.prompt)}<span><i></i>Drawing the image…</span></div>`,
  key:c=>Card({icon:"key",label:"Needs a key",body:`<p class="t">${c.name}</p><p class="s">${esc(c.why)} It goes to the keychain; the agent only sees it as an environment variable.</p><div style="margin-top:10px">${Field({type:"password",placeholder:"Paste the key",mono:true,in:"key-paste"})}</div>`,foot:`${Btn("Save key",{act:"key-give",size:"sm",kind:"primary",a:{"data-n":c.name}})}${Btn("Not now",{act:"card-dismiss",size:"sm",kind:"ghost"})}`}),
  takeover:c=>Card({icon:"hand",label:"Your turn in the browser",body:`<p class="t">${c.site}</p><p class="s">${esc(c.why)}</p>`,foot:`${Btn("Take over",{act:"takeover-open",size:"sm",kind:"primary",icon:"hand"})}${Btn("Not now",{act:"card-dismiss",size:"sm",kind:"ghost"})}`}),
  qr:c=>Card({icon:"qr",label:"Scan to sign in",body:`<div style="display:flex;gap:14px;align-items:center;margin-top:4px"><div style="transform:scale(.55);transform-origin:left top;width:83px;height:83px">${qrHTML()}</div><div><p class="t">${c.site}</p><p class="s">${esc(c.why)}</p></div></div>`}),
};
function bodyHTML(m){
  if(m.card)return CARDS[m.card.type](m.card);
  if(m.file)return Attach({icon:"doc",title:m.file.name,sub:`${m.file.kind} · ${m.file.size}`,act:"open-file",id:m.id});
  if(m.pr){const p=PRS.find(x=>x.id===m.pr);return Attach({icon:"pr",title:p.title,sub:`${p.repo} #${p.num} · <span class="df"><b>+${p.add}</b> <em>−${p.del}</em></span>`,act:"open-pr",id:p.id})}
  const q=m.re?findMsg(S.conv,m.re):null;
  return `<div class="bub ${S.pins[S.conv]===m.id?"pinned":""}" id="b-${m.id}">${q?`<div class="quote" data-act="jump" data-to="${q.id}"><b>${q.from==="me"?"You":AG[q.from]?.name||""}</b><span>${esc((q.text||q.file?.name||"").slice(0,90))}</span></div>`:""}<div class="tx">${fmt(m.text)}</div><time>${m.t}</time></div>`;
}
const hovBtn=(icon,a,id,title)=>`<button data-act="${a}" data-id="${id}" title="${title}">${ic(icon,15)}</button>`;
function msgHTML(m){
  if(m.kind==="day")return `<div class="day">${m.text}</div>`;
  if(m.kind==="earlier")return `<button class="earlier" data-act="earlier" data-id="${m.id}">Show ${m.n} earlier messages</button>`;
  if(m.kind==="sys")return `<div class="sys">${ic("info2",14)}<span>${m.text}</span></div>`;
  if(m.kind==="run")return `<div class="sys" data-id="${m.id}">${ic("activity",14)}<span>${AG[m.who].name} took ${m.steps} steps in ${m.secs} s</span><button class="link" data-act="activity" data-id="${m.id}">Show the steps</button></div>`;
  if(m.kind==="approved")return S.steps[m.id]?`<div class="msg" data-id="${m.id}">${Card({icon:"circleok",label:`${m.what} · approved`,right:`${m.t} ${IconBtn("up3",{act:"steps",size:"sm",a:{"data-id":m.id}})}`,body:`<div class="cmd"><span class="p">$ </span>${esc(m.cmd)}</div>`})}</div>`:`<div class="sys" data-id="${m.id}">${ic("circleok",14)}<span>${m.what} · <b>approved</b></span><button class="link" data-act="steps" data-id="${m.id}">Show the card</button></div>`;
  if(m.kind==="handoff")return `<div class="divider"><button data-act="open" data-id="${m.with}">${m.n} messages with ${face(AG[m.with],16)} <b style="font-weight:500;color:var(--ink2)">${AG[m.with].name}</b> ${ic("chev",12)}</button></div>`;
  if(m.kind==="call")return S.steps[m.id]?`<div class="msg" data-id="${m.id}">${Card({icon:"phone",label:`Call with ${AG[m.who].name} · ${m.dur}`,right:IconBtn("up3",{act:"steps",size:"sm",a:{"data-id":m.id}}),body:`<ul style="padding-left:16px;line-height:1.7;font-size:13px">${m.sum.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`})}</div>`:`<div class="sys" data-id="${m.id}">${ic("phone",14)}<span>Call with ${AG[m.who].name} · ${m.dur}</span><button class="link" data-act="steps" data-id="${m.id}">Show the summary</button></div>`;
  if(m.kind==="steps")return stepsHTML(m);
  if(m.kind==="ask")return askHTML(m);
  const mine=m.from==="me",a=AG[m.from],ch=isCh(S.conv);
  const rx=m.rx&&Object.keys(m.rx).length?`<div class="rxs">${Object.entries(m.rx).map(([e,w])=>`<button class="rx ${w.includes("me")?"mine":""}" data-act="rx" data-id="${m.id}" data-e="${e}">${e}${w.length>1?`<em>${w.length}</em>`:""}</button>`).join("")}</div>`:"";
  const hov=m.card?"":`<div class="hov">${hovBtn("smile","react",m.id,"React")}${hovBtn("reply","reply",m.id,"Reply")}${hovBtn("copy","copy",m.id,"Copy")}${hovBtn("more","msgmore",m.id,"More")}</div>`;
  const th=m.thread?.length?`<button class="seeit" data-act="open-thread" data-id="${m.id}">${ic("thread",13)} ${m.thread.length} ${m.thread.length>1?"replies":"reply"}</button>`:"";
  const see=m.see?`<button class="seeit" data-act="activity" data-id="${m.id}">${ic("activity",13)} See what it did</button>`:"";
  const fail=m.failed?`<div class="send-state bad">${ic("circlex",13)} Didn't send <button data-act="retry" data-id="${m.id}">Try again</button></div>`:"";
  return `<div class="msg ${mine?"me":"ag"}" data-id="${m.id}">${ch&&!mine?`<div class="who">${a?a.name:""} <i>${a?.role||""}</i></div>`:""}<div class="mrow">${ch&&!mine?face(a,26):""}${bodyHTML(m)}${hov}</div>${rx}${th}${see}${fail}</div>`;
}
function feedHTML(){
  const id=S.conv,ms=chatOf(id),pid=S.pins[id],pm=pid&&findMsg(id,pid);
  return `<div class="col">${pm?`<div class="pinbar" data-act="jump" data-to="${pm.id}">${ic("pin",15)}<span><b>Pinned</b> · ${esc((pm.text||"").slice(0,100))}</span>${IconBtn("x",{act:"unpin",size:"sm",kind:"plain",title:"Unpin"})}</div>`:""}${ms.map(msgHTML).join("")}<div id="tail"></div></div>`;
}
function rFeed({skeleton=false,scroll=true}={}){
  const f=$("#feed");
  const paint=()=>{f.innerHTML=feedHTML();if(scroll)f.scrollTop=f.scrollHeight;f.style.scrollBehavior="auto"};
  if(skeleton){f.innerHTML=`<div class="col" style="padding-top:14px">${skel(4,{h:15})}</div>`;later(240,paint)}else paint();
}
function rDock(){
  const id=S.conv,c=cur(),dr=S.drafts[id]||"";
  const rp=S.replyTo&&findMsg(id,S.replyTo);
  $("#dock").innerHTML=`${(!isCh(id)&&c.live)?`<div class="live"><span class="sp"></span><span><b>${c.name}</b> is working</span><button class="link" data-act="activity-live">See what it did</button><button class="link" data-act="stop-run" data-id="st2">Stop</button></div>`:""}
  <div class="cwrap"><div id="sugg"></div>
  ${rp?`<div class="replying">${ic("reply",15)}<div class="quote" style="min-width:0"><div><b>Replying to ${rp.from==="me"?"yourself":AG[rp.from].name}</b><span>${esc((rp.text||rp.file?.name||"").slice(0,100))}</span></div></div>${IconBtn("x",{act:"reply-x",size:"sm",kind:"plain",title:"Cancel reply"})}</div>`:""}
  <div class="atts" id="atts"></div>
  <div class="cmp big"><textarea id="ta" rows="1" data-in="compose" placeholder="Message ${isCh(id)?"#"+esc(c.name):esc(c.name)}">${esc(dr)}</textarea>
  <div class="cbar">${IconBtn("plus",{act:"plus",title:"Attach, emoji, format"})}${IconBtn("at",{act:"cmp-at",title:"Mention an agent  @"})}${IconBtn("slash",{act:"cmp-slash",title:"Commands  /"})}
    ${isCh(id)?`<span class="mchip" title="Agents in this channel"><span class="faces">${c.members.slice(0,3).map(m=>face(AG[m],16)).join("")}</span>${c.members.length} agents</span>`:`<button class="mchip" data-act="p-model" title="Model for ${esc(c.name)}">${cliMark(c.cli,12)}${esc(c.model)}${ic("down",12)}</button>`}
    <span class="sp"></span><button class="ibtn ${S.rec?"rec":""}" data-act="mic" title="Dictate" id="micb">${ic("mic",17)}</button><button class="send ${dr.trim()?"on":""}" data-act="send" title="Send  ↵" id="sendb">${ic("up",16,"currentColor",2.4)}</button></div></div></div>`;
  autoGrow();requestAnimationFrame(autoGrow);
}
const ta=()=>$("#ta");
function autoGrow(){const t=ta();if(!t)return;t.style.height="44px";t.style.height=Math.min(180,t.scrollHeight)+"px"}

/* ───────── composer: @ and / popovers ───────── */
let suggItems=[],suggI=0;
function suggest(){
  const t=ta(),box=$("#sugg");if(!t||!box)return;
  const pre=t.value.slice(0,t.selectionStart),m=pre.match(/(^|\s)([@/])(\w*)$/);
  if(!m){box.innerHTML="";suggItems=[];return}
  const q=m[3].toLowerCase();
  if(m[2]==="@"){
    const pool=isCh(S.conv)?CH[S.conv].members:WS[S.ws].convs.filter(x=>!isCh(x));
    suggItems=pool.map(id=>AG[id]).filter(a=>a.name.toLowerCase().startsWith(q)).map(a=>({ins:"@"+a.name+" ",html:`${face(a,24)}<b>${a.name}</b><span class="s">${a.role}</span>`}));
    box.innerHTML=suggItems.length?`<div class="sugg"><div class="lb">Mention</div>${suggItems.map((s,i)=>`<div class="it ${i===suggI?"on":""}" data-act="pick-sugg" data-i="${i}">${s.html}</div>`).join("")}</div>`:"";
  }else{
    suggItems=SLASH.filter(s=>s[0].startsWith(q)).map(s=>({ins:"/"+s[0]+" ",cmd:s[0],html:`<span style="color:var(--ink2)">${ic(s[3],18)}</span><b>/${s[0]}</b><span class="s">${s[1]}</span>`}));
    box.innerHTML=suggItems.length?`<div class="sugg"><div class="lb">Commands</div>${suggItems.map((s,i)=>`<div class="it ${i===suggI?"on":""}" data-act="pick-sugg" data-i="${i}">${s.html}</div>`).join("")}</div>`:"";
  }
  if(suggI>=suggItems.length)suggI=0;
}
function pickSugg(i){
  const t=ta(),s=suggItems[i];if(!s)return;
  const pre=t.value.slice(0,t.selectionStart),post=t.value.slice(t.selectionStart);
  const np=pre.replace(/([@/])\w*$/,"")+s.ins;t.value=np+post;t.focus();t.selectionStart=t.selectionEnd=np.length;
  S.drafts[S.conv]=t.value;suggItems=[];$("#sugg").innerHTML="";syncSend();
  if(s.cmd&&["model","routine","plan","clear"].includes(s.cmd)){t.value=t.value.replace(/\/\w+\s$/,"");S.drafts[S.conv]=t.value;syncSend();runSlash(s.cmd)}
}
function runSlash(c){
  const a=cur();
  if(c==="model"&&!isCh(S.conv))ACT["pick-model"]($("#top .namepill"),{agent:S.conv});
  else if(c==="routine")routineEditor(null,"");
  else if(c==="plan"&&!isCh(S.conv)){a.perm="plan";toast(`${a.name} is in Plan mode: reads and plans only`,{icon:"tasks"});rPanel()}
  else if(c==="clear")confirmBox("Clear this chat?","The page goes blank. The agent keeps its memory.","Clear",()=>{CHATS[S.conv]=[{id:nid("d"),kind:"day",text:"Today"}];rFeed();toast("Chat cleared",{icon:"trash"})});
}
function syncSend(){const b=$("#sendb");if(b)b.classList.toggle("on",!!(ta().value.trim()||$("#atts").children.length));autoGrow()}
Object.assign(INPUT,{compose:(v)=>{S.drafts[S.conv]=v;syncSend();suggest()}});

/* ───────── sending and replying ───────── */
function pushMsg(conv,m,{unread=true}={}){
  chatOf(conv).push(m);
  if(conv===S.conv){const t=$("#tail");if(t)t.insertAdjacentHTML("beforebegin",msgHTML(m));scrollDown()}
  else if(unread&&m.from!=="me"){S.unread.add(conv);rSide()}
  if(!m.from)return;
  const c=isCh(conv)?CH[conv]:AG[conv];c.line=(isCh(conv)&&m.from!=="me"?AG[m.from].name+": ":m.from==="me"?"You: ":"")+(m.text||"").replace(/\*\*/g,"").slice(0,70);c.when="now";rSide();
}
const scrollDown=()=>{const f=$("#feed");f.style.scrollBehavior="smooth";f.scrollTop=f.scrollHeight};
function typingOn(a){const t=$("#tail");if(S.conv&&t&&!$("#typing"))t.insertAdjacentHTML("beforebegin",`<div class="msg" id="typing"><div class="mrow">${face(a,28)}<div class="typing"><i></i><i></i><i></i></div></div></div>`);scrollDown()}
const typingOff=()=>$("#typing")?.remove();
const REPLIES=[[/price|pricing|plan/i,"Short version: $290 a year wins on margin and doesn't move churn. I'd show it and test $278 after launch."],[/thread|post|publish|launch/i,"Understood. I'll keep it staged and ping you the moment it's ready for your OK."],[/thanks|thank|great|good|ok\b/i,"Anytime."],[/bug|fix|error|fail/i,"Looking into it now. I'll tell you what I find before I change anything."]];
function replyFor(a,text){const hit=REPLIES.find(r=>r[0].test(text));return hit?hit[1]:`Got it. I'll start on that and post here when there's something to see.`}
function agentReply(conv,a,text,{mention}={}){
  typingOn(a);
  later(900+Math.random()*700,()=>{
    typingOff();
    if(/test|build|run|deploy/i.test(text)&&!isCh(conv)){
      const st={id:nid("st"),kind:"steps",title:"Working on it",t:"now",live:1,items:[["Read the request","d"],["Run the checks","run"],["Write the summary",""]]};
      pushMsg(conv,st);tickSteps(conv,st);
    }else pushMsg(conv,mk(a.id,(mention?`@${mention} `:"")+replyFor(a,text),clock()));
  });
}
function respond(conv,text){
  if(S.pref.pause)return toast("All agents are paused. Your message will wait in the queue.",{icon:"pause"});
  if(!isCh(conv)){const a=AG[conv];if(a.asleep){a.asleep=0;rSide();toast(`${a.name} woke up`,{icon:"bolt",ms:1500})}later(350,()=>agentReply(conv,a,text));return}
  const c=CH[conv],named=[...text.matchAll(/@(\w+)/g)].map(m=>m[1].toLowerCase()).filter(n=>c.members.includes(n));
  const first=AG[named[0]||c.lead];const second=AG[c.members.find(x=>x!==first.id)||first.id];
  later(350,()=>agentReply(conv,first,text));
  if(second!==first)later(2700,()=>{
    pushMsg(conv,{id:nid("s"),kind:"sys",text:`Round 1 of ${c.rounds} · <b>${first.name}</b>, <b>${second.name}</b>`});
    agentReply(conv,second,text,{mention:first.name});
  });
}
function tickSteps(conv,st){
  const iv=setInterval(()=>{
    if(!st.live)return clearInterval(iv);
    const i=st.items.findIndex(x=>x[1]==="run");if(i<0)return clearInterval(iv);
    st.items[i][1]="d";if(st.items[i+1])st.items[i+1][1]="run";else{st.live=0;st.t="now";clearInterval(iv);if(conv===S.conv)finishRun(conv,st)}
    if(conv===S.conv){const el=$(`[data-id="${st.id}"]`);if(el)el.outerHTML=stepsHTML(st);if(conv!=="x")rDockLive()}
  },1900);
}
function finishRun(conv,st){if(conv.startsWith("#"))return;pushMsg(conv,mk(conv,"Done. Everything passed. I saved the summary as a file.","now",{file:{name:"run-summary.md",size:"1.1 KB",kind:"Document",body:"# Run summary\n\n- 128 tests passed\n- 0 failed\n- backoff patched in webhook.rs"},see:1}))}
function rDockLive(){if(!isCh(S.conv)){const c=AG[S.conv];const has=chatOf(S.conv).some(m=>m.live);c.live=has?1:0;const l=$(".live");if(!has&&l)l.remove()}}
function send(){
  const t=ta();let text=t.value.trim();const files=$$(".att",$("#atts")).map(c=>c.dataset.name);
  if(!text&&!files.length)return;
  if(text.startsWith("/")){const c=text.slice(1).split(" ")[0];if(["model","routine","plan","clear"].includes(c)){t.value="";S.drafts[S.conv]="";syncSend();return runSlash(c)}}
  const conv=S.conv;
  pushMsg(conv,mk("me",text||"",clock(),{re:S.replyTo,...(files.length?{text:text+(text?"\n":"")+files.map(f=>"📎 "+f).join("\n")}:{})}));
  t.value="";S.drafts[conv]="";S.replyTo=null;rDock();respond(conv,text);ta().focus();
}
function cancelReply(){S.replyTo=null;rDock()}

/* ───────── message actions ───────── */
function msgCtx(x,y,id){
  const m=findMsg(S.conv,id);if(!m)return;
  const head={raw:emojiRow()};
  const items=[head,["reply","Reply",()=>startReply(id)],["thread","Reply in thread",()=>openThread(id)],["volume","Read aloud",()=>readAloud(id)],["pin",S.pins[S.conv]===id?"Unpin":"Pin",()=>pinMsg(id)],["pdf","Make PDF",()=>makePdf(id)],["copy","Copy",()=>copyMsg(id)],["hash","Copy message ID",()=>{navigator.clipboard?.writeText(id).catch(()=>{});toast(`Copied ${id}`,{icon:"hash",ms:1600})}]];
  const p=menu(atPoint(x,y),items);
  $$(".emojis button",p).forEach(b=>b.onclick=e=>{e.stopPropagation();if(b.dataset.e==="+")return moreEmoji(p,id);closePop();addRx(id,b.dataset.e)});
}
function moreEmoji(p,id){p.innerHTML=`<div class="emgrid">${EMOJI_ALL.map(e=>`<button>${e}</button>`).join("")}</div>`;place(p);$$("button",p).forEach(b=>b.onclick=e=>{e.stopPropagation();closePop();addRx(id,b.textContent)})}
function addRx(id,e){
  const m=findMsg(S.conv,id);m.rx=m.rx||{};const w=m.rx[e]=m.rx[e]||[];
  if(w.includes("me")){w.splice(w.indexOf("me"),1);if(!w.length)delete m.rx[e]}else w.push("me");
  refreshMsg(m);
}
const refreshMsg=m=>{const el=$(`[data-id="${m.id}"]`);if(el)el.outerHTML=msgHTML(m)};
function startReply(id){S.replyTo=id;rDock();ta().focus()}
function copyMsg(id){const m=findMsg(S.conv,id);navigator.clipboard?.writeText(m.text||m.file?.name||"").catch(()=>{});toast("Copied",{icon:"copy",ms:1400})}
function readAloud(id){const m=findMsg(S.conv,id);toast(`Reading aloud · ${(m.text||"").slice(0,32)}…`,{icon:"volume",action:"Stop",onAction:()=>toast("Stopped",{ms:900})})}
function pinMsg(id){const was=S.pins[S.conv]===id;if(was)delete S.pins[S.conv];else S.pins[S.conv]=id;rFeed({scroll:false});toast(was?"Unpinned":"Pinned to the top of this chat",{icon:"pin"})}
function makePdf(id){const t=toast("Making a PDF…",{icon:"pdf",ms:1200});later(1250,()=>toast("chat-excerpt.pdf saved to Downloads",{icon:"pdf",action:"Show",onAction:()=>toast("Revealed in Finder",{ms:1200})}))}
function openThread(id){S.panel={k:"thread",id};showPanel()}
function msgText(id){return findMsg(S.conv,id)?.text||""}

Object.assign(ACT,{
  send:()=>send(),
  steps:el=>{const id=el.dataset.id;S.steps[id]=!S.steps[id];refreshMsg(findMsg(S.conv,id))},
  "stop-run":el=>{const m=chatOf(S.conv).find(x=>x.kind==="steps"&&x.live);if(m){m.live=0;m.stopped=1;AG[S.conv]&&(AG[S.conv].live=0);refreshMsg(m);rDock();toast("Stopped. Nothing else will run.",{icon:"stop"})}},
  "resume-run":el=>{const m=findMsg(S.conv,el.dataset.id);m.stopped=0;m.live=1;const i=m.items.findIndex(x=>x[1]==="");if(i>=0)m.items[i][1]="run";refreshMsg(m);tickSteps(S.conv,m);toast("Resumed",{icon:"play",ms:1500})},
  react:el=>{const id=el.dataset.id;const p=pop(el,`<div class="emojis" style="border:0;margin:0;padding:2px">${EMOJI.map(e=>`<button data-e="${e}">${e}</button>`).join("")}<button data-e="+">${ic("plus",20)}</button></div>`,{align:"center",place:"above"});$$("button",p).forEach(b=>b.onclick=e=>{e.stopPropagation();if(b.dataset.e==="+")return moreEmoji(p,id);closePop();addRx(id,b.dataset.e)})},
  rx:el=>addRx(el.dataset.id,el.dataset.e),
  reply:el=>startReply(el.dataset.id),
  "reply-x":()=>cancelReply(),
  copy:el=>copyMsg(el.dataset.id),
  msgmore:el=>{const id=el.dataset.id,m=findMsg(S.conv,id);menu(el,[["brain","Remember this",()=>{const a=isCh(S.conv)?AG[m.from]||AG[CH[S.conv].lead]:AG[S.conv];(MEMORY[a.id]=MEMORY[a.id]||[]).unshift((m.text||"").slice(0,80));a.mem++;rPanel();toast(`${a.name} saved it to memory`,{icon:"brain",action:"Open",onAction:()=>{S.panel={k:"profile",tab:"details"};showPanel()}})}],["clock","Make it a routine",()=>routineEditor(null,m.text||"")],["link","Copy link",()=>toast("Link copied",{icon:"link",ms:1500})],"hr",["trash","Delete message",()=>{const arr=chatOf(S.conv),i=arr.indexOf(m);arr.splice(i,1);rFeed({scroll:false});toast("Message deleted",{action:"Undo",onAction:()=>{arr.splice(i,0,m);rFeed({scroll:false})}})},{red:true}]],{align:"right"})},
  jump:el=>{const b=document.getElementById("b-"+el.dataset.to)||$(`[data-id="${el.dataset.to}"]`);if(!b)return toast("That message is gone",{ms:1500});b.scrollIntoView({block:"center",behavior:"smooth"});b.classList.add("flash");later(1200,()=>b.classList.remove("flash"))},
  unpin:()=>{delete S.pins[S.conv];rFeed({scroll:false})},
  "open-thread":el=>openThread(el.dataset.id),
  "pick-sugg":el=>pickSugg(+el.dataset.i),
  plus:el=>menu(el,[["clip","Attach a file",()=>pickFile(f=>{$("#atts").insertAdjacentHTML("beforeend",`<span class="att" data-name="${esc(f.name)}">${ic("clip",13)}${esc(f.name)}<button data-act="att-x">${ic("x",12)}</button></span>`);syncSend()})],["smile","Emoji",()=>setTimeout(()=>ACT.emoji($(".cmp .ibtn")),0)],["at","Mention an agent",()=>{const t=ta();t.value+=(t.value&&!/\s$/.test(t.value)?" ":"")+"@";t.focus();suggest()}],["slash","Commands",()=>{const t=ta();t.value+=(t.value&&!/\s$/.test(t.value)?" ":"")+"/";t.focus();suggest()}],["bold","Format",null,{sub:[["bold","Bold",()=>wrapSel("**")],["ital","Italic",()=>wrapSel("*")],["code","Code",()=>wrapSel("`")],["list","Bulleted list",()=>wrapSel("- ","")]]}]],{place:"above"}),
  emoji:el=>{const p=pop(el,`<div class="emgrid">${EMOJI_ALL.map(e=>`<button>${e}</button>`).join("")}</div>`,{place:"above"});$$("button",p).forEach(b=>b.onclick=e=>{e.stopPropagation();closePop();const t=ta();t.value+=b.textContent;S.drafts[S.conv]=t.value;t.focus();syncSend()})},
  "att-x":el=>{el.closest(".att").remove();syncSend()},
  mic:el=>{
    S.rec=!S.rec;if(S.rec){$("#micb").classList.add("rec");toast("Listening… tap the mic again to stop",{icon:"mic",ms:1800})}
    else{$("#micb").classList.remove("rec");const t=ta();t.value+=(t.value?" ":"")+"Can you move the thread to 10:30?";S.drafts[S.conv]=t.value;syncSend();toast("Transcribed",{icon:"check",ms:1300})}
  },
  "activity-live":()=>{S.panel={k:"activity",id:"live"};showPanel()},
  activity:el=>{S.panel={k:"activity",id:el.dataset.id};showPanel()},
  "open-file":el=>{S.panel={k:"file",id:el.dataset.id};showPanel()},
  "open-pr":el=>{S.panel={k:"pr",id:el.dataset.id};showPanel()},
  resolve:el=>resolveItem(el.dataset.id,el.dataset.o),
});
function wrapSel(a,b=a){const t=ta(),s=t.selectionStart,e=t.selectionEnd,v=t.value;t.value=v.slice(0,s)+a+v.slice(s,e)+b+v.slice(e);t.focus();t.selectionStart=s+a.length;t.selectionEnd=e+a.length;S.drafts[S.conv]=t.value;syncSend()}
/* an approval or question can be answered from the chat card, the inbox popover or the palette, and all three land here */
function resolveItem(id,opt){
  const it=S.inbox.find(i=>i.id===id);if(!it||it.state)return;
  it.state=opt;
  if(it.kind==="mention"){S.conv=it.conv;openConv(it.conv);return}
  const conv=it.conv,a=AG[it.agent];
  if(conv===S.conv){rFeed({scroll:false})}
  const yes=it.kind==="question"||opt==="Approve";
  if(conv===S.conv)later(600,()=>{pushMsg(conv,mk(a.id,yes?(it.kind==="question"?`Got it, ${opt.replace(/ \/.*/,"")}. I'll update everything that mentions the price.`:"Thanks. Going ahead now."):"Understood. I won't do it.",clock()))});
  else {pushMsg(conv,mk(a.id,yes?"Thanks. Going ahead now.":"Understood. I won't do it.",clock()))}
  a.ask=0;rSide();rBadge();toast(it.kind==="question"?`Answered · ${opt}`:opt==="Approve"?"Approved":"Denied",{icon:yes?"circleok":"circlex",action:"Undo",onAction:()=>{it.state=null;a.ask=1;if(conv===S.conv)rFeed({scroll:false});rBadge();if(S.ibOpen)openInbox()}});
  if(S.ibOpen)openInbox();
}

/* ───────── the new cards' actions ───────── */
const cardMsg=el=>findMsg(S.conv,el.closest(".msg")?.dataset.id);
Object.assign(ACT,{
  earlier:el=>{const arr=chatOf(S.conv),i=arr.findIndex(x=>x.id===el.dataset.id);arr.splice(i,1,{id:nid("d"),kind:"day",text:"Yesterday"},mk(S.conv,"Weekly numbers are in: 41 new trials, 9 paid.","18:02"),mk("me","Nice. Keep the same report every Monday.","18:10"));rFeed({scroll:false});toast("12 earlier messages loaded",{icon:"history",ms:1300})},
  "always-allow":el=>{const it=S.inbox.find(i=>i.id===el.dataset.id);resolveItem(it.id,"Approve");toast(`${AG[it.agent].name} won't ask for this again`,{icon:"shield",action:"Undo",onAction:()=>toast("It will ask again next time",{ms:1300})})},
  "page-open":()=>toast("Opened pages.hz/hyze/pro in your browser",{icon:"ext",ms:1600}),
  "page-versions":()=>openPageVersions(),
  "draft-edit":el=>{const m=cardMsg(el);const t=ta();t.value=`Change the draft: `;S.drafts[S.conv]=t.value;t.focus();syncSend();toast("Say what to change. Mila rewrites it.",{icon:"pen",ms:1600})},
  "copy-text":()=>toast("Copied",{icon:"copy",ms:1200}),
  "voice-play":el=>{const v=el.closest(".voice"),bars=$$(".wv i",v);el.innerHTML=ic("pause",12);let k=0;const iv=setInterval(()=>{if(k>=bars.length||!v.isConnected){clearInterval(iv);if(v.isConnected)el.innerHTML=ic("play",12);bars.forEach(b=>b.classList.remove("p"));return}bars[k++].classList.add("p")},90)},
  "key-give":el=>{const f=$("[data-in=key-paste]",el.closest(".card"));if(!f.value.trim())return toast("Paste the key first",{icon:"key",ms:1400});const m=cardMsg(el),n=el.dataset.n;(S.keys=S.keys||[]).push([n,"····"+f.value.slice(-4)]);chatOf(S.conv).splice(chatOf(S.conv).indexOf(m),1,{id:nid("s"),kind:"sys",text:`Key saved · <b>${n}</b>`});rFeed({scroll:false});later(700,()=>pushMsg(S.conv,mk(S.conv,"Got it. Creating the second pool now.",clock())))},
  "card-dismiss":el=>{const m=cardMsg(el);const arr=chatOf(S.conv),i=arr.indexOf(m);arr.splice(i,1);rFeed({scroll:false});toast("Dismissed",{action:"Undo",onAction:()=>{arr.splice(i,0,m);rFeed({scroll:false})}})},
  "takeover-open":()=>{S.panel={k:"profile",tab:"computer"};AG[S.conv].asleep=0;AG[S.conv].awake=1;(S.ctrl=S.ctrl||{})[S.conv]=1;showPanel();toast("You're driving the browser. Give it back when you're done.",{icon:"hand"})},
  retry:el=>{const m=findMsg(S.conv,el.dataset.id);m.failed=0;refreshMsg(m);toast("Sent",{icon:"check",ms:1100})},
  call:()=>startCall(S.conv),
});
INPUT["key-paste"]=()=>{};

Object.assign(ACT,{
  "cmp-at":()=>{const t=ta();t.value+=(t.value&&!/\s$/.test(t.value)?" ":"")+"@";t.focus();suggest()},
  "cmp-slash":()=>{const t=ta();t.value+=(t.value&&!/\s$/.test(t.value)?" ":"")+"/";t.focus();suggest()},
});
