// The agent's face: a body, eyes, a mouth, an extra and a pattern drawn in one 100×100 box, so any mix fits.
// A photo replaces the whole face. A pose (resting, idle, working, on its own computer, on your Mac) adds a
// prop and a motion; the motion lives in `styles/face.css`. Built from our own constants and a palette colour,
// never from typed text, so setting the result as markup is not an injection path. Mirrors design/simple/core.js.
/* eslint-disable */
// @ts-nocheck
import { mixHex as mix } from "@/lib/mascots";

let uid = 0;
export type ShapeName = "circle" | "squircle" | "pill" | "drop" | "cloud" | "ghost" | "cat" | "bot" | "hex" | "flower" | "star" | "diamond";
export type Pose = "idle" | "sleep" | "work" | "vm" | "mac";
export type Look = { eyes?: string; mouth?: string; acc?: string; pat?: string };
const flower=()=>Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return `<circle cx="${50+27*Math.cos(a)}" cy="${52+27*Math.sin(a)}" r="19"/>`}).join("")+'<circle cx="50" cy="52" r="32"/>';
const starPts=()=>Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?22:44;return `${(50+r*Math.cos(a)).toFixed(1)},${(54+r*Math.sin(a)).toFixed(1)}`}).join(" ");
const SHAPES: Record<string, { p: string; ey: number }> ={
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
export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];
/* ───────── a mascot is built from parts: body, eyes, mouth, an extra, a pattern, a colour ─────────
   Every part is drawn in the same 100×100 box, so any mix of them fits. A photo replaces the whole face.
   State adds a pose: resting (asleep), idle, working, on its own computer (vm), on your Mac (mac). */
export const EYES = ["round","dot","wide","happy","sleepy","visor"];
export const MOUTHS = ["none","smile","grin","o","cat","flat"];
export const ACCS = ["none","antenna","sprout","bow","glasses","headphones","horns","crown","cap"];
export const PATS = ["none","cheeks","belly","spots","stripes"];
/* where the top of each body sits, so an extra lands on the head and not in the air */
const TOPS={circle:11,squircle:12,pill:26,drop:12,cloud:20,ghost:13,cat:18,bot:22,hex:10,flower:9,star:14,diamond:10};
const INK="#17171a";
export function photoMas(url,size){const id="p"+(++uid);return `<svg class="mas photo" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><clipPath id="${id}"><rect x="3" y="3" width="94" height="94" rx="30"/></clipPath></defs><image href="${url}" x="3" y="3" width="94" height="94" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/><rect x="3" y="3" width="94" height="94" rx="30" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/></svg>`}
export function mascot(shape: string, color: string, size = 40, { asleep = false, smile = size >= 56, look = {}, state, photo }: { asleep?: boolean; smile?: boolean; look?: Look; state?: Pose; photo?: string } = {}): string {
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


/// What an agent is doing decides its pose.
export const poseOf = (a: { asleep?: boolean; awake?: boolean; live?: boolean; where?: string }): Pose =>
  a.asleep && !a.awake ? "sleep" : a.live ? ((a.where as Pose) || "work") : "idle";

/// The body an old pixel-head `kind` becomes, so an agent made before faces had parts keeps its character.
const KIND_SHAPE: Record<string, ShapeName> = { sun: "flower", cat: "cat", fox: "squircle", frog: "cloud", owl: "bot", ghost: "ghost", bear: "circle", bunny: "drop" };
export const shapeOfKind = (kind: string): ShapeName => KIND_SHAPE[kind] ?? "circle";

function seeded(id: string): () => number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
/// A stable look for an agent that never picked one, so a roster of old agents is a roster of different faces.
export function lookFor(id: string): Required<Look> {
  const r = seeded(id + ":look"), pick = (a: string[]) => a[Math.floor(r() * a.length)];
  return { eyes: pick(EYES), mouth: pick(MOUTHS.slice(1)), acc: pick(["none", "none", ...ACCS.slice(1)]), pat: pick(["none", "none", ...PATS.slice(1)]) };
}
