/* ui: the component set. Every screen builds from these, so a button, a row or a toggle looks and acts the same
   wherever it appears; SCREENS → Components shows each one with its variants. Each returns an HTML string.
   `a` is extra attributes ({"data-id":"x"}); true writes a bare attribute, false or null skips it. */
const attrs=o=>Object.entries(o||{}).filter(([,v])=>v!=null&&v!==false).map(([k,v])=>v===true?k:`${k}="${esc(v)}"`).join(" ");
const act=(name,a)=>attrs({"data-act":name,...a});

/* Btn — kind: "" | primary | danger | bad (red text) | ghost; size: "" | sm */
const Btn=(label,{act:x,icon,kind="",size="",off,id,title,cls="",a}={})=>
  `<button class="btn ${kind} ${size} ${cls} ${off?"off":""}" ${act(x,{id,title,...a})}>${icon?ic(icon,size==="sm"?14:15):""}${label}</button>`;
/* IconBtn — kind: "" (quiet) | fill | glass; size: "" | sm; round makes it a circle */
const IconBtn=(icon,{act:x,title,kind="",size="",badge,id,on,cls="",a}={})=>
  `<button class="ibtn ${kind} ${size} ${cls} ${on?"on":""}" ${act(x,{title,id,...a})}>${ic(icon,size==="sm"?15:18)}${badge!==undefined?`<span class="badge ${badge?"":"hide"}">${badge||""}</span>`:""}</button>`;
const Pill=(label,{act:x,on,count,a}={})=>`<button class="pill ${on?"on":""}" ${act(x,a)}>${label}${count?`<i>${count}</i>`:""}</button>`;
/* Tabs — items [[key,label]]; the chosen one wears the pill */
const Tabs=(items,cur,{act:x,key="t",cls="",a}={})=>
  `<div class="tabs ${cls}" ${attrs(a)}>${items.map(([k,n])=>`<button class="${k===cur?"on":""}" ${act(x,{["data-"+key]:k})}>${n}</button>`).join("")}</div>`;
/* Toggle — a named action (data-act + data-id) or a preference key (data-k, handled by TOG in settings.js) */
const Toggle=(on,{act:x,id,k}={})=>`<span class="tog ${on?"on":""}" ${attrs({"data-act":x,"data-id":id,"data-k":k})} role="switch" aria-checked="${!!on}"></span>`;
/* Select — a value that opens a menu; inside a Row use Down() and put the action on the row */
const Select=(value,{act:x,a,cls=""}={})=>`<button class="sel ${cls}" ${act(x,a)}>${value}${ic("down",14)}</button>`;
/* Seg — a small three-way choice (Allow · Ask · Off) */
const Seg=(opts,cur,{act:x,a}={})=>`<span class="perm3">${opts.map(([v,n])=>`<button class="${v===cur?"on":""}" ${act(x,{...a,"data-v":v})}>${n}</button>`).join("")}</span>`;
const Stepper=(act_,{a}={})=>`<span class="stepper">${IconBtn("minus",{act:act_,size:"sm",a:{...a,"data-v":"-5"}})}${IconBtn("plus",{act:act_,size:"sm",a:{...a,"data-v":"5"}})}</span>`;

/* Group of Rows. icon draws a tile; lead takes any HTML (a face, a brand); right takes a Val or a control */
const Group=(inner,{cls="",id}={})=>`<div class="grp ${cls}" ${attrs({id})}>${inner}</div>`;
function Row({icon,lead,title,sub,right,act:x,id,k,red,cls="",a,tag="button"}={}){
  const inner=`${icon?`<span class="ico">${ic(icon,17)}</span>`:lead||""}<span class="tx"><b ${red?'class="red"':""}>${title}</b>${sub?`<span>${sub}</span>`:""}</span>${right!==undefined&&right!==""?`<span class="rt">${right}</span>`:""}`;
  return x?`<${tag} class="row hv ${cls}" ${act(x,{"data-id":id,"data-k":k,...a})} ${tag==="button"?"":'role="button"'}>${inner}</${tag}>`:`<div class="row ${cls}" ${attrs(a)}>${inner}</div>`;
}
/* the value on a row's right: plain, a dropdown (Down) or a page behind it (Next) */
const Val=(text,kind)=>`<span class="val">${text}${kind==="down"?ic("down",15):kind==="next"?ic("chev",15):""}</span>`;
const Next=(text="")=>Val(text,"next");
const Down=text=>Val(text,"down");
/* a heading over a group: count, and one action on the right */
const Section=(title,{count,action,actionAct,a,cls=""}={})=>
  `<div class="sec ${cls}"><b>${title}</b>${count!==undefined?`<i>${count}</i>`:""}${action?`<button class="sec-a" ${act(actionAct,a)}>${action}</button>`:""}</div>`;

const Chip=(label,{icon,html,dot,act:x,a}={})=>
  `<${x?"button":"span"} class="chip ${dot?"d-"+dot:""}" ${act(x,a)}>${dot?"<i></i>":""}${html||(icon?ic(icon,15):"")}${label}</${x?"button":"span"}>`;
const Dot=c=>`<i class="sdot" style="background:${c}"></i>`;
const Field=({in:k,value="",placeholder="",type="text",mono,autofocus,id,area,rows=3,style,a}={})=>area
  ?`<textarea class="field ${mono?"mono":""}" rows="${rows}" ${attrs({"data-in":k,placeholder,autofocus,id,style,...a})}>${esc(value)}</textarea>`
  :`<input class="field ${mono?"mono":""}" ${attrs({type,"data-in":k,value,placeholder,autofocus,id,style,...a})}>`;
const Search=({in:k,placeholder="Search",value="",cls="",a}={})=>`<label class="search ${cls}">${ic("search",16)}<input ${attrs({"data-in":k,placeholder,value,...a})}></label>`;
const Label=t=>`<div class="flab">${t}</div>`;
const Hint=t=>`<p class="hint">${t}</p>`;
const Empty=(text,{mascot:m,action}={})=>`<div class="empty">${m||""}<p>${text}</p>${action||""}</div>`;
const Kbd=k=>`<span class="kbd">${k}</span>`;
const Avatar=(s=40,{dot}={})=>`<span class="avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.34)}px;${ME.photo?`background-image:url(${ME.photo})`:""}">${ME.photo?"":ME.initials}${dot?`<i style="background:${dot}"></i>`:""}</span>`;

/* modal chrome */
const Head=(title,{lead="",right="",close=true}={})=>`<div class="mh">${lead}<h2>${title}</h2>${right}${close?IconBtn("x",{act:"close-veil",title:"Close",size:"sm"}):""}</div>`;
const Foot=(...b)=>`<div class="mf">${b.join("")}</div>`;
const Body=(inner,{id,cls=""}={})=>`<div class="mb ${cls}" ${attrs({id})}>${inner}</div>`;

/* identity: a channel is its lead's colour with a #, the lead's face in the corner */
const HashTile=(c,s=40)=>`<span class="hash" style="--c:${AG[c.lead].color};width:${s}px;height:${s}px;border-radius:${Math.round(s*.3)}px"><span class="g" style="font-size:${Math.round(s*.42)}px">#</span><span class="f2">${face(AG[c.lead],Math.round(s*.42))}</span></span>`;
const Lead=(id,s=40)=>isCh(id)?HashTile(CH[id],s):face(AG[id],s);
/* a file or PR inside the chat */
const Attach=({icon,title,sub,act:x,id})=>`<div class="attach" ${act(x,{"data-id":id})}><span class="fi">${ic(icon,18)}</span><div><b>${esc(title)}</b><span>${sub}</span></div>${ic("ext",15)}</div>`;
const Spark=(seed,c)=>{const r=rng(seed);return `<span class="spark" style="--c:${c}">${Array.from({length:14},()=>`<i style="height:${3+Math.round(r()*13)}px"></i>`).join("")}</span>`};

/* Card: the one frame for everything rich an agent posts. A quiet header line, a body, an optional footer of actions */
const Card=({icon,label,right="",body="",foot="",id,cls="",a}={})=>
  `<div class="card ${cls}" ${attrs({"data-id":id,...a})}>${label?`<div class="ch">${icon?ic(icon,14):""}<span>${label}</span>${right?`<span class="r">${right}</span>`:""}</div>`:""}<div class="cb">${body}</div>${foot?`<div class="cf">${foot}</div>`:""}</div>`;
/* a choice in a question: the number key that picks it, the answer, an optional note */
const Choice=(n,label,{act:x,note,a}={})=>`<button class="choice" ${act(x,a)}><span class="k">${n}</span>${label}${note?`<span>${note}</span>`:""}</button>`;

/* ───────── banners: our pixel fields. One colour, ordered-dithered into five tones, seeded so a thing keeps its banner ───────── */
const BAYER=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]].map(r=>r.map(v=>(v+.5)/16));
function rng(seed){let h=2166136261;for(const c of String(seed))h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h=Math.imul(h^(h>>>15),2246822507);h=Math.imul(h^(h>>>13),3266489909);return((h^=h>>>16)>>>0)/4294967296}}
function dither(canvas,color,seed,{cols=140,rows=34,light=1}={}){
  const r=rng(seed);canvas.width=cols;canvas.height=rows;const g=canvas.getContext("2d");
  /* mix() reads six-digit hex only, so black and white are spelled out */
  const T=[mix(color,"#000000",.84),mix(color,"#000000",.64),mix(color,"#000000",.38),color,mix(color,"#ffffff",.3)];
  const blobs=Array.from({length:4},()=>({x:r(),y:r()*1.1-.05,s:.18+r()*.35,w:.4+r()*.6}));
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const u=x/cols,v=y/rows;let l=.16+.3*u-.2*v;
    for(const b of blobs){const d=Math.hypot((u-b.x)*cols/rows*.35,v-b.y)/b.s;l+=b.w*Math.max(0,1-d)*light}
    l=Math.min(.999,Math.max(0,l))*(T.length-1);const base=Math.floor(l);const st=(l-base)>BAYER[y%4][x%4]?1:0;
    g.fillStyle=T[Math.min(T.length-1,base+st)];g.fillRect(x,y,1,1);
  }
}
/* the canvas is drawn right after the markup lands, so a banner can live inside any template string */
const Banner=(color,seed,{cls="",style="",cols,rows,light}={})=>{
  const id="bn"+(++uid);
  queueMicrotask(()=>{const c=document.getElementById(id);if(c)dither(c,color,seed,{cols,rows,light})});
  return `<div class="ban ${cls}" style="${style}"><canvas id="${id}"></canvas></div>`;
};

/* ───────── the gallery: every component and variant on one sheet ───────── */
function openComponents(){
  closePop();closeAllVeils();
  const demo=(n,html)=>`<div class="gal"><div class="gal-n">${n}</div><div class="gal-b">${html}</div></div>`;
  veil(`${Head("Components")}${Body(
    `<div style="border-radius:var(--r3);overflow:hidden;margin-bottom:6px">${Banner("#a58bfa","gallery",{style:"height:110px"})}</div>`+
    demo("Btn",`${Btn("Default")}${Btn("Primary",{kind:"primary"})}${Btn("Delete",{kind:"danger"})}${Btn("Disconnect",{kind:"bad"})}${Btn("Ghost",{kind:"ghost"})}${Btn("Line",{kind:"line"})}${Btn("New",{icon:"plus"})}${Btn("Small",{size:"sm"})}${Btn("Off",{off:true})}`)+
    demo("IconBtn",`${IconBtn("search")}${IconBtn("plus",{kind:"fill"})}${IconBtn("hand",{badge:3})}${IconBtn("x",{size:"sm"})}${IconBtn("phone")}`)+
    demo("Pill",`${Pill("All",{on:true})}${Pill("Unread",{count:2})}${Pill("Channels")}${Pill("Agents")}`)+
    demo("Tabs",Tabs([["a","Details"],["b","Library"],["c","Computer"]],"a"))+
    demo("Select · Seg",`${Select("Claude Code")}${Select("Every day")}${Seg([["allow","Allow"],["ask","Ask"],["off","Off"]],"ask")}`)+demo("Card",`<div style="width:100%">${Card({icon:"q",label:"Atlas asks",body:`<p class="t">Which annual price should the page show?</p><div class="choices">${Choice(1,"$290 / year",{note:"better margin"})}${Choice(2,"$278 / year")}</div>`})}</div>`)+
    demo("Toggle · Stepper",`${Toggle(true)}${Toggle(false)}${Stepper()}`)+
    demo("Chip",`${Chip("Claude Code",{html:cliMark("Claude",15)})}${Chip("Free",{dot:"go"})}${Chip("Waiting for you",{dot:"warn"})}${Chip("3 agents",{icon:"people"})}`)+
    demo("Field · Search",`<div style="display:grid;gap:8px;width:100%">${Field({placeholder:"Agent name"})}${Search({placeholder:"Search skills"})}</div>`)+
    demo("Section · Group · Row",`<div style="width:100%">${Section("How it works",{count:3,action:"Edit"})}${Group(Row({icon:"cpu",title:"Engine",right:Down("Claude Code")})+Row({icon:"doc",title:"Instructions",sub:"Strategy agent for Hyze Cloud",right:Next()})+Row({icon:"pause",title:"Pause Atlas",sub:"What it's doing finishes, the rest waits.",right:Toggle(false)}))}${Section("Account",{cls:"mt"})}${Group(Row({title:"Export everything",sub:"Chats, agents and files, in one folder.",right:Btn("Export…")})+Row({title:"Delete my account",sub:"Your agents and chats are erased.",right:Btn("Delete",{kind:"danger"})}))}</div>`)+
    demo("Identity",`${face(AG.atlas,44)}${face(AG.mila,44)}${face(AG.ada,44)}${HashTile(CH["#launch"],44)}${Avatar(44,{dot:"var(--green)"})}`)+
    demo("Attach",`<div style="display:grid;gap:6px;width:100%">${Attach({icon:"doc",title:"pricing-analysis.md",sub:"Document · 4.2 KB"})}${Attach({icon:"pr",title:"Pricing page: Pro plan copy",sub:"site #311 · +44 −12"})}</div>`)+
    demo("Empty",Empty("You're all caught up.",{mascot:mascot("cloud","#a58bfa",52,{asleep:true})}))
  )}`,{width:760,cls:"galm"});
}
