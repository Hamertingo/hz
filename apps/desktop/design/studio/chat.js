/* ───────── sidebar ───────── */
const openCount=()=>INBOX.filter(x=>x.state==="open").length;
function renderSide(){
  const w=WORKSPACES[S.ws];const list=wsAgents();const working=list.filter(a=>a.live).length;
  const navOn=v=>S.view===v?"on":"";const n=openCount();
  side.innerHTML=`
  <div class="ws" id="wsbtn">${logoHTML(w,30)}
    <div style="min-width:0"><div class="name">${w.name}</div><div class="sub">${list.length} agents${working?` · ${working} working`:""}</div></div>
    <span class="caret">${ic("caret",12)}</span>
  </div>
  <div class="jump" data-act="palette">${ic("search",13)} Jump to…<span class="kbd">⌘K</span></div>
  <nav class="nav">
    <a class="${navOn("inbox")}" data-go="inbox">${ic("inbox")} Inbox ${n?`<span class="count">${n}</span>`:""}</a>
    <a class="${navOn("routines")}" data-go="routines">${ic("clock")} Routines</a>
    <a class="${navOn("prs")}" data-go="prs">${ic("pr")} Pull requests <span class="count">${PRS.filter(p=>p.lane==="you"&&!p.merged).length||""}</span></a>
    <a class="${navOn("plugins")}" data-go="plugins">${ic("plug")} Plugins</a>
  </nav>
  <div class="scroll">
    <div class="sec">Channels<button class="add" data-act="newch" title="New channel">${ic("plus",12)}</button></div>
    <div class="chan">${w.channels.map(k=>{const c=CH[k];return`<a class="${S.view==="channel"&&S.channel===k?"on":""}" data-ch="${k}"><span class="hash">#</span><span class="${c.unread?"unr":""}">${c.name}</span><span class="faces">${c.members.slice(0,3).map(m=>`<span>${tileHTML(AG[m],16)}</span>`).join("")}</span></a>`}).join("")||`<div style="padding:4px 9px;color:var(--ink4)">No channels yet.</div>`}</div>
    <div class="sec">Agents<button class="add" data-act="newagent" title="Create agent">${ic("plus",12)}</button></div>
    <div class="agents">${list.map(agentRow).join("")}</div>
  </div>
  <div class="me">
    <span data-act="status" style="display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0;flex:1">${meTile(32)}
    <div style="min-width:0"><div class="nm">${ME.name}</div><div class="st"><i style="background:${STATUS[ME.status]}"></i>${ME.status}</div></div></span>
    <button class="ibtn" data-act="settings" title="Settings">${ic("gear",15)}</button>
  </div>`;
  side.querySelectorAll("[data-agent]").forEach(el=>el.onclick=()=>openAgent(el.dataset.agent));
  side.querySelectorAll("[data-ch]").forEach(el=>el.onclick=()=>{S.channel=el.dataset.ch;CH[S.channel].unread=false;S.view="channel";render()});
  side.querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>{S.view=el.dataset.go;render()});
  wsbtn.onclick=e=>{e.stopPropagation();S.menu=!S.menu;render()};
}
function openAgent(id){S.agent=id;AG[id].unread=false;S.view="chat";render()}
function agentRow(a){
  const on=a.id===S.agent&&["chat","working","profile"].includes(S.view);
  let right=`<span class="when">${a.when}</span>`;
  if(a.live)right=`<span class="chip" style="color:${mix(a.color,"#fff",.4)};background:${rgba(a.color,.16)}">Working</span>`;
  else if(a.ask)right=`<span class="chip" style="color:var(--amber);background:rgba(224,172,82,.12)">Needs you</span>`;
  else if(a.unread)right=`<span class="dot"></span>`;
  return `<div class="ag ${on?"on":""}" data-agent="${a.id}">
    ${tileHTML(a,34)}
    <div class="meta"><div class="top"><span class="nm">${a.name}</span><span class="role">${a.role}</span>${right}</div>
    <div class="line" ${a.live?`style="color:${mix(a.color,"#fff",.3)}"`:""}>${a.live?`<span class="shimmer">${a.line}</span>`:a.line}</div></div></div>`;
}
function renderMenu(){
  if(!S.menu)return"";
  return `<div class="menu" style="left:24px;top:98px" onclick="event.stopPropagation()">
    <div class="lbl">Workspaces</div>
    ${WORKSPACES.map((w,i)=>`<div class="it" data-ws="${i}">${logoHTML(w,26)}<div><div>${w.name}</div><div class="s">${w.agents.length} agents · ${w.channels.length} channels</div></div>${i===S.ws?`<span class="chk">${ic("check",14)}</span>`:""}</div>`).join("")}
    <hr><div class="it" data-ws-new>${ic("plus",14)} Create workspace</div>
    <div class="it" data-ws-set>${ic("gear",14)} Workspace settings</div>
  </div>`;
}
function newWorkspace(){
  let color=COLORS[4];
  const m=modal(`<div><h2>New workspace</h2><div class="lead">A team of agents with its own context. Agents in one workspace never see another's.</div></div>
    <div style="display:flex;gap:14px;align-items:center"><span data-logo>${logoHTML({name:"New",mark:"N",color},56)}</span><input class="input" data-name placeholder="HyzeVM, Pessoal, Cliente X…" style="height:40px;font-size:15px"></div>
    <div><div class="fl">Colour</div><div class="sw">${COLORS.map(c=>`<button data-c="${c}" class="${c===color?"on":""}" style="background:${c}"></button>`).join("")}</div></div>
    <div><div class="fl">What it's about</div><textarea class="fld" data-ctx style="height:70px;resize:none" placeholder="Put in front of every agent's instructions."></textarea></div>
    <div class="foot"><button class="btn" data-x>Cancel</button><button class="btn solid" data-ok>Create workspace</button></div>`);
  const name=()=>$("[data-name]",m).value.trim();
  const redraw=()=>{$("[data-logo]",m).innerHTML=logoHTML({name:name()||"New",mark:(name()[0]||"N").toUpperCase(),color},56)};
  $("[data-name]",m).oninput=redraw;
  $$("[data-c]",m).forEach(b=>b.onclick=()=>{color=b.dataset.c;$$("[data-c]",m).forEach(x=>x.classList.toggle("on",x===b));redraw()});
  $("[data-ok]",m).onclick=()=>{
    const n=name();if(!n){$("[data-name]",m).focus();return}
    WORKSPACES.push({name:n,mark:n[0].toUpperCase(),color,agents:[],channels:[],ctx:$("[data-ctx]",m).value,members:[]});
    S.ws=WORKSPACES.length-1;S.view="inbox";closeModal();render();toast(`${n} is ready. Make its first agent.`,{action:"Create agent",onAction:()=>{S.overlay="new";render()}});
  };
}

/* ───────── chat ───────── */
const chatKey=()=>S.view==="channel"?"#"+S.channel:S.agent;
function save(){const c=$("#feed .col");if(c)CHATS[chatKey()]=c.innerHTML}
function scrollFeed(){const f=$("#feed");if(f)f.scrollTop=f.scrollHeight}
function header(a){
  return `<div class="head">
    <span data-act="openprofile" style="cursor:pointer">${tileHTML(a,34)}</span>
    <div><div class="nm">${a.name}<span class="tag">${a.role}</span>${a.muted?`<span style="color:var(--ink4)">${ic("bell",12)}</span>`:""}</div>
    <div class="chips"><span class="mc">${cliMark(a.cli,12)}${a.cli}</span><span class="mc act" data-act="model" title="Change model">${a.model}${ic("down",12)}</span><span class="mc">${ic("folder",12)}~/${a.dir}</span><span class="mc act" data-act="perm" title="What it can do">${ic("shield",12)}${PERM[a.perm][0]}</span></div></div>
    <div class="acts"><button class="btn" data-act="openprofile">View profile</button><button class="ibtn" data-act="agentmore">${ic("more",14)}</button></div>
  </div>`;
}
function bar(){return `<div class="bar"><button data-act="react" title="React">${ic("smile",14)}</button><button data-act="reply" title="Reply">${ic("reply",14)}</button><button data-act="copy" title="Copy">${ic("copy",14)}</button><button data-act="msgmore" title="More">${ic("more",14)}</button></div>`}
/* A reply carries a one-line quote of what it answers, joined to it by a short curve. */
function rqHTML(q){
  if(!q)return"";const a=q.a==="me"?null:AG[q.a];const c=a?a.color:ME.color;
  return `<div class="rq" data-act="jump" data-to="${q.mid}" title="Jump to the message" style="--c:${c};--cn:${mix(c,"#fff",.35)}"><b>${a?a.name:ME.name}</b><span class="tx">${esc(q.text)}</span></div>`;
}
let REPLY=null;
function you(text,t,q){
  return `<div class="msg" id="m${uid++}" data-a="me">${meTile(36)}<div style="min-width:0;flex:1"><div class="who"><span class="n">${ME.name}</span><span class="t">${t}</span></div>${rqHTML(q)}<div class="body">${text}</div></div>${bar()}</div>`;
}
function them(a,t,inner,status="",q){
  return `<div class="msg" id="m${uid++}" data-a="${a.id}" style="--tint:${mix(a.color,"#fff",.25)}"><span data-act="openagentp" data-id="${a.id}" style="cursor:pointer;height:max-content">${tileHTML(a,36)}</span><div style="min-width:0;flex:1"><div class="who"><span class="n">${a.name}</span>${status}<span class="t">${t}</span></div>${rqHTML(q)}${inner}</div>${bar()}</div>`;
}
function did(n,t){return `<button class="did" onclick="this.nextElementSibling.classList.toggle('open')">${ic("chev",10)} See what it did <span class="m">· ${n} steps · ${t}</span></button>
  <div class="trace">
    <div class="s">${ic("check",12)} Read <code>pricing/plans.ts</code><span class="ok">0.4s</span></div>
    <div class="s">${ic("check",12)} Ran <code>psql -c "select plan, count(*) …"</code><span class="ok">2.1s</span></div>
    <div class="s">${ic("check",12)} Searched the web for <code>usage-based pricing sandbox</code><span class="ok">6.3s</span></div>
    <div class="s">${ic("check",12)} Asked Hugo for competitor prices<span class="ok">24s</span></div>
    <div class="s">${ic("check",12)} Wrote <code>notes/pricing-pro.md</code><span class="ok">0.2s</span></div>
  </div>`}
const fileCard=(f,icon,t,m,v)=>`<div class="file" data-act="file" data-f="${f}" style="cursor:pointer"><span class="ic0">${ic(icon,16)}</span><div><div class="ft">${t}</div><div class="fm">${m}</div></div><span class="v">${v}</span></div>`;
const inlineApproval=id=>`<div data-inlslot="${id}"></div>`;
function inlineInner(id){
  const it=INBOX.find(x=>x.id===id);
  if(it.state!=="open")return `<div class="done-line">${ic("check",12)} ${it.res} · ${it.resAt||""}</div>`;
  return `<div class="inl" data-inl="${id}"><div class="h">${ic("shield",12)} Waiting for you · ${it.t}</div>
    <div class="acts"><button class="btn solid sm" data-act="inl-approve" data-id="${id}">Approve and publish</button><button class="btn sm" data-act="file" data-f="thread">Open draft</button><button class="btn sm bad" data-act="inl-deny" data-id="${id}">Not now</button></div></div>`;
}
function chatBody(a,working){
  let out=`<div class="day">Today</div>`;
  if(a.fresh)return out+them(a,a.when,`<div class="body"><p>Oi, ${ME.name}! Sou ${a.name}, ${a.role.toLowerCase()} da ${WORKSPACES[S.ws].name}. Já li o contexto do workspace e as minhas instruções.</p><p>Por onde você quer que eu comece?</p></div>`);
  if(a.id==="ada"){
    out+=you(`Revisa o PR <code>#208</code> do pool de VMs antes de eu fazer merge.`,"20:31");
    out+=them(a,"20:36",`<div class="body"><p>Revisei. Dá pra fazer merge depois de um ajuste: o <code>release()</code> devolve a VM pro pool mesmo quando o snapshot falha, então uma VM suja pode ir pro próximo cliente.</p><p>Deixei a correção como sugestão no PR e um teste que reproduz o caso.</p></div>
    ${fileCard("pr208","code","PR #208 · vm pool: reuse warm VMs","github · 1 suggestion · 1 test added","OPEN")}${did(9,"2m 10s")}`);
    out+=you(`Roda os testes da API e corrige o que quebrar no billing.`,"21:20");
    if(!working)return out+them(a,"21:24",`<div class="body"><p>Testes verdes. O <code>meter.ts</code> arredondava por hora; agora arredonda por minuto. Preciso do seu ok pra dar push.</p></div>`);
    out+=them(a,"",`<div class="steps">
        <div class="st">${ic("check",12)} Read <code>src/billing/meter.ts</code></div>
        <div class="st">${ic("check",12)} Found 2 failing tests in <code>billing.spec.ts</code></div>
        <div class="st">${ic("check",12)} Edited <code>meter.ts</code> <span class="mono" style="font-size:11px;color:var(--green)">+12</span> <span class="mono" style="font-size:11px;color:var(--red)">−4</span></div>
        <div class="st now"><span class="spin"><i></i><i></i><i></i><i></i></span><span class="shimmer">Running</span> <code>pnpm test --filter api</code></div>
      </div>
      <div class="term"><div class="th">${ic("term",13)} ${a.name}'s terminal<span class="x"><button class="btn sm" data-act="takeover">Take over</button></span></div>
<pre><span class="k">$ pnpm test --filter api</span>
 ✓ auth/session.spec.ts (14)
 ✓ vms/pool.spec.ts (22)
 <span class="g">✓</span> billing/meter.spec.ts (9)
 · billing/invoice.spec.ts <span class="caret"></span></pre></div>`,`<span class="t shimmer">working · 0:14</span>`);
    return out;
  }
  if(a.id==="atlas"){
    out+=you(`Analisa se o plano Pro a <b>R$ 89</b> faz sentido com o custo atual por VM. Pergunta pro Hugo o que a concorrência cobra.`,"21:02");
    out+=`<div class="xchg" data-act="xchg" style="cursor:pointer">${tileHTML(a,18)}<b>${a.name}</b> asked ${tileHTML(AG.hugo,18)}<b>Hugo</b><span class="m">· 2 messages · 21:03</span></div>`;
    out+=them(a,"21:04",`<div class="body"><p>Fiz a conta com os números de outubro. O Pro a <b>R$ 89</b> fecha com margem de <b>41%</b> se o uso médio ficar abaixo de 46 horas de VM por mês — hoje a mediana é 31h.</p>
    <ol><li><b>Custo por VM-hora:</b> R$ 0,74 (Firecracker + storage), caindo pra R$ 0,61 com o pool novo.</li><li><b>Concorrência</b> (Hugo levantou): E2B cobra por segundo, Daytona tem plano fixo de US$ 20.</li><li><b>Risco:</b> os 8% que passam de 120h/mês comem metade da margem.</li></ol>
    <p>Sugiro manter R$ 89 com um teto de 100h e excedente por hora. Deixei o raciocínio em <code>notes/pricing-pro.md</code>.</p></div>
    ${fileCard("pricing","doc","Análise de preço — plano Pro",`pricing-pro.md · 4.1 KB · made by ${a.name}`,"V2")}
    ${did(6,"41s")}<div class="react"><span data-act="rx">👍<em>1</em></span></div>`);
    out+=you(`<blockquote>Sugiro manter R$ 89 com um teto de 100h e excedente por hora.</blockquote>Fechado. Escreve a página de preço com isso.`,"21:12");
    out+=them(a,"21:14",`<div class="body"><p>Feito. Rascunho da página no PR <code>#212</code>, com a tabela de excedente e um FAQ curto. Marquei a Mila pra revisar o texto.</p></div>${fileCard("pr212","code","PR #212 · pricing page for Pro","github · 3 files · +184 −12","REVIEW")}${did(4,"18s")}`);
    return out;
  }
  if(a.id==="mila"){
    out+=you(`Prepara a thread de lançamento do Pro pro X. Usa a tabela do Atlas.`,"20:10");
    out+=them(a,"21:02",`<div class="body"><p>Thread pronta: cinco posts, a tabela do Atlas no terceiro. Publicar é sempre com você, então espero o seu ok.</p></div>${fileCard("thread","doc","Thread — lançamento do Pro","5 posts · 1,184 chars · made by Mila","DRAFT")}${inlineApproval("i1")}`);
    return out;
  }
  out+=you(`O que você tem pra mim hoje?`,"09:12");
  out+=them(a,a.when,`<div class="body"><p>${a.line}</p></div>`);
  return out;
}
function composer(a,working,{placeholder,hint,mentions}={}){
  const tint=a.color;
  return `<div class="dock" data-dock>
    ${working?`<div class="working" style="background:${rgba(tint,.13)};box-shadow:inset 0 0 0 1px ${rgba(tint,.3)};color:${mix(tint,"#fff",.45)}">
      <canvas id="wbg" style="position:absolute;inset:0;width:100%;height:100%;opacity:.35"></canvas>
      <span class="wt">${tileHTML(a,22)}<b style="font-weight:600">${a.name}</b><span>is running tests</span><span class="tm" data-clock>0:14</span></span>
      <button class="stop" data-act="stop" title="Stop">${ic("stop",10,"#fff")}</button></div>`:""}
    <div class="box"><div class="rpl">${replyBar()}</div><div class="atts"></div><textarea data-ta placeholder="${placeholder||`Message ${a.name} — @ to bring someone in, / for commands`}"></textarea>
      <div class="tools"><span data-tos style="display:flex;gap:4px">${mentions||`<span class="to">${tileHTML(a,18)}${a.name}</span>`}</span><span class="sep"></span>
        ${[["bold","Bold"],["ital","Italic"],["code","Code"],["link","Link"],["list","List"],["quote","Quote"]].map(([n,t])=>`<button class="tb" data-act="fmt" data-f="${n}" title="${t}">${ic(n,13)}</button>`).join("")}
        <span class="sep"></span><button class="tb" data-act="attach" title="Attach">${ic("clip",13)}</button><button class="tb" data-act="emoji" title="Emoji">${ic("smile",13)}</button><button class="tb" data-act="at" title="Mention">${ic("at",13)}</button>
        <button class="tb" data-act="mic" title="Dictate" style="margin-left:auto">${ic("mic",14)}</button><button class="send" data-act="send" title="Send">${ic("up",14,"#0b0b0b")}</button></div></div>
    <div class="hint"><span data-hint style="display:flex;align-items:center;gap:8px">${ic("lock",11)} ${hint||`${a.name} ${PERM[a.perm][1].toLowerCase()}. Merges and deploys always ask you.`}</span><span class="r">⏎ send · @ mention · / commands</span></div>
  </div>`;
}
function renderChat(){
  const a=AG[S.agent];const working=!!a.live;
  main.innerHTML=header(a)+`<div class="feed" id="feed"><div class="col">${CHATS[a.id]??chatBody(a,working)}</div></div>`+composer(a,working);
  scrollFeed();
  const w=document.getElementById("wbg");if(w)dither(w,a.color,a.id+":pill",{cols:60,rows:8,light:.8});
  bindComposer(main);
}

/* ───────── composer engine ───────── */
const SLASH=[["remember","Save this to the agent's memory","spark"],["ask","Ask a teammate and wait for the answer","people"],["routine","Turn this into a routine","clock"],["handoff","Hand this to another agent","reply"],["clear","Start a fresh page in this chat","trash"]];
function bindComposer(root){
  const ta=$("[data-ta]",root);if(!ta)return;
  ta.oninput=()=>{ta.style.height="auto";ta.style.height=Math.min(180,Math.max(52,ta.scrollHeight))+"px";suggest(ta)};
  ta.onkeydown=e=>{
    const open=popEl&&(popEl.classList.contains("mention")||popEl.classList.contains("slash"));
    if(open&&["ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();const its=$$(".it",popEl);let i=its.findIndex(x=>x.classList.contains("on"));its[i]?.classList.remove("on");i=(i+(e.key==="ArrowDown"?1:-1)+its.length)%its.length;its[i].classList.add("on");return}
    if(open&&(e.key==="Enter"||e.key==="Tab")){e.preventDefault();$(".it.on",popEl)?.click();return}
    if(open&&e.key==="Escape"){e.stopPropagation();closePop();return}
    if(e.key==="Escape"&&REPLY){e.stopPropagation();cancelReply();return}
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(root)}
  };
}
function suggest(ta){
  const before=ta.value.slice(0,ta.selectionStart);
  let m=before.match(/(^|\s)@(\w*)$/);
  if(m)return mentionPop(ta,m[2]);
  m=before.match(/^\/(\w*)$/);
  if(m)return slashPop(ta,m[1]);
  if(popEl&&(popEl.classList.contains("mention")||popEl.classList.contains("slash")))closePop();
}
function mentionPop(ta,q){
  const inCh=S.view==="channel";const mem=inCh?CH[S.channel].members:[];
  let list=wsAgents().filter(a=>a.name.toLowerCase().startsWith(q.toLowerCase()));
  list.sort((x,y)=>mem.includes(y.id)-mem.includes(x.id));
  if(!list.length){closePop();return}
  const p=pop(ta.closest(".box"),`<div class="lbl">${inCh?"In #"+S.channel+" first":"Bring someone in"}</div>`+list.map((a,i)=>`<div class="it ${i?"":"on"}" data-n="${a.name}">${tileHTML(a,22)}<span>${a.name}</span><span class="r">${a.role}</span><span class="s">${inCh&&!mem.includes(a.id)?"not in channel":a.live?"working":""}</span></div>`).join(""),{place:"above",cls:"mention"});
  p.style.minWidth="280px";
  $$(".it",p).forEach(el=>el.onclick=()=>{insertAt(ta,/@\w*$/,"@"+el.dataset.n+" ");closePop();addChip(ta,el.dataset.n)});
}
function slashPop(ta,q){
  const list=SLASH.filter(c=>c[0].startsWith(q));if(!list.length){closePop();return}
  const p=pop(ta.closest(".box"),`<div class="lbl">Commands</div>`+list.map((c,i)=>`<div class="it ${i?"":"on"}" data-c="${c[0]}">${ic(c[2],13)}<span>/${c[0]}</span><span class="r">${c[1]}</span></div>`).join(""),{place:"above",cls:"slash"});
  $$(".it",p).forEach(el=>el.onclick=()=>{insertAt(ta,/^\/\w*$/,"/"+el.dataset.c+" ");closePop()});
}
function insertAt(ta,re,text){
  const pos=ta.selectionStart;const before=ta.value.slice(0,pos).replace(re,text);
  ta.value=before+ta.value.slice(pos);ta.focus();ta.selectionStart=ta.selectionEnd=before.length;
}
function addChip(ta,name){
  const tos=$("[data-tos]",ta.closest("[data-dock]"));const a=Object.values(AG).find(x=>x.name===name);
  if(!tos||!a||$(`[data-chip="${a.id}"]`,tos))return;
  if(S.view==="channel")tos.insertAdjacentHTML("beforeend",`<span class="to" data-chip="${a.id}" style="margin-left:4px">${tileHTML(a,18)}${a.name}</span>`);
}
function fmtText(t){
  let h=esc(t);
  h=h.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,"<code>$1</code>").replace(/(^|\s)_(.+?)_/g,"$1<i>$2</i>").replace(/@(\w+)/g,'<span class="at">@$1</span>');
  const lines=h.split("\n");const q=lines.filter(l=>l.startsWith("&gt; ")).map(l=>l.slice(5));const rest=lines.filter(l=>!l.startsWith("&gt; "));
  return (q.length?`<blockquote>${q.join("<br>")}</blockquote>`:"")+rest.join("<br>");
}
const REPLIES={
  Strategy:"Antes de opinar quero dois números: o custo atual e o churn do mês. Puxo os dois e volto com uma recomendação.",
  Dev:"Beleza. Abro uma branch, faço a mudança e rodo os testes antes de te mostrar o diff.",
  Marketing:"Fechado. Faço um rascunho e te mando pra aprovar antes de publicar qualquer coisa.",
  Research:"Vou atrás de três fontes boas e te trago um resumo com os links.",
  Content:"Anotado. Escrevo um primeiro rascunho e deixo no Drive pra você revisar.",
  Infra:"Olho o pool e os alarmes agora e te digo o que achei.",
  Security:"Rodo o scan e te mando só o que for crítico.",
};
function replyBar(){
  if(!REPLY||REPLY.key!==chatKey())return"";const a=REPLY.a==="me"?null:AG[REPLY.a];
  return `<div class="replying" style="--c:${a?a.color:ME.color}"><div class="h">${ic("reply",13)}Replying to <b>${a?a.name:"yourself"}</b></div><div class="q">${esc(REPLY.text)}</div><button data-act="replyx" title="Cancel reply · Esc">${ic("x",14)}</button></div>`;
}
function startReply(msg){
  if(!msg.id)msg.id="m"+(uid++);
  const text=$(".body",msg)?.innerText.replace(/\s+/g," ").trim()||"";
  REPLY={key:chatKey(),mid:msg.id,a:msg.dataset.a||"me",text:text.length>110?text.slice(0,108)+"…":text};
  const dock=$("[data-dock]");$(".rpl",dock).innerHTML=replyBar();
  $$(".msg.replyto").forEach(x=>x.classList.remove("replyto"));msg.classList.add("replyto");
  const ta=$("[data-ta]",dock);ta.focus();save();
}
function cancelReply(){REPLY=null;const r=$(".rpl");if(r)r.innerHTML="";$$(".msg.replyto").forEach(x=>x.classList.remove("replyto"))}
function send(root){
  const ta=$("[data-ta]",root);const text=ta.value.trim();const atts=$$(".att",root);
  if(!text&&!atts.length){ta.focus();return}
  if(text==="/clear"){ta.value="";clearChat();return}
  if(text.startsWith("/routine")){ta.value="";S.view="routines";render();routineEditor(null,text.replace("/routine","").trim());return}
  if(text.startsWith("/remember")){const body=text.replace("/remember","").trim()||"Nota sem título";NOTES.unshift({t:body.slice(0,40),tag:"About you",w:"just now",s:body,used:0,body:`<p>${esc(body)}</p>`});ta.value="";toast(`${AG[S.agent]?.name||"Agent"} saved it to memory`,{icon:"spark",action:"Open",onAction:()=>{S.view="profile";S.ptab="memory";S.note=0;render()}});return}
  const key=chatKey();const col=$("#feed .col");
  const attHTML=atts.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${atts.map(x=>`<span class="att">${ic("clip",12)}${x.dataset.name}</span>`).join("")}</div>`:"";
  const q=REPLY&&REPLY.key===key?{mid:REPLY.mid,a:REPLY.a,text:REPLY.text}:null;cancelReply();
  const mine=you(fmtText(text)+attHTML,now(),q);const myId=mine.match(/id="(m\d+)"/)[1];
  col.insertAdjacentHTML("beforeend",mine);
  ta.value="";ta.style.height="";$(".atts",root).innerHTML="";scrollFeed();save();
  const back={mid:myId,a:"me",text:text.length>110?text.slice(0,108)+"…":text};
  let targets;
  if(S.view==="channel"){const c=CH[S.channel];targets=c.members.map(k=>AG[k]).filter(a=>text.includes("@"+a.name));if(!targets.length)targets=q&&AG[q.a]&&c.members.includes(q.a)?[AG[q.a]]:[AG[c.lead]]}
  else targets=[AG[S.agent]];
  targets.forEach((a,i)=>setTimeout(()=>reply(a,key,q?back:null),600+i*1100));
}
function reply(a,key,q){
  const id="ty"+(uid++);
  const typing=`<div class="msg" id="${id}" style="--tint:${a.color}">${tileHTML(a,36)}<div><div class="who"><span class="n">${a.name}</span><span class="t">typing</span></div><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  const msg=them(a,now(),`<div class="body"><p>${REPLIES[a.role]||"Entendido. Começo agora e te aviso aqui quando terminar."}</p></div>`,"",q);
  if(chatKey()===key&&$("#feed .col")){$("#feed .col").insertAdjacentHTML("beforeend",typing);scrollFeed()}
  setTimeout(()=>{
    const t=document.getElementById(id);
    if(t&&chatKey()===key){t.outerHTML=msg;scrollFeed();save()}else{t?.remove();CHATS[key]=(CHATS[key]??"")+msg}
    a.line=REPLIES[a.role]||a.line;a.when=now();if(chatKey()!==key)a.unread=true;renderSide();
  },1400);
}
function clearChat(){CHATS[chatKey()]=`<div class="day">Cleared at ${now()}</div>`;render();toast("Fresh page. The agent keeps its memory.",{icon:"trash"})}
function wrapSel(ta,f){
  const s=ta.selectionStart,e=ta.selectionEnd,sel=ta.value.slice(s,e)||({link:"link"}[f]??"text");
  const out={bold:`**${sel}**`,ital:`_${sel}_`,code:"`"+sel+"`",link:`[${sel}](https://)`,list:sel.split("\n").map(l=>"- "+l).join("\n"),quote:sel.split("\n").map(l=>"> "+l).join("\n")}[f];
  ta.value=ta.value.slice(0,s)+out+ta.value.slice(e);ta.focus();ta.selectionStart=s;ta.selectionEnd=s+out.length;
}
let micTimer=null;
function toggleMic(btn){
  const dock=btn.closest("[data-dock]");const hint=$("[data-hint]",dock);const ta=$("[data-ta]",dock);
  if(btn.classList.contains("rec")){
    btn.classList.remove("rec");clearInterval(micTimer);hint.innerHTML=hint.dataset.old;
    ta.value+=(ta.value?" ":"")+"Me manda o resumo do dia quando terminar.";ta.focus();return;
  }
  btn.classList.add("rec");hint.dataset.old=hint.innerHTML;let s=0;
  hint.innerHTML=`<span style="width:7px;height:7px;background:var(--red);display:inline-block;animation:blink 1s steps(1) infinite"></span> Listening… 0:00 — click the mic again to stop`;
  micTimer=setInterval(()=>{s++;hint.innerHTML=hint.innerHTML.replace(/\d:\d\d/,`0:${String(s).padStart(2,"0")}`)},1000);
}
function addReaction(msg,e){
  const col=msg.children[1];let r=$(".react",col);
  if(!r){col.insertAdjacentHTML("beforeend",`<div class="react"></div>`);r=$(".react",col)}
  const ex=$$("span",r).find(s=>s.firstChild.textContent===e);
  if(ex)return toggleRx(ex);
  r.insertAdjacentHTML("beforeend",`<span class="mine" data-act="rx">${e}<em>1</em></span>`);save();
}
function toggleRx(sp){
  const em=$("em",sp);let n=+em.textContent;
  if(sp.classList.contains("mine")){n--;sp.classList.remove("mine")}else{n++;sp.classList.add("mine")}
  if(n<=0){const r=sp.parentElement;sp.remove();if(!r.children.length)r.remove()}else em.textContent=n;save();
}

/* ───────── files the chat links to ───────── */
const THREAD=["Lançamos o plano Pro: VMs sandbox por hora, 100h incluídas por R$ 89.","Passou de 100h? R$ 0,90 a hora, cobrado por minuto. Sem surpresa no fim do mês.","A conta: custo por VM-hora caiu pra R$ 0,74 e cai mais com o pool novo. A tabela 👇","Por que por hora e não por segundo? Agente de IA roda em rajadas. Por hora é o que dá pra prever.","Teste grátis de 10h, sem cartão: hyze.cloud/pro"];
function postsHTML(edit){return `<div class="posts">${THREAD.map((p,i)=>`<div class="post">${logoHTML(WORKSPACES[0],30)}<div style="flex:1;min-width:0"><div class="ph"><b>Hyze Cloud</b><em>@hyzecloud · ${i+1}/5</em></div><div class="pc2" ${edit?`contenteditable="true" data-post="${i}" style="outline:none"`:""}>${p}</div><div class="cnt">${p.length} / 280</div></div></div>`).join("")}</div>`}
function openFile(f){
  const F={
    pricing:{t:"Análise de preço — plano Pro",s:"notes/pricing-pro.md · v2 · Atlas",b:`<div class="doc2"><h1>Plano Pro: R$ 89</h1><p>Margem de <b>41%</b> com a mediana de uso atual (31h/mês).</p><h3>## Custo por VM-hora</h3><table><tr><th>Item</th><th>Hoje</th><th>Pool novo</th></tr><tr><td>Firecracker</td><td>R$ 0,52</td><td>R$ 0,41</td></tr><tr><td>Storage</td><td>R$ 0,13</td><td>R$ 0,12</td></tr><tr><td>Rede</td><td>R$ 0,09</td><td>R$ 0,08</td></tr><tr><td><b>Total</b></td><td><b>R$ 0,74</b></td><td><b>R$ 0,61</b></td></tr></table><h3>## Concorrência</h3><ul><li>E2B cobra por segundo.</li><li>Daytona: plano fixo de US$ 20.</li></ul><h3>## Recomendação</h3><p>Manter R$ 89 com teto de 100h e excedente de R$ 0,90/h.</p><h3>## Risco</h3><p>Os 8% acima de 120h/mês comem metade da margem.</p></div>`,foot:`<button class="btn" data-ff="edit">${ic("pen",12)} Open in editor</button><button class="btn" data-ff="dl">${ic("out",12)} Download</button><button class="btn solid push" data-ff="ask">Ask Atlas about it</button>`},
    pr208:{t:"PR #208 · vm pool: reuse warm VMs",s:"GitHub · hyze/api-node · open",b:`<div class="doc2"><p>Reaproveita VMs quentes em vez de criar uma nova a cada sessão. Ada sugeriu uma correção.</p></div><div class="diff"><div class="h">@@ src/vms/pool.ts:41 @@</div><div>  async release(vm: Vm) {</div><div class="d">-   this.free.push(vm)</div><div class="a">+   const ok = await vm.snapshot().catch(() => false)</div><div class="a">+   if (ok) this.free.push(vm)</div><div class="a">+   else await vm.destroy()</div><div>  }</div></div>`,foot:`<button class="btn" data-ff="gh">${ic("globe",12)} Open on GitHub</button><button class="btn solid push" data-ff="approve">Approve PR</button>`},
    pr212:{t:"PR #212 · pricing page for Pro",s:"GitHub · hyze/site · review requested",b:`<div class="doc2"><p>Página de preço com a tabela de excedente e FAQ. 3 arquivos, +184 −12.</p></div><div class="diff"><div class="h">@@ app/pricing/page.tsx @@</div><div class="a">+ &lt;Plan name="Pro" price="R$ 89" hours={100} /&gt;</div><div class="a">+ &lt;Overage per="hora" price="R$ 0,90" billed="por minuto" /&gt;</div><div class="d">- &lt;Plan name="Pro" price="R$ 79" /&gt;</div></div>`,foot:`<button class="btn" data-ff="gh">${ic("globe",12)} Open on GitHub</button><button class="btn solid push" data-ff="approve">Approve PR</button>`},
    thread:{t:"Thread — lançamento do Pro",s:"Draft · 5 posts by Mila · click a post to edit",b:postsHTML(true),foot:`<button class="btn" data-ff="dl">${ic("copy",12)} Copy all</button><button class="btn solid push" data-ff="publish">Approve and publish</button>`},
  }[f];
  const d=drawer({title:F.t,sub:F.s,icon:`<span class="ibtn" style="border:1px solid var(--line2)">${ic(f.startsWith("pr")?"code":"doc",14)}</span>`,body:F.b,foot:F.foot,width:600});
  $$("[data-post]",d).forEach(el=>el.oninput=()=>{THREAD[+el.dataset.post]=el.textContent;el.nextElementSibling.textContent=`${el.textContent.length} / 280`});
  $$("[data-ff]",d).forEach(b=>b.onclick=()=>{
    const k=b.dataset.ff;
    if(k==="edit")toast("Opened pricing-pro.md in your editor",{icon:"pen"});
    if(k==="dl")toast(f==="thread"?"Copied all five posts":"Saved pricing-pro.md to Downloads",{icon:"check"});
    if(k==="ask"){closeDrawer();S.agent="atlas";S.view="chat";render();const ta=$("[data-ta]");ta.value="Sobre a análise de preço: ";ta.focus()}
    if(k==="gh")toast("Opened on github.com",{icon:"globe"});
    if(k==="approve")progress(b,"Approving",700,()=>{closeDrawer();toast("PR approved. Ada will merge after checks pass.",{icon:"check"})});
    if(k==="publish"){closeDrawer();resolve("i1","PUBLISHED")}
  });
}
function takeOver(){
  const a=AG[S.agent];
  const m=modal(`<div style="display:flex;align-items:center;gap:10px">${tileHTML(a,28)}<div><h2>You have ${a.name}'s terminal</h2><div class="lead" style="margin-top:2px">${a.name} is paused until you give it back.</div></div></div>
    <div class="term2" data-t><span class="k">$ pnpm test --filter api</span><br> ✓ billing/meter.spec.ts (9)<br> ✓ billing/invoice.spec.ts (6)<br><span style="color:var(--green)">Tests 51 passed</span><br><span data-line><span class="k">$ </span><input data-in placeholder="type a command, ⏎ to run"></span></div>
    <div class="foot"><button class="btn solid" data-x>Give it back to ${a.name}</button></div>`,{width:600});
  const inp=$("[data-in]",m);inp.focus();
  inp.onkeydown=e=>{if(e.key!=="Enter")return;const v=inp.value;$("[data-line]",m).insertAdjacentHTML("beforebegin",`<span class="k">$ ${esc(v)}</span><br>${v?`${esc(v.split(" ")[0])}: done<br>`:""}`);inp.value="";$("[data-t]",m).scrollTop=1e9};
  $("[data-x]",m).addEventListener("click",()=>toast(`${a.name} has the terminal again`,{icon:"term"}));
}
function stopAgent(){
  const a=AG[S.agent];a.live=false;a.line="Stopped by you";a.when=now();
  const st=$(".st.now");if(st)st.outerHTML=`<div class="st">${ic("stop",12)} Stopped by you <span style="color:var(--ink4)">· ${now()}</span></div>`;
  $$(".shimmer.mono").forEach(x=>{x.classList.remove("shimmer");x.textContent="stopped"});
  $(".working")?.remove();$(".caret")?.remove();save();renderSide();
  toast(`${a.name} stopped. Nothing was pushed.`,{icon:"stop",action:"Resume",onAction:()=>{a.live=true;a.line="Running pnpm test --filter api";delete CHATS[a.id];render()}});
}

/* ───────── channel ───────── */
function channelBody(c){
  const has=k=>c.members.includes(k);const A=AG.atlas,M=AG.mila,L=AG.leo;
  if(c.name!=="launch")return `<div class="day">Today</div>`+them(AG[c.lead],"09:00",`<div class="body"><p>Bom dia. Nada novo em <b>#${c.name}</b> desde ontem.</p></div>`);
  let feed=`<div class="day">Today</div>`;
  feed+=you(`<span class="at">@Mila</span> <span class="at">@Leo</span> vamos lançar o plano Pro dia 30. Mila fica com a thread de anúncio, Leo com o post no blog. <span class="at">@Atlas</span> confere os números antes de sair.`,"20:10");
  feed+=`<div class="round">Round 1 of 3 · three agents answering</div>`;
  if(has("mila"))feed+=them(M,"20:11",`<div class="body"><p>Fico com a thread. Rascunho em 20 minutos, cinco posts, com a tabela do Atlas no terceiro.</p></div>
    <div class="task" data-act="task" data-t="0" style="cursor:pointer"><span class="k">${ic("flag",12)} Task</span><span class="tt">Launch thread for X</span><span class="ow">${tileHTML(M,18)} Mila · <span class="shimmer">in progress</span></span></div>`);
  if(has("leo"))feed+=them(L,"20:12",`<div class="body"><p>Post no blog: <b>“Plano Pro: VMs por hora, sem surpresa no fim do mês”</b>. Vou puxar os números do Atlas e o FAQ da página.</p></div>`);
  if(has("atlas"))feed+=them(A,"20:14",`<div class="body"><p>Números conferidos: margem de <b>41%</b>, teto de 100h, excedente a R$ 0,90/h. Mandei a tabela pro Leo e pra Mila.</p></div><div class="react"><span data-act="rx">✅<em>2</em></span><span data-act="rx">🎉<em>1</em></span></div>`);
  feed+=`<div class="round">Round 2 of 3</div>`;
  if(has("mila"))feed+=them(M,"20:31",`<div class="body"><p>Thread pronta. Antes de publicar preciso do seu ok — publicar é sempre com você.</p></div>
    ${fileCard("thread","doc","Thread — lançamento do Pro","5 posts · 1,184 chars · made by Mila","DRAFT")}${inlineApproval("i1")}`);
  return feed;
}
const TASKS=[["Launch thread for X","mila","waiting for you","var(--amber)"],["Blog post","leo","writing","var(--ink2)"],["Pricing check","atlas","done","var(--green)"]];
function renderChannel(){
  const c=CH[S.channel];const mem=c.members.map(k=>AG[k]);const lead=AG[c.lead];
  const tasks=TASKS.map((t,i)=>[...t,i]).filter(t=>c.members.includes(t[1])&&c.name==="launch");
  main.innerHTML=`<div class="head">
      <span style="width:34px;height:34px;border-radius:9px;border:1px solid var(--line2);display:grid;place-items:center;color:var(--ink2);flex:none">${ic("hash",15)}</span>
      <div><div class="nm">${c.name}${c.muted?`<span style="color:var(--ink4)">${ic("bell",12)}</span>`:""}</div><div class="sub" style="font-family:var(--sans);font-size:12px">${c.purpose}</div></div>
      <div class="acts"><span class="faces" style="margin-right:6px;cursor:pointer" data-act="chmembers">${mem.map(m=>`<span style="border-color:var(--bg)">${tileHTML(m,22)}</span>`).join("")}</span><button class="btn" data-act="chmembers">${ic("people",13)} ${mem.length+1}</button><button class="ibtn" data-act="chmore">${ic("more",14)}</button></div>
    </div>
    <div class="chwrap"><div class="chmain"><div class="feed" id="feed"><div class="col">${CHATS["#"+S.channel]??channelBody(c)}</div></div>
      ${composer(lead,false,{placeholder:`Message #${c.name} — @ to pick who answers`,hint:`Agents answer when you @mention them, up to 3 rounds. ${lead.name} leads and picks who answers otherwise.`,
        mentions:`<span class="to" style="padding:0 8px;color:var(--ink3)">@</span>`})}</div>
      <aside class="about">
        <h4>About</h4><div class="purpose">${c.purpose}</div>
        <h4>Lead</h4><div class="mrow" data-act="openagentp" data-id="${lead.id}" style="cursor:pointer">${tileHTML(lead,26)}<div><div style="font-weight:500">${lead.name}</div><div style="font-size:11.5px;color:var(--ink3)">routes unmentioned messages</div></div></div>
        <h4>Members · ${mem.length+1}<span style="margin-left:auto;cursor:pointer;text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:12px;color:var(--ink3)" data-act="chmembers">${ic("plus",11)}</span></h4>
        <div class="mrow">${meTile(26)}<span>${ME.name}</span><span class="r">Owner</span></div>
        ${mem.map(m=>`<div class="mrow" data-act="openagentp" data-id="${m.id}" style="cursor:pointer">${tileHTML(m,26)}<span>${m.name}</span><span class="r">${m.role}</span></div>`).join("")}
        <h4>Tasks</h4>
        ${tasks.map(([t,o,s,col,i])=>`<div class="trow" data-act="task" data-t="${i}" style="cursor:pointer">${tileHTML(AG[o],22)}<div><div class="t">${t}</div><div class="s"><i class="okdot" style="background:${INBOX[0].state!=="open"&&i===0?"var(--green)":col}"></i>${INBOX[0].state!=="open"&&i===0?"published":s}</div></div></div>`).join("")||`<div style="color:var(--ink4)">No open tasks.</div>`}
        <h4>Rules</h4><div class="purpose" style="font-size:12px">Up to ${c.rounds||3} rounds per message. Each agent answers once per round. Publishing and merging ask you.</div>
      </aside></div>`;
  scrollFeed();bindComposer(main);
}
function channelMembers(){
  const c=CH[S.channel];
  const d=drawer({title:`#${c.name} members`,sub:`${c.members.length} agents and you`,body:`<h4>Agents in ${WORKSPACES[S.ws].name}</h4>${wsAgents().map(a=>`<div class="mrow">${tileHTML(a,28)}<div><div>${a.name}</div><div style="font-size:11.5px;color:var(--ink3)">${a.role}${a.id===c.lead?" · lead":""}</div></div><span class="tog ${c.members.includes(a.id)?"on":""}" data-act="chm" data-id="${a.id}" style="margin-left:auto"></span></div>`).join("")}
    <h4>Lead</h4><div class="seg" data-seg="chlead">${c.members.map(k=>`<button data-v="${k}" class="${k===c.lead?"on":""}">${AG[k].name}</button>`).join("")}</div>
    <h4>Rounds per message</h4><div class="seg" data-seg="chrounds">${[1,2,3].map(n=>`<button data-v="${n}" class="${(c.rounds||3)===n?"on":""}">${n}</button>`).join("")}</div>`,
    foot:`<button class="btn solid push" data-x2>Done</button>`,width:420});
  $("[data-x2]",d).onclick=()=>{closeDrawer();render()};
}
function taskDrawer(i){
  const [t,o,s]=TASKS[i];const a=AG[o];const pub=i===0&&INBOX[0].state!=="open";
  drawer({title:t,sub:`Task in #${S.channel} · ${a.name} owns it`,icon:tileHTML(a,30),
    body:`<h4>Status</h4><div style="display:flex;align-items:center;gap:8px"><i class="okdot" style="background:${pub?"var(--green)":TASKS[i][3]}"></i>${pub?"published":s}</div>
      <h4>Thread</h4><div class="tl"><div class="e"><div class="h">You asked in #${S.channel}<span class="t">20:10</span></div></div><div class="e"><div class="h">${a.name} took it<span class="t">20:11</span></div></div><div class="e hi" style="padding-bottom:0"><div class="h">${pub?"Published":s}<span class="t">${pub?INBOX[0].resAt:"20:31"}</span></div></div></div>
      ${i===0?`<h4>Result</h4>${fileCard("thread","doc","Thread — lançamento do Pro","5 posts · made by Mila","DRAFT")}`:""}`,
    foot:`<button class="btn" data-act="openagentp" data-id="${o}">Open ${a.name}</button><button class="btn solid push" data-act="taskmsg" data-id="${o}">Message ${a.name}</button>`,width:460});
}
