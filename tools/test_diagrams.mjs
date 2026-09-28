/* Test des schémas physiques (ch. 4.1/4.2/4.3) : génération relationnelle,
   rendu HTML interactif, raster canvas, exports HTML/XLSX/PDF.
   Usage : NODE_PATH=/tmp/node_modules node tools/test_diagrams.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from '/tmp/node_modules/jsdom/lib/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PASS = 0, FAIL = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { PASS++; console.log(`  ✅ ${label}`); }
  else { FAIL++; console.log(`  ❌ ${label} ${extra}`); }
};

/* ---------- jsdom + stubs ---------- */
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
window.fetch = () => Promise.reject(new Error('no network in test'));
// Canvas 2D factice (enregistre les appels, ne dessine rien)
const ctxCalls = [];
function fakeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: [] });
      if (typeof k === 'string') return (...a) => { ctxCalls.push(k); };
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
const demoState = JSON.parse(readFileSync(path.join(ROOT, 'demo/demo-state.json'), 'utf8'));
const tinyPhoto = demoState.devices[0].photo; // vraie photo JPEG pour toDataURL
window.HTMLCanvasElement.prototype.toDataURL = () => tinyPhoto;
window.Image = class {
  constructor() { this.width = 300; this.height = 60; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
};
import vm0 from 'node:vm';
const vctx = dom.getInternalVMContext();
const weval = (code) => vm0.runInContext(code, vctx, { filename: 'app-eval.js' });
weval(readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
weval(readFileSync(path.join(ROOT, 'report.js'), 'utf8'));
window.DEMO = demoState;
weval(`
  state = normalizeState(JSON.parse(JSON.stringify(DEMO)));
  state.workspaces.forEach(ws => { (ws.racks||[]).forEach(normalizeRack); normLldInfo(ws); normSites(ws); });
  state.activeWorkspaceId = state.workspaces[0].id;
  var WS = active();
`);
const W = (expr) => weval(expr);

/* ---------- 1. Génération relationnelle ---------- */
console.log('\n[1] lldBuildDiagData — seeds + voisins câblés uniquement');
for (const mode of ['fai', 'interco', 'fw']) {
  const d = W(`lldBuildDiagData(WS, '${mode}')`);
  const seeds = W(`lldDiagSeedCats('${mode}')`);
  // tous les noeuds ont un instId vivant
  const instIds = new Set(W(`WS.racks.flatMap(r => r.instances.map(i => i.id))`));
  ok(d.nodes.length > 0, `${mode}: ${d.nodes.length} noeuds, ${d.links.length} liens`);
  ok(d.nodes.every(n => instIds.has(n.instId)), `${mode}: tous les noeuds existent dans l'élévation`);
  // chaque noeud = seed OU voisin direct d'un seed
  const seedIds = new Set(W(`WS.racks.flatMap(r => r.instances.filter(i => ${JSON.stringify(seeds)}.includes(normCat(i.cat))).map(i => i.id))`));
  const cables = W(`WS.cables`);
  const neighOfSeed = new Set();
  cables.forEach(c => {
    if (seedIds.has(c.a.instId)) neighOfSeed.add(c.b.instId);
    if (seedIds.has(c.a.instId) && seedIds.has(c.b.instId)) { /* seed-seed ok */ }
    if (seedIds.has(c.b.instId)) neighOfSeed.add(c.a.instId);
  });
  const allowed = new Set([...seedIds, ...neighOfSeed]);
  const orphans = d.nodes.filter(n => !allowed.has(n.instId)).map(n => n.label);
  ok(orphans.length === 0, `${mode}: aucun device sans relation (${orphans.join(',') || 'ok'})`);
  // chaque lien = un VRAI câble entre noeuds retenus
  const nodeIds = new Set(d.nodes.map(n => n.id));
  const cableKeys = new Set(cables.map(c => [c.a.instId, c.a.portId, c.b.instId, c.b.portId].join('|')));
  const badLinks = d.links.filter(l => {
    if (!nodeIds.has(l.a) || !nodeIds.has(l.b)) return true;
    const A = d.nodes.find(n => n.id === l.a), B = d.nodes.find(n => n.id === l.b);
    const k1 = [A.instId, l.portA, B.instId, l.portB].join('|');
    const k2 = [B.instId, l.portB, A.instId, l.portA].join('|');
    return !(cableKeys.has(k1) || cableKeys.has(k2));
  });
  ok(badLinks.length === 0, `${mode}: ${d.links.length} liens = vrais câbles (0 factice)`);
  ok(d.links.every(l => l.cable && l.color), `${mode}: liens portent nom + couleur du câble`);
  ok(Array.isArray(d.cols) && d.cols.length > 0, `${mode}: en-têtes de colonnes (${(d.cols || []).map(c => c.label).join(' / ')})`);
}
// cas vide : workspace sans routeur
weval(`var WS_EMPTY = { racks: [], cables: [], sites: [], lld: normLldInfo({}) };`);
const dEmpty = W(`lldBuildDiagData(WS_EMPTY, 'fai')`);
ok(dEmpty.nodes.length === 0 && dEmpty.empty === true, 'fai sans routeur: schéma vide + flag empty');
ok(typeof W(`lldDiagEmptyHint('fai')`) === 'string', 'hint vide explicite');

/* ---------- 1b. Géométrie : pas de chevauchement, ports dans [0,1] ---------- */
console.log('\n[1b] géométrie des schémas — recouvrement et bornes');
for (const mode of ['fai', 'interco', 'fw']) {
  const d = W(`lldEnsureDiag(WS, '${mode}')`);
  const cols = {};
  d.nodes.forEach(n => { const k = 'x' + n.x; (cols[k] = cols[k] || []).push(n); });
  let overlap = 0;
  for (const c of Object.values(cols)) {
    const a = c.slice().sort((x, y) => x.y - y.y);
    for (let i = 1; i < a.length; i++)
      if (a[i].y < a[i - 1].y + (a[i - 1].h || 100)) overlap++;
  }
  ok(overlap === 0, `${mode}: 0 noeud superposé dans une colonne`);
  const ids = new Set(d.nodes.map(n => n.id));
  ok(d.links.every(l => ids.has(l.a) && ids.has(l.b)), `${mode}: tous les liens aboutissent à des noeuds`);
  const badPort = d.links.filter(l => [l.aPort, l.bPort]
    .some(e => e && (e.xPct < 0 || e.xPct > 1))).length;
  ok(badPort === 0, `${mode}: positions de ports dans [0,1]`);
  ok(d.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 0 && n.y >= 0),
    `${mode}: coordonnées finies et positives`);
}

/* ---------- 1c. Stockage : norm conserve le format, stale reconstruit ---------- */
console.log('\n[1c] cycle stockage/normalisation — photos + ports survivants');
weval(`WS.lld.diagrams = WS.lld.diagrams || {};
WS.lld.diagrams.fai = lldBuildDiagData(WS, 'fai');
normLldInfo(WS);`);
{
  const nd = W(`WS.lld.diagrams.fai.nodes[0]`);
  ok(!!(nd.instId && (nd.ports || []).length > 0 && nd.sub2), 'norm conserve instId/ports/sub2');
  const nl = W(`WS.lld.diagrams.fai.links[0]`);
  ok(!!(nl && nl.portA && nl.cable), 'norm conserve portA/cable des liens');
  ok(W(`(WS.lld.diagrams.fai.cols||[]).length`) > 0, 'norm conserve les en-tetes de colonnes');
}
weval(`WS.lld.diagrams.fai = { nodes: [{ id: 'd-x', x: 0, y: 0, w: 150, h: 56, label: 'Vieux', sub: 'vieux', kind: 'router' }], links: [] };`);
ok(W(`lldDiagNeedsRebuild(WS.lld.diagrams.fai)`) === true, 'schema ampute detecte stale');
{
  const fresh = W(`lldEnsureDiag(WS, 'fai')`);
  ok(fresh.nodes.length > 0 && fresh.nodes.every(n => n.instId), 'stale -> reconstruit avec instId');
  ok(W(`WS.lld.diagrams.fai.nodes[0].instId`) !== '', 'schema reconstruit restocke');
  ok(W(`lldDiagNeedsRebuild(WS.lld.diagrams.fai)`) === false, 'schema frais -> conserve tel quel');
}
weval(`var EL2 = lldRenderFrontDiagEl(WS, lldEnsureDiag(WS, 'fai')); document.body.appendChild(EL2);`);
ok(W(`EL2.querySelectorAll('.fdiag-dev img').length`) > 0, 'rendu stocke : photos presentes');
ok(W(`EL2.querySelectorAll('.fdiag-port').length`) > 0, 'rendu stocke : ports presents');
ok(W(`EL2.querySelectorAll('.fdiag-colh').length`) > 0, 'rendu stocke : en-tetes presentes');
{
  const css = readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rpt = readFileSync(path.join(ROOT, 'report.js'), 'utf8');
  ok(css.includes('.fdiag-wires { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 4; }'), 'appli : fils z-index 4');
  ok(css.includes('.fdiag-dev:hover { z-index: 5; }'), 'appli : device survole repasse dessus');
  ok(css.includes('.fdiag-wires g.wire path.w-core { pointer-events: stroke; cursor: pointer; }'), 'appli : seule ame du fil capte les clics');
  ok(rpt.includes('.fdiag-wires{position:absolute;left:0;top:0;pointer-events:none;z-index:4}'), 'rapport : fils au-dessus');
  ok(rpt.includes('.fdiag-dev:hover{z-index:5}'), 'rapport : device survole repasse dessus');
}

/* ---------- 2. Rendu HTML interactif ---------- */
console.log('\n[2] lldRenderFrontDiagEl — faces avant, ports, câbles, infobulles');
weval(`var D_FAI = lldEnsureDiag(WS, 'fai'); var EL = lldRenderFrontDiagEl(WS, D_FAI); document.body.appendChild(EL);`);
ok(W(`EL.querySelectorAll('.fdiag-dev').length`) === W(`D_FAI.nodes.length`), 'un .fdiag-dev par noeud');
ok(W(`EL.querySelectorAll('.fdiag-dev img').length`) > 0, 'photos embarquées en <img>');
ok(W(`EL.querySelectorAll('g.wire').length`) === W(`D_FAI.links.length`), 'un fil SVG par câble');
ok(W(`EL.querySelectorAll('g.wire title').length`) === W(`D_FAI.links.length`), 'chaque câble a son infobulle <title>');
ok(W(`EL.querySelectorAll('.fdiag-port.is-up').length`) > 0, 'ports câblés marqués .is-up');
ok(W(`EL.querySelectorAll('.fdiag-plab').length`) > 0, 'pastilles de noms de ports visibles');
ok(W(`EL.querySelector('.fdiag-port.is-up').style.background`) !== '', 'port câblé teinté couleur du câble');
// positions des ports = celles de l'élévation
const posOk = W(`(() => {
  const dev = EL.querySelector('.fdiag-dev'); const n = D_FAI.nodes.find(x => x.id === dev.dataset.node);
  const inst = WS.racks.flatMap(r => r.instances).find(i => i.id === n.instId);
  return [...dev.querySelectorAll('.fdiag-port')].every(pel => {
    const p = inst.ports.find(x => x.id === pel.dataset.port);
    return p && Math.abs(parseFloat(pel.style.left) - p.xPct) < 0.01;
  });
})()`);
ok(posOk, 'ports aux mêmes emplacements (xPct) que l’élévation');
// infobulle device riche
const tipHtml = W(`EL.querySelector('.fdiag-dev .fdiag-tip').innerHTML`);
ok(/U\d/.test(tipHtml) && /ports/.test(tipHtml), 'infobulle device: U, ports, câblés');
const ptip = W(`EL.querySelector('.fdiag-port.is-up .fdiag-tip').innerHTML`);
ok(/Port /.test(ptip) && /→/.test(ptip), 'infobulle port: nom + destination câblée');

/* ---------- 3. Interactions (zoom + isolement) ---------- */
console.log('\n[3] lldDiagInitAll — barre zoom + isolement au clic');
weval(`lldDiagInitAll(document)`);
ok(W(`EL.querySelector('.fdiag-tools') !== null`), 'barre d’outils injectée');
ok(/équipements/.test(W(`EL.querySelector('.fdiag-stats').textContent`)), 'stats affichées');
weval(`EL.querySelector('[data-z="in"]').click()`);
ok(W(`EL.querySelector('.fdiag-stage').style.zoom`) === '1.25', 'zoom + → 125%');
weval(`EL.querySelector('[data-z="fit"]').click()`);
ok(parseFloat(W(`EL.querySelector('.fdiag-stage').style.zoom`)) > 0, 'zoom fit calculé');
// isolement device
weval(`EL.querySelector('.fdiag-dev .fdiag-cap b').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
ok(W(`EL.classList.contains('iso')`) === true, 'clic device → mode isolement');
ok(W(`EL.querySelectorAll('g.wire.on').length`) > 0, 'câbles du device isolés (.on)');
weval(`EL.querySelector('.fdiag-stage').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
ok(W(`EL.classList.contains('iso')`) === false, 'clic fond → isolement annulé');
// isolement port
weval(`EL.querySelector('.fdiag-port.is-up').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
ok(W(`EL.querySelectorAll('g.wire.on').length`) === 1, 'clic port → son seul câble isolé');

/* ---------- 4. Raster canvas ---------- */
console.log('\n[4] lldPaintFrontDiag + lldRenderDiagExportImgs');
const paint = await W(`lldPaintFrontDiag(WS, D_FAI, { subtitle: WS.name })`);
ok(paint && paint.width > 800 && paint.height > 400, `canvas ${paint.width}×${paint.height}`);
ok(ctxCalls.includes('fillText') && ctxCalls.includes('drawImage'), 'peinture: textes + photos');
{
  const mark = ctxCalls.length;
  await W(`lldPaintFrontDiag(WS, D_FAI, { subtitle: WS.name })`);
  const slice = ctxCalls.slice(mark);
  ok(slice.lastIndexOf('drawImage') >= 0 && slice.lastIndexOf('drawImage') < slice.lastIndexOf('stroke'),
    'raster : fils peints apres les boitiers');
}
await W(`lldRenderDiagExportImgs(WS)`);
const imgs = W(`globalThis.__LLD_DIAG_IMGS`);
ok(['fai', 'interco', 'fw'].every(m => imgs[m] && imgs[m].dataUrl.startsWith('data:image')), '3 JPEG pré-rasterisés (fai/interco/fw)');
ok(['fai', 'interco', 'fw'].every(m => imgs[m].widthPx > 500), 'dimensions réalistes');

/* ---------- 5. Rapport HTML ---------- */
console.log('\n[5] Rapport HTML — schémas dans leurs sections + JS embarqué');
const reportHtml = W(`buildHtmlReportFile(WS, { plan: null, topo: null, rackShots: new Map(), logoSvg: '' }, null)`);
ok(reportHtml.includes('sec-fai') && reportHtml.includes('fdiag-dev'), 'section FAI avec schéma');
ok(reportHtml.includes('Diagramme d’interconnexion'), 'section interco avec schéma');
ok(reportHtml.includes('Diagramme Firewall'), 'section firewall avec schéma');
ok(reportHtml.includes('function lldDiagInitAll'), 'lldDiagInitAll embarquée (1 seule implémentation)');
ok(reportHtml.includes('eth0') || reportHtml.includes('WAN1'), 'noms de ports présents');
// le JS embarqué compile
{
  const m = reportHtml.match(/<script>([\s\S]*)<\/script>/);
  const vm = await import('node:vm');
  try { new vm.Script(m[1]); ok(true, 'JS du rapport compile'); }
  catch (e) { ok(false, 'JS du rapport compile', e.message); }
}

/* ---------- 6. XLSX template (feuilles 5/6/7) ---------- */
console.log('\n[6] XLSX template — schémas dans les feuilles 5/6/7');
const layout = JSON.parse(readFileSync(path.join(ROOT, 'assets/lld/layout.json'), 'utf8'));
const stylesXml = readFileSync(path.join(ROOT, 'assets/lld/styles.xml'), 'utf8');
const themeXml = readFileSync(path.join(ROOT, 'assets/lld/theme1.xml'), 'utf8');
window.__layout = layout; window.__styles = stylesXml; window.__theme = themeXml;
const blob = await W(`LLD_TPL.buildAll(WS, __layout, __styles, __theme, null)`);
const buf = Buffer.from(await blob.arrayBuffer());
// mini-extracteur ZIP (méthode store uniquement)
function unzipStore(u8) {
  const files = {};
  let p = 0;
  while (p + 30 <= u8.length) {
    const sig = u8.readUInt32LE(p);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) throw new Error('sig ZIP inattendue à ' + p);
    const method = u8.readUInt16LE(p + 8), nlen = u8.readUInt16LE(p + 26), elen = u8.readUInt16LE(p + 28);
    const size = u8.readUInt32LE(p + 22);
    const name = u8.toString('utf8', p + 30, p + 30 + nlen);
    const start = p + 30 + nlen + elen;
    if (method !== 0) throw new Error('méthode ZIP ' + method);
    files[name] = u8.subarray(start, start + size).toString('utf8');
    p = start + size;
  }
  return files;
}
const zx = unzipStore(buf);
const wb = zx['xl/workbook.xml'];
const sheetIdx = {};
[...wb.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="rId(\d+)"\/>/g)].forEach(m => { sheetIdx[m[1]] = m[3]; });
ok(zx[`xl/worksheets/sheet${sheetIdx['4.1']}.xml`].includes('Diagramme d’accès FAI'), 'feuille 4.1: bloc schéma présent');
ok(zx[`xl/worksheets/sheet${sheetIdx['4.2']}.xml`].includes('Diagramme d’interconnexion'), 'feuille 4.2: bloc schéma présent');
ok(zx[`xl/worksheets/sheet${sheetIdx['4.3']}.xml`].includes('Diagramme Firewall'), 'feuille 4.3: bloc schéma présent');
const drawings = Object.keys(zx).filter(n => n.startsWith('xl/drawings/drawing'));
ok(drawings.length >= 3, `${drawings.length} dessins embarqués (≥3 schémas)`);
ok(Object.keys(zx).some(n => n.startsWith('xl/media/')), 'images JPEG embarquées (xl/media)');
ok(zx[drawings[0]].includes('diagramme-'), 'schémas nommés dans les dessins');
// Schémas 5/6 : images dans la zone du chapitre, jamais sur les tableaux
{
  const anchorsOf = d => [...d.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>[\s\S]*?<xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)]
    .map(m => ({ c0: +m[1], r0: +m[2], c1: +m[3], r1: +m[4] }));
  const markerRow1 = (sn, marker) => {
    const xml = zx[`xl/worksheets/sheet${sheetIdx[sn]}.xml`];
    const hit = [...xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].find(r => r[2].includes(marker));
    return hit ? +hit[1] : -1;
  };
  const mergesBelow = (sn, r1) => {
    const xml = zx[`xl/worksheets/sheet${sheetIdx[sn]}.xml`];
    return [...xml.matchAll(/<mergeCell ref="[A-Z]+(\d+):[A-Z]+(\d+)"\/>/g)]
      .every(m => +m[1] > r1 + 1 && +m[2] > r1 + 1);
  };
  for (const [sn, marker] of [['4.1', '4.1.1. Informations'], ['4.2', '4.2.1. Informations']]) {
    const d = zx[`xl/drawings/drawing${sheetIdx[sn]}.xml`];
    ok(!!d, `onglet ${sn} : dessin présent`);
    if (!d) continue;
    const a = anchorsOf(d)[0];
    const content1 = markerRow1(sn, marker);
    ok(content1 > 0, `onglet ${sn} : contenu repéré (ligne ${content1})`);
    ok(a.r0 >= 1, `onglet ${sn} : image sous le titre (ligne ${a.r0 + 1})`);
    ok(a.r1 < content1 - 1, `onglet ${sn} : image au-dessus des tableaux (${a.r0 + 1}-${a.r1 + 1} < ${content1})`);
    ok(a.c1 - a.c0 <= 14, `onglet ${sn} : largeur contenue (${a.c1 - a.c0 + 1} col.)`);
    ok(mergesBelow(sn, a.r1), `onglet ${sn} : fusions sous l'image (décalées)`);
  }
  // Feuille 7 (sans zone vide) : image après tout le texte
  const d7 = zx[`xl/drawings/drawing${sheetIdx['4.3']}.xml`];
  const xml7 = zx[`xl/worksheets/sheet${sheetIdx['4.3']}.xml`];
  const lastText7 = Math.max(...[...xml7.matchAll(/<row r="(\d+)"[^>]*><c /g)].map(m => +m[1]));
  const a7 = anchorsOf(d7)[0];
  ok(a7.r0 >= lastText7 - 1, `onglet 4.3 : image après le texte (ligne ${a7.r0 + 1} >= ${lastText7})`);
}

/* ---------- 7. XLSX vue données (onglet Schémas) ---------- */
console.log('\n[7] XLSX vue données — onglet Schémas');
const blob2 = await W(`DX.buildAll(WS, null)`);
const zx2 = unzipStore(Buffer.from(await blob2.arrayBuffer()));
ok(zx2['xl/workbook.xml'].includes('name="Schémas"'), 'onglet Schémas présent');
ok(Object.keys(zx2).filter(n => n.startsWith('xl/drawings/drawing')).length >= 1, 'dessin(s) dans vue données');
ok(zx2['xl/workbook.xml'].includes('name="Sommaire"'), 'onglet Sommaire conservé');

/* ---------- 8. PDF LLD ---------- */
console.log('\n[8] PDF LLD — schémas ch. 4.1/4.2/4.3');
const pdf = W(`buildLldPdf(WS, null, 0, 0, null, 0, 0, { only: new Set(['4','14','15']) })`);
const pdfBin = Buffer.from(pdf).toString('latin1');
ok(pdfBin.startsWith('%PDF-1.4'), 'en-tête PDF');
ok((pdfBin.match(/\/ImS\d+/g) || []).length >= 3, 'images de schémas référencées (/ImS0/1/2)');
ok(pdfBin.includes('Conception et Configuration FAI'), 'chapitre 4.1 présent');
ok(pdfBin.includes('startxref') && pdfBin.includes('%%EOF'), 'PDF terminé (xref + EOF)');

/* ---------- 9. Infobulles recadrées + fiches larges ---------- */
console.log('\n[9] infobulles + fiches (grilles larges)');
// 9a. recadrage : rects factices (gauche coupée, haut coupé)
{
  const orig = window.Element.prototype.getBoundingClientRect;
  const stub = (tipR) => {
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.classList && this.classList.contains('fdiag-tip')) return tipR;
      if (this.classList && this.classList.contains('fdiag'))
        return { left: 0, right: 800, top: 100, bottom: 900, width: 800, height: 800 };
      return orig.call(this);
    };
  };
  weval(`EL.querySelector('[data-z="reset"]').click()`);   // zoom 1:1 pour les rects factices
  stub({ left: -80, right: 120, top: 200, bottom: 280, width: 200, height: 80 });
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.transform`) === 'translateX(calc(-50% + 86px))',
    'infobulle gauche coupée → recentrée (+86px)');
  stub({ left: 700, right: 900, top: 200, bottom: 280, width: 200, height: 80 });
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.transform`) === 'translateX(calc(-50% + -106px))',
    'infobulle droite coupée → recentrée (−106px)');
  weval(`EL.querySelector('[data-z="in"]').click()`);   // zoom 125 %
  stub({ left: -80, right: 120, top: 200, bottom: 280, width: 200, height: 80 });
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.transform`) === 'translateX(calc(-50% + 69px))',
    'infobulle zoom 125 % → décalage compensé (69px)');
  weval(`EL.querySelector('[data-z="reset"]').click()`);
  stub({ left: 300, right: 500, top: 40, bottom: 120, width: 200, height: 80 });
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === 'calc(100% + 8px)',
    'infobulle haut coupé → bascule en bas');
  // 9a-bis. barre sticky : le haut visible est le bas de la toolbar (bug : tip
  // sous la barre alors que tr.top > wr.top → pas de bascule → tip coupé)
  const stub2 = (tipR, toolsR, portR, wrapR) => {
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.classList && this.classList.contains('fdiag-tip')) return tipR;
      if (this.classList && this.classList.contains('fdiag-tools')) return toolsR;
      if (this.classList && this.classList.contains('fdiag-port')) return portR;
      if (this.classList && this.classList.contains('fdiag'))
        return wrapR || { left: 0, right: 800, top: 100, bottom: 900, width: 800, height: 800 };
      return orig.call(this);
    };
  };
  const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const TOOLS = R(0, 100, 800, 43);
  stub2(R(300, 130, 200, 80), TOOLS, R(394, 218, 12, 12));
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === 'calc(100% + 8px)',
    'infobulle sous la toolbar → bascule en bas');
  stub2(R(300, 160, 200, 80), TOOLS, R(394, 248, 12, 12));
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === '',
    'infobulle sous la toolbar mais visible → pas de bascule');
  // petit cadre : le bas est pire que le haut → on garde le haut
  stub2(R(300, 112, 200, 80), TOOLS, R(394, 200, 12, 12), R(0, 100, 800, 160));
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === '',
    'petit cadre : bas pire que haut → pas de bascule');
  // même géométrie, cadre plus haut : la bascule a de la place → bascule
  stub2(R(300, 112, 200, 80), TOOLS, R(394, 200, 12, 12), R(0, 100, 800, 200));
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === 'calc(100% + 8px)',
    'cadre suffisant : bascule en bas');
  weval(`EL.querySelector('.fdiag-port').dispatchEvent(new MouseEvent('mouseout', {bubbles:true}))`);
  ok(W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.transform`) === ''
    && W(`EL.querySelector('.fdiag-port > .fdiag-tip').style.top`) === '', 'mouseout → styles réinitialisés');
  window.Element.prototype.getBoundingClientRect = orig;
}
// 9b. fiches : seuil 10 colonnes + exhaustivité des infos
{
  const cols19 = W(`lldExportCols(normLldInfo(WS),'fais',LLD_FAI51_COLS).map(c=>[c[0],String(c[1])])`);
  const cards = W(`rptLldGrid(${JSON.stringify(cols19)}, normLldInfo(WS).fais)`);
  ok(cols19.length >= 10 && cards.includes('rec-card') && !cards.includes('<table'), '19 colonnes → fiches, pas de tableau');
  ok(cards.includes('data-search'), 'fiches cherchables (data-search)');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const faisRows = W(`normLldInfo(WS).fais`);
  const colKeys = new Set(cols19.map(([k]) => k));
  const missing = [];
  faisRows.forEach(r => Object.entries(r).forEach(([k, v]) => {
    if (!colKeys.has(k)) return;   // hors colonnes : jamais rendu (parité Excel)
    v = String(v ?? '').trim();
    const rendered = esc(v).replace(/\n/g, '<br>');
    if (v && !cards.includes(rendered)) missing.push(k + '=' + v.slice(0, 24));
  }));
  ok(missing.length === 0, `aucune info perdue (${missing.slice(0, 3).join(', ') || 'toutes présentes'})`);
  const narrow = W(`rptLldGrid([['a','De'],['b','Liaison'],['c','Vers']], [{a:'x',b:'y',c:'z'}])`);
  ok(narrow.includes('<table') && !narrow.includes('rec-card'), '3 colonnes → tableau conservé');
  const admin = W(`rptLldGrid(LLD_ADMIN_COLS.map(c=>[c[0],String(c[1])]), [Object.fromEntries(LLD_ADMIN_COLS.map(([k])=>[k,'v-'+k]))])`);
  ok(admin.includes('rec-card'), '10 colonnes → fiches');
  const cab = W(`rptLldGrid(LLD_CAB15_COLS.map(c=>[c[0],String(c[1])]), [Object.fromEntries(LLD_CAB15_COLS.map(([k])=>[k,'v-'+k]))])`);
  ok(cab.includes('<table'), '9 colonnes → tableau conservé');
  ok(reportHtml.includes('rec-card'), 'rapport complet : fiches présentes (5.1)');
  ok(reportHtml.includes("tr[data-search],.rec-card[data-search]"), 'recherche couvre lignes + fiches');
}

/* ---------- 9b. Numéros de ports sur faces denses ---------- */
console.log('\n[9b] numéros dans les pastilles (switch/brassage 24 p.)');
weval(`var D_DENSE = { nodes: [
  { id: 'sw', x: 10, y: 10, w: 340, h: 110, label: 'SW-01', sub: 'Cisco', kind: 'switch', cat: 'switch',
    ports: Array.from({ length: 24 }, (_, i) => ({ id: 'p' + i, name: 'Gi1/0/' + (i + 1), xPct: 5 + i * 3.9, yPct: 40 })) },
  { id: 'rt', x: 380, y: 10, w: 150, h: 80, label: 'RT', sub: 'ISP', kind: 'router', cat: 'router',
    ports: [{ id: 'w1', name: 'WAN1', xPct: 50, yPct: 50 }] }
], links: [
  { a: 'sw', b: 'rt', portA: 'p0', portB: 'w1', color: '#1f2937', cable: 'C-001', domain: '', label: '' },
  { a: 'sw', b: 'rt', portA: 'p11', portB: 'w1', color: '#eab308', cable: 'C-002', domain: '', label: '' }
] };
var EL_D = lldRenderFrontDiagEl(WS, D_DENSE); document.body.appendChild(EL_D);`);
ok(W(`EL_D.querySelectorAll('[data-node="sw"] .fdiag-pnum').length`) === 24, 'dense : nº dans les 24 pastilles');
ok(W(`EL_D.querySelectorAll('[data-node="sw"] .fdiag-plab').length`) === 0, 'dense : aucune étiquette dessous (anti-chevauchement)');
ok(W(`EL_D.querySelector('[data-node="sw"] .fdiag-port[data-port="p0"] .fdiag-pnum').textContent`) === '1', 'Gi1/0/1 → « 1 »');
ok(W(`EL_D.querySelector('[data-node="sw"] .fdiag-port[data-port="p23"] .fdiag-pnum').textContent`) === '24', 'Gi1/0/24 → « 24 »');
ok(W(`EL_D.querySelector('[data-node="sw"] .fdiag-port[data-port="p0"] .fdiag-pnum').style.color`).includes('255, 255, 255'), 'câble noir → nº blanc');
ok(W(`EL_D.querySelector('[data-node="sw"] .fdiag-port[data-port="p11"] .fdiag-pnum').style.color`).includes('15, 23, 42'), 'câble jaune → nº sombre');
ok(W(`EL_D.querySelector('[data-node="sw"] .fdiag-port[data-port="p5"] .fdiag-pnum').style.color`).includes('15, 23, 42'), 'non câblé (jaune) → nº sombre');
ok(W(`EL_D.querySelectorAll('[data-node="rt"] .fdiag-plab').length`) === 1, 'petite face : étiquette dessous conservée');
ok(W(`lldPortShort('Gi1/0/12')`) === '12' && W(`lldPortShort('LAN2 (spare)')`) === '2', 'extraction groupe final');
ok(W(`lldPortShort('CON', 0)`) === '1' && W(`lldPortShort('', 4)`) === '5', 'sans chiffres → position 1-based');
ok(W(`lldOnLight('#fbbf24')`) === true && W(`lldOnLight('#1f2937')`) === false, 'contraste : jaune clair, noir sombre');
{
  const css2 = readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rpt2 = readFileSync(path.join(ROOT, 'report.js'), 'utf8');
  ok(css2.includes('.fdiag-pnum'), 'appli : style .fdiag-pnum');
  ok(rpt2.includes('.fdiag-pnum{position:absolute'), 'rapport : style .fdiag-pnum embarqué');
}

/* ---------- 10. Workspaces vides + synchro sommaire + selecteur hierarchique ---------- */
console.log('\n[10] workspaces vides + synchro sommaire + selecteur hierarchique');
// 10a. creation : vide par defaut, demo intacte
ok(W(`makeWorkspace('Vide').racks.length`) === 0, 'nouveau workspace : 0 rack');
ok(W(`makeWorkspace('Vide').cables.length`) === 0, 'nouveau workspace : 0 cable');
ok(W(`WS.racks.some(r => /FAI/.test(r.name))`), 'demo : rack FAI present');
// 10b. synchro des numeros depuis le sommaire
ok(W(`lldTocNumForBlock(normLldInfo(WS), 'fais')`) === '4.1.1', 'bloc fais -> 4.1.1');
ok(W(`lldTocNumForBlock(normLldInfo(WS), 'fw')`) === '4.3.3', 'bloc fw -> 4.3.3');
ok(W(`lldTocSyncLabel(normLldInfo(WS), 'fais', '5.1 \u2014 X')`) === '4.1.1 \u2014 X', '5.1 -> 4.1.1');
ok(W(`lldTocSyncLabel(normLldInfo(WS), 'fw', '7.3. R\u00e8gles et NAT')`) === '4.3.3. R\u00e8gles et NAT', '7.3. -> 4.3.3.');
ok(W(`lldTocSyncLabel(normLldInfo(WS), 'zones', 'Zones (ch. 8)')`) === 'Zones (ch. 4.4)', '(ch. 8) -> (ch. 4.4)');
ok(W(`lldTocSyncLabel(normLldInfo(WS), 'nope', '5.1 \u2014 X')`) === '5.1 \u2014 X', 'bloc inconnu -> repli intact');
// pilote par le sommaire, pas code en dur (sommaire fictif 9.9)
ok(W(`lldTocSyncLabel({toc:[{num:'9.9',title:'T',blocks:['fais'],subs:[]}]}, 'fais', '5.1 \u2014 X')`) === '9.9 \u2014 X', 'numero lu du sommaire (9.9)');
// 10c. rapport synchronise
{
  const fai = W(`rptFai(WS)`);
  ok(fai.includes('4.1.1 \u2014 ') && !fai.includes('5.1 \u2014'), 'rapport FAI : 4.1.1, plus de 5.1');
  const fw = W(`rptFirewall(WS)`);
  ok(fw.includes('4.3.3 \u2014 ') && !fw.includes('7.3 \u2014'), 'rapport FW : 4.3.3, plus de 7.3');
  ok(W(`RPT_FREE_SEC['4.1']`) === 'sec-fai', 'RPT_FREE_SEC : cle 4.1 presente');
}
// 10d. perimetre hierarchique (lldNumInScope)
ok(W(`lldNumInScope('4.5', new Set(['4']))`) === true, '4.5 sous 4 coche -> garde');
ok(W(`lldNumInScope('4', new Set(['4.5']))`) === true, 'parent 4 garde (contexte)');
ok(W(`lldNumInScope('4.6', new Set(['4.5']))`) === false, '4.6 non coche -> exclu');
ok(W(`lldNumInScope('15.1', new Set(['15']))`) === true, '15.1 sous 15 -> garde');
ok(W(`lldNumInScope('5', null)`) === true, 'sans filtre -> tout garde');
// 10e. items hierarchiques (3 profondeurs)
{
  const items = W(`lldChapterPickItems(WS)`);
  ok(items.some(([n, l, d]) => n === '4' && d === 0), 'racine 4 proposee (d0)');
  ok(items.some(([n, l, d]) => n === '4.5' && d === 1), 'sous-chapitre 4.5 propose (d1)');
  ok(items.some(([n, l, d]) => n === '4.5.1' && d === 2), 'sous-sous-chapitre 4.5.2 propose (d2)');
  ok(!items.some(([n]) => n === '\ud83d\udcc4'), 'page de garde exclue (toujours incluse)');
}
// 10f. cascade du selecteur (comportement DOM reel)
{
  const p = W(`lldPickSections({title:'T', items:[['4','4. Ch',0],['4.1','4.1 S',1],['4.2','4.2 S',1]]})`);
  weval(`[...document.querySelectorAll('.lld-pick-item input')].find(b => b.value === '4.1').click()`);
  ok(W(`[...document.querySelectorAll('.lld-pick-item input')].find(b => b.value === '4').indeterminate`) === true, 'parent partiel -> indeterminate');
  weval(`document.querySelector('.lld-dlg-ok').click()`);
  const sel = await p;
  ok(sel.has('4.2') && !sel.has('4') && !sel.has('4.1'), 'collecte normalisee (parent partiel exclu)');
}
// 10g. Excel : exclusion du sous-arbre 4.5, parent 4 garde en contexte
{
  weval(`var ONLY45 = new Set(lldChapterPickItems(WS).map(x => x[0]).filter(n => n !== '4' && n !== '4.5' && !n.startsWith('4.5.')));`);
  const b = await W(`LLD_TPL.buildAll(WS, __layout, __styles, __theme, ONLY45)`);
  const z = unzipStore(Buffer.from(await b.arrayBuffer()));
  const names = [...z['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  ok(!names.includes('4.5'), 'feuille 4.5 exclue');
  ok(names.includes('4.1'), 'feuille 4.1 gardee');
  ok(names.includes('4'), 'feuille 4 gardee en contexte');
}
// 10h. PDF : exclusion du sous-arbre 4.5
{
  const p = W(`buildLldPdf(WS, null, 0, 0, null, 0, 0, { only: ONLY45 })`);
  const bin = Buffer.from(p).toString('latin1');
  ok(bin.includes('(4.1. Conception'), 'PDF : 4.1 imprime');
  ok(!bin.includes('(4.5. Conception'), 'PDF : 4.5 exclu');
}
// 10i. Contenu : titre renomme par l'utilisateur repris dans l'export
{
  weval(`var WS2 = JSON.parse(JSON.stringify(WS));
  WS2.lld.toc.forEach(n => (n.subs||[]).forEach(s => { if (s.num === '4.1') s.title = 'FAI MODIFIE'; }));`);
  const b = await W(`LLD_TPL.buildAll(WS2, __layout, __styles, __theme, null)`);
  const z = unzipStore(Buffer.from(await b.arrayBuffer()));
  const m = z['xl/workbook.xml'].match(/<sheet name="Contenu" sheetId="(\d+)" r:id="rId(\d+)"\/>/);
  const xml = z[`xl/worksheets/sheet${m[2]}.xml`];
  ok(/FAI MODIFIE/.test(xml), 'Contenu : titre renomme repris');
}

/* ---------- 11. Synchro totale des numéros (onglets + titres + sommaire) ---------- */
console.log('\n[11] synchro totale des numéros');
// 11a. onglets renommés selon le sommaire
{
  const names = Object.keys(sheetIdx);
  for (const n of ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.4.1', '4.4.5'])
    ok(names.includes(n), `onglet ${n} présent`);
  for (const n of ['5', '6', '7', '8', '9', '10', '11', '12', '13', '8.1'])
    ok(!names.includes(n), `ancien onglet ${n} supprimé`);
}
// 11b. A1 synchronisés (numéro + titre sommaire)
{
  const a1 = sn => {
    const xml = zx[`xl/worksheets/sheet${sheetIdx[sn]}.xml`];
    const m = xml.match(/<c r="A1"[^>]*><is><t[^>]*>([^<]*)<\/t>/);
    return m ? m[1] : null;
  };
  ok(a1('4.1') === '4.1. Conception et Configuration FAI', `A1 4.1 (${a1('4.1')})`);
  ok(a1('15') === '15. Cablage/Rack', `A1 15 (${a1('15')})`);
  ok(a1('14') === '14. Flux réseau et diagram', `A1 14 (${a1('14')})`);
  ok((a1('4.4') || '').startsWith('4.4. Conception et Configuration Switching'), `A1 4.4 (${a1('4.4')})`);
}
// 11c. sous-titres du template remappés
{
  const sh = sn => zx[`xl/worksheets/sheet${sheetIdx[sn]}.xml`];
  ok(sh('4.1').includes('4.1.1. Informations &amp; Configuration'), '4.1.1 dans feuille 4.1');
  ok(sh('4.1').includes('4.1.2. Cablage'), '4.1.2 dans feuille 4.1');
  ok(!/>5\.1\. /.test(sh('4.1')) && !/>5\.2\. /.test(sh('4.1')), 'plus de 5.1/5.2 dans feuille 4.1');
  ok(sh('4.2').includes('4.2.1. Informations &amp; Configuration'), '4.2.1 dans feuille 4.2');
  ok(sh('4.2').includes('4.2.2. Cablage'), '4.2.2 dans feuille 4.2');
  ok(sh('3').includes('3. Architecture existante'), 'feuille 3 : titre 3.x synchronisé');
  ok(!sh('3').includes('3.1. Equipments'), 'feuille 3 : plus de 3.1. Equipments');
  ok(!/>2\.1\. /.test(sh('2')), 'feuille 2 : plus de 2.1.');
}
// 11d. Contenu reconstruit depuis le sommaire
{
  const m = zx['xl/workbook.xml'].match(/<sheet name="Contenu" sheetId="(\d+)" r:id="rId(\d+)"\/>/);
  const xml = zx[`xl/worksheets/sheet${m[2]}.xml`];
  ok(xml.includes('4.3.1. '), 'Contenu : 4.3.1 présent');
  ok(xml.includes('4.9.1. Pointeuses'), 'Contenu : 4.9.1 présent');
  ok(xml.includes('14.1. Flux applicatifs'), 'Contenu : 14.1 présent');
  ok(!/>5\. /.test(xml) && !/>2\.1\. Information/.test(xml) && !/>3\.1\. Equipments/.test(xml), 'Contenu : anciens numéros purgés');
}
// 11e. modale + recherche : labels synchronisés
{
  ok(W(`lldInfoDef('fais').label`).startsWith('4.1.1 —'), 'modale : bloc fais en 4.1.1');
  ok(W(`lldInfoDef('fw').label`).startsWith('4.3.3 —'), 'modale : bloc fw en 4.3.3');
  const toc = W(`normLldInfo(WS).toc`);
  const nums = new Set(['cover']);
  const walk = ns => (ns || []).forEach(n => { nums.add(n.num); walk(n.subs); });
  walk(toc);
  const aliases = W(`LLD_EXPORT_ALIASES.map(a => a[1])`);
  ok(aliases.every(n => nums.has(n)), 'recherche : tous les alias résolvent');
}

/* ---------- 12. Captures par défaut retirées ---------- */
console.log('\n[12] captures par défaut retirées');
// 12a. sommaire par défaut : diagrammes seuls
{
  const subs = W(`defaultLldToc().find(n => n.num === '4').subs`);
  const b = num => subs.find(s => s.num === num).blocks;
  ok(JSON.stringify(b('4.1')) === '["diag5"]', 'défaut 4.1 : diagramme seul');
  ok(JSON.stringify(b('4.2')) === '["diag6"]', 'défaut 4.2 : diagramme seul');
  ok(b('4.3').includes('diag7') && !b('4.3').includes('shots7'), 'défaut 4.3 : sans captures');
}
// 12b. migration : vide → détaché, avec données → conservé
{
  const mk = shots => W(`normLldInfo({lld:{shots5:${shots},toc:[{num:'4',title:'C',blocks:[],subs:[{num:'4.1',title:'F',blocks:['diag5','shots5'],subs:[]}]}]}}).toc.find(n=>n.num==='4').subs.find(s=>s.num==='4.1').blocks`);
  ok(!mk('[]').includes('shots5'), 'ancien état vide : shots5 détaché');
  ok(mk(`[{dataUrl:'data:image/png;base64,xx',name:'c.png'}]`).includes('shots5'), 'captures existantes : conservées');
}
// 12c. exports : plus de section Captures
{
  const sh = sn => zx[`xl/worksheets/sheet${sheetIdx[sn]}.xml`];
  ok(!sh('4.1').includes('Captures d') && !sh('4.2').includes('Captures d') && !sh('4.3').includes('Captures d'), 'Excel : aucune section Captures');
  const rep = W(`buildHtmlReportFile(WS, { plan: null, topo: null, rackShots: new Map(), logoSvg: '' }, null)`);
  ok(!rep.includes('class="shots"'), 'HTML : aucune section Captures');
  ok(W(`lldInfoDef('shots5') && lldInfoDef('shots5').kind`) === 'shots', 'compat : def shots5 conservée');
}

console.log(`\n==== ${PASS} PASS, ${FAIL} FAIL ====`);
process.exit(FAIL ? 1 : 0);
