/* ───────── identity: heads, dither, glyphs ───────── */
const HEADS = {
  sun:{a:"#e0a03a",r:["........",".......a","..a....a","...a.ooo","....olbb","...oblbb","...obbbb","aa.obheb","...obeeb","...opbbb","...obbnb","....obbn","...a.odd","..a...oo",".......a","........"]},
  cat:{a:"#e88aa0",r:["........","..o.....","..oo....","..opo...","..opbooo","..olbbbb","..obbbbb","..obhebb","..obeebb","..opbbba","..obbbnb","...obbbb","...obddd","....oooo","........","........"]},
  fox:{a:"#4a2410",r:["........",".o......",".oo.....",".oao....",".oaao...",".obbbooo",".olbbbbb",".obhebbb",".obeebbb",".owbbbbb",".owwbbbb","..owwwwn","...owwww","....oooo","........","........"]},
  frog:{a:"#e36a6a",r:["........","........","..oooo..",".owwheo.",".owweeo.",".obbbboo","oblbbbbb","obbbbbbb","obpbbbbb","obbnbbbb","obbbnnnn",".obbbbbb",".odddddd","..oooooo","........","........"]},
  owl:{a:"#e0a03a",r:["........",".o......",".oo.....",".obooooo",".obbbbbb",".owwwwbb",".owhewbb",".oweewbb",".owwwwba",".obbbbba",".oblllll",".obllldl","..obllll","...ooooo","........","........"]},
  ghost:{a:"#e88aa0",r:["........",".....ooo","...oolbb","..olbbbb",".olbbbbb",".obbbbbb",".obbhebb",".obbeebb",".obbeebb",".obpbbbb",".obbbbbn",".obbbbbb",".obbbbbb",".obbobbb","..oo.ooo","........"]},
  bear:{a:"#2e1d10",r:["........","..ooo...",".obpbooo",".oblbbbb",".obbbbbb",".obbbbbb",".obbebbb",".obbebbb",".obbbwww",".opbwwwn",".obbwwnw","..obbwww","...odddd","....oooo","........","........"]},
  bunny:{a:"#e88aa0",r:["...oo...","..obpo..","..obpo..","..obpo..","..obbooo",".olbbbbb",".obbbbbb",".obbhebb",".obbeebb",".opbbbba",".obbbbnb","..obbbbb","...odddd","....oooo","........","........"]},
};
const COLORS=["#e2a440","#e2814a","#df6f86","#9a87ea","#6a8cf0","#4fb0c4","#55b884","#9198a8"];
const hx=h=>{if(h.length===4)h="#"+[...h.slice(1)].map(c=>c+c).join("");return[1,3,5].map(i=>parseInt(h.slice(i,i+2),16))};
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return"#"+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,"0")).join("")};
const rgba=(h,a)=>{const[r,g,b]=hx(h);return`rgba(${r},${g},${b},${a})`};

function head(kind,color,size){
  const m=HEADS[kind];const P={o:mix(color,"#000",.55),b:color,l:mix(color,"#fff",.35),d:mix(color,"#000",.18),w:"#f2f2f2",e:"#0e0e10",h:"#f2f2f2",p:"#e88aa0",n:mix(color,"#000",.62),a:m.a};
  let s="";m.r.forEach((row,y)=>{const f=row+[...row].reverse().join("");[...f].forEach((c,x)=>{if(c!==".")s+=`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${P[c]}"/>`})});
  return `<svg class="px" width="${size}" height="${size}" viewBox="0 0 16 16">${s}</svg>`;
}
const BAYER=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]].map(r=>r.map(v=>(v+.5)/16));
function rng(seed){let h=2166136261;for(const c of seed)h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h=Math.imul(h^(h>>>15),2246822507);h=Math.imul(h^(h>>>13),3266489909);return((h^=h>>>16)>>>0)/4294967296}}
/* A field of soft light, ordered-dithered into a few tones of one colour. */
function dither(canvas,color,seed,{cols=160,rows=40,tones,light=1}={}){
  const r=rng(seed);canvas.width=cols;canvas.height=rows;const g=canvas.getContext("2d");
  const T=tones||[mix(color,"#000",.82),mix(color,"#000",.6),mix(color,"#000",.32),color,mix(color,"#fff",.28)];
  const blobs=Array.from({length:4},()=>({x:r(),y:r()*1.1-.05,s:.18+r()*.35,w:.4+r()*.6}));
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const u=x/cols,v=y/rows;let l=.18+.32*u-.2*v;
    for(const b of blobs){const d=Math.hypot((u-b.x)*cols/rows*.35,v-b.y)/b.s;l+=b.w*Math.max(0,1-d)*light}
    l=Math.min(.999,Math.max(0,l))*(T.length-1);const base=Math.floor(l);const st=(l-base)>BAYER[y%4][x%4]?1:0;
    g.fillStyle=T[Math.min(T.length-1,base+st)];g.fillRect(x,y,1,1);
  }
  canvas.classList.add("pix");return canvas;
}
let uid=0;
function tileHTML(a,size){
  const id="t"+(uid++);
  queueMicrotask(()=>{const c=document.getElementById(id);if(c)dither(c,a.color,a.id+":tile",{cols:12,rows:12,tones:[mix(a.color,"#000",.62),mix(a.color,"#000",.44),mix(a.color,"#000",.26),mix(a.color,"#000",.1)],light:.9})});
  const rad=Math.max(5,Math.round(size*.27));
  return `<span style="position:relative;display:inline-block;flex:none;width:${size}px;height:${size}px;border-radius:${rad}px;overflow:hidden;box-shadow:inset 0 0 0 1px ${rgba(a.color,.28)}"><canvas id="${id}" style="position:absolute;inset:0;width:100%;height:100%"></canvas><span style="position:absolute;inset:0;display:grid;place-items:center">${head(a.kind,mix(a.color,"#fff",.42),Math.round(size*.78))}</span></span>`;
}

/* Interface glyphs are Lucide, the set the app itself ships, so the mockup maps one to one. */
function ic(n,s=15,color="currentColor",w=1.75){
  return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[n]||LUCIDE.dot}</svg>`;
}
/* A brand mark on a paper tile, the way an app icon sits on a shelf. */
function brand(slug,size=28,{bare=false}={}){
  const b=BRANDS[slug];const g=Math.round(size*(bare?1:.56));
  const svg=b?`<svg width="${g}" height="${g}" viewBox="0 0 24 24"><path fill="${bare?"currentColor":b.hex}" d="${b.d}"/></svg>`:ic("app",g,"#3a3a38",1.6);
  if(bare)return svg;
  return `<span class="brand" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*.28)}px">${svg}</span>`;
}
function cliMark(n,s=15){
  if(n==="Claude")return`<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="flex:none"><path fill="${BRANDS.claude.hex}" d="${BRANDS.claude.d}"/></svg>`;
  if(n==="Codex")return`<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="flex:none"><path fill="#ecebe7" d="${BRANDS.openai.d}"/></svg>`;
  return`<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="flex:none"><rect x="4.5" y="3.5" width="15" height="17" rx="1.5" fill="none" stroke="#ecebe7" stroke-width="2"/><rect x="8.5" y="9" width="7" height="7.5" rx=".5" fill="#ecebe7" opacity=".45"/></svg>`;
}

/* ───────── data ───────── */
const WORKSPACES=[
  {name:"Hyze Cloud",mark:"H",color:"#6a8cf0",agents:["atlas","ada","mila","hugo","leo"],channels:["launch","infra-alerts","general"],ctx:"Hyze Cloud vende VMs sandbox por hora para agentes de IA. Stack: Rust, Firecracker, Next.js. Clientes são devs e startups no Brasil e LatAm.",members:[]},
  {name:"HyzeVM",mark:"V",color:"#55b884",agents:["vex","nox"],channels:["pool","security"],ctx:"",members:[]},
  {name:"Pessoal",mark:"G",color:"#e2a440",agents:["bia"],channels:[],ctx:"",members:[]},
];
const AG={
  atlas:{id:"atlas",name:"Atlas",role:"Strategy",kind:"owl",color:"#9a87ea",cli:"Claude",model:"Sonnet 5.5",effort:"Medium",dir:"hyze-cloud",line:"Fechei a análise de preço do plano Pro.",when:"21:14",perm:"auto"},
  ada:{id:"ada",name:"Ada",role:"Dev",kind:"fox",color:"#e2814a",cli:"Claude",model:"Opus 5.5",effort:"High",dir:"api-node",line:"Running pnpm test --filter api",live:true,when:"now",perm:"auto"},
  mila:{id:"mila",name:"Mila",role:"Marketing",kind:"bunny",color:"#df6f86",cli:"Codex",model:"GPT-6.1",effort:"Medium",dir:"site",line:"Can I publish the launch thread?",ask:true,when:"21:02",perm:"manual"},
  hugo:{id:"hugo",name:"Hugo",role:"Research",kind:"frog",color:"#55b884",cli:"OpenCode",model:"Muse 1.3",effort:"Medium",dir:"research",line:"3 sources on usage-based billing.",when:"18:40",unread:true,perm:"plan"},
  leo:{id:"leo",name:"Leo",role:"Content",kind:"ghost",color:"#4fb0c4",cli:"Claude",model:"Haiku 5.5",effort:"Low",dir:"blog",line:"Draft is in Drive: “Sandbox VMs”.",when:"Tue",perm:"auto"},
  vex:{id:"vex",name:"Vex",role:"Infra",kind:"bear",color:"#9198a8",cli:"Codex",model:"GPT-6.1",effort:"Medium",dir:"hyzevm",line:"Firecracker pool is at 72%.",when:"20:51",perm:"auto"},
  nox:{id:"nox",name:"Nox",role:"Security",kind:"cat",color:"#6a8cf0",cli:"Claude",model:"Sonnet 5.5",effort:"High",dir:"hyzevm",line:"No new CVEs in the base image.",when:"Mon",perm:"manual"},
  bia:{id:"bia",name:"Bia",role:"Life admin",kind:"sun",color:"#e2a440",cli:"Claude",model:"Haiku 5.5",effort:"Low",dir:"~",line:"Lembrete: renovar o domínio.",when:"Sun",perm:"plan"},
};
const MODELS={Claude:["Opus 5.5","Sonnet 5.5","Haiku 5.5"],Codex:["GPT-6.1","GPT-6.1 mini"],OpenCode:["Muse 1.3","Qwen 4 Coder","Kimi K3"]};
const CH={
  launch:{name:"launch",purpose:"Lançamento do plano Pro em 30/10: anúncio, blog e página de preço.",members:["atlas","mila","leo"],lead:"mila",unread:true},
  "infra-alerts":{name:"infra-alerts",purpose:"Alertas do pool e do billing. Ada e Atlas respondem.",members:["ada","atlas"],lead:"ada"},
  general:{name:"general",purpose:"Tudo que não tem lugar.",members:["atlas","ada","mila","hugo","leo"],lead:"atlas"},
  pool:{name:"pool",purpose:"Capacidade das VMs.",members:["vex"],lead:"vex"},
  security:{name:"security",purpose:"CVEs e auditoria.",members:["nox","vex"],lead:"nox"},
};
const ME={name:"Gabriel",kind:"bear",color:"#e2a440",status:"Available",photo:null,calls:"Gabriel — fundador da Hyze Cloud"};
const STATUS={Available:"var(--green)",Focus:"var(--amber)",Away:"var(--ink4)"};
const PERM={plan:["Plan","Reads and plans, changes nothing",0],manual:["Ask first","Asks before it edits or runs anything",1],auto:["Auto","Asks only for risky actions",2],bypass:["Full access","Never asks",3]};
const ORDER=["plan","manual","auto","bypass"];
const S={ws:0,agent:"atlas",view:"chat",ptab:"overview",channel:"launch",menu:false,overlay:null,settings:"profile",note:0,mtag:"all",mq:"",afilter:"all",inbox:"i1",ifilter:"all",rfilter:"all",ptype:"connected",pq:"",cleared:4};
const CHATS={};
const EMOJI=["👍","❤️","😂","🎉","🙏","👀","✅","🔥","🤔","💯","🚀","😅"];
const now=()=>"21:"+String(15+Math.floor((Date.now()/60000)%40)).padStart(2,"0");
const esc=s=>s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const wsAgents=()=>WORKSPACES[S.ws].agents.map(k=>AG[k]);

/* ───────── interaction layer: toast, popover, drawer, dialog ───────── */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
function toast(msg,{action,onAction,icon,ms=3400}={}){
  const t=document.createElement("div");t.className="toast"+(action?"":" plain");
  t.innerHTML=`${icon?ic(icon,13):""}<span>${msg}</span>${action?`<button>${action}</button>`:""}`;
  toasts.appendChild(t);
  if(action)t.querySelector("button").onclick=e=>{e.stopPropagation();onAction?.();t.remove()};
  setTimeout(()=>t.remove(),ms);
}
let popEl=null,popFresh=false;
function closePop(){popEl?.remove();popEl=null}
function pop(anchor,html,{place="below",align="left",cls=""}={}){
  closePop();const p=document.createElement("div");p.className="pop "+cls;p.innerHTML=html;document.body.appendChild(p);
  const r=anchor.getBoundingClientRect(),pr=p.getBoundingClientRect();
  let x=align==="right"?r.right-pr.width:r.left;let y=place==="above"?r.top-pr.height-6:r.bottom+6;
  if(y+pr.height>innerHeight-8)y=r.top-pr.height-6;
  p.style.left=Math.max(8,Math.min(x,innerWidth-pr.width-8))+"px";p.style.top=Math.max(8,y)+"px";
  popEl=p;popFresh=true;return p;
}
/* items: [icon,label,fn,extra] | "hr" | "#Label" — extra: {red,s,chk,html} */
function menu(anchor,items,opts){
  const p=pop(anchor,items.map((it,i)=>it==="hr"?"<hr>":typeof it==="string"?`<div class="lbl">${it.slice(1)}</div>`:
    `<div class="it ${it[3]?.red?"red":""}" data-i="${i}">${it[3]?.html||(it[0]?ic(it[0],15):"")}<span>${it[1]}</span>${it[3]?.s?`<span class="s">${it[3].s}</span>`:""}${it[3]?.chk?`<span class="chk">${ic("check",14)}</span>`:""}</div>`).join(""),opts);
  $$(".it",p).forEach(el=>el.onclick=()=>{closePop();items[+el.dataset.i][2]?.()});
  return p;
}
function emojiPop(anchor,fn,opts){
  const p=pop(anchor,`<div class="emojis">${EMOJI.map(e=>`<button>${e}</button>`).join("")}</div>`,opts);
  $$("button",p).forEach(b=>b.onclick=()=>{closePop();fn(b.textContent)});
}
let drawerEl=null;
function closeDrawer(){drawerEl?.remove();drawerEl=null}
/* One panel, two homes: docked right for something you read beside the chat,
   centered (and expandable to the whole window) for something you configure. */
function drawer({title,sub="",icon="",body,foot="",width=540,center=false,bare=false}){
  closeDrawer();const v=document.createElement("div");v.className="drawerv"+(center?" center":"");
  const btns=`${center?`<button class="ibtn" data-full title="Full screen" style="margin-left:auto">${ic("expand",14)}</button>`:""}<button class="ibtn x" data-x title="Close">${ic("x",15)}</button>`;
  /* bare: the body brings its own banner and title, so the header would only repeat them */
  if(bare)v.innerHTML=`<div class="drawer" style="${center?`--w:${width}px`:`width:${width}px`}"><div class="dfloat">${btns}</div><div class="dbd">${body}</div>${foot?`<div class="dft">${foot}</div>`:""}</div>`;
  else v.innerHTML=`<div class="drawer" style="${center?`--w:${width}px`:`width:${width}px`}"><div class="dh">${icon}<div style="min-width:0"><b>${title}</b>${sub?`<div class="s">${sub}</div>`:""}</div>${center?`<button class="ibtn" data-full title="Full screen" style="margin-left:auto">${ic("expand",14)}</button>`:""}<button class="ibtn x" data-x title="Close">${ic("x",15)}</button></div><div class="dbd">${body}</div>${foot?`<div class="dft">${foot}</div>`:""}</div>`;
  document.body.appendChild(v);drawerEl=v;
  v.onclick=e=>{if(e.target===v)closeDrawer()};$("[data-x]",v).onclick=closeDrawer;
  const f=$("[data-full]",v);if(f)f.onclick=()=>{v.classList.toggle("full");f.title=v.classList.contains("full")?"Exit full screen":"Full screen"};
  return $(".drawer",v);
}
let modalEl=null;
function closeModal(){modalEl?.remove();modalEl=null}
function modal(html,{width=470}={}){
  closeModal();const v=document.createElement("div");v.className="veil";v.style.zIndex=70;
  v.innerHTML=`<div class="mdl" style="width:${width}px">${html}</div>`;document.body.appendChild(v);modalEl=v;
  v.onclick=e=>{if(e.target===v)closeModal()};$$("[data-x]",v).forEach(b=>b.onclick=closeModal);
  setTimeout(()=>$("input,textarea",v)?.focus(),0);
  return $(".mdl",v);
}
function confirmBox(title,text,ok,fn,{danger=true,type}={}){
  const m=modal(`<div><h2>${title}</h2><div class="lead">${text}</div></div>
    ${type?`<div><div class="fl">Type “${type}” to confirm</div><input class="input" data-type></div>`:""}
    <div class="foot"><button class="btn" data-x>Cancel</button><button class="btn ${danger?"bad":"solid"}" data-ok ${type?"disabled style='opacity:.4'":""}>${ok}</button></div>`);
  const okb=$("[data-ok]",m);
  if(type)$("[data-type]",m).oninput=e=>{const good=e.target.value===type;okb.disabled=!good;okb.style.opacity=good?1:.4};
  okb.onclick=()=>{if(okb.disabled)return;closeModal();fn()};
}
function pickFile(accept,cb){const i=document.createElement("input");i.type="file";i.accept=accept;i.onchange=()=>{const f=i.files[0];if(f)cb(f)};i.click()}
function readImage(f,cb){const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(f)}
const kb=b=>b<1024?b+" B":b<1048576?(b/1024).toFixed(1)+" KB":(b/1048576).toFixed(1)+" MB";
/* A fake process with a visible clock: the mockup's stand-in for anything that takes time. */
function progress(btn,label,ms,done){
  const old=btn.innerHTML;btn.disabled=true;btn.innerHTML=`<span class="spin" style="--tint:currentColor"><i></i><i></i><i></i><i></i></span>${label}`;
  setTimeout(()=>{btn.disabled=false;btn.innerHTML=old;done?.()},ms);
}

function meTile(s){
  if(ME.photo)return`<span style="display:inline-block;flex:none;width:${s}px;height:${s}px;border-radius:${Math.max(5,Math.round(s*.27))}px;background:url(${ME.photo}) center/cover"></span>`;
  return tileHTML({id:"me"+ME.kind+ME.color,kind:ME.kind,color:ME.color},s);
}
function logoHTML(w,size){
  const rad=Math.round(size*.26);
  if(w.photo)return`<span style="display:inline-block;flex:none;width:${size}px;height:${size}px;border-radius:${rad}px;background:url(${w.photo}) center/cover"></span>`;
  const id="l"+(uid++);
  queueMicrotask(()=>{const c=document.getElementById(id);if(c)dither(c,w.color,w.name,{cols:10,rows:10,tones:[mix(w.color,"#000",.55),mix(w.color,"#000",.3),w.color,mix(w.color,"#fff",.3)],light:1.1})});
  const fs=Math.round(size*(w.mark.length>1?.32:.46));
  return `<span style="position:relative;display:inline-block;flex:none;width:${size}px;height:${size}px;border-radius:${rad}px;overflow:hidden"><canvas id="${id}" style="position:absolute;inset:0;width:100%;height:100%"></canvas><span style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--pix);font-size:${fs}px;color:#fff;text-shadow:0 1px 0 #0006">${w.mark}</span></span>`;
}
function bandHTML(color,seed,h){
  const id="b"+(uid++);
  queueMicrotask(()=>{const c=document.getElementById(id);if(c)dither(c,color,seed,{cols:120,rows:Math.round(h/4),light:.8})});
  return `<canvas id="${id}"></canvas>`;
}
