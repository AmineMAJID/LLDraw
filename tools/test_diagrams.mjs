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
ok(zx[`xl/worksheets/sheet${sheetIdx['5']}.xml`].includes('Diagramme d’accès FAI'), 'feuille 5: bloc schéma présent (fix remap 5→4.1)');
ok(zx[`xl/worksheets/sheet${sheetIdx['6']}.xml`].includes('Diagramme d’interconnexion'), 'feuille 6: bloc schéma présent');
ok(zx[`xl/worksheets/sheet${sheetIdx['7']}.xml`].includes('Diagramme Firewall'), 'feuille 7: bloc schéma présent');
const drawings = Object.keys(zx).filter(n => n.startsWith('xl/drawings/drawing'));
ok(drawings.length >= 3, `${drawings.length} dessins embarqués (≥3 schémas)`);
ok(Object.keys(zx).some(n => n.startsWith('xl/media/')), 'images JPEG embarquées (xl/media)');
ok(zx[drawings[0]].includes('diagramme-'), 'schémas nommés dans les dessins');

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

console.log(`\n==== ${PASS} PASS, ${FAIL} FAIL ====`);
process.exit(FAIL ? 1 : 0);
