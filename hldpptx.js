/* ---------- Présentation HLD (.pptx) --------------------------------------
   Export « dossier HLD » en présentation PowerPoint animée, écrit à la main
   en OOXML (ZIP « store » + XML), sans dépendance — comme l'export Excel.

   • Style moderne sombre : dégradé bleu nuit, cartes, accents bleu/cyan,
     ombres douces, grille 16:9 (1280×720 px → EMU).
   • Transitions de diapositives : fade, push, split, cover, zoom, dissolve,
     wipe… (vitesse lente/moyenne selon la slide).
   • Animations d'entrée dans <p:timing> : fade, float (montée+fondu),
     fly, wipe, circle, blinds, checkerboard, wheel, strips — le titre de
     chaque slide s'anime automatiquement à l'ouverture (groupe « auto »),
     le contenu se révèle ensuite au clic (groupe « au clic »), en cascade.
   • Images embarquées dans ppt/media : plan, topologie, logo.

   Usage : HLD_PPTX.build(ws, { plan, topo, logo }) → Uint8Array (.pptx)
     plan/topo : { bytes, w?, h? } (JPEG)   logo : Uint8Array PNG        */
const HLD_PPTX = (() => {
'use strict';

/* =========================== Thème / couleurs =========================== */
const F = 'Segoe UI';
const TH = {
  bgA: '0B1120', bgB: '121F3C',          // fond dégradé (maître)
  bgCA: '090F1E', bgCB: '142242',        // fond couverture / clôture
  card: '13203C', card2: '0E1830', bd: '273851', hdr: '1A2B4E',
  ink: 'F5F8FE', mut: 'A3B2CC', dim: '6E80A0',
  acc: '3B82F6', acc2: '22D3EE', grn: '34D399', amb: 'FBBF24',
  red: 'F87171', vio: '818CF8',
  rowA: '0E1830', rowB: '121F3B',
};
const W = 1280, H = 720;                       // grille de conception (px)
const E = px => Math.round(px * 9525);         // px (96 dpi) → EMU
const SLIDE_CX = E(W), SLIDE_CY = E(H);        // 12192000 × 6858000 (16:9)

/* ============================ XML / outils ============================== */
const enc = new TextEncoder();
const esc = s => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const trunc = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/[ ,;·-]+$/, '') + '…' : t;
};
const hex = c => String(c || '').replace(/^#/, '').toUpperCase();

/* Dimensions d'une image (repli si l'appelant ne les fournit pas). */
function jpegSize(u8) {
  if (!u8 || u8.length < 24 || u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
  let i = 2;
  while (i < u8.length - 9) {
    if (u8[i] !== 0xFF) { i++; continue; }
    const m = u8[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return { w: (u8[i + 7] << 8) | u8[i + 8], h: (u8[i + 5] << 8) | u8[i + 6] };
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
function pngSize(u8) {
  if (!u8 || u8.length < 24) return null;
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return null;
  return { w: ((u8[16] << 24) >>> 0) + (u8[17] << 16) + (u8[18] << 8) + u8[19],
           h: ((u8[20] << 24) >>> 0) + (u8[21] << 16) + (u8[22] << 8) + u8[23] };
}
/* Recadre une image (iw×ih) dans un cadre en conservant le ratio. */
function fitRect(iw, ih, x, y, w, h) {
  if (!iw || !ih) return { x, y, w, h };
  const k = Math.min(w / iw, h / ih);
  const fw = Math.round(iw * k), fh = Math.round(ih * k);
  return { x: x + Math.round((w - fw) / 2), y: y + Math.round((h - fh) / 2), w: fw, h: fh };
}

/* ====================== ZIP « store » + CRC32 =========================== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* DEFLATE (RFC 1951) en blocs stockés : OPC/ISO 29500-2 impose l'algorithme
   DEFLATE (méthode zip 8) — la méthode 0 « Stored » est interdite et peut
   déclencher la réparation PowerPoint. Blocs stockés = deflate valide. */
function deflateStored(u8) {
  const MAX = 65535;
  const n = Math.max(1, Math.ceil(u8.length / MAX));
  const out = new Uint8Array(u8.length + n * 5);
  let p = 0, off = 0;
  for (let i = 0; i < n; i++) {
    const end = Math.min(off + MAX, u8.length);
    const len = end - off;
    out[p++] = i === n - 1 ? 0x01 : 0x00;
    out[p++] = len & 0xFF; out[p++] = (len >>> 8) & 0xFF;
    const nlen = (~len) & 0xFFFF;
    out[p++] = nlen & 0xFF; out[p++] = (nlen >>> 8) & 0xFF;
    out.set(u8.subarray(off, end), p);
    p += len; off = end;
  }
  return out.subarray(0, p);
}
function zip(files) {
  const chunks = [], central = [];
  let offset = 0, cdSize = 0;
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const data = deflateStored(raw);
    const crc = crc32(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
    lh.setUint16(8, 8, true);  lh.setUint16(10, DOS_TIME, true);
    lh.setUint16(12, DOS_DATE, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);   // version faite par
    ch.setUint16(6, 20, true);   // version requise
    ch.setUint16(8, 0, true);    // drapeaux
    ch.setUint16(10, 8, true);   // méthode : deflate (OPC)
    ch.setUint16(12, DOS_TIME, true);
    ch.setUint16(14, DOS_DATE, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);   // extra
    ch.setUint16(32, 0, true);   // commentaire
    ch.setUint16(34, 0, true);   // disque
    ch.setUint16(36, 0, true);   // attrs internes
    ch.setUint32(38, 0, true);   // attrs externes
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
    cdSize += 46 + name.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);
  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, u) => s + u.length, 0));
  let p = 0;
  for (const u of all) { out.set(u, p); p += u.length; }
  return out;
}

/* ==================== Texte : paragraphes / runs ======================== */
function runXml(r, d = {}) {
  if (typeof r === 'string') r = { t: r };
  // ST_TextFontSize : 100..4000 (1 à 40 pt) — au-delà PowerPoint « répare ».
  const sz = Math.min(4000, Math.max(100, Math.round((r.sz ?? d.sz ?? 14) * 100)));
  const c = hex(r.c ?? d.c ?? TH.ink);
  const b = (r.b ?? d.b) ? ' b="1"' : '';
  const it = (r.i ?? d.i) ? ' i="1"' : '';
  const spc = (r.spc ?? d.spc) ? ` spc="${Math.round((r.spc ?? d.spc) * 100)}"` : '';
  const f = r.f ?? d.f ?? F;
  return `<a:r><a:rPr lang="fr-FR" sz="${sz}"${b}${it}${spc} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>` +
    `<a:latin typeface="${esc(f)}"/><a:cs typeface="${esc(f)}"/></a:rPr>` +
    `<a:t>${esc(r.t ?? '')}</a:t></a:r>`;
}
/* p : { runs, algn, sz, c, b, lnSpc(%), spcBef(pt), spcAft(pt), bu } */
function paraXml(p, d = {}) {
  const dd = { ...d };
  for (const k of ['sz', 'c', 'b', 'f']) if (p[k] !== undefined) dd[k] = p[k];
  let props = '';
  if (p.lnSpc) props += `<a:lnSpc><a:spcPct val="${Math.round(p.lnSpc * 1000)}"/></a:lnSpc>`;
  if (p.spcBef) props += `<a:spcBef><a:spcPts val="${Math.round(p.spcBef * 100)}"/></a:spcBef>`;
  if (p.spcAft) props += `<a:spcAft><a:spcPts val="${Math.round(p.spcAft * 100)}"/></a:spcAft>`;
  props += '<a:buNone/>';
  const runs = (p.runs || []).map(r => runXml(r, dd)).join('');
  return `<a:p><a:pPr${p.algn ? ` algn="${p.algn}"` : ''}>${props}</a:pPr>${runs}</a:p>`;
}
const parasXml = (paras, d) => (paras || []).map(p => paraXml(p, d)).join('');

/* ================== Remplissages / traits / ombres ====================== */
function fillXml(fill, def = TH.card) {
  if (fill === 'none') return '<a:noFill/>';
  if (fill === undefined || fill === null) fill = def;
  if (typeof fill === 'string') return `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>`;
  const a = fill.a != null ? `<a:alpha val="${Math.round(fill.a * 1000)}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${hex(fill.c)}">${a}</a:srgbClr></a:solidFill>`;
}
function gradXml(g) {
  const stops = (g.stops || []).map(s =>
    `<a:gs pos="${Math.max(0, Math.min(100000, Math.round(s.pos * 1000)))}">` +
    `<a:srgbClr val="${hex(s.c)}">${s.a != null ? `<a:alpha val="${Math.round(s.a * 1000)}"/>` : ''}</a:srgbClr></a:gs>`
  ).join('');
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>` +
    `<a:lin ang="${Math.round(g.ang ?? 2700000)}" scaled="1"/></a:gradFill>`;
}
function lnXml(ln) {
  if (!ln || ln === 'none') return '';        // « none » / absent = sans bordure
  const w = Math.round((ln.w ?? 1.2) * 9525);
  const dash = ln.dash ? `<a:prstDash val="${ln.dash}"/>` : '';
  const fill = ln.c === 'none' ? '<a:noFill/>' : fillXml(ln.c || TH.bd);
  return `<a:ln w="${w}" cap="rnd">${fill}${dash}</a:ln>`;
}
function shadowXml() {
  return `<a:effectLst><a:outerShdw blurRad="110000" dist="32000" dir="5400000" ` +
    `algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="42000"/></a:srgbClr></a:outerShdw></a:effectLst>`;
}

/* ======================== Formes (p:sp / p:pic) ========================= */
/* o : { geom, adj, x,y,w,h, fill, grad, ln, shadow, rot, flipH, flipV,
        paras, anchor, wrap, ins } — id est alloué par le slide. */
function spXml(id, name, o) {
  const xfrm = `<a:xfrm${o.rot ? ` rot="${Math.round(o.rot * 60000)}"` : ''}` +
    `${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}>` +
    `<a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm>`;
  /* PowerPoint supprime (et signale en réparation) tout a:gd sous un prstGeom
     sans guide d'ajustement — ex. rect/line n'ont PAS d'adj (ECMA-376). */
  const geomName = o.geom || 'rect';
  const ADJ_OK = new Set(['roundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect',
    'ellipse', 'hexagon', 'octagon', 'pentagon', 'diamond', 'parallelogram', 'trapezoid',
    'chevron', 'homePlate', 'cube', 'can', 'donut', 'frame', 'halfFrame',
    'snip1Rect', 'snipRoundRect', 'snip2SameRect', 'snip2DiagRect', 'plus']);
  const adj = (o.adj != null && ADJ_OK.has(geomName))
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(o.adj)}"/></a:avLst>`
    : '<a:avLst/>';
  const geom = `<a:prstGeom prst="${geomName}">${adj}</a:prstGeom>`;
  const fill = o.grad ? gradXml(o.grad) : fillXml(o.fill);
  const ln = lnXml(o.ln);
  const sh = o.shadow ? shadowXml() : '';
  const ins = o.ins || {};
  const bodyPr = `<a:bodyPr wrap="${o.wrap || 'square'}" lIns="${E(ins.l ?? 0)}" tIns="${E(ins.t ?? 0)}" ` +
    `rIns="${E(ins.r ?? 0)}" bIns="${E(ins.b ?? 0)}" anchor="${o.anchor || 't'}"/>`;
  const txBody = `<p:txBody>${bodyPr}<a:lstStyle/>` +
    (o.paras && o.paras.length ? parasXml(o.paras) : '<a:p/>') + '</p:txBody>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm}${geom}${fill}${ln}${sh}</p:spPr>${txBody}</p:sp>`;
}
function picXml(id, name, o) {
  const xfrm = `<a:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm>`;
  const alpha = o.alpha != null ? `<a:alphaModFix amt="${Math.round(o.alpha * 1000)}"/>` : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${o.embed}">${alpha}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${lnXml(o.ln)}</p:spPr></p:pic>`;
}
function cxnXml(id, name, o) {
  const xfrm = `<a:xfrm${o.flipV ? ' flipV="1"' : ''}${o.flipH ? ' flipH="1"' : ''}>` +
    `<a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm>`;
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(name)}"/>` +
    `<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr>${xfrm}<a:prstGeom prst="${o.geom || 'line'}"><a:avLst/></a:prstGeom>${lnXml(o.ln)}</p:spPr></p:cxnSp>`;
}
/* Tableau : cols = largeurs relatives ; rows = [{ h, cells:[{ t|paras, c, b, algn, fill }] }] */
function tblXml(id, name, o) {
  const colW = o.cols.map(c => E(c));
  const sum = colW.reduce((a, b) => a + b, 0);
  colW[colW.length - 1] += E(o.w) - sum;
  const grid = colW.map(w => `<a:gridCol w="${w}"/>`).join('');
  const hdrFill = o.hdrFill || TH.hdr;
  const rowsXml = o.rows.map((r, ri) => {
    const isHdr = ri === 0;
    const h = E(r.h || 38);
    const cells = r.cells.map((c, ci) => {
      const algn = c.algn || (o.colAlign && o.colAlign[ci]) || 'l';
      const paras = c.paras || [{
        runs: [{ t: c.t ?? '', sz: c.sz ?? (isHdr ? 10.5 : 10.5), b: c.b ?? isHdr,
                 c: c.c ?? (isHdr ? TH.ink : TH.mut) }], algn
      }];
      const fill = c.fill || (isHdr ? hdrFill : (o.rowFills || [TH.rowA, TH.rowB])[r.band ?? (ri - 1) % 2]);
      const lnB = ci >= 0
        ? `<a:lnB w="${isHdr ? 19050 : 9525}" cap="flat"><a:solidFill><a:srgbClr val="${isHdr ? hex(TH.acc) : hex(TH.bd)}"/></a:solidFill></a:lnB>`
        : '';
      return `<a:tc>` +
        `<a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(paras)}</a:txBody>` +
        `<a:tcPr marL="${E(10)}" marR="${E(10)}" marT="${E(4)}" marB="${E(4)}" anchor="ctr">${lnB}${fillXml(fill)}</a:tcPr></a:tc>`;
    }).join('');
    return `<a:tr h="${h}">${cells}</a:tr>`;
  }).join('');
  const totalH = o.rows.reduce((s, r) => s + E(r.h || 38), 0);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(name)}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${totalH}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rowsXml}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`;
}

/* ================= Animations d'entrée (<p:timing>) ===================== */
/* Vocabulaire d'effets — presetID/presetSubtype alignés sur l'export natif
   PowerPoint (registre pptx_animation_presets.json, Microsoft PowerPoint 16),
   comportements (set + animEffect / p:anim) vérifiés à la lecture. */
const FX = {
  fade:     { pid: 10, sub: 0,  filter: 'fade' },
  dissolve: { pid: 9,  sub: 0,  filter: 'dissolve' },
  wipeD:    { pid: 22, sub: 4,  filter: 'wipe(down)' },    // révèle du haut vers le bas
  wipeR:    { pid: 22, sub: 2,  filter: 'wipe(right)' },   // From Right (part du bord droit → vers la gauche)
  wipeL:    { pid: 22, sub: 8,  filter: 'wipe(left)' },   // From Left (remplissage gauche → droite)
  wipeU:    { pid: 22, sub: 1,  filter: 'wipe(up)' },
  circle:   { pid: 6,  sub: 16, filter: 'circle(in)' },
  checker:  { pid: 5,  sub: 10, filter: 'checkerboard(across)' },
  blindsH:  { pid: 3,  sub: 10, filter: 'blinds(horizontal)' },
  blindsV:  { pid: 3,  sub: 5,  filter: 'blinds(vertical)' },
  wheel:    { pid: 21, sub: 1,  filter: 'wheel(1)' },
  strips:   { pid: 18, sub: 12, filter: 'strips(downLeft)' },
  wedge:    { pid: 20, sub: 0,  filter: 'wedge' },
  split:    { pid: 16, sub: 21, filter: 'barn(inVertical)' },
  box:      { pid: 4,  sub: 16, filter: 'box(in)' },
};
function effectParXml(ids, a) {
  const setXml = spid =>
    `<p:set><p:cBhvr><p:cTn id="${ids()}" dur="1" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:to><p:strVal val="visible"/></p:to></p:set>`;
  const head = (pid, sub) =>
    `<p:cTn id="${ids()}" presetID="${pid}" presetClass="entr" presetSubtype="${sub}" ` +
    `fill="hold" grpId="0" nodeType="${a.nodeType}" dur="${a.dur}">` +
    `<p:stCondLst><p:cond delay="${a.delay}"/></p:stCondLst><p:childTnLst>`;
  const tail = '</p:childTnLst></p:cTn></p:par>';
  const spid = a.spid;

  if (a.effect === 'flyB') {                       // « Fly In » par le bas
    let x = head(2, 4) + setXml(spid);
    x += `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">` +
      `<p:cTn id="${ids()}" dur="${a.dur}" fill="hold"/>` +
      `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
      `<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>` +
      `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="1+#ppt_h/2"/></p:val></p:tav>` +
      `<p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>`;
    return `<p:par>${x}${tail}`;
  }
  if (a.effect === 'floatU') {                     // montée courte + fondu
    let x = head(2, 4) + setXml(spid);
    x += `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">` +
      `<p:cTn id="${ids()}" dur="${a.dur}" fill="hold"/>` +
      `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
      `<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>` +
      `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_y+0.05"/></p:val></p:tav>` +
      `<p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>`;
    x += `<p:animEffect transition="in" filter="fade"><p:cBhvr>` +
      `<p:cTn id="${ids()}" dur="${a.dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
      `</p:cBhvr></p:animEffect>`;
    return `<p:par>${x}${tail}`;
  }
  if (a.effect === 'zoom') {                       // « Zoom avant » (ppt_w/ppt_h 0→taille)
    let x = head(23, 16) + setXml(spid);
    for (const attr of ['ppt_w', 'ppt_h']) {
      x += `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">` +
        `<p:cTn id="${ids()}" dur="${a.dur}" fill="hold"/>` +
        `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
        `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:tavLst><p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav>` +
        `<p:tav tm="100000"><p:val><p:strVal val="#${attr}"/></p:val></p:tav></p:tavLst></p:anim>`;
    }
    x += `<p:animEffect transition="in" filter="fade"><p:cBhvr>` +
      `<p:cTn id="${ids()}" dur="${a.dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
      `</p:cBhvr></p:animEffect>`;
    return `<p:par>${x}${tail}`;
  }
  const fx = FX[a.effect] || FX.fade;
  let x = head(fx.pid, fx.sub) + setXml(spid);
  x += `<p:animEffect transition="in" filter="${fx.filter}"><p:cBhvr>` +
    `<p:cTn id="${ids()}" dur="${a.dur}"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    `</p:cBhvr></p:animEffect>`;
  return `<p:par>${x}${tail}`;
}
/* Construit <p:timing> : groupe auto (démarrage à l'ouverture de la diapo,
   conditions « natives » PowerPoint : indefinite + onBegin sur mainSeq) +
   groupe au clic. Chaque animation est portée par son propre wrapper, comme
   l'export natif de PowerPoint (cascade au clic / entrées décalées). */
function timingXml(anims) {
  if (!anims.length) return '';
  let n = 2;
  const ids = () => ++n;
  const auto = anims.filter(a => a.at === 'auto');
  const clic = anims.filter(a => a.at !== 'auto');
  const groups = [];
  if (auto.length) groups.push({ auto: true, list: auto });
  if (clic.length) groups.push({ auto: false, list: clic });
  const bld = [];
  const seen = new Set();
  let gxml = '';
  for (const g of groups) {
    const gid = ids();
    const cond = g.auto
      ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>'
      : '<p:cond delay="indefinite"/>';
    const rows = g.list.map((a, i) => {
      const wid = ids();
      const nodeType = (!g.auto && i === 0) ? 'clickEffect' : 'withEffect';
      const row = effectParXml(ids, { ...a, nodeType, delay: 0 });
      if (!seen.has(a.spid)) { seen.add(a.spid); bld.push(a.spid); }
      return `<p:par><p:cTn id="${wid}" fill="hold">` +
        `<p:stCondLst><p:cond delay="${a.delay}"/></p:stCondLst>` +
        `<p:childTnLst>${row}</p:childTnLst></p:cTn></p:par>`;
    }).join('');
    gxml += `<p:par><p:cTn id="${gid}" fill="hold"><p:stCondLst>${cond}</p:stCondLst>` +
      `<p:childTnLst>${rows}</p:childTnLst></p:cTn></p:par>`;
  }
  const bldLst = bld.length
    ? `<p:bldLst>${bld.map(s => `<p:bldP spid="${s}" grpId="0"/>`).join('')}</p:bldLst>` : '';
  return `<p:timing><p:tnLst><p:par>` +
    `<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">` +
    `<p:childTnLst>${gxml}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bldLst}</p:timing>`;
}
/* Transitions : ['fade'|'push:l'|…, spd] → XML. */
function transXml(t) {
  const kind = (t && t[0]) || 'fade';
  const spd = (t && t[1]) || 'med';
  let inner;
  switch (kind) {
    case 'push':   inner = '<p:push/>'; break;
    case 'pushU':  inner = '<p:push dir="u"/>'; break;
    case 'split':  inner = '<p:split/>'; break;
    case 'cover':  inner = '<p:cover/>'; break;
    case 'coverD': inner = '<p:cover dir="d"/>'; break;
    case 'zoom':   inner = '<p:zoom dir="in"/>'; break;
    case 'dissolve': inner = '<p:dissolve/>'; break;
    case 'wipe':   inner = '<p:wipe/>'; break;
    case 'wheel':  inner = '<p:wheel spokes="1"/>'; break;
    default:       inner = '<p:fade/>';
  }
  return `<p:transition spd="${spd}">${inner}</p:transition>`;
}

/* ==================== Fabrique de diapositive =========================== */
function mkSlide(transition) {
  const S = {
    id: 2, shapes: [], anims: [], transition: transition || ['fade', 'med'],
    rels: [], media: null, bg: null,
  };
  S.nextId = () => S.id++;
  S.addMedia = name => {
    const rId = `rId${S.rels.length + 2}`;   // rId1 = slideLayout
    S.rels.push({ id: rId, type: 'image', target: `../media/${name.split('/').pop()}` });
    return rId;
  };
  S.sp = o => { const id = S.nextId(); S.shapes.push(spXml(id, o.name || `Shape ${id}`, o)); return id; };
  S.pic = o => {
    const id = S.nextId();
    const emb = S.addMedia(o.media);
    S.shapes.push(picXml(id, o.name || `Image ${id}`, { ...o, embed: emb }));
    return id;
  };
  S.tbl = o => { const id = S.nextId(); S.shapes.push(tblXml(id, o.name || `Table ${id}`, o)); return id; };
  S.cxn = o => { const id = S.nextId(); S.shapes.push(cxnXml(id, o.name || `Ligne ${id}`, o)); return id; };
  /* anim(spid, effet, { at:'auto'|'click', delay(ms), dur(ms) }) */
  S.anim = (spid, effect, o = {}) => {
    S.anims.push({ spid, effect, at: o.at || 'click', delay: o.delay || 0, dur: o.dur || 600 });
  };
  return S;
}

/* Fond dégradé hérité du maître (ou override par slide). */
const BG_GRAD = gradXml({
  ang: 2700000,
  stops: [{ pos: 0, c: TH.bgA }, { pos: 100000, c: TH.bgB }],
});
function bgOverride(a, b) {
  return `<p:bg><p:bgPr>${gradXml({ ang: 2700000, stops: [{ pos: 0, c: a }, { pos: 100000, c: b }] })}` +
    `<a:effectLst/></p:bgPr></p:bg>`;
}
/* Décor : disques translucides discrets. */
function deco(S) {
  S.sp({ name: 'Décor 1', x: 962, y: -110, w: 430, h: 430, geom: 'ellipse',
    fill: { c: TH.acc2, a: 6 }, ln: 'none' });
  S.sp({ name: 'Décor 2', x: -120, y: 520, w: 340, h: 340, geom: 'ellipse',
    fill: { c: TH.vio, a: 5 }, ln: 'none' });
}
/* En-tête commun : kicker + titre + barre d'accent (animés en auto). */
function header(S, kicker, title) {
  const k = S.sp({
    name: 'Kicker', x: 64, y: 44, w: 900, h: 20, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: kicker.toUpperCase(), sz: 10.5, b: true, c: TH.acc2, spc: 2.2 }] }],
  });
  const t = S.sp({
    name: 'Titre', x: 64, y: 66, w: 1000, h: 46, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: title, sz: 27, b: true, c: TH.ink }] }],
  });
  const bar = S.sp({ name: 'Barre', x: 64, y: 118, w: 74, h: 5, fill: TH.acc, ln: 'none' });
  S.anim(k, 'fade', { at: 'auto', delay: 0, dur: 450 });
  S.anim(t, 'floatU', { at: 'auto', delay: 180, dur: 550 });
  S.anim(bar, 'wipeR', { at: 'auto', delay: 420, dur: 500 });
  return { k, t, bar };
}
function footer(S, D, num, total) {
  const left = [D.meta.client || D.wsName, 'Dossier HLD', D.meta.version ? 'v' + D.meta.version : '']
    .filter(Boolean).join('  ·  ');
  S.sp({ name: 'Pied gauche', x: 64, y: 688, w: 900, h: 18, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: left, sz: 8.5, c: TH.dim }] }] });
  S.sp({ name: 'Pied droite', x: 1130, y: 688, w: 86, h: 18, fill: 'none', ln: 'none',
    paras: [{ algn: 'r', runs: [{ t: `${num} / ${total}`, sz: 8.5, c: TH.dim }] }] });
}

/* ====================== Données du workspace ============================ */
function gather(ws) {
  const L = normLldInfo(ws || {});
  const racks = sortedRacks(ws || { racks: [] });
  const insts = sortedRackInstances(ws || { racks: [] });
  const wsum = warrantySummary(ws || {});
  const sites = (ws.sites || []).map(s => {
    const rs = racks.filter(r => r.siteId === s.id);
    return {
      site: s, racks: rs,
      usedU: rs.reduce((t, r) => t + r.instances.reduce((s2, i) => s2 + (i.sizeU || 0), 0), 0),
      sizeU: rs.reduce((t, r) => t + (r.sizeU || 0), 0),
      watts: rs.reduce((t, r) => t + r.instances.reduce((s2, i) => s2 + (i.watts || 0), 0), 0),
    };
  });
  const caps = racks.map(r => {
    const usedU = r.instances.reduce((s2, i) => s2 + (i.sizeU || 0), 0);
    return {
      name: r.name, site: siteName(ws, r), color: siteColor(ws, r) || TH.acc,
      sizeU: r.sizeU || 0, usedU, pct: r.sizeU ? Math.min(1, usedU / r.sizeU) : 0,
      watts: r.instances.reduce((s2, i) => s2 + (i.watts || 0), 0), maxWatts: r.maxWatts || 0,
      kg: Math.round(r.instances.reduce((s2, i) => s2 + (i.weightKg || 0), 0) * 10) / 10,
      maxKg: r.maxKg || 0,
    };
  });
  const nFilled = o => Array.isArray(o) ? o.length
    : (o && typeof o === 'object' ? Object.values(o).filter(v => String(v ?? '').trim()).length : 0);
  const wrows = insts
    .map(({ rack, inst }) => ({ rack: rack.name, name: inst.name, w: warrantyInfo(inst) }))
    .filter(x => x.w.status !== 'none')
    .sort((a, b) => a.w.days - b.w.days)
    .map(x => ({ rack: x.rack, name: x.name, end: x.w.label, status: x.w.status,
                 days: x.w.days, soon: x.w.soon }));
  return {
    ws, wsName: ws.name || 'Workspace',
    meta: {
      client: String(L.client || '').trim() || ws.name || '',
      author: String(L.author || '').trim(),
      version: String(L.version || '').trim(),
      date: String(L.date || '').trim() || new Date().toISOString().slice(0, 10),
    },
    kpi: {
      sites: sites.length, racks: racks.length, devs: insts.length,
      cables: (ws.cables || []).length,
      ports: insts.reduce((s2, x) => s2 + ((x.inst.ports || []).length), 0),
      wsum,
    },
    sites, caps,
    vlans: (L.vlans || []).slice(0, 40),
    nomen: (L.nomen || []).slice(0, 20),
    flows: (ws.flows || []).slice(0, 40),
    arch: trunc(L.architecture, 250),
    objectif: trunc(L.objectif, 240),
    wrows,
    sec: {
      fais: (L.fais || []).length, ic61: (L.ic61 || []).length,
      rules: (L.fw || []).length, profils: nFilled(L.fwProfiles),
      vpns: (L.vpns || []).length, admin: (L.adminSec || []).length,
      cams: (L.cams || []).length,
    },
  };
}

/* =========================== Diapositives =============================== */
/* 1 — Couverture */
function sCover(S, D, media) {
  S.bg = bgOverride(TH.bgCA, TH.bgCB);
  S.sp({ name: 'Décor A', x: 900, y: -150, w: 520, h: 520, geom: 'ellipse',
    fill: { c: TH.acc, a: 7 }, ln: 'none' });
  S.sp({ name: 'Décor B', x: 1040, y: 420, w: 360, h: 360, geom: 'ellipse',
    fill: { c: TH.acc2, a: 6 }, ln: 'none' });
  S.sp({ name: 'Décor C', x: -140, y: 560, w: 380, h: 380, geom: 'ellipse',
    fill: { c: TH.vio, a: 5 }, ln: 'none' });

  let logoId = null;
  if (media.logo) {
    logoId = S.pic({ name: 'Logo', media: media.logo, x: 64, y: 60, w: 64, h: 64 });
    S.anim(logoId, 'fade', { at: 'auto', delay: 0, dur: 500 });
  }
  const bar = S.sp({ name: 'Barre latérale', x: 64, y: 214, w: 6, h: 118, fill: TH.acc, ln: 'none' });
  const kick = S.sp({
    name: 'Kicker', x: 92, y: 214, w: 780, h: 22, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: 'DOSSIER DE CONCEPTION — HIGH LEVEL DESIGN', sz: 11, b: true, c: TH.acc2, spc: 2.6 }] }],
  });
  S.anim(bar, 'wipeD', { at: 'auto', delay: 120, dur: 550 });
  S.anim(kick, 'fade', { at: 'auto', delay: 320, dur: 500 });

  const title = S.sp({
    name: 'Titre', x: 92, y: 250, w: 780, h: 130, fill: 'none', ln: 'none',
    paras: [
      { runs: [{ t: D.wsName, sz: 40, b: true, c: TH.ink }], lnSpc: 104 },
      { runs: [{ t: 'Architecture cible & synthèse opérationnelle', sz: 16, c: TH.mut }], spcBef: 8 },
    ],
  });
  S.anim(title, 'flyB', { at: 'click', delay: 0, dur: 750 });

  const rule = S.sp({ name: 'Filet', x: 92, y: 398, w: 240, h: 4, fill: TH.acc2, ln: 'none' });
  S.anim(rule, 'wipeR', { at: 'click', delay: 500, dur: 550 });

  const meta = S.sp({
    name: 'Métadonnées', x: 92, y: 424, w: 700, h: 96, fill: 'none', ln: 'none',
    paras: [
      { runs: [{ t: 'Client  ', sz: 11, c: TH.dim }, { t: D.meta.client, sz: 13, b: true, c: TH.ink }] },
      { runs: [{ t: 'Auteur  ', sz: 11, c: TH.dim }, { t: D.meta.author || '—', sz: 13, c: TH.mut }], spcBef: 4 },
      { runs: [{ t: 'Version  ', sz: 11, c: TH.dim },
                { t: (D.meta.version || '—') + '   ·   ' + fmtDate(D.meta.date), sz: 13, c: TH.mut }], spcBef: 4 },
    ],
  });
  S.anim(meta, 'floatU', { at: 'click', delay: 750, dur: 650 });

  const chips = [
    [`${D.kpi.sites}`, 'site' + (D.kpi.sites > 1 ? 's' : ''), '🏢'],
    [`${D.kpi.racks}`, 'baie' + (D.kpi.racks > 1 ? 's' : ''), '🗄️'],
    [`${D.kpi.devs}`, 'équipement' + (D.kpi.devs > 1 ? 's' : ''), '📦'],
    [`${D.kpi.cables}`, 'cordon' + (D.kpi.cables > 1 ? 's' : ''), '🔌'],
  ];
  chips.forEach((c, i) => {
    const x = 92 + i * 178;
    const id = S.sp({
      name: `Puce ${i + 1}`, x, y: 566, w: 164, h: 64, geom: 'roundRect', adj: 16000,
      fill: { c: TH.card, a: 88 }, ln: { c: TH.bd, w: 1 },
      paras: [{
        algn: 'ctr', lnSpc: 104,
        runs: [{ t: `${c[2]} ${c[0]} `, sz: 16, b: true, c: TH.ink }, { t: c[1], sz: 10.5, c: TH.mut }],
      }],
      anchor: 'ctr', ins: { l: 6, r: 6, t: 6, b: 6 },
    });
    S.anim(id, 'floatU', { at: 'click', delay: 1050 + i * 140, dur: 550 });
  });

  S.sp({ name: 'Note', x: 92, y: 664, w: 700, h: 18, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: 'Généré depuis LLDraw — planification data center', sz: 9, c: TH.dim }] }] });
}

/* 2 — Sommaire */
function sAgenda(S, D, titles) {
  deco(S);
  header(S, 'Sommaire', 'Au programme');
  const n = Math.min(titles.length, 12);
  const perCol = Math.ceil(n / 2) || 1;
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = 64 + col * 596, y = 164 + row * 74;
    const num = S.sp({
      name: `Num ${i + 1}`, x, y, w: 46, h: 46, geom: 'roundRect', adj: 24000,
      fill: { c: TH.acc, a: 16 }, ln: { c: { c: TH.acc, a: 55 }, w: 1 },
      paras: [{ algn: 'ctr', runs: [{ t: String(i + 1).padStart(2, '0'), sz: 15, b: true, c: TH.acc2 }] }],
      anchor: 'ctr', ins: { l: 4, r: 4, t: 4, b: 4 },
    });
    const tx = S.sp({
      name: `Item ${i + 1}`, x: x + 64, y, w: 470, h: 46, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: titles[i], sz: 15, b: true, c: TH.ink }], lnSpc: 104 }],
      anchor: 'ctr', ins: { r: 8 },
    });
    S.anim(num, 'fade', { at: 'click', delay: i * 130, dur: 450 });
    S.anim(tx, 'floatU', { at: 'click', delay: i * 130, dur: 500 });
  }
}

/* 3 — Chiffres clés */
function sKpis(S, D) {
  deco(S);
  header(S, 'Synthèse', 'Chiffres clés');
  const wsum = D.kpi.wsum;
  const cards = [
    ['🏢', D.kpi.sites, D.kpi.sites > 1 ? 'SITES' : 'SITE', TH.acc2],
    ['🗄️', D.kpi.racks, D.kpi.racks > 1 ? 'BAIES' : 'BAIE', TH.acc],
    ['📦', D.kpi.devs, 'ÉQUIPEMENTS', TH.vio],
    ['🔌', D.kpi.cables, D.kpi.cables > 1 ? 'CORDONS' : 'CORDON', TH.amb],
    ['🗂️', D.kpi.ports, 'PORTS ÉTIQUETÉS', TH.grn],
    ['🛡️', wsum.known ? wsum.in : '—', wsum.known ? 'EN GARANTIE' : 'GARANTIES À RENSEIGNER', TH.grn],
  ];
  cards.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 64 + col * 392, y = 162 + row * 244;
    const id = S.sp({
      name: `KPI ${i + 1}`, x, y, w: 368, h: 220, geom: 'roundRect', adj: 9000,
      fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
      paras: [
        { runs: [{ t: c[0], sz: 22 }], spcAft: 8 },
        { runs: [{ t: String(c[1]), sz: 40, b: true, c: TH.ink }], lnSpc: 96 },
        { runs: [{ t: c[2], sz: 10.5, b: true, c: c[3], spc: 1.8 }], spcBef: 6 },
      ],
      ins: { l: 26, r: 20, t: 24, b: 18 },
    });
    S.anim(id, 'zoom', { at: 'click', delay: i * 150, dur: 620 });
  });
}

/* 4 — Sites & implantation */
function sSites(S, D) {
  deco(S);
  header(S, 'Périmètre', 'Sites & implantation');
  const sites = D.sites.slice(0, 2);
  if (!sites.length) {
    const id = S.sp({ name: 'Vide', x: 64, y: 200, w: 1152, h: 80, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: 'Aucun site déclaré dans le dossier — renseignez la section Sites (📘).', sz: 14, c: TH.mut }] }] });
    S.anim(id, 'fade', { at: 'click', dur: 500 });
    return;
  }
  sites.forEach((s, i) => {
    const x = 64 + i * 596, w = 572, y = 158, h = 474;
    const color = siteColor(D.ws, { siteId: s.site.id }) || TH.acc2;
    const card = S.sp({
      name: `Site ${i + 1}`, x, y, w, h, geom: 'roundRect', adj: 6000,
      fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
    });
    const chip = S.sp({
      name: `Type ${i + 1}`, x: x + w - 172, y: y + 18, w: 152, h: 30, geom: 'roundRect', adj: 50000,
      fill: { c: color, a: 16 }, ln: { c: { c: color, a: 50 }, w: 1 },
      paras: [{ algn: 'ctr', runs: [{ t: trunc(s.site.type || 'Site', 18), sz: 9.5, b: true, c: color, spc: 0.6 }], }],
      anchor: 'ctr', ins: { l: 5, r: 5, t: 3, b: 3 },
    });
    const body = S.sp({
      name: `Contenu site ${i + 1}`, x: x + 26, y: y + 22, w: w - 214, h: 150, fill: 'none', ln: 'none',
      paras: [
        { runs: [{ t: '● ', sz: 13, c: color }, { t: trunc(s.site.name || 'Site', 30), sz: 15.5, b: true, c: TH.ink }], lnSpc: 104 },
        { runs: [{ t: trunc(s.site.address || 'Adresse à renseigner', 58), sz: 11.5, c: TH.mut }], spcBef: 8 },
        { runs: [{ t: trunc(s.site.contact || '', 58) || 'Contact à renseigner', sz: 11.5, c: TH.mut }] },
      ],
      ins: { r: 6 },
    });
    const desc = S.sp({
      name: `Description ${i + 1}`, x: x + 26, y: y + 180, w: w - 52, h: 118, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: trunc(s.site.desc, 240) || 'Aucune description.', sz: 11, c: TH.dim }], lnSpc: 134 }],
    });
    S.anim(card, 'floatU', { at: 'click', delay: i * 170, dur: 620 });
    S.anim(chip, 'floatU', { at: 'click', delay: i * 170, dur: 620 });
    S.anim(body, 'fade', { at: 'click', delay: i * 170 + 150, dur: 550 });
    S.anim(desc, 'fade', { at: 'click', delay: i * 170 + 280, dur: 550 });

    const rackRows = s.racks.slice(0, 3);
    if (!rackRows.length) {
      const nr = S.sp({ name: `Baies ${i + 1}`, x: x + 26, y: y + 330, w: w - 52, h: 24, fill: 'none', ln: 'none',
        paras: [{ runs: [{ t: 'Aucun rack rattaché à ce site.', sz: 11.5, c: TH.amb }] }] });
      S.anim(nr, 'fade', { at: 'click', delay: i * 170 + 360, dur: 500 });
      return;
    }
    rackRows.forEach((r, j) => {
      const ry = y + 318 + j * 52;
      const usedU = r.instances.reduce((t, it) => t + (it.sizeU || 0), 0);
      const pct = r.sizeU ? Math.min(1, usedU / r.sizeU) : 0;
      const label = S.sp({
        name: `Baie ${i + 1}.${j + 1}`, x: x + 26, y: ry, w: w - 52, h: 20, fill: 'none', ln: 'none',
        paras: [{ runs: [
          { t: r.name, sz: 12, b: true, c: TH.ink },
          { t: `  ·  ${usedU}/${r.sizeU}U occupés`, sz: 11, c: TH.mut },
        ] }],
      });
      const track = S.sp({ name: `Piste ${i + 1}.${j + 1}`, x: x + 26, y: ry + 26, w: w - 150, h: 10,
        geom: 'roundRect', adj: 50000, fill: TH.card2, ln: { c: TH.bd, w: 0.75 } });
      const fillbar = S.sp({ name: `Jauge ${i + 1}.${j + 1}`, x: x + 26, y: ry + 26,
        w: Math.max(10, Math.round((w - 150) * pct)), h: 10,
        geom: 'roundRect', adj: 50000, fill: color, ln: 'none' });
      const pc = S.sp({ name: `Pct ${i + 1}.${j + 1}`, x: x + w - 112, y: ry + 18, w: 86, h: 26, fill: 'none', ln: 'none',
        paras: [{ algn: 'r', runs: [{ t: Math.round(pct * 100) + ' %', sz: 13, b: true, c: color }] }] });
      const d0 = i * 170 + 360 + j * 200;
      S.anim(label, 'fade', { at: 'click', delay: d0, dur: 450 });
      S.anim(track, 'fade', { at: 'click', delay: d0, dur: 450 });
      S.anim(fillbar, 'wipeL', { at: 'click', delay: d0 + 120, dur: 700 });
      S.anim(pc, 'fade', { at: 'click', delay: d0 + 300, dur: 450 });
    });
  });
}

/* 5 — Architecture cible */
function sArch(S, D) {
  deco(S);
  header(S, 'Architecture', 'Architecture cible');
  if (D.arch) {
    const intro = S.sp({ name: 'Intro', x: 64, y: 144, w: 1152, h: 54, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: D.arch, sz: 11.5, c: TH.mut }], lnSpc: 126 }] });
    S.anim(intro, 'fade', { at: 'click', delay: 0, dur: 550 });
  }
  const bands = [
    ['☁️', 'Internet & WAN', 'Accès opérateur, services cloud, SaaS', TH.acc2],
    ['📡', 'Routeurs FAI & SD-WAN', 'Liens opérateur redondés, débit garanti', TH.acc],
    ['🛡️', 'Pare-feu & sécurité', 'Filtrage, NAT, VPN, inspection', TH.red],
    ['🔀', 'Cœur de réseau', 'Switching cœur / distribution / accès', TH.vio],
    ['🗄️', 'Serveurs, stockage & VMs', 'Hyperconvergence, NAS, supervision', TH.grn],
  ];
  const y0 = D.arch ? 206 : 176;
  const bh = 66, gap = 26;
  bands.forEach((b, i) => {
    const y = y0 + i * (bh + gap);
    const band = S.sp({
      name: `Bande ${i + 1}`, x: 64, y, w: 740, h: bh, geom: 'roundRect', adj: 14000,
      fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
      paras: [{ runs: [
        { t: `${b[0]}  `, sz: 15 },
        { t: b[1], sz: 14.5, b: true, c: TH.ink },
        { t: '   ' + b[2], sz: 11, c: TH.mut },
      ] }],
      anchor: 'ctr', ins: { l: 22, r: 18, t: 6, b: 6 },
    });
    const strip = S.sp({ name: `Bande accent ${i + 1}`, x: 64, y, w: 7, h: bh,
      geom: 'roundRect', adj: 50000, fill: b[3], ln: 'none' });
    S.anim(band, 'floatU', { at: 'click', delay: 150 + i * 240, dur: 600 });
    S.anim(strip, 'wipeD', { at: 'click', delay: 150 + i * 240, dur: 600 });
    if (i < bands.length - 1) {
      const ay = y + bh + 5;
      const arr = S.sp({ name: `Flèche ${i + 1}`, x: 420, y: ay, w: 22, h: 16, geom: 'downArrow',
        fill: { c: TH.acc2, a: 70 }, ln: 'none' });
      S.anim(arr, 'fade', { at: 'click', delay: 150 + (i + 1) * 240 - 80, dur: 400 });
    }
  });
  const railY = y0;
  const railH = 5 * (bh + gap) - gap;
  const rail = S.sp({
    name: 'Rail S2S', x: 844, y: railY, w: 372, h: railH, geom: 'roundRect', adj: 7000,
    fill: { c: TH.card2 }, ln: { c: { c: TH.acc2, a: 45 }, w: 1.2 }, shadow: true,
    paras: [
      { runs: [{ t: '🔗', sz: 18 }], spcAft: 6 },
      { runs: [{ t: 'Interconnexion', sz: 15, b: true, c: TH.ink }] },
      { runs: [{ t: 'site à site', sz: 15, b: true, c: TH.ink }], lnSpc: 104 },
      { runs: [{ t: 'Tunnel chiffré IPsec / SD-WAN entre les sites, redondance des liens et politique de filtrage centralisée.',
                 sz: 11.5, c: TH.mut }], spcBef: 10, lnSpc: 136 },
      { runs: [{ t: 'SITES RELIÉS', sz: 9.5, b: true, c: TH.acc2, spc: 1.8 }], spcBef: 16 },
      ...(D.sites.length ? D.sites.slice(0, 4).map(s => ({
        runs: [{ t: '●  ', sz: 11, c: siteColor(D.ws, { siteId: s.site.id }) || TH.acc2 },
                { t: trunc(s.site.name, 26), sz: 11.5, c: TH.ink },
                { t: '  ' + trunc(s.site.type, 12), sz: 10, c: TH.dim }],
        spcBef: 8, lnSpc: 118,
      })) : [{ runs: [{ t: 'Aucun site déclaré.', sz: 11, c: TH.dim }], spcBef: 8 }]),
      { runs: [{ t: 'Bascule HA, supervision des liens et revue périodique des règles font partie du modèle opérationnel.',
                 sz: 10.5, c: TH.dim }], spcBef: 16, lnSpc: 130 },
    ],
    ins: { l: 24, r: 22, t: 22, b: 16 },
  });
  const conn = S.cxn({ name: 'Lien S2S', x: 804, y: y0 + (bh + gap) + bh / 2, w: 40, h: 4,
    ln: { c: TH.acc2, w: 1.6, dash: 'dash' } });
  S.anim(rail, 'floatU', { at: 'click', delay: 150 + bands.length * 240, dur: 650 });
  S.anim(conn, 'wipeR', { at: 'click', delay: 150 + bands.length * 240, dur: 500 });
}

/* 6 — Topologie réseau (image) */
function sTopo(S, D, media, img) {
  deco(S);
  header(S, 'Réseau', 'Topologie réseau');
  const frame = S.sp({ name: 'Cadre topo', x: 64, y: 156, w: 848, h: 478, geom: 'roundRect', adj: 4000,
    fill: TH.card2, ln: { c: TH.bd, w: 1 }, shadow: true });
  const sz = img ? (img.w ? img : { ...img, ...(jpegSize(img.bytes) || {}) }) : null;
  let picId = null;
  if (sz) {
    const r = fitRect(sz.w || 1600, sz.h || 900, 80, 172, 816, 446);
    picId = S.pic({ name: 'Topologie', media: img.media, x: r.x, y: r.y, w: r.w, h: r.h,
      ln: { c: TH.bd, w: 0.75 } });
  }
  const side = S.sp({
    name: 'Légende', x: 944, y: 156, w: 272, h: 478, geom: 'roundRect', adj: 7000,
    fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
    paras: [
      { runs: [{ t: 'PÉRIMÈTRE', sz: 10, b: true, c: TH.acc2, spc: 2 }] },
      { runs: [{ t: `${D.kpi.racks} baies · ${D.kpi.devs} équipements · ${D.kpi.cables} cordons`, sz: 12, c: TH.mut }], spcBef: 8, lnSpc: 126 },
      { runs: [{ t: 'DOMAINES', sz: 10, b: true, c: TH.acc2, spc: 2 }], spcBef: 16 },
      ...domainLines(D).map(l => ({
        runs: [{ t: '●  ', sz: 11, c: l.c }, { t: l.t, sz: 11.5, c: TH.ink },
                { t: `  ${l.n}`, sz: 10.5, c: TH.dim }],
        spcBef: 8, lnSpc: 118,
      })),
      { runs: [{ t: 'Chaque domaine regroupe les cordons du chapitre correspondant du dossier LLD.', sz: 9.5, c: TH.dim }], spcBef: 16, lnSpc: 128 },
    ],
    ins: { l: 20, r: 16, t: 20, b: 14 },
  });
  S.anim(frame, 'fade', { at: 'click', delay: 0, dur: 550 });
  if (picId != null) S.anim(picId, 'circle', { at: 'click', delay: 80, dur: 900 });
  S.anim(side, 'floatU', { at: 'click', delay: 420, dur: 650 });
}
function domainLines(D) {
  const counts = {};
  for (const c of (D.ws.cables || [])) {
    const k = c.domain || '';
    counts[k] = (counts[k] || 0) + 1;
  }
  const palette = { fai: TH.acc2, interco: TH.amb, firewall: TH.red, switching: TH.vio,
    server: TH.grn, storage: TH.acc, ids: TH.amb, cctv: TH.red, pointage: TH.grn, '': TH.mut };
  return Object.entries(counts).slice(0, 7).map(([k, n]) => ({
    t: cableDomainLabel(k), n: n + ' cordon' + (n > 1 ? 's' : ''), c: palette[k] || TH.mut,
  }));
}

/* 7 — Plan d'ensemble (image) */
function sPlan(S, D, media, img) {
  deco(S);
  header(S, 'Implantation', 'Plan d’ensemble des baies');
  const frame = S.sp({ name: 'Cadre plan', x: 64, y: 156, w: 1152, h: 470, geom: 'roundRect', adj: 3000,
    fill: TH.card2, ln: { c: TH.bd, w: 1 }, shadow: true });
  const sz = img ? (img.w ? img : { ...img, ...(jpegSize(img.bytes) || {}) }) : null;
  let picId = null;
  if (sz) {
    const r = fitRect(sz.w || 1600, sz.h || 900, 82, 172, 1116, 438);
    picId = S.pic({ name: 'Plan', media: img.media, x: r.x, y: r.y, w: r.w, h: r.h,
      ln: { c: TH.bd, w: 0.75 } });
  }
  const cap = S.sp({ name: 'Légende plan', x: 64, y: 638, w: 1152, h: 34, fill: 'none', ln: 'none',
    paras: [{ runs: [
      { t: 'Vue Élévations  ', sz: 11, b: true, c: TH.acc2 },
      { t: `— ${D.kpi.racks} baies, ${D.kpi.devs} équipements, ${D.kpi.ports} ports étiquetés · export haute définition du board.`, sz: 11, c: TH.mut },
    ] }] });
  S.anim(frame, 'fade', { at: 'click', delay: 0, dur: 550 });
  if (picId != null) S.anim(picId, 'fade', { at: 'click', delay: 100, dur: 850 });
  S.anim(cap, 'floatU', { at: 'click', delay: 500, dur: 550 });
}

/* 8 — Nomenclature & adressage */
function sAdressage(S, D) {
  deco(S);
  header(S, 'Référentiel', 'Nomenclature & adressage');
  const vl = D.vlans.slice(0, 9);
  const rows = [{ h: 40, cells: ['VLAN', 'Nom', 'Subnet', 'Passerelle', 'Site'].map(t => ({ t })) }];
  vl.forEach((v, i) => rows.push({
    h: 40, band: i % 2,
    cells: [
      { t: String(v.vid ?? ''), c: TH.acc2, b: true, algn: 'ctr' },
      { t: trunc(v.name, 14), c: TH.ink },
      { t: trunc(v.subnet, 18), c: TH.ink },
      { t: trunc(v.gw, 16), c: TH.mut },
      { t: trunc(v.site || v.purpose || '', 22), c: TH.mut },
    ],
  }));
  const tableId = S.tbl({
    name: 'Registre VLANs', x: 64, y: 158, w: 700, cols: [64, 130, 160, 150, 196],
    rows: rows.length > 1 ? rows : [{
      h: 40,
      cells: [
        { t: '—' }, { t: 'Aucun VLAN déclaré', c: TH.ink },
        { t: 'Ouvrez 📘 puis renseignez', c: TH.mut }, { t: '', c: TH.mut }, { t: '', c: TH.mut },
      ],
    }],
    colAlign: ['ctr', 'l', 'l', 'l', 'l'],
  });
  const nom = D.nomen.slice(0, 6);
  const nomParas = [
    { runs: [{ t: 'RÈGLES DE NOMMAGE', sz: 10, b: true, c: TH.acc2, spc: 2 }] },
  ];
  if (nom.length) {
    nom.forEach(n => nomParas.push({
      runs: [
        { t: (n.prefix || '—') + '  ', sz: 13, b: true, c: TH.ink },
        { t: trunc(n.type, 16), sz: 11.5, c: TH.mut },
        { t: '  ·  ' + trunc(n.rule, 44), sz: 10.5, c: TH.dim },
      ], spcBef: 12, lnSpc: 118,
    }));
  } else {
    nomParas.push({ runs: [{ t: 'Aucune règle saisie — complétez la nomenclature dans 📘.', sz: 11.5, c: TH.mut }], spcBef: 10 });
  }
  const card = S.sp({
    name: 'Nomenclature', x: 800, y: 158, w: 416, h: 466, geom: 'roundRect', adj: 6000,
    fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
    paras: nomParas, ins: { l: 22, r: 18, t: 22, b: 16 },
  });
  S.anim(tableId, 'wipeD', { at: 'click', delay: 0, dur: 800 });
  S.anim(card, 'floatU', { at: 'click', delay: 350, dur: 650 });
}

/* 9 — Flux & services critiques */
function sFlux(S, D) {
  deco(S);
  header(S, 'Échanges', 'Flux & services critiques');
  const fl = D.flows.slice(0, 9);
  const rows = [{ h: 40, cells: ['Flux', 'Source', 'Destination', 'Protocole', 'Sens'].map(t => ({ t })) }];
  fl.forEach((f, i) => rows.push({
    h: 40, band: i % 2,
    cells: [
      { t: trunc(f.name, 30), c: TH.ink, b: true },
      { t: trunc(f.src, 34), c: TH.mut },
      { t: trunc(f.dst, 36), c: TH.mut },
      { t: trunc(f.proto, 22), c: TH.acc2 },
      { t: f.sens === 'uni' ? '→ unilatéral' : '⇄ bilatéral', c: f.sens === 'uni' ? TH.amb : TH.grn, algn: 'ctr' },
    ],
  }));
  const tableId = S.tbl({
    name: 'Matrice de flux', x: 64, y: 158, w: 1152, cols: [250, 268, 300, 200, 134],
    rows: rows.length > 1 ? rows : [{
      h: 40,
      cells: [
        { t: 'Aucun flux déclaré', c: TH.ink }, { t: '—' }, { t: '—' }, { t: '—' },
        { t: 'ch. 14', c: TH.mut },
      ],
    }],
    colAlign: ['l', 'l', 'l', 'l', 'ctr'],
  });
  const note = S.sp({ name: 'Note flux', x: 64, y: 640, w: 1152, h: 24, fill: 'none', ln: 'none',
    paras: [{ runs: [
      { t: `${D.flows.length} flux déclarés`, sz: 11, b: true, c: TH.ink },
      { t: '  ·  la matrice complète, avec usage détaillé, figure au chapitre « Flux réseau » du dossier LLD.', sz: 11, c: TH.mut },
    ] }] });
  S.anim(tableId, 'fade', { at: 'click', delay: 0, dur: 750 });
  S.anim(note, 'floatU', { at: 'click', delay: 450, dur: 550 });
}

/* 10 — Capacité & puissance */
function sCapacite(S, D) {
  deco(S);
  header(S, 'Capacité', 'Capacité & puissance');
  const caps = D.caps.slice(0, 4);
  caps.forEach((c, i) => {
    const y = 166 + i * 124;
    const label = S.sp({ name: `Cap ${i + 1}`, x: 64, y, w: 800, h: 24, fill: 'none', ln: 'none',
      paras: [{ runs: [
        { t: '● ', sz: 13, c: c.color },
        { t: c.name, sz: 15, b: true, c: TH.ink },
        { t: `  ·  ${c.site}`, sz: 12, c: TH.mut },
        { t: `  ·  ${c.usedU}/${c.sizeU}U`, sz: 12, c: TH.mut },
      ] }] });
    const track = S.sp({ name: `Piste cap ${i + 1}`, x: 64, y: y + 36, w: 760, h: 18,
      geom: 'roundRect', adj: 50000, fill: TH.card2, ln: { c: TH.bd, w: 0.75 } });
    const fillbar = S.sp({ name: `Jauge cap ${i + 1}`, x: 64, y: y + 36,
      w: Math.max(12, Math.round(760 * c.pct)), h: 18, geom: 'roundRect', adj: 50000,
      grad: { ang: 0, stops: [{ pos: 0, c: c.color, a: 75 }, { pos: 100000, c: c.color }] }, ln: 'none' });
    const pc = S.sp({ name: `Pct cap ${i + 1}`, x: 826, y: y + 30, w: 104, h: 30, fill: 'none', ln: 'none',
      paras: [{ algn: 'r', runs: [{ t: Math.round(c.pct * 100) + ' %', sz: 17, b: true, c: TH.ink }] }] });
    const meta = S.sp({ name: `Meta cap ${i + 1}`, x: 954, y: y + 10, w: 262, h: 58, fill: 'none', ln: 'none',
      paras: [
        { runs: [{ t: '⚡ ', sz: 11 }, { t: c.maxWatts ? `${c.watts} W / ${c.maxWatts} W` : `${c.watts} W`, sz: 11.5, c: TH.mut }] },
        { runs: [{ t: '⚖️ ', sz: 11 }, { t: c.maxKg ? `${c.kg} kg / ${c.maxKg} kg` : `${c.kg} kg`, sz: 11.5, c: TH.mut }], spcBef: 4 },
      ] });
    const d0 = i * 230;
    S.anim(label, 'floatU', { at: 'click', delay: d0, dur: 520 });
    S.anim(track, 'fade', { at: 'click', delay: d0, dur: 450 });
    S.anim(fillbar, 'wipeL', { at: 'click', delay: d0 + 140, dur: 850 });
    S.anim(pc, 'fade', { at: 'click', delay: d0 + 420, dur: 450 });
    S.anim(meta, 'fade', { at: 'click', delay: d0 + 420, dur: 450 });
  });
  if (!caps.length) {
    const id = S.sp({ name: 'Vide cap', x: 64, y: 200, w: 1152, h: 60, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: 'Aucune baie à mesurer.', sz: 14, c: TH.mut }] }] });
    S.anim(id, 'fade', { at: 'click', dur: 450 });
  } else {
    const totW = caps.reduce((t, c) => t + (c.watts || 0), 0);
    const maxW = caps.reduce((t, c) => t + (c.maxWatts || 0), 0);
    const avg = Math.round(caps.reduce((t, c) => t + (c.pct || 0), 0) / caps.length * 100);
    let sy = 166 + caps.length * 124 + 8;
    if (sy + 56 > 656) sy = 606;
    const sum = S.sp({ name: 'Synthèse capacité', x: 64, y: sy, w: 1152, h: 52, geom: 'roundRect', adj: 16000,
      fill: TH.card, ln: { c: TH.bd, w: 1 },
      paras: [{ algn: 'ctr', runs: [
        { t: 'SYNTHÈSE   ', sz: 10.5, b: true, c: TH.acc2, spc: 1.6 },
        { t: `${totW} W équipés`, sz: 13.5, b: true, c: TH.ink },
        { t: maxW ? ` / ${maxW} W dimensionnés` : '', sz: 12.5, c: TH.mut },
        { t: '   ·   ', sz: 12.5, c: TH.dim },
        { t: `occupation moyenne ${avg} %`, sz: 13, c: TH.ink },
        { t: '   ·   ', sz: 12.5, c: TH.dim },
        { t: `${caps.length} baies suivies`, sz: 13, c: TH.ink },
      ] }], anchor: 'ctr' });
    S.anim(sum, 'floatU', { at: 'click', delay: 860, dur: 550 });
  }
}

/* 11 — Garanties & maintenance */
function sGaranties(S, D) {
  deco(S);
  header(S, 'Maintenance', 'Garanties & maintenance');
  const w = D.kpi.wsum;
  if (!w.known) {
    const id = S.sp({ name: 'Vide garanties', x: 64, y: 200, w: 1152, h: 60, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: 'Aucune date de garantie renseignée — complétez les fiches devices.', sz: 14, c: TH.mut }] }] });
    S.anim(id, 'fade', { at: 'click', dur: 450 });
    return;
  }
  const segs = [
    { n: w.in, c: TH.grn, lbl: 'en garantie' },
    { n: w.soon, c: TH.amb, lbl: 'expirent < 90 j' },
    { n: w.out, c: TH.red, lbl: 'hors garantie' },
  ].filter(s => s.n > 0);
  const totalW = 1152, gap = 8;
  let x = 64;
  const usable = totalW - gap * (segs.length - 1);
  segs.forEach((s, i) => {
    const sw = Math.max(24, Math.round(usable * (s.n / Math.max(1, w.known))));
    const bar = S.sp({ name: `Seg ${i + 1}`, x, y: 174, w: sw, h: 22, geom: 'roundRect', adj: 50000,
      fill: s.c, ln: 'none' });
    S.anim(bar, 'wipeL', { at: 'click', delay: i * 260, dur: 750 });
    x += sw + gap;
  });
  const legend = S.sp({ name: 'Légende garanties', x: 64, y: 208, w: 1152, h: 34, fill: 'none', ln: 'none',
    paras: [{ runs: segs.flatMap(s => [
      { t: '● ', sz: 13, c: s.c },
      { t: `${s.n} ${s.lbl}    `, sz: 12, b: true, c: TH.mut, spc: 0.4 },
    ]) }] });
  S.anim(legend, 'fade', { at: 'click', delay: 780, dur: 450 });
  const listTitle = S.sp({ name: 'Titre échéances', x: 64, y: 288, w: 1152, h: 24, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: 'ÉCHÉANCES À SURVEILLER', sz: 10, b: true, c: TH.acc2, spc: 2 }] }] });
  S.anim(listTitle, 'fade', { at: 'click', delay: 880, dur: 450 });
  const rows = D.wrows.slice(0, 5);
  if (!rows.length) {
    const none = S.sp({ name: 'Aucune échéance', x: 64, y: 326, w: 1152, h: 40, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: 'Aucune échéance active pour ce workspace.', sz: 12.5, c: TH.mut }] }] });
    S.anim(none, 'fade', { at: 'click', delay: 820, dur: 450 });
    return;
  }
  rows.forEach((r, i) => {
    const y = 326 + i * 64;
    const st = r.status === 'out'
      ? { txt: '⛔ hors garantie', c: TH.red }
      : r.soon
        ? { txt: `⚠️ dans ${r.days} j`, c: TH.amb }
        : { txt: '✅ en garantie', c: TH.grn };
    const card = S.sp({ name: `Échéance ${i + 1}`, x: 64, y, w: 1152, h: 52, geom: 'roundRect', adj: 14000,
      fill: TH.card, ln: { c: TH.bd, w: 1 } });
    const nm = S.sp({ name: `Échéance nom ${i + 1}`, x: 86, y, w: 700, h: 52, fill: 'none', ln: 'none',
      paras: [{ runs: [
        { t: r.name, sz: 13, b: true, c: TH.ink },
        { t: `  ·  ${r.rack}`, sz: 11.5, c: TH.mut },
      ] }], anchor: 'ctr' });
    const dt = S.sp({ name: `Échéance date ${i + 1}`, x: 790, y, w: 240, h: 52, fill: 'none', ln: 'none',
      paras: [{ algn: 'r', runs: [{ t: r.end || '—', sz: 12.5, c: TH.mut }] }], anchor: 'ctr' });
    const sd = S.sp({ name: `Échéance statut ${i + 1}`, x: 1040, y, w: 158, h: 52, fill: 'none', ln: 'none',
      paras: [{ algn: 'r', runs: [{ t: st.txt, sz: 11.5, b: true, c: st.c }] }], anchor: 'ctr' });
    const d0 = 950 + i * 130;
    S.anim(card, 'floatU', { at: 'click', delay: d0, dur: 520 });
    S.anim(nm, 'floatU', { at: 'click', delay: d0, dur: 520 });
    S.anim(dt, 'floatU', { at: 'click', delay: d0, dur: 520 });
    S.anim(sd, 'floatU', { at: 'click', delay: d0, dur: 520 });
  });
}

/* 12 — Sécurité & interconnexion */
function sSecurite(S, D) {
  deco(S);
  header(S, 'Sécurité', 'Sécurité & interconnexion');
  const s = D.sec;
  const items = [
    ['🌐', s.fais, s.fais > 1 ? 'opérateurs FAI' : 'opérateur FAI', 'Accès Internet & liens', TH.acc2],
    ['🔗', s.ic61, 'extrémités S2S', 'Interconnexion site à site', TH.acc],
    ['🛡️', s.rules, 'règles & NAT', 'Politique de filtrage', TH.red],
    ['🧱', s.profils, 'profils actifs', 'Inspection & contrôle', TH.vio],
    ['🔒', s.vpns, s.vpns > 1 ? 'tunnels VPN' : 'tunnel VPN', 'Accès distant chiffré', TH.amb],
    ['👤', s.admin, s.admin > 1 ? 'comptes admin' : 'compte admin', 'Comptes d’administration', TH.grn],
  ];
  const any = items.reduce((t, it) => t + it[1], 0);
  if (!any) {
    const id = S.sp({ name: 'Vide sécu', x: 64, y: 200, w: 1152, h: 60, fill: 'none', ln: 'none',
      paras: [{ runs: [{ t: 'Chapitres sécurité non renseignés — ouvrez 📘 pour compléter le dossier.', sz: 14, c: TH.mut }] }] });
    S.anim(id, 'fade', { at: 'click', dur: 450 });
    return;
  }
  items.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 64 + col * 392, y = 162 + row * 244;
    const id = S.sp({
      name: `Sécu ${i + 1}`, x, y, w: 368, h: 220, geom: 'roundRect', adj: 9000,
      fill: TH.card, ln: { c: TH.bd, w: 1 }, shadow: true,
      paras: [
        { runs: [{ t: it[0], sz: 22 }], spcAft: 8 },
        { runs: [{ t: it[1] || '—', sz: 40, b: true, c: TH.ink },
                  { t: it[2] ? '  ' + it[2] : '', sz: 12, c: TH.mut }], lnSpc: 98 },
        { runs: [{ t: it[3], sz: 11.5, c: it[4], b: true }], spcBef: 8 },
      ],
      ins: { l: 26, r: 20, t: 24, b: 18 },
    });
    S.anim(id, 'circle', { at: 'click', delay: i * 150, dur: 650 });
  });
}

/* 13 — Prochaines étapes */
function sRoadmap(S, D) {
  deco(S);
  header(S, 'Trajectoire', 'Prochaines étapes');
  const sub = S.sp({ name: 'Intro trajectoire', x: 64, y: 146, w: 1152, h: 30, fill: 'none', ln: 'none',
    paras: [{ runs: [{ t: 'Feuille de route de bascule en 4 jalons — de la recette des livrables à l’exploitation quotidienne.', sz: 12.5, c: TH.mut }] }] });
  S.anim(sub, 'fade', { at: 'click', delay: 0, dur: 500 });
  const line = S.sp({ name: 'Ligne', x: 130, y: 306, w: 1020, h: 3, fill: { c: TH.bd }, ln: 'none' });
  S.anim(line, 'wipeL', { at: 'click', delay: 0, dur: 900 });
  const steps = [
    ['1', 'Recette & validation', 'Vérification des élévations, du câblage et des plans de ports avec les équipes.', TH.acc2],
    ['2', 'Préparation', 'Formalisation IP / VLAN, nomenclature, comptes d’administration et règles firewall.', TH.acc],
    ['3', 'Migration & bascule', 'Glissement progressif des services, bascule S2S et tests de bout en bout.', TH.vio],
    ['4', 'Exploitation', 'Supervision, suivi des garanties, revue de capacité et amélioration continue.', TH.grn],
  ];
  steps.forEach((st, i) => {
    const x = 64 + i * 294;
    const cx = x + 135;
    const circ = S.sp({ name: `Étape ${i + 1}`, x: cx - 26, y: 283, w: 52, h: 52, geom: 'ellipse',
      fill: TH.bgA, ln: { c: st[3], w: 2 },
      paras: [{ algn: 'ctr', runs: [{ t: st[0], sz: 17, b: true, c: st[3] }] }],
      anchor: 'ctr', ins: { l: 4, r: 4, t: 4, b: 4 } });
    const title = S.sp({ name: `Étape titre ${i + 1}`, x, y: 358, w: 270, h: 54, fill: 'none', ln: 'none',
      paras: [{ algn: 'ctr', runs: [{ t: st[1], sz: 15, b: true, c: TH.ink }], lnSpc: 110 }] });
    const desc = S.sp({ name: `Étape desc ${i + 1}`, x, y: 418, w: 270, h: 150, fill: 'none', ln: 'none',
      paras: [{ algn: 'ctr', runs: [{ t: st[2], sz: 11.5, c: TH.mut }], lnSpc: 134 }] });
    const d0 = 300 + i * 240;
    S.anim(circ, 'fade', { at: 'click', delay: d0, dur: 500 });
    S.anim(title, 'floatU', { at: 'click', delay: d0 + 80, dur: 550 });
    S.anim(desc, 'fade', { at: 'click', delay: d0 + 200, dur: 550 });
  });
  const foot = S.sp({ name: 'Note roadmap', x: 64, y: 600, w: 1152, h: 30, fill: 'none', ln: 'none',
    paras: [{ algn: 'ctr', runs: [
      { t: 'Chaque jalon est jalonné des révisions du dossier', sz: 11.5, c: TH.dim },
      { t: D.meta.version ? ` (version actuelle ${D.meta.version})` : '', sz: 11.5, c: TH.dim },
      { t: ' — gouvernance : approbateurs & réviseurs en page de garde.', sz: 11.5, c: TH.dim },
    ] }] });
  S.anim(foot, 'fade', { at: 'click', delay: 1350, dur: 550 });
}

/* 14 — Clôture */
function sClosing(S, D, media) {
  S.bg = bgOverride(TH.bgCA, TH.bgCB);
  S.sp({ name: 'Décor A', x: -130, y: -130, w: 460, h: 460, geom: 'ellipse',
    fill: { c: TH.acc, a: 7 }, ln: 'none' });
  S.sp({ name: 'Décor B', x: 980, y: 420, w: 440, h: 440, geom: 'ellipse',
    fill: { c: TH.acc2, a: 6 }, ln: 'none' });
  const big = S.sp({ name: 'Merci', x: 140, y: 236, w: 1000, h: 96, fill: 'none', ln: 'none',
    paras: [{ algn: 'ctr', runs: [{ t: 'Merci.', sz: 40, b: true, c: TH.ink }] }] });
  const sub = S.sp({ name: 'Sous-titre', x: 190, y: 346, w: 900, h: 64, fill: 'none', ln: 'none',
    paras: [
      { algn: 'ctr', runs: [{ t: `Dossier HLD — ${D.meta.client}`, sz: 17, c: TH.mut }] },
      { algn: 'ctr', runs: [{ t: [D.meta.version && `version ${D.meta.version}`, fmtDate(D.meta.date)].filter(Boolean).join('  ·  ') || 'Prêt pour revue', sz: 13, c: TH.dim }], spcBef: 6 },
    ] });
  const rule = S.sp({ name: 'Filet', x: 566, y: 440, w: 148, h: 4, fill: TH.acc, ln: 'none' });
  const contact = S.sp({ name: 'Contact', x: 190, y: 470, w: 900, h: 40, fill: 'none', ln: 'none',
    paras: [{ algn: 'ctr', runs: [{ t: D.meta.author || 'Équipe infrastructure', sz: 14, b: true, c: TH.acc2 }] }] });
  S.anim(big, 'flyB', { at: 'auto', delay: 0, dur: 800 });
  S.anim(sub, 'fade', { at: 'auto', delay: 500, dur: 600 });
  S.anim(rule, 'wipeR', { at: 'auto', delay: 900, dur: 550 });
  S.anim(contact, 'fade', { at: 'auto', delay: 1150, dur: 600 });
  if (media.logo) {
    const lg = S.pic({ name: 'Logo final', media: media.logo, x: 608, y: 552, w: 64, h: 64, alpha: 85 });
    S.anim(lg, 'fade', { at: 'auto', delay: 1400, dur: 700 });
  }
}
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/* ===================== XML des parties du package ======================= */
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function slideXml(S) {
  const bg = S.bg || '';
  const trans = transXml(S.transition);
  const timing = timingXml(S.anims);
  return XMLDECL + `<p:sld ${NS}>` +
    `<p:cSld>${bg}<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    S.shapes.join('') +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    trans + timing +
    `</p:sld>`;
}
function slideRelsXml(S) {
  const rels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
    ...S.rels];
  return XMLDECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels.map(r => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`).join('') +
    `</Relationships>`;
}
function layoutXml() {
  return XMLDECL + `<p:sldLayout ${NS} type="blank" preserve="1">` +
    `<p:cSld name=" vierge"><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}
function masterXml() {
  return XMLDECL + `<p:sldMaster ${NS}>` +
    `<p:cSld><p:bg><p:bgPr>${BG_GRAD}<a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
    `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}
function layoutRelsXml() {
  return XMLDECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
    `</Relationships>`;
}
function masterRelsXml() {
  return XMLDECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
    `</Relationships>`;
}
function themeXml() {
  const FILL_LST =
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst>' +
    '<a:lin ang="5400000" scaled="0"/></a:gradFill>' +
    '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst>' +
    '<a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>';
  const LN_LST =
    '<a:lnStyleLst>' +
    '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
    '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
    '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
    '</a:lnStyleLst>';
  const EFF_LST =
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0">' +
    '<a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>';
  const BG_LST =
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>' +
    '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst>' +
    '<a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst>';
  return XMLDECL +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LLDraw HLD">` +
    `<a:themeElements>` +
    `<a:clrScheme name="LLDraw HLD">` +
    `<a:dk1><a:srgbClr val="${TH.bgA}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="1B2B4A"/></a:dk2><a:lt2><a:srgbClr val="E7ECF5"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="${TH.acc}"/></a:accent1><a:accent2><a:srgbClr val="${TH.acc2}"/></a:accent2>` +
    `<a:accent3><a:srgbClr val="${TH.grn}"/></a:accent3><a:accent4><a:srgbClr val="${TH.amb}"/></a:accent4>` +
    `<a:accent5><a:srgbClr val="${TH.vio}"/></a:accent5><a:accent6><a:srgbClr val="${TH.red}"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="${TH.acc2}"/></a:hlink><a:folHlink><a:srgbClr val="${TH.vio}"/></a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="LLDraw HLD">` +
    `<a:majorFont><a:latin typeface="Segoe UI Semibold"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="LLDraw HLD">${FILL_LST}${LN_LST}${EFF_LST}${BG_LST}</a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
function presentationXml(n) {
  const slides = Array.from({ length: n }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  return XMLDECL + `<p:presentation ${NS}>` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${slides}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `<p:defaultTextStyle><a:defPPr><a:defRPr lang="fr-FR"/></a:defPPr></p:defaultTextStyle>` +
    `</p:presentation>`;
}
function presentationRelsXml(n) {
  const slides = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  return XMLDECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slides + `</Relationships>`;
}
function contentTypesXml(n) {
  const slides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return XMLDECL + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    slides +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
}
function rootRelsXml() {
  return XMLDECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;
}
function coreXml(D) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const creator = D.meta.author || 'LLDraw';
  return XMLDECL + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>Dossier HLD — ${esc(D.wsName)}</dc:title>` +
    `<dc:subject>High Level Design</dc:subject>` +
    `<dc:creator>${esc(creator)}</dc:creator>` +
    `<cp:lastModifiedBy>${esc(creator)}</cp:lastModifiedBy>` +
    `<dc:description>Présentation HLD générée par LLDraw.</dc:description>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    `<cp:revision>1</cp:revision></cp:coreProperties>`;
}
function appXml(n) {
  return XMLDECL + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>LLDraw</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat>` +
    `<Slides>${n}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips>` +
    `<Company></Company><AppVersion>16.0000</AppVersion></Properties>`;
}

/* ====================== Construction du deck =========================== */
function build(ws, opts = {}) {
  const D = gather(ws);
  const media = [];                              // { name, bytes }
  const regMedia = (bytes, ext) => {
    if (!bytes || !bytes.length) return null;
    const name = `ppt/media/image${media.length + 1}.${ext}`;
    media.push({ name, bytes });
    return name;
  };
  const imgOf = (o, fallbackExt) => {
    if (!o || !o.bytes || !o.bytes.length) return null;
    const isPng = o.ext === 'png' || (o.bytes[0] === 0x89 && o.bytes[1] === 0x50);
    const dims = isPng ? pngSize(o.bytes) : jpegSize(o.bytes);
    return {
      bytes: o.bytes, w: o.w || (dims && dims.w), h: o.h || (dims && dims.h),
      media: regMedia(o.bytes, isPng ? 'png' : (fallbackExt || 'jpeg')),
    };
  };
  const mLogo = imgOf(opts.logo, 'png');
  const mPlan = imgOf(opts.plan, 'jpeg');
  const mTopo = imgOf(opts.topo, 'jpeg');

  /* --- Diapositives de contenu (l'ordre devient le sommaire) --- */
  const content = [];
  const push = (title, S) => content.push({ title, S });

  let S = mkSlide(['fade', 'med']);  sKpis(S, D);            push('Chiffres clés', S);
  S = mkSlide(['fade', 'med']);      sSites(S, D);            push('Sites & implantation', S);
  S = mkSlide(['push', 'med']);      sArch(S, D);             push('Architecture cible', S);
  if (mTopo) { S = mkSlide(['dissolve', 'med']); sTopo(S, D, media, mTopo); push('Topologie réseau', S); }
  if (mPlan) { S = mkSlide(['fade', 'med']);     sPlan(S, D, media, mPlan); push('Plan d’ensemble', S); }
  if (D.vlans.length || D.nomen.length) {
    S = mkSlide(['split', 'med']);   sAdressage(S, D);        push('Nomenclature & adressage', S);
  }
  if (D.flows.length) {
    S = mkSlide(['wipe', 'med']);    sFlux(S, D);             push('Flux & services critiques', S);
  }
  S = mkSlide(['cover', 'med']);     sCapacite(S, D);         push('Capacité & puissance', S);
  S = mkSlide(['fade', 'med']);      sGaranties(S, D);        push('Garanties & maintenance', S);
  S = mkSlide(['zoom', 'med']);      sSecurite(S, D);         push('Sécurité & interconnexion', S);
  S = mkSlide(['pushU', 'med']);     sRoadmap(S, D);          push('Prochaines étapes', S);

  /* --- Couverture / sommaire / clôture --- */
  const cover = mkSlide(['fade', 'slow']);
  sCover(cover, D, { logo: mLogo && mLogo.media });
  const agenda = mkSlide(['push', 'med']);
  sAgenda(agenda, D, content.map(c => c.title));
  const closing = mkSlide(['zoom', 'slow']);
  sClosing(closing, D, { logo: mLogo && mLogo.media });

  const all = [cover, agenda, ...content.map(c => c.S), closing];
  const total = all.length;
  all.forEach((Sl, i) => { if (Sl !== cover && Sl !== closing) footer(Sl, D, i + 1, total); });

  /* --- Assemblage du package --- */
  const files = [];
  files.push({ name: '[Content_Types].xml', data: contentTypesXml(all.length) });
  files.push({ name: '_rels/.rels', data: rootRelsXml() });
  files.push({ name: 'docProps/core.xml', data: coreXml(D) });
  files.push({ name: 'docProps/app.xml', data: appXml(all.length) });
  files.push({ name: 'ppt/presentation.xml', data: presentationXml(all.length) });
  files.push({ name: 'ppt/_rels/presentation.xml.rels', data: presentationRelsXml(all.length) });
  files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: masterXml() });
  files.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRelsXml() });
  files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml() });
  files.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRelsXml() });
  files.push({ name: 'ppt/theme/theme1.xml', data: themeXml() });
  all.forEach((Sl, i) => {
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(Sl) });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRelsXml(Sl) });
  });
  for (const m of media) files.push({ name: m.name, data: m.bytes });
  return zip(files);
}

return { build };
})();
