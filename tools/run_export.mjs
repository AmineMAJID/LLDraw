/* Harnais d'export XLSX : exécute le code d'export réel de app.js (XLSX + LLD_TPL)
   sur un état JSON (par défaut demo/demo-state.json) et écrit le .xlsx sur le disque.
   Usage : node tools/run_export.mjs [état.json] [sortie.xlsx] */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/* Découpe app.js : modules XLSX + LLD_TPL + fonctions utilitaires nécessaires. */
function slice(startRe, endRe) {
  const a = appSrc.search(startRe);
  const b = appSrc.slice(a).search(endRe);
  if (a < 0 || b < 0) throw new Error(`slice introuvable: ${startRe}`);
  return appSrc.slice(a, a + b + appSrc.slice(a).match(endRe)[0].length);
}
// XLSX : de « const XLSX = (() => { » jusqu'à « return { build };\n})(); »
const xlsxSrc = slice(/const XLSX = \(\(\) => \{/, /return \{ build \};\s*\}\)\(\);/);
// LLD_TPL : de « const LLD_TPL = (() => { » jusqu'à « return { buildAll }; » + « })(); »
const lldSrc = slice(/const LLD_TPL = \(\(\) => \{/, /return \{ buildAll \};\s*\}\)\(\);/);

/* Fonctions utilitaires extraites une par une (corps délimité par « function nom »
   et le prochain saut de ligne suivis de « \n}\n » ou « \nfunction »). */
function fn(name) {
  const re = new RegExp(`(?:^|\\n)(function ${name}\\([\\s\\S]*?\\n\\})`, 'm');
  const m = appSrc.match(re);
  if (!m) throw new Error(`fonction introuvable: ${name}`);
  return m[1];
}
function between(a, b) { // de la ligne « a » à la ligne précédant « b » (regex)
  const i = appSrc.search(a);
  const j = appSrc.slice(i).search(b);
  if (i < 0 || j < 0) throw new Error(`between: ${a}`);
  return appSrc.slice(i, i + j);
}

const helpers = [
  `const uid = ${appSrc.match(/const uid = \(\) => [^\n]+/)[0].slice('const uid = '.length)}`,
  between(/\/\/ ---------- Domaines de câblage/, /\/\* ---------- Garantie des devices/), // CABLE_DOMAINS + label
  between(/\/\/ ---------- Catégories de devices/, /\/\/ Catégorie devinée/), // DEV_CATEGORIES..catIcon
  between(/const CAT_BY_PREFIX = \{/, /\/\/ Normalise la catégorie d'un device/),
  fn('normCatField'),
  between(/\/\* ---------- Garantie des devices/, /\/\/ Champs d'inventaire d'un device/), // bloc garantie complet
  `const DEV_TEXT_FIELDS = ['brand', 'model', 'partRef', 'serial', 'ipMgmt', 'vlan', 'warranty'];`,
  fn('normInvFields'),
  fn('normalizeRack'),
  between(/\/\/ ---------- Sites ----------/, /\/\/ ---------- État ----------/), // defaultSites/normSites/siteById/siteName/siteColor
  fn('normLldInfo'),
  fn('slotLabel'),
  fn('sortedRackInstances'),
  fn('sortedRacks'),
  fn('portsRowsByCat'),
  fn('flowsRows'),
  fn('sitesRows'),
  fn('nomenRows'),
  fn('addressingRows'),
  between(/\/\/ Corps commun du tableau de câblage/, /function portsRows\(/), // cablingRowsBase + cablingRows + byDomain
  fn('resolveEndpoint'),
  fn('cableDomainLabel'),
].join('\n\n');

/* Le bloc « catégories » s'arrête avant normCatField : ajoute normCat & co si absents. */
let code = helpers + '\n\n' + xlsxSrc + '\n\n' + lldSrc + '\n\n'
  + 'globalThis.__export = (ws, layout, stylesXml, themeXml) => LLD_TPL.buildAll(ws, layout, stylesXml, themeXml);\n';

const sandbox = {
  console, Math, Date, JSON, Set, Map, Array, Object, String, Number, RegExp, Uint8Array,
  Uint16Array, TextEncoder, Blob, parseInt, parseFloat, isNaN, URL,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

// Boucle de résolution : exécute, ajoute les identifiants manquants, réessaie.
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    vm.runInContext(code, ctx, { filename: 'harness.js' });
    break;
  } catch (e) {
    if (e instanceof ReferenceError) {
      const m = /(\w+) is not defined/.exec(e.message);
      if (!m) throw e;
      const name = m[1];
      console.error(`[harness] manquant: ${name} -> extraction`);
      try { code = fn(name) + '\n' + code; }
      catch {
        try { code = between(new RegExp(`const ${name} = `), /\n\/\/ |\nconst |\n\/\*/) + '\n' + code; }
        catch { throw new Error(`Impossible d'extraire: ${name}`); }
      }
    } else throw e;
  }
}

sandbox.__DEBUG = !!process.env.DEBUG;
/* --- Chargement état + template --- */
const statePath = process.argv[2] || path.join(ROOT, 'demo/demo-state.json');
const outPath = process.argv[3] || path.join(ROOT, 'tools/export.xlsx');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const ws = state.workspaces[0];

const layout = JSON.parse(readFileSync(path.join(ROOT, 'assets/lld/layout.json'), 'utf8'));
const stylesXml = readFileSync(path.join(ROOT, 'assets/lld/styles.xml'), 'utf8');
const themeXml = readFileSync(path.join(ROOT, 'assets/lld/theme1.xml'), 'utf8');

/* Normalisation minimale (comme au chargement de l'app) */
sandbox.ws = ws; sandbox.state = state;
vm.runInContext(`
  ws.racks.forEach(normalizeRack);
  for (const d of (state.devices||[])) normInvFields(d);
  normLldInfo(ws); normSites(ws);
  if (globalThis.__DEBUG) {
    console.log('firewalls:', sortedRackInstances(ws).filter(x => normCat(x.inst.cat) === 'firewall').map(x => x.rack.name + '/' + x.inst.name + '/' + x.inst.cat));
    console.log('vlans side B:', (ws.lld.vlans||[]).filter(v => /agence|rabat|site\\s?b/i.test(v.site||'')).length, '/', ws.lld.vlans.length);
    console.log('fais:', ws.lld.fais.length, '| f2.pfPortLan:', JSON.stringify(ws.lld.fais[1]?.pfPortLan));
  }
`, ctx);

const blob = vm.runInContext('__export(ws, __layout, __styles, __theme)',
  Object.assign(ctx, { __layout: layout, __styles: stylesXml, __theme: themeXml }),
  { filename: 'export.js' });
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync(outPath, buf);
console.log(`OK -> ${outPath} (${buf.length} octets)`);
