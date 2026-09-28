/* Harnais de test des nouveaux exports « lisibles » :
   1) Excel « vue données » (DX.buildAll)  -> tools/exports-test/donnees.xlsx
   2) Rapport HTML interactif (report.js)  -> tools/exports-test/rapport.html
   Exécute le code RÉEL extrait de app.js / report.js sur l'état démo.
   Usage : node tools/run_new_exports.mjs [état.json] [répSortie] */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const rptSrc = readFileSync(path.join(ROOT, 'report.js'), 'utf8');

function slice(startRe, endRe) {
  const a = appSrc.search(startRe);
  const b = appSrc.slice(a).search(endRe);
  if (a < 0 || b < 0) throw new Error(`slice introuvable: ${startRe}`);
  return appSrc.slice(a, a + b + appSrc.slice(a).match(endRe)[0].length);
}
function fn(name) {
  const re = new RegExp(`(?:^|\\n)(function ${name}\\([\\s\\S]*?\\n\\})`, 'm');
  const m = appSrc.match(re);
  if (!m) throw new Error(`fonction introuvable: ${name}`);
  return m[1];
}
function between(a, b) {
  const i = appSrc.search(a);
  const j = appSrc.slice(i).search(b);
  if (i < 0 || j < 0) throw new Error(`between: ${a}`);
  return appSrc.slice(i, i + j);
}

const helpers = [
  `const uid = ${appSrc.match(/const uid = \(\) => [^\n]+/)[0].slice('const uid = '.length)}`,
  between(/\/\/ ---------- Domaines de câblage/, /\/\* ---------- Garantie des devices/),
  between(/\/\/ ---------- Catégories de devices/, /\/\/ Catégorie devinée/),
  between(/const CAT_BY_PREFIX = \{/, /\/\/ Normalise la catégorie d'un device/),
  fn('normCatField'),
  between(/\/\* ---------- Garantie des devices/, /\/\/ Champs d'inventaire d'un device/),
  `const DEV_TEXT_FIELDS = ['brand', 'model', 'partRef', 'serial', 'ipMgmt', 'vlan', 'warranty'];`,
  `const DEV_NUMBER_FIELDS = ['watts', 'weightKg'];`,
  fn('normInvFields'),
  fn('normalizeRack'),
  between(/\/\/ ---------- Sites ----------/, /\/\/ ---------- État ----------/),
  fn('defaultLldToc'),
  fn('normLldToc'),
  fn('normLldInfo'),
  fn('lldExportCols'),
  between(/const LLD_REV_COLS = /, /const LLD_INFOS = \{/),
  fn('slotLabel'),
  fn('sortedRackInstances'),
  fn('sortedRacks'),
  fn('invRows'),
  fn('warrantyRows'),
  fn('warrantySummary'),
  fn('catSummaryRows'),
  fn('portsRowsByCat'),
  fn('flowsRows'),
  fn('sitesRows'),
  fn('nomenRows'),
  fn('addressingRows'),
  between(/\/\/ Corps commun du tableau de câblage/, /function portsRows\(/),
  fn('portsRows'),
  fn('racksRows'),
  fn('resolveEndpoint'),
  fn('cableDomainLabel'),
  // Constantes du board nécessaires au recadrage (référencées par report.js)
  `const U_H = 33; const RACK_W = 356;`,
  fn('rackHeight'),
  // Dependances paresseuses de buildLldPdf / LLD_TPL (appelees au test, pas a l'init)
  fn('fmtWatts'),
  fn('lldTocRemap'),
  between(/const LLD_DIAG_CAP_H = /, /function lldDiagPortXY/),
  fn('lldDiagSeedCats'),
  fn('lldDiagEmptyHint'),
  fn('lldDiagTitle'),
  fn('lldBuildDiagData'),
  fn('lldDiagNeedsRebuild'),
  fn('lldEnsureDiag'),
].join('\n\n');

const xlsxSrc = slice(/const XLSX = \(\(\) => \{/, /return \{ build \};\s*\}\)\(\);/);
const dxSrc = slice(/const DX = \(\(\) => \{/, /return \{ buildAll, SHEET_ITEMS \};\s*\}\)\(\);/);
// Template XLSX (LLD_TPL) + PDF LLD natif, pour tester aussi leurs filtres
const lldSrc = slice(/const LLD_TPL = \(\(\) => \{/, /return \{ buildAll \};\s*\}\)\(\);/);
const pdfHelpers = between(/const WINANSI_EXTRA = \{/, /function buildLldPdf/);
const pdfSrc = fn('buildLldPdf');
// LLD_INFOS : grand littéral utilisé par pdfDrawBlock (terminé par un saut de ligne)
const infosSrc = slice(/const LLD_INFOS = \{/, /\/\/ Sections générées automatiquement à l'export[^\n]*\n/);

// report.js sans la partie « bouton » finale (qui exige le DOM) : on découpe
// avant « /* ---------- Bouton d'export », les stubs plus bas gèrent le reste.
const rptCore = rptSrc.slice(0, rptSrc.search(/\/\* ---------- Recadrage/));

let code = helpers + '\n\n' + xlsxSrc + '\n\n' + dxSrc + '\n\n'
  + infosSrc + lldSrc + '\n\n' + pdfHelpers + '\n' + pdfSrc + '\n\n' + rptCore + '\n\n'
  + 'globalThis.__xlsx = ws => DX.buildAll(ws);\n'
  + 'globalThis.__xlsxSel = (ws, names) => DX.buildAll(ws, new Set(names));\n'
  + 'globalThis.__html = (ws, picked) => buildHtmlReportFile(ws, {}, picked ? new Set(picked) : null);\n'
  + 'globalThis.__tpl = (ws, layout, st, th, nums) => LLD_TPL.buildAll(ws, layout, st, th, nums ? new Set(nums) : null);\n'
  + 'globalThis.__pdf = (ws, nums) => buildLldPdf(ws, null, 0, 0, null, 0, 0, nums ? { only: new Set(nums) } : {});\n';

const stubEl = { addEventListener() {}, classList: { add() {}, toggle() {} } };
const sandbox = {
  console, Math, Date, JSON, Set, Map, Array, Object, String, Number, RegExp,
  Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer, TextEncoder, Blob,
  parseInt, parseFloat, isNaN, URL,
  $: () => stubEl,
  document: { addEventListener() {}, createElement: () => ({ getContext: () => null, toDataURL: () => '' }) },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (let attempt = 0; attempt < 30; attempt++) {
  try {
    vm.runInContext(code, ctx, { filename: 'harness.js' });
    break;
  } catch (e) {
    if (e && e.name === 'ReferenceError') {
      const m = /([\w$]+) is not defined/.exec(e.message);
      if (!m) throw e;
      const name = m[1];
      console.error(`[harness] manquant: ${name} -> extraction depuis app.js`);
      try { code = fn(name) + '\n' + code; }
      catch {
        try { code = between(new RegExp(`const ${name} = `), /\n\/\/ |\nconst |\n\/\*/) + '\n' + code; }
        catch { throw new Error(`Impossible d'extraire: ${name}`); }
      }
    } else throw e;
  }
}

const statePath = process.argv[2] || path.join(ROOT, 'demo/demo-state.json');
const outDir = process.argv[3] || path.join(ROOT, 'tools/exports-test');
mkdirSync(outDir, { recursive: true });
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const ws = state.workspaces[0];

// Extraction paresseuse : si un identifiant manque au moment d'un appel
// (buildLldPdf / LLD_TPL ne s'executent qu'ici), on l'extrait et on rejoue.
function lazy(name) {
  let src;
  try { src = fn(name); }
  catch { src = between(new RegExp('const ' + name + ' = '), /\n\/\/ |\nconst |\n\/\*/); }
  vm.runInContext(src, ctx, { filename: 'lazy-' + name + '.js' });
}
function runLazy(codeStr) {
  for (let i = 0; i < 25; i++) {
    try { return vm.runInContext(codeStr, ctx, { filename: 'lazy-call.js' }); }
    catch (e) {
      const m = e && e.name === 'ReferenceError' ? /([\w$]+) is not defined/.exec(e.message) : null;
      if (!m) throw e;
      console.error('[harness] manquant (lazy): ' + m[1]);
      lazy(m[1]);
    }
  }
  throw new Error('runLazy: trop de symboles manquants');
}

sandbox.ws = ws; sandbox.state = state;
runLazy(`
  ws.racks.forEach(normalizeRack);
  for (const d of (state.devices||[])) normInvFields(d);
  normLldInfo(ws); normSites(ws);
`);

// 1) Excel vue données
const blob = runLazy('__xlsx(ws)');
const buf = Buffer.from(await blob.arrayBuffer());
const xlsxPath = path.join(outDir, 'donnees.xlsx');
writeFileSync(xlsxPath, buf);
console.log(`XLSX  -> ${xlsxPath} (${buf.length} octets)`);

// 2) Rapport HTML
const html = runLazy('__html(ws)');
const htmlPath = path.join(outDir, 'rapport.html');
writeFileSync(htmlPath, html);
console.log(`HTML  -> ${htmlPath} (${html.length} caractères)`);


// 3) Tests du filtrage par selection ---------------------------------------
const sheetNames = buf => [...Buffer.from(buf).toString('latin1').matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
const startsNum = n => /^\d+\./.test(n);

// 3a) Rapport HTML : ne garder que 3 rubriques
runLazy(`globalThis.__htmlSel = buildHtmlReportFile(ws, {}, new Set(['sec-inv', 'sec-cab', 'sec-gov']));`);
const htmlSel = sandbox.__htmlSel;
for (const id of ['sec-inv', 'sec-cab', 'sec-gov'])
  if (!htmlSel.includes('id="' + id + '"')) throw new Error('HTML selectif : rubrique manquante ' + id);
for (const id of ['sec-sites', 'sec-ports', 'sec-fw'])
  if (htmlSel.includes('id="' + id + '"')) throw new Error('HTML selectif : rubrique non filtree ' + id);
console.log('OK filtre HTML : sec-inv + sec-cab + sec-gov conserves, autres exclus');

// 3b) Excel vue donnees : ne garder que 2 onglets
const dxSel = await runLazy("__xlsxSel(ws, ['Inventaire', 'Garanties']).arrayBuffer()");
const dxNames = sheetNames(Buffer.from(dxSel));
if (dxNames.join('|') !== 'Sommaire|Inventaire|Garanties')
  throw new Error('XLSX donnees selectif : onglets inattendus -> ' + dxNames.join('|'));
console.log('OK filtre XLSX donnees : ' + dxNames.join(', '));

// 3c) Excel template LLD : ne garder que les chapitres 1 et 15 (assets reels)
sandbox.tplAssets = {
  layout: JSON.parse(readFileSync(path.join(ROOT, 'assets/lld/layout.json'), 'utf8')),
  stylesXml: readFileSync(path.join(ROOT, 'assets/lld/styles.xml'), 'utf8'),
  themeXml: readFileSync(path.join(ROOT, 'assets/lld/theme1.xml'), 'utf8'),
};
const tplFullBuf = Buffer.from(await runLazy('__tpl(ws, tplAssets.layout, tplAssets.stylesXml, tplAssets.themeXml, null).arrayBuffer()'));
const tplSelBuf = Buffer.from(await runLazy("__tpl(ws, tplAssets.layout, tplAssets.stylesXml, tplAssets.themeXml, ['1','15']).arrayBuffer()"));
const fullTn = sheetNames(tplFullBuf), selTn = sheetNames(tplSelBuf);
if (!(fullTn.length > selTn.length)) throw new Error('Template selectif : pas de reduction des onglets');
const rootOf = n => n.split('.')[0];
if (!fullTn.includes('1') || !fullTn.includes('2') || !fullTn.includes('15'))
  throw new Error('Template complet : onglets attendus absents -> ' + fullTn.join('|'));
if (!selTn.includes('1') || !selTn.includes('15'))
  throw new Error('Template selectif : chapitre conserve absent -> ' + selTn.join('|'));
if (selTn.some(n => startsNum(n) && rootOf(n) !== '1' && rootOf(n) !== '15'))
  throw new Error('Template selectif : onglet non filtre -> ' + selTn.join('|'));
console.log('OK filtre XLSX template : ' + selTn.length + ' onglets (' + selTn.join(', ') + ')');

// 3d) PDF LLD : complet vs chapitres {1, 15}
const toL1 = b => Buffer.from(b).toString('latin1');
const pdfFull = toL1(runLazy('__pdf(ws, null)'));
const pdfSel = toL1(runLazy("__pdf(ws, ['1','15'])"));
const countPages = s => (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
for (const t of ['2. Information sur le site', '14. Flux r\u00e9seau', '15. Cablage/Rack'])
  if (!pdfFull.includes(t)) throw new Error('PDF complet : titre manquant -> ' + t);
for (const t of ['1. Objectif du document', '15. Cablage/Rack', 'Cablage/Rack'])
  if (!pdfSel.includes(t)) throw new Error('PDF selectif : titre conserve absent -> ' + t);
for (const t of ['2. Information sur le site', '4. Conception Nomenclature', '5. Conception et Configuration FAI'])
  if (pdfSel.includes(t)) throw new Error('PDF selectif : chapitre non filtre -> ' + t);
console.log('OK filtres PDF : complet ' + countPages(pdfFull) + ' pages / selectif ' + countPages(pdfSel) + ' pages');
console.log('TOUS LES TESTS PASSENT');
