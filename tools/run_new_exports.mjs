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
].join('\n\n');

const xlsxSrc = slice(/const XLSX = \(\(\) => \{/, /return \{ build \};\s*\}\)\(\);/);
const dxSrc = slice(/const DX = \(\(\) => \{/, /return \{ buildAll \};\s*\}\)\(\);/);

// report.js sans la partie « bouton » finale (qui exige le DOM) : on découpe
// avant « /* ---------- Bouton d'export », les stubs plus bas gèrent le reste.
const rptCore = rptSrc.slice(0, rptSrc.search(/\/\* ---------- Recadrage/));

let code = helpers + '\n\n' + xlsxSrc + '\n\n' + dxSrc + '\n\n' + rptCore + '\n\n'
  + 'globalThis.__xlsx = ws => DX.buildAll(ws);\n'
  + 'globalThis.__html = ws => buildHtmlReportFile(ws, {});\n';

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
    if (e instanceof ReferenceError) {
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

sandbox.ws = ws; sandbox.state = state;
vm.runInContext(`
  ws.racks.forEach(normalizeRack);
  for (const d of (state.devices||[])) normInvFields(d);
  normLldInfo(ws); normSites(ws);
`, ctx);

// 1) Excel vue données
const blob = vm.runInContext('__xlsx(ws)', ctx, { filename: 'dx.js' });
const buf = Buffer.from(await blob.arrayBuffer());
const xlsxPath = path.join(outDir, 'donnees.xlsx');
writeFileSync(xlsxPath, buf);
console.log(`XLSX  -> ${xlsxPath} (${buf.length} octets)`);

// 2) Rapport HTML
const html = vm.runInContext('__html(ws)', ctx, { filename: 'rpt.js' });
const htmlPath = path.join(outDir, 'rapport.html');
writeFileSync(htmlPath, html);
console.log(`HTML  -> ${htmlPath} (${html.length} caractères)`);
