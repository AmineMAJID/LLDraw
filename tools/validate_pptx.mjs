/* Validateur PPTX — filet de régression « réparation PowerPoint ».
   Vérifie les règles qui ont réellement déclenché des réparations :
   - XML bien formé (toutes les parties ppt/*)
   - <p:par> : exactement un <p:cTn> direct (double wrapper = réparation)
   - sz de texte dans [100, 4000] (surcharge hors bornes = réparation)
   - a:gd UNIQUEMENT sous un prstGeom dont le preset a un guide adj
     (rect/line n'en ont pas → PowerPoint supprime et répare)
   - a:tc sans marL/marR/marT/marB/anchor (à vivre sur a:tcPr)
   - master : <p:sldLayoutIdLst> présent
   - rels : chaque cible existe ; Content-Types : chaque Override existe
   - timing : 1 racine p:timing, ids 1=tmRoot 2=mainSeq, auto=onBegin tn=2

   Usage : NODE_PATH=/tmp/node_modules node tools/validate_pptx.mjs [fichier.pptx] */
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from '/tmp/node_modules/jsdom/lib/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PPTX = process.argv[2] || path.join(ROOT, 'tools/exports-test/HLD-demo.pptx');
const ADJ_OK = new Set(['roundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect',
  'ellipse', 'hexagon', 'octagon', 'pentagon', 'diamond', 'parallelogram', 'trapezoid',
  'chevron', 'homePlate', 'cube', 'can', 'donut', 'frame', 'halfFrame',
  'snip1Rect', 'snipRoundRect', 'snip2SameRect', 'snip2DiagRect', 'plus']);
const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

const dir = mkdtempSync(path.join(tmpdir(), 'vptx-'));
execSync(`unzip -oq ${JSON.stringify(PPTX)} -d ${JSON.stringify(dir)}`);
const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
const parse = (rel) => new JSDOM(read(rel), { contentType: 'text/xml' }).window.document;
const issues = [];
const err = (m) => issues.push(m);

/* 1 ─ XML bien formé : toutes les parties */
const { execSync: ls } = { execSync: (c) => execSync(c, { encoding: 'utf8' }) };
const parts = ls(`find ${JSON.stringify(dir)} -name '*.xml' -o -name '*.rels'`)
  .trim().split('\n').filter(Boolean);
const q = (el, p, l) => el ? [...el.getElementsByTagNameNS(p, l)] : [];
let slides = [];
for (const f of parts) {
  const rel = path.relative(dir, f);
  try { new JSDOM(read(rel), { contentType: 'text/xml' }).window.document; }
  catch (e) { err(`XML mal formé : ${rel} — ${e.message}`); continue; }
  if (/^ppt\/slides\/slide\d+\.xml$/.test(rel)) slides.push(rel);
}
slides.sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

for (const rel of slides) {
  const doc = parse(rel);
  const S = rel.replace(/^ppt\//, '');
  /* 2 ─ un seul cTn direct par par */
  for (const par of q(doc, NS.p, 'par')) {
    const kids = [...par.children].filter(c => c.namespaceURI === NS.p && c.localName === 'cTn');
    if (kids.length !== 1) err(`${S} : p:par avec ${kids.length} p:cTn directs (attendu 1)`);
  }
  /* 3 ─ bornes sz */
  for (const el of [...q(doc, NS.a, 'rPr'), ...q(doc, NS.a, 'defRPr'), ...q(doc, NS.p, 'endParaRPr')]) {
    const sz = el.getAttribute('sz');
    if (sz && (+sz < 100 || +sz > 4000)) err(`${S} : sz hors bornes [100,4000] = ${sz}`);
  }
  /* 4 ─ a:gd seulement sous preset avec adj */
  for (const gd of q(doc, NS.a, 'gd')) {
    const av = gd.parentElement, pg = av && av.parentElement;
    if (av && av.localName === 'avLst' && pg && pg.localName === 'prstGeom') {
      const prst = pg.getAttribute('prst');
      if (!ADJ_OK.has(prst)) err(`${S} : a:gd sous prstGeom prst="${prst}" (preset sans guide adj)`);
    }
  }
  /* 5 ─ marges/ancrage sur tcPr, pas tc */
  for (const tc of q(doc, NS.a, 'tc')) {
    for (const at of ['marL', 'marR', 'marT', 'marB', 'anchor'])
      if (tc.hasAttribute(at)) err(`${S} : attribut ${at} sur a:tc (à porter par a:tcPr)`);
  }
  /* 6 ─ timing */
  const timings = q(doc, NS.p, 'timing');
  if (timings.length > 1) err(`${S} : ${timings.length} blocs p:timing (max 1)`);
  if (timings.length) {
    const tm = timings[0];
    for (const id of ['1', '2']) {
      const has = q(tm, NS.p, 'cTn').some(c => c.getAttribute('id') === id);
      if (!has) err(`${S} : timing sans cTn id=${id} (${id === '1' ? 'tmRoot' : 'mainSeq'})`);
    }
    const main = q(tm, NS.p, 'cTn').find(c => c.getAttribute('id') === '2' && c.getAttribute('nodeType') === 'mainSeq');
    if (!main) err(`${S} : cTn id=2 sans nodeType=mainSeq`);
    else {
      const groups = [...main.getElementsByTagNameNS(NS.p, 'par')].filter(par => par.parentElement === main || [...par.children].some(c => c.localName === 'cTn'));
      const gPar = [...main.children].filter(c => c.namespaceURI === NS.p && c.localName === 'childTnLst');
      const gCount = gPar.length ? [...gPar[0].children].filter(c => c.localName === 'par').length : 0;
      if (gCount > 2) err(`${S} : ${gCount} groupes sous mainSeq (max 2)`);
    }
  }
}
/* 7 ─ master : sldLayoutIdLst */
const master = parse('ppt/slideMasters/slideMaster1.xml');
if (!q(master, NS.p, 'sldLayoutIdLst').length) err('master : p:sldLayoutIdLst absent');
/* 8 ─ rels → cibles existantes */
for (const f of parts.filter(p => p.endsWith('.rels'))) {
  const doc = new JSDOM(read(path.relative(dir, f)), { contentType: 'text/xml' }).window.document;
  for (const rel of [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')]) {
    const t = rel.getAttribute('Target');
    if (!t || t.startsWith('http') || rel.getAttribute('TargetMode') === 'External') continue;
    const base = path.dirname(path.dirname(path.relative(dir, f)));
    const target = path.normalize(path.join(base === '.' ? '' : base, t));
    if (!existsSync(path.join(dir, target)) && !existsSync(path.join(dir, t)))
      err(`rels : cible absente ${t} (dans ${path.relative(dir, f)})`);
  }
}
/* 9 ─ Content-Types : chaque Override existe */
{
  const doc = parse('[Content_Types].xml');
  for (const ov of [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override')]) {
    const pn = (ov.getAttribute('PartName') || '').replace(/^\//, '');
    if (pn && !existsSync(path.join(dir, pn))) err(`Content-Types : Override vers partie absente ${pn}`);
  }
}

console.log(`PPTX      : ${PPTX}`);
console.log(`Diapos    : ${slides.length}`);
console.log(`Règles    : par/cTn · sz[100,4000] · gd↔adj · tc/tcPr · timing · master · rels · content-types`);
if (issues.length) {
  console.log(`\n❌ ${issues.length} problème(s) :`);
  for (const i of [...new Set(issues)]) console.log('  - ' + i);
} else {
  console.log('\n✅ AUCUN PROBLÈME');
}
rmSync(dir, { recursive: true, force: true });
process.exit(issues.length ? 1 : 0);
