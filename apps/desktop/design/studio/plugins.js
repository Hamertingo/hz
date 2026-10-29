/* ───────── plugins ───────── */
const PLUGINS=[
  {id:"github",slug:"github",name:"GitHub",mark:"GH",color:"#8957e5",cat:"Code",d:"Pull requests, issues, reviews and comments.",on:true,used:["ada","atlas"],calls:342,tools:[["list_pull_requests","allow"],["create_pull_request","allow"],["comment","allow"],["merge","ask"]]},
  {id:"linear",slug:"linear",name:"Linear",mark:"L",color:"#5e6ad2",cat:"Work",d:"Read and update issues, cycles and projects.",on:true,used:["ada","mila"],calls:88,tools:[["search_issues","allow"],["update_issue","allow"],["delete_issue","off"]]},
  {id:"postgres",slug:"postgresql",name:"Postgres",mark:"PG",color:"#4f7be8",cat:"Data",d:"Read-only queries against the production replica.",on:true,used:["atlas"],calls:51,tools:[["query","allow"]]},
  {id:"stripe",slug:"stripe",name:"Stripe",mark:"S",color:"#635bff",cat:"Data",d:"Revenue, customers and disputes. Read only.",on:true,used:["atlas"],calls:19,tools:[["list_charges","allow"],["list_disputes","allow"],["refund","off"]]},
  {id:"browser",slug:null,name:"Browser",mark:"WW",color:"#4fb0c4",cat:"Work",d:"A real browser each agent can drive, with take-over.",on:true,used:["leo","mila","hugo"],calls:410,tools:[["open","allow"],["click","allow"],["fill","ask"]]},
  {id:"slack",slug:"slack",name:"Slack",mark:"SL",color:"#e01e5a",cat:"Talk",d:"Let agents read and answer in your Slack channels.",on:false,used:[],calls:0,tools:[["read_channel","allow"],["post_message","ask"]]},
  {id:"drive",slug:"googledrive",name:"Google Drive",mark:"D",color:"#1fa463",cat:"Work",d:"Read and save documents and sheets.",on:false,used:[],calls:0,tools:[["search","allow"],["read","allow"],["save","ask"]]},
  {id:"figma",slug:"figma",name:"Figma",mark:"F",color:"#f24e1e",cat:"Work",d:"Read frames and comments from your files.",on:false,used:[],calls:0,tools:[["get_file","allow"],["comment","ask"]]},
  {id:"notion",slug:"notion",name:"Notion",mark:"N",color:"#e2a440",cat:"Work",d:"Pages and databases as agent memory you can read.",on:false,used:[],calls:0,tools:[["search","allow"],["update_page","ask"]]},
  {id:"sentry",slug:"sentry",name:"Sentry",mark:"SE",color:"#7c5cd6",cat:"Code",d:"Errors and releases, with stack traces.",on:false,used:[],calls:0,tools:[["list_issues","allow"],["resolve","ask"]]},
  {id:"vercel",slug:"vercel",name:"Vercel",mark:"V",color:"#38a3f1",cat:"Code",d:"Deploys, logs and preview links.",on:false,used:[],calls:0,tools:[["list_deploys","allow"],["promote","ask"]]},
  {id:"supabase",slug:"supabase",name:"Supabase",mark:"SB",color:"#3ecf8e",cat:"Data",d:"Tables, auth and storage for your project.",on:false,used:[],calls:0,tools:[["select","allow"],["insert","ask"]]},
  {id:"gmail",slug:"gmail",name:"Gmail",mark:"G",color:"#ea4335",cat:"Talk",d:"Read threads and draft replies. Sending asks you.",on:false,used:[],calls:0,tools:[["search","allow"],["draft","allow"],["send","ask"]]},
  {id:"calendar",slug:"googlecalendar",name:"Google Calendar",mark:"C",color:"#4285f4",cat:"Talk",d:"Find free time and draft invites.",on:false,used:[],calls:0,tools:[["free_busy","allow"],["create_event","ask"]]},
];
const SKILLS=[
  {id:"s1",name:"Pricing analysis",by:"atlas",used:["atlas"],md:"---\nname: pricing-analysis\ndescription: How to model a price change\n---\n\n1. Start from cost per VM-hour.\n2. Model the median and the p90 user.\n3. Show margin at each.\n4. End with one recommendation and its risk."},
  {id:"s2",name:"Release notes",by:"leo",used:["leo","mila"],md:"---\nname: release-notes\ndescription: Merged PRs into a changelog in our voice\n---\n\nGroup by what the reader feels, not by repo.\nOne line each. No emoji. Link the PR."},
  {id:"s3",name:"Billing review",by:"ada",used:["ada"],md:"---\nname: billing-review\ndescription: Checklist for PRs that touch billing\n---\n\n- Rounding: per minute, never per hour.\n- Every price change has a migration.\n- A test for the partial minute."},
];
const P=id=>PLUGINS.find(p=>p.id===id);
/* A plugin's face: its real mark when it has one, a glyph for ours, initials for a server you added. */
function pmark(p,n=28){
  if(p.slug)return brand(p.slug,n);
  const inner=p.id==="browser"?ic("app",Math.round(n*.56),"#2f2f2d",1.8):`<span style="font-size:${Math.round(n*.36)}px;font-weight:650;color:#2f2f2d">${p.mark}</span>`;
  return `<span class="brand" style="width:${n}px;height:${n}px;border-radius:${Math.round(n*.28)}px">${inner}</span>`;
}
const match=p=>!S.pq||p.name.toLowerCase().includes(S.pq.toLowerCase());
function renderPlugins(){
  const conn=PLUGINS.filter(p=>p.on);const cat=PLUGINS.filter(p=>!p.on);
  const top=$(".pagewrap")?.scrollTop||0;
  let body="";
  if(S.ptype==="connected"){
    const shown=conn.filter(match);
    body=`<div class="pcards">${shown.map(p=>`<div class="pc" data-act="popen" data-p="${p.id}">
        <div class="h">${pmark(p,40)}<div><b>${p.name}</b><div style="font-size:12px;color:var(--ink4);margin-top:1px">${p.tools.length} tools</div></div><span class="on"><i></i>Connected</span></div>
        <div class="d">${p.d}</div>
        <div class="pf">${p.used.length?`<span class="faces">${p.used.filter(k=>AG[k]).map(k=>`<span>${tileHTML(AG[k],18)}</span>`).join("")}</span><span>${p.calls} calls this week</span>`:"Nobody uses it yet"}<span class="spark">${Array.from({length:14},(_,i)=>`<i style="height:${2+Math.round(rng(p.id+i)()*12)}px"></i>`).join("")}</span></div></div>`).join("")}
      <div class="pc more" data-act="ptab" data-v="catalog"><div>${ic("plus",20)}<div style="margin-top:8px;font-weight:500">Browse ${cat.length} more</div><div style="font-size:12px;color:var(--ink4);margin-top:2px">Slack, Drive, Notion…</div></div></div></div>
      <div class="sech"><h3>Who can use what</h3><span>Click a square to give or take a plugin. It applies from the agent's next message.</span></div>
      ${matrixHTML(conn)}`;
  }else if(S.ptype==="catalog"){
    const f=P("slack");
    body=`${!f.on&&match(f)?`<div class="feat" style="--fc:${BRANDS.slack.hex}">${pmark(f,76)}
      <div class="fb"><span class="k">Featured</span><h2>Your agents, in Slack</h2><p>Mention @Atlas in any Slack channel and get the same agent, with the same memory, that you talk to here. Posting asks you first.</p><div><button class="btn solid" data-act="pconnect" data-p="slack">Connect Slack</button></div></div></div>`:""}
      ${["Talk","Work","Code","Data"].map(c=>{const items=cat.filter(p=>p.cat===c&&match(p)&&p.id!=="slack");return items.length?`<div class="sech"><h3>${c}</h3><span>${items.length}</span></div><div class="catgrid">${items.map(p=>`<div class="cat" data-act="pconnect" data-p="${p.id}"><div class="h">${pmark(p,36)}<b>${p.name}</b><button class="btn sm" data-act="pconnect" data-p="${p.id}">Connect</button></div><div class="d">${p.d}</div></div>`).join("")}</div>`:""}).join("")||`<div class="card" style="color:var(--ink3);text-align:center;padding:44px">Nothing in the catalog matches “${esc(S.pq)}”. <span class="lnk" data-act="addmcp">Add it as an MCP server</span></div>`}`;
  }else{
    body=`<div class="papers">${SKILLS.filter(match).map(s=>`<div class="paper" data-act="sopen" data-s="${s.id}"><div class="t">${ic("book",15)} ${s.name}</div><pre>${esc(s.md)}</pre>
        <div class="f">${AG[s.by]?tileHTML(AG[s.by],18):meTile(18)} by ${AG[s.by]?.name||ME.name}<span class="faces">${s.used.filter(k=>AG[k]).map(k=>`<span>${tileHTML(AG[k],18)}</span>`).join("")}</span></div></div>`).join("")}
      <div class="paper new" data-act="snew"><div style="text-align:center">${ic("plus",20)}<div style="margin-top:8px;font-weight:500">New skill</div><div style="font-size:12px;color:var(--ink4);margin-top:2px">A how-to any agent can follow</div></div></div></div>`;
  }
  main.innerHTML=`<div class="ptitlebar"><h1>${ic("plug",16)} Plugins</h1>
    <div class="subtabs" style="margin-left:14px">${[["connected","Connected",conn.length],["catalog","Catalog",cat.length],["skills","Skills",SKILLS.length]].map(([k,l,n])=>`<a class="${S.ptype===k?"on":""}" data-act="ptab" data-v="${k}">${l} <em>${n}</em></a>`).join("")}</div>
    <div class="acts"><div class="search" style="width:210px;height:30px">${ic("search",14)}<input data-pq placeholder="Search ${S.ptype}" value="${esc(S.pq)}" style="flex:1;min-width:0"></div>
      ${S.ptype==="skills"?`<button class="btn" data-act="snew">${ic("plus",14)} New skill</button>`:`<button class="btn" data-act="addmcp">${ic("plus",14)} Add MCP server</button>`}</div></div>
    <div class="pagewrap"><div class="pageinner" style="max-width:1040px">${body}</div></div>`;
  $(".pagewrap").scrollTop=top;
  const q=$("[data-pq]");q.oninput=()=>{S.pq=q.value;const pos=q.selectionStart;renderPlugins();const n=$("[data-pq]");n.focus();n.selectionStart=n.selectionEnd=pos};
  const mx=$(".matrix");
  if(mx){mx.onmouseover=e=>{const c=e.target.closest("[data-col]")?.dataset.col;$$(".colhl",mx).forEach(x=>x.classList.remove("colhl"));if(c!=null)$$(`[data-col="${c}"]`,mx).forEach(x=>x.classList.add("colhl"))};mx.onmouseleave=()=>$$(".colhl",mx).forEach(x=>x.classList.remove("colhl"))}
}
function matrixHTML(conn){
  const ags=wsAgents();const on=conn.reduce((n,p)=>n+ags.filter(a=>p.used.includes(a.id)).length,0);
  return `<div class="matrix"><table><thead><tr><th>Agent</th>${conn.map((p,i)=>`<th data-act="popen" data-p="${p.id}" data-col="${i}"><div class="lgw">${pmark(p,26)}<span>${p.name}</span></div></th>`).join("")}</tr></thead>
    <tbody>${ags.map(a=>`<tr><td data-act="openaccess" data-id="${a.id}"><div>${tileHTML(a,24)}${a.name}<em>${a.role}</em></div></td>${conn.map((p,i)=>`<td data-col="${i}"><span class="cell ${p.used.includes(a.id)?"on":""}" data-act="cell" data-p="${p.id}" data-a="${a.id}" style="--c:${a.color}" title="${a.name} · ${p.name}">${p.used.includes(a.id)?ic("check",12,"#111",3):""}</span></td>`).join("")}</tr>`).join("")}</tbody></table>
    <div class="mf">${ic("lock",13)} Tools that write still follow each agent's always-ask list.<span style="margin-left:auto" data-mcount>${on} of ${ags.length*conn.length} on</span></div></div>`;
}
function pluginDrawer(p){
  const d=drawer({title:p.name,width:880,center:true,bare:true,
    body:`<div class="pband">${bandHTML(p.color,p.id+":band",120)}<span class="lg">${pmark(p,76)}</span></div><div class="pdet" style="margin-top:52px"><div class="side2"><div><h2>${p.name}</h2><span class="on3"><i></i>${p.on?"Connected through OAuth":"Not connected"}</span></div><p>${p.d}</p>
        <div class="acct">${meTile(28)}<div style="min-width:0"><div>you@example.com</div><div class="s">Connected Oct 22</div></div></div>
        <button class="btn" data-act="reconnect">${ic("refresh",13)} Reconnect</button>
        <div class="facts"><div>Calls this week<b>${p.calls}</b></div><div>Tools<b>${p.tools.length}</b></div><div>Agents<b>${p.used.length}</b></div></div></div>
      <div>
        <h4>Tools<span class="r" style="color:var(--ink4)">Allow · Ask you first · Off</span></h4>
        ${p.tools.map(([n,v],i)=>`<div class="toolli"><code>${n}</code><span class="s"><span class="seg" data-seg="tool" data-p="${p.id}" data-i="${i}">${["allow","ask","off"].map(x=>`<button data-v="${x}" class="${x===v?"on":""}">${{allow:"Allow",ask:"Ask",off:"Off"}[x]}</button>`).join("")}</span></span></div>`).join("")}
        <h4>Which agents can use it</h4>${wsAgents().map(a=>`<div class="mrow">${tileHTML(a,28)}<div><div style="font-weight:500">${a.name}</div><div style="font-size:12px;color:var(--ink3)">${a.role}</div></div><span class="tog ${p.used.includes(a.id)?"on":""}" data-act="ptog" data-p="${p.id}" data-a="${a.id}" style="margin-left:auto"></span></div>`).join("")}
        <h4>Recent calls</h4><div class="callog">${[["21:14","atlas",p.tools[0][0],"0.4s"],["20:58","ada",p.tools[0][0],"0.6s"],["18:31","atlas",p.tools[1]?.[0]||p.tools[0][0],"1.1s"],["09:02","atlas",p.tools[0][0],"0.3s"]].filter(x=>AG[x[1]]).map(([t,a,n,s])=>`<div><b>${t}</b><span style="display:flex;align-items:center;gap:6px;width:70px">${tileHTML(AG[a],16)}${AG[a].name}</span><code>${n}</code><span style="font-variant-numeric:tabular-nums">${s}</span></div>`).join("")}</div>
      </div></div>`,
    foot:`<button class="btn bad" data-act="pdisconnect" data-p="${p.id}">Disconnect</button><button class="btn solid push" data-x2>Done</button>`});
  $("[data-x2]",d).onclick=()=>{closeDrawer();render()};
}
function connectFlow(p){
  let step=1;const pick=new Set(wsAgents().slice(0,1).map(a=>a.id));const tools=p.tools.map(t=>[...t]);
  const m=modal("",{width:500});
  const draw=()=>{
    const st=n=>`<span class="${step>n?"ok":step===n?"on":""}"><i>${step>n?ic("check",11,"#111",3):n}</i>${["","Sign in","What it can do","Who uses it"][n]}</span>`;
    m.innerHTML=`<div class="mband">${bandHTML(p.color,p.id+":band",92)}<span class="lg">${pmark(p,56)}</span></div><div style="margin-top:18px"><h2>Connect ${p.name}</h2><div class="lead" style="margin-top:2px">${p.d}</div></div>
      <div class="steps3">${st(1)}<em></em>${st(2)}<em></em>${st(3)}</div>
      ${step===1?`<div class="acct">${meTile(30)}<div style="flex:1"><div>you@example.com</div><div class="s">${p.name} asks you to approve access in your browser</div></div></div>
        <div class="foot"><button class="btn" data-x>Cancel</button><button class="btn solid" data-next>Continue with ${p.name}</button></div>`:
      step===2?`<div>${tools.map(([n,v],i)=>`<div class="toolli"><code>${n}</code><span class="s"><span class="seg" data-ts="${i}">${["allow","ask","off"].map(x=>`<button data-v="${x}" class="${x===v?"on":""}">${{allow:"Allow",ask:"Ask",off:"Off"}[x]}</button>`).join("")}</span></span></div>`).join("")}</div>
        <div class="foot"><button class="btn" data-back>Back</button><button class="btn solid" data-next>Continue</button></div>`:
      `<div>${wsAgents().map(a=>`<div class="mrow">${tileHTML(a,26)}<span>${a.name}</span><span class="r" style="margin-left:8px">${a.role}</span><span class="tog ${pick.has(a.id)?"on":""}" data-pa="${a.id}" style="margin-left:auto"></span></div>`).join("")}</div>
        <div class="foot"><button class="btn" data-back>Back</button><button class="btn solid" data-next>Connect ${p.name}</button></div>`}`;
    $$("[data-x]",m).forEach(b=>b.onclick=closeModal);
    const bk=$("[data-back]",m);if(bk)bk.onclick=()=>{step--;draw()};
    $$("[data-ts] button",m).forEach(b=>b.onclick=e=>{e.stopPropagation();const i=+b.parentElement.dataset.ts;tools[i][1]=b.dataset.v;$$("button",b.parentElement).forEach(x=>x.classList.toggle("on",x===b))});
    $$("[data-pa]",m).forEach(t=>t.onclick=e=>{e.stopPropagation();const id=t.dataset.pa;pick.has(id)?pick.delete(id):pick.add(id);t.classList.toggle("on",pick.has(id))});
    $("[data-next]",m).onclick=e=>{
      const b=e.currentTarget;
      if(step===1)return progress(b,"Waiting for your browser…",1300,()=>{step=2;draw()});
      if(step===2){step=3;return draw()}
      progress(b,"Connecting",700,()=>{p.on=true;p.tools=tools;p.used=[...pick];p.calls=0;closeModal();S.ptype="connected";S.pq="";S.view="plugins";render();toast(`${p.name} is connected`,{icon:"check",action:"Open",onAction:()=>pluginDrawer(p)})});
    };
  };
  draw();
}
function addMcp(){
  let tested=false;
  const m=modal(`<div><h2>Add an MCP server</h2><div class="lead">Anything that speaks MCP: a local command or a URL. Its tools show up for the agents you pick.</div></div>
    <div class="row2 even"><div><div class="fl">Name</div><input class="input" data-mn placeholder="Hyze internal"></div><div><div class="fl">Runs as</div><div class="seg" data-seg="none"><button class="on" data-tr="stdio">Command</button><button data-tr="http">URL</button></div></div></div>
    <div><div class="fl" data-ml>Command</div><input class="input mono" data-mc placeholder="npx -y @hyze/mcp-server" style="font-size:12px"></div>
    <div><div class="fl">Environment</div><div data-envs><div style="display:flex;gap:6px"><input class="input mono" placeholder="KEY" style="font-size:12px;width:40%"><input class="input mono" placeholder="value" style="font-size:12px"></div></div><span class="lnk" data-env style="font-size:12px;display:inline-block;margin-top:8px">+ Add variable</span></div>
    <div data-res style="font-size:12px;color:var(--ink3)">Not tested yet.</div>
    <div class="foot"><button class="btn" data-test style="margin-right:auto">${ic("play",10)} Test connection</button><button class="btn" data-x>Cancel</button><button class="btn solid" data-add>Add server</button></div>`,{width:520});
  $$("[data-tr]",m).forEach(b=>b.addEventListener("click",()=>{$("[data-ml]",m).textContent=b.dataset.tr==="http"?"URL":"Command";$("[data-mc]",m).placeholder=b.dataset.tr==="http"?"https://mcp.example.com/sse":"npx -y @hyze/mcp-server"}));
  $("[data-env]",m).onclick=()=>$("[data-envs]",m).insertAdjacentHTML("beforeend",`<div style="display:flex;gap:6px;margin-top:6px"><input class="input mono" placeholder="KEY" style="font-size:12px;width:40%"><input class="input mono" placeholder="value" style="font-size:12px"></div>`);
  $("[data-test]",m).onclick=e=>progress(e.currentTarget,"Starting it",1100,()=>{tested=true;$("[data-res]",m).innerHTML=`<span style="color:var(--green)">${ic("check",11)}</span> Connected. 3 tools found: <code class="mono">search</code>, <code class="mono">fetch</code>, <code class="mono">write</code>.`;$("[data-res]",m).style.display="flex";$("[data-res]",m).style.gap="6px"});
  $("[data-add]",m).onclick=()=>{
    const n=$("[data-mn]",m).value.trim();if(!n){$("[data-mn]",m).focus();return}
    PLUGINS.unshift({id:"mcp"+Date.now(),name:n,mark:n.split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase(),slug:null,color:COLORS[PLUGINS.length%8],cat:"Custom",d:`Your MCP server · ${$("[data-mc]",m).value||"local command"}`,on:true,used:[],calls:0,tools:[["search","allow"],["fetch","allow"],["write","ask"]]});
    closeModal();S.ptype="connected";S.view="plugins";render();toast(`${n} added${tested?"":" (not tested)"}. Give it to an agent below.`,{icon:"plug"});
  };
}
function skillDrawer(s){
  const isNew=!s;const used=new Set(s?.used||[]);
  const d=drawer({title:isNew?"New skill":s.name,sub:isNew?"A how-to any agent can follow":`SKILL.md · by ${AG[s.by]?.name||ME.name}`,icon:`<span class="ibtn" style="background:var(--s3);color:var(--ink2)">${ic("book",16)}</span>`,width:760,center:true,
    body:`<h4>Name</h4><input class="input" data-sn value="${esc(s?.name||"")}" placeholder="Customer email in our voice">
      <h4>SKILL.md</h4><textarea class="fld mono" data-sm style="height:300px;resize:none;font-size:12px;line-height:1.7">${esc(s?.md||"---\nname: \ndescription: \n---\n\n1. ")}</textarea>
      <h4>Which agents can use it</h4>${wsAgents().map(a=>`<div class="mrow">${tileHTML(a,26)}<span>${a.name}</span><span class="tog ${used.has(a.id)?"on":""}" data-su="${a.id}" style="margin-left:auto"></span></div>`).join("")}`,
    foot:`${isNew?"":`<button class="btn bad" data-sdel>${ic("trash",11)} Delete</button>`}<button class="btn push" data-x2>Cancel</button><button class="btn solid" data-ssave>${isNew?"Create skill":"Save"}</button>`});
  $$("[data-su]",d).forEach(t=>t.onclick=e=>{e.stopPropagation();const id=t.dataset.su;used.has(id)?used.delete(id):used.add(id);t.classList.toggle("on",used.has(id))});
  $("[data-x2]",d).onclick=closeDrawer;
  const sd=$("[data-sdel]",d);if(sd)sd.onclick=(()=>confirmBox(`Delete ${s.name}?`,"Agents that use it stop seeing it on their next message.","Delete skill",()=>{SKILLS.splice(SKILLS.indexOf(s),1);closeDrawer();render();toast("Skill deleted",{icon:"trash"})}));
  $("[data-ssave]",d).onclick=()=>{
    const name=$("[data-sn]",d).value.trim()||"Untitled skill",md=$("[data-sm]",d).value;
    if(isNew)SKILLS.push({id:"s"+Date.now(),name,by:"me",used:[...used],md});else Object.assign(s,{name,md,used:[...used]});
    closeDrawer();S.ptype="skills";render();toast(isNew?`${name} is ready for ${used.size||"no"} agent${used.size===1?"":"s"}`:"Saved",{icon:"check"});
  };
}
