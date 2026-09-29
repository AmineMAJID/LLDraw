/* Harnais de l'export « Présentation HLD (.pptx) » :
   exécute le code RÉEL extrait de app.js + hldpptx.js sur l'état démo et
   écrit le .pptx sur le disque (images de démo embarquées à la place des
   rendus canvas du navigateur).
   Usage : node tools/run_pptx.mjs [état.json] [répSortie] */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const hldSrc = readFileSync(path.join(ROOT, 'hldpptx.js'), 'utf8');

function slice(src, startRe, endRe) {
  const a = src.search(startRe);
  const b = src.slice(a).search(endRe);
  if (a < 0 || b < 0) throw new Error(`slice introuvable: ${startRe}`);
  return src.slice(a, a + b + src.slice(a).match(endRe)[0].length);
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
  fn('warrantyRows'),
  fn('warrantySummary'),
  fn('cableDomainLabel'),
  fn('siteName'),
  fn('siteColor'),
];

const pptxSrc = slice(hldSrc, /const HLD_PPTX = \(\(\) => \{/, /return \{ build \};\s*\}\)\(\);/);

let code = helpers.join('\n\n') + '\n\n' + pptxSrc + '\n\n' +
  'globalThis.__pptx = (ws, opts) => HLD_PPTX.build(ws, opts);\n';

const stubEl = { addEventListener() {}, classList: { add() {}, toggle() {} } };
const sandbox = {
  console, Math, Date, JSON, Set, Map, Array, Object, String, Number, RegExp,
  Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer, TextEncoder,
  parseInt, parseFloat, isNaN,
  $: () => stubEl,
  document: { addEventListener() {} },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (let attempt = 0; attempt < 40; attempt++) {
  try {
    vm.runInContext(code, ctx, { filename: 'harness-pptx.js' });
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

function lazy(name) {
  let src;
  try { src = fn(name); }
  catch { src = between(new RegExp('const ' + name + ' = '), /\n\/\/ |\nconst |\n\/\*/); }
  vm.runInContext(src, ctx, { filename: 'lazy-' + name + '.js' });
}
function runLazy(codeStr) {
  for (let i = 0; i < 30; i++) {
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

const statePath = process.argv[2] || path.join(ROOT, 'demo/demo-state.json');
const outDir = process.argv[3] || path.join(ROOT, 'tools/exports-test');
mkdirSync(outDir, { recursive: true });
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const ws = state.workspaces[0];

sandbox.ws = ws; sandbox.state = state;
runLazy(`
  ws.racks.forEach(normalizeRack);
  for (const d of (state.devices||[])) normInvFields(d);
  normLldInfo(ws); normSites(ws);
`);

const u8Of = p => new Uint8Array(readFileSync(p));
const opts = {
  plan: { bytes: u8Of(path.join(ROOT, 'demo/plan-baies.jpg')) },
  topo: { bytes: u8Of(path.join(ROOT, 'demo/topologie.jpg')) },
  logo: u8Of(path.join(ROOT, 'assets/logo-512.png')),
};
sandbox.__opts = opts;
const u8 = runLazy('__pptx(ws, __opts)');
const buf = Buffer.from(u8);
const outPath = path.join(outDir, 'HLD-demo.pptx');
writeFileSync(outPath, buf);
console.log(`PPTX -> ${outPath} (${buf.length} octets)`);
