/* core: helpers, mascots, the one data model, and the interaction layer (toast, pop, menu, veil). */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const later=(ms,f)=>setTimeout(f,ms);
const clock=()=>new Date().toTimeString().slice(0,5);
let uid=0;const nid=p=>p+(++uid);
const ACT={};          // every named action; one click listener dispatches to it
const INPUT={};        // every [data-in] field; one input listener dispatches to it

Object.assign(LUCIDE,{
  image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  monitor:'<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  volume:'<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
  thread:'<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  eyeoff:'<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  select:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  pdf:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  tasks:'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  share:'<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
  download:'<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  minus:'<path d="M5 12h14"/>',
  chevl:'<path d="m15 18-6-6 6-6"/>',
  up3:'<path d="m18 15-6-6-6 6"/>',
  film:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  laptop:'<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
  grip:'<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  phone:'<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  phoneoff:'<path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"/><path d="M22 2 2 22"/><path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/>',
  micoff:'<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  qr:'<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  chart:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  history:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  maximize:'<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  folderplus:'<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  bulb:'<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  restore:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  page:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  info2:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  star:'<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
});
const ic=(n,s=16,color="currentColor",w=1.75)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[n]||LUCIDE.dot}</svg>`;
function brand(slug,size=32){
  const b=BRANDS[slug],g=Math.round(size*.58);
  return `<span class="brand" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*.3)}px">${b?`<svg width="${g}" height="${g}" viewBox="0 0 24 24"><path fill="${b.hex}" d="${b.d}"/></svg>`:ic("globe",g,"#444")}</span>`;
}
function cliMark(n,s=12){
  if(n==="Claude")return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="${BRANDS.claude.hex}" d="${BRANDS.claude.d}"/></svg>`;
  if(n==="Codex")return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="currentColor" d="${BRANDS.openai.d}"/></svg>`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect x="4.5" y="3.5" width="15" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="8.5" y="9" width="7" height="7.5" rx=".8" fill="currentColor" opacity=".5"/></svg>`;
}
const engBadge=n=>`<span class="eng" title="${n}">${cliMark(n,11)}</span>`;

/* ───────── mascots: one SVG per shape, flat colour with a soft gradient, two eyes ───────── */
const flower=()=>Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return `<circle cx="${50+27*Math.cos(a)}" cy="${52+27*Math.sin(a)}" r="19"/>`}).join("")+'<circle cx="50" cy="52" r="32"/>';
const starPts=()=>Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?22:44;return `${(50+r*Math.cos(a)).toFixed(1)},${(54+r*Math.sin(a)).toFixed(1)}`}).join(" ");
const SHAPES={
  circle:{p:'<circle cx="50" cy="52" r="41"/>',ey:48},
  squircle:{p:'<rect x="10" y="12" width="80" height="80" rx="28"/>',ey:50},
  pill:{p:'<rect x="5" y="26" width="90" height="54" rx="27"/>',ey:52},
  drop:{p:'<path d="M50 6C50 6 84 42 84 64a34 34 0 0 1-68 0C16 42 50 6 50 6Z"/>',ey:62},
  cloud:{p:'<path d="M27 32C33 14 67 14 73 32c18-3 26 22 17 37-4 15-26 21-40 19-14 2-36-4-39-19C3 52 10 29 27 32Z"/>',ey:52},
  ghost:{p:'<path d="M15 92V48a35 35 0 0 1 70 0v44l-11.5-9-11.5 9-12-9-12 9-11.500-9Z" stroke-linejoin="round"/>',ey:48},
  cat:{p:'<path d="M14 46 17 13q1-4 5-2l20 15q8-2 16 0L78 11q4-2 5 2l3 33q5 20-6 33-10 13-30 13T20 79Q9 66 14 46Z"/>',ey:54},
  bot:{p:'<rect x="11" y="28" width="78" height="64" rx="24"/><rect x="47.500" y="9" width="5" height="22" rx="2.500"/><circle cx="50" cy="11" r="6"/>',ey:60},
  hex:{p:'<polygon points="50,8 88,29 88,71 50,92 12,71 12,29" stroke-linejoin="round" stroke-width="10"/>',ey:50},
  flower:{p:flower(),ey:52},
  star:{p:`<polygon points="${starPts()}" stroke-linejoin="round" stroke-width="12"/>`,ey:54},
  diamond:{p:'<polygon points="50,6 94,50 50,94 6,50" stroke-linejoin="round" stroke-width="14"/>',ey:50},
};
const SHAPE_NAMES=Object.keys(SHAPES);
const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return "#"+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,"0")).join("")};
/* ───────── a mascot is built from parts: body, eyes, mouth, an extra, a pattern, a colour ─────────
   Every part is drawn in the same 100×100 box, so any mix of them fits. A photo replaces the whole face.
   State adds a pose: resting (asleep), idle, working, on its own computer (vm), on your Mac (mac). */
const EYES=["round","dot","wide","happy","sleepy","visor"];
const MOUTHS=["none","smile","grin","o","cat","flat"];
const ACCS=["none","antenna","sprout","bow","glasses","headphones","horns","crown","cap"];
const PATS=["none","cheeks","belly","spots","stripes"];
/* where the top of each body sits, so an extra lands on the head and not in the air */
const TOPS={circle:11,squircle:12,pill:26,drop:12,cloud:20,ghost:13,cat:18,bot:22,hex:10,flower:9,star:14,diamond:10};
const INK="#17171a";
function photoMas(url,size){const id="p"+(++uid);return `<svg class="mas photo" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><clipPath id="${id}"><rect x="3" y="3" width="94" height="94" rx="30"/></clipPath></defs><image href="${url}" x="3" y="3" width="94" height="94" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/><rect x="3" y="3" width="94" height="94" rx="30" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/></svg>`}
function mascot(shape,color,size=40,{asleep=false,smile=size>=56,look={},state,photo}={}){
  if(photo)return photoMas(photo,size);
  const sh=SHAPES[shape]||SHAPES.circle,id="g"+(++uid),y=sh.ey,ex=15,t=TOPS[shape]??12;
  /* props only where they read: at sidebar sizes a monitor would just cover the face */
  const st=state||(asleep?"sleep":"idle"),zzz=st==="sleep",detail=size>=30,props=size>=56;
  const L={eyes:"round",mouth:smile?"smile":"none",acc:"none",pat:"none",...look};
  const lite=mix(color,"#ffffff",.22),deep=mix(color,"#000000",.18),soft=mix(color,"#ffffff",.5);
  const eye=x=>{
    if(zzz)return `<path d="M${x-7} ${y}q7 6 14 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
    if(L.eyes==="dot")return `<g class="pu"><circle cx="${x}" cy="${y}" r="5.4" fill="${INK}"/><circle cx="${x+1.8}" cy="${y-1.8}" r="1.7" fill="#fff"/></g>`;
    if(L.eyes==="wide")return `<ellipse cx="${x}" cy="${y}" rx="8.6" ry="10.6" fill="#fff"/><g class="pu"><circle cx="${x+1}" cy="${y+1.5}" r="5.2" fill="${INK}"/><circle cx="${x+2.7}" cy="${y-.6}" r="1.7" fill="#fff"/></g>`;
    if(L.eyes==="happy")return `<path d="M${x-7} ${y+3}q7 -9 14 0" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
    if(L.eyes==="sleepy")return `<circle cx="${x}" cy="${y}" r="8.5" fill="#fff"/><g class="pu"><circle cx="${x+1}" cy="${y+2.2}" r="4.2" fill="${INK}"/></g><path d="M${x-9.6} ${y+.5}a9.6 9.6 0 0 1 19.2 0z" fill="${deep}"/>`;
    return `<circle cx="${x}" cy="${y}" r="8.5" fill="#fff"/><g class="pu"><circle cx="${x+1.5}" cy="${y+1}" r="4.2" fill="${INK}"/><circle cx="${x+3}" cy="${y-.5}" r="1.4" fill="#fff"/></g>`;
  };
  let eyes=L.eyes==="visor"&&!zzz?`<rect x="25" y="${y-7.5}" width="50" height="15" rx="7.5" fill="${INK}"/><g class="pu"><rect x="33" y="${y-2.6}" width="11" height="5.2" rx="2.6" fill="#7df3ff"/><rect x="56" y="${y-2.6}" width="11" height="5.2" rx="2.6" fill="#7df3ff"/></g>`:eye(50-ex)+eye(50+ex);
  /* awake eyes sit in one group so CSS can blink them; each face starts its cycle at a different moment */
  if(!zzz)eyes=`<g class="ey" style="animation-delay:-${(uid*1.7%6).toFixed(1)}s">${eyes}</g>`;
  const my=y+17;
  const mouth=zzz||!detail?"":({smile:`<path d="M44 ${my}q6 5 12 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    grin:`<path d="M42.5 ${my-2.5}h15a7.5 7.5 0 0 1-15 0z" fill="${INK}"/><path d="M46 ${my+2.6}a4 2.6 0 0 1 8 0" fill="#ff7a8a"/>`,
    o:`<ellipse class="mo" cx="50" cy="${my+1}" rx="3.4" ry="4.2" fill="${INK}"/>`,
    cat:`<path d="M43 ${my}q3.5 4.5 7 0q3.5 4.5 7 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    flat:`<path d="M45 ${my+1}h10" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`}[L.mouth]||"");
  const pat=!detail?"":({cheeks:`<ellipse cx="${50-23}" cy="${y+10}" rx="5.5" ry="3.4" fill="#ff8aa8" opacity=".6"/><ellipse cx="${50+23}" cy="${y+10}" rx="5.5" ry="3.4" fill="#ff8aa8" opacity=".6"/>`,
    belly:`<ellipse cx="50" cy="${y+36}" rx="25" ry="19" fill="${soft}" opacity=".65"/>`,
    spots:`<circle cx="24" cy="${y-14}" r="5" fill="${deep}" opacity=".5"/><circle cx="76" cy="${y+22}" r="6.5" fill="${deep}" opacity=".5"/><circle cx="66" cy="${y-20}" r="3.6" fill="${deep}" opacity=".5"/><circle cx="30" cy="${y+28}" r="3.2" fill="${deep}" opacity=".5"/>`,
    stripes:`<rect x="0" y="${y+21}" width="100" height="6" fill="${deep}" opacity=".45"/><rect x="0" y="${y+32}" width="100" height="6" fill="${deep}" opacity=".45"/><rect x="0" y="${y-24}" width="100" height="5" fill="${deep}" opacity=".35"/>`}[L.pat]||"");
  const acc=!detail?"":({antenna:`<path d="M50 ${t+2}V${t-11}" stroke="${deep}" stroke-width="3" stroke-linecap="round"/><circle class="ball" cx="50" cy="${t-14}" r="4.6" fill="#ff6b6b"/>`,
    sprout:`<path d="M50 ${t+2}V${t-8}" stroke="#3a9a5b" stroke-width="2.6" stroke-linecap="round"/><path class="leaf" d="M50 ${t-6}c-3-8-13-8-15-4 4 5 11 6 15 4z" fill="#4fcf86"/><path class="leaf r" d="M50 ${t-8}c3-8 13-9 15-5-4 6-11 7-15 5z" fill="#3ec46d"/>`,
    bow:`<g transform="translate(68 ${t+6}) rotate(18)"><path d="M0 0l-11-7v14z" fill="#ff6fa5"/><path d="M0 0l11-7v14z" fill="#ff6fa5"/><circle r="3.2" fill="#e8508a"/></g>`,
    glasses:`<g fill="rgba(255,255,255,.12)" stroke="${INK}" stroke-width="2.6"><circle cx="35" cy="${y}" r="11.5"/><circle cx="65" cy="${y}" r="11.5"/></g><path d="M46.5 ${y-1}q3.5-3 7 0" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
    headphones:`<path d="M15 ${y+2}C15 ${t-14} 85 ${t-14} 85 ${y+2}" fill="none" stroke="#2b2b30" stroke-width="5" stroke-linecap="round"/><rect x="8" y="${y-6}" width="12" height="20" rx="5" fill="#2b2b30"/><rect x="80" y="${y-6}" width="12" height="20" rx="5" fill="#2b2b30"/><rect x="10.5" y="${y-2}" width="7" height="12" rx="3" fill="${color}"/><rect x="82.5" y="${y-2}" width="7" height="12" rx="3" fill="${color}"/>`,
    horns:`<path d="M32 ${t+6}c-6-5-8-13-4-19 2 6 6 9 11 12z" fill="#f2e6cf"/><path d="M68 ${t+6}c6-5 8-13 4-19-2 6-6 9-11 12z" fill="#f2e6cf"/>`,
    crown:`<path d="M34 ${t+4}l-2-16 9 8 9-12 9 12 9-8-2 16z" fill="#f6c84a" stroke="#d9a62a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="${t-3}" r="2.2" fill="#ff6b6b"/>`,
    cap:`<path d="M26 ${t+12}a24 22 0 0 1 48 0z" fill="${mix(color,"#3d66e6",.75)}"/><rect x="24" y="${t+9}" width="52" height="7" rx="3.5" fill="${mix(color,"#3d66e6",.55)}"/><circle cx="50" cy="${t-9}" r="5" fill="#fff"/>`}[L.acc]||"");
  /* poses: a monitor for its own computer, a silver laptop for yours, a thought bubble while it works */
  const prop=!props?"":st==="vm"?`<g class="prop"><rect x="20" y="60" width="60" height="36" rx="5" fill="#1c2130" stroke="#0b0d12" stroke-width="2"/><rect x="24" y="64" width="52" height="27" rx="2.5" fill="#2a5bd7"/><rect class="sl s1" x="28" y="69" width="26" height="3" rx="1.5" fill="#cfe0ff"/><rect class="sl s2" x="28" y="75" width="38" height="3" rx="1.5" fill="#cfe0ff"/><rect class="sl s3" x="28" y="81" width="18" height="3" rx="1.5" fill="#cfe0ff"/><rect x="45" y="96" width="10" height="4" rx="1" fill="#0b0d12"/></g>`
    :st==="mac"?`<g class="prop"><rect x="22" y="62" width="56" height="33" rx="4" fill="#d6d8dd" stroke="#a9adb5" stroke-width="1.5"/><circle cx="50" cy="78" r="3.4" fill="#b8bcc3"/><rect x="14" y="94" width="72" height="5" rx="2.5" fill="#c3c6cc"/><path class="mcur" d="M66 52l9 5-4 1-2 4z" fill="#fff" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/></g>`
    :st==="work"?`<g class="think"><rect x="70" y="${Math.max(0,t-14)}" width="26" height="14" rx="7" fill="#fff"/><circle cx="77" cy="${Math.max(0,t-14)+7}" r="2" fill="${INK}"/><circle cx="83" cy="${Math.max(0,t-14)+7}" r="2" fill="${INK}"/><circle cx="89" cy="${Math.max(0,t-14)+7}" r="2" fill="${INK}"/></g>`:"";
  const zz=zzz&&size>=30?`<text class="zz z1" x="78" y="18" font-size="15">z</text><text class="zz z2" x="88" y="6" font-size="11">z</text>`:"";
  return `<svg class="mas st-${st}" width="${size}" height="${size}" viewBox="0 0 100 100" style="overflow:visible"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lite}"/><stop offset="1" stop-color="${mix(color,"#000000",.14)}"/></linearGradient><clipPath id="c${id}">${sh.p}</clipPath></defs><g class="bd"><g fill="url(#${id})" stroke="url(#${id})" stroke-width="2">${sh.p}</g><g clip-path="url(#c${id})">${L.pat!=="cheeks"?pat:""}</g>${L.pat==="cheeks"?pat:""}${acc}${eyes}${mouth}</g>${prop}${zz}</svg>`;
}
/* what an agent is doing decides its pose */
const stateOf=a=>a.asleep&&!a.awake?"sleep":a.live?(a.where||"work"):"idle";
const face=(a,s=40)=>mascot(a.shape,a.color,s,{look:a.look,photo:a.photo,state:stateOf(a)});
const COLORS=["#f2645f","#f58a3c","#3ec46d","#38bdf8","#a58bfa","#ee73b2","#ecb40f","#d8d8d4","#16b5a5","#6d6df0","#86cf1b","#c08a5c"];

/* ───────── data ───────── */
const MODELS={Claude:["Opus 5.5","Sonnet 5.5","Haiku 5.5"],Codex:["GPT-6.1","GPT-6.1 mini"],OpenCode:["Muse 1.3","Qwen 4 Coder","Kimi K3"]};
const PERM={plan:["Plan","Reads and plans, changes nothing"],manual:["Ask first","Asks before it edits or runs anything"],auto:["Auto","Asks only for risky actions"],bypass:["Full access","Never asks"]};
const AG={
  atlas:{id:"atlas",look:{eyes:"round",mouth:"smile",acc:"glasses",pat:"none"},name:"Atlas",role:"Strategy",shape:"ghost",color:"#a58bfa",cli:"Claude",model:"Sonnet 5.5",effort:"Medium",dir:"hyze-cloud",perm:"auto",line:"Pricing for the Pro plan is closed.",when:"21:14",skills:4,mem:10,budget:20,spent:7.4,live:0},
  ada:{id:"ada",look:{eyes:"dot",mouth:"grin",acc:"headphones",pat:"none"},where:"vm",name:"Ada",role:"Dev",shape:"squircle",color:"#f58a3c",cli:"Claude",model:"Opus 5.5",effort:"High",dir:"api-node",perm:"auto",line:"Running pnpm test --filter api",when:"now",skills:6,mem:12,budget:30,spent:18.2,live:1},
  mila:{id:"mila",look:{eyes:"wide",mouth:"smile",acc:"bow",pat:"cheeks"},name:"Mila",role:"Marketing",shape:"diamond",color:"#ee73b2",cli:"Codex",model:"GPT-6.1",effort:"Medium",dir:"site",perm:"manual",line:"Can I publish the launch thread?",when:"21:02",skills:4,mem:12,budget:15,spent:3.1,ask:1},
  hugo:{id:"hugo",look:{eyes:"round",mouth:"o",acc:"sprout",pat:"spots"},name:"Hugo",role:"Research",shape:"cloud",color:"#3ec46d",cli:"OpenCode",model:"Muse 1.3",effort:"Medium",dir:"research",perm:"plan",line:"3 sources on usage-based billing.",when:"18:40",skills:2,mem:8,budget:10,spent:1.2,unread:1,asleep:1},
  leo:{id:"leo",look:{eyes:"happy",mouth:"smile",acc:"cap",pat:"none"},name:"Leo",role:"Content",shape:"drop",color:"#38bdf8",cli:"Claude",model:"Haiku 5.5",effort:"Low",dir:"blog",perm:"auto",line:"Draft is in Drive: Sandbox VMs.",when:"Tue",skills:3,mem:6,budget:8,spent:0.9,asleep:1},
  vex:{id:"vex",look:{eyes:"visor",mouth:"flat",acc:"antenna",pat:"stripes"},where:"mac",live:1,name:"Vex",role:"Infra",shape:"hex",color:"#d8d8d4",cli:"Codex",model:"GPT-6.1",effort:"Medium",dir:"hyzevm",perm:"auto",line:"Firecracker pool is at 72%.",when:"20:51",skills:5,mem:9,budget:25,spent:11.8},
  nox:{id:"nox",look:{eyes:"sleepy",mouth:"cat",acc:"horns",pat:"belly"},name:"Nox",role:"Security",shape:"cat",color:"#6d6df0",cli:"Claude",model:"Sonnet 5.5",effort:"High",dir:"hyzevm",perm:"manual",line:"No new CVEs in the base image.",when:"Mon",skills:3,mem:7,budget:12,spent:2.4,asleep:1},
  bia:{id:"bia",look:{eyes:"dot",mouth:"cat",acc:"crown",pat:"cheeks"},name:"Bia",role:"Life admin",shape:"star",color:"#ecb40f",cli:"Claude",model:"Haiku 5.5",effort:"Low",dir:"~",perm:"plan",line:"Reminder: renew the domain.",when:"Sun",skills:1,mem:4,budget:5,spent:0.2,asleep:1},
};
const CH={
  "#launch":{name:"launch",purpose:"Pro plan launch on Oct 30: announcement, blog and pricing page.",members:["atlas","mila","leo"],lead:"mila",line:"Mila: thread is ready for review",when:"21:20",unread:2,rounds:3},
  "#infra-alerts":{name:"infra-alerts",purpose:"Pool and billing alerts. Ada and Atlas answer.",members:["ada","atlas"],lead:"ada",line:"Ada: pool alert cleared",when:"19:02",rounds:2},
  "#general":{name:"general",purpose:"Everything without a home.",members:["atlas","ada","mila","hugo","leo"],lead:"atlas",line:"Atlas: Monday sync notes are in",when:"Mon",rounds:3},
  "#pool":{name:"pool",purpose:"VM capacity.",members:["vex"],lead:"vex",line:"Vex: 72% used",when:"20:40",rounds:2},
  "#security":{name:"security",purpose:"CVEs and audits.",members:["nox","vex"],lead:"nox",line:"Nox: weekly scan clean",when:"Mon",rounds:2},
};
const WS=[
  {name:"Hyze Cloud",lead:"atlas",convs:["atlas","#launch","ada","mila","#infra-alerts","hugo","leo","#general","vex","nox"],pins:["atlas","#launch","ada"],folders:[{name:"Launch week",ids:["mila","leo"]},{name:"Infra",ids:["#infra-alerts","vex","nox"]}],ctx:"Hyze Cloud sells sandbox VMs by the hour for AI agents."},
  {name:"HyzeVM",lead:"vex",convs:["vex","nox","#pool","#security"],pins:["vex"],folders:[],ctx:""},
  {name:"Personal",lead:"bia",convs:["bia"],pins:[],folders:[],ctx:""},
];
const ME={name:"Gabriel",initials:"GA",email:"you@example.com",status:"Available",lang:"English"};
const STATUS={Available:"var(--green)",Focus:"var(--amber)",Away:"var(--ink4)"};
const ROUTINES=[
  {id:"r1",agent:"mila",title:"Daily Hyze content (IG + TikTok)",when:"daily",time:"10:00",day:-1,on:true,task:"post the daily content"},
  {id:"r2",agent:"mila",title:"Check email tracking and build the trial funnel",when:"once",time:"11:00",day:-1,on:true,task:"check email tracking and build the trial funnel"},
  {id:"r3",agent:"atlas",title:"Pricing review",when:"weekly",time:"09:00",day:0,on:true,task:"review pricing and write the summary"},
  {id:"r4",agent:"vex",title:"Pool capacity report",when:"weekly",time:"08:30",day:4,on:true,task:"report pool capacity"},
  {id:"r5",agent:"nox",title:"Weekly CVE scan",when:"weekly",time:"07:00",day:1,on:false,task:"scan the base image for CVEs"},
  {id:"r6",agent:"ada",title:"Nightly test run",when:"daily",time:"02:00",day:-1,on:true,task:"run the full test suite"},
];
const PLUGINS=[
  {id:"github",name:"GitHub",desc:"Repos, issues and pull requests",on:true,grants:["atlas","ada","vex"],tools:[["Read repos","allow"],["Open pull requests","ask"],["Merge","off"]]},
  {id:"slack",name:"Slack",desc:"Post and read channels",on:true,grants:["mila","atlas"],tools:[["Read channels","allow"],["Post messages","ask"]]},
  {id:"googledrive",name:"Google Drive",desc:"Docs, sheets and files",on:true,grants:["leo","atlas"],tools:[["Read files","allow"],["Create files","allow"],["Delete files","off"]]},
  {id:"linear",name:"Linear",desc:"Issues and cycles",on:false,grants:[],tools:[["Read issues","allow"],["Create issues","ask"]]},
  {id:"notion",name:"Notion",desc:"Pages and databases",on:false,grants:[],tools:[["Read pages","allow"],["Edit pages","ask"]]},
  {id:"gmail",name:"Gmail",desc:"Read and draft email",on:false,grants:[],tools:[["Read mail","allow"],["Send mail","ask"]]},
  {id:"figma",name:"Figma",desc:"Read design files",on:false,grants:[],tools:[["Read files","allow"]]},
  {id:"sentry",name:"Sentry",desc:"Errors and releases",on:false,grants:[],tools:[["Read issues","allow"]]},
  {id:"stripe",name:"Stripe",desc:"Payments and customers",on:false,grants:[],tools:[["Read payments","allow"],["Refund","off"]]},
  {id:"vercel",name:"Vercel",desc:"Deployments",on:false,grants:[],tools:[["Read deployments","allow"],["Deploy","ask"]]},
  {id:"supabase",name:"Supabase",desc:"Databases",on:false,grants:[],tools:[["Read tables","allow"],["Write rows","ask"]]},
  {id:"postgresql",name:"PostgreSQL",desc:"Query a database",on:false,grants:[],tools:[["Read","allow"],["Write","off"]]},
];
const SKILLS=[
  {n:"Write release notes",on:true},{n:"Review a pull request",on:true},{n:"Summarise a thread",on:true},{n:"Draft a launch post",on:false},{n:"Triage Sentry errors",on:true},{n:"Price a plan",on:false},
];
const PRS=[
  {id:"pr1",title:"Add usage-based billing endpoint",repo:"api-node",num:482,by:"ada",lane:"review",ck:"run",files:7,add:312,del:41},
  {id:"pr2",title:"Pool autoscaler: scale on queue depth",repo:"hyzevm",num:96,by:"vex",lane:"review",ck:"ok",files:4,add:128,del:30},
  {id:"pr3",title:"Pricing page: Pro plan copy",repo:"site",num:311,by:"mila",lane:"open",ck:"ok",files:2,add:44,del:12},
  {id:"pr4",title:"Fix webhook retry backoff",repo:"api-node",num:479,by:"ada",lane:"open",ck:"bad",files:3,add:21,del:9},
  {id:"pr5",title:"Blog: Sandbox VMs explained",repo:"blog",num:58,by:"leo",lane:"open",ck:"ok",files:1,add:210,del:0},
  {id:"pr6",title:"Bump base image to 24.04.2",repo:"hyzevm",num:92,by:"nox",lane:"merged",ck:"ok",files:2,add:6,del:6},
  {id:"pr7",title:"UTM on outbound links",repo:"site",num:305,by:"mila",lane:"merged",ck:"ok",files:5,add:57,del:8},
];
const FOLDERS=["~/hyze-cloud","~/api-node","~/site","~/hyzevm","~/research","~/blog"];
const MEMORY={atlas:["Pro plan is $29/month, annual saves 20%.","Gabriel prefers short answers with the risk stated last.","Launch date is Oct 30, 10:00 BRT.","Never quote competitors by name in public posts."],ada:["The API runs on Rust and Axum; tests use cargo nextest.","Never push to main; open a PR."],mila:["Voice: direct, friendly, no exclamation marks.","Posts go out after Gabriel approves."]};
const PINNED_NOTES=[];
const SLASH=[["plan","Switch to plan mode","Reads and plans only","tasks"],["review","Review the latest diff","","eye"],["summarize","Summarise this chat","","list"],["model","Change model","","spark"],["routine","Make this a routine","","clock"],["remember","Save to memory","","brain"],["compact","Compact the context","","layers"],["clear","Clear the chat","","trash"]];
const EMOJI=["👍","❤️","😂","🎉","👀","🙏"];
const EMOJI_ALL=["😀","😅","😂","🙂","😉","😍","🤔","😮","😢","🙌","👍","👎","👏","🙏","💪","🎉","🔥","✅","❌","⚡","🚀","💡","👀","❤️","💯","📌","📎","🧠","🛠️","🌙"];

/* ───────── state ───────── */
const S={ws:0,conv:"atlas",filter:"all",panel:null,sel:new Set(),hidden:new Set(),muted:new Set(),unread:new Set(["hugo","#launch"]),
  inbox:[],ibOpen:false,theme:"dark",pal:"default",accent:"agent",font:"Inter",advanced:false,
  pref:{notify:true,botchat:false,island:true,notch:true,extra:false,e2e:true,crash:true,pause:false,fastlist:true,logo:true,autopin:false,sound:true},
  cmd:"auto",computer:true,drafts:{},replyTo:null,pins:{},steps:{},pulse:0};
const isCh=id=>id[0]==="#";
const cur=()=>isCh(S.conv)?CH[S.conv]:AG[S.conv];
const convName=id=>isCh(id)?"#"+CH[id].name:AG[id].name;
const wsConvs=()=>WS[S.ws].convs;

/* ───────── interaction layer ───────── */
function toast(msg,{action,onAction,icon,ms=3200}={}){
  const t=document.createElement("div");t.className="toast"+(action?"":" plain");
  t.innerHTML=`${icon?ic(icon,14):""}<span>${msg}</span>${action?`<button>${action}</button>`:""}`;
  $("#toasts").appendChild(t);
  if(action)$("button",t).onclick=e=>{e.stopPropagation();onAction?.();t.remove()};
  later(ms,()=>t.remove());
}
let popEl=null,popFresh=false;
const closePop=()=>{popEl?.remove();popEl=null;S.ibOpen=false};
function place(p){
  const {anchor,align,place:pl}=p._o,r=anchor.getBoundingClientRect(),pr=p.getBoundingClientRect();
  const x=align==="right"?r.right-pr.width:align==="center"?r.left+r.width/2-pr.width/2:r.left;
  let y=pl==="above"?r.top-pr.height-8:r.bottom+8;
  if(y+pr.height>innerHeight-10)y=r.top-pr.height-8;
  p.style.left=Math.max(10,Math.min(x,innerWidth-pr.width-10))+"px";p.style.top=Math.max(10,Math.min(y,innerHeight-pr.height-10))+"px";
}
function pop(anchor,html,{place:pl="below",align="left",cls=""}={}){
  closePop();const p=document.createElement("div");p.className="pop "+cls;p.innerHTML=html;document.body.appendChild(p);
  p._o={anchor,align,place:pl};place(p);popEl=p;popFresh=true;return p;
}
/* items: [icon,label,fn,{red,s,chk,html,sub}] | "hr" | "#Label". `sub` swaps the list for a nested one with a back row. */
function fillMenu(p,items,back){
  const all=back?[[ "chevl","Back",()=>fillMenu(p,back.items,back.up),{keep:1}],"hr",...items]:items;
  p.innerHTML=all.map((it,i)=>it==="hr"?"<hr>":it.raw!==undefined?it.raw:typeof it==="string"?`<div class="lbl">${it.slice(1)}</div>`:
    `<div class="it ${it[3]?.red?"red":""}" data-i="${i}">${it[3]?.html||(it[0]?ic(it[0],15):"")}<span>${it[1]}</span>${it[3]?.s?`<span class="s">${it[3].s}</span>`:""}${it[3]?.chk?`<span class="chk">${ic("check",15)}</span>`:""}${it[3]?.sub?`<span class="s">${ic("chev",15)}</span>`:""}</div>`).join("");
  all.forEach(it=>{if(Array.isArray(it)&&!it[2]&&!it[3]?.sub)(window.DEAD_ITEMS=window.DEAD_ITEMS||[]).push(it[1])});
  $$(".it",p).forEach(el=>el.onclick=e=>{
    e.stopPropagation();const it=all[+el.dataset.i];if(!it)return;
    if(it[3]?.sub){fillMenu(p,it[3].sub,{items:all,up:back});return place(p)}
    if(it[3]?.keep){it[2]();return place(p)}
    closePop();it[2]?.();
  });
}
function menu(anchor,items,opts){const p=pop(anchor,"",opts);fillMenu(p,items);place(p);return p}
const atPoint=(x,y)=>({getBoundingClientRect:()=>({left:x,right:x,top:y,bottom:y,width:0,height:0})});
function emojiRow(fn){return `<div class="emojis">${EMOJI.map(e=>`<button data-e="${e}">${e}</button>`).join("")}<button data-e="+" title="More">${ic("plus",20)}</button></div>`}

let VEILS=[];
function veil(html,{width=500,cls="",top=false,sheet=false}={}){
  const v=document.createElement("div");v.className="veil"+(top?" vtop":"");
  v.innerHTML=top?html:`<div class="mdl ${cls}" style="${sheet?"":`width:${width}px;max-width:calc(100vw - 40px)`}">${html}</div>`;
  document.body.appendChild(v);VEILS.push(v);
  v.addEventListener("mousedown",e=>{if(e.target===v)closeVeil(v)});
  later(30,()=>$("[autofocus]",v)?.focus());
  return v;
}
function closeVeil(v){v=v||VEILS[VEILS.length-1];if(!v)return;v.onclose?.();v.remove();VEILS=VEILS.filter(x=>x!==v)}
const closeAllVeils=()=>[...VEILS].forEach(closeVeil);
const mdlOf=v=>$(".mdl",v);
function confirmBox(title,text,ok,fn,{danger=true,type}={}){
  const v=veil(`${Head(title,{close:false})}${Body(`<p style="color:var(--ink2);font-size:14px;line-height:1.55">${text}</p>${type?`${Label(`Type “${type}” to confirm`)}${Field({in:"confirm-type",autofocus:true})}`:""}`)}${Foot(Btn("Cancel",{act:"close-veil",kind:"ghost"}),`<button class="btn ${danger?"danger":"primary"}" data-act="confirm-ok" ${type?"disabled":""}>${ok}</button>`)}`,{width:440});
  v.confirm={fn,type};
}
INPUT["confirm-type"]=(val,el)=>{const v=el.closest(".veil");$("[data-act=confirm-ok]",v).disabled=val!==v.confirm.type};
Object.assign(ACT,{
  "close-veil":el=>closeVeil(el.closest(".veil")),
  "confirm-ok":el=>{const v=el.closest(".veil");closeVeil(v);v.confirm.fn()},
});
/* shimmering placeholder rows, never a bare "Loading…" */
const skel=(n=4,{h=14}={})=>Array.from({length:n},()=>`<div class="skrow"><div class="sk"></div><div class="skcol"><div class="sk" style="height:${h}px;width:${40+Math.random()*30|0}%"></div><div class="sk" style="height:${h-3}px;width:${55+Math.random()*35|0}%"></div></div></div>`).join("");
function withSkel(el,n,ms,fill){el.innerHTML=skel(n);later(ms,()=>{if(el.isConnected)fill()})}
const tog=(k,on)=>Toggle(on,{k});
const toggle=(id,on,a)=>Toggle(on,{act:a,id});
function fmt(t){
  return esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`(.+?)`/g,"<code>$1</code>").replace(/@(\w+)/g,(m,n)=>AG[n.toLowerCase()]?`<span class="men">@${AG[n.toLowerCase()].name}</span>`:n.toLowerCase()===ME.name.toLowerCase()?`<span class="men">@${ME.name}</span>`:m).replace(/\n/g,"<br>");
}
function pickFile(cb){const i=document.createElement("input");i.type="file";i.onchange=()=>i.files[0]&&cb(i.files[0]);i.click()}
function progress(btn,label,ms,done){const old=btn.innerHTML;btn.classList.add("off");btn.innerHTML=`<span class="spin"></span>${label}`;later(ms,()=>{btn.classList.remove("off");btn.innerHTML=old;done?.()})}
