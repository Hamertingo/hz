/* ───────── profile ───────── */
const NOTES=[
  {t:"Pricing — plano Pro",tag:"Decision",w:"2 min ago",s:"R$ 89 com teto de 100h; excedente a R$ 0,90/h.",used:4,body:`<p>Decidido com o Gabriel em 23/10.</p><ul><li>Preço: <b>R$ 89/mês</b>, 100 horas de VM incluídas.</li><li>Excedente: <b>R$ 0,90</b> por hora, cobrado por minuto.</li><li>Margem esperada: 41% com a mediana de uso atual (31h).</li></ul><p>Revisar quando o pool novo baixar o custo pra R$ 0,61/h.</p>`},
  {t:"Como o Gabriel decide",tag:"About you",w:"yesterday",s:"Quer números antes de opinião e uma recomendação no fim.",used:23,body:`<ul><li>Quer <b>números antes de opinião</b>.</li><li>Prefere ouvir quando está errado, sem rodeio.</li><li>Decide rápido quando a recomendação vem com o risco escrito.</li><li>Escreve em português; código e commits em inglês.</li></ul>`},
  {t:"Custos de infra — outubro",tag:"Project",w:"3 days ago",s:"R$ 0,74 por VM-hora; storage é 18% do custo.",used:6,body:`<p>Custo por VM-hora: <b>R$ 0,74</b>.</p><ul><li>Firecracker: R$ 0,52</li><li>Storage: R$ 0,13</li><li>Rede: R$ 0,09</li></ul>`},
  {t:"Concorrentes",tag:"Project",w:"Oct 23",s:"E2B por segundo, Daytona fixo US$ 20, Modal por GPU.",used:3,body:`<ul><li><b>E2B</b> — cobra por segundo de sandbox.</li><li><b>Daytona</b> — plano fixo de US$ 20.</li><li><b>Modal</b> — por segundo de GPU.</li></ul><p>Levantado pelo Hugo.</p>`},
  {t:"Tom de voz da Hyze",tag:"About you",w:"Oct 22",s:"Direto, técnico, sem hype. Nada de emoji em produto.",used:11,body:`<p>Direto, técnico, sem hype. Nada de emoji em produto.</p>`},
];
const TAGS={all:null,you:"About you",project:"Project",decision:"Decision"};
let INSTR=`<h2>Atlas — sócio estratégico</h2>
<p>Você é meu sócio estratégico e técnico na Hyze Cloud. Pense comigo como um cofundador experiente.</p>
<h3>## Como pensar</h3>
<ul><li>Números antes de opinião. Se não tiver o número, diga qual falta.</li><li>Diga quando eu estiver errado, sem rodeio.</li><li>Considere custo de infra, margem e tempo do time.</li></ul>
<h3>## Como responder</h3>
<ul><li>Português, direto, frases curtas.</li><li>Termine sempre com <b>uma</b> recomendação e o risco dela.</li><li>Salve decisões na memória.</li></ul>
<h3>## Não faça</h3>
<ul><li>Não publique nada nem faça merge sem me perguntar.</li></ul>`;
let IVER=7;
const VERS=[["V7","Added “Não faça”","2 min ago"],["V6","Shorter answers","yesterday"],["V5","Margin before growth","Oct 23"],["V1","First version","Oct 22"]];
const FOLDERS=[["~/Projects/hyze-cloud","read · write"],["~/Projects/hyze-cloud/notes","read · write"],["~/Documents/financeiro","read only"]];
const ALWAYS=[["Merging or pushing to main",true],["Deploying anything",true],["Deleting files",true],["Spending over US$ 2 on one task",true],["Posting in public or sending email",true],["Installing packages",false]];
let BUDGET=50;
function profileHead(a){
  const days=Array.from({length:14},(_,i)=>3+Math.round(rng(a.id+i)()*11));
  return `<div class="hero"><canvas id="banner"></canvas><div class="fade"></div>
      <button class="btn back" data-act="backchat">${ic("back",14)} Chat</button></div>
    <div class="pbody">
      <div class="gwrap" data-act="editlook" style="cursor:pointer" title="Edit look">${tileHTML(a,120)}</div>
      <div class="ptitle"><div><h1>${a.name}</h1>
        <div class="pmeta"><span>${a.role}</span><i class="d"></i>${cliMark(a.cli,13)}<span>${a.cli}</span><i class="d"></i><span class="m lnk" data-act="model">${a.model}</span><i class="d"></i><span class="m">~/${a.dir}</span><i class="d"></i>
          ${a.live?`<span class="state" style="color:${mix(a.color,"#fff",.4)};background:${rgba(a.color,.16)}">Working</span>`:`<span class="state" style="color:var(--ink3);background:var(--s3)">Idle</span>`}</div></div>
        <div class="acts"><button class="btn" data-act="editlook">${ic("smile",13)} Edit look</button><button class="btn solid" data-act="backchat">Message ${a.name}</button></div></div>
      <div class="nums">
        <div data-act="tab" data-tab="activity" style="cursor:pointer"><div class="v">412<span class="bars">${days.map(h=>`<i style="height:${h}px"></i>`).join("")}</span></div><div class="k">Messages · 14 days</div></div>
        <div data-act="tab" data-tab="activity" style="cursor:pointer"><div class="v">31 <small>tasks</small></div><div class="k">Finished this month</div></div>
        <div data-act="tab" data-tab="memory" style="cursor:pointer"><div class="v">${NOTES.length} <small>notes</small></div><div class="k">In memory</div></div>
        <div data-act="tab" data-tab="activity" style="cursor:pointer"><div class="v">18<small>h</small> 40<small>m</small></div><div class="k">Of work</div></div>
      </div>
      <div class="tabs">${[["overview","Overview"],["instructions","Instructions"],["memory","Memory",NOTES.length],["access","Access"],["activity","Activity"]].map(([k,n,c])=>`<a class="${S.ptab===k?"on":""}" data-act="tab" data-tab="${k}">${n}${c?`<em>${c}</em>`:""}</a>`).join("")}</div>`;
}
function renderProfile(){
  const a=AG[S.agent];
  const body={overview:pOverview,instructions:pInstructions,memory:pMemory,access:pAccess,activity:pActivity}[S.ptab](a);
  const top=$("#prof")?.scrollTop||0;
  main.innerHTML=`<div class="prof" id="prof" style="--tint:${a.color}">${profileHead(a)}${body}</div></div>`;
  prof.scrollTop=top;
  dither(banner,a.color,a.id+":banner",{cols:200,rows:48});
  bindProfile(a);
}
function bindProfile(a){
  const db=$(".doc .db");
  if(db){let t;db.oninput=()=>{const sv=$(".doc .sv");sv.innerHTML=`<i style="background:var(--amber)"></i>Saving…`;clearTimeout(t);t=setTimeout(()=>{INSTR=db.innerHTML;IVER++;VERS.unshift([`V${IVER}`,"Edited by you","just now"]);sv.innerHTML=`<i></i>Saved · v${IVER}`;const v=$(".vers");if(v)v.innerHTML=versHTML()},900)}}
  const ms=$("[data-mq]");if(ms){ms.oninput=()=>{S.mq=ms.value;const l=$(".mem .list");l.innerHTML=noteList();};}
}
function pOverview(a){
  const w=WORKSPACES[S.ws];const mates=w.agents.filter(k=>k!==a.id).map(k=>AG[k]);
  const lvl=PERM[a.perm][2];
  return `<div class="ov">
    <div>
      <div class="blk"><h3>Right now</h3>
        <div class="nowcard">${tileHTML(a,30)}<div style="min-width:0"><div class="q">${a.live?`<span class="shimmer">${a.line}</span>`:`Last said <b>“${a.line}”</b>`}</div><div class="w">${a.live?"Started 14 seconds ago · asked by "+ME.name:`${a.when} · in chat with ${ME.name}`}</div></div><button class="btn sm" data-act="backchat" style="margin-left:auto">Open chat</button></div></div>
      <div class="blk"><h3>Recent work<span class="ed" data-act="tab" data-tab="activity">All activity</span></h3>
        <div class="tl">
          <div class="e hi" data-act="file" data-f="pr212" style="cursor:pointer"><div class="h">Wrote the Pro pricing page<span class="t">21:14</span></div><div class="x">Opened PR <code>#212</code> · asked Mila to review the copy</div></div>
          <div class="e" data-act="file" data-f="pricing" style="cursor:pointer"><div class="h">Pricing analysis for the Pro plan<span class="t">21:04</span></div><div class="x">Saved <code>notes/pricing-pro.md</code> · 6 steps · 41s</div></div>
          <div class="e" data-act="xchg" style="cursor:pointer"><div class="h">Asked Hugo for competitor prices<span class="t">21:03</span></div><div class="x">2 messages · Hugo answered in 24s</div></div>
          <div class="e" data-act="note" data-n="1" style="cursor:pointer"><div class="h">Remembered how you decide on prices<span class="t">yesterday</span></div><div class="x">New note <code>como-o-gabriel-decide.md</code></div></div>
          <div class="e" data-act="go" data-v="routines" style="padding-bottom:0;cursor:pointer"><div class="h">Weekly numbers routine<span class="t">Mon 09:00</span></div><div class="x">Posted the report in <code>#general</code></div></div>
        </div></div>
      <div class="blk"><h3>How ${a.name} works<span class="ed" data-act="tab" data-tab="instructions">Edit instructions</span></h3>
        <div style="font-size:13.5px;line-height:1.7;color:var(--ink2);border-left:2px solid var(--tint);padding-left:14px">Você é meu sócio estratégico na Hyze Cloud. Pense comigo como cofundador: números antes de opinião, diga quando eu estiver errado, e sempre termine com uma recomendação. Fale em português, direto.</div></div>
    </div>
    <div>
      <div class="blk"><h3>Sheet</h3>
        <div class="sheet">
          <div class="r"><span>Runs on</span><b>${cliMark(a.cli,13)} ${a.cli}</b><span class="lk" data-act="lockinfo">${ic("lock",11)}</span></div>
          <div class="r" data-act="model" style="cursor:pointer"><span>Model</span><b>${a.model}</b><span class="lk">${ic("caret",10)}</span></div>
          <div class="r" data-act="effort" style="cursor:pointer"><span>Effort</span><b>${a.effort}</b><span class="lk">${ic("caret",10)}</span></div>
          <div class="r" data-act="tab" data-tab="access" style="cursor:pointer"><span>Can do</span><b><span class="meter">${[0,1,2,3].map(i=>`<i class="${i<=lvl?"on":""}"></i>`).join("")}</span>${PERM[a.perm][0]}</b><span class="lk">${ic("chev",10)}</span></div>
          <div class="r"><span>Folder</span><b class="mono" style="font-size:12px">~/${a.dir}</b><span class="lk" data-act="lockinfo">${ic("lock",11)}</span></div>
          <div class="r" data-act="movews" style="cursor:pointer"><span>Workspace</span><b>${logoHTML(w,16)} ${w.name}</b><span class="lk">${ic("caret",10)}</span></div>
          <div class="r"><span>Made</span><b>Oct 22 by ${ME.name}</b></div>
        </div></div>
      <div class="blk"><h3>Knows<span class="ed" data-act="tab" data-tab="memory">Open memory</span></h3>
        <div class="nlist">${NOTES.slice(0,4).map((n,i)=>`<div class="n" data-act="note" data-n="${i}" style="cursor:pointer">${ic("doc",13)}${n.t}<span class="w">${n.w}</span></div>`).join("")}</div></div>
      <div class="blk"><h3>Works with</h3>
        <div class="mates">${mates.map(m=>`<div class="mate" data-act="openagentp" data-id="${m.id}">${tileHTML(m,26)}<span>${m.name}</span><em>${m.role}</em></div>`).join("")}</div></div>
    </div></div>`;
}
const versHTML=()=>VERS.map(([v,t,w])=>`<div class="v" data-act="version" data-v="${v}" style="cursor:pointer"><span class="b">${v}</span>${t}<span class="t">${w}</span></div>`).join("");
function pInstructions(a){
  return `<div class="inst">
    <div class="doc">
      <div class="dh">${ic("doc",13)} instructions.md<span class="sv"><i></i>Saved · v${IVER}</span></div>
      <div class="db" contenteditable="true" spellcheck="false">${INSTR}</div>
      <div class="snips">${["Answer in Portuguese","End with a recommendation","Ask before spending","Cite sources","Keep it short"].map(t=>`<button data-act="snip">+ ${t}</button>`).join("")}</div>
    </div>
    <div>
      <div class="blk"><h3>What ${a.name} reads first</h3>
        <div class="layers">
          <div class="ly" data-act="settingsp" data-p="workspace" style="cursor:pointer"><div class="h"><span class="n">1</span>${logoHTML(WORKSPACES[S.ws],16)} Workspace context<span class="tk">112 tok</span></div><div class="p">${WORKSPACES[S.ws].ctx.slice(0,70)||"No context yet"}…</div></div>
          <div class="ly" data-act="settingsp" data-p="profile" style="cursor:pointer"><div class="h"><span class="n">2</span>${meTile(16)} About you<span class="tk">24 tok</span></div><div class="p">${ME.calls}. Português.</div></div>
          <div class="ly mine"><div class="h"><span class="n">3</span>${tileHTML(a,16)} These instructions<span class="tk">412 tok</span></div><div class="p">The part you are editing.</div></div>
          <div class="ly" data-act="tab" data-tab="memory" style="cursor:pointer"><div class="h"><span class="n">4</span>${ic("doc",13)} Memory index<span class="tk">260 tok</span></div><div class="p">${NOTES.length} notes. Each is read when it matters.</div></div>
          <div class="ly"><div class="h"><span class="n">5</span>${ic("people",13)} Team<span class="tk">48 tok</span></div><div class="p">${wsAgents().filter(x=>x.id!==a.id).map(x=>x.name).join(", ")} — and how to ask them.</div></div>
        </div>
        <div class="budget"><i style="width:13%;background:var(--ink3)"></i><i style="width:3%;background:var(--ink3)"></i><i style="width:48%;background:var(--tint)"></i><i style="width:30%;background:var(--ink4)"></i><i style="width:6%;background:var(--ink4)"></i></div>
        <div style="font-size:12px;color:var(--ink4);margin-top:8px">856 tokens · kept in cache · 0.4% of the window</div></div>
      <div class="blk"><h3>History</h3><div class="vers">${versHTML()}</div></div>
    </div></div>`;
}
function noteList(){
  const tag=TAGS[S.mtag];const q=S.mq.toLowerCase();
  const list=NOTES.map((x,i)=>[x,i]).filter(([x])=>(!tag||x.tag===tag)&&(!q||(x.t+x.s).toLowerCase().includes(q)));
  return list.map(([x,i])=>`<div class="ni ${i===S.note?"on":""}" data-act="noteopen" data-n="${i}"><div class="t">${x.t}</div><div class="s">${x.s}</div><div class="m"><span class="ntag">${x.tag}</span>${x.w} · used ${x.used}×</div></div>`).join("")||`<div style="padding:20px;color:var(--ink3)">Nothing matches “${esc(S.mq)}”.</div>`;
}
function pMemory(a){
  const n=NOTES[S.note]||NOTES[0];const cnt=t=>NOTES.filter(x=>!TAGS[t]||x.tag===TAGS[t]).length;
  return `<div class="memtop">
      <div class="search">${ic("search",13)}<input data-mq placeholder="Search what ${a.name} knows" value="${esc(S.mq)}" style="flex:1"></div>
      <div class="subtabs">${[["all","All"],["you","About you"],["project","Projects"],["decision","Decisions"]].map(([k,l])=>`<a class="${S.mtag===k?"on":""}" data-act="mtag" data-v="${k}">${l} <em>${cnt(k)}</em></a>`).join("")}</div>
      <div class="dream">${ic("moon",13)} <span data-tidied>Tidied at 03:12</span><button class="btn sm" data-act="tidy">Tidy now</button><button class="btn sm" data-act="newnote">${ic("plus",11)} Note</button></div>
    </div>
    <div class="mem">
      <div class="list">${noteList()}</div>
      ${n?`<div class="view"><span class="ntag">${n.tag}</span><h2 style="margin-top:10px" data-nt>${n.t}</h2>
        <div class="vm">Written by ${a.name} · ${n.w} · used in ${n.used} answers</div>
        <div class="vb" data-nb>${n.body}</div>
        <div class="va"><button class="btn sm" data-act="noteedit">${ic("pen",11)} Edit</button><button class="btn sm bad" data-act="noteforget">${ic("trash",11)} Forget</button></div>
        <div class="prov"><div>${ic("chev",10)} Learned in chat on Oct 23, from “Fechado. Escreve a página de preço com isso.”</div><div>${ic("chev",10)} Last read in the answer at 21:14</div></div>
      </div>`:`<div class="view" style="color:var(--ink3)">${a.name} remembers nothing yet.</div>`}
    </div>`;
}
function pAccess(a){
  const tools=[["Team","Ask and message teammates",true],["Memory","Read and write its notes",true],["Browser","Open pages and fill forms",true],["GitHub","PRs, issues, comments",true],["Linear","Read and update issues",false],["Google Drive","Read and save documents",false]];
  const pct=Math.min(1,12.4/BUDGET);
  return `<div class="acc">
    <div class="wide blk"><h3>How far ${a.name} goes on its own</h3>
      <div class="lad">${ORDER.map(k=>{const[n,d,l]=PERM[k];return`<div class="${k===a.perm?"on":""}" data-act="perm-set" data-v="${k}"><b><span class="meter">${[0,1,2,3].map(i=>`<i class="${i<=l?"on":""}"></i>`).join("")}</span>${n}</b><span>${d}</span></div>`}).join("")}</div></div>
    <div class="blk"><h3>Always asks you before<span class="ed" data-act="addrule">${ic("plus",11)} Add</span></h3>
      <div class="lst">${ALWAYS.map(([t,on])=>`<div class="r">${t}<span class="rt"><span class="tog ${on?"on":""}"></span></span></div>`).join("")}</div></div>
    <div class="blk"><h3>Folders it can touch<span class="ed" data-act="addfolder">${ic("plus",11)} Add</span></h3>
      <div class="lst">${FOLDERS.map(([p,r],i)=>`<div class="r">${ic("folder",13)}<code>${p}</code><span class="rt"><span class="rw" data-act="folderrw" data-i="${i}" style="cursor:pointer">${r}</span><button class="ibtn" style="width:24px;height:24px" data-act="folderrm" data-i="${i}">${ic("x",10)}</button></span></div>`).join("")}</div></div>
    <div class="blk"><h3>Tools<span class="ed" data-act="go" data-v="plugins">Plugins</span></h3>
      <div class="lst">${tools.map(([n,d,on])=>`<div class="r"><div><div>${n}</div><div class="s">${d}</div></div><span class="rt"><span class="tog ${on?"on":""}"></span></span></div>`).join("")}</div></div>
    <div class="blk"><h3>Who can talk to ${a.name}</h3>
      <div class="seg"><button class="on">Everyone here</button><button>Only me</button><button>A list</button></div>
      <div style="font-size:12px;color:var(--ink3);margin-top:10px;line-height:1.5">Agents in ${WORKSPACES[S.ws].name} can always ask ${a.name} for help. People outside get no reply.</div>
      <h3 style="margin-top:30px">Monthly budget<span class="ed" data-act="budget">Change</span></h3>
      <div class="spend" data-act="budget" style="cursor:pointer"><div class="big">US$ 12.40 <small>of US$ ${BUDGET}</small></div>
        <div class="track">${Array.from({length:40},(_,i)=>`<i class="${i<Math.round(pct*40)?(pct>.8?"warn":"on"):""}"></i>`).join("")}</div>
        <div style="font-size:12px;color:var(--ink4);margin-top:8px;display:flex"><span>Alert at 80%</span><span style="margin-left:auto">Pause at 100%</span></div></div></div>
  </div>`;
}
function pActivity(a){
  const weeks=Array.from({length:26},(_,w)=>Array.from({length:7},(_,d)=>{const r=rng(a.id+w+":"+d)();return r<.35?0:r<.6?1:r<.8?2:r<.93?3:4}));
  const shade=l=>l===0?"#171717":mix("#171717",a.color,[0,.3,.55,.8,1][l]);
  const ev=(f,icn,t,s,time,act="")=>(S.afilter==="all"||S.afilter===f)?`<div class="fe" ${act} style="cursor:pointer"><span class="ico">${ic(icn,13)}</span><div><div>${t}</div><div class="s">${s}</div></div><span class="t">${time}</span></div>`:"";
  return `<div class="blk"><h3>Last 6 months<span class="ed" style="cursor:default">1,284 messages · 212 tasks · 96 hours</span></h3>
      <div class="heat">${weeks.map((wk,wi)=>`<div class="wk">${wk.map((l,di)=>`<i style="background:${shade(l)};cursor:pointer" data-act="heat" data-v="${l*3+(wi+di)%3}" title="${l*3} messages"></i>`).join("")}</div>`).join("")}</div>
      <div class="heatx"><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span></div></div>
    <div class="blk" style="margin-top:30px"><h3>Everything ${a.name} did
      <span class="subtabs" style="margin-left:auto;font-weight:400">${[["all","All"],["chat","Chats"],["file","Files"],["team","Team"],["routine","Routines"]].map(([k,l])=>`<a class="${S.afilter===k?"on":""}" data-act="afilter" data-v="${k}">${l}</a>`).join("")}</span></h3>
      <div class="feedlist">
        <div class="dgrp">Today</div>
        ${ev("file","code","Opened PR #212 — página de preço do Pro","github · 3 files · +184 −12","21:14",'data-act="file" data-f="pr212"')}
        ${ev("chat","reply","Answered "+ME.name,"6 steps · 41s · Sonnet 5.5 · US$ 0.18","21:04",'data-act="backchat"')}
        ${ev("file","doc","Saved notes/pricing-pro.md","memory · v2","21:04",'data-act="file" data-f="pricing"')}
        ${ev("team","people","Asked Hugo for competitor prices","answered in 24s","21:03",'data-act="xchg"')}
        <div class="dgrp">Yesterday</div>
        ${ev("file","doc","Remembered how you decide on prices","new note · about you","18:22",'data-act="note" data-n="1"')}
        ${ev("routine","clock","Weekly numbers routine ran","posted in #general · 2m 04s","09:00",'data-act="go" data-v="routines"')}
        ${ev("chat","shield","Asked to merge PR #205 — you said no","approval · 14s","08:41",'data-act="go" data-v="inbox"')}
      </div></div>`;
}
function xchgDrawer(){
  const A=AG.atlas,H=AG.hugo;
  drawer({title:"Atlas ↔ Hugo",sub:"2 messages · 21:03 · asked through team_ask",icon:`<span class="faces" style="display:flex">${tileHTML(A,26)}<span style="margin-left:-6px;border:2px solid #0f0f0f;border-radius:8px;display:flex">${tileHTML(H,26)}</span></span>`,width:520,
    body:`<div class="col" style="padding:0">${them(A,"21:03",`<div class="body"><p>Hugo, o que a concorrência cobra por sandbox de agente? Preciso de 2 ou 3 nomes com preço.</p></div>`)}${them(H,"21:03",`<div class="body"><p>E2B cobra por segundo de sandbox. Daytona tem plano fixo de US$ 20. Modal cobra por segundo de GPU, então não compara direto.</p></div>`)}</div>`,
    foot:`<button class="btn" data-act="openagentp" data-id="hugo">Open Hugo</button><span class="push" style="font-size:12px;color:var(--ink3)">Hugo answered in 24s</span>`});
}
