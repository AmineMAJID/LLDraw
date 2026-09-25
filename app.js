'use strict';

/* ============================================================
   LLDraw
   - Board navigable : zoom (molette / boutons) et pan (glisser le fond)
   - Glisser-déposer de racks de tailles variables sur le board
   - Création de devices (nom, taille en U, photo de face avant)
   - Drop des devices dans les racks : verrouillage auto à l'étage (U)
   - Mode "Étiquetage" : ports (carrés) + infobulle nom/étiquette
   - Workspaces avec écran d'accueil ; bibliothèque de devices partagée
   - Undo/Redo (Ctrl+Z / Ctrl+Y), export/import JSON, recherche globale
   - Persistance dans localStorage
   ============================================================ */

// Device permanent WatchGuard
const WATCHGUARD_ID = 'watchguard-permanent';

function ensureWatchGuard() {
  const exists = state.devices.some(d => d.id === WATCHGUARD_ID);
  if (!exists) {
    state.devices.unshift({
      id: WATCHGUARD_ID,
      name: 'WatchGuard',
      sizeU: 1,
      photo: null,
      permanent: true,
      cat: 'firewall',
      brand: 'WatchGuard',
      model: 'Firebox',
      partRef: '',
      serial: '',
      ipMgmt: '',
      vlan: '',
      watts: 25,
      weightKg: 2.5,
      ports: []
    });
    saveState();
  }
}

// Charger l'image WatchGuard depuis le fichier
async function loadWatchGuardPhoto() {
  try {
    const res = await fetch('assets/watchguard.jpg');
    if (!res.ok) return;
    const blob = await res.blob();
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const wg = state.devices.find(d => d.id === WATCHGUARD_ID);
    if (wg) {
      wg.photo = dataUrl;
      saveState();
      renderPalette();
    }
  } catch (e) { /* pas de photo watchguard disponible */ }
}

// Charger la photo au démarrage
loadWatchGuardPhoto();

// ---------- Constantes ----------
const STORAGE_KEY = 'dc-rack-planner-v1';
const DEFAULT_RACK_U = 12;    // taille par défaut d'un rack
const U_H     = 33;          // hauteur d'un U en px (coordonnées board)
const RACK_W  = 356;         // largeur d'un rack
const RACK_SIZES = [6, 9, 12, 15, 18, 22, 27, 32, 42];
const BOARD_W = 8000;
const BOARD_H = 6000;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

// ---------- Sommaire du dossier LLD (chapitres + sous-chapitres) ----------
// Le sommaire structure la modale 📘 ET les exports : les titres renommés
// sont repris dans le PDF (sommaire + titres) et dans l'Excel (titres de
// feuilles) ; les contenus attachés aux chapitres restent stockés aux mêmes
// clés (ws.lld.*) pour rester synchronisés avec les exports.
// Construit la structure cible par défaut (15 chapitres + sous-chapitres) ;
// « blocks » = clés d'infos insertibles attachées à chaque nœud.
function defaultLldToc() {
  const ch = (num, title, blocks = [], subs = [], extra = {}) =>
    Object.assign({ id: uid(), num, title, blocks, subs }, extra);
  const sub = (num, title, blocks = []) => ({ id: uid(), num, title, blocks, subs: [] });
  return [
    { id: 'cover', num: '📄', title: 'Page de garde', cover: true,
      blocks: ['meta', 'governance'], subs: [] },
    ch('1', 'Objectif du document', ['objectif']),
    ch('2', 'Aperçu du site', [], [
      sub('2.1', 'Information sur le site', ['sites']),
      sub('2.2', 'L’infrastructure existante', ['existant'])
    ]),
    ch('3', 'Architecture cible', ['architecture'], [
      sub('3.1', 'Équipements', ['equip'])
    ]),
    ch('4', 'Conception Nomenclature et Adressage IP Global',
       ['addrMatrix', 'vlans', 'nomen']),
    ch('5', 'Conception et Configuration FAI', ['diag5', 'shots5'], [
      sub('5.1', 'Informations & Configuration', ['fais']),
      sub('5.2', 'Câblage', ['faiCab'])
    ]),
    ch('6', 'Conception et Configuration Interconnexion site 2 site', ['diag6', 'shots6'], [
      sub('6.1', 'Informations & Configuration', ['ic61', 'adminSec', 'icWan', 'icLan']),
      sub('6.2', 'Câblage', ['icCab'])
    ]),
    ch('7', 'Conception et Configuration Firewall', ['diag7', 'shots7', 'fw', 'note:firewall']),
    // ch. 8 : pas de sous-chapitres ajoutés à la main — le PDF découpe
    // 8.1, 8.2… dynamiquement selon les zones de Switching (info « zones »).
    ch('8', 'Conception et Configuration Switching', ['zones', 'note:switching'], [], { noSubs: true }),
    ch('9', 'Conception et Configuration Serveurs', ['vms', 'note:server']),
    ch('10', 'Conception et Configuration Stockage', ['vols', 'note:storage']),
    ch('11', 'Conception et Configuration Intrusion (IDS)', ['note:ids']),
    ch('12', 'Conception et Configuration CCTV', ['cams', 'note:cctv']),
    ch('13', 'Conception et Configuration Pointage (SPO)', ['note:pointage']),
    ch('14', 'Flux réseau et diagram', ['flows']),
    ch('15', 'Câblage / Rack', [])
  ];
}

// Colonnes effectives d'un tableau du dossier : surcharge éventuelle
// `L.gridCols[id]` (ajouts / suppressions faits dans la modale 📘), sinon
// les colonnes par défaut. Utilisé par l'éditeur ET tous les exports.
function lldExportCols(L, id, defCols) {
  const g = L && L.gridCols;
  if (g && Object.prototype.hasOwnProperty.call(g, id)
      && Array.isArray(g[id]) && g[id].length) return g[id];
  return defCols;
}

// Schéma de colonnes d'une grille (copie indépendante des défauts).
function lldGridCols(tableId, defCols) {
  const L = (lldDraft && lldDraft.lld) || {};
  return lldExportCols(L, tableId, defCols).map(c => (Array.isArray(c) ? c.slice() : c));
}
function lldSetGridCols(tableId, cols) {
  const L = lldDraft.lld;
  L.gridCols = (L.gridCols && typeof L.gridCols === 'object' && !Array.isArray(L.gridCols)) ? L.gridCols : {};
  L.gridCols[tableId] = cols;
}
// Re-rendu du panneau courant (après ajout/suppression/renommage d'une colonne).
function lldRerenderDetail() {
  if (!lldSelId) return;
  const loc = lldLocate(lldSelId);
  if (loc) lldRenderDetail(loc.node);
}

// ---- Annulation / rétablissement (Ctrl+Z, Ctrl+Shift+Z) dans la modale 📘 ----
// Pile de snapshots JSON du brouillon {lld, sites, flows}. Un instantané est
// poussé AVANT chaque mutation structurelle (colonnes, lignes, sommaire,
// blocs d'infos) et à chaque focus sur un champ (saisies). Ctrl+Z restaure le
// dernier état, Ctrl+Shift+Z / Ctrl+Y le rétablissent.
let lldUndoStack = [];
let lldRedoStack = [];
let lldDragCol = null;        // colonne en cours de glisser-déposer {tableId, from}
let lldUndoApplying = false;  // true pendant une restauration (pas de snapshot)

function lldPushUndo(clearRedo = true) {
  if (!lldDraft || lldUndoApplying) return;
  lldFlushDetail();                      // saisies DOM pas encore écrites
  const snap = JSON.stringify(lldDraft);
  if (lldUndoStack.length && lldUndoStack[lldUndoStack.length - 1] === snap) return;
  lldUndoStack.push(snap);
  if (lldUndoStack.length > 60) lldUndoStack.shift();
  if (clearRedo) lldRedoStack = [];
}

function lldApplyUndoSnap(snap) {
  // Le panneau est vidé/caché AVANT la restauration : le flush de
  // lldRenderDetail ne doit pas réécrire les champs DOM (état d'avant) dans
  // le brouillon qu'on vient de restaurer.
  const body = $('#lld-detail-body');
  if (body) { body.innerHTML = ''; body.classList.add('hidden'); }
  const s = JSON.parse(snap);
  lldUndoApplying = true;
  try {
    lldDraft = { lld: s.lld, sites: s.sites, flows: s.flows };
    lldRenderToc();
    const loc = lldSelId && lldLocate(lldSelId);
    if (loc) {
      lldRenderDetail(loc.node);
    } else {
      lldSelId = null;
      const empty = $('#lld-detail-empty');
      if (empty) empty.classList.remove('hidden');
    }
  } finally {
    lldUndoApplying = false;
  }
}

function lldUndo() {
  if (!lldDraft || !lldUndoStack.length) return;
  lldFlushDetail();
  const cur = JSON.stringify(lldDraft);
  // Saute les doublons au sommet (focus sans édition).
  while (lldUndoStack.length > 1 && lldUndoStack[lldUndoStack.length - 1] === cur) {
    lldUndoStack.pop();
  }
  const snap = lldUndoStack[lldUndoStack.length - 1];
  if (snap === cur) return;              // rien de plus ancien → no-op
  lldUndoStack.pop();
  lldRedoStack.push(cur);
  lldApplyUndoSnap(snap);
}

function lldRedo() {
  if (!lldDraft || !lldRedoStack.length) return;
  lldFlushDetail();
  const cur = JSON.stringify(lldDraft);
  while (lldRedoStack.length > 1 && lldRedoStack[lldRedoStack.length - 1] === cur) {
    lldRedoStack.pop();
  }
  const snap = lldRedoStack[lldRedoStack.length - 1];
  if (snap === cur) return;
  lldRedoStack.pop();
  if (!lldUndoStack.length || lldUndoStack[lldUndoStack.length - 1] !== cur) {
    lldUndoStack.push(cur);
  }
  lldApplyUndoSnap(snap);
}

// Normalise un sommaire chargé : préserve les renommages, les contenus
// attachés et les chapitres ajoutés, re-génère les nœuds d'origine manquants
// (rétro-compatibilité / état corrompu) pour que les exports restent cohérents.
function normLldToc(raw) {
  const def = defaultLldToc();
  const normBlocks = (b, fb) => Array.isArray(b)
    ? b.filter(x => typeof x === 'string' && x.length <= 60)
    : (Array.isArray(fb) ? fb.slice() : []);
  // Nœud ajouté par l'utilisateur (chapitre racine ou sous-chapitre)
  const normCustom = r => ({
    id: String(r.id || uid()), num: String(r.num ?? '').slice(0, 10),
    title: String(r.title ?? 'Chapitre').slice(0, 120) || 'Chapitre',
    blocks: normBlocks(r.blocks, []),
    // les enfants d'un nœud personnalisé le sont implicitement
    subs: (Array.isArray(r.subs) ? r.subs : [])
      .filter(s => s && typeof s === 'object')
      .map(normCustom),
    custom: true
  });
  const normNode = (r, d) => {
    const subs = [];
    const rawSubs = Array.isArray(r.subs) ? r.subs.filter(s => s && typeof s === 'object') : [];
    (d.subs || []).forEach(ds => {
      const hit = rawSubs.find(s => String(s.num) === ds.num);
      subs.push(hit ? normNode(hit, ds) : ds);
    });
    rawSubs.forEach(rs => {
      if (rs.custom && !subs.some(x => String(x.num) === String(rs.num)))
        subs.push(normCustom(rs));
    });
    let blocks = normBlocks(r.blocks, d.blocks);
    // Ch. 4 : les blocs éclatés (vpns / aliases / fwProfiles) fusionnent en une
    // seule matrice calquée sur la feuille Excel « 4 » — même disposition.
    if (String(d.num) === '4') {
      const legacy = ['fwProfiles', 'vpns', 'aliases'];
      if (blocks.some(b => legacy.includes(b)) && !blocks.includes('addrMatrix')) {
        blocks = ['addrMatrix', ...blocks.filter(b => !legacy.includes(b))];
      }
      const std = ['addrMatrix', 'vlans', 'nomen'];
      const rest = blocks.filter(b => !std.includes(b));
      blocks = [...std.filter(b => blocks.includes(b)), ...rest];
    }
    // Ch. 5/6/7 : injection unique du diagramme + captures en tête de blocs
    // (l'ancien sommaire n'avait rien avant 5.1 / 6.1 ; blocksSeeded évite
    // de ressusciter un bloc détaché par l'utilisateur).
    let blocksSeeded = r.blocksSeeded === 1 || r.blocksSeeded === true;
    let blocksSeeded2 = r.blocksSeeded2 === 1 || r.blocksSeeded2 === true;
    const seedNum = String(d.num);
    // Injection unique (blocksSeeded) — ne ressuscite pas un bloc détaché :
    //  - ch. 5/6/7 : diagramme + captures en tête
    //  - 5.1/5.2  : tableaux Excel (fais / faiCab) si l'ancien sommaire
    //    les avait vides (modèle avant les tableaux du dossier)
    if (!blocksSeeded) {
      const SEED = {
        '5': ['diag5', 'shots5'],
        '6': ['diag6', 'shots6'],
        '7': ['diag7', 'shots7'],
        '5.1': ['fais'],
        '5.2': ['faiCab'],
        '6.1': ['ic61', 'icWan', 'icLan'],
        '6.2': ['icCab']
      };
      const pref = SEED[seedNum] || [];
      const need = pref.filter(k => !blocks.includes(k));
      if (need.length) blocks = [...need, ...blocks];
      if (pref.length) { blocksSeeded = true; blocksSeeded2 = true; }
    } else if (!blocksSeeded2 && seedNum === '6.1') {
      // Migration 18g : les sommaires déjà seedés (ic61 seul) reçoivent
      // WAN/LAN une seule fois — un détachement reste détaché ensuite.
      // Insertion après ic61 (ordre visuel de la feuille Excel « 6 »).
      const need = ['icWan', 'icLan'].filter(k => !blocks.includes(k));
      if (need.length) {
        const at = blocks.indexOf('ic61');
        if (at >= 0) blocks = [...blocks.slice(0, at + 1), ...need, ...blocks.slice(at + 1)];
        else blocks = [...need, ...blocks];
      }
      blocksSeeded2 = true;
    }
    // 6.1 : ordre calqué sur la feuille Excel à chaque passage
    // (extrémités → Admin Security → WAN → LAN). La fiche « Interconnexion
    // site 2 site » (interco) est retirée du sommaire sur demande — les
    // valeurs L.interco restent utilisées en source pour les exports.
    // Ne réintroduit jamais un bloc absent/détaché.
    if (seedNum === '6.1') {
      if (blocks.includes('interco')) blocks = blocks.filter(k => k !== 'interco');
      const ORDER = ['ic61', 'adminSec', 'icWan', 'icLan'];
      const known = ORDER.filter(k => blocks.includes(k));
      const rest = blocks.filter(k => !ORDER.includes(k));
      if (known.length) blocks = [...known, ...rest];
    }
    return {
      id: String(r.id || d.id || uid()),
      num: String(r.num ?? d.num),
      title: String(r.title ?? d.title).slice(0, 120) || d.title,
      blocks,
      subs,
      ...(d.cover ? { cover: true } : {}),
      ...(d.noSubs ? { noSubs: true } : {}),
      ...(r.custom || d.custom ? { custom: true } : {}),
      ...(blocksSeeded ? { blocksSeeded: true } : {}),
      ...(blocksSeeded2 ? { blocksSeeded2: true } : {})
    };
  };
  if (!Array.isArray(raw) || !raw.length) return def;
  const rawRoots = raw.filter(r => r && typeof r === 'object');
  const out = [];
  const coverRaw = rawRoots.find(r => r.cover || String(r.num) === '📄') ||
                   rawRoots.find(r => String(r.id) === 'cover');
  out.push(coverRaw ? normNode(coverRaw, def[0]) : def[0]);
  // 1) chapitres d'origine (titres/blocks/ sous-chapitres fusionnés)
  const defNums = new Set(def.slice(1).map(d => d.num));
  def.slice(1).forEach(d => {
    const hit = rawRoots.find(r => String(r.num) === d.num);
    out.push(hit ? normNode(hit, d) : d);
  });
  // 2) chapitres ajoutés par l'utilisateur, dans leur ordre d'origine
  const seen = new Set([...defNums, '📄']);
  rawRoots.forEach(r => {
    const num = String(r.num ?? '');
    if (!num || r.cover || r.cover === true || String(r.num) === '📄') return;
    if (seen.has(num)) return;
    if (!r.custom) return;              // un nœud non reconnu n'est pas ré-importé
    seen.add(num);
    const node = normCustom(r);
    node.num = num.slice(0, 10);
    out.push(node);
    // sous-chapitres ajoutés sous ce chapitre
    node.subs.forEach(s => seen.add(s.num));
  });
  return out;
}

// Infos du dossier LLD portées par le workspace (page de garde, révisions, VLANs)
function normLldInfo(w) {
  if (!w.lld || typeof w.lld !== 'object') w.lld = {};
  const L = w.lld;
  for (const k of ['client', 'author', 'version']) {
    if (typeof L[k] !== 'string') L[k] = '';
    L[k] = L[k].slice(0, 80);
  }
  // Page de garde : informations directes (pas de libellé/placeholder vide) —
  // l'auteur et la version sont pré-remplis tant qu'ils n'ont pas été saisis.
  if (!L.author.trim()) L.author = 'Amine MJID';
  if (!L.version.trim()) L.version = '1.0';
  // Textes documentaires (ch. 1, 2.2 et 3 du dossier LLD)
  for (const k of ['objectif', 'existant', 'architecture']) {
    if (typeof L[k] !== 'string') L[k] = '';
    L[k] = L[k].slice(0, 4000);
  }
  // Ch. 1 : paragraphe de présentation (texte autrefois gravé dans le
  // template Excel) pré-rempli UNE seule fois — modifiable et supprimable ;
  // objectifSeeded évite que la suppression soit ressuscitée au rechargement.
  if (L.objectifSeeded !== 1) {
    if (!L.objectif.trim()) {
      L.objectif = 'La conception de bas niveau est une description détaillée de chaque module.\n'
        + 'Il décrit chaque module en détail en incorporant la logique derrière chaque composant du système.\n'
        + 'Il approfondit chaque spécification de chaque système, offrant une conception au niveau micro.\n'
        + 'Cette conception décompose les solutions de haut niveau dans les moindres détails.';
    }
    L.objectifSeeded = 1;
  }
  // Nomenclature (ch. 4) : type d'objet -> préfixe -> exemple -> règle de nommage
  // Conserve les clés hors schéma (colonnes ajoutées dans la modale 📘).
  const keepExtras = (o, r) => {
    for (const k of Object.keys(r)) {
      if (!(k in o) && typeof r[k] === 'string') o[k] = r[k].slice(0, 120);
    }
    return o;
  };
  L.nomen = Array.isArray(L.nomen) ? L.nomen.filter(r => r && typeof r === 'object').map(r => keepExtras({
    type:    String(r.type ?? '').slice(0, 40),
    prefix:  String(r.prefix ?? '').slice(0, 20),
    example: String(r.example ?? '').slice(0, 60),
    rule:    String(r.rule ?? '').slice(0, 100)
  }, r)) : [];
  // Approbateurs et réviseurs affichés sur la page de garde du PDF.
  const normSignatories = rows => Array.isArray(rows) ? rows
    .filter(r => r && typeof r === 'object')
    .map(r => keepExtras({
      name: String(r.name ?? '').slice(0, 80),
      position: String(r.position ?? '').slice(0, 80),
      organization: String(r.organization ?? '').slice(0, 80),
      approvedVersion: String(r.approvedVersion ?? '').slice(0, 30)
    }, r)) : [];
  L.approvers = normSignatories(L.approvers);
  L.reviewers = normSignatories(L.reviewers);
  L.revs = Array.isArray(L.revs) ? L.revs.filter(r => r && typeof r === 'object').map(r => keepExtras({
    rev: String(r.rev ?? '').slice(0, 10),
    date: String(r.date ?? '').slice(0, 10),
    author: String(r.author ?? '').slice(0, 60),
    note: String(r.note ?? '').slice(0, 120)
  }, r)) : [];
  L.vlans = Array.isArray(L.vlans) ? L.vlans.filter(v => v && typeof v === 'object').map(v => keepExtras({
    vid: String(v.vid ?? '').slice(0, 6),
    name: String(v.name ?? '').slice(0, 40),
    site: String(v.site ?? '').slice(0, 60),
    subnet: String(v.subnet ?? '').slice(0, 50),
    gw: String(v.gw ?? '').slice(0, 50),
    purpose: String(v.purpose ?? '').slice(0, 60)
  }, v)) : [];
  // FAI (ch. 5.1) et interconnexion site à site (ch. 6.1)
  if (!L.fai || typeof L.fai !== 'object') L.fai = {};
  for (const k of ['operator', 'offer', 'linkType', 'down', 'up', 'publicBlock', 'cpe', 'cpeIp']) {
    if (typeof L.fai[k] !== 'string') L.fai[k] = '';
    L.fai[k] = L.fai[k].slice(0, 120);
  }
  if (typeof L.fai.notes !== 'string') L.fai.notes = '';
  L.fai.notes = L.fai.notes.slice(0, 2000);
  // FAI multiples (ch. 5) : L.fais est la liste source ; L.fai (= 1er FAI)
  // reste synchronisé pour le PDF et les traitements historiques.
  const normFai = f => {
    const o = {};
    for (const k of ['operator', 'offer', 'linkType', 'down', 'up', 'publicBlock', 'cpe', 'cpeIp',
                     'ipMode', 'wanIp', 'wanMask', 'wanGw', 'wanDns', 'wanLabel', 'lanIp', 'lanMask', 'lanGw', 'lanDns',
                     'ipv6', 'dhcp', 'pf', 'pfPortWan', 'pfPortLan', 'pfClient', 'pfProto',
                     'dmz', 'firewall', 'wlan', 'wlanStat'])
      o[k] = String(f[k] ?? '').slice(0, 120);
    o.notes = String(f.notes ?? '').slice(0, 2000);
    return o;
  };
  L.fais = Array.isArray(L.fais) ? L.fais.filter(f => f && typeof f === 'object').map(normFai) : [];
  if (!L.fais.length) {
    const f0 = normFai(L.fai || {});
    if (f0.operator || f0.offer || f0.down || f0.notes) L.fais = [f0];   // migration ancien état
  }
  L.fai = L.fais[0] || normFai({});
  if (!L.interco || typeof L.interco !== 'object') L.interco = {};
  for (const k of ['tech', 'epA', 'epB', 'localSubnets', 'remoteSubnets', 'routing', 'encryption',
                   'snA', 'fwA', 'haA', 'roleA', 'vipA', 'mgmtA', 'mgmtMaskA', 'lanA', 'clusterA',
                   'snB', 'fwB', 'haB', 'roleB', 'vipB', 'mgmtB', 'mgmtMaskB', 'lanB', 'clusterB']) {
    if (typeof L.interco[k] !== 'string') L.interco[k] = '';
    L.interco[k] = L.interco[k].slice(0, 120);
  }
  // Règles/NAT firewall (ch. 7), VMs (ch. 9), volumes/LUN (ch. 10), caméras (ch. 12)
  const normTable = (arr, spec) => Array.isArray(arr)
    ? arr.filter(r => r && typeof r === 'object').map(r => {
        const o = {};
        for (const [k, n] of spec) o[k] = String(r[k] ?? '').slice(0, n);
        // + colonnes ajoutées dans la modale (clés hors schéma)
        for (const k of Object.keys(r)) {
          if (!(k in o) && typeof r[k] === 'string') o[k] = r[k].slice(0, 120);
        }
        return o;
      })
    : [];
  L.fw = normTable(L.fw, [['type', 12], ['name', 40], ['src', 60], ['dst', 60], ['service', 60], ['action', 20]]);
  L.vpns = normTable(L.vpns, [['name', 40], ['peer', 60]]);
  L.aliases = normTable(L.aliases, [['name', 40], ['value', 80]]);
  L.equip = normTable(L.equip, [['model', 70], ['qty', 20], ['remark', 80], ['status', 20]]);
  L.adminSec = normTable(L.adminSec, [
    ['user', 60], ['auth', 40], ['proto', 20], ['host', 60], ['port', 20],
    ['cli', 20], ['sec', 40], ['webA', 60], ['webB', 60], ['note', 120]
  ]);
  if (!L.fwProfiles || typeof L.fwProfiles !== 'object') L.fwProfiles = {};
  for (const k of ['vpnSsl', 'appCtrl', 'webBlocker', 'httpProxy']) {
    if (typeof L.fwProfiles[k] !== 'string') L.fwProfiles[k] = '';
    L.fwProfiles[k] = L.fwProfiles[k].slice(0, 60);
  }
  L.vms = normTable(L.vms, [['name', 40], ['role', 60], ['host', 40], ['ip', 40]]);
  L.vols = normTable(L.vols, [['name', 40], ['size', 30], ['type', 30], ['srv', 40]]);
  L.cams = normTable(L.cams, [['name', 40], ['loc', 60], ['model', 40], ['ip', 40]]);
  if (typeof L.interco.notes !== 'string') L.interco.notes = '';
  L.interco.notes = L.interco.notes.slice(0, 2000);
  // Captures d’écran (ch. 5/6/7) + diagrammes générés
  const normShots = arr => (Array.isArray(arr) ? arr : [])
    .filter(s => s && typeof s === 'object' && typeof s.dataUrl === 'string'
      && s.dataUrl.startsWith('data:image/'))
    .slice(0, 10)
    .map(s => ({
      id: String(s.id || uid()),
      name: String(s.name || 'capture').slice(0, 80),
      dataUrl: s.dataUrl.slice(0, 2_500_000),
      w: Number(s.w) > 0 ? Math.min(Number(s.w), 4000) : 0,
      h: Number(s.h) > 0 ? Math.min(Number(s.h), 4000) : 0
    }));
  for (const k of ['shots5', 'shots6', 'shots7']) L[k] = normShots(L[k]);
  // 5.1 : lignes du tableau Excel (aperçu {cat,desc,…}) — fusionne les anciennes
  // cartes FAI (operator/offer/…) pour ne rien perdre à la migration.
  L.fais = Array.isArray(L.fais) ? L.fais.filter(r => r && typeof r === 'object').map(r => {
    const o = {};
    o.cat = String(r.cat ?? 'FAI').slice(0, 20) || 'FAI';
    o.desc = String(r.desc ?? '').slice(0, 120)
      || (r.operator ? `${r.operator}${r.offer ? ' — ' + r.offer : ''}` : '');
    for (const k of ['down', 'lanIp', 'lanMask', 'lanGw', 'lanDns', 'ipv6', 'dhcp',
                     'pf', 'pfPortWan', 'pfPortLan', 'pfClient', 'pfProto',
                     'dmz', 'firewall', 'wlanStat', 'wlan', 'notes']) {
      o[k] = String(r[k] ?? '').slice(0, 200);
    }
    for (const k of ['id', 'operator', 'offer', 'linkType', 'up', 'publicBlock',
                     'cpe', 'cpeIp', 'wanLabel', 'ipMode', 'wanIp', 'wanMask',
                     'wanGw', 'wanDns']) {
      if (r[k] !== undefined && r[k] !== null) o[k] = typeof r[k] === 'string' ? r[k].slice(0, 160) : r[k];
    }
    if (!o.operator && o.desc) {
      const parts = String(o.desc).split(' — ');
      o.operator = parts[0].slice(0, 60);
      o.offer = (parts[1] || '').slice(0, 60);
    }
    return o;
  }) : [];
  // 5.2 câblage FAI
  L.faiCab = Array.isArray(L.faiCab) ? L.faiCab.filter(r => r && typeof r === 'object').map(r => ({
    cat: String(r.cat ?? 'FAI').slice(0, 20) || 'FAI',
    desc: String(r.desc ?? '').slice(0, 120),
    conn: String(r.conn ?? '').slice(0, 160)
  })) : [];
  // 6.1 extrémités / HA (miroir Excel) — migration depuis les champs interco
  if (!Array.isArray(L.ic61) || !L.ic61.some(r => r && Object.values(r).some(v => String(v ?? '').trim()))) {
    const ic = L.interco || {};
    const mk = (side) => {
      const ep = side === 'A' ? ic.epA : ic.epB;
      const sn = side === 'A' ? ic.snA : ic.snB;
      const fw = side === 'A' ? ic.fwA : ic.fwB;
      const ha = side === 'A' ? ic.haA : ic.haB;
      const role = side === 'A' ? ic.roleA : ic.roleB;
      const vip = side === 'A' ? ic.vipA : ic.vipB;
      const mgmt = side === 'A' ? ic.mgmtA : ic.mgmtB;
      const mask = side === 'A' ? ic.mgmtMaskA : ic.mgmtMaskB;
      if (!ep && !sn && !mgmt) return null;
      const short = String(ep || '').split(' — ')[0];
      return {
        equip: String(ep || '').slice(0, 120),
        nomen: '', sn: String(sn || '').slice(0, 60),
        fw: String(fw || '').slice(0, 40),
        ip: '', mask: '', gw: '', dns: '',
        haEn: ha ? 'Oui' : '', haGroup: String(ha || '').slice(0, 40),
        haRole: String(role || '').slice(0, 30),
        haMaster: /master/i.test(String(role || '')) ? 'Oui' : '',
        vip: String(vip || '').slice(0, 45),
        mgmt: String(mgmt || '').slice(0, 45),
        mgmtMask: String(mask || '').slice(0, 45),
        note: ''
      };
    };
    const seedIc = [mk('A'), mk('B')].filter(Boolean);
    L.ic61 = (Array.isArray(L.ic61) ? L.ic61 : [])
      .filter(r => r && typeof r === 'object')
      .map(r => Object.assign({}, r));
    if (!L.ic61.length && seedIc.length) L.ic61 = seedIc;
  } else {
    L.ic61 = L.ic61.filter(r => r && typeof r === 'object').map(r => {
      const o = {};
      for (const [k, max] of [['equip', 120], ['nomen', 100], ['sn', 60], ['fw', 40],
        ['ip', 45], ['mask', 45], ['gw', 45], ['dns', 60],
        ['haEn', 10], ['haGroup', 40], ['haRole', 30], ['haMaster', 10],
        ['vip', 45], ['mgmt', 45], ['mgmtMask', 45], ['note', 200]]) {
        o[k] = String(r[k] ?? '').slice(0, max);
      }
      return o;
    });
  }
  // 6.2 câblage interconnexion
  L.icCab = Array.isArray(L.icCab) ? L.icCab.filter(r => r && typeof r === 'object').map(r => ({
    cat: String(r.cat ?? 'Interconnexion S2S').slice(0, 30) || 'Interconnexion S2S',
    desc: String(r.desc ?? '').slice(0, 120),
    port: String(r.port ?? '').slice(0, 40),
    conn: String(r.conn ?? '').slice(0, 160)
  })) : [];
  // 6.1 WAN / LAN (sections Excel) — migration depuis FAI + interco si vides
  const icSan = (arr, keys) => (Array.isArray(arr) ? arr : [])
    .filter(r => r && typeof r === 'object')
    .map(r => {
      const o = {};
      for (const [k, max] of keys) o[k] = String(r[k] ?? '').slice(0, max);
      return o;
    });
  if (!L.icWan || !L.icWan.some(r => Object.values(r).some(v => String(v ?? '').trim()))) {
    const faiRows = (L.fais || []).filter(f => f && (f.operator || f.wanIp || f.ipMode || f.wanLabel));
    const seed = faiRows.slice(0, 3).map((f, i) => ({
      name: `WAN ${i + 1}${f.operator ? ' — ' + f.operator : ''}`,
      enable: 'Oui',
      connMethod: String(f.ipMode || '').slice(0, 30),
      routingMode: 'NAT',
      ip: String(f.wanIp || '').slice(0, 45),
      mask: String(f.wanMask || '').slice(0, 45),
      gw: String(f.wanGw || '').slice(0, 45),
      dns: String(f.wanDns || '').slice(0, 60),
      priority: '',
      up: String(f.up || '').slice(0, 40),
      down: String(f.down || '').slice(0, 40),
      portSpeed: '', mtu: '', mss: '', macClone: '', vlan: '',
      hcMethod: '', hcDns: '', hcTimeout: '', hcInterval: '',
      hcRetries: '', hcRecovery: '',
      provider: String(f.operator || '').slice(0, 60),
      dynDns: '', ipv6: '', doh: '', qos: ''
    })).filter(r => Object.values(r).some(v => String(v ?? '').trim()));
    L.icWan = (Array.isArray(L.icWan) ? L.icWan : []).slice();
    if (!L.icWan.length && seed.length) L.icWan = seed;
  }
  L.icWan = icSan(Array.isArray(L.icWan) ? L.icWan : [], LLD_IC_WAN_COLS.map(c => [c[0],
    c[0] === 'name' ? 140 : c[0] === 'provider' ? 60 : 45]));
  if (!L.icLan || !L.icLan.some(r => Object.values(r).some(v => String(v ?? '').trim()))) {
    const ic = L.interco || {};
    const nv = (L.vlans || []).length;
    const seed = [];
    if (ic.localSubnets || ic.routing || nv) {
      seed.push({
        lan: String(ic.localSubnets ? `LAN — ${ic.localSubnets}` : 'LAN').slice(0, 120),
        routing: String(ic.routing || '').slice(0, 120),
        network: String(nv ? `x${nv} VLANs routés` : '').slice(0, 120)
      });
    }
    if (ic.remoteSubnets) {
      seed.push({
        lan: 'LAN — distant',
        routing: '',
        network: String(ic.remoteSubnets).slice(0, 120)
      });
    }
    L.icLan = (Array.isArray(L.icLan) ? L.icLan : []).slice();
    if (!L.icLan.length && seed.length) L.icLan = seed;
  }
  L.icLan = icSan(Array.isArray(L.icLan) ? L.icLan : [], [['lan', 120], ['routing', 120], ['network', 120]]);
  if (!L.diagrams || typeof L.diagrams !== 'object' || Array.isArray(L.diagrams)) L.diagrams = {};
  else {
    const cleanD = {};
    for (const [k, v] of Object.entries(L.diagrams)) {
      if (v && typeof v === 'object' && Array.isArray(v.nodes) && Array.isArray(v.links)
          && ['fai', 'interco', 'fw'].includes(k)) {
        cleanD[k] = {
          nodes: v.nodes.slice(0, 40).map(n => ({
            id: String(n.id || uid()).slice(0, 24),
            x: Number(n.x) || 0, y: Number(n.y) || 0,
            w: Number(n.w) || 150, h: Number(n.h) || 56,
            label: String(n.label || '').slice(0, 48),
            sub: String(n.sub || '').slice(0, 56),
            kind: String(n.kind || 'dev').slice(0, 16)
          })),
          links: v.links.slice(0, 60).map(l => ({
            a: String(l.a || '').slice(0, 24), b: String(l.b || '').slice(0, 24),
            label: String(l.label || '').slice(0, 48),
            color: String(l.color || '#60a5fa').slice(0, 20),
            dashed: !!l.dashed
          }))
        };
      }
    }
    L.diagrams = cleanD;
  }
  // Surcharges libres de la matrice ch. 4 (« C19 » → texte exporté dans l'Excel)
  if (!L.ch4ov || typeof L.ch4ov !== 'object' || Array.isArray(L.ch4ov)) L.ch4ov = {};
  else {
    const clean = {};
    for (const [k, v] of Object.entries(L.ch4ov)) {
      if (/^[C-H]\d{1,3}$/.test(k) && typeof v === 'string') clean[k] = v.slice(0, 80);
    }
    L.ch4ov = clean;
  }
  // Notes de configuration par chapitre (ch. 7 à 13)
  if (!L.catNotes || typeof L.catNotes !== 'object') L.catNotes = {};
  for (const k of ['firewall', 'switching', 'server', 'storage', 'ids', 'cctv', 'pointage']) {
    if (typeof L.catNotes[k] !== 'string') L.catNotes[k] = '';
    L.catNotes[k] = L.catNotes[k].slice(0, 2000);
  }
  // Zones de Switching (sous-chapitres 8.1, 8.2…) — par défaut : structure cible
  L.swZones = Array.isArray(L.swZones) ? L.swZones.filter(z => z && typeof z === 'object').map(z => {
    const o = {
      id: String(z.id || uid()),
      name: String(z.name ?? '').slice(0, 40).trim() || 'Zone',
      vlans: String(z.vlans ?? '').slice(0, 100)
    };
    for (const k of Object.keys(z)) {
      if (!(k in o) && typeof z[k] === 'string') o[k] = z[k].slice(0, 120);
    }
    return o;
  }) : [
    { id: uid(), name: 'INFRA' },
    { id: uid(), name: 'LAN Site B' },
    { id: uid(), name: 'Aruba AP Site A' },
    { id: uid(), name: 'Aruba AP Site B' },
    { id: uid(), name: 'LAN Site A' }
  ];
  // Libellés des blocs libres (chapitres ajoutés au sommaire)
  if (!L.customMeta || typeof L.customMeta !== 'object' || Array.isArray(L.customMeta)) {
    L.customMeta = {};
  } else {
    const meta = {};
    Object.entries(L.customMeta).forEach(([k, v]) => {
      if (!lldIsCustomKey(k) || !v || typeof v !== 'object') return;
      const lab = String(v.label || '').trim().slice(0, 80);
      if (lab) meta[k] = { label: lab };
    });
    L.customMeta = meta;
  }
  // Données des blocs libres (paragraphe / tableau / captures)
  const normCustomShots = arr => (Array.isArray(arr) ? arr : [])
    .filter(s => s && typeof s === 'object' && typeof s.dataUrl === 'string'
      && s.dataUrl.startsWith('data:image/'))
    .slice(0, 10)
    .map(s => ({
      id: String(s.id || uid()),
      name: String(s.name || 'capture').slice(0, 80),
      dataUrl: s.dataUrl.slice(0, 2_500_000),
      w: Number(s.w) > 0 ? Math.min(Number(s.w), 4000) : 0,
      h: Number(s.h) > 0 ? Math.min(Number(s.h), 4000) : 0
    }));
  Object.keys(L).forEach(k => {
    if (!lldIsCustomKey(k)) return;
    if (k.startsWith('cpara:')) {
      L[k] = typeof L[k] === 'string' ? L[k].slice(0, 8000) : '';
    } else if (k.startsWith('ctable:')) {
      L[k] = Array.isArray(L[k])
        ? L[k].filter(r => r && typeof r === 'object').slice(0, 200).map(r => {
            const o = {};
            Object.keys(r).forEach(ck => {
              if (typeof r[ck] === 'string') o[ck] = r[ck].slice(0, 400);
            });
            return o;
          })
        : [];
    } else if (k.startsWith('cshots:')) {
      L[k] = normCustomShots(L[k]);
    }
  });
  // Colonnes personnalisées des tableaux (ajouts/suppressions dans la modale)
  if (L.gridCols && typeof L.gridCols === 'object' && !Array.isArray(L.gridCols)) {
    const out = {};
    Object.entries(L.gridCols).forEach(([id, cols]) => {
      if (typeof id !== 'string' || id.length > 48 || !Array.isArray(cols)) return;
      const clean = cols.map(c => {
        const a = Array.isArray(c) ? c : null;
        if (!a || typeof a[0] !== 'string' || !a[0] || typeof a[1] !== 'string') return null;
        const k = a[0].slice(0, 40), label = a[1].slice(0, 60);
        const w = typeof a[2] === 'number' && a[2] > 0 ? a[2] : null;
        return (a[3] && typeof a[3] === 'object') ? [k, label, w, a[3]] : [k, label, w];
      }).filter(Boolean);
      if (clean.length) out[id] = clean;
    });
    L.gridCols = out;
  } else if (L.gridCols !== undefined && (L.gridCols === null || typeof L.gridCols !== 'object')) {
    delete L.gridCols;
  }
  // Sommaire du dossier (chapitres + sous-chapitres + contenus attachés)
  L.toc = normLldToc(L.toc);
  return L;
}

// Hauteur d'un rack à l'écran (en-tête + rembourrages + U)
function rackHeight(rack) {
  return 28 + 16 + (rack.sizeU || DEFAULT_RACK_U) * U_H;
}

// Formatage de puissance (350 W / 1,4 kW)
function fmtWatts(w) {
  return w >= 1000
    ? (Math.round(w / 100) / 10).toLocaleString('fr-FR') + ' kW'
    : Math.round(w) + ' W';
}

// ---------- Catégories de devices ----------
// Chaque device (modèle de la bibliothèque ET exemplaire posé) porte une
// catégorie métier : elle structure le dossier LLD (ch. 3.1 Équipements et
// futurs chapitres 7 à 13) et permet de filtrer la bibliothèque.
const DEV_CATEGORIES = [
  ['router',   '\ud83c\udf10', 'Routeur / FAI'],
  ['firewall', '\ud83d\udee1\ufe0f', 'Firewall'],
  ['switch',   '\ud83d\udd00', 'Switch'],
  ['ap',       '\ud83d\udcf6', 'Borne WiFi (AP)'],
  ['server',   '\ud83d\udda5\ufe0f', 'Serveur'],
  ['storage',  '\ud83d\udcbe', 'Stockage'],
  ['ids',      '\ud83d\udea8', 'Intrusion (IDS/IPS)'],
  ['cctv',     '\ud83d\udcf9', 'CCTV'],
  ['pointage', '\u23f1\ufe0f', 'Pointage (SPO)'],
  ['ups',      '\ud83d\udd0b', 'Onduleur / PDU'],
  ['patch',    '\ud83d\udd0c', 'Brassage (panneau)'],
  ['other',    '\ud83d\udce6', 'Autre']
];
const DEV_CAT_MAP = Object.fromEntries(DEV_CATEGORIES.map(([id, ico, lbl]) => [id, { ico, lbl }]));

function normCat(cat) {
  return (typeof cat === 'string' && DEV_CAT_MAP[cat]) ? cat : 'other';
}
function catLabel(cat) { return DEV_CAT_MAP[cat]?.lbl || 'Autre'; }
function catIcon(cat)  { return DEV_CAT_MAP[cat]?.ico || '\ud83d\udce6'; }

// Catégorie devinée depuis le préfixe du nom (ex : « FW-01 » -> firewall)
const CAT_BY_PREFIX = {
  FW: 'firewall', FWS: 'firewall', ASA: 'firewall', FGT: 'firewall', VPN: 'firewall',
  RTR: 'router', RT: 'router', GW: 'router', CPE: 'router', ISP: 'router',
  SW: 'switch',
  AP: 'ap', WAP: 'ap',
  SRV: 'server', ESX: 'server', HV: 'server',
  NAS: 'storage', SAN: 'storage', STO: 'storage',
  IDS: 'ids', IPS: 'ids',
  CAM: 'cctv', NVR: 'cctv', DVR: 'cctv', CCTV: 'cctv',
  SPO: 'pointage', PTG: 'pointage', PTA: 'pointage',
  UPS: 'ups', PDU: 'ups',
  ODF: 'patch', IDF: 'patch'
};
function guessCatFromName(name) {
  const m = String(name || '').match(/^([A-Za-z]{2,4})-/);
  if (!m) return null;
  return CAT_BY_PREFIX[m[1].toUpperCase()] || null;
}

// Normalise la catégorie d'un device/instance (rétro-compatibilité :
// les anciens objets reçoivent une catégorie devinée, sinon « Autre »)
function normCatField(d) {
  if (typeof d.cat === 'string' && DEV_CAT_MAP[d.cat]) return;
  d.cat = guessCatFromName(d.name)
       || (/watchguard|firebox/i.test(String(d.name || '')) ? 'firewall' : 'other');
}

// ---------- Domaines de câblage ----------
// Un câble peut être rattaché à un domaine (chapitre du dossier LLD) :
// les tableaux de câblage des chapitres 5.2 / 6.2 (et suivants) s'en servent.
const CABLE_DOMAINS = [
  ['', 'Général'],
  ['fai', 'FAI'],
  ['interco', 'Interconnexion 2 sites'],
  ['firewall', 'Firewall'],
  ['switching', 'Switching'],
  ['server', 'Serveurs'],
  ['storage', 'Stockage'],
  ['ids', 'IDS'],
  ['cctv', 'CCTV'],
  ['pointage', 'Pointage']
];
const CABLE_DOMAIN_MAP = Object.fromEntries(CABLE_DOMAINS);
function cableDomainLabel(dom) {
  return (typeof dom === 'string' && CABLE_DOMAIN_MAP[dom]) || 'Général';
}

/* ---------- Garantie des devices ----------
   Chaque device (modèle de la bibliothèque ET exemplaire posé) peut porter
   une date de fin de garantie (stockée à l'ISO « AAAA-MM-JJ ») et un libellé
   de contrat (ex. « Constructeur 3 ans — NBD »). Le statut est recalculé à
   chaque affichage, en DEUX couleurs :
     • vert  = en garantie   (date de fin à venir)
     • rouge = hors de garantie (date de fin dépassée)
   Un équipement dont la garantie arrive à échéance sous WARRANTY_SOON_DAYS
   jours reste vert (il est encore garanti) mais porte la mention « expire
   bientôt » dans les textes et les exports, pour anticiper le renouvellement. */
const WARRANTY_SOON_DAYS = 90;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// « AAAA-MM-JJ » -> Date locale (ou null si vide / invalide)
function isoToDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
}
function fmtDateFr(iso) {
  const d = isoToDate(iso);
  return d ? d.toLocaleDateString('fr-FR') : '';
}
// Nombre de jours restants (négatif si la garantie est expirée)
function daysUntil(iso) {
  const d = isoToDate(iso);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
// { status: 'in' (en garantie, vert) | 'out' (hors garantie, rouge) | 'none',
//   days, label, soon }
function warrantyInfo(d) {
  const iso = d?.warrantyEnd || '';
  const days = daysUntil(iso);
  if (days === null) return { status: 'none', days: null, label: '—', soon: false };
  const out = days < 0;
  return {
    status: out ? 'out' : 'in',
    days,
    label: fmtDateFr(iso),
    soon: !out && days <= WARRANTY_SOON_DAYS
  };
}
// Libellés des deux états (+ état neutre quand la date n'est pas saisie)
const WARRANTY_STATUS = {
  in:   { ico: '\u2705', lbl: 'En garantie' },
  out:  { ico: '\u26d4', lbl: 'Hors garantie' },
  none: { ico: '\u2014',  lbl: 'Garantie non renseignée' }
};
function warrantyStatusLabel(status) {
  return WARRANTY_STATUS[status]?.lbl || WARRANTY_STATUS.none.lbl;
}
// Statut pour les tableaux : vide quand la garantie n'est pas renseignée
function warrantyShortStatus(status) {
  return (status === 'in' || status === 'out') ? WARRANTY_STATUS[status].lbl : '';
}
// Échéance compacte : « -3 j », « 45 j », « aujourd'hui »
function warrantyDaysText(w) {
  if (w.status === 'none') return '';
  return w.days === 0 ? 'aujourd\u2019hui' : `${w.days} j`;
}
// « expirée depuis 42 j » / « dans 34 j (expire bientôt) » / « dans 320 j »
function warrantyRelText(w) {
  if (w.status === 'none') return '';
  if (w.days === 0) return 'dernier jour';
  if (w.days < 0) return `expir\u00e9e depuis ${-w.days} j`;
  return `dans ${w.days} j` + (w.soon ? ' (expire bient\u00f4t)' : '');
}
// « 12/03/2027 · dans 210 j » / « 12/03/2026 · expirée depuis 34 j »
function warrantyWhenText(d) {
  const w = warrantyInfo(d);
  if (w.status === 'none') return '—';
  return `${w.label} \u00b7 ${warrantyRelText(w)}`;
}
// Infobulle du badge (pastille du board, fiche de survol, modale device)
function warrantyBadgeTitle(d) {
  const w = warrantyInfo(d);
  if (w.status === 'none') return 'Garantie non renseignée \u2014 double-cliquez sur \u00ab\u00a0Fin de garantie\u00a0\u00bb';
  const contract = d?.warranty ? ` \u00b7 ${d.warranty}` : '';
  return `${warrantyStatusLabel(w.status)} : fin le ${w.label} (${warrantyRelText(w)})${contract}`;
}

// Champs d'inventaire d'un device (présents sur le modèle ET sur chaque exemplaire)
const DEV_TEXT_FIELDS = ['brand', 'model', 'partRef', 'serial', 'ipMgmt', 'vlan', 'warranty'];
function normInvFields(d) {
  for (const k of DEV_TEXT_FIELDS) if (typeof d[k] !== 'string') d[k] = '';
  // Fin de garantie : date ISO, vidée si absente ou invalide
  if (!isoToDate(d.warrantyEnd)) d.warrantyEnd = '';
  d.watts = Number.isFinite(d.watts) ? d.watts : 0;
  d.weightKg = Number.isFinite(d.weightKg) ? d.weightKg : 0;
  normCatField(d);
  return d;
}

// Normalisation d'un rack chargé (rétro-compatibilité)
function normalizeRack(r) {
  r.sizeU = r.sizeU || DEFAULT_RACK_U;
  if (!r.name) r.name = `Rack ${r.sizeU}U`;
  if (typeof r.siteId !== 'string') r.siteId = '';   // rattachement à un site
  r.instances = Array.isArray(r.instances) ? r.instances : [];
  r.instances.forEach(i => {
    if (typeof i.zone !== 'string') i.zone = '';   // zone de switching (ch. 8)
    i.ports = Array.isArray(i.ports) ? i.ports : [];
    i.ports.forEach(p => {
      if (typeof p.size !== 'number') p.size = 1;
      if (typeof p.ip !== 'string') p.ip = '';
      if (typeof p.vlan !== 'string') p.vlan = '';
    });
    normInvFields(i);
  });
  r.maxWatts = Number.isFinite(r.maxWatts) ? r.maxWatts : 0;
  r.maxKg = Number.isFinite(r.maxKg) ? r.maxKg : 0;
  return r;
}

// ---------- Helpers ----------
const $  = (sel, root = document) => root.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Sites ----------
// Couleurs d'identification (badge / pastille), attribuées par position
const SITE_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#f87171', '#22d3ee', '#a3e635', '#f472b6'];

function defaultSites() {
  return [
    { id: uid(), name: 'Site A', address: '', contact: '', desc: '' },
    { id: uid(), name: 'Site B', address: '', contact: '', desc: '' }
  ];
}

// Normalise la liste des sites d'un workspace (rétro-compatibilité :
// un workspace sans sites obtient Site A + Site B par défaut)
function normSites(w) {
  const arr = Array.isArray(w.sites) ? w.sites : null;
  w.sites = (arr ?? defaultSites()).filter(s => s && typeof s === 'object').map(s => {
    const o = {
      id: String(s.id || uid()),
      name: String(s.name ?? '').slice(0, 40).trim() || 'Site',
      type: String(s.type ?? '').slice(0, 40),
      country: String(s.country ?? '').slice(0, 40),
      users: String(s.users ?? '').slice(0, 20),
      address: String(s.address ?? '').slice(0, 80),
      contact: String(s.contact ?? '').slice(0, 80),
      desc: String(s.desc ?? '').slice(0, 200)
    };
    for (const k of Object.keys(s)) {   // colonnes ajoutées dans la modale 📘
      if (!(k in o) && typeof s[k] === 'string') o[k] = s[k].slice(0, 120);
    }
    return o;
  });
  return w.sites;
}

function siteById(ws, id) {
  return (ws?.sites || []).find(s => s.id === id) || null;
}
function siteName(ws, rack) {
  const s = siteById(ws, rack?.siteId);
  return s ? s.name : '';
}
function siteColor(ws, rack) {
  const sites = ws?.sites || [];
  const idx = sites.findIndex(s => s.id === rack?.siteId);
  return idx >= 0 ? SITE_COLORS[idx % SITE_COLORS.length] : null;
}

// ---------- État ----------
// Structure :
//   state.devices           -> bibliothèque PARTAGÉE entre workspaces
//   state.workspaces[]      -> un board par workspace (racks, instances, ports, vue)
//   state.activeWorkspaceId -> workspace courant
let state = emptyState();
let labelMode = null;          // null | 'create' | 'edit'
let boardMode = 'elev';        // 'elev' (élévations) | 'topo' (topologie logique)
let topoLinkPending = null;    // noeud de départ pendant la création d'un lien
let dragPayload = null;
let popoverCtx = null;
let suppressPortClick = false;   // true juste après un glisser-déposer de port
let siteFilter = 'all';          // id du site filtré sur le board, 'all' = tous
let palCatFilter = 'all';        // filtre de la bibliothèque par catégorie
let topoFlowFilter = '';        // id du flux mis en évidence dans la vue Topologie

// Vue du board (décalage + échelle) — mémorisée par workspace
const view = { x: 80, y: 50, scale: 1 };

function makeWorkspace(name, racks = []) {
  return { id: uid(), name, racks, cables: [], sites: defaultSites(), view: null, viewTouched: false, updatedAt: Date.now() };
}

function emptyState() {
  return { devices: [], workspaces: [], activeWorkspaceId: null, demoDismissed: false };
}

// Normalise un état chargé (localStorage ou serveur) : structure,
// migration des anciennes versions et valeurs par défaut.
function normalizeState(s) {
  if (!s || !Array.isArray(s.devices)) {
    return emptyState();
  }

  // Migration d'une ancienne version (racks au niveau global)
  if (!Array.isArray(s.workspaces)) {
    const legacy = (Array.isArray(s.racks) ? s.racks : []).map(normalizeRack);
    if (legacy.length || s.devices.length) {
      const ws = makeWorkspace('Workspace 1', legacy);
      s.workspaces = [ws];
      s.activeWorkspaceId = ws.id;
    } else {
      s.workspaces = [];
      s.activeWorkspaceId = null;
    }
  }
  // Ports pré-détectés sur les modèles de device (détection automatique)
  s.devices.forEach(d => {
    d.ports = Array.isArray(d.ports) ? d.ports : [];
    d.ports.forEach(p => {
      if (typeof p.size !== 'number') p.size = 1;
      if (typeof p.ip !== 'string') p.ip = '';
      if (typeof p.vlan !== 'string') p.vlan = '';
    });
    normInvFields(d);
  });
  // Normalisation rétro-compatible + date de modification
  s.workspaces.forEach(w => {
    w.racks = (Array.isArray(w.racks) ? w.racks : []).map(normalizeRack);
    if (!Array.isArray(w.cables)) w.cables = [];
    w.cables.forEach(c => {
      if (typeof c.domain !== 'string') c.domain = '';
      // Décalage du point de contrôle manipulable du câble (coordonnées board).
      c.bendX = Number.isFinite(c.bendX) ? c.bendX : 0;
      c.bendY = Number.isFinite(c.bendY) ? c.bendY : 0;
    });
    // Matrice des flux réseau (ch. 14)
    if (!Array.isArray(w.flows)) w.flows = [];
    w.flows = w.flows.filter(f => f && typeof f === 'object').map(f => {
      const o = {
        id: String(f.id || uid()),
        name: String(f.name ?? '').slice(0, 60),
        src: String(f.src ?? '').slice(0, 80),
        dst: String(f.dst ?? '').slice(0, 80),
        proto: String(f.proto ?? '').slice(0, 60),
        sens: f.sens === 'uni' ? 'uni' : 'bi',
        usage: String(f.usage ?? '').slice(0, 120)
      };
      for (const k of Object.keys(f)) {   // colonnes ajoutées dans la modale 📘
        if (!(k in o) && typeof f[k] === 'string') o[k] = f[k].slice(0, 120);
      }
      return o;
    });
    // Sites du workspace + nettoyage des racks pointant vers un site disparu
    normSites(w);
    const siteIds = new Set(w.sites.map(x => x.id));
    w.racks.forEach(r => { if (r.siteId && !siteIds.has(r.siteId)) r.siteId = ''; });
    if (typeof w.updatedAt !== 'number') w.updatedAt = 0;
    w.bundled = !!w.bundled;      // workspace issu de la démo embarquée
    w.demoVer = Number(w.demoVer) || 0;   // version de la démo embarquée
    // Vue topologique (diagramme logique) : structure + nettoyage
    if (!w.topology || !Array.isArray(w.topology.nodes) || !Array.isArray(w.topology.links))
      w.topology = { nodes: [], links: [] };
    pruneTopology(w);
    normLldInfo(w);
    // Dernière caméra de la vue 3D (position + cible) — conservée si valide
    w.view3d = (w.view3d && Array.isArray(w.view3d.p) && w.view3d.p.length === 3 &&
                Array.isArray(w.view3d.t) && w.view3d.t.length === 3 &&
                w.view3d.p.every(Number.isFinite) && w.view3d.t.every(Number.isFinite))
      ? { p: w.view3d.p.map(Number), t: w.view3d.t.map(Number) }
      : null;
    // Zones de switching : détacher les devices pointant vers une zone disparue
    const zoneIds = new Set((w.lld.swZones || []).map(z => z.id));
    w.racks.forEach(r => r.instances.forEach(i => {
      if (i.zone && !zoneIds.has(i.zone)) i.zone = '';
    }));
    // Les anciennes vues par défaut ne sont pas considérées comme personnalisées :
    // l'application recadrera automatiquement sur le contenu à la première ouverture.
    w.viewTouched = !!w.viewTouched;
  });
  if (s.activeWorkspaceId && !s.workspaces.some(w => w.id === s.activeWorkspaceId)) {
    s.activeWorkspaceId = s.workspaces[0]?.id ?? null;
  }
  // La démo embarquée a-t-elle été supprimée volontairement ? Tant que oui,
  // elle n'est pas rechargée automatiquement (le bouton de l'accueil reste là).
  s.demoDismissed = !!s.demoDismissed && s.workspaces.length === 0;
  return s;
}

// État de secours stocké dans le navigateur (utilisé hors-ligne / sans serveur)
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) { /* état illisible : on repart à vide */ }
  return emptyState();
}

/* ============================================================
   PERSISTANCE — sauvegarde côté serveur (fichier JSON)
   ------------------------------------------------------------
   L'état est envoyé au serveur (data/state.json) à chaque
   modification, ce qui rend les workspaces indépendants du
   navigateur. localStorage reste utilisé comme copie locale de
   secours si le serveur n'est pas joignable.
   ============================================================ */
const SERVER_API = '/api/state';
let serverAvailable = null;     // null = inconnu, true/false après test
let serverPushTimer = null;
let serverPushPending = false;  // une écriture est-elle en cours ?
let serverPushQueued = false;   // une autre écriture est-elle à relancer ?

function hasContent(s) {
  return !!s && (s.workspaces?.length > 0 || s.devices?.length > 0);
}

function setSaveStatus(mode) {
  const el = $('#save-status');
  if (!el) return;
  const map = {
    cloud:  { t: '☁️', c: 'Enregistré sur le serveur',      cls: 'ss-cloud' },
    local:  { t: '💾', c: 'Enregistré dans ce navigateur',  cls: 'ss-local' },
    saving: { t: '⏳', c: 'Enregistrement…',                 cls: 'ss-saving' }
  };
  const m = map[mode] || map.cloud;
  el.textContent = m.t;
  el.title = m.c;
  el.classList.toggle('ss-local', mode === 'local');
  el.classList.toggle('ss-saving', mode === 'saving');
}

// Charge l'état au démarrage : serveur d'abord, sinon navigateur.
async function bootState() {
  let serverState = null;
  try {
    const res = await fetch(SERVER_API, { cache: 'no-store' });
    if (res.ok) serverState = await res.json();
    serverAvailable = res.ok;
  } catch (e) {
    serverAvailable = false;   // fichier ouvert sans le serveur (file://, etc.)
  }

  const srv = normalizeState(serverState);
  if (serverAvailable && hasContent(srv)) {
    state = srv;
    setSaveStatus('cloud');
  } else if (serverAvailable && !hasContent(srv)) {
    // Serveur vide : on y pousse une éventuelle sauvegarde locale existante
    const local = loadLocalState();
    state = hasContent(local) ? local : srv;
    setSaveStatus('cloud');
    if (hasContent(local)) scheduleServerSave(true);
  } else {
    const local = loadLocalState();
    if (local.workspaces.length) {
      state = local;                        // l'utilisateur a ses propres workspaces
    } else {
      // Hébergement statique (GitHub Pages…) : aucun workspace en local.
      // On charge alors la démo embarquée (demo/demo-state.json, générée par
      // demo_datacenter.py) au lieu d'afficher un écran vide — c'est le cas
      // d'un premier démarrage, mais aussi d'une sauvegarde locale ne
      // contenant que le device permanent : sans cela, la démo ne
      // réapparaissait plus jamais. Les devices locaux sont conservés, et si
      // l'utilisateur a volontairement supprimé la démo, on la laisse
      // supprimée (bouton « 🎬 Charger la démo » pour la récupérer).
      const demo = local.demoDismissed ? emptyState() : await loadBundledDemoState();
      state = demo.workspaces.length ? mergeDemoInto(local, demo) : local;
      if (hasContent(state)) saveState();   // miroir local : les modif. persisteront
    }
    setSaveStatus('local');
  }
  // Une démo embarquée plus récente que la copie locale ? On l'actualise.
  refreshDemoIfStale().then(ok => {
    if (!ok) return;
    renderPalette();
    renderBoard();
    applyWorkspaceView();
    renderHomeListSafe();
    showHome();
  });
}

// La démo embarquée a évolué (demoVer > version du workspace démo local) :
// on remplace silencieusement le workspace démo par la nouvelle version et
// on sauvegarde — sinon un navigateur (ou data/state.json) garde indéfiniment
// une ancienne démo. Ne touche JAMAIS aux workspaces de l'utilisateur.
async function refreshDemoIfStale() {
  try {
    const demo = await loadBundledDemoState();
    const dws = demo.workspaces[0];
    if (!dws) return false;
    const i = state.workspaces.findIndex(w => w.id === dws.id);
    if (i === -1) return false;                            // démo absente : RAS
    if (state.workspaces[i].demoVer === dws.demoVer) return false;   // à jour
    state.workspaces[i] = dws;
    if (state.activeWorkspaceId === dws.id) state.activeWorkspaceId = dws.id;
    saveState();
    return true;
  } catch (e) { return false; }
}

// État « démo seule » versionné dans le dépôt : utilisé quand l'application
// est servie en statique (GitHub Pages) et qu'aucun workspace n'est disponible.
// En file:// le fetch est bloqué : retourne un état vide.
// Les workspaces chargés sont marqués « bundled » (démo embarquée) pour
// pouvoir : les reconnaître au moment de la suppression, et éviter d'afficher
// « Jamais modifié » / 01 janv. 1970 dans l'historique.
async function loadBundledDemoState() {
  try {
    const res = await fetch('demo/demo-state.json', { cache: 'no-store' });
    if (!res.ok) return emptyState();
    const demo = normalizeState(await res.json());
    demo.workspaces.forEach(w => {
      w.bundled = true;
      w.demoVer = Number(demo.demoVer) || 1;   // version du fichier embarqué
      // Horodatage manquant ou aberrant (ancienne valeur 20260908 lue comme
      // des millisecondes) : on prend la date du jour pour l'historique.
      if (!w.updatedAt || w.updatedAt < 946684800000) w.updatedAt = Date.now();
    });
    return hasContent(demo) ? demo : emptyState();
  } catch (e) {
    return emptyState();
  }
}

// Fusionne la démo embarquée dans un état local SANS workspace : les devices
// de l'utilisateur (bibliothèque) sont conservés, et les modèles de la démo
// absents de sa bibliothèque y sont ajoutés.
function mergeDemoInto(local, demo) {
  const merged = normalizeState(local);
  const wantedActive = merged.activeWorkspaceId;   // conservé s'il existe encore
  const known = new Set(merged.devices.map(d => d.id));
  for (const d of demo.devices) {
    if (!known.has(d.id)) { merged.devices.push(d); known.add(d.id); }
  }
  for (const w of demo.workspaces) {
    if (!merged.workspaces.some(x => x.id === w.id)) merged.workspaces.push(w);
  }
  // Workspace courant : celui de l'utilisateur s'il existe encore, sinon
  // celui de la démo (le board est ainsi prêt derrière l'écran d'accueil).
  const hasActive = merged.workspaces.some(w => w.id === wantedActive);
  if (!hasActive) {
    merged.activeWorkspaceId = demo.activeWorkspaceId
      || merged.workspaces[0]?.id || null;
  }
  merged.demoDismissed = false;
  return merged;
}

// Bouton « 🎬 Charger la démo » de l'écran d'accueil : (re)charge la démo
// embarquée à tout moment, sans jamais écraser les workspaces existants.
// Si la démo est déjà présente, elle est simplement ouverte.
async function loadDemoWorkspace() {
  const demo = await loadBundledDemoState();
  if (!demo.workspaces.length) {
    lldAlert('La démo n’est pas disponible : le fichier demo/demo-state.json est introuvable.\n' +
          '(Sur un hébergement statique, vérifiez que le dossier demo/ est bien publié.)');
    return;
  }
  const wsId = demo.workspaces[0].id;
  const already = state.workspaces.find(w => w.id === wsId);
  if (already && already.demoVer === demo.workspaces[0].demoVer) {
    openWorkspace(wsId); return;   // à jour : simple ouverture
  }
  if (already) {
    // version démo plus récente embarquée : on remplace le workspace démo
    pushHistory();
    state.workspaces[state.workspaces.indexOf(already)] = demo.workspaces[0];
    state.activeWorkspaceId = wsId;
    saveState();
    renderPalette();
    renderSiteFilter();
    openWorkspace(wsId);
    lldAlert('La démo a été remplacée par la dernière version embarquée.', { title: '🎬 Charger la démo' });
    return;
  }

  pushHistory();
  state = mergeDemoInto(state, demo);
  state.activeWorkspaceId = wsId;
  saveState();
  renderPalette();          // la bibliothèque gagne les devices de la démo
  renderSiteFilter();
  openWorkspace(wsId);
}

function pushToServer() {
  if (!serverAvailable) return Promise.resolve(false);
  // Réutilise la sérialisation de saveState si elle est fraîche (une seule
  // copie du JSON au lieu de deux), sinon sérialise à la demande.
  const body = pendingStateJson !== null ? pendingStateJson : JSON.stringify(state);
  return fetch(SERVER_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body
  })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      serverAvailable = true;
      setSaveStatus('cloud');
      return true;
    })
    .catch(() => {
      // Le serveur a disparu en cours de session : on bascule en local
      serverAvailable = false;
      setSaveStatus('local');
      return false;
    })
    .finally(() => { pendingStateJson = null; });
}

// Écritures groupées (~600 ms) pour ne pas saturer le serveur
function scheduleServerSave(immediate = false) {
  if (!serverAvailable) return;
  setSaveStatus('saving');
  clearTimeout(serverPushTimer);
  const run = () => {
    if (serverPushPending) { serverPushQueued = true; return; }
    serverPushPending = true;
    pushToServer().finally(() => {
      serverPushPending = false;
      if (serverPushQueued) { serverPushQueued = false; run(); }
    });
  };
  if (immediate) run();
  else serverPushTimer = setTimeout(run, 600);
}

// Workspace courant (peut être absent sur l'écran d'accueil)
function active() {
  return state.workspaces.find(w => w.id === state.activeWorkspaceId) || null;
}

// Marquer un workspace comme modifié (pour l'historique de l'accueil)
function touchWorkspace(ws) {
  if (ws) ws.updatedAt = Date.now();
}

// Dernière sérialisation de l'état : partagée entre localStorage et le push
// serveur pour ne payer JSON.stringify(state) qu'UNE fois par sauvegarde.
let pendingStateJson = null;

function saveState() {
  try {
    pendingStateJson = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, pendingStateJson);
  } catch (e) {
    pendingStateJson = null;
    console.warn('Sauvegarde locale impossible (quota localStorage ?)', e);
  }
  // Synchronisation avec le serveur (fichier JSON) si disponible
  scheduleServerSave();
}

// Sauvegarde différée (pour la vue, sollicitée pendant le zoom/pan)
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

/* ============================================================
   UNDO / REDO — historique d'instantanés de l'état
   ============================================================ */
const HISTORY_LIMIT = 40;
let undoStack = [];
let redoStack = [];

function cloneState() {
  // Copie structurelle qui PARTAGE les chaînes (photos en base64 notamment,
  // immuables en JS) : chaque snapshot d'undo ne duplique plus les ~677 Ko
  // de photos — quelques Ko de structure au lieu d'un clone JSON complet
  // (qui coûtait ~3 ms et ~32 Mo de RAM pour 40 niveaux d'historique).
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;   // strings/nombres : par référence
    if (Array.isArray(v)) {
      const a = new Array(v.length);
      for (let i = 0; i < v.length; i++) a[i] = walk(v[i]);
      return a;
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = walk(v[k]);
    return o;
  };
  return walk(state);
}

// À appeler AVANT toute mutation de state (hors vue/zoom-pan)
function pushHistory() {
  undoStack.push(cloneState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}

function refreshAll() {
  const ws = active();
  if (ws) {
    if (ws.viewTouched && ws.view) {
      view.x = ws.view.x;
      view.y = ws.view.y;
      view.scale = ws.view.scale;
      applyView();
    } else {
      fitViewToContent();
    }
  }
  renderPalette();
  renderSiteFilter();
  renderHomeListSafe();
  const stillExists = ws && state.workspaces.some(w => w.id === ws.id);
  if (stillExists) {
    hideHome();
    renderBoard();
    if (cablingMode) { renderCables(); renderCableList(); }
  } else {
    showHome();
  }
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneState());
  state = undoStack.pop();
  pendingPort = null;
  hideCablePopoverSafe();
  saveState();
  refreshAll();
  if (cablingMode) { renderCables(); renderCableList(); }
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneState());
  state = redoStack.pop();
  pendingPort = null;
  hideCablePopoverSafe();
  saveState();
  refreshAll();
  if (cablingMode) { renderCables(); renderCableList(); }
}

function hideCablePopoverSafe() {
  const el = document.getElementById('cable-popover');
  if (el) el.classList.add('hidden');
  cablePopoverCtx = null;
}

function renderHomeListSafe() {
  if (!homeScreen.classList.contains('hidden')) renderHomeList();
}

// Raccourcis clavier Ctrl+Z / Ctrl+Y (sauf quand on tape dans un champ)
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.target?.closest?.(`input, textarea, select, [contenteditable]`)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    redo();
  }
});

/* ============================================================
   BOARD — zoom & pan
   ============================================================ */

const viewport = $('#board-viewport');
const board    = $('#board');

let lastZoomPct = -1;
function applyView() {
  board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  // Le libellé de zoom ne change qu'au changement de pourcentage (évite une
  // mutation DOM par événement pointermove pendant le pan)
  const pct = Math.round(view.scale * 100);
  if (pct !== lastZoomPct) {
    lastZoomPct = pct;
    $('#z-pct').textContent = pct + '%';
  }
  // NB : plus de ws.view/scheduleSave ici — chaque geste appelle
  // markViewTouched() à sa fin, qui mémorise la vue et sauvegarde UNE fois.
  // (Écrire localStorage (synchrone, ~400 Ko) toutes les 400 ms pendant
  // un pan/zoom provoquait des à-coups réguliers.)
}

// Marque la vue courante comme personnalisée (l'utilisateur a zoomé/déplacé)
function markViewTouched() {
  const ws = active();
  if (!ws) return;
  ws.viewTouched = true;
  ws.view = { x: view.x, y: view.y, scale: view.scale };
  scheduleSave();
}

// Recentre/zoome la vue sur l'ensemble des racks du workspace. Quand le board
// est vide, le centre du plan virtuel reste au milieu du viewport. forceScale = 1 pour le ⌂.
function fitViewToContent(forceScale = null) {
  const ws = active();
  const rect = viewport.getBoundingClientRect();
  const PAD = 80;

  // Vue topologie : cadrer sur les noeuds du diagramme
  if (boardMode === 'topo') {
    const nodes = ws?.topology?.nodes || [];
    if (!nodes.length) {
      // Même comportement que la vue élévations : un workspace vide démarre
      // au milieu du plan, et non sur son origine en haut à gauche.
      const scale = forceScale ?? 1;
      view.scale = scale;
      view.x = rect.width / 2 - (BOARD_W / 2) * scale;
      view.y = rect.height / 2 - (BOARD_H / 2) * scale;
      applyView();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + TOPO_NW);
      maxY = Math.max(maxY, n.y + TOPO_NH);
    });
    const cw = maxX - minX, ch = maxY - minY;
    const scale = forceScale ?? Math.max(MIN_SCALE, Math.min(1,
      (rect.width - PAD * 2) / cw, (rect.height - PAD * 2) / ch));
    view.scale = scale;
    view.x = rect.width / 2 - (minX + cw / 2) * scale;
    view.y = rect.height / 2 - (minY + ch / 2) * scale;
    applyView();
    return;
  }

  if (!ws || !ws.racks.length) {
    // Ne pas afficher l'origine (0, 0) du plan : sur un board vide, cela
    // donnait l'impression d'être bloqué dans son coin haut-gauche.
    // Le premier rack déposé au centre apparaîtra donc naturellement centré.
    const scale = forceScale ?? 1;
    view.scale = scale;
    view.x = rect.width / 2 - (BOARD_W / 2) * scale;
    view.y = rect.height / 2 - (BOARD_H / 2) * scale;
    applyView();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ws.racks.forEach(r => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + RACK_W);
    maxY = Math.max(maxY, r.y + rackHeight(r));
  });
  const cw = maxX - minX, ch = maxY - minY;

  const scale = forceScale ?? Math.max(MIN_SCALE, Math.min(1,
    (rect.width  - PAD * 2) / cw,
    (rect.height - PAD * 2) / ch));
  view.scale = scale;
  view.x = rect.width  / 2 - (minX + cw / 2) * scale;
  view.y = rect.height / 2 - (minY + ch / 2) * scale;
  applyView();
}

// Applique la vue du workspace : la vue mémorisée si l'utilisateur l'a
// personnalisée, sinon un recadrage automatique sur le contenu.
function applyWorkspaceView() {
  const ws = active();
  if (ws && ws.viewTouched && ws.view) {
    view.x = ws.view.x;
    view.y = ws.view.y;
    view.scale = ws.view.scale;
    applyView();
  } else {
    fitViewToContent();
  }
}

// Coordonnées écran -> coordonnées board
function clientToBoard(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return {
    x: (cx - r.left - view.x) / view.scale,
    y: (cy - r.top  - view.y) / view.scale
  };
}

function zoomAt(cx, cy, factor) {
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
  const k = newScale / view.scale;
  // garde le point sous le curseur immobile
  view.x = cx - k * (cx - view.x);
  view.y = cy - k * (cy - view.y);
  view.scale = newScale;
  markViewTouched();
  applyView();
}

// Zoom molette — les ticks sont cumulés puis appliqués une seule fois par
// frame d'écran (un trackpad peut en émettre des dizaines par frame, et
// chaque changement d'échelle re-rastérise les tuiles visibles du calque)
let wheelRaf = 0;
let zoomIdleTimer = null;
const wheelAcc = { x: 0, y: 0, f: 1 };
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  wheelAcc.x = e.clientX - r.left;
  wheelAcc.y = e.clientY - r.top;
  wheelAcc.f *= (e.deltaY < 0 ? 1.12 : 1 / 1.12);
  // Neutralise le :hover des ports le temps du zoom (règle CSS .zooming)
  viewport.classList.add('zooming');
  tooltip.classList.add('hidden');   // l'infobulle ne suit plus pendant le zoom
  clearTimeout(zoomIdleTimer);
  zoomIdleTimer = setTimeout(() => viewport.classList.remove('zooming'), 180);
  if (!wheelRaf) {
    wheelRaf = requestAnimationFrame(() => {
      wheelRaf = 0;
      zoomAt(wheelAcc.x, wheelAcc.y, wheelAcc.f);
      wheelAcc.f = 1;
    });
  }
}, { passive: false });

// Pan : glisser le fond (pas sur une baie, un contrôle ou une fenêtre)
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  // NB : tout contrôle interactif posé sur le viewport doit figurer ici,
  // sinon setPointerCapture détourne le clic (le bouton ne le reçoit jamais).
  if (e.target.closest('.rack, .zoom-ctrl, .popover, .tooltip, .topo-toolbar, .topo-node, .topo-empty, .cable-panel, .board-empty, #view3d-root')) return;

  const startX = e.clientX, startY = e.clientY;
  const ox = view.x, oy = view.y;
  let panned = false;
  let panRaf = 0;
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('panning');

  const onMove = ev => {
    panned = true;
    view.x = ox + ev.clientX - startX;
    view.y = oy + ev.clientY - startY;
    // Appliquer la vue au rythme de l'écran : les souris/touchpads émettent
    // jusqu'à 240 événements/s, inutile de payer 240 mises à jour pour 60 fps.
    if (!panRaf) {
      panRaf = requestAnimationFrame(() => { panRaf = 0; applyView(); });
    }
  };
  const onUp = () => {
    viewport.classList.remove('panning');
    viewport.removeEventListener('pointermove', onMove);
    viewport.removeEventListener('pointerup', onUp);
    if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; }
    if (panned) { applyView(); markViewTouched(); }
  };
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
});

// Boutons de zoom
function zoomCenter(factor) {
  const r = viewport.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, factor);
}
$('#z-in').addEventListener('click', () => zoomCenter(1.2));
$('#z-out').addEventListener('click', () => zoomCenter(1 / 1.2));
$('#z-reset').addEventListener('click', () => {
  // Recentre sur le contenu à 100 %
  fitViewToContent(1);
  markViewTouched();
});

/* ============================================================
   PANNEAU LATÉRAL — palette & devices
   ============================================================ */

// Options des sélecteurs de catégorie (bibliothèque + modale device)
(function fillCatSelects() {
  const f = $('#pal-cat-filter');
  if (f) f.innerHTML = '<option value="all">Toutes les catégories</option>' +
    DEV_CATEGORIES.map(([id, ico, lbl]) => `<option value="${id}">${ico} ${lbl}</option>`).join('');
  const d = $('#d-cat');
  if (d) d.innerHTML = DEV_CATEGORIES.map(([id, ico, lbl]) => `<option value="${id}">${ico} ${lbl}</option>`).join('');
  const cd = $('#c-domain');
  if (cd) cd.innerHTML = CABLE_DOMAINS.map(([id, lbl]) => `<option value="${id}">${lbl}</option>`).join('');
})();
$('#pal-cat-filter').addEventListener('change', e => {
  palCatFilter = e.target.value;
  renderPalette();
});

function renderPalette() {
  const list = $('#device-list');
  list.innerHTML = '';

  // S'assurer que le WatchGuard permanent existe toujours
  ensureWatchGuard();

  // Filtre par catégorie ('all' = toutes)
  const shown = palCatFilter === 'all'
    ? state.devices
    : state.devices.filter(d => normCat(d.cat) === palCatFilter);

  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Aucun device dans cette catégorie.';
    list.appendChild(empty);
  }

  shown.forEach(d => {
    const card = document.createElement('div');
    card.className = 'pal-card device-card';
    card.draggable = true;
    card.dataset.deviceId = d.id;
    card.innerHTML = `
      <div class="pal-thumb">
        ${d.photo
          ? `<img src="${d.photo}" alt="" draggable="false">`
          : `<span>${escapeHtml((d.name[0] || '?').toUpperCase())}</span>`}
      </div>
      <div class="pal-meta">
        <strong>${escapeHtml(d.name)}</strong>
        <small>${d.sizeU}U · ${catIcon(d.cat)} ${escapeHtml(catLabel(d.cat))}</small>
      </div>
      <div class="pal-actions">
        <button class="mini-edit" title="Modifier ce device">✏️</button>
        ${d.permanent ? '' : '<button class="mini-del" title="Supprimer ce modèle de device">✕</button>'}
      </div>`;

    card.addEventListener('dragstart', e => {
      dragPayload = { kind: 'device', deviceId: d.id, size: d.sizeU };
      e.dataTransfer.setData('application/x-dc-device', d.id);
      e.dataTransfer.effectAllowed = 'copy';
    });

    // Bouton modifier
    card.querySelector('.mini-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditDeviceModal(d);
    });

    // Bouton supprimer (seulement pour les devices non-permanents)
    if (!d.permanent) {
      card.querySelector('.mini-del').addEventListener('click', async () => {
        const ok = await lldConfirm(
          `Supprimer le modèle « ${d.name} » de la bibliothèque ?\n(Les exemplaires déjà placés sont conservés.)`,
          { title: '🗑 Supprimer le modèle', okLabel: 'Supprimer' });
        if (ok) {
          pushHistory();
          // Les exemplaires posés qui affichent la photo du modèle la
          // conservent : on la leur matérialise avant de retirer le modèle.
          if (d.photo) {
            state.workspaces.forEach(w => w.racks.forEach(r => r.instances.forEach(i => {
              if (i.deviceId === d.id && !i.photo) i.photo = d.photo;
            })));
          }
          state.devices = state.devices.filter(x => x.id !== d.id);
          saveState();
          renderPalette();
        }
      });
    }

    list.appendChild(card);
  });
}

// Rack de la palette (taille choisie dans le menu déroulant)
$('#pal-rack').addEventListener('dragstart', e => {
  const sizeU = parseInt($('#new-rack-size').value, 10) || DEFAULT_RACK_U;
  dragPayload = { kind: 'rack', size: sizeU };
  e.dataTransfer.setData('application/x-dc-rack', '1');
  e.dataTransfer.effectAllowed = 'copy';
});
document.addEventListener('dragend', () => {
  dragPayload = null;
  document.querySelectorAll('.drop-hint').forEach(h => h.classList.add('hidden'));
});
document.addEventListener('dragstart', () => hideDevicePopover());

/* ============================================================
   BOARD — drop des baies
   ============================================================ */

viewport.addEventListener('dragover', e => {
  if (dragPayload && dragPayload.kind === 'rack') {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});

viewport.addEventListener('drop', e => {
  if (!dragPayload || dragPayload.kind !== 'rack') return;
  e.preventDefault();
  const p = clientToBoard(e.clientX, e.clientY);
  const sizeU = dragPayload.size || DEFAULT_RACK_U;
  const rack = normalizeRack({
    id: uid(),
    x: Math.max(0, Math.min(p.x - RACK_W / 2, BOARD_W - RACK_W)),
    y: Math.max(0, p.y - 30),
    sizeU,
    instances: []
  });
  rack.y = Math.max(0, Math.min(rack.y, BOARD_H - rackHeight(rack)));
  const ws = active();
  pushHistory();
  ws.racks.push(rack);
  touchWorkspace(ws);
  dragPayload = null;
  saveState();
  renderBoard();
});

function renderBoard() {
  board.innerHTML = '';
  hideDevicePopover();   // le device affiché vient d'être re-créé (ou supprimé)
  const ws = active();
  const empty = $('#board-empty');
  if (!ws) { empty.classList.add('hidden'); $('#topo-empty')?.classList.add('hidden'); $('#topo-toolbar')?.classList.add('hidden'); return; }
  if (boardMode === 'topo') { renderTopology(ws); return; }
  if (boardMode === '3d') { window.LLDraw3D?.refresh(); return; }
  $('#topo-empty').classList.add('hidden');
  $('#topo-toolbar').classList.add('hidden');
  ws.racks.forEach(rack => board.appendChild(renderRack(rack)));
  empty.classList.toggle('hidden', ws.racks.length > 0);

  // Couche SVG des câbles (recréée à chaque rendu)
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'cable-svg';
  const temp = document.createElementNS(svgNS, 'path');
  temp.setAttribute('class', 'cable-temp');
  svg.appendChild(temp);
  board.appendChild(svg);

  renderCables();
}

/* ============================================================
   FILTRE PAR SITE (panneau de gauche)
   ============================================================ */

// Met à jour le sélecteur « Filtrer le board » de la sidebar.
// Masqué si le workspace courant n'a aucun site déclaré.
function renderSiteFilter() {
  const sec = $('#site-filter-sec');
  const sel = $('#site-filter');
  if (!sec || !sel) return;
  const ws = active();
  const sites = ws?.sites || [];
  sec.classList.toggle('hidden', sites.length === 0);
  if (siteFilter !== 'all' && !sites.some(s => s.id === siteFilter)) siteFilter = 'all';
  sel.innerHTML = '<option value="all">Tous les sites</option>' +
    sites.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  sel.value = siteFilter;
}

$('#site-filter').addEventListener('change', e => {
  siteFilter = e.target.value;
  renderBoard();
});

/* ============================================================
   RACK
   ============================================================ */

function renderRack(rack) {
  const el = document.createElement('div');
  el.className = 'rack';
  el.dataset.rackId = rack.id;
  el.style.left = rack.x + 'px';
  el.style.top  = rack.y + 'px';

  // Filtre par site : atténuer les racks hors site sélectionné
  if (siteFilter !== 'all' && rack.siteId !== siteFilter) el.classList.add('site-dim');

  // ---- En-tête ----
  const ws = active();
  const sites = ws?.sites || [];
  const header = document.createElement('div');
  header.className = 'rack-header';
  header.innerHTML = `
    <span class="rack-led"></span>
    <span class="rack-site-dot${siteColor(ws, rack) ? '' : ' none'}" title="Site du rack"></span>
    <select class="rack-site-sel${sites.length ? '' : ' hidden'}" title="Rattacher ce rack à un site">
      <option value="">— site —</option>
      ${sites.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
    </select>
    <span class="rack-title" title="Double-cliquez pour renommer"></span>
    <select class="rack-size-sel" title="Changer la taille du rack">
      ${RACK_SIZES.map(u => `<option value="${u}">${u}U</option>`).join('')}
    </select>
    <span class="rack-metrics"></span>
    <span class="rack-vents"></span>
    <button class="mini-del rack-del" title="Supprimer le rack" aria-label="Supprimer le rack">🗑</button>`;
  el.appendChild(header);

  const titleEl = header.querySelector('.rack-title');
  titleEl.textContent = rack.name;
  const sizeSel = header.querySelector('.rack-size-sel');
  sizeSel.value = String(rack.sizeU);

  // Pastille de site (couleur attribuée par position dans la liste des sites)
  const dotEl = header.querySelector('.rack-site-dot');
  const dotColor = siteColor(ws, rack);
  if (dotColor) {
    dotEl.style.background = dotColor;
    dotEl.title = `Site : ${siteName(ws, rack)}`;
  } else {
    dotEl.title = 'Aucun site';
  }

  // Rattachement du rack à un site
  const siteSel = header.querySelector('.rack-site-sel');
  siteSel.value = rack.siteId || '';
  siteSel.addEventListener('change', e => {
    pushHistory();
    rack.siteId = e.target.value;
    touchWorkspace(active());
    saveState();
    renderBoard();
  });

  // Métriques de capacité : U occupés, puissance, poids (+ budgets, double-clic)
  const metricsEl = header.querySelector('.rack-metrics');
  {
    const usedU = rack.instances.reduce((s, i) => s + i.sizeU, 0);
    const watts = rack.instances.reduce((s, i) => s + (i.watts || 0), 0);
    const kg = rack.instances.reduce((s, i) => s + (i.weightKg || 0), 0);
    const wOver = rack.maxWatts > 0 && watts > rack.maxWatts;
    const kgOver = rack.maxKg > 0 && kg > rack.maxKg;
    let html = `<span class="rm rm-u${usedU >= rack.sizeU ? ' full' : ''}" ` +
      `title="Espace occupé : ${usedU}U sur ${rack.sizeU}U">${usedU}/${rack.sizeU}U</span>`;
    if (watts || rack.maxWatts) {
      html += `<span class="rm rm-w${wOver ? ' over' : ''}" data-metric="maxWatts"` +
        ` title="Puissance estimée : ${fmtWatts(watts)}${rack.maxWatts ? ' / budget ' + fmtWatts(rack.maxWatts) : ''} — double-cliquez pour définir le budget">` +
        `${fmtWatts(watts)}${rack.maxWatts ? ' / ' + fmtWatts(rack.maxWatts) : ''}</span>`;
    }
    if (kg || rack.maxKg) {
      html += `<span class="rm rm-kg${kgOver ? ' over' : ''}" data-metric="maxKg"` +
        ` title="Poids estimé : ${Math.round(kg)} kg${rack.maxKg ? ' / charge max ' + rack.maxKg + ' kg' : ''} — double-cliquez pour définir la charge max">` +
        `${Math.round(kg)} kg${rack.maxKg ? ' / ' + rack.maxKg : ''}</span>`;
    }
    metricsEl.innerHTML = html;
  }

  // Définition des budgets de capacité (double-clic sur un badge)
  metricsEl.addEventListener('dblclick', async e => {
    const rm = e.target.closest('.rm[data-metric]');
    if (!rm) return;
    e.stopPropagation();
    const field = rm.dataset.metric;
    const isW = field === 'maxWatts';
    const val = await lldPrompt(
      isW ? 'Budget électrique du rack en watts (vide = aucun budget) :'
          : 'Charge maximale du rack en kg (vide = aucune limite) :',
      String(rack[field] || ''),
      { title: isW ? '⚡ Budget électrique' : '⚖ Charge maximale', okLabel: 'Appliquer' });
    if (val === null) return;
    const n = Math.max(0, parseFloat(String(val).replace(',', '.')) || 0);
    if (n === (rack[field] || 0)) return;
    pushHistory();
    rack[field] = n;
    touchWorkspace(active());
    saveState();
    renderBoard();
  });

  // Renommage : double-clic sur le titre
  titleEl.addEventListener('dblclick', async e => {
    e.stopPropagation();
    const name = await lldPrompt('Nom du rack :', rack.name, { title: '✏️ Renommer le rack', okLabel: 'Renommer' });
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === rack.name) return;
    pushHistory();
    rack.name = trimmed;
    touchWorkspace(active());
    saveState();
    renderBoard();
  });

  // Changement de taille
  sizeSel.addEventListener('change', async e => {
    const newSize = parseInt(e.target.value, 10) || rack.sizeU;
    if (newSize === rack.sizeU) return;

    // Vérifier que les devices placés tiennent toujours
    const overflow = rack.instances.filter(i => i.slot + i.sizeU > newSize);
    if (overflow.length) {
      const ok = await lldConfirm(
        `Passer en ${newSize}U va déloger ${overflow.length} device(s) qui ne tient/tiendront plus. Continuer ?`,
        { title: '⚠️ Changement de taille', okLabel: 'Continuer' });
      if (!ok) {
        sizeSel.value = String(rack.sizeU);
        return;
      }
    }
    pushHistory();
    rack.sizeU = newSize;
    // Si le nom n'a jamais été personnalisé (forme "Rack 12U"), suivre la taille
    if (/^Rack \d+U$/.test(rack.name)) rack.name = `Rack ${newSize}U`;
    // Repousser les devices qui dépassent
    rack.instances.forEach(i => {
      i.slot = Math.min(i.slot, Math.max(0, newSize - i.sizeU));
    });
    rack.y = Math.max(0, Math.min(rack.y, BOARD_H - rackHeight(rack)));
    touchWorkspace(active());
    saveState();
    renderBoard();
  });

  // Déplacement du rack par son en-tête
  header.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select, input')) return;
    e.stopPropagation(); // ne pas déclencher le pan du board
    const startX = e.clientX, startY = e.clientY;
    const ox = rack.x, oy = rack.y;
    let moved = false;
    let dragRaf = 0;
    header.setPointerCapture(e.pointerId);
    const onMove = ev => {
      moved = true;
      rack.x = Math.max(0, Math.min(ox + (ev.clientX - startX) / view.scale, BOARD_W - RACK_W));
      rack.y = Math.max(0, Math.min(oy + (ev.clientY - startY) / view.scale, BOARD_H - rackHeight(rack)));
      // translate composité (GPU) pendant le drag — left/top ne sont écrits
      // qu'au relâchement, ce qui évite un layout + repaint par frame
      el.classList.add('dragging');
      if (!dragRaf) {
        dragRaf = requestAnimationFrame(() => {
          dragRaf = 0;
          el.style.transform = `translate(${rack.x - ox}px, ${rack.y - oy}px)`;
        });
      }
    };
    const onUp = () => {
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      el.classList.remove('dragging');
      el.style.transform = '';
      if (moved) {
        // Position définitive (données + style), une seule fois
        el.style.left = rack.x + 'px';
        el.style.top  = rack.y + 'px';
        pushHistory();
        saveState();
      }
    };
    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
  });

  header.querySelector('.rack-del').addEventListener('click', async () => {
    const ok = await lldConfirm(
      `Supprimer le rack « ${rack.name} » et tous les devices qu'il contient ?\nCette action est annulable avec Ctrl+Z.`,
      { title: '🗑 Supprimer le rack', okLabel: 'Supprimer' });
    if (ok) {
      pushHistory();
      const ws = active();
      ws.racks = ws.racks.filter(r => r.id !== rack.id);
      touchWorkspace(ws);
      saveState();
      renderBoard();
    }
  });

  // ---- Corps : règle U + montants + zone intérieure ----
  const bodyEl = document.createElement('div');
  bodyEl.className = 'rack-body';

  const frame = document.createElement('div');
  frame.className = 'rack-frame';

  // Règle des U (U<size> en haut … U1 en bas)
  const ruler = document.createElement('div');
  ruler.className = 'u-ruler';
  for (let i = 0; i < rack.sizeU; i++) {
    const u = document.createElement('div');
    u.className = 'u-label';
    u.textContent = rack.sizeU - i;
    ruler.appendChild(u);
  }
  frame.appendChild(ruler);

  // Montant gauche perforé
  const railL = document.createElement('div');
  railL.className = 'rail';
  frame.appendChild(railL);

  // Zone intérieure (hauteur = nombre d'U)
  const inner = document.createElement('div');
  inner.className = 'rack-inner';
  inner.style.height = (rack.sizeU * U_H) + 'px';

  const hint = document.createElement('div');
  hint.className = 'drop-hint hidden';
  inner.appendChild(hint);

  rack.instances.forEach(inst => inner.appendChild(renderDevice(rack, inst)));

  // --- Drag & drop des devices dans la baie ---
  inner.addEventListener('dragover', e => {
    if (!dragPayload || (dragPayload.kind !== 'device' && dragPayload.kind !== 'instance')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragPayload.kind === 'device' ? 'copy' : 'move';

    const size = dragPayload.size;
    const excludeId = dragPayload.kind === 'instance' ? dragPayload.instId : null;
    const slot = slotFromPointer(inner, e.clientY, size, rack);
    const free = isSlotFree(rack, slot, size, excludeId);

    hint.style.top    = (slot * U_H) + 'px';
    hint.style.height = (size * U_H) + 'px';
    hint.classList.remove('hidden', 'ok', 'bad');
    hint.classList.add(free ? 'ok' : 'bad');
  });

  inner.addEventListener('dragleave', e => {
    if (!inner.contains(e.relatedTarget)) hint.classList.add('hidden');
  });

  inner.addEventListener('drop', e => {
    if (!dragPayload || (dragPayload.kind !== 'device' && dragPayload.kind !== 'instance')) return;
    e.preventDefault();
    e.stopPropagation();
    hint.classList.add('hidden');

    const size = dragPayload.size;
    const slot = slotFromPointer(inner, e.clientY, size, rack);
    const excludeId = dragPayload.kind === 'instance' ? dragPayload.instId : null;

    if (!isSlotFree(rack, slot, size, excludeId)) {
      dragPayload = null;
      return;
    }

    let changed = false;
    if (dragPayload.kind === 'device') {
      const tpl = state.devices.find(d => d.id === dragPayload.deviceId);
      if (tpl) {
        pushHistory();
        rack.instances.push({
          id: uid(),
          deviceId: tpl.id,
          name: tpl.name,
          sizeU: tpl.sizeU,
          photo: '',   // pas de copie : rendu via la photo du modèle (instPhoto)
          cat: normCat(tpl.cat),
          slot,
          brand: tpl.brand || '',
          model: tpl.model || '',
          partRef: tpl.partRef || '',
          serial: tpl.serial || '',
          ipMgmt: tpl.ipMgmt || '',
          vlan: tpl.vlan || '',
          warranty: tpl.warranty || '',
          warrantyEnd: tpl.warrantyEnd || '',
          watts: tpl.watts || 0,
          weightKg: tpl.weightKg || 0,
          ports: (tpl.ports || []).map(p => ({
            id: uid(), xPct: p.xPct, yPct: p.yPct,
            name: p.name, label: p.label || '', size: p.size || 1,
            ip: p.ip || '', vlan: p.vlan || ''
          }))
        });
        changed = true;
      }
    } else {
      // déplacement d'un device déjà placé (vers un autre étage / un autre rack)
      let oldRack = null;
      for (const w of state.workspaces) {
        oldRack = w.racks.find(r => r.instances.some(i => i.id === dragPayload.instId));
        if (oldRack) break;
      }
      if (oldRack) {
        const inst = oldRack.instances.find(i => i.id === dragPayload.instId);
        const same = oldRack === rack && inst && inst.slot === slot;
        if (!same) {
          pushHistory();
          const idx = oldRack.instances.findIndex(i => i.id === dragPayload.instId);
          const [moved] = oldRack.instances.splice(idx, 1);
          moved.slot = slot;
          rack.instances.push(moved);
          changed = true;
        }
      }
    }

    dragPayload = null;
    if (changed) {
      touchWorkspace(active());
      saveState();
      renderBoard();
    }
  });

  // --- Réamorçage du drag depuis un device placé ---
  inner.addEventListener('dragstart', e => {
    const devEl = e.target.closest('.device');
    if (!devEl || labelMode || cablingMode) { e.preventDefault(); return; }
    const instId = devEl.dataset.instanceId;
    const inst = rack.instances.find(i => i.id === instId);
    if (!inst) return;
    dragPayload = { kind: 'instance', rackId: rack.id, instId, size: inst.sizeU };
    e.dataTransfer.setData('application/x-dc-instance', instId);
    e.dataTransfer.effectAllowed = 'move';
  });

  // En mode câblage, un double-clic sur la face d'un device met ses cordons
  // au premier plan et conserve tous les autres en affichage fantôme.
  inner.addEventListener('dblclick', e => {
    if (!cablingMode || e.target.closest('.port, .device-del')) return;
    const devEl = e.target.closest('.device');
    if (!devEl) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(cableSingleClickTimer);
    cableSingleClickTimer = null;
    const instId = devEl.dataset.instanceId;
    const ids = (active()?.cables || [])
      .filter(c => c.a?.instId === instId || c.b?.instId === instId)
      .map(c => c.id);
    if (!ids.length) return;
    // Premier double-clic : seuls les câbles de ce device restent forts.
    // Second double-clic sur le même ensemble : retour à l'affichage normal.
    const sameSelection = focusedCableIds.size === ids.length && ids.every(id => focusedCableIds.has(id));
    focusedCableIds.clear();
    if (!sameSelection) ids.forEach(id => focusedCableIds.add(id));
    renderCables();
    renderCableList();
  });

  // --- Clics : retrait device / étiquetage ---
  inner.addEventListener('click', async e => {
    const delBtn = e.target.closest('.device-del');
    if (delBtn) {
      const devEl = delBtn.closest('.device');
      const inst = rack.instances.find(i => i.id === devEl.dataset.instanceId);
      if (!inst) return;
      const ws = active();
      const likelyCables = (ws?.cables || []).filter(c => c.a?.instId === inst.id || c.b?.instId === inst.id).length;
      const cableNote = likelyCables
        ? `\n${likelyCables} câble(s) relié(s) à ce device seront également retiré(s).`
        : '';
      const ok = await lldConfirm(
        `Retirer « ${inst.name} » (${inst.sizeU}U) de ce rack ?` +
        cableNote +
        `\nCette action est annulable avec Ctrl+Z.`,
        { title: '✕ Retirer le device', okLabel: 'Retirer' });
      if (!ok) return;
      pushHistory();
      rack.instances = rack.instances.filter(i => i.id !== inst.id);
      pruneCables(ws);   // retire les câbles dont une extrémité a disparu
      touchWorkspace(active());
      saveState();
      renderBoard();
      return;
    }

    const devEl = e.target.closest('.device');
    if (!devEl) return;
    e.stopPropagation();

    const inst = rack.instances.find(i => i.id === devEl.dataset.instanceId);
    if (!inst) return;

    const portEl = e.target.closest('.port');
    const port = portEl ? inst.ports.find(p => p.id === portEl.dataset.portId) : null;

    // Priorité au mode câblage : cliquer un port relie les ports
    if (cablingMode) {
      if (port) handlePortClickCabling(e.clientX, e.clientY, rack, inst, port);
      return;
    }

    // Après un glisser-déposer de port : ignorer le clic qui suit
    if (suppressPortClick) { suppressPortClick = false; return; }

    if (!labelMode) return;

    if (labelMode === 'edit') {
      // Modification : seulement sur un port existant
      if (port) openPortPopover(e.clientX, e.clientY, rack, inst, port);
      return;
    }

    // Création : sur un port existant on l'édite quand même, sinon nouveau port
    if (port) {
      openPortPopover(e.clientX, e.clientY, rack, inst, port);
    } else {
      const r = devEl.getBoundingClientRect();
      const xPct = ((e.clientX - r.left) / r.width) * 100;
      const yPct = ((e.clientY - r.top) / r.height) * 100;
      openPortPopover(e.clientX, e.clientY, rack, inst, null, xPct, yPct);
    }
  });

  frame.appendChild(inner);

  // Montant droit perforé
  const railR = document.createElement('div');
  railR.className = 'rail';
  frame.appendChild(railR);

  bodyEl.appendChild(frame);
  el.appendChild(bodyEl);
  return el;
}

/* ---------- Device (exemplaire monté dans une baie) ---------- */

// Photo d'un exemplaire : la sienne, sinon celle du modèle de la bibliothèque.
// Les exemplaires ne dupliquuent plus la photo (des Ko par device dans l'état) :
// la bibliothèque reste la source visuelle, l'instance peut surcharger.
function instPhoto(inst) {
  if (inst.photo) return inst.photo;
  const tpl = inst.deviceId && state.devices.find(d => d.id === inst.deviceId);
  return tpl?.photo || null;
}

function renderDevice(rack, inst) {
  const dev = document.createElement('div');
  dev.className = 'device';
  dev.dataset.instanceId = inst.id;
  dev.style.top    = (inst.slot * U_H) + 'px';
  dev.style.height = (inst.sizeU * U_H) + 'px';
  // En mode Port (créer/modifier) et en mode Câblage, les devices ne sont
  // pas déplaçables : cela évite que le glisser natif n'avale les clics de ports.
  dev.draggable = !labelMode && !cablingMode;

  const photo = instPhoto(inst);
  if (photo) {
    const img = document.createElement('img');
    img.src = photo;
    img.alt = inst.name;
    img.draggable = false;
    img.decoding = 'async';   // ne bloque pas le thread principal au décodage
    dev.appendChild(img);
  } else {
    const face = document.createElement('div');
    face.className = 'device-nophoto';
    face.innerHTML = `
      <span class="nophoto-led"></span>
      <span class="nophoto-led dim"></span>
      <span class="nophoto-label">${escapeHtml(inst.name)} · ${inst.sizeU}U</span>`;
    dev.appendChild(face);
  }

  // Ports
  (inst.ports || []).forEach(p => {
    const port = document.createElement('div');
    port.className = 'port' + (cablingMode ? ' connectable' : '');
    port.dataset.portId = p.id;
    port.style.left = p.xPct + '%';
    port.style.top  = p.yPct + '%';
    port.dataset.size = p.size || 1;
    port.style.width = (26 * (p.size || 1)) + 'px';
    port.style.height = (26 * (p.size || 1)) + 'px';
    dev.appendChild(port);
  });

  // Pastille de garantie (2 couleurs) : verte = sous garantie, rouge = hors
  // de garantie. Visible en permanence ; le détail (date, contrat, échéance)
  // est dans la fiche de survol du device.
  const wi = warrantyInfo(inst);
  if (wi.status !== 'none') {
    const badge = document.createElement('span');
    badge.className = 'warranty-badge ' + wi.status;
    badge.textContent = '\ud83d\udee1\ufe0f';
    badge.title = warrantyBadgeTitle(inst);
    dev.appendChild(badge);
  }

  // Bouton de retrait
  const del = document.createElement('button');
  del.className = 'device-del';
  del.title = 'Retirer du rack';
  del.textContent = '✕';
  dev.appendChild(del);

  return dev;
}

/* ---------- Calcul d'emplacement (indépendant du zoom) ---------- */
function slotFromPointer(inner, clientY, size, rack) {
  const rect = inner.getBoundingClientRect();
  const rackU = rack?.sizeU || DEFAULT_RACK_U;
  // position relative en U (le rect tient compte de l'échelle du board)
  const uPos = ((clientY - rect.top) / rect.height) * rackU;
  // centre du device sur le pointeur
  let slot = Math.round(uPos - size / 2);
  return Math.max(0, Math.min(slot, rackU - size));
}

function isSlotFree(rack, slot, size, excludeInstId) {
  for (let i = slot; i < slot + size; i++) {
    const occupied = rack.instances.find(inst =>
      inst.id !== excludeInstId && inst.slot <= i && i < inst.slot + inst.sizeU);
    if (occupied) return false;
  }
  return true;
}

/* ============================================================
   MODE ÉTIQUETAGE — ports
   ============================================================ */

// Menu "Port et étiquetage" : choix Créer ou Modifier
$('#btn-label').addEventListener('click', e => {
  e.stopPropagation();
  $('#label-menu').classList.toggle('hidden');
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.port-mode-wrap')) $('#label-menu').classList.add('hidden');
});

function setLabelMode(mode) {
  labelMode = mode;                       // null | 'create' | 'edit'
  document.body.classList.toggle('label-create', mode === 'create');
  document.body.classList.toggle('label-edit', mode === 'edit');
  document.body.classList.remove('labeling');

  const btn = $('#btn-label');
  btn.classList.toggle('active', mode === 'create');
  btn.classList.toggle('active-edit', mode === 'edit');

  // Coche de l'option active dans le menu
  $('#label-create').classList.toggle('checked', mode === 'create');
  $('#label-edit').classList.toggle('checked', mode === 'edit');

  // Mode câblage exclusif
  if (mode && cablingMode) setCablingMode(false);

  $('#mode-hint').textContent = mode === 'create'
    ? 'Mode Création : cliquez sur la face avant d\'un device pour placer un nouveau port.'
    : mode === 'edit'
    ? 'Mode Modification : cliquez sur un port pour changer son nom, son étiquette ou sa taille. Glissez-le pour le déplacer.'
    : 'Glissez un rack sur le board, puis ajoutez vos devices.';

  hidePortPopover();
  $('#label-menu').classList.add('hidden');
  renderBoard();
}

$('#label-create').addEventListener('click', () => setLabelMode('create'));
$('#label-edit').addEventListener('click', () => setLabelMode('edit'));

function openPortPopover(clientX, clientY, rack, inst, port, xPct = null, yPct = null) {
  const pop = $('#port-popover');
  const isNew = !port;
  popoverCtx = {
    rack, inst, port,
    xPct: port ? port.xPct : xPct,
    yPct: port ? port.yPct : yPct,
    previewEl: null
  };

  $('#pp-title').textContent = isNew ? 'Nouveau port' : 'Modifier le port';
  $('#p-name').value  = port ? port.name  : '';
  $('#p-label').value = port ? port.label : '';
  $('#p-ip').value    = port ? (port.ip || '') : '';
  $('#p-vlan').value  = port ? (port.vlan || '') : '';

  // Curseur de taille en pourcentage (50 % – 250 %)
  const baseSize = port?.size ?? 1;
  const slider = $('#p-size');
  slider.value = String(Math.round(baseSize * 100));
  $('#p-size-val').textContent = slider.value + '%';

  $('#p-delete').classList.toggle('hidden', isNew);
  pop.classList.remove('hidden');

  // --- Aperçu en direct à 50 % de transparence ---
  if (isNew) {
    // Port fantôme créé à l'endroit cliqué, encore non enregistré
    const devEl = board.querySelector(`.device[data-instance-id="${inst.id}"]`);
    const ghost = document.createElement('div');
    ghost.className = 'port port-preview';
    ghost.style.left = xPct + '%';
    ghost.style.top  = yPct + '%';
    applyPortSize(ghost, baseSize);
    devEl?.appendChild(ghost);
    popoverCtx.previewEl = ghost;
  } else {
    // Port existant : on le passe en aperçu transparent pendant le réglage
    const el = board.querySelector(`.port[data-port-id="${port.id}"]`);
    if (el) {
      el.classList.add('port-preview');
      popoverCtx.previewEl = el;
    }
  }

  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = clientX + 14, y = clientY + 14;
  if (x + w > window.innerWidth - 10)  x = clientX - w - 14;
  if (y + h > window.innerHeight - 10) y = clientY - h - 14;
  pop.style.left = Math.max(8, x) + 'px';
  pop.style.top  = Math.max(8, y) + 'px';

  $('#p-name').focus();
}

// Applique une taille (facteur d'échelle) à un élément port
function applyPortSize(el, size) {
  const s = 26 * size;
  el.style.width = s + 'px';
  el.style.height = s + 'px';
  el.dataset.size = size;
}

// Réglage en direct de la taille via le curseur
$('#p-size').addEventListener('input', () => {
  const pct = parseInt($('#p-size').value, 10);
  $('#p-size-val').textContent = pct + '%';
  if (popoverCtx?.previewEl) applyPortSize(popoverCtx.previewEl, pct / 100);
});

// Nettoyage de l'aperçu (appelé par enregistrer / annuler / fermer)
function clearPortPreview() {
  if (!popoverCtx) return;
  const { previewEl, port } = popoverCtx;
  if (previewEl) {
    if (!port) {
      // Port fantôme non enregistré -> suppression
      previewEl.remove();
    } else {
      // Port existant -> retrait de l'aperçu et restauration de sa taille réelle
      previewEl.classList.remove('port-preview');
      applyPortSize(previewEl, port.size || 1);
    }
  }
}

function hidePortPopover() {
  clearPortPreview();
  $('#port-popover').classList.add('hidden');
  popoverCtx = null;
}

$('#p-save').addEventListener('click', () => {
  if (!popoverCtx) return;
  const name = $('#p-name').value.trim();
  const label = $('#p-label').value.trim();
  if (!name) { $('#p-name').focus(); return; }
  const ip = $('#p-ip').value.trim().slice(0, 50);
  const vlan = $('#p-vlan').value.trim().slice(0, 30);

  const { inst, port, xPct, yPct } = popoverCtx;
  const size = Math.round(parseInt($('#p-size').value, 10)) / 100 || 1;
  pushHistory();
  if (port) {
    port.name = name;
    port.label = label;
    port.size = size;
    port.ip = ip;
    port.vlan = vlan;
  } else {
    inst.ports.push({ id: uid(), xPct, yPct, name, label, size, ip, vlan });
  }
  hidePortPopover();
  touchWorkspace(active());
  saveState();
  renderBoard();
});

$('#p-delete').addEventListener('click', () => {
  if (!popoverCtx || !popoverCtx.port) return;
  const { inst, port } = popoverCtx;
  pushHistory();
  inst.ports = inst.ports.filter(p => p.id !== port.id);
  hidePortPopover();
  touchWorkspace(active());
  saveState();
  renderBoard();
});

$('#p-cancel').addEventListener('click', hidePortPopover);

// Clic en dehors du popover = annulation
document.addEventListener('pointerdown', e => {
  const pop = $('#port-popover');
  if (popoverCtx && !pop.contains(e.target) && !e.target.closest('.port') &&
      !(labelMode && e.target.closest('.device'))) {
    hidePortPopover();
  }
}, true);

// Entrée = enregistrer, Échap = annuler
$('#port-popover').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#p-save').click();
  if (e.key === 'Escape') hidePortPopover();
});

/* ---------- Infobulle des ports au survol ---------- */
const tooltip = $('#tooltip');

board.addEventListener('mouseover', e => {
  const portEl = e.target.closest('.port');
  if (!portEl) return;
  const rackEl = portEl.closest('.rack');
  const devEl  = portEl.closest('.device');
  const rack = active()?.racks.find(r => r.id === rackEl.dataset.rackId);
  const inst = rack?.instances.find(i => i.id === devEl.dataset.instanceId);
  const port = inst?.ports.find(p => p.id === portEl.dataset.portId);
  if (!port) return;

  tooltip.innerHTML = `
    <div class="tt-name">🔌 ${escapeHtml(port.name)}</div>
    ${port.label ? `<div class="tt-label">${escapeHtml(port.label)}</div>` : ''}
    ${port.ip ? `<div class="tt-meta">🌐 ${escapeHtml(port.ip)}</div>` : ''}
    ${port.vlan ? `<div class="tt-meta">🏷️ VLAN ${escapeHtml(port.vlan)}</div>` : ''}`;
  tooltip.classList.remove('hidden');

  const rect = portEl.getBoundingClientRect();
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  let x = rect.left + rect.width / 2 - tw / 2;
  let y = rect.top - th - 9;
  if (y < 8) y = rect.bottom + 9;
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
});

board.addEventListener('mouseout', e => {
  const portEl = e.target.closest('.port');
  if (portEl && (!e.relatedTarget || !portEl.contains(e.relatedTarget))) {
    tooltip.classList.add('hidden');
  }
});

/* ---------- Déplacement d'un port par glisser (mode Port et étiquetage) ---------- */
board.addEventListener('pointerdown', e => {
  if (labelMode !== 'edit' || e.button !== 0) return;
  const portEl = e.target.closest('.port');
  if (!portEl) return;
  // On n'agresse pas le mode câblage
  if (cablingMode) return;
  const devEl = portEl.closest('.device');
  const rackEl = portEl.closest('.rack');
  const ws = active();
  if (!ws) return;
  const rack = ws.racks.find(r => r.id === rackEl.dataset.rackId);
  const inst = rack?.instances.find(i => i.id === devEl.dataset.instanceId);
  const port = inst?.ports.find(p => p.id === portEl.dataset.portId);
  if (!rack || !inst || !port) return;

  e.preventDefault();
  e.stopPropagation();
  tooltip.classList.add('hidden');
  hidePortPopover();
  board.setPointerCapture(e.pointerId);

  const startX = e.clientX, startY = e.clientY;
  let dragging = false;

  const onMove = ev => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
    if (!dragging) {
      dragging = true;
      pushHistory();
      portEl.classList.add('dragging');
    }
    const r = devEl.getBoundingClientRect();
    let xPct = ((ev.clientX - r.left) / r.width) * 100;
    let yPct = ((ev.clientY - r.top) / r.height) * 100;
    // Borné au device (le port ne peut pas sortir de la face avant)
    xPct = Math.max(0, Math.min(100, xPct));
    yPct = Math.max(0, Math.min(100, yPct));
    port.xPct = xPct;
    port.yPct = yPct;
    portEl.style.left = xPct + '%';
    portEl.style.top  = yPct + '%';
  };
  const onUp = ev => {
    board.removeEventListener('pointermove', onMove);
    board.removeEventListener('pointerup', onUp);
    portEl.classList.remove('dragging');
    // Empêche le handler de clic de traiter aussi ce relâchement
    suppressPortClick = true;
    setTimeout(() => { suppressPortClick = false; }, 0);

    if (dragging) {
      // Glisser-déposer : déplacement du port
      touchWorkspace(ws);
      saveState();
      renderBoard();   // re-rend pour mettre à jour les câbles
    } else if (labelMode === 'edit') {
      // Simple clic sur un port : ouvrir la fenêtre d'édition
      openPortPopover(ev.clientX, ev.clientY, rack, inst, port);
    }
  };
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
});

/* ============================================================
   DÉTECTION AUTOMATIQUE DE PORTS SUR LA PHOTO DE FACE AVANT
   ------------------------------------------------------------
   Analyse l'image (aucune librairie externe) :
     1. Masques de contraste : localement plus sombre ou plus
        clair que le voisinage (image intégrale), + seuils
        globaux en secours — gère ports noirs sur panneau
        blanc, blancs sur panneau sombre, sombres sur sombre…
     2. Érosion binaire : sépare les ports collés entre eux.
     3. Composantes connexes : un blob = un port candidat.
     4. Filtres géométriques : taille, ratio, remplissage.
     5. Rangées horizontales + chaînes régulières : élimine
        le bruit (aérations, logos, texte).
   Renvoie [{ cx, cy, pw, ph }] en pixels image, triées en
   ordre de lecture (haut→bas, gauche→droite).
   ============================================================ */

const PortDetect = (() => {

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  }

  function grayscale(data, W, H) {
    const g = new Float32Array(W * H);
    for (let i = 0, p = 0; i < g.length; i++, p += 4)
      g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    return g;
  }

  function percentile(g, pct) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i] | 0]++;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= g.length * pct) return v; }
    return 255;
  }

  // Image intégrale (moyenne locale en O(1) par pixel)
  function integral(g, W, H) {
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0;
      for (let x = 0; x < W; x++) {
        rs += g[y * W + x];
        I[(y + 1) * (W + 1) + (x + 1)] = I[y * (W + 1) + (x + 1)] + rs;
      }
    }
    return I;
  }
  function localMean(I, W, H, x, y, r) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
    const x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
    return (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] -
            I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }

  // Érosion binaire séparable (carré (2r+1)²)
  function erode(mask, W, H, r) {
    if (r <= 0) return mask;
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let on = 1;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= W || !mask[row + xx]) { on = 0; break; }
        }
        tmp[row + x] = on;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let on = 1;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= H || !tmp[yy * W + x]) { on = 0; break; }
        }
        out[y * W + x] = on;
      }
    }
    return out;
  }

  // Composantes connexes 4-connexité (BFS) — bbox + aire
  function blobs(mask, W, H) {
    const labels = new Int32Array(W * H).fill(-1);
    const out = [], stack = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] !== -1) continue;
      const id = out.length;
      stack.length = 0; stack.push(start); labels[start] = id;
      let minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % W, y = (idx / W) | 0;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0     && mask[idx - 1] && labels[idx - 1] === -1) { labels[idx - 1] = id; stack.push(idx - 1); }
        if (x < W - 1 && mask[idx + 1] && labels[idx + 1] === -1) { labels[idx + 1] = id; stack.push(idx + 1); }
        if (y > 0     && mask[idx - W] && labels[idx - W] === -1) { labels[idx - W] = id; stack.push(idx - W); }
        if (y < H - 1 && mask[idx + W] && labels[idx + W] === -1) { labels[idx + W] = id; stack.push(idx + W); }
      }
      out.push({ minX, minY, maxX, maxY, area,
                 w: maxX - minX + 1, h: maxY - minY + 1,
                 cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
    }
    return out;
  }

  function cvGaps(items) {
    const gaps = [];
    for (let i = 1; i < items.length; i++) gaps.push(items[i].cx - items[i - 1].cx);
    const m = median(gaps.filter(x => x > 2));
    if (!m) return 9;
    return Math.sqrt(gaps.reduce((s, x) => s + (x - m) ** 2, 0) / gaps.length) / m;
  }

  // Rangées horizontales par chaînage de membre + garde anti-diagonale
  function buildRows(cands) {
    const sorted = [...cands].sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const b of sorted) {
      let best = null;
      for (const r of rows) {
        const tol = Math.max(r.phMed * 0.75, 7);
        let nd = 1e9;
        for (const m of r.items) { const d = Math.abs(m.cy - b.cy); if (d < nd) nd = d; }
        if (nd < tol && (!best || nd < best.nd)) best = { r, nd };
      }
      if (best) {
        best.r.items.push(b);
        best.r.phMed = median(best.r.items.map(i => i.ph));
        best.r.cy = best.r.items.reduce((s, i) => s + i.cy, 0) / best.r.items.length;
      } else {
        rows.push({ cy: b.cy, items: [b], phMed: b.ph });
      }
    }
    rows.forEach(r => r.items.sort((a, b) => a.cx - b.cx));
    return rows.filter(r => {
      const ys = r.items.map(i => i.cy);
      return Math.max(...ys) - Math.min(...ys) <= Math.max(r.phMed * 1.3, 8);
    }).sort((a, b) => a.cy - b.cy);
  }

  // Chaînes régulièrement espacées (les îlots isolés sont du bruit)
  function keepChains(items) {
    if (items.length <= 4) return items;
    const gaps = [];
    for (let i = 1; i < items.length; i++) gaps.push(items[i].cx - items[i - 1].cx);
    const pitch = median(gaps.filter(x => x > 2));
    const cs = [[items[0]]];
    for (let i = 1; i < items.length; i++) {
      const gp = items[i].cx - items[i - 1].cx;
      if (gp <= Math.max(pitch * 1.9, pitch + 6)) cs[cs.length - 1].push(items[i]);
      else cs.push([items[i]]);
    }
    const kept = cs.filter(c => c.length >= 2);
    return kept.length ? kept.flat() : cs.sort((a, b) => b.length - a.length)[0];
  }

  function sizeOutliers(items) {
    if (items.length < 5) return items;
    const pwM = median(items.map(i => i.pw)), phM = median(items.map(i => i.ph));
    return items.filter(i => Math.abs(i.pw - pwM) <= pwM * 0.45 && Math.abs(i.ph - phM) <= phM * 0.45);
  }

  // ---- Détection principale : renvoie les rangées retenues ----
  function detect(imageData) {
    const W = imageData.width, H = imageData.height;
    if (W < 220 || H < 60) return null;          // trop petit : pas fiable
    const data = imageData.data;
    const g = grayscale(data, W, H);
    const scale = W / 600;
    const I = integral(g, W, H);
    const minPW = Math.max(5, Math.round(W * 0.022));
    const minPH = Math.max(5, Math.round(W * 0.020));
    const localR = [Math.round(Math.max(8, W / 40)), Math.round(Math.max(8, W / 16))];

    const variants = [];
    for (const type of ['ldark', 'lbright', 'gdark', 'gbright']) {
      for (let vi = 0; vi < 2; vi++) {
        let mask = new Uint8Array(W * H);
        if (type === 'ldark' || type === 'lbright') {
          const r = localR[vi], delta = 12;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const lm = localMean(I, W, H, x, y, r), v = g[y * W + x];
            mask[y * W + x] = type === 'ldark' ? (v < lm - delta ? 1 : 0) : (v > lm + delta ? 1 : 0);
          }
        } else {
          const pct = type === 'gdark' ? (vi === 0 ? 0.18 : 0.32) : (vi === 0 ? 0.82 : 0.68);
          const thr = percentile(g, pct);
          for (let i = 0; i < g.length; i++)
            mask[i] = type === 'gdark' ? (g[i] <= thr ? 1 : 0) : (g[i] >= thr ? 1 : 0);
        }
        for (const r of [Math.max(1, Math.round(scale * 2)), Math.max(1, Math.round(scale * 3))]) {
          const er = erode(mask, W, H, r);
          const cands = [];
          for (const b of blobs(er, W, H)) {
            const pw = b.w + 2 * r, ph = b.h + 2 * r;
            if (pw < minPW || pw > W * 0.30 || ph < minPH || ph > H * 0.55) continue;
            const ar = pw / ph;
            if (ar < 0.5 || ar > 2.8) continue;
            if (b.area / (b.w * b.h) < 0.45) continue;
            cands.push({ ...b, pw, ph });
          }
          variants.push({ cands });
        }
      }
    }

    let best = null;
    for (const v of variants) {
      if (!v.cands.length) continue;
      let rows = buildRows(v.cands)
        .map(r => { r.items = sizeOutliers(keepChains(r.items)); return r; })
        .filter(r => r.items.length);

      let sel = rows.filter(r => r.items.length >= 3 && cvGaps(r.items) <= 0.40);
      let n = sel.reduce((s, r) => s + r.items.length, 0);
      if (n < 12) {
        for (const r2 of rows.filter(r => r.items.length === 2 && !sel.includes(r2))) sel.push(r2);
        n = sel.reduce((s, r) => s + r.items.length, 0);
      }
      if (!n) continue;

      // Cohérence de taille entre rangées (garde-fou anti-bruit)
      if (n >= 12 && sel.length > 1) {
        const all = sel.flatMap(r => r.items);
        const pwG = median(all.map(i => i.pw)), phG = median(all.map(i => i.ph));
        sel = sel.filter(r => {
          const pwM = median(r.items.map(i => i.pw)), phM = median(r.items.map(i => i.ph));
          return Math.abs(pwM - pwG) <= pwG * 0.35 && Math.abs(phM - phG) <= phG * 0.35;
        });
        n = sel.reduce((s, r) => s + r.items.length, 0);
        if (!n) continue;
      }
      if (n > 96) continue;                       // garde-fou : photo type grille d'aération

      let reg = 0, cnt = 0;
      for (const r of sel) if (r.items.length >= 3) { reg += Math.max(0, 1 - cvGaps(r.items)); cnt++; }
      reg = cnt ? reg / cnt : 0.5;
      if (n > 6 && reg < 0.45) continue;          // trop chaotique : on ne devine pas

      const score = n * (0.5 + reg / 2);
      if (!best || score > best.score) best = { rows: sel, n, reg, score };
    }
    return best;
  }

  // ---- API : positions en % + taille suggérée ----
  function portsFromImageData(imageData) {
    const best = detect(imageData);
    if (!best || best.n < 1) return [];
    const W = imageData.width, H = imageData.height;
    const rows = best.rows;                       // triées haut→bas, items gauche→droite
    const maxCols = Math.max(...rows.map(r => r.items.length));
    // taille des carrés « port » selon la densité (pour tenir dans la baie)
    const size = maxCols <= 4 ? 1 : maxCols <= 8 ? 0.8 : maxCols <= 12 ? 0.65
               : maxCols <= 16 ? 0.5 : maxCols <= 26 ? 0.4 : 0.3;
    const ports = [];
    for (const r of rows) for (const it of r.items)
      ports.push({ xPct: (it.cx / W) * 100, yPct: (it.cy / H) * 100, size });
    return ports;
  }

  return { portsFromImageData };
})();

// Charge une dataURL, renvoie l'ImageData correspondante
function imageDataFromUrl(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/* ============================================================
   CRÉATION D'UN DEVICE (modale)
   ============================================================ */

let modalPhoto = null;

let modalPorts = [];          // ports détectés sur la photo [{xPct,yPct,size}]

const D_INV_IDS = ['#d-brand', '#d-model', '#d-ref', '#d-serial', '#d-ip', '#d-vlan', '#d-warranty', '#d-warranty-end'];

$('#btn-new-device').addEventListener('click', () => {
  editingDeviceId = null;
  $('#device-modal-title').textContent = 'Nouveau device';
  $('#d-save').textContent = 'Créer le device';
  $('#d-name').value = '';
  $('#d-size').value = '1';
  $('#d-cat').value = 'other';
  D_INV_IDS.forEach(id => { $(id).value = ''; });
  $('#d-watts').value = '';
  $('#d-kg').value = '';
  updateWarrantyHint();
  $('#d-photo').value = '';
  $('#d-preview').classList.add('hidden');
  $('#d-detect').classList.add('hidden');
  modalPhoto = null;
  modalPorts = [];
  $('#device-modal').classList.remove('hidden');
  $('#d-name').focus();
});

// Fonction pour ouvrir la modale en mode édition
let editingDeviceId = null;

function openEditDeviceModal(device) {
  editingDeviceId = device.id;
  $('#device-modal-title').textContent = 'Modifier le device';
  $('#d-save').textContent = 'Enregistrer les modifications';
  $('#d-name').value = device.name;
  $('#d-size').value = String(device.sizeU);
  $('#d-cat').value = normCat(device.cat);
  $('#d-brand').value = device.brand || '';
  $('#d-model').value = device.model || '';
  $('#d-ref').value = device.partRef || '';
  $('#d-serial').value = device.serial || '';
  $('#d-ip').value = device.ipMgmt || '';
  $('#d-vlan').value = device.vlan || '';
  $('#d-warranty-end').value = device.warrantyEnd || '';
  $('#d-warranty').value = device.warranty || '';
  $('#d-watts').value = device.watts || '';
  $('#d-kg').value = device.weightKg || '';
  updateWarrantyHint();
  $('#d-photo').value = '';
  modalPhoto = device.photo || null;
  modalPorts = [];

  // Afficher l'aperçu de la photo existante et lancer la détection
  if (modalPhoto) {
    showPhotoPreviewAndDetect(modalPhoto, device.id);
  } else if (device.id === WATCHGUARD_ID) {
    // Pour le WatchGuard, essayer de charger la photo si elle n'est pas encore en mémoire
    loadWatchGuardPhoto().then(() => {
      const wg = state.devices.find(d => d.id === WATCHGUARD_ID);
      if (wg?.photo) {
        modalPhoto = wg.photo;
        showPhotoPreviewAndDetect(modalPhoto, device.id);
      }
    });
  } else {
    $('#d-preview').classList.add('hidden');
    $('#d-detect').classList.add('hidden');
  }

  $('#device-modal').classList.remove('hidden');
  $('#d-name').focus();
}

// Afficher l'aperçu de la photo et lancer la détection de ports
function showPhotoPreviewAndDetect(photoDataUrl, deviceId = null) {
  const prev = $('#d-preview');
  const img = prev.querySelector('img');
  img.src = photoDataUrl;
  prev.classList.remove('hidden');
  // Lancer la détection automatique des ports
  detectPortsFromPhoto(photoDataUrl, deviceId);
}

// Fonction pour détecter les ports depuis une photo (réutilisable)
async function detectPortsFromPhoto(photoDataUrl, deviceId = null) {
  modalPorts = [];
  const detectBox = $('#d-detect');
  detectBox.classList.add('hidden');
  const overlay = $('#d-overlay');
  overlay.innerHTML = '';

  if (!photoDataUrl) return;

  const id = await imageDataFromUrl(photoDataUrl);
  let ports = [];
  try { ports = PortDetect.portsFromImageData(id); } catch (err) { console.warn('Détection de ports échouée', err); }
  
  // Pour le WatchGuard, forcer la taille des ports à 40%
  if (deviceId === WATCHGUARD_ID) {
    ports = ports.map(p => ({ ...p, size: 0.4 }));
  }
  
  modalPorts = ports;

  // Carrés d'aperçu positionnés en % sur la photo
  for (const p of ports) {
    const sq = document.createElement('div');
    sq.className = 'd-dq';
    sq.style.left = p.xPct + '%';
    sq.style.top  = p.yPct + '%';
    overlay.appendChild(sq);
  }
  $('#d-detect-count').textContent = ports.length
    ? `${ports.length} port${ports.length > 1 ? 's' : ''} détecté${ports.length > 1 ? 's' : ''} sur la photo`
    : 'Aucun port détecté — vous pourrez en placer manuellement (mode Étiquetage)';
  $('#d-ports-use').checked = ports.length > 0;
  $('#d-ports-use').disabled = ports.length === 0;
  detectBox.classList.remove('hidden');
}

$('#d-cancel').addEventListener('click', () => $('#device-modal').classList.add('hidden'));
$('#device-modal').addEventListener('click', e => {
  if (e.target === $('#device-modal')) $('#device-modal').classList.add('hidden');
});

$('#d-photo').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  modalPhoto = await readAndDownscale(file);
  const prev = $('#d-preview');
  const img = prev.querySelector('img');
  img.src = modalPhoto;
  // attendre le chargement pour caler le wrapper sur le ratio réel de la photo
  await new Promise(res => {
    if (img.complete && img.naturalWidth) return res();
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', res, { once: true });
  });
  const inner = $('#d-preview-inner');
  if (img.naturalWidth) {
    const maxW = prev.clientWidth || 300, maxH = 150;
    const ar = img.naturalWidth / img.naturalHeight;
    const h = Math.min(maxH, maxW / ar);
    inner.style.width = Math.round(h * ar) + 'px';
    inner.style.height = Math.round(h) + 'px';
  }
  prev.classList.remove('hidden');

  // --- Détection automatique des ports sur la photo ---
  await detectPortsFromPhoto(modalPhoto, editingDeviceId);
});

// Statut de garantie affiché sous la date dans la modale device
// (vert = en garantie, rouge = hors de garantie)
function updateWarrantyHint() {
  const el = $('#d-warranty-hint');
  if (!el) return;
  const w = warrantyInfo({ warrantyEnd: $('#d-warranty-end').value });
  if (w.status === 'none') {
    el.textContent = '';
    el.className = 'd-warranty-hint hidden';
    return;
  }
  el.textContent = `${WARRANTY_STATUS[w.status].ico} ${warrantyStatusLabel(w.status)} \u2014 fin le ${w.label} (${warrantyRelText(w)})`;
  el.className = 'd-warranty-hint w-' + w.status;
}
$('#d-warranty-end').addEventListener('input', updateWarrantyHint);

$('#d-save').addEventListener('click', () => {
  const name = $('#d-name').value.trim();
  if (!name) { $('#d-name').focus(); return; }
  const sizeU = parseInt($('#d-size').value, 10) || 1;
  const usePorts = $('#d-ports-use').checked && modalPorts.length > 0;
  const inv = {
    cat: normCat($('#d-cat').value),
    brand: $('#d-brand').value.trim().slice(0, 40),
    model: $('#d-model').value.trim().slice(0, 60),
    partRef: $('#d-ref').value.trim().slice(0, 60),
    serial: $('#d-serial').value.trim().slice(0, 60),
    ipMgmt: $('#d-ip').value.trim().slice(0, 45),
    vlan: $('#d-vlan').value.trim().slice(0, 60),
    warranty: $('#d-warranty').value.trim().slice(0, 60),
    warrantyEnd: isoToDate($('#d-warranty-end').value) ? $('#d-warranty-end').value : '',
    watts: Math.max(0, parseFloat(String($('#d-watts').value).replace(',', '.')) || 0),
    weightKg: Math.max(0, parseFloat(String($('#d-kg').value).replace(',', '.')) || 0)
  };

  pushHistory();

  if (editingDeviceId) {
    // Mode édition : mettre à jour le device existant
    const device = state.devices.find(d => d.id === editingDeviceId);
    if (device) {
      device.name = name;
      device.sizeU = sizeU;
      Object.assign(device, inv);
      if (modalPhoto !== null) {
        device.photo = modalPhoto;
      }
      if (usePorts) {
        device.ports = modalPorts.map((p, i) => ({
          id: uid(), xPct: p.xPct, yPct: p.yPct, name: String(i + 1), label: '', size: p.size || 1
        }));
      }
    }
  } else {
    // Mode création : ajouter un nouveau device.
    // Si la catégorie « Autre » est restée par défaut, on la devine depuis le nom.
    if (inv.cat === 'other') inv.cat = guessCatFromName(name) || 'other';
    state.devices.push({
      id: uid(), name, sizeU, photo: modalPhoto, ...inv,
      ports: usePorts ? modalPorts.map((p, i) => ({
        id: uid(), xPct: p.xPct, yPct: p.yPct, name: String(i + 1), label: '', size: p.size || 1
      })) : []
    });
  }

  saveState();
  renderPalette();
  $('#device-modal').classList.add('hidden');
  editingDeviceId = null;
});

// Lecture + redimensionnement de l'image (pour tenir en localStorage)
function readAndDownscale(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = 600;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ============================================================
   POPOVER D'INFOS DEVICE — au survol d'un device posé
   ------------------------------------------------------------
   Affiche une fiche (nom, taille, position, ports) à côté du
   device. Chaque valeur est modifiable en double-cliquant
   dessus (Entrée valide, Échap annule). Les changements de
   taille / d'étage vérifient les collisions dans le rack.
   ============================================================ */

let dpCtx = null;                 // { rackId, instId } du device affiché
let dpShowTimer = null;
let dpHideTimer = null;
let dpErrTimer = null;

function dpFind() {
  const ws = active();
  if (!ws || !dpCtx) return {};
  const rack = ws.racks.find(r => r.id === dpCtx.rackId);
  const inst = rack?.instances.find(i => i.id === dpCtx.instId);
  return { rack, inst };
}

function hideDevicePopover() {
  clearTimeout(dpShowTimer);
  clearTimeout(dpHideTimer);
  dpCtx = null;
  $('#device-popover').classList.add('hidden');
}

function dpPosition(devEl) {
  const pop = $('#device-popover');
  const r = devEl.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = r.right + 14, y = r.top;
  if (x + w > window.innerWidth - 10) x = r.left - w - 14;
  x = Math.max(8, x);
  if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
  y = Math.max(8, y);
  pop.style.left = x + 'px';
  pop.style.top  = y + 'px';
}

function dpSet(id, text) {
  const el = $(id);
  if (el.dataset.editing === '1') return;      // ne pas écraser un champ en édition
  el.textContent = text;
}

function fillDevicePopover() {
  const { rack, inst } = dpFind();
  if (!rack || !inst) { hideDevicePopover(); return; }
  const titleEl = $('#dp-title');
  titleEl.textContent = inst.name;
  titleEl.title = inst.name;                 // nom complet (le texte peut être tronqué)
  // Badge de garantie affiché À CÔTÉ DU NOM : vert si l'équipement est encore
  // sous garantie, rouge s'il en est sorti (gris neutre si la date n'est pas
  // saisie). L'infobulle donne la date, le contrat et l'échéance en jours.
  const wBadge = $('#dp-warranty-badge');
  if (wBadge) {
    const wi = warrantyInfo(inst);
    wBadge.className = 'dp-warranty ' + wi.status;
    wBadge.textContent = wi.status === 'none'
      ? 'Non renseignée'
      : `${WARRANTY_STATUS[wi.status].ico} ${warrantyStatusLabel(wi.status)}`;
    wBadge.title = warrantyBadgeTitle(inst);
  }
  $('#dp-sub').textContent = `${rack.name} · U${inst.slot + 1}${inst.sizeU > 1 ? '–U' + (inst.slot + inst.sizeU) : ''}`;
  $('#dp-thumb').innerHTML = instPhoto(inst)
    ? `<img src="${instPhoto(inst)}" alt="">`
    : '<span>▤</span>';
  dpSet('#dp-name', inst.name);
  dpSet('#dp-size', inst.sizeU + 'U');
  dpSet('#dp-slot', 'U' + (inst.slot + 1));
  dpSet('#dp-cat', `${catIcon(inst.cat)} ${catLabel(inst.cat)}`);
  // Zone de switching : uniquement pour les switchs et bornes WiFi
  const isSwCat = ['switch', 'ap'].includes(normCat(inst.cat));
  const zoneRow = $('#dp-zone-row');
  if (zoneRow) zoneRow.style.display = isSwCat ? '' : 'none';
  dpSet('#dp-zone', isSwCat ? (zoneNameOf(active(), inst) || '—') : '—');
  dpSet('#dp-brand', inst.brand || '—');
  dpSet('#dp-model', inst.model || '—');
  dpSet('#dp-ref', inst.partRef || '—');
  dpSet('#dp-serial', inst.serial || '—');
  dpSet('#dp-ip', inst.ipMgmt || '—');
  dpSet('#dp-vlan', inst.vlan || '—');
  // Garantie : date de fin (colorée : vert en garantie, rouge hors garantie)
  // + libellé de contrat. Le statut est aussi rappelé par le badge du titre.
  const wi = warrantyInfo(inst);
  const wEndEl = $('#dp-warranty-end');
  if (wEndEl) {
    wEndEl.className = 'dp-val editable w-' + wi.status;
    wEndEl.title = warrantyBadgeTitle(inst);
  }
  dpSet('#dp-warranty-end', warrantyWhenText(inst));
  dpSet('#dp-warranty', inst.warranty || '—');
  dpSet('#dp-watts', inst.watts ? fmtWatts(inst.watts) : '—');
  dpSet('#dp-kg', inst.weightKg ? String(inst.weightKg).replace('.', ',') + ' kg' : '—');
  dpSet('#dp-ports', String((inst.ports || []).length));
  $('#dp-err').classList.add('hidden');
}

function dpReshow(instId) {
  const el = board.querySelector(`.device[data-instance-id="${instId}"]`);
  if (el) {
    fillDevicePopover();
    $('#device-popover').classList.remove('hidden');
    dpPosition(el);
  } else hideDevicePopover();
}

function showDevicePopover(devEl) {
  const rackEl = devEl.closest('.rack');
  const ws = active();
  const rack = ws?.racks.find(r => r.id === rackEl?.dataset.rackId);
  const inst = rack?.instances.find(i => i.id === devEl.dataset.instanceId);
  if (!rack || !inst) return;
  dpCtx = { rackId: rack.id, instId: inst.id };
  fillDevicePopover();
  $('#device-popover').classList.remove('hidden');
  dpPosition(devEl);
}

function dpError(msg) {
  const err = $('#dp-err');
  err.textContent = msg;
  err.classList.remove('hidden');
  clearTimeout(dpErrTimer);
  dpErrTimer = setTimeout(() => err.classList.add('hidden'), 2600);
}

// Survol du board : montrer la fiche après un petit délai (mode normal uniquement)
board.addEventListener('mouseover', e => {
  if (labelMode || cablingMode) return;
  const devEl = e.target.closest('.device');
  if (!devEl || e.target.closest('.port')) return;   // priorité à l'infobulle port
  clearTimeout(dpHideTimer);
  clearTimeout(dpShowTimer);
  dpShowTimer = setTimeout(() => showDevicePopover(devEl), 300);
});

board.addEventListener('mouseout', e => {
  const devEl = e.target.closest('.device');
  if (!devEl) return;
  const pop = $('#device-popover');
  if (e.relatedTarget && pop.contains(e.relatedTarget)) return;  // on va sur la fiche
  clearTimeout(dpShowTimer);
  clearTimeout(dpHideTimer);
  dpHideTimer = setTimeout(hideDevicePopover, 220);
});

$('#device-popover').addEventListener('mouseenter', () => clearTimeout(dpHideTimer));
$('#device-popover').addEventListener('mouseleave', () => {
  clearTimeout(dpHideTimer);
  dpHideTimer = setTimeout(hideDevicePopover, 160);
});

// La fiche reste au-dessus des clics du board
$('#device-popover').addEventListener('pointerdown', e => e.stopPropagation());

// ---------- Édition en double-clic ----------
function dpEditSpan(sel, makeInput, commit) {
  $(sel).addEventListener('dblclick', e => {
    e.stopPropagation();
    e.preventDefault();
    const span = e.currentTarget;
    if (span.dataset.editing === '1') return;
    const { inst } = dpFind();
    if (!inst) return;
    const input = makeInput(inst);
    input.className = 'dp-input';
    span.dataset.editing = '1';
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    // input.select() n'est pas supporté par tous les types (ex. champ date)
    try { if (input.select) input.select(); } catch (err) { /* sélection non supportée */ }
    let closed = false;
    const close = ok => {
      if (closed) return;
      closed = true;
      delete span.dataset.editing;
      if (ok) commit(input.value);
      else fillDevicePopover();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') close(true);
      else if (ev.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(true));
  });
}

// Slot libre le plus proche (pour un changement de taille)
function dpNearestFreeSlot(rack, prefer, size, excludeId) {
  const max = rack.sizeU - size;
  if (max < 0) return -1;
  for (let d = 0; d <= rack.sizeU; d++) {
    for (const s of (d === 0 ? [prefer] : [prefer + d, prefer - d])) {
      if (s >= 0 && s <= max && isSlotFree(rack, s, size, excludeId)) return s;
    }
  }
  return -1;
}

function dpAfterChange(inst) {
  const rackId = dpCtx?.rackId;      // renderBoard() remet dpCtx à null
  saveState();
  renderBoard();
  dpCtx = { rackId, instId: inst.id };
  dpReshow(inst.id);
}

dpEditSpan('#dp-name', inst => {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = inst.name;
  i.maxLength = 60;
  return i;
}, val => {
  const { inst } = dpFind();
  if (!inst) return;
  const name = String(val).trim().slice(0, 60);
  if (!name || name === inst.name) { fillDevicePopover(); return; }
  pushHistory();
  inst.name = name;
  dpAfterChange(inst);
});

dpEditSpan('#dp-size', inst => {
  const s = document.createElement('select');
  for (const u of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    const o = document.createElement('option');
    o.value = String(u);
    o.textContent = u + 'U';
    if (u === inst.sizeU) o.selected = true;
    s.appendChild(o);
  }
  return s;
}, val => {
  const { rack, inst } = dpFind();
  if (!rack || !inst) return;
  const sizeU = Math.max(1, Math.min(12, parseInt(val, 10) || inst.sizeU));
  if (sizeU === inst.sizeU) { fillDevicePopover(); return; }
  const slot = dpNearestFreeSlot(rack, inst.slot, sizeU, inst.id);
  if (slot < 0) { fillDevicePopover(); dpError(`Pas assez de place pour ${sizeU}U`); return; }
  pushHistory();
  inst.sizeU = sizeU;
  inst.slot = slot;
  dpAfterChange(inst);
});

dpEditSpan('#dp-slot', inst => {
  const { rack } = dpFind();
  const i = document.createElement('input');
  i.type = 'number';
  i.min = '1';
  i.max = String(Math.max(1, (rack?.sizeU || 12) - inst.sizeU + 1));
  i.value = String(inst.slot + 1);
  return i;
}, val => {
  const { rack, inst } = dpFind();
  if (!rack || !inst) return;
  const u = parseInt(val, 10);
  const maxSlot = rack.sizeU - inst.sizeU;
  if (!Number.isFinite(u)) { fillDevicePopover(); return; }
  const slot = Math.max(0, Math.min(u - 1, maxSlot));
  if (slot === inst.slot) { fillDevicePopover(); return; }
  if (!isSlotFree(rack, slot, inst.sizeU, inst.id)) {
    fillDevicePopover();
    dpError(`U${slot + 1} est occupée`);
    return;
  }
  pushHistory();
  inst.slot = slot;
  dpAfterChange(inst);
});

// La fiche suit les changements de vue : on la masque dès que le board bouge
document.addEventListener('wheel', () => hideDevicePopover(), { passive: true });

// ---------- Champs d'inventaire (texte) : édition générique ----------
function dpTextField(sel, field, maxLen) {
  dpEditSpan(sel, inst => {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = inst[field] || '';
    i.maxLength = maxLen;
    return i;
  }, val => {
    const { inst } = dpFind();
    if (!inst) return;
    const v = String(val).trim().slice(0, maxLen);
    if (v === (inst[field] || '')) { fillDevicePopover(); return; }
    pushHistory();
    inst[field] = v;
    dpAfterChange(inst);
  });
}
// Catégorie : édition par liste déroulante
dpEditSpan('#dp-cat', inst => {
  const s = document.createElement('select');
  DEV_CATEGORIES.forEach(([id, ico, lbl]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${ico} ${lbl}`;
    if (id === normCat(inst.cat)) o.selected = true;
    s.appendChild(o);
  });
  return s;
}, val => {
  const { inst } = dpFind();
  if (!inst) return;
  const cat = normCat(val);
  if (cat === normCat(inst.cat)) { fillDevicePopover(); return; }
  pushHistory();
  inst.cat = cat;
  dpAfterChange(inst);
});

// Zone de switching (switch / AP) : édition par liste déroulante
dpEditSpan('#dp-zone', inst => {
  const s = document.createElement('select');
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = '— hors zone —';
  s.appendChild(o0);
  (normLldInfo(active()).swZones || []).forEach(z => {
    const o = document.createElement('option');
    o.value = z.id;
    o.textContent = z.name;
    if (z.id === (inst.zone || '')) o.selected = true;
    s.appendChild(o);
  });
  return s;
}, val => {
  const { inst } = dpFind();
  if (!inst) return;
  const zone = String(val || '');
  if (zone === (inst.zone || '')) { fillDevicePopover(); return; }
  pushHistory();
  inst.zone = zone;
  dpAfterChange(inst);
});

dpTextField('#dp-brand', 'brand', 40);
dpTextField('#dp-model', 'model', 60);
dpTextField('#dp-ref', 'partRef', 60);
dpTextField('#dp-serial', 'serial', 60);
dpTextField('#dp-ip', 'ipMgmt', 45);
dpTextField('#dp-vlan', 'vlan', 60);
dpTextField('#dp-warranty', 'warranty', 60);

// Fin de garantie : édition par sélecteur de date (valeur ISO stockée)
dpEditSpan('#dp-warranty-end', inst => {
  const i = document.createElement('input');
  i.type = 'date';
  i.value = inst.warrantyEnd || '';
  return i;
}, val => {
  const { inst } = dpFind();
  if (!inst) return;
  const iso = isoToDate(val) ? val : '';
  if (iso === (inst.warrantyEnd || '')) { fillDevicePopover(); return; }
  pushHistory();
  inst.warrantyEnd = iso;
  dpAfterChange(inst);
});

// ---------- Puissance / poids (nombres) ----------
function dpNumField(sel, field, step) {
  dpEditSpan(sel, inst => {
    const i = document.createElement('input');
    i.type = 'number';
    i.min = '0';
    i.step = step;
    i.value = String(inst[field] || '');
    return i;
  }, val => {
    const { inst } = dpFind();
    if (!inst) return;
    const n = Math.max(0, parseFloat(String(val).replace(',', '.')) || 0);
    if (n === (inst[field] || 0)) { fillDevicePopover(); return; }
    pushHistory();
    inst[field] = n;
    dpAfterChange(inst);
  });
}
dpNumField('#dp-watts', 'watts', '1');
dpNumField('#dp-kg', 'weightKg', '0.1');

/* ============================================================
   DIVERS
   ============================================================ */

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (pendingPort) { pendingPort = null; renderCables(); return; }
    hidePortPopover();
    hideCablePopoverSafe();
    hideDevicePopover();
    $('#device-modal').classList.add('hidden');
    $('#lld-modal').classList.add('hidden');
  }
  // Ctrl+Z / Ctrl+Y : annuler / rétablir les éditions de la modale 📘
  // (les inputs de renommage et les dialogs stopPropagation eux-mêmes :
  //  l'annulation native du champ reste gérée par le navigateur là-bas)
  const lldModal = $('#lld-modal');
  if (lldDraft && lldModal && !lldModal.classList.contains('hidden')
      && (e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = String(e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); lldUndo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); lldRedo(); }
  }
});
/* ============================================================
   ECRAN D'ACCUEIL — lanceur de workspaces
   - Au démarrage : écran d'accueil avec bouton "Créer un workspace"
     et l'historique des workspaces (triés par date de modification)
   - Le board de chaque workspace est indépendant ; la bibliothèque
     de devices reste partagée
   ============================================================ */

const homeScreen = $('#home-screen');

function showHome() {
  renderHomeList();
  homeScreen.classList.remove('hidden');
}

function hideHome() {
  homeScreen.classList.add('hidden');
}

/* ---- Boîtes de dialogue maison (remplacent alert/confirm/prompt natifs) ----
   Même langue visuelle que le reste du site : carte blanche, boutons bleus /
   rouges, fond assombri. Renvoie une Promesse : true/false (confirm),
   la saisie ou null (prompt). */
function lldDialog(opts) {
  const o = Object.assign({ title: '', message: '', input: null, okLabel: 'OK', cancelLabel: 'Annuler', danger: false }, opts);
  return new Promise(resolve => {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ov = document.createElement('div');
    ov.className = 'lld-dlg-overlay';
    ov.innerHTML = `
      <div class="lld-dlg" role="dialog" aria-modal="true">
        ${o.title ? `<h3>${esc(o.title)}</h3>` : ''}
        ${o.message ? `<p class="lld-dlg-msg">${esc(o.message).replace(/\n/g, '<br>')}</p>` : ''}
        ${o.input !== null ? `<input class="lld-dlg-input" type="text" spellcheck="false" value="${esc(o.input)}">` : ''}
        <div class="lld-dlg-btns">
          <button class="btn lld-dlg-cancel${o.hideCancel ? ' hidden' : ''}" type="button">${esc(o.cancelLabel)}</button>
          <button class="btn ${o.danger ? 'lld-dlg-danger' : 'lld-dlg-ok'}" type="button">${esc(o.okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('.lld-dlg-input');
    const okBtn = ov.querySelector('.lld-dlg-btns .btn:last-child');
    let closed = false;
    const done = val => { if (closed) return; closed = true; ov.remove(); resolve(val); };
    ov.querySelector('.lld-dlg-cancel').addEventListener('click', () => done(o.input !== null ? null : false));
    okBtn.addEventListener('click', () => done(o.input !== null ? inp.value : true));
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(o.input !== null ? null : false); });
    ov.addEventListener('keydown', e => {
      e.stopPropagation();   // Échap/Entrée gérés par le dialog SEUL (ne pas fermer la modale 📘 dessous)
      if (e.key === 'Escape') done(o.input !== null ? null : false);
      if (e.key === 'Enter' && inp) done(inp.value);
    });
    (inp || okBtn).focus();
    if (inp) inp.select();
  });
}
const lldConfirm = (message, opts) => lldDialog(Object.assign({ message, okLabel: 'Confirmer', cancelLabel: 'Annuler', danger: true }, opts));
const lldPrompt  = (message, value, opts) => lldDialog(Object.assign({ message, input: value ?? '', okLabel: 'Créer' }, opts));
const lldAlert   = (message, opts) => lldDialog(Object.assign({ message, okLabel: 'OK', cancelLabel: 'OK', hideCancel: true }, opts));

/* ---- Sélecteur de rubriques d'export ----
   items = [[clé, libellé], …] affichés en cases à cocher (toutes cochées par
   défaut, case « Tout sélectionner » en tête). Résout :
     • un Set des clés cochées  → Exporter
     • null → Annuler / Échap / clic dehors. */
function lldPickSections({ title, items, hint = '' }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'lld-dlg-overlay';
    ov.innerHTML = `
      <div class="lld-dlg lld-pick" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        ${hint ? `<p class="lld-dlg-msg">${escapeHtml(hint)}</p>` : ''}
        <label class="lld-pick-all"><input type="checkbox" checked> <b>Tout sélectionner</b>
          <span class="lld-pick-count">${items.length}/${items.length}</span></label>
        <div class="lld-pick-list">
          ${items.map(([k, lbl]) => `
            <label class="lld-pick-item"><input type="checkbox" value="${escapeHtml(k)}" checked>
              <span>${escapeHtml(lbl)}</span></label>`).join('')}
        </div>
        <div class="lld-dlg-btns">
          <button class="btn lld-dlg-cancel" type="button">Annuler</button>
          <button class="btn lld-dlg-ok" type="button">⬇ Exporter</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const all = ov.querySelector('.lld-pick-all input');
    const boxes = [...ov.querySelectorAll('.lld-pick-item input')];
    const cnt = ov.querySelector('.lld-pick-count');
    const sync = () => {
      const n = boxes.filter(b => b.checked).length;
      cnt.textContent = `${n}/${boxes.length}`;
      all.checked = n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
    };
    all.addEventListener('change', () => {
      boxes.forEach(b => { b.checked = all.checked; });
      sync();
    });
    boxes.forEach(b => b.addEventListener('change', sync));
    let closed = false;
    const done = val => { if (closed) return; closed = true; ov.remove(); resolve(val); };
    ov.querySelector('.lld-dlg-cancel').addEventListener('click', () => done(null));
    ov.querySelector('.lld-dlg-ok').addEventListener('click', () => {
      const sel = new Set(boxes.filter(b => b.checked).map(b => b.value));
      done(sel);
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
    ov.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') ov.querySelector('.lld-dlg-ok').click();
    });
    ov.querySelector('.lld-dlg-ok').focus();
  });
}

function formatDate(ts) {
  if (!ts) return 'Jamais modifié';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Aujourd'hui à ${heure}`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + heure;
}

function renderHomeList() {
  const list = $('#home-list');
  const count = $('#home-count');
  list.innerHTML = '';
  count.textContent = state.workspaces.length || '';

  if (!state.workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'home-empty';
    empty.textContent = 'Aucun workspace pour le moment. Créez-en un pour commencer.';
    list.appendChild(empty);
    return;
  }

  // Tri : plus récemment modifié d'abord
  const sorted = [...state.workspaces].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  sorted.forEach(w => {
    const nbRacks = w.racks.length;
    const nbDevices = w.racks.reduce((n, r) => n + r.instances.length, 0);

    const card = document.createElement('button');
    card.className = 'ws-card';
    card.innerHTML = `
      <span class="wc-ico">🗄️</span>
      <span class="wc-info">
        <span class="wc-name"></span>
        <span class="wc-meta">
          ${nbRacks} rack${nbRacks > 1 ? 's' : ''}<span class="wc-dot">·</span>${nbDevices} device${nbDevices > 1 ? 's' : ''} placé${nbDevices > 1 ? 's' : ''}
          <span class="wc-dot">·</span>${formatDate(w.updatedAt)}
        </span>
      </span>
      <span class="wc-del" title="Supprimer ce workspace">🗑</span>`;
    card.querySelector('.wc-name').textContent = w.name;

    card.addEventListener('click', () => openWorkspace(w.id));

    card.querySelector('.wc-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteWorkspace(w.id);
    });

    list.appendChild(card);
  });
}

function openWorkspace(id) {
  const ws = state.workspaces.find(w => w.id === id);
  if (!ws) return;
  state.activeWorkspaceId = ws.id;
  saveState();
  pendingPort = null;
  siteFilter = 'all';
  topoFlowFilter = '';
  hideCablePopoverSafe();

  hidePortPopover();
  // Désactive les modes Créer/Modifier en changeant de workspace
  if (labelMode) setLabelMode(null);

  hideHome();
  renderBoard();
  renderSiteFilter();   // options du filtre = sites du workspace ouvert
  applyWorkspaceView();

  // Le viewport peut finir son recalcul de taille après la fermeture de
  // l'accueil. Un second cadrage garantit que les nouveaux boards vides
  // démarrent bien au centre, quelle que soit la taille de la fenêtre.
  const openedWorkspaceId = ws.id;
  requestAnimationFrame(() => {
    const current = active();
    if (current?.id === openedWorkspaceId && !current.viewTouched) {
      fitViewToContent();
    }
  });
}

async function createWorkspace() {
  const name = await lldPrompt('Nom du nouveau workspace :', 'Workspace ' + (state.workspaces.length + 1),
    { title: '🏢 Nouveau workspace', okLabel: 'Créer' });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  pushHistory();
  const ws = makeWorkspace(trimmed);
  state.workspaces.push(ws);
  saveState();
  openWorkspace(ws.id);
}

async function deleteWorkspace(id) {
  const ws = state.workspaces.find(w => w.id === id);
  if (!ws) return;
  const nbDevices = ws.racks.reduce((n, r) => n + r.instances.length, 0);
  const ok = await lldConfirm(
    `Supprimer définitivement le workspace « ${ws.name} » ?\n\n` +
    `Il contient ${ws.racks.length} rack(s) et ${nbDevices} device(s) placé(s).\n\n` +
    `La bibliothèque de devices (partagée) est conservée. Cette action est annulable avec Ctrl+Z.`,
    { title: '🗑 Supprimer le workspace', okLabel: 'Supprimer' });
  if (!ok) return;

  pushHistory();
  state.workspaces = state.workspaces.filter(w => w.id !== id);
  // Démo embarquée supprimée : on note l'intention pour ne pas la recharger
  // automatiquement au prochain démarrage (Ctrl+Z annule, bouton 🎬 pour la rouvrir).
  if (ws.bundled && !state.workspaces.length) state.demoDismissed = true;
  if (state.activeWorkspaceId === id) {
    state.activeWorkspaceId = state.workspaces[0]?.id ?? null;
  }
  saveState();

  if (homeScreen.classList.contains('hidden')) {
    // On était dans ce workspace : retour à l'accueil
    showHome();
  } else {
    renderHomeList();
  }
}

// Créer et gérer les workspaces se fait depuis l'écran d'accueil.
$('#home-new').addEventListener('click', createWorkspace);
// Récupérer la démonstration à tout moment (hébergement statique).
$('#home-demo').addEventListener('click', loadDemoWorkspace);
// Le logo et le nom de l'application servent de retour vers les workspaces.
$('#btn-workspaces').addEventListener('click', showHome);

/* ============================================================
   MODE CÂBLAGE — relier des ports entre eux par des cordons
   ============================================================ */

const CABLE_COLORS = [
  { name: 'Rouge',    hex: '#e11d48' },
  { name: 'Bleu',     hex: '#2563eb' },
  { name: 'Jaune',    hex: '#eab308' },
  { name: 'Vert',     hex: '#16a34a' },
  { name: 'Orange',   hex: '#ea580c' },
  { name: 'Violet',   hex: '#9333ea' },
  { name: 'Gris',     hex: '#6b7280' },
  { name: 'Noir',     hex: '#1f2937' }
];

let cablingMode = false;
let pendingPort = null;   // 1er port sélectionné en attente du 2e
let cablePopoverCtx = null;
let selectedCableColor = CABLE_COLORS[0].hex;
let cableFilterDevice = '';
let cableFilterColor = 'all';
// Mise au premier plan temporaire et non destructive. Dès qu'au moins un câble
// est sélectionné, les autres restent visibles mais deviennent « fantômes ».
const focusedCableIds = new Set();
let cableSingleClickTimer = null;

function toggleCableFocus(cableId) {
  if (focusedCableIds.has(cableId)) focusedCableIds.delete(cableId);
  else focusedCableIds.add(cableId);
  hideCablePopover();
  renderCables();
  renderCableList();
}

function cableMatchesFilter(ws, cable) {
  if (cableFilterColor !== 'all' && cable.color !== cableFilterColor) return false;
  const q = cableFilterDevice.trim().toLocaleLowerCase('fr');
  if (!q) return true;
  const ea = resolveEndpoint(ws, cable.a);
  const eb = resolveEndpoint(ws, cable.b);
  return !!(ea && eb && (`${ea.inst.name} ${eb.inst.name}`).toLocaleLowerCase('fr').includes(q));
}

function cableSvg() { return $('#cable-svg'); }

// Retrouve la position (en coordonnées board) d'un port.
// On utilise la position réelle à l'écran de l'élément .port, convertie
// en coordonnées board : exact quel que soit le zoom ou l'emplacement.
function portBoardPosition(ws, rack, inst, port) {
  const rackEl = board.querySelector(`.rack[data-rack-id="${rack.id}"]`);
  const devEl = rackEl?.querySelector(`.device[data-instance-id="${inst.id}"]`);
  const portEl = devEl?.querySelector(`.port[data-port-id="${port.id}"]`);
  if (!portEl) return null;

  const p = portEl.getBoundingClientRect();   // centre visuel du carré port
  const b = board.getBoundingClientRect();    // origine (0,0) du board à l'écran
  return {
    x: (p.left + p.width  / 2 - b.left) / view.scale,
    y: (p.top  + p.height / 2 - b.top)  / view.scale
  };
}

// Résout un endpoint {rackId, instId, portId}
function resolveEndpoint(ws, ep) {
  if (!ep) return null;
  const rack = ws.racks.find(r => r.id === ep.rackId);
  const inst = rack?.instances.find(i => i.id === ep.instId);
  const port = inst?.ports.find(p => p.id === ep.portId);
  if (!rack || !inst || !port) return null;
  return { rack, inst, port };
}

// Supprime les câbles dont un port a disparu
function pruneCables(ws) {
  if (!ws) return;
  ws.cables = ws.cables.filter(c => resolveEndpoint(ws, c.a) && resolveEndpoint(ws, c.b));
}

// Tracé d'un cordon souple. Le milieu peut être déplacé par l'utilisateur ;
// sans réglage, le câble pend naturellement selon sa longueur et son dénivelé.
function cablePath(p1, p2, cable = null) {
  const dx = Math.abs(p2.x - p1.x);
  const sag = Math.min(150, Math.max(18, dx * 0.22 + Math.abs(p2.y - p1.y) * 0.2));
  const control = {
    x: (p1.x + p2.x) / 2 + (cable?.bendX || 0),
    y: (p1.y + p2.y) / 2 + sag + (cable?.bendY || 0)
  };
  // Conversion d'une courbe quadratique (un point manipulable) en Bézier cubique.
  const c1 = { x: p1.x + (control.x - p1.x) * 2 / 3, y: p1.y + (control.y - p1.y) * 2 / 3 };
  const c2 = { x: p2.x + (control.x - p2.x) * 2 / 3, y: p2.y + (control.y - p2.y) * 2 / 3 };
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    mid: control
  };
}

function renderCables() {
  const svg = cableSvg();
  if (!svg) return;
  // Conserver uniquement le tracé temporaire
  const temp = svg.querySelector('.cable-temp');
  [...svg.querySelectorAll('g.cable')].forEach(g => g.remove());
  if (temp) temp.style.display = 'none';

  if (!cablingMode) return;
  const ws = active();
  if (!ws) return;
  pruneCables(ws);

  const svgNS = 'http://www.w3.org/2000/svg';

  // Survol délégué au SVG : contrairement à pointerenter sur chaque groupe,
  // déplacer le groupe en fin de SVG ne laisse pas une classe « hovered »
  // bloquée lorsque le pointeur quitte ensuite le câble.
  let hoveredCable = null;
  const clearCableHover = () => {
    hoveredCable?.classList.remove('hovered');
    hoveredCable = null;
    svg.classList.remove('cable-hovering');
  };
  svg.onpointermove = e => {
    const g = e.target.closest?.('g.cable') || null;
    if (g === hoveredCable) return;
    clearCableHover();
    if (!g) return;
    hoveredCable = g;
    g.classList.add('hovered');
    svg.classList.add('cable-hovering');
    // Dernier élément SVG = peint au-dessus des autres câbles.
    svg.appendChild(g);
  };
  svg.onpointerout = e => {
    const next = e.relatedTarget?.closest?.('g.cable') || null;
    if (!next) clearCableHover();
  };
  svg.onpointerleave = clearCableHover;

  const existingCableIds = new Set(ws.cables.map(c => c.id));
  [...focusedCableIds].forEach(id => { if (!existingCableIds.has(id)) focusedCableIds.delete(id); });
  const hasCableFocus = focusedCableIds.size > 0;
  ws.cables.forEach(cable => {
    if (!cableMatchesFilter(ws, cable)) return;
    const ea = resolveEndpoint(ws, cable.a);
    const eb = resolveEndpoint(ws, cable.b);
    if (!ea || !eb) return;
    const p1 = portBoardPosition(ws, ea.rack, ea.inst, ea.port);
    const p2 = portBoardPosition(ws, eb.rack, eb.inst, eb.port);
    if (!p1 || !p2) return;
    const { d } = cablePath(p1, p2, cable);

    const g = document.createElementNS(svgNS, 'g');
    g.classList.add('cable');
    if (hasCableFocus) g.classList.add(focusedCableIds.has(cable.id) ? 'focused' : 'phantom');
    g.dataset.cableId = cable.id;
    g.style.setProperty('--cable-color', cable.color);

    const shadow = document.createElementNS(svgNS, 'path');
    shadow.setAttribute('class', 'cable-shadow');
    shadow.setAttribute('d', d);
    shadow.setAttribute('transform', 'translate(2,3)');

    const jacket = document.createElementNS(svgNS, 'path');
    jacket.setAttribute('class', 'cable-jacket');
    jacket.setAttribute('d', d);

    const hit = document.createElementNS(svgNS, 'path');
    hit.setAttribute('class', 'cable-hit');
    hit.setAttribute('d', d);

    [p1, p2].forEach(p => {
      const cap = document.createElementNS(svgNS, 'circle');
      cap.setAttribute('class', 'cable-cap');
      cap.setAttribute('cx', p.x);
      cap.setAttribute('cy', p.y);
      cap.setAttribute('r', 3.4);
      g.appendChild(cap);
    });

    g.appendChild(shadow);
    g.appendChild(jacket);
    g.appendChild(hit);
    hit.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      hit.setPointerCapture(e.pointerId);
      const start = clientToBoard(e.clientX, e.clientY);
      const bx = cable.bendX || 0, by = cable.bendY || 0;
      let moved = false;

      const move = ev => {
        const p = clientToBoard(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4 / view.scale) return;
        if (!moved) { pushHistory(); moved = true; g.classList.add('dragging'); }
        cable.bendX = bx + p.x - start.x;
        cable.bendY = by + p.y - start.y;
        const liveD = cablePath(p1, p2, cable).d;
        shadow.setAttribute('d', liveD);
        jacket.setAttribute('d', liveD);
        hit.setAttribute('d', liveD);
      };
      const up = ev => {
        hit.removeEventListener('pointermove', move);
        hit.removeEventListener('pointerup', up);
        hit.removeEventListener('pointercancel', up);
        g.classList.remove('dragging');
        if (moved) {
          touchWorkspace(ws);
          saveState();
          renderCableList();
        } else {
          // Attendre brièvement pour distinguer le clic simple du double-clic :
          // simple = édition, double = mise au premier plan sans ouvrir la pop-up.
          clearTimeout(cableSingleClickTimer);
          cableSingleClickTimer = setTimeout(() => {
            openCablePopover(cable, ev.clientX, ev.clientY);
            cableSingleClickTimer = null;
          }, 260);
        }
      };
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerup', up);
      hit.addEventListener('pointercancel', up);
    });
    hit.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(cableSingleClickTimer);
      cableSingleClickTimer = null;
      toggleCableFocus(cable.id);
    });
    svg.appendChild(g);
  });
}

function drawTempCable(p1, p2) {
  const svg = cableSvg();
  const temp = svg?.querySelector('.cable-temp');
  if (!temp || !p1 || !p2) { if (temp) temp.style.display = 'none'; return; }
  temp.style.display = '';
  temp.setAttribute('d', cablePath(p1, p2).d);
}

// Port cliqué depuis le handler global (app.js)
function handlePortClickCabling(clientX, clientY, rack, inst, port) {
  if (!cablingMode) return false;

  if (!pendingPort) {
    pendingPort = { rack, inst, port, x: clientX, y: clientY };
    flashPortElement(rack.id, inst.id, port.id, '#2563eb');
    return true;
  }

  // Même port = annulation
  if (pendingPort.port.id === port.id) {
    pendingPort = null;
    renderCables();
    return true;
  }

  // Créer le câble
  const ws = active();
  const existing = ws.cables.find(c =>
    (c.a.portId === pendingPort.port.id && c.b.portId === port.id) ||
    (c.b.portId === pendingPort.port.id && c.a.portId === port.id));
  if (existing) {
    pendingPort = null;
    renderCables();
    renderCableList();
    openCablePopover(existing, clientX, clientY);
    return true;
  }

  const cable = {
    id: uid(),
    name: nextCableId(ws),
    color: selectedCableColor,
    domain: '',
    a: { rackId: pendingPort.rack.id, instId: pendingPort.inst.id, portId: pendingPort.port.id },
    b: { rackId: rack.id, instId: inst.id, portId: port.id }
  };

  pushHistory();
  ws.cables.push(cable);
  touchWorkspace(ws);
  pendingPort = null;
  saveState();
  renderCables();
  renderCableList();
  // Proposer l'édition du câble qui vient d'être créé
  openCablePopover(cable, clientX, clientY, true);
  return true;
}

function nextCableId(ws) {
  const n = ws.cables.length + 1;
  let id = 'CAB-' + String(n).padStart(3, '0');
  let i = n;
  while (ws.cables.some(c => c.name === id)) {
    i++;
    id = 'CAB-' + String(i).padStart(3, '0');
  }
  return id;
}

function flashPortElement(rackId, instId, portId, color) {
  const rackEl = board.querySelector(`.rack[data-rack-id="${rackId}"]`);
  const portEl = rackEl?.querySelector(`.device[data-instance-id="${instId}"] .port[data-port-id="${portId}"]`);
  if (!portEl) return;
  portEl.style.filter = `drop-shadow(0 1px 2px rgba(0,0,0,.55)) drop-shadow(0 0 8px ${color})`;
  setTimeout(() => { portEl.style.filter = ''; }, 1200);
}

// Suivi de la souris pour le câble temporaire
viewport.addEventListener('mousemove', e => {
  if (!cablingMode || !pendingPort) return;
  const ws = active();
  const p1 = portBoardPosition(ws, pendingPort.rack, pendingPort.inst, pendingPort.port);
  if (!p1) return;
  const p2 = clientToBoard(e.clientX, e.clientY);
  drawTempCable(p1, p2);
});

/* ---------- Popover câble ---------- */
function openCablePopover(cable, clientX, clientY, isNew = false) {
  hidePortPopover();
  const pop = $('#cable-popover');
  cablePopoverCtx = { cable, isNew };

  $('#cl-title').textContent = isNew ? 'Nouveau câble' : 'Câble';
  $('#c-name').value = cable.name || '';
  $('#c-domain').value = cable.domain || '';
  selectedCableColor = cable.color || CABLE_COLORS[0].hex;

  const colorsEl = $('#c-colors');
  colorsEl.innerHTML = '';
  CABLE_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'color-swatch' + (c.hex === selectedCableColor ? ' selected' : '');
    b.style.background = c.hex;
    b.title = c.name;
    b.addEventListener('click', () => {
      selectedCableColor = c.hex;
      colorsEl.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    colorsEl.appendChild(b);
  });

  $('#c-delete').classList.toggle('hidden', isNew);
  pop.classList.remove('hidden');

  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = clientX + 14, y = clientY + 14;
  if (x + w > window.innerWidth - 10)  x = clientX - w - 14;
  if (y + h > window.innerHeight - 10) y = clientY - h - 14;
  pop.style.left = Math.max(8, x) + 'px';
  pop.style.top  = Math.max(8, y) + 'px';
  $('#c-name').focus();
}

function hideCablePopover() {
  $('#cable-popover').classList.add('hidden');
  cablePopoverCtx = null;
}

$('#c-save').addEventListener('click', () => {
  if (!cablePopoverCtx) return;
  const { cable, isNew } = cablePopoverCtx;
  const name = $('#c-name').value.trim() || cable.name;
  if (isNew) {
    // déjà enregistré à la création ; on met juste à jour
  }
  pushHistory();
  cable.name = name;
  cable.color = selectedCableColor;
  cable.domain = $('#c-domain').value;
  hideCablePopover();
  touchWorkspace(active());
  saveState();
  renderCables();
  renderCableList();
});

$('#c-delete').addEventListener('click', () => {
  if (!cablePopoverCtx) return;
  const { cable } = cablePopoverCtx;
  const ws = active();
  pushHistory();
  ws.cables = ws.cables.filter(c => c.id !== cable.id);
  hideCablePopover();
  touchWorkspace(ws);
  saveState();
  renderCables();
  renderCableList();
});

$('#c-cancel').addEventListener('click', () => {
  // Si c'était un câble fraîchement créé et qu'on annule, on le retire
  if (cablePopoverCtx?.isNew) {
    const { cable } = cablePopoverCtx;
    const ws = active();
    ws.cables = ws.cables.filter(c => c.id !== cable.id);
    saveState();
    renderCables();
    renderCableList();
  }
  hideCablePopover();
});

$('#cable-popover').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#c-save').click();
  if (e.key === 'Escape') $('#c-cancel').click();
});

/* ---------- Panneau liste des connexions ---------- */
function renderCableList() {
  const list = $('#cable-list');
  const count = $('#cable-count');
  if (!list) return;
  const ws = active();
  const allCables = ws?.cables || [];
  const cables = allCables.filter(c => cableMatchesFilter(ws, c));
  count.textContent = cables.length === allCables.length ? String(allCables.length) : `${cables.length}/${allCables.length}`;
  list.innerHTML = '';

  if (!cables.length) {
    list.innerHTML = allCables.length
      ? `<div class="cp-empty">Aucun câble ne correspond aux filtres.</div>`
      : `<div class="cp-empty">Aucun câble.<br>Cliquez deux ports pour les relier.</div>`;
    return;
  }

  cables.forEach(cable => {
    const ea = resolveEndpoint(ws, cable.a);
    const eb = resolveEndpoint(ws, cable.b);
    if (!ea || !eb) return;
    const row = document.createElement('button');
    const hasFocus = focusedCableIds.size > 0;
    const isFocused = focusedCableIds.has(cable.id);
    row.className = 'cp-cable' + (hasFocus ? (isFocused ? ' is-focused' : ' is-phantom') : '');
    row.title = isFocused
      ? 'Câble sélectionné — double-cliquez pour retirer la sélection'
      : 'Cliquez pour centrer · double-cliquez pour mettre au premier plan';
    row.innerHTML = `
      <span class="cp-dot" style="background:${cable.color}"></span>
      <span class="cp-cable-body">
        <span class="cp-cable-id"></span>
        <span class="cp-cable-path"></span>
      </span>
      <span class="cp-cable-del" title="Supprimer ce câble">✕</span>`;
    const idEl = row.querySelector('.cp-cable-id');
    idEl.textContent = cable.name || 'Sans ID';
    if (cable.domain) {
      const tag = document.createElement('span');
      tag.className = 'cp-domain-tag';
      tag.textContent = cableDomainLabel(cable.domain);
      tag.title = `Domaine : ${cableDomainLabel(cable.domain)}`;
      idEl.appendChild(tag);
    }
    row.querySelector('.cp-cable-path').textContent =
      `${ea.port.name} (${ea.inst.name}) → ${eb.port.name} (${eb.inst.name})`;

    row.addEventListener('click', e => {
      if (e.target.closest('.cp-cable-del')) return;
      // Différer le centrage pour laisser le double-clic agir sans effet simple.
      clearTimeout(cableSingleClickTimer);
      cableSingleClickTimer = setTimeout(() => {
        focusOnCable(cable);
        cableSingleClickTimer = null;
      }, 260);
    });
    row.addEventListener('dblclick', e => {
      if (e.target.closest('.cp-cable-del')) return;
      e.preventDefault();
      clearTimeout(cableSingleClickTimer);
      cableSingleClickTimer = null;
      toggleCableFocus(cable.id);
    });
    row.querySelector('.cp-cable-del').addEventListener('click', e => {
      e.stopPropagation();
      pushHistory();
      ws.cables = ws.cables.filter(c => c.id !== cable.id);
      touchWorkspace(ws);
      saveState();
      renderCables();
      renderCableList();
    });
    list.appendChild(row);
  });
}

function focusOnCable(cable) {
  const ws = active();
  const ea = resolveEndpoint(ws, cable.a);
  const eb = resolveEndpoint(ws, cable.b);
  if (!ea || !eb) return;
  const p1 = portBoardPosition(ws, ea.rack, ea.inst, ea.port);
  const p2 = portBoardPosition(ws, eb.rack, eb.inst, eb.port);
  if (!p1 || !p2) return;
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  const rect = viewport.getBoundingClientRect();
  view.scale = 1;
  view.x = rect.width / 2 - cx;
  view.y = rect.height / 2 - cy;
  markViewTouched();
  applyView();
  renderBoard();
  requestAnimationFrame(() => {
    const g = board.querySelector(`#cable-svg g.cable[data-cable-id="${cable.id}"]`);
    g?.classList.add('selected');
    setTimeout(() => g?.classList.remove('selected'), 2000);
  });
}

// Réduction du panneau : seule sa barre de titre reste visible afin de libérer
// le board. Le bouton « Tout retirer » conserve naturellement son action.
function toggleCablePanel() {
  const panel = $('#cable-panel');
  const toggle = $('#cable-panel-toggle');
  const collapsed = panel.classList.toggle('collapsed');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? 'Développer le panneau des connexions' : 'Réduire le panneau des connexions';
}
$('#cable-panel-toggle').addEventListener('click', e => {
  if (e.target.closest('#cable-panel-clear')) return;
  toggleCablePanel();
});
$('#cable-panel-toggle').addEventListener('keydown', e => {
  if (e.target.closest('#cable-panel-clear')) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  toggleCablePanel();
});

// Filtres visuels : ils n'altèrent pas les données et s'appliquent au board
// comme à la liste des connexions.
const cableColorFilterEl = $('#cable-filter-color');
cableColorFilterEl.innerHTML = '<option value="all">Toutes les couleurs</option>' +
  CABLE_COLORS.map(c => `<option value="${c.hex}">${c.name}</option>`).join('');
$('#cable-filter-device').addEventListener('input', e => {
  cableFilterDevice = e.target.value;
  renderCables();
  renderCableList();
});
cableColorFilterEl.addEventListener('change', e => {
  cableFilterColor = e.target.value;
  renderCables();
  renderCableList();
});
$('#cable-filter-reset').addEventListener('click', () => {
  cableFilterDevice = '';
  cableFilterColor = 'all';
  $('#cable-filter-device').value = '';
  cableColorFilterEl.value = 'all';
  renderCables();
  renderCableList();
});

$('#cable-panel-clear').addEventListener('click', async () => {
  const ws = active();
  if (!ws?.cables.length) return;
  const ok = await lldConfirm(
    `Retirer les ${ws.cables.length} câble(s) de ce workspace ?`,
    { title: '🗑 Retirer les câbles', okLabel: 'Retirer' });
  if (ok) {
    pushHistory();
    ws.cables = [];
    touchWorkspace(ws);
    pendingPort = null;
    saveState();
    renderCables();
    renderCableList();
  }
});

/* ---------- Interrupteur Câblage ---------- */
$('#cabling-toggle').addEventListener('change', e => {
  setCablingMode(e.target.checked);
});

function setCablingMode(on) {
  cablingMode = on;
  document.body.classList.toggle('cabling', on);
  $('#cable-panel').classList.toggle('hidden', !on);
  $('#cabling-toggle').checked = on;

  if (on) {
    // Les modes Créer/Modifier sont exclusifs
    if (labelMode) setLabelMode(null);
    $('#mode-hint').textContent = 'Mode câblage : cliquez un câble pour l’éditer ; double-cliquez un câble ou un device pour le mettre au premier plan.';
    pendingPort = null;
    pruneCables(active());
    renderBoard();    // rend les devices non déplaçables + dessine les câbles
    renderCableList();
  } else {
    $('#mode-hint').textContent = 'Glissez un rack sur le board, puis ajoutez vos devices.';
    pendingPort = null;
    hideCablePopover();
    renderBoard();    // rend les devices déplaçables + masque les câbles
  }
}

/* ============================================================
   INFOS DOSSIER LLD — modale à sommaire (chapitres)
   ------------------------------------------------------------
   Le bouton 📘 ouvre d'abord le SOMMAIRE du dossier (chapitres +
   sous-chapitres) :
   - double-clic sur un titre pour le renommer (repris par les exports) ;
   - boutons « ＋ Chapitre » / « ＋ Sous-chapitre » pour enrichir le
     sommaire ;
   - clic sur un nœud : à droite, SEULES les informations insertibles
     de ce chapitre (les sections automatiques restent listées) ;
   - une information ajoutée dans plusieurs chapitres est SYNCHRONISÉE
     (stockage unique + badge « 🔄 Synchronisé avec … ») ;
   - les exports HTML / PDF / Excel lisent ces mêmes clés (ws.lld.*) et
     reprennent les titres du sommaire → tout reste synchronisé ;
   - un chapitre / sous-chapitre AJOUTÉ accepte des blocs libres
     (tableau + colonnes/lignes, paragraphe, captures d’écran),
     repris automatiquement dans tous les exports.
   ============================================================ */

const LLD_REV_COLS = [['rev', 'Rév', 52], ['date', 'Date', 108], ['author', 'Auteur', 128], ['note', 'Modifications', 'flex']];
const LLD_SIGNATORY_COLS = [
  ['name', 'Nom', 130],
  ['position', 'Position', 130],
  ['organization', 'Organisation', 150],
  ['approvedVersion', 'Version approuvée', 'flex']
];
// Colonne « Site » : libre pour l'instant, sera reliée aux sites déclarés au lot 2
const LLD_VLAN_COLS = [['vid', 'VLAN', 44], ['name', 'Nom', 96], ['site', 'Site', 80], ['subnet', 'Subnet', 120], ['gw', 'Passerelle', 106], ['purpose', 'Usage', 'flex']];
const LLD_NOMEN_COLS = [['type', "Type d'objet", 150], ['prefix', 'Préfixe', 78], ['example', 'Exemple', 140], ['rule', 'Règle de nommage', 'flex']];
// Profils firewall (ch. 4 du template) — champs rendus dynamiquement
const LLD_FWP_FIELDS = [
  { k: 'vpnSsl', label: 'VPN SSL — utilisateurs', ph: 'Ex : USER_SSL', max: 60 },
  { k: 'appCtrl', label: 'Application Control', ph: 'Ex : AppControl.V1', max: 60 },
  { k: 'webBlocker', label: 'WebBlocker', ph: 'Ex : WebBlocker.V1', max: 60 },
  { k: 'httpProxy', label: 'HTTP Proxy', ph: 'Ex : HTTP-Client-v1', max: 60 }
];
// Champs interconnexion (ch. 6) — libellés + placeholders de l'ancienne fiche
const LLD_IC_FIELDS = [
  { k: 'tech', label: 'Technologie', type: 'select', max: 60,
    opts: ['', 'IPsec site-to-site', 'MPLS', 'SD-WAN', 'LAN-to-LAN opérateur', 'VPN SSL', 'Autre'] },
  { k: 'routing', label: 'Routage', ph: 'Ex : statique', max: 60 },
  { k: 'epA', label: 'Endpoint public site A', ph: 'Ex : 41.92.10.2', max: 60 },
  { k: 'epB', label: 'Endpoint public site B', ph: 'Ex : 105.12.33.2', max: 60 },
  { k: 'localSubnets', label: 'Subnets locaux (A)', ph: 'Ex : 10.0.0.0/16', max: 80 },
  { k: 'remoteSubnets', label: 'Subnets distants (B)', ph: 'Ex : 10.1.0.0/16', max: 80 },
  { k: 'encryption', label: 'Chiffrement', ph: 'Ex : AES-256 / IKEv2', max: 60 },
  { k: 'snA', label: 'Extrémité A — N° de série', ph: 'Ex : PL5815421', max: 60 },
  { k: 'fwA', label: 'Extrémité A — Firmware', ph: 'Ex : 8.3.2', max: 40 },
  { k: 'haA', label: 'HA — Groupe (A)', ph: 'Ex : Group 1', max: 40 },
  { k: 'roleA', label: 'HA — Rôle préféré (A)', ph: 'Ex : Master', max: 30 },
  { k: 'vipA', label: 'IP virtuelle (HA) — site A', ph: 'Ex : 41.92.10.1', max: 45 },
  { k: 'mgmtA', label: 'IP admin — extrémité A', ph: 'Ex : 10.10.99.12', max: 45 },
  { k: 'mgmtMaskA', label: 'Masque admin — extrémité A', ph: 'Ex : 255.255.255.0', max: 45 },
  { k: 'lanA', label: 'Extrémité A — LAN 1 connecté à', ph: 'Ex : SW-01 port 25', max: 60 },
  { k: 'clusterA', label: 'Cluster firewall — Master (A)', ph: 'Ex : Cluster 1', max: 40 },
  { k: 'snB', label: 'Extrémité B — N° de série', ph: 'Ex : PL5815422', max: 60 },
  { k: 'fwB', label: 'Extrémité B — Firmware', ph: 'Ex : 8.3.2', max: 40 },
  { k: 'haB', label: 'HA — Groupe (B)', ph: 'Ex : Group 2', max: 40 },
  { k: 'roleB', label: 'HA — Rôle préféré (B)', ph: 'Ex : Slave', max: 30 },
  { k: 'vipB', label: 'IP virtuelle (HA) — site B', ph: 'Ex : 105.157.20.1', max: 45 },
  { k: 'mgmtB', label: 'IP admin — extrémité B', ph: 'Ex : 10.11.99.12', max: 45 },
  { k: 'mgmtMaskB', label: 'Masque admin — extrémité B', ph: 'Ex : 255.255.255.0', max: 45 },
  { k: 'lanB', label: 'Extrémité B — LAN 1 connecté à', ph: 'Ex : SW-02 port 25', max: 60 },
  { k: 'clusterB', label: 'Cluster firewall — Slave (B)', ph: 'Ex : Cluster 2', max: 40 },
  { k: 'notes', label: 'Notes de configuration (interconnexion)', type: 'textarea', rows: 3, max: 2000,
    ph: 'Ex : tunnel IPsec redondé, DPD activé, SA en IKEv2…' }
];
// Tables par chapitre : règles/NAT firewall (7), VMs (9), volumes (10), caméras (12)
const LLD_FW_COLS = [['type', 'Type', 74], ['name', 'Nom / Règle', 'flex'], ['src', 'Source', 130],
                     ['dst', 'Destination', 130], ['service', 'Service / Ports', 120], ['action', 'Action', 66]];
const LLD_VM_COLS = [['name', 'VM', 120], ['role', 'Rôle', 'flex'], ['host', 'Hôte', 110], ['ip', 'IP / VLAN', 100]];
const LLD_VPN_COLS = [['name', 'Tunnel VPN S2S', 'flex'], ['peer', 'Pair / subnet distant', 200]];
const LLD_ALIAS_COLS = [['name', 'Alias', 140], ['value', 'Définition (hosts, subnet…)', 'flex']];
const LLD_EQUIP_COLS = [['model', 'Élément (licence, lien, câble…)', 'flex'], ['qty', 'Quantité', 110],
                        ['remark', 'Remarque', 150], ['status', 'Statut', 110]];
const LLD_ADMIN_COLS = [['user', 'Admin user/pwd', 150], ['auth', 'Authentification', 130],
                        ['proto', 'Protocole', 90], ['host', 'Host', 110], ['port', 'Port', 70],
                        ['cli', 'CLI SSH', 90], ['sec', 'Sécurité', 110],
                        ['webA', 'Web Admin Access (LAN)', 150], ['webB', 'Web Admin Access (WAN)', 150],
                        ['note', 'Commentaire', 'flex']];
const LLD_VOL_COLS = [['name', 'Volume / LUN', 'flex'], ['size', 'Capacité', 90], ['type', 'Type', 90], ['srv', 'Serveur', 120]];
const LLD_CAM_COLS = [['name', 'Caméra', 110], ['loc', 'Emplacement', 'flex'], ['model', 'Modèle', 120], ['ip', 'IP', 100]];

// Colonnes « sites » alignées sur le tableau 2.1 du PDF / Excel
const LLD_SITE_COLS = [
  ['name', 'Nom', 110, { ph: 'Ex : Site A' }],
  ['type', 'Type', 90, { ph: 'Ex : Siège' }],
  ['country', 'Pays', 80, { ph: 'Ex : Maroc' }],
  ['users', 'Utilisateurs', 90, { ph: 'Ex : 45' }],
  ['address', 'Adresse', null, { ph: 'Ex : 12, bd Mohammed V, Casablanca' }],
  ['contact', 'Contacts', 130, { ph: 'Ex : NOC — +212…' }],
  ['desc', 'Description / notes', null, { ph: 'Rôle du site, contraintes…' }]
];

// Colonnes « flux réseau » (ch. 14)
const LLD_FLOW_COLS = [
  ['name', 'Flux', 140, { ph: 'Ex : DMZ \u2192 SQL' }],
  ['src', 'Source', null, { ph: 'Ex : LAN Site A, SRV-01…' }],
  ['dst', 'Destination', null, { ph: 'Ex : Internet, FW-01…' }],
  ['proto', 'Protocole / ports', 130, { ph: 'Ex : TCP 443' }],
  ['sens', 'Sens', 155, { opts: [['bi', '\u21c4 Bidirectionnel'], ['uni', '\u2192 Unidirectionnel']] }],
  ['usage', 'Usage / description', null, { ph: 'Ex : accès \u00e0 la base de facturation' }]
];

// ---- Lignes « zone de switching » (nom + réordonnancement) ----
const LLD_ZONE_COLS = [
  ['name', 'Zone', null, { ph: 'Ex : LAN Site A' }],
  ['vlans', 'VLANs', 200, { ph: 'Ex : 10,20,30-40' }]
];

// ---- Matrice ch. 4 : même disposition que la feuille Excel « 4 » ----
// Lignes = template Excel (catégories fusionnées, descriptions, défauts).
// edit = cellules pilotées par l'app (nomenclature / IP) ; le reste est
// affiché en lecture seule (généré depuis devices, FAI, interco…).
const LLD_CH4_CATS = [
  ['FAI', 3],
  ['Interconnexion\nS2S', 10],
  ['Firewall', 51],
  ['Switch', 30],
  ['Serveurs', 8],
  ['Stockage', 5],
  ['VM NX', 8],
  ["Points d'accès", 6],
  ['Printer', 4],
  ['Onduleur', 2],
  ['IDS', 2],
  ['CCTV', 1],
  ['SPO', 1],
  ['Clime', 1]
];

// ============================================================
// Registre des INFORMATION INSERTIBLES par chapitre
// ------------------------------------------------------------
// Clé = identifiant stable de l'info (auxquelles les exports sont
// branchés). La même clé rattachée à N chapitres = une seule valeur
// partagée → synchronisation automatique + badge dans l'interface.
// ============================================================
/* Colonnes 5.1 — miroir exact de la feuille Excel « 5 » (tableau FAI). */
const LLD_FAI51_COLS = [
  ['cat', 'Categorie', 78],
  ['desc', 'Description', 150],
  ['down', 'Débit', 85],
  ['lanIp', 'IP', 100],
  ['lanMask', 'Mask', 100],
  ['lanGw', 'GW', 100],
  ['lanDns', 'DNS', 100],
  ['ipv6', 'IP v6', 110],
  ['dhcp', 'DHCP', 60],
  ['pf', 'Profile WAN', 100],
  ['pfPortWan', 'Port WAN', 75],
  ['pfPortLan', 'Port LAN', 75],
  ['pfClient', 'Client interne', 95],
  ['pfProto', 'Protocol', 70],
  ['dmz', 'DMZ', 80],
  ['firewall', 'Firewall', 100],
  ['wlanStat', 'Statu', 80],
  ['wlan', 'SSID', 90],
  ['notes', 'Commentaire', 140]
];
/* Colonnes 5.2 — câblage FAI (feuille Excel « 5 », section 5.2). */
const LLD_FAI_CAB_COLS = [
  ['cat', 'Categorie', 90],
  ['desc', 'Description', 160],
  ['conn', 'Connecté a', 200]
];
/* Colonnes 6.1 — miroir de la feuille Excel « 6 » (extrémités / HA). */
const LLD_IC61_COLS = [
  ['equip', 'Equipment', 130],
  ['nomen', 'Nomenclature', 120],
  ['sn', 'SN', 90],
  ['fw', 'Firmware', 80],
  ['ip', 'IP', 100],
  ['mask', 'Mask', 100],
  ['gw', 'GW', 100],
  ['dns', 'DNS', 100],
  ['haEn', 'Enable', 60],
  ['haGroup', 'Group Number', 90],
  ['haRole', 'Preferred role', 90],
  ['haMaster', 'Resume Master', 90],
  ['vip', 'Virtual IP', 100],
  ['mgmt', 'LAN admin IP', 100],
  ['mgmtMask', 'Mask', 100],
  ['note', 'Commentaire', 140]
];
/* Colonnes 6.2 — câblage interconnexion (feuille Excel « 6 »). */
const LLD_IC_CAB_COLS = [
  ['cat', 'Categorie', 110],
  ['desc', 'Description', 140],
  ['port', 'Port', 90],
  ['conn', 'Connecté a', 180]
];
/* Colonnes WAN — miroir de la feuille Excel « 6 » (WAN Connection Settings r44). */
const LLD_IC_WAN_COLS = [
  ['name', 'WAN Connection Settings', 150],
  ['enable', 'Enable', 55],
  ['connMethod', 'Connection Method', 90],
  ['routingMode', 'Routing Mode', 80],
  ['ip', 'IP Address', 100],
  ['mask', 'Mask', 100],
  ['gw', 'GW', 100],
  ['dns', 'DNS', 100],
  ['priority', 'Connection Priority', 85],
  ['up', 'Upload Bandwidth', 90],
  ['down', 'Download Bandwidth', 95],
  ['portSpeed', 'Port Speed', 75],
  ['mtu', 'MTU', 55],
  ['mss', 'MSS', 55],
  ['macClone', 'MAC Address Clone', 95],
  ['vlan', 'VLAN', 55],
  ['hcMethod', 'Health Check Method', 95],
  ['hcDns', 'Health Check DNS Servers', 110],
  ['hcTimeout', 'Timeout', 60],
  ['hcInterval', 'Health Check Interval', 95],
  ['hcRetries', 'Health Check Retries', 95],
  ['hcRecovery', 'Recovery Retries', 85],
  ['provider', 'Service Provider', 90],
  ['dynDns', 'Dynamic DNS Settings', 95],
  ['ipv6', 'WAN / IP v6', 85],
  ['doh', 'WAN / DNS over HTTPS', 95],
  ['qos', 'WAN / Quality Monitoring', 105]
];
/* Colonnes LAN — en-têtes de la section LAN (feuille « 6 », r52). */
const LLD_IC_LAN_COLS = [
  ['lan', 'LAN', 160],
  ['routing', 'Inter-VLAN routing', 160],
  ['network', 'Network', 180]
];
const LLD_INFOS = {
  meta: {
    label: 'Client, auteur & version', kind: 'fields', path: '',
    fields: [
      { k: 'client', label: 'Client', ph: 'Ex : Client SAS', max: 80 },
      { k: 'author', label: 'Auteur', ph: 'Ex : A. MJID — Ingénieur infra', max: 80 },
      { k: 'version', label: 'Version du dossier', ph: 'Ex : 1.0', max: 80 }
    ]
  },
  governance: { label: 'Révisions, approbateurs & réviseurs', kind: 'governance' },
  objectif: {
    label: 'Objectif du document', kind: 'textarea', rows: 4, max: 4000,
    ph: "Ex : Ce document décrit la conception bas niveau (LLD) de l'infrastructure réseau et système des sites A et B…"
  },
  sites: {
    label: 'Sites du dossier', kind: 'sites', cols: LLD_SITE_COLS, addLabel: '＋ Ajouter un site',
    hint: 'Mêmes colonnes que le tableau des sites du ch. 2.1 (PDF & Excel) : Nom, Adresse, Contacts, Description… '      + 'Les sites structurent aussi le board (rattachement des racks, pastille colorée).'
  },
  existant: {
    label: '2.2. Infrastructure existante', kind: 'textarea', rows: 4, max: 4000,
    ph: 'Ex : Site A — 1 baie 12U, LAN non redondant…'
  },
  architecture: {
    label: '3. Architecture cible', kind: 'textarea', rows: 4, max: 4000,
    ph: 'Ex : Architecture deux sites interconnectés en IPsec via Internet, pare-feu en chaque site…'
  },
  equip: {
    label: 'Équipements & licences hors baie (ch. 3)', kind: 'table', cols: LLD_EQUIP_COLS,
    addLabel: '＋ Ajouter un élément', filter: r => r.model.trim(),
    hint: 'Ces lignes alimentent seules le tableau 3.1 de l\'Excel (et le PDF) : '
      + 'bouton 🔎 pour les pré-remplir depuis l\'élévation, puis éditez/supprimez librement.',
    extra: 'gen-equip'
  },
  addrMatrix: {
    label: 'Matrice d’adressage IP (feuille Excel « 4 »)', kind: 'ch4matrix',
    hint: 'Même disposition que l\'Excel : Catégorie / Description / Nomenclature / Adressage IP / Commentaire. '
      + 'Toutes les cellules de valeurs sont modifiables — les liens structurés (VPN, alias, profils) alimentent '
      + 'aussi le PDF ; les autres écritures deviennent des surcharges appliquées à la feuille Excel « 4 ». '
      + 'Sous la matrice : le registre VLANs puis la nomenclature, comme dans le classeur.'
  },
  nomen: {
    label: 'Nomenclature — registre (bas de la feuille Excel « 4 »)', kind: 'table', cols: LLD_NOMEN_COLS,
    hint: 'Colonnes identiques au tableau « Nomenclature » ajouté sous la matrice dans l\'Excel et au ch. 4 du PDF.',
    addLabel: '＋ Ajouter une ligne', filter: r => r.type.trim() || r.prefix.trim(),
    extra: 'gen-nomen'
  },
  vlans: {
    label: 'Registre VLANs & subnets (bas de la feuille Excel « 4 »)', kind: 'table', cols: LLD_VLAN_COLS,
    hint: 'Colonnes identiques au registre VLANs de l\'Excel (VLAN, subnet, passerelle…) et du PDF ch. 4 — '
      + 'le même registre alimente aussi les lignes VLAN de la matrice ci-dessus.',
    addLabel: '＋ Ajouter un VLAN', filter: v => v.vid.trim() || v.name.trim(),
    extra: 'detect-vlans'
  },
  fwProfiles: {
    label: 'Profils firewall (ch. 4)', kind: 'fields', path: 'fwProfiles',
    fields: LLD_FWP_FIELDS
  },
  vpns: {
    label: 'Tunnels VPN site à site (ch. 4)', kind: 'table', cols: LLD_VPN_COLS,
    addLabel: '＋ Ajouter un tunnel VPN', filter: r => r.name.trim()
  },
  aliases: {
    label: 'Alias firewall (ch. 4)', kind: 'table', cols: LLD_ALIAS_COLS,
    addLabel: '＋ Ajouter un alias', filter: r => r.name.trim()
  },
  diag5: {
    label: 'Diagramme d’accès FAI (avant 5.1)', kind: 'diagram', mode: 'fai',
    hint: 'Schéma du chapitre 5 : FAI au centre, équipements de l’élévation reliés à ce qu’ils branchent. '
      + 'Bouton « 🔎 Générer depuis l’élévation » — crée aussi le rack FAI (5 routeurs) à gauche s’il manque.'
  },
  shots5: {
    label: 'Captures d’écran — ch. 5', kind: 'shots',
    hint: 'Glissez-déposez des captures (ou 📁) : contrats FAI, config CPE, tickets opérateur… exportées dans le PDF.'
  },
  diag6: {
    label: 'Diagramme d’interconnexion (avant 6.1)', kind: 'diagram', mode: 'interco',
    hint: 'Schéma site A ↔ tunnel ↔ site B avec extrémités, FAI et sous-réseaux — généré depuis l’élévation et l’interco saisie.'
  },
  shots6: {
    label: 'Captures d’écran — ch. 6', kind: 'shots',
    hint: 'Glissez-déposez des captures (contrat MPLS, config IPsec, capture tunnel…) — exportées dans le PDF.'
  },
  diag7: {
    label: 'Diagramme Firewall (avant le reste du ch. 7)', kind: 'diagram', mode: 'fw',
    hint: 'Schéma du pare-feu au centre : WAN / FAI, LAN, zones et équipements reliés — généré depuis l’élévation.'
  },
  shots7: {
    label: 'Captures d’écran — ch. 7', kind: 'shots',
    hint: 'Glissez-déposez des captures (policies, NAT, dashboard FW…) — exportées dans le PDF.'
  },
  fais: {
    label: '5.1 — Informations & Configuration (FAI)',
    kind: 'table', cols: LLD_FAI51_COLS, def: { cat: 'FAI' },
    addLabel: '＋ Ajouter une ligne',
    hint: 'Même tableau que la section 5.1 de la feuille Excel « 5 » : modifiez ici, l’export reprend ces valeurs. '
      + '🔎 Générer depuis l’élévation pré-remplit ce qui existe (FAI, routeurs WAN, topologie) ; le reste reste vide à saisir.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-fai51'
  },
  faiCab: {
    label: '5.2 — Câblage FAI',
    kind: 'table', cols: LLD_FAI_CAB_COLS, def: { cat: 'FAI' },
    addLabel: '＋ Ajouter une liaison',
    hint: 'Section 5.2 de la feuille Excel « 5 » (Categorie / Description / Connecté a). '
      + '🔎 Générer depuis l’élévation : liaisons WAN des routeurs, CPE et câbles FAI. Généré ici d’abord, puis repris dans l’XLSX.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-fai-cab'
  },
  adminSec: {
    label: "Admin Security — comptes d'administration (ch. 6)", kind: 'table', cols: LLD_ADMIN_COLS,
    addLabel: '＋ Ajouter un compte d’administration', filter: r => r.user.trim()
  },
  ic61: {
    label: '6.1 — Informations & Configuration (extrémités / HA)',
    kind: 'table', cols: LLD_IC61_COLS, def: {},
    addLabel: '＋ Ajouter une extrémité',
    hint: 'Même tableau que la section 6.1 de la feuille Excel « 6 » : extrémités, SN, firmware, IP, HA. '
      + '🔎 Générer depuis l’élévation pré-remplit depuis interco, routeurs et FAI ; le reste reste vide.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-ic61'
  },
  icCab: {
    label: '6.2 — Câblage interconnexion',
    kind: 'table', cols: LLD_IC_CAB_COLS, def: { cat: 'Interconnexion S2S' },
    addLabel: '＋ Ajouter une liaison',
    hint: 'Section 6.2 de la feuille Excel « 6 » (Categorie / Description / Port / Connecté a). '
      + '🔎 Générer depuis l’élévation : WAN/LAN des équipements d’interco et câbles du domaine.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-ic-cab'
  },
  icWan: {
    label: '6.1 — WAN Connection Settings (feuille Excel « 6 »)',
    kind: 'table', cols: LLD_IC_WAN_COLS, def: { enable: 'Oui', routingMode: 'NAT' },
    addLabel: '＋ Ajouter une connexion WAN',
    hint: 'Même tableau que la section WAN de la feuille Excel « 6 » (lignes WAN 1…3). '
      + '🔎 Générer depuis l’élévation pré-remplit depuis les FAI ; le reste reste vide à saisir. '
      + 'L’export XLSX/PDF reprend exactement ces lignes.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-ic-wan'
  },
  icLan: {
    label: '6.1 — LAN / Network settings (feuille Excel « 6 »)',
    kind: 'table', cols: LLD_IC_LAN_COLS, def: {},
    addLabel: '＋ Ajouter une ligne LAN',
    hint: 'Section LAN de la feuille Excel « 6 » (LAN / Inter-VLAN routing / Network). '
      + '🔎 Générer depuis l’élévation pré-remplit depuis interco et le registre VLANs.',
    filter: r => Object.values(r || {}).some(v => String(v ?? '').trim()),
    extra: 'gen-ic-lan'
  },
  fw: {
    label: 'Règles & NAT Firewall (ch. 7)', kind: 'table', cols: LLD_FW_COLS,
    addLabel: '＋ Ajouter une règle / NAT', filter: r => r.name.trim(), def: { type: 'Règle' }
  },
  zones: {
    label: 'Zones de Switching (ch. 8)', kind: 'zones', cols: LLD_ZONE_COLS, addLabel: '＋ Ajouter une zone',
    hint: 'Les zones découpent le chapitre 8 (8.1, 8.2…) dans le PDF : rattachez chaque switch / borne WiFi à sa zone depuis sa fiche (double-clic sur « Zone »).'
  },
  vms: {
    label: 'Machines virtuelles (ch. 9)', kind: 'table', cols: LLD_VM_COLS,
    addLabel: '＋ Ajouter une VM', filter: r => r.name.trim()
  },
  vols: {
    label: 'Volumes / LUN (ch. 10)', kind: 'table', cols: LLD_VOL_COLS,
    addLabel: '＋ Ajouter un volume', filter: r => r.name.trim()
  },
  cams: {
    label: 'Caméras CCTV (ch. 12)', kind: 'table', cols: LLD_CAM_COLS,
    addLabel: '＋ Ajouter une caméra', filter: r => r.name.trim()
  },
  'note:firewall': {
    label: 'Notes de configuration — Firewall (ch. 7)', kind: 'textarea', catKey: 'firewall',
    rows: 3, max: 2000, ph: 'Ex : policies, NAT, VLANs, haute disponibilité…'
  },
  'note:switching': {
    label: 'Notes de configuration — Switching (ch. 8)', kind: 'textarea', catKey: 'switching',
    rows: 3, max: 2000, ph: 'Ex : VLANs, trunks, spanning-tree, PoE…'
  },
  'note:server': {
    label: 'Notes de configuration — Serveurs (ch. 9)', kind: 'textarea', catKey: 'server',
    rows: 3, max: 2000, ph: 'Ex : hyperviseur, adresses IP, rôles…'
  },
  'note:storage': {
    label: 'Notes de configuration — Stockage (ch. 10)', kind: 'textarea', catKey: 'storage',
    rows: 3, max: 2000, ph: 'Ex : RAID, iSCSI, capacités…'
  },
  'note:ids': {
    label: 'Notes de configuration — Intrusion / IDS (ch. 11)', kind: 'textarea', catKey: 'ids',
    rows: 3, max: 2000, ph: 'Ex : mode détection, sondes, emplacement…'
  },
  'note:cctv': {
    label: 'Notes de configuration — CCTV (ch. 12)', kind: 'textarea', catKey: 'cctv',
    rows: 3, max: 2000, ph: 'Ex : flux caméras, NVR, VLAN dédié…'
  },
  'note:pointage': {
    label: 'Notes de configuration — Pointage / SPO (ch. 13)', kind: 'textarea', catKey: 'pointage',
    rows: 3, max: 2000, ph: 'Ex : badges, terminaux, serveur SPO…'
  },
  flows: {
    label: 'Matrice des flux réseau (ch. 14)', kind: 'flows', cols: LLD_FLOW_COLS, addLabel: '＋ Ajouter un flux',
    hint: 'Source, destination, protocole/ports, sens et usage de chaque flux — repris dans le PDF (ch. 14) et en surbrillance depuis la vue Topologie (sélecteur 🔄).'
  }
};

// ---- Blocs libres des chapitres ajoutés au sommaire ----
// Clés stables : cpara:<id> (paragraphe), ctable:<id> (tableau),
// cshots:<id> (captures). Stockage = ws.lld[key] ; libellé optionnel
// dans ws.lld.customMeta[key].label ; colonnes dans ws.lld.gridCols[key].
const LLD_CUSTOM_TABLE_COLS = [
  ['col1', 'Colonne 1', 160],
  ['col2', 'Colonne 2', 160],
  ['col3', 'Colonne 3', 200]
];
function lldIsCustomKey(key) {
  return typeof key === 'string' && /^(cpara|ctable|cshots):/.test(key);
}
function lldInfoDef(key, L0) {
  if (typeof key !== 'string') return null;
  if (LLD_INFOS[key]) return LLD_INFOS[key];
  const m = /^(cpara|ctable|cshots):/.exec(key);
  if (!m) return null;
  const L = L0 || (lldDraft && lldDraft.lld) || {};
  const meta = (L.customMeta && typeof L.customMeta === 'object' && L.customMeta[key]) || {};
  const label = String(meta.label || '').trim().slice(0, 80);
  if (m[1] === 'cpara') {
    return {
      label: label || 'Paragraphe', kind: 'textarea', rows: 6, max: 8000, custom: true,
      ph: 'Rédigez un paragraphe… Il sera repris tel quel dans les exports HTML, PDF et Excel.'
    };
  }
  if (m[1] === 'ctable') {
    return {
      label: label || 'Tableau', kind: 'table', cols: LLD_CUSTOM_TABLE_COLS,
      addLabel: '＋ Ajouter une ligne', custom: true,
      hint: 'Ajoutez des colonnes (＋ Colonne) et des lignes. Double-clic sur un en-tête pour le renommer — le tableau est repris dans les exports HTML, PDF et Excel.'
    };
  }
  return {
    label: label || 'Captures d’écran', kind: 'shots', custom: true,
    hint: 'Glissez-déposez des captures (PNG/JPG) : elles sont embarquées dans les exports HTML, PDF et Excel.'
  };
}

// Sections générées automatiquement à l'export (indiquées sous le détail
// d'un chapitre pour rappeler que ces données ne se saisissent pas ici).
const LLD_TOC_AUTO = {
  '2': 'Racks par site (depuis les baies du workspace)',
  '2.1': 'Tableau des racks par site (depuis les baies)',
  '3.1': 'Récapitulatif par catégorie, inventaire détaillé & suivi des garanties',
  '4': "Matrice d'adressage (feuille Excel), registre VLANs, nomenclature & ports étiquetés (depuis les devices)",
  '5': 'Diagramme d’accès FAI + captures (si renseignées) avant 5.1',
  '5.2': 'Tableau 5.2 (Categorie / Description / Connecté a) — éditable ici, + câbles FAI si absents du tableau',
  '6': 'Diagramme d’interconnexion + captures (si renseignées) avant 6.1',
  '6.1': 'Tableaux 6.1 extrémités/HA, WAN Connection Settings et LAN — éditables ici, export XLSX/PDF identiques',
  '6.2': 'Tableau 6.2 (Categorie / Description / Port / Connecté a) — éditable ici, + câbles interco si absents',
  '7': 'Diagramme Firewall + captures, puis équipements firewall, interfaces VLAN, ports & câblage',
  '8': 'Sous-chapitres 8.1… = zones de Switching ; équipements, ports & câblage',
  '9': 'Équipements serveurs, ports & câblage du domaine',
  '10': 'Équipements stockage, ports & câblage du domaine',
  '11': 'Équipements IDS, ports & câblage du domaine',
  '12': 'Équipements CCTV, ports & câblage du domaine',
  '13': 'Équipements pointage, ports & câblage du domaine',
  '14': 'Diagramme de topologie (vue Topologie du workspace)',
  '15': 'Synthèse des racks, tableau de câblage global & élévations'
};

// Noms de feuilles déjà réservés par le template Excel (ne jamais allouer
// un sous-chapitre sur ces numéros → feuille dupliquée à l'export).
const LLD_RESERVED_SHEETS = new Set([
  'LLD', 'Governance', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '8.1', '8.2', '8.3', '8.4', '8.5', '15.1'
]);

// Types devinés à partir des préfixes les plus courants (bouton « Générer »)
const NOMEN_GUESS = {
  FW: 'Pare-feu', SW: 'Switch', AP: 'Borne WiFi', SRV: 'Serveur',
  NAS: 'Stockage (NAS)', SAN: 'Stockage (SAN)', STO: 'Stockage',
  IDS: 'Intrusion (IDS)', IPS: 'Intrusion (IPS)',
  CAM: 'CCTV (caméra)', NVR: 'CCTV (enregistreur)', DVR: 'CCTV (enregistreur)', CCTV: 'CCTV',
  PTG: 'Pointage', SPO: 'Pointage (SPO)', PTA: 'Pointage',
  RT: 'Routeur', RTR: 'Routeur', GW: 'Passerelle',
  CAB: 'Cordon / câble', PDU: 'Énergie (PDU)', UPS: 'Onduleur',
  ODF: 'Brassage (panneau)', IDF: 'Brassage (panneau)'
};

// ---- Grilles éditables : vraies tables dont les en-têtes sont les
// ---- mêmes colonnes que les tableaux PDF / Excel de l'export. ----
// Colonne : [clé, en-tête, largeur px|null, { ph, opts }]
function lldMakeGrid(cols, tableId, defCols) {
  const wrap = document.createElement('div');
  wrap.className = 'lld-grid-wrap';
  if (tableId) wrap.dataset.g = tableId;
  const t = document.createElement('table');
  t.className = 'lld-grid';
  const htr = document.createElement('tr');
  cols.forEach((col, idx) => {
    const label = col[1];
    const th = document.createElement('th');
    if (typeof col[2] === 'number') th.style.width = col[2] + 'px';
    th.title = (tableId && defCols && defCols.length)
      ? 'Glisser pour réordonner · Double-clic : renommer · ✕ : supprimer'
      : 'Double-clic : renommer la colonne';
    const span = document.createElement('span');
    span.className = 'lld-th-label';
    span.textContent = label;
    th.appendChild(span);
    if (tableId && defCols && defCols.length) {
      // Suppression de la colonne (les valeurs sortent des lignes au prochain
      // enregistrement ; les exports lisent le schéma via lldExportCols).
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'lld-th-del';
      del.textContent = '✕';
      del.title = 'Supprimer cette colonne';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        if (!lldDraft) return;
        const cur = lldGridCols(tableId, defCols);
        if (cur.length <= 1) {
          lldAlert('Le tableau doit conserver au moins une colonne.', { title: '🗑 Colonnes' });
          return;
        }
        lldPushUndo(true);   // Ctrl+Z : état avant suppression (flush inclus)
        cur.splice(idx, 1);
        lldSetGridCols(tableId, cur);
        lldFlushDetail();
        lldRerenderDetail();
      });
      th.appendChild(del);
      th.addEventListener('dblclick', async ev => {
        if (ev.target.closest('.lld-th-del') || !lldDraft) return;
        const cur = lldGridCols(tableId, defCols);
        const nv = await lldPrompt('Nom de la colonne :', String(cur[idx][1] ?? ''), {
          title: '✏️ Renommer la colonne', okLabel: 'Renommer'
        });
        if (nv == null) return;
        const lab = String(nv).trim().slice(0, 60);
        if (!lab) return;
        lldPushUndo(true);
        cur[idx][1] = lab;
        lldSetGridCols(tableId, cur);
        lldRerenderDetail();
      });
      // Glisser-déposer : changer l'ordre des colonnes. L'ordre est persisté
      // dans gridCols[tableId] → PDF/Excel suivent automatiquement le schéma.
      th.draggable = true;
      let dragGuard = false;
      th.addEventListener('mousedown', e => { dragGuard = !!e.target.closest('button'); });
      th.addEventListener('dragstart', ev => {
        if (!lldDraft || dragGuard) { ev.preventDefault(); return; }
        lldDragCol = { tableId, from: idx };
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', tableId + ':' + idx);
        th.classList.add('lld-th-dragging');
      });
      th.addEventListener('dragover', ev => {
        if (!lldDragCol || lldDragCol.tableId !== tableId) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        th.classList.add('lld-th-over');
      });
      th.addEventListener('dragleave', () => th.classList.remove('lld-th-over'));
      th.addEventListener('drop', ev => {
        ev.preventDefault();
        th.classList.remove('lld-th-over');
        if (!lldDragCol || !lldDraft || lldDragCol.tableId !== tableId) return;
        const from = lldDragCol.from, to = idx;
        lldDragCol = null;
        if (from === to || !Number.isFinite(from)) return;
        lldPushUndo(true);
        const cur = lldGridCols(tableId, defCols);
        if (!cur[from]) return;
        const [moved] = cur.splice(from, 1);
        cur.splice(to, 0, moved);
        lldSetGridCols(tableId, cur);
        lldFlushDetail();
        lldRerenderDetail();
      });
      th.addEventListener('dragend', () => {
        lldDragCol = null;
        document.querySelectorAll('.lld-th-dragging, .lld-th-over')
          .forEach(el => el.classList.remove('lld-th-dragging', 'lld-th-over'));
      });
    }
    htr.appendChild(th);
  });
  const thx = document.createElement('th');
  thx.className = 'lld-grid-x';
  htr.appendChild(thx);
  const thead = document.createElement('thead');
  thead.appendChild(htr);
  t.appendChild(thead);
  t.appendChild(document.createElement('tbody'));
  wrap.appendChild(t);
  return wrap;
}

// Barre d'actions sous une grille : « ajouter une ligne » + « ajouter une colonne ».
function lldGridActions(...btns) {
  const d = document.createElement('div');
  d.className = 'lld-grid-actions';
  btns.forEach(b => d.appendChild(b));
  return d;
}
function lldAddColBtn(tableId, defCols) {
  return lldBtn('＋ Colonne', async () => {
    if (!lldDraft || !tableId || !defCols) return;
    const nv = await lldPrompt('Nom de la nouvelle colonne :', '', {
      title: '＋ Ajouter une colonne', okLabel: 'Ajouter'
    });
    if (nv == null) return;
    const lab = String(nv).trim().slice(0, 60);
    if (!lab) return;
    lldPushUndo(true);
    const cur = lldGridCols(tableId, defCols);
    let base = lab.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
    let k = base, n = 2;
    while (cur.some(c => c[0] === k)) { k = base + '_' + n; n++; }
    cur.push([k, lab, null]);
    lldSetGridCols(tableId, cur);
    lldFlushDetail();
    lldRerenderDetail();
  }, 'Ajouter une colonne à ce tableau (repris dans les tableaux des exports)');
}

function lldRowsFrom(container) {
  return [...container.querySelectorAll('tbody tr')].map(row => {
    const o = {};
    row.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; });
    return o;
  });
}

function lldAddRow(wrap, cols, data = {}) {
  lldPushUndo(true);   // mémorise l'état avant ajout/suppression de ligne
  const tr = document.createElement('tr');
  if ('id' in data) tr.dataset.id = data.id || '';
  for (const [k, label, , extra] of cols) {
    const td = document.createElement('td');
    let el;
    if (extra && extra.opts) {
      el = document.createElement('select');
      extra.opts.forEach(o => {
        const op = document.createElement('option');
        op.value = Array.isArray(o) ? o[0] : o;
        op.textContent = Array.isArray(o) ? o[1] : (o || '—');
        el.appendChild(op);
      });
    } else {
      el = document.createElement('input');
      el.type = 'text';
      el.placeholder = (extra && extra.ph) || label;
      if (k === 'date') el.placeholder = 'AAAA-MM-JJ';
    }
    el.dataset.k = k;
    el.value = data[k] || '';
    td.appendChild(el);
    tr.appendChild(td);
  }
  const tdx = document.createElement('td');
  tdx.className = 'lld-grid-x';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'lld-row-del';
  del.textContent = '\u2715';
  del.title = 'Supprimer cette ligne';
  del.addEventListener('click', () => { lldPushUndo(true); tr.remove(); });
  tdx.appendChild(del);
  tr.appendChild(tdx);
  wrap.querySelector('tbody').appendChild(tr);
  return tr;
}


function lldSitesFrom(container) {
  return [...container.querySelectorAll('tbody tr')].map(tr => {
    const o = {};
    tr.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; });
    o.id = tr.dataset.id || '';
    if (!o.id) o.id = uid();
    return o;
  });
}


function lldFlowsFrom(container) {
  return [...container.querySelectorAll('tbody tr')].map(tr => {
    const o = {};
    tr.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; });
    o.id = tr.dataset.id || '';
    if (!o.id) o.id = uid();
    if (o.sens !== 'uni') o.sens = 'bi';
    return o;
  });
}

// ---- Blocs « FAI » (ch. 5) : liste dynamique de fournisseurs d'accès ----
function lldRenumberFais(container) {
  container.querySelectorAll('.lld-fai-num').forEach((el, i) => { el.textContent = `FAI ${i + 1}`; });
}
function lldAddFaiBlock(container, fai = {}) {
  lldPushUndo(true);
  const card = document.createElement('div');
  card.className = 'lld-site lld-fai';
  card.innerHTML = `
    <div class="lld-fai-head">
      <strong class="lld-fai-num"></strong>
      <button type="button" class="lld-row-del" title="Supprimer ce FAI">\u2715</button>
    </div>
    <div class="d-grid lld-fai-grid">
      <label>Opérateur
        <input type="text" data-k="operator" placeholder="Ex : Maroc Telecom" maxlength="60">
      </label>
      <label>Offre
        <input type="text" data-k="offer" placeholder="Ex : FTTO Pro 100M" maxlength="60">
      </label>
      <label>Type de lien
        <select data-k="linkType">
          <option value="">—</option>
          <option>FTTH</option>
          <option>FTTO</option>
          <option>Fibre dédiée</option>
          <option>EoC (Ethernet over Coax)</option>
          <option>ADSL / VDSL</option>
          <option>Liaison spécialisée</option>
          <option>4G / 5G (secours)</option>
          <option>Autre</option>
        </select>
      </label>
      <label>Débit descendant
        <input type="text" data-k="down" placeholder="Ex : 100 Mbps" maxlength="40">
      </label>
      <label>Débit montant
        <input type="text" data-k="up" placeholder="Ex : 100 Mbps" maxlength="40">
      </label>
      <label>Bloc IP publiques
        <input type="text" data-k="publicBlock" placeholder="Ex : 41.92.10.0/29" maxlength="60">
      </label>
      <label>CPE — modèle
        <input type="text" data-k="cpe" placeholder="Ex : Huawei EG8148" maxlength="60">
      </label>
      <label>CPE — IP
        <input type="text" data-k="cpeIp" placeholder="Ex : 41.92.10.1" maxlength="45">
      </label>
    </div>
    <div class="d-grid lld-fai-grid">
      <label>Liaison physique (boîtier \u2192 port WAN)
        <input type="text" data-k="wanLabel" placeholder="Ex : Port eth1 (ONT) \u2192 WAN 1" maxlength="120">
      </label>
      <label>Mode IP WAN
        <select data-k="ipMode">
          <option value="">—</option>
          <option>DHCP</option>
          <option>Static IP</option>
        </select>
      </label>
      <label>IP WAN
        <input type="text" data-k="wanIp" placeholder="Ex : 41.92.10.2" maxlength="45">
      </label>
      <label>Masque WAN
        <input type="text" data-k="wanMask" placeholder="Ex : 255.255.255.248" maxlength="45">
      </label>
      <label>Passerelle WAN
        <input type="text" data-k="wanGw" placeholder="Ex : 41.92.10.1" maxlength="45">
      </label>
      <label>DNS WAN
        <input type="text" data-k="wanDns" placeholder="Ex : 212.217.0.1" maxlength="60">
      </label>
      <label>IPv6
        <input type="text" data-k="ipv6" placeholder="Ex : 2a01:…/64" maxlength="60">
      </label>
      <label>LAN — IP
        <input type="text" data-k="lanIp" placeholder="Ex : 10.10.40.1" maxlength="45">
      </label>
      <label>LAN — Mask
        <input type="text" data-k="lanMask" placeholder="Ex : 255.255.255.0" maxlength="45">
      </label>
      <label>LAN — GW
        <input type="text" data-k="lanGw" placeholder="Ex : 10.10.40.254" maxlength="45">
      </label>
      <label>LAN — DNS
        <input type="text" data-k="lanDns" placeholder="Ex : 10.10.99.53" maxlength="45">
      </label>
      <label>DHCP
        <select data-k="dhcp">
          <option value="">—</option>
          <option>Oui</option>
          <option>Non</option>
        </select>
      </label>
      <label>Port Forwarding (règle)
        <input type="text" data-k="pf" placeholder="Ex : TCP 443 \u2192 10.10.20.11" maxlength="120">
      </label>
      <label>PF — Port WAN
        <input type="text" data-k="pfPortWan" placeholder="Ex : TCP 443" maxlength="60">
      </label>
      <label>PF — Port LAN
        <input type="text" data-k="pfPortLan" placeholder="Ex : 443" maxlength="60">
      </label>
      <label>PF — Client interne
        <input type="text" data-k="pfClient" placeholder="Ex : 10.10.20.11" maxlength="60">
      </label>
      <label>PF — Protocole
        <input type="text" data-k="pfProto" placeholder="Ex : TCP" maxlength="20">
      </label>
      <label>DMZ
        <input type="text" data-k="dmz" placeholder="Ex : 10.10.20.11 (reverse-proxy)" maxlength="120">
      </label>
      <label>Firewall
        <input type="text" data-k="firewall" placeholder="Ex : entrée 443 uniquement" maxlength="120">
      </label>
      <label>WLAN (statut)
        <input type="text" data-k="wlanStat" placeholder="Ex : Activé — 802.1X" maxlength="60">
      </label>
      <label>WLAN (SSID)
        <input type="text" data-k="wlan" placeholder="Ex : corp-secure / invit\u00e9" maxlength="120">
      </label>
    </div>
    <label class="lld-fai-notes">Notes de configuration
      <textarea data-k="notes" rows="2" maxlength="2000"
        placeholder="Ex : CPE en mode bridge, IP publique sur l'interface WAN du pare-feu…"></textarea>
    </label>`;
  card.querySelectorAll('[data-k]').forEach(inp => { inp.value = fai[inp.dataset.k] || ''; });
  card.querySelector('.lld-row-del').addEventListener('click', () => {
    lldPushUndo(true);
    card.remove();
    lldRenumberFais(container);
  });
  container.appendChild(card);
  lldRenumberFais(container);
}
function lldFaisFrom(container) {
  return [...container.querySelectorAll('.lld-fai')].map(card => {
    const o = {};
    card.querySelectorAll('[data-k]').forEach(inp => { o[inp.dataset.k] = inp.value; });
    return o;
  });
}

// ---- Lignes « zone de switching » (nom + réordonnancement) ----
function lldAddZoneRow(wrap, zone = {}) {
  const cols = lldExportCols((lldDraft && lldDraft.lld) || {}, 'zones', LLD_ZONE_COLS);
  const tr = lldAddRow(wrap, cols, zone);
  tr.classList.add('lld-zone-row');
  const tdx = tr.querySelector('.lld-grid-x');
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'lld-zone-up';
  up.textContent = '\u2191';
  up.title = 'Monter cette zone';
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'lld-zone-down';
  down.textContent = '\u2193';
  down.title = 'Descendre cette zone';
  up.addEventListener('click', () => {
    const prev = tr.previousElementSibling;
    if (prev && prev.classList.contains('lld-zone-row')) tr.parentElement.insertBefore(tr, prev);
  });
  down.addEventListener('click', () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('lld-zone-row')) tr.parentElement.insertBefore(next, tr);
  });
  tdx.insertBefore(up, tdx.firstChild);
  tdx.insertBefore(down, up.nextSibling);
  return tr;
}
function lldZonesFrom(container) {
  return [...container.querySelectorAll('.lld-zone-row')].map(r => {
    const o = { id: r.dataset.id || '' };
    r.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; });
    return o;
  });
}

// ============================================================
// Modale 📘 — brouillon, arbre du sommaire, détail d'un chapitre
// ------------------------------------------------------------
// Le brouillon clone les données à éditer ; les rendus y écrivent
// (ou sont relus à chaque chang de panneau). « Enregistrer » le
// reporte dans le workspace, « Annuler » / Échap le jettent.
// ============================================================
let lldDraft = null;    // { lld, sites, flows }
let lldSelId = null;    // nœud du sommaire affiché à droite

// ---- Accès au sommaire du brouillon ----
function lldToc() { return (lldDraft && lldDraft.lld.toc) || []; }

function lldAllNodes(nodes = lldToc(), out = []) {
  nodes.forEach(n => { out.push(n); lldAllNodes(n.subs || [], out); });
  return out;
}

function lldLocate(id, nodes = lldToc(), parent = null) {
  for (const n of nodes) {
    if (n.id === id) return { node: n, parent };
    const r = lldLocate(id, n.subs || [], n);
    if (r) return r;
  }
  return null;
}

function lldNodeLabel(n) {
  return n.cover ? `📄 ${n.title}` : `${n.num}. ${n.title}`;
}

function lldNodesWithKey(key) {
  return lldAllNodes().filter(n => Array.isArray(n.blocks) && n.blocks.includes(key));
}

function lldBtn(text, onClick, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-ghost btn-sm';
  b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// ---- Arbre du sommaire (colonne de gauche) ----
function lldRenderToc() {
  const tree = $('#lld-toc-tree');
  tree.innerHTML = '';
  if (!lldDraft) return;
  const addItem = (node, level) => {
    const item = document.createElement('div');
    item.className = 'lld-toc-item' + (level ? ' lld-toc-sub' : '') +
      (node.id === lldSelId ? ' active' : '');
    item.dataset.id = node.id;
    if (node.custom) item.dataset.custom = '1';
    const nb = (node.blocks || []).length;
    const num = document.createElement('span');
    num.className = 'lld-toc-num';
    num.textContent = node.cover ? '📄' : node.num;
    const span = document.createElement('span');
    span.className = 'lld-toc-title';
    span.textContent = node.title;
    item.appendChild(num);
    item.appendChild(span);
    if (nb) {
      const cnt = document.createElement('span');
      cnt.className = 'lld-toc-count';
      cnt.textContent = String(nb);
      cnt.title = `${nb} information(s) insérée(s) dans ce chapitre` +
        (nb > 1 ? ' — synchronisées entre elles si la même info est ailleurs' : '');
      item.appendChild(cnt);
    }
    item.title = 'Cliquer pour afficher les informations · double-clic sur le titre pour renommer';
    item.addEventListener('click', () => lldSelectNode(node.id));
    tree.appendChild(item);
    (node.subs || []).forEach(s => addItem(s, level + 1));
  };
  lldToc().forEach(n => addItem(n, 0));
}

// Double-clic : renommer un chapitre / sous-chapitre (repris par les exports)
function lldStartRename(item, node) {
  const span = item.querySelector('.lld-toc-title');
  if (!span || item.querySelector('.lld-toc-edit')) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'lld-toc-edit';
  inp.value = node.title;
  inp.maxLength = 120;
  inp.setAttribute('aria-label', 'Titre du chapitre');
  span.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    if (save) {
      const t = inp.value.trim().slice(0, 120);
      if (t && t !== node.title) { lldPushUndo(true); node.title = t; }
    }
    lldRenderToc();
    if (lldSelId === node.id) {
      const loc = lldLocate(node.id);
      if (loc) lldRenderDetail(loc.node);   // rafraîchit le titre de droite
    }
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('click', e => e.stopPropagation());
}

function lldSelectNode(id) {
  if (!lldDraft) return;
  lldFlushDetail();                 // les saisies du panneau précédent sont gardées
  const loc = lldLocate(id);
  if (!loc) return;
  lldSelId = id;
  // Ne PAS reconstruire l'arbre ici : remplacer les éléments au 1er clic
  // empêcherait l'événement dblclick (renommage) de se déclencher.
  $('#lld-toc-tree').querySelectorAll('.lld-toc-item').forEach(it => {
    it.classList.toggle('active', it.dataset.id === id);
  });
  lldRenderDetail(loc.node);
}

// ---- Lecture des panneaux ouverts vers le brouillon ----
function lldFlushDetail() {
  if (!lldDraft) return;
  const body = $('#lld-detail-body');
  if (!body || body.classList.contains('hidden')) return;
  body.querySelectorAll('.lld-info[data-key]').forEach(sec => {
    const def = lldInfoDef(sec.dataset.key);
    if (!def) return;
    const box = sec.querySelector('.lld-info-body');
    if (box) lldInfoFlush(box, def, sec.dataset.key);
  });
}

function lldInfoFlush(box, def, key) {
  if (!lldDraft) return;
  const L = lldDraft.lld;
  switch (def.kind) {
    case 'fields': {
      const tgt = def.path ? (L[def.path] = L[def.path] || {}) : L;
      box.querySelectorAll('[data-fk]').forEach(el => {
        const f = def.fields.find(x => x.k === el.dataset.fk);
        tgt[el.dataset.fk] = String(el.value || '').slice(0, (f && f.max) || 200);
      });
      break;
    }
    case 'textarea': {
      const el = box.querySelector('textarea');
      if (!el) break;
      const v = String(el.value || '').slice(0, def.max || 4000);
      if (def.catKey) { L.catNotes = L.catNotes || {}; L.catNotes[def.catKey] = v; }
      else L[key] = v;
      break;
    }
    case 'table': {
      const tbl = box.querySelector('.lld-grid-wrap');
      if (tbl) {
        const rows = lldRowsFrom(tbl);
        if (key === 'fais' && Array.isArray(L.fais)) {
          L.fais = rows.map((r, i) => Object.assign({}, L.fais[i] || {}, r, {
            desc: String(r.desc || '').slice(0, 120),
            cat: r.cat || 'FAI'
          }));
          L.fais.forEach(f => {
            if (!f.operator && f.desc) {
              const p = String(f.desc).split(' — ');
              f.operator = p[0].slice(0, 60);
              f.offer = (p[1] || '').slice(0, 60);
            }
          });
        } else {
          L[key] = rows;
        }
      }
      break;
    }
    case 'sites': {
      const wrap = box.querySelector('.lld-sites-wrap');
      if (!wrap) break;
      lldDraft.sites = lldSitesFrom(wrap);
      break;
    }
    case 'fais': {
      const wrap = box.querySelector('.lld-fais-wrap');
      if (wrap) L.fais = lldFaisFrom(wrap);
      break;
    }
    case 'zones': {
      const tbl = box.querySelector('.lld-grid-wrap');
      if (!tbl) break;
      L.swZones = lldZonesFrom(tbl);
      break;
    }
    case 'flows': {
      const wrap = box.querySelector('.lld-flows-wrap');
      if (!wrap) break;
      lldDraft.flows = lldFlowsFrom(wrap);
      break;
    }
    case 'governance': {
      const revs = box.querySelector('[data-g="revs"]');
      const appr = box.querySelector('[data-g="approvers"]');
      const revi = box.querySelector('[data-g="reviewers"]');
      if (revs) L.revs = lldRowsFrom(revs);
      if (appr) L.approvers = lldRowsFrom(appr);
      if (revi) L.reviewers = lldRowsFrom(revi);
      break;
    }
    case 'shots': {
      // La liste est mutée en place par le rendu (drag & drop) ; on la ré-écrit
      // depuis le DOM pour rester synchrone si le listener n'a pas tourné.
      const grid = box.querySelector('.lld-shots-grid');
      if (grid && lldDraft) {
        // rien à lire des inputs : les dataUrl sont déjà dans L[key] via paint
        if (!Array.isArray(L[key])) L[key] = [];
      }
      break;
    }
    case 'diagram': {
      // Diagramme stocké dans L.diagrams[mode] lors de la génération.
      break;
    }
    case 'ch4matrix': {
      // Toutes les cellules de valeurs sont éditables :
      //  - data-mx  → champs structurés (vpns / aliases / fwProfiles) ;
      //  - data-ch4 → surcharge libre « C19 », « D6 »… appliquée à l'export Excel.
      // Une valeur revenue à sa base auto est retirée de ch4ov (le recalcul suit).
      L.vpns = L.vpns && Array.isArray(L.vpns) ? L.vpns : [];
      L.aliases = L.aliases && Array.isArray(L.aliases) ? L.aliases : [];
      L.fwProfiles = L.fwProfiles && typeof L.fwProfiles === 'object' ? L.fwProfiles : {};
      while (L.vpns.length < 4) L.vpns.push({ name: '', peer: '' });
      while (L.aliases.length < 9) L.aliases.push({ name: '', value: '' });
      if (!L.ch4ov || typeof L.ch4ov !== 'object' || Array.isArray(L.ch4ov)) L.ch4ov = {};
      box.querySelectorAll('[data-mx]').forEach(el => {
        const path = String(el.dataset.mx || '');
        const v = String(el.value || '').slice(0, 80);
        const m = /^(vpns|aliases)\.(\d+)\.(name|peer|value)$/.exec(path);
        if (m) {
          const i = +m[2];
          const arr = L[m[1]];
          if (arr && arr[i]) {
            if (m[1] === 'vpns') arr[i][m[3] === 'peer' ? 'peer' : 'name'] = v;
            else arr[i][m[3] === 'value' ? 'value' : 'name'] = v;
          }
          return;
        }
        const mf = /^fwProfiles\.(vpnSsl|appCtrl|webBlocker|httpProxy)$/.exec(path);
        if (mf) L.fwProfiles[mf[1]] = v.slice(0, 60);
      });
      box.querySelectorAll('[data-ch4]').forEach(el => {
        const ref = String(el.dataset.ch4 || '');
        if (!/^[C-H]\d{1,3}$/.test(ref)) return;
        const v = String(el.value || '').slice(0, 80);
        const base = String(el.dataset.base || '');
        if (v !== base) L.ch4ov[ref] = v;
        else delete L.ch4ov[ref];
      });
      break;
    }
  }
}

// ---- Rendu d'une information dans le panneau de droite ----
// Valeur d'une cellule auto de la matrice ch. 4 (miroir simplifié de ch4()).
function lldCh4Auto(ws, L, row, col) {
  // row = index 0-based dans le bloc ; col: 'ip'|'mask'|'gw'|'dns'|'nomen'
  const fais = (L.fais && L.fais.length) ? L.fais : (L.fai && L.fai.operator ? [L.fai] : []);
  const shortName = s => String(s || '').split(/[ (—]/)[0].trim();
  const ipFrom = s => { const m = /((?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?)/.exec(String(s || '')); return m ? m[1] : ''; };
  // FAI 0-2 (lignes 6-8 ET WAN 1-3 12-14 : même adressage WAN)
  if ((row >= 0 && row <= 2) || (row >= 6 && row <= 8)) {
    const i = row >= 6 ? row - 6 : row;
    const f = fais[i] || {};
    if (col === 'ip') return f.wanIp || (f.ipMode ? f.ipMode : '');
    if (col === 'mask') return f.wanMask || '';
    if (col === 'gw') return f.wanGw || '';
    if (col === 'dns') return f.wanDns || '';
  }
  const ic = L.interco || {};
  if (row === 3 && col === 'nomen') return shortName(ic.epA);           // Peplink 1 / epA
  if (row === 3 && col === 'ip') return ipFrom(ic.epA);
  if (row === 4 && col === 'nomen') return shortName(ic.epB);
  if (row === 4 && col === 'ip') return ipFrom(ic.epB);
  if (row === 5 && col === 'ip') return ic.vipA || '';                  // VIP
  if (row >= 13 && row <= 14) {                                         // FW1/FW2 (19-20)
    const fws = (ws.racks || []).flatMap(r => r.instances)
      .filter(x => ['firewall', 'router'].includes(x.cat));
    const x = fws[row - 13];
    if (x) return col === 'nomen' ? (x.name || '') : (col === 'ip' ? (x.ipMgmt || '') : '');
  }
  if (row === 15 && col === 'nomen') {                                  // NAT
    const nat = (L.fw || []).find(r0 => /nat/i.test(r0.type || ''));
    return nat ? (nat.name || '') : '';
  }
  if (row === 15 && col === 'ip') {
    const nat = (L.fw || []).find(r0 => /nat/i.test(r0.type || ''));
    return nat ? (nat.dst || '') : '';
  }
  if (row === 16) return 'N/A';                                         // Cluster Firewall
  if (row >= 45 && row <= 46) {                                         // Master/Slave mgmt
    if (col === 'nomen') return row === 45 ? (ic.mgmtA || '') : (ic.mgmtB || '');
  }
  if (row >= 47 && row <= 50) {                                         // Cluster ifaces
    if (col === 'nomen') {
      if (row === 47) return ic.clusterA || '';
      if (row === 49) return ic.clusterB || '';
      return row === 48 ? 'Cluster 2' : 'Cluster 1';
    }
  }
  return '';
}

// Construit la matrice ch. 4 : même disposition que la feuille Excel « 4 »
// (catégories fusionnées, mêmes descriptions) — cellules éditables là où
// l'app stocke les données (VPN, alias, profils), le reste en lecture seule.
function lldBuildCh4Matrix(L) {
  const ws = active() || { racks: [] };
  const wrap = document.createElement('div');
  wrap.className = 'lld-mx-wrap';
  const t = document.createElement('table');
  t.className = 'lld-grid lld-mx';
  // En-tête 2 niveaux comme Excel (Adressage IP / IP Mask GW DNS)
  t.innerHTML =
    '<thead>'
    + '<tr><th rowspan="2">Catégorie</th><th rowspan="2">Description</th>'
    + '<th rowspan="2">Nomenclature</th><th colspan="4">Adressage IP</th>'
    + '<th rowspan="2">Commentaire</th></tr>'
    + '<tr><th>IP</th><th>Mask</th><th>GW</th><th>DNS</th></tr>'
    + '</thead><tbody></tbody>';
  const tb = t.querySelector('tbody');

  // Libellés Description exactement comme le template Excel
  const DESCS = [];
  ['FTTH 1', 'FTTH 2', 'FTTH 3'].forEach(d => DESCS.push(d));
  ['Equipment Peplink 1', 'Equipment Peplink 2', 'VIP (Virtual IP)',
   'WAN 1', 'WAN 2', 'WAN 3',
   'VPN S2S 1', 'VPN S2S 2', 'VPN S2S 3', 'VPN S2S 4'].forEach(d => DESCS.push(d));
  ['Equipment Firewall 1', 'Equipment Firewall 2', 'NAT 1-to-1', 'Cluster Firewall', ''].forEach(d => DESCS.push(d));
  // Alias 9 (r24-32) — libellé template ; la valeur éditable = name/value app
  for (let i = 0; i < 9; i++) DESCS.push('Alias Firewall');
  DESCS.push('Regle Firewall');
  ['VPN SSL users', 'Application Control', 'WebBlocker', 'HTTP Proxy'].forEach(d => DESCS.push(d));
  // VLANs firewall site A (r38-49 = 12) + VM1/suites site B (r50-63 = 14)
  const VLAN_DESCS_A = ['VLAN DMZ Serveurs', 'VLAN Storage', 'VLAN UPS', 'VLAN Manegement',
    'VLAN Users Wired', 'VLAN Users Wireless', 'VLAN Printers', 'VLAN IDS',
    'VLAN CCTV', 'VLAN SPO', 'VLAN VOIP-TOIP', 'VLAN iDRAC'];
  const VLAN_DESCS_B = ['VLAN VM1', 'VLAN DMZ Serveurs', 'VLAN Storage', 'VLAN UPS',
    'VLAN Manegement', 'VLAN Users Wired', 'VLAN Users Wireless', 'VLAN Printers',
    'VLAN IDS', 'VLAN CCTV', 'VLAN SPO', 'VLAN VOIP-TOIP', 'VLAN iDRAC', 'VLAN VM2'];
  VLAN_DESCS_A.forEach(d => DESCS.push(d));
  VLAN_DESCS_B.forEach(d => DESCS.push(d));
  ['Master mgmt', 'Slave mgmt',
   'Cluster interface Master', 'Cluster interface Master',
   'Cluster interface Slave', 'Cluster interface Slave'].forEach(d => DESCS.push(d));
  // Switch (30) : SW-1..6 + 12 VLANs site A + 12 VLANs site B (r88-99)
  for (let i = 1; i <= 6; i++) DESCS.push(`Switch ${i}`);
  VLAN_DESCS_A.forEach(d => DESCS.push(' ' + d));
  VLAN_DESCS_B.slice(0, 12).forEach(d => DESCS.push(' ' + d));
  ['Serveur Physique 1', 'iDRAC 1', 'WSUS Sec', 'VBR', 'BC-PRI', 'WEB-PRI', 'Mgmt 1', 'Mgmt 2'].forEach(d => DESCS.push(d));
  ['SAN', 'Mgmt 1', 'Mgmt 2', 'ISCSI 1', 'ISCSI 2'].forEach(d => DESCS.push(d));
  ['VM BI1', 'VM BC1', 'VM AD1', 'VM Web1', 'VM BI2', 'VM BC2', 'VM AD2', 'VM Web2'].forEach(d => DESCS.push(d));
  for (let i = 0; i < 6; i++) DESCS.push("Point d'accès");
  ['Printer 1', 'Printer 2', 'Printer 3', 'Printer 1'].forEach(d => DESCS.push(d));
  ['UPS 1', 'UPS 2'].forEach(d => DESCS.push(d));
  ['Centrale 1', 'Centrale 2'].forEach(d => DESCS.push(d));
  DESCS.push('NVR 1');
  DESCS.push('Pointeuse 1');
  DESCS.push('Clime 1');
  const totalRows = DESCS.length;   // doit valoir 132 (6→137 Excel)

  const vpns = L.vpns || [];
  const aliases = L.aliases || [];
  const fp = L.fwProfiles || {};
  const vlans = L.vlans || [];
  // Nomenclature des lignes VLAN de la matrice : réutilise l'appariement mots-clés
  const KW = [
    [/dmz/i, 'DMZ'], [/storage/i, 'Storage'], [/ups|onduleur/i, 'UPS'],
    [/manegement|management|mgmt/i, 'Manegement'],
    [/users wired|\bwired\b/i, 'Users Wired'],
    [/wireless|wifi|wlan/i, 'Users Wireless'],
    [/print/i, 'Printers'], [/\bids\b|intrusion/i, 'IDS'],
    [/cctv|cam/i, 'CCTV'], [/\bspo\b|pointage/i, 'SPO'],
    [/voip|toip/i, 'VOIP-TOIP'], [/idrac/i, 'iDRAC'],
    [/\bvm\s?1\b|\bvm1\b/i, 'VM1'], [/\bvm\s?2\b|\bvm2\b/i, 'VM2']
  ];
  const isSiteB = v => /agence|rabat|site\s?b/i.test(v.site || '');
  const vlanNomen = (desc, rowInFirewall) => {
    // lignes 38-63 Excel : rowInFirewall 0..49 ; site A si < 12, B ensuite (approx)
    const clean = String(desc).trim();
    const hit = KW.find(([re]) => re.test(clean));
    if (!hit) return '';
    const siteB = rowInFirewall >= 12 && !/VM1/i.test(clean);
    const cands = vlans.filter(v => v.vid && (siteB ? isSiteB(v) : !isSiteB(v)));
    const v = cands.find(x => (x.name || '').toLowerCase().includes(hit[1].toLowerCase()))
      || cands.find(x => (x.purpose || '').toLowerCase().includes(hit[1].toLowerCase()))
      || cands.find(x => (x.name || '').toLowerCase().includes(clean.toLowerCase().replace(/^vlan\s*/i, '')));
    return v ? `VLAN ${v.vid}` : '';
  };

  const mkCell = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const ch4ov = (L.ch4ov && typeof L.ch4ov === 'object' && !Array.isArray(L.ch4ov)) ? L.ch4ov : {};
  // Une cellule de valeur : input unique. path = champ structuré (mx),
  // sinon ref Excel (ch4) + valeur de base pour détecter une surcharge.
  const fillCell = (td, ref, { path, auto, val, ph } = {}) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 80;
    inp.placeholder = ph || '';
    if (path) {
      // Champ structuré (VPN / alias / profil) : exporté aussi dans le PDF
      inp.dataset.mx = path;
      inp.value = String(val || '');
    } else {
      // Cellule libre : surcharge ch4ov si présente, sinon valeur auto.
      // data-base garde l'auto pour que le flush retire la surcharge si on
      // revient à l'original (le recalcul devices/FAI reprend la main).
      inp.dataset.ch4 = ref;
      const autoS = String(auto || '');
      inp.dataset.base = autoS;
      inp.value = Object.prototype.hasOwnProperty.call(ch4ov, ref)
        ? String(ch4ov[ref] || '') : autoS;
    }
    td.className = 'lld-mx-edit';
    td.appendChild(inp);
    return td;
  };

  // --- Rendu segmenté par catégories (rowspan identique aux fusions A de l'Excel) ---
  tb.innerHTML = '';
  let idx = 0;
  {
    for (const [catLabel, span] of LLD_CH4_CATS) {
      for (let s = 0; s < span; s++) {
        const tr = document.createElement('tr');
        if (s === 0) {
          const tdC = mkCell('td', 'lld-mx-cat');
          tdC.rowSpan = span;
          tdC.textContent = catLabel;
          tr.appendChild(tdC);
        }
        const desc = DESCS[idx] != null ? DESCS[idx] : '';
        tr.appendChild(mkCell('td', 'lld-mx-desc', desc));
        const row = idx;   // 0 = ligne Excel 6
        const excelR = 6 + idx;

        // Valeurs auto (miroir ch4) — servent de base aux cellules libres
        let autoN = lldCh4Auto(ws, L, row, 'nomen');
        let autoIP = lldCh4Auto(ws, L, row, 'ip');
        const autoMask = lldCh4Auto(ws, L, row, 'mask');
        const autoGw = lldCh4Auto(ws, L, row, 'gw');
        const autoDns = lldCh4Auto(ws, L, row, 'dns');
        if (excelR >= 38 && excelR <= 63) autoN = vlanNomen(desc, excelR - 38);
        if (excelR >= 76 && excelR <= 99) {
          const off = excelR < 88 ? excelR - 76 : excelR - 88;
          const list = excelR < 88 ? VLAN_DESCS_A : VLAN_DESCS_B;
          autoN = vlanNomen(list[off] || desc, excelR < 88 ? off : off + 12)
            || (vlans[off] ? `VLAN ${vlans[off].vid}` : '');
        }
        if (excelR >= 70 && excelR <= 75) {
          const sws = (ws.racks || []).flatMap(r => r.instances).filter(x => x.cat === 'switch');
          const sw = sws[excelR - 70];
          autoN = sw ? (sw.name || '') : `SW-${excelR - 69}`;
          autoIP = sw ? (sw.ipMgmt || '') : autoIP;
        }
        if (excelR === 100) {
          const srvs = (ws.racks || []).flatMap(r => r.instances).filter(x => x.cat === 'server');
          if (srvs[0]) { autoN = srvs[0].name || ''; autoIP = srvs[0].ipMgmt || ''; }
        }
        if (excelR === 108) {
          const stos = (ws.racks || []).flatMap(r => r.instances).filter(x => x.cat === 'storage');
          if (stos[0]) { autoN = stos[0].name || ''; autoIP = stos[0].ipMgmt || ''; }
        }
        if (excelR >= 121 && excelR <= 126) {
          const aps = (ws.racks || []).flatMap(r => r.instances).filter(x => x.cat === 'ap');
          const x = aps[excelR - 121];
          if (x) { autoN = x.name || ''; autoIP = x.ipMgmt || ''; }
        }

        const tdN = document.createElement('td');
        const tdI = document.createElement('td');
        const tdM = document.createElement('td');
        const tdG = document.createElement('td');
        const tdD = document.createElement('td');
        const tdCmt = document.createElement('td');

        // — liens structurés (toujours exportés tels quels) —
        let pathN = null, pathI = null, valN = null, valI = null;
        if (excelR >= 15 && excelR <= 18) {
          const v = vpns[excelR - 15] || {};
          pathN = `vpns.${excelR - 15}.name`; valN = v.name;
          pathI = `vpns.${excelR - 15}.peer`; valI = v.peer;
          autoN = ''; autoIP = '';   // base = champ structuré
        } else if (excelR >= 24 && excelR <= 32) {
          const a = aliases[excelR - 24] || {};
          pathN = `aliases.${excelR - 24}.name`; valN = a.name;
          pathI = `aliases.${excelR - 24}.value`; valI = a.value;
          autoN = ''; autoIP = '';
        } else if (excelR >= 34 && excelR <= 37) {
          const keys = ['vpnSsl', 'appCtrl', 'webBlocker', 'httpProxy'];
          const k = keys[excelR - 34];
          pathN = `fwProfiles.${k}`; valN = fp[k];
          autoN = '';
        }

        fillCell(tdN, `C${excelR}`, pathN ? { path: pathN, val: valN } : { auto: autoN });
        fillCell(tdI, `D${excelR}`, pathI ? { path: pathI, val: valI } : { auto: autoIP });
        fillCell(tdM, `E${excelR}`, { auto: autoMask });
        fillCell(tdG, `F${excelR}`, { auto: autoGw });
        fillCell(tdD, `G${excelR}`, { auto: autoDns });
        fillCell(tdCmt, `H${excelR}`, { auto: '' });

        tr.appendChild(tdN);
        tr.appendChild(tdI);
        tr.appendChild(tdM);
        tr.appendChild(tdG);
        tr.appendChild(tdD);
        tr.appendChild(tdCmt);
        tb.appendChild(tr);
        idx++;
      }
    }
  }

  wrap.appendChild(t);
  const note = document.createElement('p');
  note.className = 'lld-hint lld-mx-note';
  note.textContent = 'Toutes les cellules de valeurs sont modifiables (Enregistrer pour valider). '
    + 'Valeur modifiée = surcharge appliquée à l’export Excel ; revenue à l’original = recalcul auto depuis devices / FAI.';
  wrap.appendChild(note);
  return wrap;
}

// ---- Rack FAI (5 routeurs) à gauche des baies + liens topo ----
function lldEnsureFaiRack(ws) {
  if (!ws || !Array.isArray(ws.racks)) return null;
  // Déjà présent ?
  let rack = ws.racks.find(r => /(^|\s)FAI(\s|$)|Accès FAI|Routeurs FAI/i.test(String(r.name || '')));
  if (rack) return rack;
  const tpl = (state && Array.isArray(state.devices)
    ? state.devices.find(d => d.cat === 'router' || d.cat === 'firewall')
    : null) || null;
  const minX = ws.racks.length ? Math.min(...ws.racks.map(r => Number(r.x) || 0)) : 200;
  const minY = ws.racks.length ? Math.min(...ws.racks.map(r => Number(r.y) || 0)) : 120;
  rack = normalizeRack({
    id: uid(),
    name: 'RACK FAI — Accès opérateurs',
    x: Math.max(0, minX - RACK_W - 90),
    y: Math.max(0, minY),
    sizeU: 12,
    siteId: (ws.racks[0] && ws.racks[0].siteId) || '',
    instances: []
  });
  const base = tpl || {};
  for (let i = 0; i < 5; i++) {
    const id = uid();
    rack.instances.push({
      id,
      deviceId: base.id || '',
      name: `ISP-RTR-${i + 1}`,
      sizeU: 1,
      photo: '',
      cat: 'router',
      slot: i,
      brand: base.brand || 'Cisco',
      model: base.model || 'ISR 4321',
      partRef: base.partRef || '',
      serial: '',
      ipMgmt: `10.255.0.${10 + i}`,
      vlan: 'VLAN 99 — Mgmt',
      warranty: '',
      warrantyEnd: '',
      watts: base.watts || 30,
      weightKg: base.weightKg || 3,
      ports: []
    });
  }
  ws.racks.push(rack);
  // Noeuds topo + liens vers le 1er firewall de chaque autre rack
  if (!ws.topology || !Array.isArray(ws.topology.nodes)) ws.topology = { nodes: [], links: [] };
  const topo = ws.topology;
  const fws = [];
  ws.racks.forEach(r => {
    if (r.id === rack.id) return;
    r.instances.filter(i => i.cat === 'firewall').forEach(inst => fws.push({ r, inst }));
  });
  const isps = rack.instances.map((inst, i) => {
    let n = topo.nodes.find(x => x.instId === inst.id);
    if (!n) {
      n = { id: uid(), instId: inst.id, x: 40, y: 60 + i * 110 };
      topo.nodes.push(n);
    }
    return n;
  });
  fws.slice(0, 2).forEach((fw, i) => {
    let n = topo.nodes.find(x => x.instId === fw.inst.id);
    if (!n) {
      n = { id: uid(), instId: fw.inst.id, x: 360, y: 60 + i * 160 };
      topo.nodes.push(n);
    }
    // 2 ISP par firewall + 1 en secours sur le 1er
    const pair = i === 0 ? [isps[0], isps[1], isps[4]] : [isps[2], isps[3]];
    pair.filter(Boolean).forEach(isp => {
      if (topo.links.some(l => (l.a === isp.id && l.b === n.id) || (l.b === isp.id && l.a === n.id))) return;
      topo.links.push({
        id: uid(), a: isp.id, b: n.id,
        label: i === 0 && isp === isps[4] ? 'Secours 5G' : 'Transit FAI',
        speed: '1 Gb/s', vlan: '', style: 'solid', color: '#f59e0b'
      });
    });
  });
  return rack;
}

// ---- Diagrammes ch. 5/6/7 : structure + génération depuis l'élévation ----
function lldDiagColors(kind) {
  return {
    cloud: '#38bdf8', fai: '#f59e0b', router: '#38bdf8', fw: '#f87171',
    switch: '#60a5fa', site: '#a78bfa', lan: '#34d399', internet: '#94a3b8'
  }[kind] || '#60a5fa';
}

function lldBuildDiagData(ws, mode) {
  const L = (ws && ws.lld) || {};
  const nodes = [];
  const links = [];
  const add = (id, x, y, label, sub, kind, w = 150, h = 56) => {
    nodes.push({ id, x, y, label, sub, kind, w, h });
    return id;
  };
  const byCat = cat => (ws.racks || []).flatMap(r =>
    r.instances.filter(i => i.cat === cat).map(inst => ({ rack: r, inst })));

  if (mode === 'fai') {
    // FAI au centre (ou « Internet » si aucun FAI saisi)
    const fais = (L.fais && L.fais.length) ? L.fais
      : (L.fai && (L.fai.operator || L.fai.cpe) ? [L.fai] : []);
    const cx = 300, cy = 160;
    if (fais.length) {
      fais.slice(0, 3).forEach((f, i) => {
        add(`fai${i}`, cx - 75, cy - 90 + i * 78,
          f.operator || `FAI ${i + 1}`,
          [f.offer, f.down, f.wanIp].filter(Boolean).join(' · ') || f.linkType || '',
          'fai');
      });
    } else {
      add('fai0', cx - 75, cy - 40, 'Internet / FAI', 'Renseignez les FAI (5.1)', 'cloud');
    }
    // Routeurs / firewall reliés
    const rtrs = byCat('router');
    const fws = byCat('firewall');
    rtrs.forEach((x, i) => {
      const id = `r${i}`;
      add(id, 40, 40 + i * 90, x.inst.name || 'Routeur',
        [x.inst.brand, x.inst.model, x.inst.ipMgmt].filter(Boolean).join(' · '),
        'router');
      links.push({ a: fais.length ? `fai${Math.min(i, fais.length - 1)}` : 'fai0', b: id,
        label: 'WAN', color: '#f59e0b' });
    });
    fws.slice(0, 4).forEach((x, i) => {
      const id = `fw${i}`;
      add(id, 520, 40 + i * 90, x.inst.name || 'Pare-feu',
        [x.inst.brand, x.inst.model, x.inst.ipMgmt].filter(Boolean).join(' · '),
        'fw');
      const r = rtrs[i] ? `r${i}` : (fais.length ? `fai${Math.min(i, fais.length - 1)}` : 'fai0');
      links.push({ a: r, b: id, label: 'Transit', color: '#f87171' });
    });
    // Switchs (échantillon)
    byCat('switch').slice(0, 3).forEach((x, i) => {
      const id = `s${i}`;
      add(id, 520, 320 + i * 80, x.inst.name || 'Switch',
        x.inst.ipMgmt || '', 'switch');
      if (fws[i]) links.push({ a: `fw${i}`, b: id, label: 'LAN', color: '#60a5fa' });
      else if (fws[0]) links.push({ a: 'fw0', b: id, label: 'LAN', color: '#60a5fa' });
    });
  } else if (mode === 'interco') {
    const ic = L.interco || {};
    const sites = (ws.sites && ws.sites.length) ? ws.sites : [{ name: 'Site A' }, { name: 'Site B' }];
    add('sa', 30, 120, String(sites[0].name || 'Site A').slice(0, 40),
      ic.localSubnets || '', 'site', 170, 64);
    add('sb', 520, 120, String(sites[1] ? sites[1].name : 'Site B').slice(0, 40),
      ic.remoteSubnets || '', 'site', 170, 64);
    const tunLabel = String(ic.tech || 'Tunnel SD-WAN / IPsec').slice(0, 26);
    // sous-titre court : algorithme d'interco si présent, sinon technique
    let tunSub = String(ic.encryption || ic.tech || 'interco site ↔ site').trim();
    if (tunSub.length > 28) tunSub = tunSub.split(/[\s—-]+/)[0].slice(0, 28) || 'chiffré';
    add('tun', 270, 130, tunLabel, tunSub, 'fai', 180, 64);
    const shortEp = (ep) => {
      const s = String(ep || '');
      const ip = (s.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || [])[0];
      return ip ? 'WAN ' + ip : (s ? s.slice(0, 18) : 'WAN');
    };
    links.push({ a: 'sa', b: 'tun', label: shortEp(ic.epA) || 'Endpoint A', color: '#a78bfa' });
    links.push({ a: 'tun', b: 'sb', label: shortEp(ic.epB) || 'Endpoint B', color: '#a78bfa' });
    // Routeurs des 2 sites
    const rtrs = byCat('router');
    if (rtrs[0]) {
      add('ra', 30, 240, rtrs[0].inst.name || 'RTR-A', rtrs[0].inst.ipMgmt || '', 'router');
      links.push({ a: 'sa', b: 'ra', label: 'LAN', color: '#60a5fa' });
    }
    if (rtrs[1]) {
      add('rb', 520, 240, rtrs[1].inst.name || 'RTR-B', rtrs[1].inst.ipMgmt || '', 'router');
      links.push({ a: 'sb', b: 'rb', label: 'LAN', color: '#60a5fa' });
    }
    // VPN listés
    (L.vpns || []).slice(0, 3).forEach((v, i) => {
      if (!v.name && !v.peer) return;
      const id = `v${i}`;
      add(id, 250, 300 + i * 70, v.name || `VPN ${i + 1}`, v.peer || '', 'lan', 190, 52);
      links.push({ a: 'tun', b: id, label: 'S2S', color: '#34d399', dashed: true });
    });
  } else { // fw
    const fws = byCat('firewall');
    const fw = fws[0];
    add('fwc', 270, 150, fw ? (fw.inst.name || 'Firewall') : 'Firewall',
      fw ? [fw.inst.brand, fw.inst.model, fw.inst.ipMgmt].filter(Boolean).join(' · ')
         : 'Placez un pare-feu dans l’élévation',
      'fw', 170, 64);
    const fais = (L.fais && L.fais.length) ? L.fais : (L.fai && L.fai.operator ? [L.fai] : []);
    add('wan', 40, 40, fais[0] ? (fais[0].operator || 'FAI') : 'WAN / Internet',
      fais[0] ? (fais[0].wanIp || fais[0].offer || '') : '', 'fai');
    links.push({ a: 'wan', b: 'fwc', label: 'WAN', color: '#f59e0b' });
    // FAI rack ISP
    const isps = byCat('router').filter(x => /ISP|FAI/i.test(x.inst.name || ''));
    const others = byCat('router').filter(x => !/ISP|FAI/i.test(x.inst.name || ''));
    [...isps, ...others].slice(0, 4).forEach((x, i) => {
      const id = `r${i}`;
      add(id, 40, 140 + i * 80, x.inst.name || 'Routeur', x.inst.ipMgmt || '', 'router');
      links.push({ a: id, b: 'fwc', label: 'Transit', color: '#f59e0b' });
    });
    byCat('switch').slice(0, 4).forEach((x, i) => {
      const id = `s${i}`;
      add(id, 520, 40 + i * 80, x.inst.name || 'Switch', x.inst.ipMgmt || '', 'switch');
      links.push({ a: 'fwc', b: id, label: 'LAN', color: '#60a5fa' });
    });
    const zones = (L.swZones || []).slice(0, 3);
    zones.forEach((z, i) => {
      const id = `z${i}`;
      add(id, 520, 380 + i * 70, z.name || `Zone ${i + 1}`, z.vlans ? 'VLAN ' + z.vlans : '', 'lan', 160, 52);
      links.push({ a: 'fwc', b: id, label: 'Zone', color: '#34d399', dashed: true });
    });
  }
  return { nodes, links };
}

function lldRenderDiagSvg(diag) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const nodes = (diag && diag.nodes) || [];
  const links = (diag && diag.links) || [];
  let maxX = 720, maxY = 420;
  nodes.forEach(n => {
    maxX = Math.max(maxX, (n.x || 0) + (n.w || 150) + 24);
    maxY = Math.max(maxY, (n.y || 0) + (n.h || 56) + 24);
  });
  const vbW = Math.max(maxX, 720), vbH = Math.max(maxY, 360);
  svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('class', 'lld-diag-svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(Math.round(vbH)));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // fond légèrement contrasté pour que le schéma se détache
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', 0); bg.setAttribute('y', 0);
  bg.setAttribute('width', vbW); bg.setAttribute('height', vbH);
  bg.setAttribute('fill', '#0b1220');
  bg.setAttribute('rx', 8);
  svg.appendChild(bg);
  // marqueurs de flèche
  const defs = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id', 'lld-diag-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const mpath = document.createElementNS(NS, 'path');
  mpath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  mpath.setAttribute('fill', '#94a3b9');
  marker.appendChild(mpath);
  defs.appendChild(marker);
  svg.appendChild(defs);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  // liens
  links.forEach(l => {
    const a = byId[l.a], b = byId[l.b];
    if (!a || !b) return;
    const aw = a.w || 150, ah = a.h || 56, bw = b.w || 150, bh = b.h || 56;
    const x1 = (a.x || 0) + aw / 2, y1 = (a.y || 0) + ah / 2;
    const x2 = (b.x || 0) + bw / 2, y2 = (b.y || 0) + bh / 2;
    const color = l.color || '#60a5fa';
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);           // fallback sans CSS
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    if (l.dashed) line.setAttribute('stroke-dasharray', '7 5');
    line.setAttribute('marker-end', 'url(#lld-diag-arrow)');
    svg.appendChild(line);
    if (l.label) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (x1 + x2) / 2);
      t.setAttribute('y', (y1 + y2) / 2 - 7);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'lld-diag-link-label');
      t.setAttribute('fill', '#e2e8f0');
      t.setAttribute('font-size', '11');
      t.setAttribute('font-weight', '700');
      t.setAttribute('stroke', '#0b1220');
      t.setAttribute('stroke-width', '3');
      t.setAttribute('paint-order', 'stroke');
      t.textContent = String(l.label).slice(0, 36);
      svg.appendChild(t);
    }
  });
  // noeuds (cartes)
  nodes.forEach(n => {
    const g = document.createElementNS(NS, 'g');
    const w = n.w || 150, h = n.h || 56;
    const x = n.x || 0, y = n.y || 0;
    const kind = n.kind || 'dev';
    const accent = lldDiagColors(kind);
    // ombre
    const sh = document.createElementNS(NS, 'rect');
    sh.setAttribute('x', x + 2); sh.setAttribute('y', y + 3);
    sh.setAttribute('width', w); sh.setAttribute('height', h);
    sh.setAttribute('rx', 10);
    sh.setAttribute('fill', 'rgba(0,0,0,.35)');
    g.appendChild(sh);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 10);
    rect.setAttribute('class', 'lld-diag-node lld-diag-' + kind);
    rect.setAttribute('fill', '#1e293b');         // fallback sans CSS
    rect.setAttribute('stroke', accent);
    rect.setAttribute('stroke-width', '2');
    g.appendChild(rect);
    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('x', x); bar.setAttribute('y', y + 8);
    bar.setAttribute('width', 6); bar.setAttribute('height', Math.max(8, h - 16));
    bar.setAttribute('rx', 3);
    bar.setAttribute('fill', accent);
    g.appendChild(bar);
    // pastille type
    const chip = document.createElementNS(NS, 'rect');
    chip.setAttribute('x', x + w - 52); chip.setAttribute('y', y + 6);
    chip.setAttribute('width', 46); chip.setAttribute('height', 16);
    chip.setAttribute('rx', 8);
    chip.setAttribute('fill', accent);
    chip.setAttribute('opacity', '0.22');
    g.appendChild(chip);
    const chipT = document.createElementNS(NS, 'text');
    chipT.setAttribute('x', x + w - 29); chipT.setAttribute('y', y + 17);
    chipT.setAttribute('text-anchor', 'middle');
    chipT.setAttribute('font-size', '9');
    chipT.setAttribute('font-weight', '700');
    chipT.setAttribute('fill', accent);
    chipT.textContent = ({ fai: 'FAI', cloud: 'WAN', router: 'RTR', fw: 'FW', switch: 'SW', site: 'SITE', lan: 'LAN', internet: 'NET' })[kind] || 'DEV';
    g.appendChild(chipT);
    const t1 = document.createElementNS(NS, 'text');
    t1.setAttribute('x', x + 14); t1.setAttribute('y', y + 24);
    t1.setAttribute('class', 'lld-diag-t');
    t1.setAttribute('fill', '#f8fafc');
    t1.setAttribute('font-size', '12.5');
    t1.setAttribute('font-weight', '700');
    t1.textContent = String(n.label || '').slice(0, 24);
    g.appendChild(t1);
    if (n.sub) {
      const t2 = document.createElementNS(NS, 'text');
      t2.setAttribute('x', x + 14); t2.setAttribute('y', y + 42);
      t2.setAttribute('class', 'lld-diag-s');
      t2.setAttribute('fill', '#94a3b8');
      t2.setAttribute('font-size', '10.5');
      t2.textContent = String(n.sub).slice(0, 30);
      g.appendChild(t2);
    }
    svg.appendChild(g);
  });
  return svg;
}

/* Rasterise les diagrammes (schéma modal) en JPEG pour l'export XLSX :
   globalThis.__LLD_DIAG_IMGS[mode] = { dataUrl, widthPx, heightPx }.
   L'appelant (bouton Export Excel) attend la promesse avant LLD_TPL.buildAll. */
function lldRenderDiagExportImgs(ws) {
  globalThis.__LLD_DIAG_IMGS = {};
  const diagrams = (ws && ws.lld && ws.lld.diagrams) || {};
  const modes = ['fai', 'interco', 'fw'];
  return Promise.all(modes.map(mode => {
    const d = diagrams[mode];
    if (!d || !(d.nodes || []).length) return null;
    try {
      const svg = lldRenderDiagSvg(d);
      let maxX = 720, maxY = 420;
      (d.nodes || []).forEach(n => {
        maxX = Math.max(maxX, (n.x || 0) + (n.w || 150) + 24);
        maxY = Math.max(maxY, (n.y || 0) + (n.h || 56) + 24);
      });
      const vbW = Math.max(maxX, 720), vbH = Math.max(maxY, 360);
      svg.setAttribute('width', String(vbW));
      svg.setAttribute('height', String(vbH));
      const xml = new XMLSerializer().serializeToString(svg);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(2, 1400 / vbW);
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(vbW * scale));
            c.height = Math.max(1, Math.round(vbH * scale));
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#0b1220';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            globalThis.__LLD_DIAG_IMGS[mode] = {
              dataUrl: c.toDataURL('image/jpeg', 0.9),
              widthPx: c.width,
              heightPx: c.height
            };
          } catch (_) { /* repli tableaux texte */ }
          resolve(null);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } catch (_) { return null; }
  })).then(() => globalThis.__LLD_DIAG_IMGS);
}

// Lecture image large (captures d'écran lisibles dans le PDF)
function lldReadShot(file) {
  return new Promise(resolve => {
    if (!file || !/^image\//.test(file.type || '')) { resolve(null); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = 1400;
      const scale = Math.min(1, maxW / img.width || 1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function lldInfoRender(box, def, key) {
  const L = lldDraft.lld;
  if (def.hint) {
    const h = document.createElement('p');
    h.className = 'lld-hint';
    h.textContent = def.hint;
    box.appendChild(h);
  }
  switch (def.kind) {
    case 'fields': {
      const tgt = def.path ? (L[def.path] || {}) : L;
      const grid = document.createElement('div');
      grid.className = 'd-grid';
      def.fields.filter(f => f.type !== 'textarea').forEach(f => {
        const lab = document.createElement('label');
        lab.textContent = f.label;
        let el;
        if (f.type === 'select') {
          el = document.createElement('select');
          (f.opts || []).forEach(o => {
            const op = document.createElement('option');
            op.value = o;
            op.textContent = o || '—';
            el.appendChild(op);
          });
        } else {
          el = document.createElement('input');
          el.type = 'text';
          el.placeholder = f.ph || '';
          el.maxLength = f.max || 200;
        }
        el.dataset.fk = f.k;
        el.value = tgt[f.k] || '';
        lab.appendChild(el);
        grid.appendChild(lab);
      });
      box.appendChild(grid);
      def.fields.filter(f => f.type === 'textarea').forEach(f => {
        const lab = document.createElement('label');
        lab.textContent = f.label;
        const el = document.createElement('textarea');
        el.rows = f.rows || 3;
        el.maxLength = f.max || 2000;
        el.placeholder = f.ph || '';
        el.dataset.fk = f.k;
        el.value = tgt[f.k] || '';
        lab.appendChild(el);
        box.appendChild(lab);
      });
      break;
    }
    case 'textarea': {
      const el = document.createElement('textarea');
      el.rows = def.rows || 3;
      el.maxLength = def.max || 4000;
      el.placeholder = def.ph || '';
      el.value = def.catKey ? String((L.catNotes || {})[def.catKey] || '') : String(L[key] || '');
      box.appendChild(el);
      break;
    }
    case 'table': {
      const cols = lldExportCols(L, key, def.cols);
      const tbl = lldMakeGrid(cols, key, def.cols);
      (L[key] || []).forEach(r => lldAddRow(tbl, cols, r));
      const acts = [
        lldBtn(def.addLabel || '＋ Ajouter une ligne', () => {
          const tr = lldAddRow(tbl, cols, Object.assign({}, def.def));
          const f = tr.querySelector('input, select');
          if (f) f.focus();
        }),
        lldAddColBtn(key, def.cols)
      ];
      if (def.extra === 'gen-nomen') {
        acts.push(lldBtn('🔎 Générer depuis les devices',
          () => { lldPushUndo(true); lldGenNomen(tbl); },
          'Détecte les préfixes utilisés par les devices et câbles posés et les ajoute à la nomenclature'));
      }
      if (def.extra === 'detect-vlans') {
        acts.push(lldBtn('🔎 Détecter depuis les ports',
          () => { lldPushUndo(true); lldDetectVlans(tbl); },
          'Ajouter automatiquement les VLANs utilisés sur les ports mais absents du registre'));
      }
      if (def.extra === 'gen-equip') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenEquip(tbl, cols); },
          'Ajoute une ligne par modèle des devices posés dans les racks (sans écraser les lignes existantes) — ces lignes alimentent le tableau 3.1 de l\'Excel'));
      }
      if (def.extra === 'gen-fai51') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenFai51(tbl, cols); },
          'Pré-remplit le tableau 5.1 depuis l’élévation et les FAI déjà connus ; les colonnes sans source restent vides'));
      }
      if (def.extra === 'gen-fai-cab') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenFaiCab(tbl, cols); },
          'Construit les lignes 5.2 (CPE → port WAN) depuis les FAI, routeurs et câbles posés'));
      }
      if (def.extra === 'gen-ic61') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenIc61(tbl, cols); },
          'Pré-remplit le tableau 6.1 (extrémités, SN, firmware, IP, HA) depuis interco, routeurs et FAI'));
      }
      if (def.extra === 'gen-ic-cab') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenIcCab(tbl, cols); },
          'Construit les lignes 6.2 (WAN/LAN interco) depuis les équipements et câbles posés'));
      }
      if (def.extra === 'gen-ic-wan') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenIcWan(tbl, cols); },
          'Pré-remplit le tableau WAN (feuille Excel « 6 ») depuis les FAI du dossier'));
      }
      if (def.extra === 'gen-ic-lan') {
        acts.push(lldBtn("🔎 Générer depuis l'élévation",
          () => { lldPushUndo(true); lldGenIcLan(tbl, cols); },
          'Pré-remplit le tableau LAN (feuille Excel « 6 ») depuis interco et le registre VLANs'));
      }
      box.appendChild(tbl);
      box.appendChild(lldGridActions(...acts));
      break;
    }
    case 'sites': {
      const cols = lldExportCols(L, 'sites', def.cols);
      const wrap = lldMakeGrid(cols, 'sites', def.cols);
      wrap.classList.add('lld-sites-wrap');
      (lldDraft.sites || []).forEach(s => lldAddRow(wrap, cols, s));
      box.appendChild(wrap);
      box.appendChild(lldGridActions(
        lldBtn(def.addLabel || '＋ Ajouter un site', () => {
          const tr = lldAddRow(wrap, cols, {});
          const f = tr.querySelector('input');
          if (f) f.focus();
        }),
        lldAddColBtn('sites', def.cols)
      ));
      break;
    }
    case 'fais': {
      const wrap = document.createElement('div');
      wrap.className = 'lld-fais-wrap';
      const fais = L.fais && L.fais.length ? L.fais : [{}];
      fais.forEach(f => lldAddFaiBlock(wrap, f));
      box.appendChild(wrap);
      box.appendChild(lldBtn(def.addLabel || '＋ Ajouter un FAI', () => {
        lldAddFaiBlock(wrap, {});
        const cards = wrap.querySelectorAll('.lld-fai');
        if (cards.length) cards[cards.length - 1].querySelector('input').focus();
      }));
      break;
    }
    case 'zones': {
      const cols = lldExportCols(L, 'zones', def.cols);
      const tbl = lldMakeGrid(cols, 'zones', def.cols);
      (L.swZones || []).forEach(z => lldAddZoneRow(tbl, z));
      box.appendChild(tbl);
      box.appendChild(lldGridActions(
        lldBtn(def.addLabel || '＋ Ajouter une zone', () => {
          const tr = lldAddZoneRow(tbl, {});
          const f = tr.querySelector('input');
          if (f) f.focus();
        }),
        lldAddColBtn('zones', def.cols)
      ));
      break;
    }
    case 'flows': {
      const cols = lldExportCols(L, 'flows', def.cols);
      const wrap = lldMakeGrid(cols, 'flows', def.cols);
      wrap.classList.add('lld-flows-wrap');
      (lldDraft.flows || []).forEach(f => lldAddRow(wrap, cols, f));
      box.appendChild(wrap);
      box.appendChild(lldGridActions(
        lldBtn(def.addLabel || '＋ Ajouter un flux', () => {
          const tr = lldAddRow(wrap, cols, {});
          const f = tr.querySelector('input');
          if (f) f.focus();
        }),
        lldAddColBtn('flows', def.cols)
      ));
      break;
    }
    case 'ch4matrix': {
      box.appendChild(lldBuildCh4Matrix(L));
      break;
    }
    case 'shots': {
      const wrap = document.createElement('div');
      wrap.className = 'lld-shots-wrap';
      const drop = document.createElement('div');
      drop.className = 'lld-shots-drop';
      drop.innerHTML = '<span>Déposez des captures ici (ou clic pour choisir un fichier)</span>';
      const fileIn = document.createElement('input');
      fileIn.type = 'file';
      fileIn.accept = 'image/*';
      fileIn.multiple = true;
      fileIn.className = 'hidden';
      drop.appendChild(fileIn);
      const grid = document.createElement('div');
      grid.className = 'lld-shots-grid';
      const list = Array.isArray(L[key]) ? L[key] : [];
      const paint = () => {
        grid.innerHTML = '';
        list.forEach((s, idx) => {
          const fig = document.createElement('figure');
          fig.className = 'lld-shot';
          const im = document.createElement('img');
          im.src = s.dataUrl;
          im.alt = s.name || '';
          im.draggable = false;
          const cap = document.createElement('figcaption');
          cap.textContent = s.name || `capture-${idx + 1}`;
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'lld-shot-del';
          del.textContent = '\u2715';
          del.title = 'Supprimer cette capture';
          del.addEventListener('click', () => {
            lldPushUndo(true);
            list.splice(idx, 1);
            if (lldDraft) lldDraft.lld[key] = list;
            { const aws = active(); if (aws) { aws.lld = aws.lld || {}; aws.lld[key] = list; touchWorkspace(aws); saveState(); } }
            paint();
          });
          fig.appendChild(im);
          fig.appendChild(cap);
          fig.appendChild(del);
          grid.appendChild(fig);
        });
      };
      paint();
      const ingest = async files => {
        const arr = [...(files || [])].slice(0, 10);
        let n = 0;
        for (const f of arr) {
          if (list.length >= 10) break;
          const r = await lldReadShot(f);
          if (!r) continue;
          lldPushUndo(true);
          list.push({ id: uid(), name: String(f.name || 'capture').slice(0, 80), ...r });
          n++;
        }
        if (lldDraft) lldDraft.lld[key] = list.slice();
        { const aws = active(); if (aws) { aws.lld = aws.lld || {}; aws.lld[key] = list.slice(); touchWorkspace(aws); saveState(); } }
        paint();
        if (!n) lldAlert('Aucune image lisible (PNG/JPG/WebP uniquement).', { title: '🖼 Captures' });
      };
      drop.addEventListener('click', () => fileIn.click());
      fileIn.addEventListener('change', () => { ingest(fileIn.files); fileIn.value = ''; });
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('over');
        ingest(e.dataTransfer && e.dataTransfer.files);
      });
      wrap.appendChild(drop);
      wrap.appendChild(grid);
      box.appendChild(wrap);
      break;
    }
    case 'diagram': {
      const wrap = document.createElement('div');
      wrap.className = 'lld-diag-wrap';
      const bar = document.createElement('div');
      bar.className = 'lld-diag-bar';
      const host = document.createElement('div');
      host.className = 'lld-diag-host';
      const mode = def.mode || 'fai';
      const paint = () => {
        host.innerHTML = '';
        const d = L.diagrams && L.diagrams[mode];
        if (d && (d.nodes || []).length) {
          host.appendChild(lldRenderDiagSvg(d));
        } else {
          const ph = document.createElement('p');
          ph.className = 'lld-diag-empty';
          ph.textContent = 'Aucun diagramme — cliquez « 🔎 Générer depuis l’élévation » pour construire le schéma à partir des racks, FAI et interco.';
          host.appendChild(ph);
        }
      };
      paint();
      const genBtn = lldBtn('🔎 Générer depuis l\'élévation', () => {
        const ws = active();
        if (!ws || !lldDraft) return;
        lldPushUndo(true);
        let rackAdded = false;
        if (mode === 'fai') {
          const before = ws.racks.length;
          lldEnsureFaiRack(ws);
          rackAdded = ws.racks.length > before;
          if (rackAdded) {
            touchWorkspace(ws);
            saveState();
            renderBoard();
          }
        }
        lldDraft.lld.diagrams = lldDraft.lld.diagrams || {};
        lldDraft.lld.diagrams[mode] = lldBuildDiagData(ws, mode);
        ws.lld = ws.lld || {};
        ws.lld.diagrams = ws.lld.diagrams || {};
        ws.lld.diagrams[mode] = lldDraft.lld.diagrams[mode];
        touchWorkspace(ws);
        saveState();
        // le rack FAI éventuellement créé doit survivre à l'enregistrement
        paint();
        lldAlert('Diagramme généré depuis l’élévation (pensez à Enregistrer).'
          + (mode === 'fai' ? '\nRack « RACK FAI — Accès opérateurs » (5 routeurs) ajouté à gauche s’il manquait, et relié en topologie.' : ''),
          { title: 'Diagramme' });
      }, 'Construit le schéma du chapitre depuis les devices posés, les FAI et l’interconnexion');
      const clearBtn = lldBtn('✕ Vider', () => {
        lldPushUndo(true);
        if (lldDraft && lldDraft.lld.diagrams) delete lldDraft.lld.diagrams[mode];
        paint();
      }, 'Supprimer le diagramme de ce chapitre');
      bar.appendChild(genBtn);
      bar.appendChild(clearBtn);
      wrap.appendChild(bar);
      wrap.appendChild(host);
      box.appendChild(wrap);
      break;
    }
    case 'governance': {
      [
        ['revs', 'Historique des révisions — tableau de la page de garde (PDF/Excel)', LLD_REV_COLS, '＋ Ajouter une révision', true],
        ['approvers', 'Approbateurs — tableau de la page de garde (PDF/Excel)', LLD_SIGNATORY_COLS, '＋ Ajouter un approbateur', false],
        ['reviewers', 'Réviseurs — tableau de la page de garde (PDF/Excel)', LLD_SIGNATORY_COLS, '＋ Ajouter un réviseur', false]
      ].forEach(([k, title, cols0, addLabel, isRevs]) => {
        const t = document.createElement('div');
        t.className = 'd-inv-title';
        t.textContent = title;
        box.appendChild(t);
        const cols = lldExportCols(L, k, cols0);
        const tbl = lldMakeGrid(cols, k, cols0);
        (L[k] || []).forEach(r => lldAddRow(tbl, cols, r));
        box.appendChild(tbl);
        box.appendChild(lldGridActions(
          lldBtn(addLabel, () => {
            const n = tbl.querySelectorAll('tbody tr').length;
            const data = isRevs
              ? { rev: String(n + 1), date: new Date().toISOString().slice(0, 10) }
              : {};
            const tr = lldAddRow(tbl, cols, data);
            const f = tr.querySelector('input');
            if (f) f.focus();
          }),
          lldAddColBtn(k, cols0)
        ));
      });
      break;
    }
  }
}

// Ajoute un bloc libre (tableau / paragraphe / captures) au nœud courant.
function lldAddCustomBlock(node, type) {
  if (!lldDraft || !node) return;
  lldFlushDetail();
  const prefixes = { para: 'cpara', table: 'ctable', shots: 'cshots' };
  const labels = { para: 'Paragraphe', table: 'Tableau', shots: 'Captures d’écran' };
  const prefix = prefixes[type];
  if (!prefix) return;
  const key = prefix + ':' + uid();
  lldPushUndo(true);
  node.blocks = node.blocks || [];
  node.blocks.push(key);
  const L = lldDraft.lld;
  L.customMeta = L.customMeta || {};
  // Numérote si le chapitre a déjà un bloc du même type
  const same = node.blocks.filter(k => k !== key && k.startsWith(prefix + ':')).length;
  L.customMeta[key] = { label: same ? `${labels[type]} ${same + 1}` : labels[type] };
  if (type === 'para') L[key] = '';
  else if (type === 'table') {
    L[key] = [{}];
    lldSetGridCols(key, LLD_CUSTOM_TABLE_COLS.map(c => c.slice()));
  } else {
    L[key] = [];
  }
  lldRenderToc();
  lldRenderDetail(node);
}

// ---- Détail du chapitre sélectionné (colonne de droite) ----
function lldRenderDetail(node) {
  lldFlushDetail();   // garde les saisies du panneau précédent avant re-rendu
  const body = $('#lld-detail-body');
  body.innerHTML = '';
  $('#lld-detail-empty').classList.add('hidden');
  body.classList.remove('hidden');

  const head = document.createElement('div');
  head.className = 'lld-detail-head';
  const num = document.createElement('span');
  num.className = 'lld-detail-num';
  num.textContent = node.cover ? '📄' : node.num;
  const titles = document.createElement('div');
  titles.className = 'lld-detail-titles';
  const h = document.createElement('h4');
  h.className = 'lld-detail-title';
  h.textContent = node.title;
  const sub = document.createElement('span');
  sub.className = 'lld-detail-sub';
  sub.textContent = node.cover ? 'Informations de la page de garde'
    : (node.custom ? 'Chapitre ajouté au sommaire' : 'Chapitre du dossier');
  titles.appendChild(h);
  titles.appendChild(sub);
  head.appendChild(num);
  head.appendChild(titles);
  body.appendChild(head);

  const hint = document.createElement('p');
  hint.className = 'lld-hint';
  hint.textContent = node.custom
    ? 'Ajoutez un tableau, un paragraphe ou une capture. Ils sont repris automatiquement dans les exports HTML, PDF et Excel (double-clic sur un titre de bloc pour le renommer).'
    : ('Ces saisies alimentent directement les exports PDF et Excel du dossier, '
      + 'avec le titre du sommaire (double-clic dessus pour le modifier).');
  body.appendChild(hint);

  (node.blocks || []).forEach(key => {
    const def = lldInfoDef(key);
    if (!def) return;              // clé inconnue (ancien état) : ignorée
    const sec = document.createElement('div');
    sec.className = 'lld-info';
    sec.dataset.key = key;

    const hb = document.createElement('div');
    hb.className = 'lld-info-head';
    const lbl = document.createElement('span');
    lbl.className = 'lld-info-label';
    lbl.textContent = def.label;
    if (def.custom) {
      lbl.dataset.rename = '1';
      lbl.title = 'Double-clic pour renommer ce bloc';
      lbl.addEventListener('dblclick', async () => {
        if (!lldDraft) return;
        const nv = await lldPrompt('Titre de ce bloc :', def.label, {
          title: '✏️ Renommer le bloc', okLabel: 'Renommer'
        });
        if (nv == null) return;
        const lab = String(nv).trim().slice(0, 80);
        if (!lab) return;
        lldPushUndo(true);
        lldDraft.lld.customMeta = lldDraft.lld.customMeta || {};
        lldDraft.lld.customMeta[key] = Object.assign({}, lldDraft.lld.customMeta[key], { label: lab });
        lldRenderDetail(node);
      });
    }
    hb.appendChild(lbl);

    const others = lldNodesWithKey(key).filter(n => n.id !== node.id);
    if (others.length) {
      const badge = document.createElement('span');
      badge.className = 'lld-sync-badge';
      badge.textContent = '🔄 Synchronisé avec ' + others.map(lldNodeLabel).join(' · ');
      badge.title = 'Ce contenu est inséré dans plusieurs chapitres : sa valeur est unique, '
        + 'la modifier ici la met à jour partout (et dans les exports).';
      hb.appendChild(badge);
    }
    if (!node.cover) {
      const detach = document.createElement('button');
      detach.type = 'button';
      detach.className = 'lld-info-detach';
      detach.textContent = '✕';
      detach.title = def.custom
        ? 'Retirer ce bloc de ce chapitre'
        : 'Retirer cette information de ce chapitre (la donnée reste stockée et utilisée ailleurs)';
      detach.addEventListener('click', () => {
        lldPushUndo(true);
        node.blocks = (node.blocks || []).filter(k => k !== key);
        if (def.custom && lldDraft && lldDraft.lld) {
          delete lldDraft.lld[key];
          if (lldDraft.lld.customMeta) delete lldDraft.lld.customMeta[key];
          if (lldDraft.lld.gridCols) delete lldDraft.lld.gridCols[key];
        }
        lldRenderToc();
        lldRenderDetail(node);
      });
      hb.appendChild(detach);
    }
    sec.appendChild(hb);

    const box = document.createElement('div');
    box.className = 'lld-info-body';
    lldInfoRender(box, def, key);
    sec.appendChild(box);
    body.appendChild(sec);
  });

  if (!node.cover) {
    if (node.custom) {
      // Chapitre / sous-chapitre ajouté : blocs libres (tableau, paragraphe, capture)
      const addWrap = document.createElement('div');
      addWrap.className = 'lld-info-add lld-info-add-custom';
      const addHint = document.createElement('span');
      addHint.className = 'lld-info-add-hint';
      addHint.textContent = (node.blocks || []).length
        ? 'Ajouter un autre contenu :'
        : 'Ce chapitre est vide — ajoutez du contenu :';
      addWrap.appendChild(addHint);
      addWrap.appendChild(lldBtn('＋ Tableau', () => lldAddCustomBlock(node, 'table'),
        'Ajouter un tableau (colonnes et lignes éditables, repris dans les exports)'));
      addWrap.appendChild(lldBtn('＋ Paragraphe', () => lldAddCustomBlock(node, 'para'),
        'Ajouter un champ texte pour rédiger un paragraphe'));
      addWrap.appendChild(lldBtn('＋ Capture', () => lldAddCustomBlock(node, 'shots'),
        'Ajouter un emplacement pour glisser-déposer des captures d’écran'));
      body.appendChild(addWrap);
    } else {
      // Ajout d'une information — si elle existe déjà ailleurs, elle est
      // rattachée au MÊME stockage → les deux chapitres sont synchronisés.
      const addWrap = document.createElement('div');
      addWrap.className = 'lld-info-add';
      const sel = document.createElement('select');
      sel.id = 'lld-info-pick';
      sel.title = 'Choisir une information à insérer dans ce chapitre';
      const have = new Set(node.blocks || []);
      Object.entries(LLD_INFOS).forEach(([k, def]) => {
        if (have.has(k)) return;
        const op = document.createElement('option');
        op.value = k;
        const elsewhere = lldNodesWithKey(k).filter(n => n.id !== node.id);
        op.textContent = def.label +
          (elsewhere.length ? ` — déjà insérée : ${elsewhere.map(lldNodeLabel).join(', ')}` : '');
        sel.appendChild(op);
      });
      const addBtn = lldBtn('＋ Ajouter cette info', () => {
        const k = sel.value;
        if (!k) return;
        lldPushUndo(true);
        node.blocks = node.blocks || [];
        node.blocks.push(k);
        lldRenderToc();
        lldRenderDetail(node);
      }, 'Ajouter l’information à ce chapitre — si elle est déjà dans un autre chapitre, les deux seront synchronisés');
      addWrap.appendChild(sel);
      addWrap.appendChild(addBtn);
      body.appendChild(addWrap);
    }
  }

  const auto = LLD_TOC_AUTO[node.num];
  if (auto) {
    const d = document.createElement('div');
    d.className = 'lld-auto';
    d.innerHTML = '<strong>Inclus automatiquement à l’export :</strong> ' + escapeHtml(auto);
    body.appendChild(d);
  }
}

// ---- Détection d'éléments (boutons « extra » des infos) ----
function lldGenNomen(tbl) {
  const ws = active();
  if (!ws || !lldDraft) return;
  const known = new Set(lldRowsFrom(tbl)
    .map(r => String(r.prefix || '').trim().toUpperCase()).filter(Boolean));
  const names = [];
  ws.racks.forEach(r => r.instances.forEach(i => names.push(String(i.name || ''))));
  (ws.cables || []).forEach(c => names.push(String(c.name || '')));
  const found = {};   // préfixe -> exemple le plus court
  names.forEach(n => {
    const m = n.match(/^([A-Za-z]{2,5})-/);
    if (!m) return;
    const pfx = m[1].toUpperCase();
    if (!found[pfx] || n.length < found[pfx].length) found[pfx] = n;
  });
  const missing = Object.keys(found).filter(p => !known.has(p)).sort();
  if (!missing.length) {
    lldAlert('Aucun nouveau préfixe détecté (ou tous sont déjà dans la nomenclature).',
      { title: '🔍 Détection des préfixes' });
    return;
  }
  missing.forEach(p => lldAddRow(tbl, LLD_NOMEN_COLS, {
    type: NOMEN_GUESS[p] || '', prefix: p, example: found[p]
  }));
  lldAlert(`${missing.length} préfixe(s) ajouté(s) à la nomenclature : ${missing.join(', ')}.\n`
    + "Vérifiez le type d'objet et complétez la règle de nommage.",
    { title: '🔍 Détection des préfixes' });
}

function lldDetectVlans(tbl) {
  const ws = active();
  if (!ws || !lldDraft) return;
  const known = new Set(lldRowsFrom(tbl).map(r => String(r.vid || '').trim()).filter(Boolean));
  const found = new Set();
  ws.racks.forEach(r => r.instances.forEach(i => (i.ports || []).forEach(p => {
    String(p.vlan || '').split(/[^0-9]+/).forEach(tok => {
      const n = parseInt(tok, 10);
      if (n >= 1 && n <= 4094) found.add(String(n));
    });
  })));
  (ws.topology?.links || []).forEach(l => {
    String(l.vlan || '').split(/[^0-9]+/).forEach(tok => {
      const n = parseInt(tok, 10);
      if (n >= 1 && n <= 4094) found.add(String(n));
    });
  });
  const missing = [...found].filter(v => !known.has(v)).sort((a, b) => a - b);
  if (!missing.length) {
    lldAlert('Tous les VLANs utilisés sont déjà dans le registre.',
      { title: '🔍 Détection des VLANs' });
    return;
  }
  missing.forEach(vid => lldAddRow(tbl, LLD_VLAN_COLS, { vid }));
  lldAlert(`${missing.length} VLAN(s) ajouté(s) au registre : ${missing.join(', ')}\n`
    + 'Renseignez leur nom, subnet et passerelle.',
    { title: '🔍 Détection des VLANs' });
}

// Pré-remplit le tableau « Équipements » (ch. 3.1) avec un regroupement par
// modèle des devices posés dans l'élévation — mêmes règles d'ordre que
// invGroups() des exports. Les lignes déjà présentes (modèle connu) sont
// conservées telles quelles ; le résultat est le sommaire → Excel/PDF.
function lldGenEquip(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft) return;
  const known = new Set(lldRowsFrom(tbl)
    .map(r => String(r.model || '').trim().toLowerCase()).filter(Boolean));
  const info = new Map();
  for (const { inst } of sortedRackInstances(ws)) {
    const model = `${inst.brand || ''} ${inst.model || ''}`.trim()
      || String(inst.name || '').trim();
    if (!model) continue;
    const g = info.get(model) || { n: 0, cat: inst.cat };
    g.n++;
    info.set(model, g);
  }
  const rank = c => DEV_CATEGORIES.findIndex(([id]) => id === normCat(c));
  const ordered = [...info.entries()].sort((a, b) =>
    rank(a[1].cat) - rank(b[1].cat) || b[1].n - a[1].n || a[0].localeCompare(b[0], 'fr'));
  const missing = ordered.filter(([m]) => !known.has(m.toLowerCase()));
  if (!missing.length) {
    lldAlert("Tous les modèles de l'élévation sont déjà dans le tableau des équipements.",
      { title: "🔎 Générer depuis l'élévation" });
    return;
  }
  missing.forEach(([model, n]) => lldAddRow(tbl, cols || LLD_EQUIP_COLS, { model, qty: `x${n}` }));
  lldAlert(`${missing.length} ligne(s) ajoutée(s) au sommaire (reprises dans l'Excel 3.1 et le PDF) :\n`
    + missing.slice(0, 12).map(([m, n]) => `• ${m} ×${n}`).join('\n')
    + (missing.length > 12 ? `\n… et ${missing.length - 12} autre(s)` : ''),
    { title: "🔎 Générer depuis l'élévation" });
}

// Renommage : dblclick délégué sur l'arbre (fonctionne même après un
// re-rendu — l'écouteur reste attaché au conteneur).
$('#lld-toc-tree').addEventListener('dblclick', ev => {
  const span = ev.target.closest('.lld-toc-title');
  const item = ev.target.closest('.lld-toc-item');
  if (!span || !item || !lldDraft) return;
  const loc = lldLocate(item.dataset.id);
  if (!loc) return;
  ev.stopPropagation();
  lldStartRename(item, loc.node);
});

// ---- Ajout de chapitres / sous-chapitres au sommaire ----
$('#lld-toc-add-ch').addEventListener('click', () => {
  if (!lldDraft) return;
  lldFlushDetail();
  let max = 0;
  lldAllNodes().forEach(n => {
    const v = parseInt(n.num, 10);
    if (Number.isFinite(v) && v > max) max = v;
  });
  const node = {
    id: uid(), num: String(max + 1), title: 'Nouveau chapitre',
    blocks: [], subs: [], custom: true
  };
  lldPushUndo(true);
  lldToc().push(node);
  lldSelectNode(node.id);
  const item = $('#lld-toc-tree').querySelector(`[data-id="${node.id}"]`);
  if (item) lldStartRename(item, node);
});

$('#lld-toc-add-sub').addEventListener('click', () => {
  if (!lldDraft) return;
  lldFlushDetail();
  const loc = lldSelId ? lldLocate(lldSelId) : null;
  if (!loc || loc.node.cover) {
    lldAlert('Sélectionnez d’abord un chapitre ou un sous-chapitre du sommaire\n'
      + 'pour lui ajouter un sous-chapitre.', { title: '📖 Sommaire' });
    return;
  }
  const parent = loc.parent || loc.node;   // sélection d'un sous-chapitre → frère
  if (parent.noSubs) {
    lldAlert('Le chapitre 8 est découpé automatiquement selon les zones de Switching\n'
      + '(info « Zones de Switching ») : ajoutez une zone pour créer un sous-chapitre 8.x.',
      { title: '📖 Sommaire' });
    return;
  }
  const used = new Set(lldAllNodes().map(n => String(n.num)));
  let num = null;
  for (let i = (parent.subs || []).length + 1; i < (parent.subs || []).length + 500; i++) {
    const cand = `${parent.num}.${i}`;
    if (!used.has(cand) && !LLD_RESERVED_SHEETS.has(cand)) { num = cand; break; }
  }
  if (!num) return;
  const node = {
    id: uid(), num, title: 'Nouveau sous-chapitre',
    blocks: [], subs: [], custom: true
  };
  lldPushUndo(true);
  parent.subs = parent.subs || [];
  parent.subs.push(node);
  lldSelectNode(node.id);
  const item = $('#lld-toc-tree').querySelector(`[data-id="${node.id}"]`);
  if (item) lldStartRename(item, node);
});

// ---- Ouverture / fermeture de la modale ----
/* ---- 5.1 : pré-remplissage du tableau FAI depuis l'élévation ---- */
function lldGenFai51(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_FAI51_COLS;
  const existing = lldRowsFrom(tbl);
  const byDesc = new Map(existing.map(r => [String(r.desc || '').trim().toLowerCase(), r]));
  let added = 0, filled = 0;

  (lldDraft.lld.fais || []).forEach(srcF => {
    const op = String(srcF.operator || '').trim();
    const off = String(srcF.offer || '').trim();
    const desc = String(srcF.desc || (op ? `${op}${off ? ' — ' + off : ''}` : '')).trim();
    if (!desc) return;
    const row = {
      cat: 'FAI',
      desc,
      down: srcF.down || '',
      lanIp: srcF.lanIp || '', lanMask: srcF.lanMask || '',
      lanGw: srcF.lanGw || '', lanDns: srcF.lanDns || '',
      ipv6: srcF.ipv6 || '', dhcp: srcF.dhcp || '',
      pf: srcF.pf || '', pfPortWan: srcF.pfPortWan || '',
      pfPortLan: srcF.pfPortLan || '', pfClient: srcF.pfClient || '',
      pfProto: srcF.pfProto || '', dmz: srcF.dmz || '',
      firewall: srcF.firewall || '', wlanStat: srcF.wlanStat || '',
      wlan: srcF.wlan || '', notes: String(srcF.notes || '').split('\n')[0]
    };
    const key = desc.toLowerCase();
    if (byDesc.has(key)) {
      const cur = byDesc.get(key);
      let touched = false;
      Object.keys(row).forEach(k => {
        if (k === 'desc' || k === 'cat') return;
        if (!String(cur[k] || '').trim() && row[k]) { cur[k] = row[k]; touched = true; }
      });
      if (touched) filled++;
    } else {
      lldAddRow(tbl, C, row);
      byDesc.set(key, row);
      added++;
    }
  });

  const siteOf = rackId => {
    const r = (ws.racks || []).find(x => x.id === rackId);
    const st = (ws.sites || []).find(s => s && s.id === (r && r.siteId));
    return (st && st.name) || (r && r.name) || '';
  };
  sortedRackInstances(ws).forEach(({ rack, inst }) => {
    if (!/router/i.test(String(inst.cat || ''))) return;
    const wanPorts = (inst.ports || []).filter(p =>
      /wan/i.test(String(p.name || '') + ' ' + String(p.label || '')));
    if (!wanPorts.length) return;
    const site = siteOf(rack.id);
    const desc = `${inst.name || 'Routeur'}${site ? ' — ' + site : ''} (WAN ×${wanPorts.length})`;
    if (byDesc.has(desc.toLowerCase())) return;
    const row = {
      cat: 'FAI', desc, down: '',
      lanIp: inst.ipMgmt || '',
      lanMask: '', lanGw: '', lanDns: '',
      ipv6: '', dhcp: '',
      pf: '', pfPortWan: '', pfPortLan: '', pfClient: '', pfProto: '',
      dmz: '', firewall: '', wlanStat: '', wlan: '',
      notes: wanPorts.map(p => p.label || p.name).filter(Boolean).join(' · ').slice(0, 200)
    };
    lldAddRow(tbl, C, row);
    byDesc.set(desc.toLowerCase(), row);
    added++;
  });

  try {
    const nodes = (ws.topology && ws.topology.nodes) || [];
    const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
    ((ws.topology && ws.topology.links) || []).forEach(l => {
      if (!/fai|transit|isp|internet/i.test(String(l.label || ''))) return;
      const a = nodeById[l.a];
      const lbl = String(l.label || 'Accès FAI').slice(0, 60);
      const desc = a && a.instId ? `${lbl} (${a.instId})` : lbl;
      if (byDesc.has(desc.toLowerCase())) return;
      lldAddRow(tbl, C, {
        cat: 'FAI', desc, down: String(l.speed || '').slice(0, 40),
        notes: 'Source : topologie (élévation)'
      });
      byDesc.set(desc.toLowerCase(), { desc });
      added++;
    });
  } catch (_) { /* topo absente */ }

  lldAlert((added || filled)
    ? `Tableau 5.1 mis à jour : ${added} ligne(s) ajoutée(s), ${filled} fiche(s) complétée(s) sur les cellules vides.\n`
      + 'Les colonnes sans équivalent dans l’élévation restent vides (saisie manuelle).'
    : 'Rien de nouveau dans l’élévation — lignes 5.1 déjà à jour.',
    { title: '🔎 Générer 5.1' });
}

/* ---- 5.2 : câblage FAI (CPE / port WAN) depuis l'élévation ---- */
function lldGenFaiCab(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_FAI_CAB_COLS;
  const have = new Set(lldRowsFrom(tbl)
    .map(r => `${(r.desc || '').toLowerCase()}|${(r.conn || '').toLowerCase()}`));
  let added = 0;
  const push = (desc, conn) => {
    const d = String(desc || '').trim().slice(0, 120);
    const c = String(conn || '').trim().slice(0, 160);
    if (!d && !c) return;
    const key = `${d.toLowerCase()}|${c.toLowerCase()}`;
    if (have.has(key)) return;
    lldAddRow(tbl, C, { cat: 'FAI', desc: d, conn: c });
    have.add(key);
    added++;
  };

  (lldDraft.lld.fais || []).forEach(f => {
    const desc = String(f.desc || (f.operator ? `${f.operator}${f.offer ? ' — ' + f.offer : ''}` : '')).trim()
      || String(f.cpe || '').trim();
    if (f.cpe || f.wanLabel) push(desc || f.cpe, f.wanLabel || f.cpe);
    else if (desc) push(desc, '');
  });

  const cables = ws.cables || [];
  const endInfo = (rackId, instId, portId) => {
    const r = (ws.racks || []).find(x => x.id === rackId);
    const inst = r && (r.instances || []).find(x => x.id === instId);
    const port = inst && (inst.ports || []).find(x => x.id === portId);
    return { dev: (inst && inst.name) || '', port: (port && (port.label || port.name)) || '' };
  };
  sortedRackInstances(ws).forEach(({ inst }) => {
    if (!/router|firewall/i.test(String(inst.cat || ''))) return;
    (inst.ports || [])
      .filter(pt => /wan/i.test(String(pt.name || '') + ' ' + String(pt.label || '')))
      .forEach(pt => {
        const cab = cables.find(c =>
          (c.a && c.a.instId === inst.id && c.a.portId === pt.id) ||
          (c.b && c.b.instId === inst.id && c.b.portId === pt.id));
        if (!cab) return;
        const otherEnd = (cab.a && cab.a.instId === inst.id) ? cab.b : cab.a;
        const o = otherEnd ? endInfo(otherEnd.rackId, otherEnd.instId, otherEnd.portId) : { dev: '', port: '' };
        const conn = [pt.label || pt.name,
          o.dev && o.port ? `${o.dev} (${o.port})` : o.dev].filter(Boolean).join(' → ');
        push(cab.name || `${inst.name} — ${pt.name}`, conn);
      });
  });

  try {
    if (typeof cablingRowsByDomain === 'function') {
      const rowsC = cablingRowsByDomain(ws, 'fai');
      (Array.isArray(rowsC) ? rowsC : []).slice(1).forEach(r => {
        const cells = Array.isArray(r) ? r.map(x => String(x ?? '')) : [];
        if (!cells.length) return;
        if (cells.length >= 3) push(cells[1] || cells[0], cells[cells.length - 1]);
        else push(cells[0], cells.slice(1).join(' '));
      });
    }
  } catch (_) { /* hors harnais */ }

  lldAlert(added
    ? `${added} ligne(s) de câblage 5.2 ajoutée(s) (reprises dans la feuille Excel « 5 »).`
    : 'Rien de nouveau — câblage 5.2 déjà à jour.',
    { title: '🔎 Générer 5.2' });
}

/* ---- 6.1 : pré-remplissage extrémités / HA depuis l'élévation ---- */
function lldGenIc61(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_IC61_COLS;
  const ic = lldDraft.lld.interco || {};
  const fais = lldDraft.lld.fais || [];
  const ipOf = s => {
    const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(String(s || ''));
    return m ? m[1] : '';
  };
  const faiOf = (ep, idx) => {
    const ip = ipOf(ep);
    return fais.find(f => ip && f.wanIp === ip) || fais[idx] || {};
  };
  const have = new Set(lldRowsFrom(tbl)
    .map(r => String(r.equip || '').trim().toLowerCase()));
  let added = 0, filled = 0;
  const ensure = (row) => {
    const key = String(row.equip || '').trim().toLowerCase();
    if (!key) return;
    const existing = lldRowsFrom(tbl).find(r =>
      String(r.equip || '').trim().toLowerCase() === key);
    if (existing) {
      let t = false;
      Object.keys(row).forEach(k => {
        if (k === 'equip') return;
        if (!String(existing[k] || '').trim() && row[k]) { existing[k] = row[k]; t = true; }
      });
      if (t) filled++;
      return;
    }
    lldAddRow(tbl, C, row);
    have.add(key);
    added++;
  };

  // a) depuis les champs interco (A / B)
  [[ic.epA, ic.snA, ic.fwA, ic.haA, ic.roleA, ic.vipA, ic.mgmtA, ic.mgmtMaskA, 0],
   [ic.epB, ic.snB, ic.fwB, ic.haB, ic.roleB, ic.vipB, ic.mgmtB, ic.mgmtMaskB, 1]
  ].forEach(([ep, sn, fw, ha, role, vip, mgmt, mgmtMask, idx]) => {
    if (!ep && !sn && !mgmt) return;
    const f = faiOf(ep, idx);
    const short = String(ep || '').split(' — ')[0];
    const nm = short.split(/[\s(]/)[0].toLowerCase();
    const inst = sortedRackInstances(ws).find(x =>
      (x.inst.name || '').toLowerCase() === nm);
    ensure({
      equip: String(ep || '').slice(0, 120),
      nomen: inst ? [inst.inst.brand, inst.inst.model].filter(Boolean).join(' ') : '',
      sn: sn || '', fw: fw || '',
      ip: f.wanIp || ipOf(ep) || '',
      mask: f.wanMask || '', gw: f.wanGw || '', dns: f.wanDns || '',
      haEn: ha ? 'Oui' : '', haGroup: ha || '',
      haRole: role || '',
      haMaster: /master/i.test(String(role || '')) ? 'Oui' : '',
      vip: vip || '', mgmt: mgmt || '', mgmtMask: mgmtMask || '',
      note: f.operator ? `FAI : ${f.operator}${f.offer ? ' — ' + f.offer : ''}` : ''
    });
  });

  // b) routeurs / firewall de l'élévation encore absents
  sortedRackInstances(ws).forEach(({ rack, inst }) => {
    if (!/router|firewall/i.test(String(inst.cat || ''))) return;
    const name = String(inst.name || '').trim();
    if (!name || have.has(name.toLowerCase())) return;
    // ne pas dupliquer si déjà couvert par un libellé d'extrémité
    const covered = [...have].some(h => h && (h.includes(name.toLowerCase()) || name.toLowerCase().includes(h.split(' ')[0])));
    if (covered) return;
    const site = (ws.sites || []).find(s => s.id === rack.siteId);
    ensure({
      equip: name + (site && site.name ? ` (${site.name})` : ''),
      nomen: [inst.brand, inst.model].filter(Boolean).join(' '),
      sn: '', fw: '',
      ip: '', mask: '', gw: '', dns: '',
      haEn: '', haGroup: '', haRole: '', haMaster: '',
      vip: '',
      mgmt: inst.ipMgmt || '', mgmtMask: '',
      note: 'Source : élévation (compléter IP WAN / HA)'
    });
  });

  lldAlert((added || filled)
    ? `Tableau 6.1 : ${added} ligne(s) ajoutée(s), ${filled} champ(s) complété(s) sur les cellules vides.\n`
      + 'Colonnes sans source dans l’élévation restent vides (saisie manuelle).'
    : 'Rien de nouveau — tableau 6.1 déjà à jour.',
    { title: '🔎 Générer 6.1' });
}

/* ---- 6.2 : câblage interconnexion depuis l'élévation ---- */
function lldGenIcCab(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_IC_CAB_COLS;
  const ic = lldDraft.lld.interco || {};
  const fais = lldDraft.lld.fais || [];
  const have = new Set(lldRowsFrom(tbl).map(r =>
    `${(r.desc || '').toLowerCase()}|${(r.port || '').toLowerCase()}|${(r.conn || '').toLowerCase()}`));
  let added = 0;
  const push = (desc, port, conn) => {
    const d = String(desc || '').trim().slice(0, 120);
    const pt = String(port || '').trim().slice(0, 40);
    const cn = String(conn || '').trim().slice(0, 160);
    if (!d && !pt && !cn) return;
    const key = `${d.toLowerCase()}|${pt.toLowerCase()}|${cn.toLowerCase()}`;
    if (have.has(key)) return;
    lldAddRow(tbl, C, { cat: 'Interconnexion S2S', desc: d, port: pt, conn: cn });
    have.add(key);
    added++;
  };

  // a) extrémités interco + LAN
  const labA = String(fais[0] && fais[0].wanLabel || '');
  const labB = String(fais[1] && fais[1].wanLabel || '');
  const eqA = String(ic.epA || 'Extrémité A').split(' — ')[0];
  const eqB = String(ic.epB || 'Extrémité B').split(' — ')[0];
  if (labA) push(eqA, 'WAN', labA);
  if (labB) push(eqB, 'WAN', labB);
  fais.slice(2).forEach(f => {
    if (f.wanLabel) push(String(f.operator || 'Secours'), 'WAN', f.wanLabel);
  });
  if (ic.lanA) push(eqA, 'LAN 1', ic.lanA);
  if (ic.lanB) push(eqB, 'LAN 1', ic.lanB);

  // b) câbles domaine interco
  try {
    if (typeof cablingRowsByDomain === 'function') {
      (cablingRowsByDomain(ws, 'interco') || []).slice(1).forEach(r => {
        const cells = Array.isArray(r) ? r.map(x => String(x ?? '')) : [];
        if (!cells.length) return;
        if (cells.length >= 4) push(cells[1] || cells[0], cells[2], cells[cells.length - 1]);
        else if (cells.length >= 2) push(cells[0], '', cells[cells.length - 1]);
      });
    }
  } catch (_) { /* hors harnais */ }

  // c) ports WAN/LAN des routeurs d'interco
  const cables = ws.cables || [];
  sortedRackInstances(ws).forEach(({ inst }) => {
    if (!/router|firewall/i.test(String(inst.cat || ''))) return;
    (inst.ports || []).forEach(pt => {
      if (!/wan|lan/i.test(String(pt.name || '') + ' ' + String(pt.label || ''))) return;
      const cab = cables.find(c =>
        (c.a && c.a.instId === inst.id && c.a.portId === pt.id) ||
        (c.b && c.b.instId === inst.id && c.b.portId === pt.id));
      if (!cab) return;
      const otherEnd = (cab.a && cab.a.instId === inst.id) ? cab.b : cab.a;
      let oDev = '';
      if (otherEnd) {
        const r = (ws.racks || []).find(x => x.id === otherEnd.rackId);
        const oi = r && (r.instances || []).find(x => x.id === otherEnd.instId);
        const op = oi && (oi.ports || []).find(x => x.id === otherEnd.portId);
        oDev = [oi && oi.name, op && (op.label || op.name)].filter(Boolean).join(' (') + (otherEnd ? ')' : '');
        if (oDev.endsWith('()')) oDev = oDev.slice(0, -2);
      }
      const port = /wan/i.test(String(pt.name || '') + String(pt.label || '')) ? (pt.name || '') : 'LAN';
      push(inst.name || 'Équipement', port, oDev || (cab.name || ''));
    });
  });

  lldAlert(added
    ? `${added} ligne(s) de câblage 6.2 ajoutée(s) (reprises dans la feuille Excel « 6 »).`
    : 'Rien de nouveau — câblage 6.2 déjà à jour.',
    { title: '🔎 Générer 6.2' });
}

/* ---- 6.1 WAN : pré-remplissage depuis les FAI ---- */
function lldGenIcWan(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_IC_WAN_COLS;
  const fais = lldDraft.lld.fais || [];
  const rows = lldRowsFrom(tbl);
  let added = 0, filled = 0;
  const ensureName = (name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    let hit = rows.find(r => String(r.name || '').trim().toLowerCase() === key);
    if (!hit) { lldAddRow(tbl, C, { name: String(name).slice(0, 140) }); added++; hit = lldRowsFrom(tbl).slice(-1)[0]; }
    return hit;
  };
  const fill = (row, patch) => {
    if (!row) return;
    let t = false;
    for (const [k, v] of Object.entries(patch)) {
      if (!v) continue;
      if (!String(row[k] || '').trim()) { row[k] = v; t = true; }
    }
    if (t) filled++;
  };
  fais.slice(0, 3).forEach((f, i) => {
    const name = `WAN ${i + 1}${f.operator ? ' — ' + f.operator : ''}`;
    const row = ensureName(name);
    fill(row, {
      enable: 'Oui',
      connMethod: String(f.ipMode || '').slice(0, 45),
      routingMode: 'NAT',
      ip: String(f.wanIp || '').slice(0, 45),
      mask: String(f.wanMask || '').slice(0, 45),
      gw: String(f.wanGw || '').slice(0, 45),
      dns: String(f.wanDns || '').slice(0, 60),
      up: String(f.up || '').slice(0, 45),
      down: String(f.down || '').slice(0, 45),
      provider: String(f.operator || '').slice(0, 60)
    });
  });
  lldAlert(
    added || filled
      ? `Tableau WAN : ${added} ligne(s) ajoutée(s), ${filled} champ(s) complété(s) sur les cellules vides.\n`
        + 'Complétez MTU, health-check… si besoin — l’export reprend ces lignes.'
      : 'Rien de nouveau — tableau WAN déjà à jour.',
    { title: '🔎 Générer WAN' });
}

/* ---- 6.1 LAN : pré-remplissage depuis interco + VLANs ---- */
function lldGenIcLan(tbl, cols) {
  const ws = active();
  if (!ws || !lldDraft || !tbl) return;
  const C = cols || LLD_IC_LAN_COLS;
  const ic = lldDraft.lld.interco || {};
  const nv = (lldDraft.lld.vlans || []).length;
  const rows = lldRowsFrom(tbl);
  let added = 0, filled = 0;
  const ensureLan = (lan) => {
    const key = String(lan || '').trim().toLowerCase();
    if (!key) return null;
    let hit = rows.find(r => String(r.lan || '').trim().toLowerCase() === key);
    if (!hit) { lldAddRow(tbl, C, { lan: String(lan).slice(0, 120) }); added++; hit = lldRowsFrom(tbl).slice(-1)[0]; }
    return hit;
  };
  const fill = (row, patch) => {
    if (!row) return;
    let t = false;
    for (const [k, v] of Object.entries(patch)) {
      if (!v) continue;
      if (!String(row[k] || '').trim()) { row[k] = v; t = true; }
    }
    if (t) filled++;
  };
  const main = ensureLan(ic.localSubnets ? `LAN — ${ic.localSubnets}` : 'LAN');
  fill(main, {
    routing: String(ic.routing || '').slice(0, 120),
    network: String(nv ? `x${nv} VLANs routés` : '').slice(0, 120)
  });
  if (ic.remoteSubnets) {
    const dist = ensureLan('LAN — distant');
    fill(dist, { network: String(ic.remoteSubnets).slice(0, 120) });
  }
  lldAlert(
    added || filled
      ? `Tableau LAN : ${added} ligne(s) ajoutée(s), ${filled} champ(s) complété(s) sur les cellules vides.`
      : 'Rien de nouveau — tableau LAN déjà à jour.',
    { title: '🔎 Générer LAN' });
}

function openLldModal(selectKey = null) {
  const ws = active();
  if (!ws) return;
  lldDraft = {
    lld: JSON.parse(JSON.stringify(ws.lld || {})),
    sites: JSON.parse(JSON.stringify(ws.sites || [])),
    flows: JSON.parse(JSON.stringify(ws.flows || []))
  };
  normLldInfo(lldDraft);
  normSites(lldDraft);
  lldSelId = null;
  const body = $('#lld-detail-body');
  body.innerHTML = '';
  body.classList.add('hidden');
  $('#lld-detail-empty').classList.remove('hidden');
  lldRenderToc();
  lldUndoStack = [];
  lldRedoStack = [];
  lldPushUndo(true);   // état initial = première cible d'annulation
  $('#lld-modal').classList.remove('hidden');
  if (selectKey) {
    const node = lldAllNodes().find(n => (n.blocks || []).includes(selectKey));
    if (node) lldSelectNode(node.id);
  }
}

function lldCloseModal() {
  lldDraft = null;
  lldSelId = null;
  lldUndoStack = [];
  lldRedoStack = [];
  $('#lld-modal').classList.add('hidden');
}

$('#ws-info').addEventListener('click', () => openLldModal());
$('#lld-cancel').addEventListener('click', lldCloseModal);
$('#lld-modal').addEventListener('click', e => {
  if (e.target === $('#lld-modal')) lldCloseModal();
});

// Ctrl+Z : mémorise l'état juste avant qu'on commence à saisir dans un champ.
// (clearRedo=false : simple navigation au clavier ne vide pas la pile « refaire »)
$('#lld-modal').addEventListener('focusin', () => {
  if (lldDraft) lldPushUndo(false);
});

// Écriture directe des champs texte/textarea dans le brouillon
$('#lld-detail-body').addEventListener('input', e => {
  const sec = e.target.closest('.lld-info[data-key]');
  if (!sec || !lldDraft) return;
  const def = LLD_INFOS[sec.dataset.key];
  if (!def || (def.kind !== 'textarea' && def.kind !== 'fields' && def.kind !== 'ch4matrix')) return;
  const box = sec.querySelector('.lld-info-body');
  if (box) lldInfoFlush(box, def, sec.dataset.key);
});

// ---- Enregistrement : brouillon -> workspace -> exports ----
$('#lld-save').addEventListener('click', () => {
  const ws = active();
  if (!ws || !lldDraft) return;
  lldFlushDetail();
  pushHistory();
  const D = lldDraft;
  const L = D.lld;

  // Lignes vides retirées (comme dans l'ancienne fiche)
  Object.entries(LLD_INFOS).forEach(([k, def]) => {
    if (def.filter && Array.isArray(L[k])) L[k] = L[k].filter(def.filter);
  });
  const notEmpty = r => (r.name || '').trim() || (r.position || '').trim() ||
    (r.organization || '').trim() || (r.approvedVersion || '').trim();
  L.revs = (L.revs || []).filter(r => (r.rev || '').trim() || (r.note || '').trim());
  L.approvers = (L.approvers || []).filter(notEmpty);
  L.reviewers = (L.reviewers || []).filter(notEmpty);
  L.swZones = (L.swZones || []).filter(z => (z.name || '').trim());
  D.sites = (D.sites || []).filter(s => (s.name || '').trim());
  D.flows = (D.flows || [])
    .filter(f => (f.name || '').trim() || (f.src || '').trim() || (f.dst || '').trim())
    .map(f => ({
      id: f.id || uid(),
      name: String(f.name || '').slice(0, 60),
      src: String(f.src || '').slice(0, 80),
      dst: String(f.dst || '').slice(0, 80),
      proto: String(f.proto || '').slice(0, 60),
      sens: f.sens === 'uni' ? 'uni' : 'bi',
      usage: String(f.usage || '').slice(0, 120)
    }));
  if (!(L.fais || []).length) L.fai = {};   // évite la « résurrection » du 1er FAI

  // Normalisation finale (longueurs, sommaire, FAI legacy…)
  normLldInfo(D);
  normSites(D);

  ws.lld = L;
  ws.sites = D.sites;
  ws.flows = D.flows;

  // Zones supprimées -> devices switching détachés
  const zoneIds = new Set((L.swZones || []).map(z => z.id));
  let dezoned = 0;
  ws.racks.forEach(r => r.instances.forEach(i => {
    if (i.zone && !zoneIds.has(i.zone)) { i.zone = ''; dezoned++; }
  }));
  if (dezoned) {
    lldAlert(`${dezoned} device(s) switching étaient rattaché(s) à une zone supprimée :\n`
      + 'ils sont maintenant « hors zone ».', { title: 'ℹ️ Zones de switching' });
  }

  // Sites supprimés -> racks détachés
  const newIds = new Set(ws.sites.map(s => s.id));
  let detached = 0;
  ws.racks.forEach(r => { if (r.siteId && !newIds.has(r.siteId)) { r.siteId = ''; detached++; } });
  if (detached) {
    lldAlert(`${detached} rack(s) étaient rattaché(s) à un site supprimé :\n`
      + 'ils sont maintenant « sans site ».', { title: 'ℹ️ Sites' });
  }

  touchWorkspace(ws);
  saveState();
  lldCloseModal();
  renderBoard();        // met à jour les sélecteurs/pastilles de site des racks
  renderSiteFilter();
});

/* ============================================================
   VUE TOPOLOGIE LOGIQUE — diagramme réseau du workspace
   ------------------------------------------------------------
   Deuxième vue du board (boutons 📐 Élévations / 🕸️ Topologie) :
   les devices posés deviennent des noeuds disposés librement,
   reliés par des liens logiques (débit, VLAN…).
   - ⚡ Générer depuis les racks : un noeud par device posé
   - 🔌 Importer les câbles : un lien par câble physique
   - ➕ Nouveau lien : cliquez deux noeuds l'un après l'autre
   Double-clic sur un noeud : retour en élévations, focus device.
   ============================================================ */

const TOPO_NW = 190, TOPO_NH = 64;

function ensureTopology(ws) {
  if (!ws.topology || !Array.isArray(ws.topology.nodes) || !Array.isArray(ws.topology.links))
    ws.topology = { nodes: [], links: [] };
  return ws.topology;
}

// Retire les noeuds pointant vers des devices supprimés + liens orphelins
function pruneTopology(ws) {
  if (!ws?.topology) return false;
  let changed = false;
  const ids = new Set(ws.racks.flatMap(r => r.instances.map(i => i.id)));
  const before = ws.topology.nodes.length;
  ws.topology.nodes = ws.topology.nodes.filter(n => ids.has(n.instId));
  if (ws.topology.nodes.length !== before) changed = true;
  const nids = new Set(ws.topology.nodes.map(n => n.id));
  const bl = ws.topology.links.length;
  ws.topology.links = ws.topology.links.filter(l => nids.has(l.a) && nids.has(l.b) && l.a !== l.b);
  if (ws.topology.links.length !== bl) changed = true;
  return changed;
}

function exitTopoLinking() {
  topoLinkPending = null;
  document.body.classList.remove('topo-linking');
  $('#mode-hint').textContent = 'Topologie : disposez les noeuds et reliez-les (liens logiques).';
}

function setBoardMode(mode) {
  if (boardMode === mode) return;
  boardMode = mode;
  document.body.classList.toggle('topo-mode', mode === 'topo');
  document.body.classList.toggle('mode3d', mode === '3d');
  $('#view-elev').classList.toggle('active', mode === 'elev');
  $('#view-topo').classList.toggle('active', mode === 'topo');
  $('#view-3d')?.classList.toggle('active', mode === '3d');
  if (mode === 'topo') {
    setLabelMode(null);
    setCablingMode(false);
    exitTopoLinking();
    $('#mode-hint').textContent = 'Topologie : disposez les noeuds et reliez-les (liens logiques).';
  } else if (mode === '3d') {
    setLabelMode(null);
    setCablingMode(false);
    exitTopoLinking();
    hideDevicePopover();
    if (!window.LLDraw3D) {
      $('#mode-hint').textContent = 'Vue 3D indisponible : le module view3d.js n\u2019a pas pu \u00eatre charg\u00e9 (servez l\u2019application via server.py ou HTTPS).';
    } else {
      $('#mode-hint').textContent = 'Vue 3D : glissez pour orbiter autour des baies — passez derri\u00e8re pour voir les ports et les c\u00e2bles.';
      window.LLDraw3D.enter();
    }
  } else {
    window.LLDraw3D?.exit();
    $('#mode-hint').textContent = 'Glissez un rack sur le board, puis ajoutez vos devices.';
  }
  renderBoard();
  if (mode !== '3d') fitViewToContent();
}
$('#view-elev').addEventListener('click', () => setBoardMode('elev'));
$('#view-topo').addEventListener('click', () => setBoardMode('topo'));
$('#view-3d').addEventListener('click', () => setBoardMode('3d'));
// Mise en évidence des équipements d'un flux dans la vue Topologie
$('#topo-flow-sel').addEventListener('change', e => {
  topoFlowFilter = e.target.value;
  renderBoard();
});

// Retrouve { rack, inst } d'un noeud
function topoInstOf(ws, node) {
  for (const r of ws.racks) {
    const inst = r.instances.find(x => x.id === node.instId);
    if (inst) return { rack: r, inst };
  }
  return null;
}

function renderTopology(ws) {
  board.innerHTML = '';      // les handlers appellent renderTopology directement
  const topo = ensureTopology(ws);
  if (pruneTopology(ws)) { touchWorkspace(ws); saveState(); }
  $('#board-empty').classList.add('hidden');
  $('#topo-toolbar').classList.remove('hidden');
  $('#topo-empty').classList.toggle('hidden', topo.nodes.length > 0);

  // Sélecteur de flux : met en évidence les équipements source/destination
  const flowSel = $('#topo-flow-sel');
  let flowMatch = null;
  if (flowSel) {
    const flows = ws.flows || [];
    if (topoFlowFilter && !flows.some(f => f.id === topoFlowFilter)) topoFlowFilter = '';
    flowSel.classList.toggle('hidden', flows.length === 0);
    flowSel.innerHTML = '<option value="">🔄 Flux : tous</option>' +
      flows.map(f => `<option value="${f.id}">${escapeHtml(f.name || f.src || f.dst || 'Flux')}</option>`).join('');
    flowSel.value = topoFlowFilter;
    if (topoFlowFilter) {
      const flow = flows.find(f => f.id === topoFlowFilter);
      if (flow) {
        flowMatch = new Set(topo.nodes
          .filter(n => { const info = topoInstOf(ws, n); return info && flowMatchesInst(flow, info.inst); })
          .map(n => n.id));
      }
    }
  }

  // Couche SVG des liens (sous les noeuds)
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'topo-svg';
  board.appendChild(svg);

  const nodeById = id => topo.nodes.find(n => n.id === id);

  const drawLinks = () => {
    svg.innerHTML = '';
    
    // Grouper les liens par paire de noeuds pour les décaler
    const linkGroups = new Map();
    for (const l of topo.links) {
      const na = nodeById(l.a), nb = nodeById(l.b);
      if (!na || !nb) continue;
      // Clé triée pour identifier la paire (a-b = b-a)
      const key = [l.a, l.b].sort().join('-');
      if (!linkGroups.has(key)) linkGroups.set(key, []);
      linkGroups.get(key).push(l);
    }
    
    for (const [key, links] of linkGroups) {
      const count = links.length;
      links.forEach((l, index) => {
        const na = nodeById(l.a), nb = nodeById(l.b);
        if (!na || !nb) return;
        
        let x1 = na.x + TOPO_NW / 2, y1 = na.y + TOPO_NH / 2;
        let x2 = nb.x + TOPO_NW / 2, y2 = nb.y + TOPO_NH / 2;
        const color = l.color || '#60a5fa';
        // Flux sélectionné : atténuer les liens dont les deux extrémités
        // ne font pas partie du flux
        const dimL = flowMatch && !(flowMatch.has(l.a) && flowMatch.has(l.b));

        // Décaler les liens multiples entre les mêmes noeuds
        if (count > 1) {
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            // Vecteur perpendiculaire pour le décalage
            const px = -dy / len, py = dx / len;
            // Espacer les liens de 12px les uns des autres
            const offset = (index - (count - 1) / 2) * 12;
            x1 += px * offset;
            y1 += py * offset;
            x2 += px * offset;
            y2 += py * offset;
          }
        }

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '2.5');
        if (l.style === 'dashed') line.setAttribute('stroke-dasharray', '7 5');
        if (dimL) line.setAttribute('opacity', '0.15');
        svg.appendChild(line);

        const label = [l.label, l.speed, l.vlan && 'VLAN ' + l.vlan].filter(Boolean).join(' · ');
        if (label) {
          const t = document.createElementNS(svgNS, 'text');
          t.setAttribute('x', (x1 + x2) / 2);
          t.setAttribute('y', (y1 + y2) / 2 - 6);
          t.setAttribute('fill', '#e6ecf5');
          t.setAttribute('font-size', '11');
          t.setAttribute('font-weight', '600');
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('paint-order', 'stroke');
          t.setAttribute('stroke', '#0b0d11');
          t.setAttribute('stroke-width', '3.5');
          t.textContent = label;
          if (dimL) t.setAttribute('opacity', '0.25');
          svg.appendChild(t);
        }

        // Zone cliquable invisible (édition du lien)
        const hit = document.createElementNS(svgNS, 'line');
        hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
        hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
        hit.setAttribute('stroke', 'rgba(0,0,0,0)');
        hit.setAttribute('stroke-width', '14');
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', e => {
          e.stopPropagation();
          openLinkPopover(l, e.clientX, e.clientY, false);
        });
        svg.appendChild(hit);
      });
    }
  };

  for (const n of topo.nodes) {
    const info = topoInstOf(ws, n);
    const inst = info?.inst;
    const el = document.createElement('div');
    el.className = 'topo-node' + (topoLinkPending === n.id ? ' pending' : '');
    if (flowMatch && !flowMatch.has(n.id)) el.classList.add('topo-dim');
    el.dataset.nodeId = n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.innerHTML = `
      <div class="tn-head"><span class="tn-led"></span><span class="tn-name">${catIcon(inst?.cat)} ${escapeHtml(inst?.name || '?')}</span></div>
      <div class="tn-sub">${escapeHtml([inst?.brand, inst?.model].filter(Boolean).join(' ') || '—')}</div>
      <div class="tn-sub2">${escapeHtml(info ? `${info.rack.name} · U${inst.slot + 1}` : '')}${inst?.ipMgmt ? ' · ' + escapeHtml(inst.ipMgmt) : ''}</div>`;

    // Déplacement du noeud
    el.addEventListener('pointerdown', e => {
      if ((e.button !== 0 && e.pointerType === 'mouse') || topoLinkPending) return;
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY, ox = n.x, oy = n.y;
      let nodeRaf = 0;
      el.setPointerCapture(e.pointerId);
      const onMove = ev => {
        n.x = Math.max(0, ox + (ev.clientX - startX) / view.scale);
        n.y = Math.max(0, oy + (ev.clientY - startY) / view.scale);
        // Une seule mise à jour visuelle par frame (drawLinks reconstruit le SVG)
        if (!nodeRaf) {
          nodeRaf = requestAnimationFrame(() => {
            nodeRaf = 0;
            el.style.left = n.x + 'px';
            el.style.top = n.y + 'px';
            drawLinks();
          });
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        if (nodeRaf) { cancelAnimationFrame(nodeRaf); nodeRaf = 0; }
        el.style.left = n.x + 'px';
        el.style.top = n.y + 'px';
        drawLinks();
        touchWorkspace(active());
        saveState();
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });

    // Création de lien : 1er clic = départ, 2e = arrivée
    el.addEventListener('click', e => {
      if (!document.body.classList.contains('topo-linking')) return;
      e.stopPropagation();
      if (!topoLinkPending) {
        topoLinkPending = n.id;
        el.classList.add('pending');
        return;
      }
      if (topoLinkPending === n.id) { exitTopoLinking(); renderTopology(ws); return; }
      const w = active();
      const t = ensureTopology(w);
      pushHistory();
      const link = { id: uid(), a: topoLinkPending, b: n.id, label: '', speed: '1 Gbps', vlan: '', style: 'solid', color: '#60a5fa' };
      t.links.push(link);
      exitTopoLinking();
      touchWorkspace(w);
      saveState();
      renderTopology(w);
      openLinkPopover(link, e.clientX, e.clientY, true);
    });

    // Double-clic : focus sur le device en vue élévations
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (!info) return;
      setBoardMode('elev');
      const rect = viewport.getBoundingClientRect();
      view.scale = 1;
      view.x = rect.width / 2 - (info.rack.x + RACK_W / 2);
      view.y = rect.height / 2 - (info.rack.y + rackHeight(info.rack) / 2);
      markViewTouched();
      applyView();
      renderBoard();
      requestAnimationFrame(() => {
        const devEl = board.querySelector(`.device[data-instance-id="${inst.id}"]`);
        if (devEl) {
          devEl.classList.remove('flash-target');
          void devEl.offsetWidth;
          devEl.classList.add('flash-target');
          setTimeout(() => devEl.classList.remove('flash-target'), 5500);
        }
      });
    });

    board.appendChild(el);
  }
  drawLinks();
}

// --- Barre d'outils topologie ---
$('#topo-gen').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  const topo = ensureTopology(ws);
  pushHistory();
  sortedRacks(ws).forEach((rack, ri) => {
    let row = 0;
    [...rack.instances].sort((a, b) => b.slot - a.slot).forEach(inst => {
      if (!topo.nodes.some(x => x.instId === inst.id))
        topo.nodes.push({ id: uid(), instId: inst.id, x: 80 + ri * 260, y: 80 + row * 110 });
      row++;
    });
  });
  touchWorkspace(ws);
  saveState();
  renderTopology(ws);
  fitViewToContent();
});

$('#topo-import-cables').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  const topo = ensureTopology(ws);
  const nodeOfInst = iid => topo.nodes.find(n => n.instId === iid);
  const candidates = [];
  for (const c of (ws.cables || [])) {
    const a = resolveEndpoint(ws, c.a), b = resolveEndpoint(ws, c.b);
    if (!a || !b || a.inst.id === b.inst.id) continue;
    const na = nodeOfInst(a.inst.id), nb = nodeOfInst(b.inst.id);
    if (!na || !nb) continue;
    if (topo.links.some(l => (l.a === na.id && l.b === nb.id) || (l.a === nb.id && l.b === na.id))) continue;
    candidates.push({ na, nb, name: c.name || '' });
  }
  if (!candidates.length) {
    lldAlert('Aucun câble importable (vérifiez que les noeuds existent — « ⚡ Générer » d\'abord).', { title: '🔌 Importer les câbles' });
    return;
  }
  pushHistory();
  for (const c of candidates)
    topo.links.push({ id: uid(), a: c.na.id, b: c.nb.id, label: c.name, speed: '', vlan: '', style: 'solid', color: '#34d399' });
  touchWorkspace(ws);
  saveState();
  renderTopology(ws);
});

$('#topo-new-link').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  const topo = ensureTopology(ws);
  if (!topo.nodes.length) {
    lldAlert('Aucun noeud pour l\'instant : cliquez « ⚡ Générer depuis les racks » d\'abord.', { title: '🕸️ Nouveau lien' });
    return;
  }
  exitTopoLinking();
  document.body.classList.add('topo-linking');
  $('#mode-hint').textContent = 'Nouveau lien : cliquez le premier noeud, puis le second (Échap pour annuler).';
});

// --- Popover d'édition d'un lien ---
let linkCtx = null;

function openLinkPopover(link, clientX, clientY, isNew) {
  linkCtx = { link };
  $('#tl-title').textContent = isNew ? 'Nouveau lien' : 'Modifier le lien';
  $('#tl-label').value = link.label || '';
  $('#tl-speed').value = link.speed || '';
  $('#tl-vlan').value = link.vlan || '';
  $('#tl-style').value = link.style || 'solid';
  $('#tl-color').value = link.color || '#60a5fa';
  $('#tl-delete').classList.toggle('hidden', isNew);
  const pop = $('#link-popover');
  pop.classList.remove('hidden');
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = clientX + 14, y = clientY + 14;
  if (x + w > window.innerWidth - 10) x = clientX - w - 14;
  if (y + h > window.innerHeight - 10) y = clientY - h - 14;
  pop.style.left = Math.max(8, x) + 'px';
  pop.style.top = Math.max(8, y) + 'px';
  $('#tl-label').focus();
}

function hideLinkPopover() {
  $('#link-popover').classList.add('hidden');
  linkCtx = null;
}

$('#tl-save').addEventListener('click', () => {
  if (!linkCtx) return;
  const { link } = linkCtx;
  pushHistory();
  link.label = $('#tl-label').value.trim().slice(0, 60);
  link.speed = $('#tl-speed').value;
  link.vlan = $('#tl-vlan').value.trim().slice(0, 30);
  link.style = $('#tl-style').value;
  link.color = $('#tl-color').value;
  hideLinkPopover();
  touchWorkspace(active());
  saveState();
  renderTopology(active());
});

$('#tl-delete').addEventListener('click', () => {
  if (!linkCtx) return;
  const ws = active();
  const topo = ensureTopology(ws);
  pushHistory();
  topo.links = topo.links.filter(l => l.id !== linkCtx.link.id);
  hideLinkPopover();
  touchWorkspace(ws);
  saveState();
  renderTopology(ws);
});

$('#tl-cancel').addEventListener('click', hideLinkPopover);
$('#link-popover').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') $('#tl-save').click();
  if (e.key === 'Escape') hideLinkPopover();
});

/* ============================================================
   EXPORT DU PLAN — PNG / PDF (rendu canvas haute définition)
   ============================================================ */

// Dessine le plan du workspace courant sur un canvas et le renvoie
async function renderPlanCanvas() {
  const ws = active();
  if (!ws || !ws.racks.length) return null;

  // Préchargement de toutes les photos de devices
  const imgCache = new Map();
  const imgUrls = new Set();
  ws.racks.forEach(r => r.instances.forEach(i => { const ph = instPhoto(i); if (ph) imgUrls.add(ph); }));
  await Promise.all([...imgUrls].map(url => new Promise(res => {
    const im = new Image();
    im.onload = () => { imgCache.set(url, im); res(); };
    im.onerror = () => res();
    im.src = url;
  })));

  // Icône de port RJ45
  const rj45 = await new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = 'assets/rj45-port.svg';
  });

  const PAD = 60;
  const innerW = 292;  // .rack-inner width à l'écran

  // Zone englobante des racks
  const minX = Math.min(...ws.racks.map(r => r.x)) - PAD;
  const minY = Math.min(...ws.racks.map(r => r.y)) - PAD;
  const maxX = Math.max(...ws.racks.map(r => r.x + RACK_W)) + PAD;
  const maxY = Math.max(...ws.racks.map(r => r.y + rackHeight(r))) + PAD;
  const W = Math.ceil(maxX - minX);
  const H = Math.ceil(maxY - minY);

  const SCALE = 2;  // netteté (HiDPI)
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const ctx = c.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Fond
  ctx.fillStyle = '#e4e7ee';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c9cfdb';
  const gap = 24;
  for (let gx = gap / 2; gx < W; gx += gap) {
    for (let gy = gap / 2; gy < H; gy += gap) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  for (const rack of ws.racks) {
    const x = rack.x - minX;
    const y = rack.y - minY;
    const sizeU = rack.sizeU || DEFAULT_RACK_U;
    const bodyH = 16 + sizeU * U_H;
    const totalH = 28 + bodyH;

    // En-tête
    ctx.fillStyle = '#363b46';
    roundRect(x, y, RACK_W, totalH, 8);
    ctx.fill();
    ctx.fillStyle = '#3b4250';
    roundRect(x, y, RACK_W, 28, 8);
    ctx.fill();
    // LED
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(x + 18, y + 14, 3.5, 0, Math.PI * 2); ctx.fill();
    // Titre
    ctx.fillStyle = '#e8ebf1';
    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(truncate(ctx, rack.name, RACK_W - 90), x + 30, y + 15);
    // Site du rack : pastille colorée + nom, après le titre
    const sName = siteName(ws, rack);
    if (sName) {
      const tW = ctx.measureText(truncate(ctx, rack.name, RACK_W - 90)).width;
      const sx = x + 30 + tW + 8;
      ctx.fillStyle = siteColor(ws, rack) || '#9aa3b2';
      roundRect(sx, y + 11, 6, 6, 2);
      ctx.fill();
      ctx.fillStyle = '#aab4c4';
      ctx.font = '9.5px "Segoe UI", sans-serif';
      ctx.fillText(truncate(ctx, sName, Math.max(30, RACK_W - 110 - tW)), sx + 9, y + 15);
    }

    // Bâti
    const by = y + 28;
    ctx.fillStyle = '#333842';
    ctx.fillRect(x, by, RACK_W, bodyH);
    const fx = x + 6, fy = by + 8;
    ctx.fillStyle = '#101318';
    ctx.fillRect(fx, fy, RACK_W - 12, sizeU * U_H);

    // Règle des U
    const rulerW = 22, railW = 17;
    ctx.fillStyle = '#e3e6ec';
    ctx.fillRect(fx, fy, rulerW, sizeU * U_H);
    ctx.strokeStyle = '#b3b8c2';
    ctx.fillStyle = '#606673';
    ctx.font = 'bold 9.5px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < sizeU; i++) {
      const uy = fy + i * U_H;
      ctx.beginPath(); ctx.moveTo(fx, uy + U_H); ctx.lineTo(fx + rulerW, uy + U_H); ctx.stroke();
      ctx.fillText(String(sizeU - i), fx + rulerW / 2, uy + U_H / 2 + 0.5);
    }

    // Montants perforés
    ctx.fillStyle = '#101318';
    const rail1 = fx + rulerW;
    ctx.fillRect(rail1, fy, railW, sizeU * U_H);
    ctx.fillRect(fx + RACK_W - 12 - railW, fy, railW, sizeU * U_H);
    ctx.fillStyle = '#05070a';
    for (let i = 0; i < sizeU; i++) {
      const uy = fy + i * U_H;
      [4, 14, 24].forEach(hy => {
        ctx.fillRect(rail1 + 4, uy + hy, 9, 5);
        ctx.fillRect(fx + RACK_W - 12 - railW + 4, uy + hy, 9, 5);
      });
    }

    // Zone intérieure + devices
    const inX = fx + rulerW + railW;
    const inW = innerW;
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(inX, fy, inW, sizeU * U_H);

    for (const inst of rack.instances) {
      const dy = fy + inst.slot * U_H;
      const dh = inst.sizeU * U_H;
      ctx.save();
      ctx.beginPath(); ctx.rect(inX, dy, inW, dh); ctx.clip();
      const ph = instPhoto(inst);
      const img = ph ? imgCache.get(ph) : null;
      if (img) {
        ctx.drawImage(img, inX, dy, inW, dh);
      } else {
        const grad = ctx.createLinearGradient(0, dy, 0, dy + dh);
        grad.addColorStop(0, '#c9cdd5');
        grad.addColorStop(.45, '#b6bbc6');
        grad.addColorStop(1, '#a7adb9');
        ctx.fillStyle = grad;
        ctx.fillRect(inX, dy, inW, dh);
        ctx.fillStyle = '#22c55e';
        ctx.beginPath(); ctx.arc(inX + 20, dy + dh / 2, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.fillRect(inX + 45, dy + dh / 2 - 9, Math.min(inW - 90, Math.max(90, inst.name.length * 6.4)), 18);
        ctx.strokeStyle = 'rgba(0,0,0,.12)';
        ctx.strokeRect(inX + 45, dy + dh / 2 - 9, Math.min(inW - 90, Math.max(90, inst.name.length * 6.4)), 18);
        ctx.fillStyle = '#3c434f';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(truncate(ctx, `${inst.name} · ${inst.sizeU}U`, inW - 100), inX + 52, dy + dh / 2 + 0.5);
      }
      ctx.restore();

      // Ports (icône RJ45, taille personnalisable)
      (inst.ports || []).forEach(p => {
        const px = inX + (p.xPct / 100) * inW;
        const py = dy + (p.yPct / 100) * dh;
        const size = 26 * (p.size || 1);
        if (rj45) {
          ctx.drawImage(rj45, px - size / 2, py - size / 2, size, size);
        } else {
          ctx.fillStyle = '#fef3c7';
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 2;
          ctx.fillRect(px - size / 2, py - size / 2, size, size);
          ctx.strokeRect(px - size / 2, py - size / 2, size, size);
        }
      });

      // séparation
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.moveTo(inX, dy); ctx.lineTo(inX + inW, dy); ctx.stroke();
    }

    // contour de la zone intérieure
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(inX, fy, inW, sizeU * U_H);
  }

  // ---- Câbles (même géométrie que à l'écran) ----
  pruneCables(ws);
  for (const cable of ws.cables) {
    const ea = resolveEndpoint(ws, cable.a);
    const eb = resolveEndpoint(ws, cable.b);
    if (!ea || !eb) continue;
    const ap = exportPortPos(ea, minX, minY);
    const bp = exportPortPos(eb, minX, minY);
    if (!ap || !bp) continue;
    const { d } = cablePath(ap, bp, cable);

    // ombre portée
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.save();
    ctx.translate(3, 4);
    drawBezier(ctx, d);
    ctx.restore();
    // gaine
    ctx.strokeStyle = cable.color;
    ctx.lineWidth = 4;
    drawBezier(ctx, d);
    // extrémités
    ctx.fillStyle = cable.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    [ap, bp].forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  return c;

  // Position d'un port dans le repère du canvas d'export
  function exportPortPos(ep, minX, minY) {
    const { rack, inst, port } = ep;
    const fx = rack.x - minX + 6;
    const fy = rack.y - minY + 28 + 8;
    const rulerW = 22, railW = 17;
    const inX = fx + rulerW + railW;
    const top = fy + inst.slot * U_H;
    return {
      x: inX + (port.xPct / 100) * innerW,
      y: top + (port.yPct / 100) * (inst.sizeU * U_H)
    };
  }
}

// Dessine la vue topologie sur un canvas et le renvoie
function renderTopoCanvas() {
  const ws = active();
  if (!ws) return null;
  const topo = ws.topology;
  if (!topo || !topo.nodes.length) return null;

  const PAD = 60;
  const NW = 190, NH = 64;

  // Zone englobante des noeuds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  topo.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NW);
    maxY = Math.max(maxY, n.y + NH);
  });
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const W = Math.ceil(maxX - minX);
  const H = Math.ceil(maxY - minY);

  const SCALE = 2;
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const ctx = c.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Fond
  ctx.fillStyle = '#1a2130';
  ctx.fillRect(0, 0, W, H);

  // Grille de points
  ctx.fillStyle = '#252d3d';
  const gap = 24;
  for (let gx = gap / 2; gx < W; gx += gap) {
    for (let gy = gap / 2; gy < H; gy += gap) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Liens
  const nodeById = id => topo.nodes.find(n => n.id === id);
  for (const l of topo.links) {
    const na = nodeById(l.a), nb = nodeById(l.b);
    if (!na || !nb) continue;
    const x1 = na.x - minX + NW / 2, y1 = na.y - minY + NH / 2;
    const x2 = nb.x - minX + NW / 2, y2 = nb.y - minY + NH / 2;
    const color = l.color || '#60a5fa';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    if (l.style === 'dashed') ctx.setLineDash([7, 5]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = [l.label, l.speed, l.vlan && 'VLAN ' + l.vlan].filter(Boolean).join(' · ');
    if (label) {
      ctx.fillStyle = '#e6ecf5';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 6);
    }
  }

  // Noeuds
  for (const n of topo.nodes) {
    const info = topoInstOf(ws, n);
    const inst = info?.inst;
    const x = n.x - minX, y = n.y - minY;

    // Fond du noeud
    ctx.fillStyle = '#232b3a';
    ctx.strokeStyle = '#3b465a';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, NW, NH, 10);
    ctx.fill();
    ctx.stroke();

    // Bordure gauche colorée
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(x, y + 10, 4, NH - 20);

    // LED
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(x + 14, y + 16, 4, 0, Math.PI * 2);
    ctx.fill();

    // Nom
    ctx.fillStyle = '#eef2f8';
    ctx.font = 'bold 12.5px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(ctx, inst?.name || '?', NW - 30), x + 24, y + 16);

    // Sous-titre
    ctx.fillStyle = '#9fb0c8';
    ctx.font = '10.5px "Segoe UI", sans-serif';
    const sub = [inst?.brand, inst?.model].filter(Boolean).join(' ') || '—';
    ctx.fillText(truncate(ctx, sub, NW - 20), x + 10, y + 34);

    // Sous-titre 2
    ctx.fillStyle = '#7488a3';
    ctx.font = '10px "Segoe UI", sans-serif';
    const sub2 = info ? `${info.rack.name} · U${inst.slot + 1}` : '';
    ctx.fillText(truncate(ctx, sub2, NW - 20), x + 10, y + 48);
  }

  return c;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// Trace un chemin Bézier SVG-like à partir de sa description "M..C.."
function drawBezier(ctx, d) {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  // [M x y C x1 y1 x2 y2 x y]
  ctx.beginPath();
  ctx.moveTo(nums[0], nums[1]);
  ctx.bezierCurveTo(nums[2], nums[3], nums[4], nums[5], nums[6], nums[7]);
  ctx.stroke();
}

function truncate(ctx, text, maxW) {
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 1) t = t.slice(0, -1);
  return t === text ? t : t.slice(0, -1) + '…';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFileBase() {
  const ws = active();
  const name = (ws?.name || 'plan').replace(/[^a-z0-9-_]+/gi, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  return `${name}-${stamp}`;
}

// --- Menu Exporter ---
$('#btn-export').addEventListener('click', e => {
  e.stopPropagation();
  $('#export-menu').classList.toggle('hidden');
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.export-wrap')) $('#export-menu').classList.add('hidden');
});

$('#export-png').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const c = await renderPlanCanvas();
  if (!c) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '🖼️ Export PNG' }); return; }
  c.toBlob(blob => blob && downloadBlob(blob, exportFileBase() + '.png'), 'image/png');
});

$('#export-pdf').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const c = await renderPlanCanvas();
  if (!c) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📄 Export PDF' }); return; }
  // Le PDF embarque le rendu en JPEG (une seule page)
  const jpeg = dataURLBytes(c.toDataURL('image/jpeg', 0.92));
  const blob = canvasToPdfBlob(c.width, c.height, jpeg);
  downloadBlob(blob, exportFileBase() + '.pdf');
});

/* ---------- Exports CSV / Excel (inventaire / câblage / ports / racks) ---------- */
// Format CSV « Excel FR » : séparateur « ; », BOM UTF-8, guillemets si besoin
function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
function downloadCsv(rows, suffix) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, exportFileBase() + '-' + suffix + '.csv');
}
function slotLabel(inst) {
  return inst.sizeU > 1 ? `U${inst.slot + 1}–U${inst.slot + inst.sizeU}` : `U${inst.slot + 1}`;
}
// Racks triés par nom, instances du haut vers le bas du rack
function sortedRackInstances(ws) {
  return [...ws.racks]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
    .flatMap(rack => [...rack.instances].sort((a, b) => b.slot - a.slot)
      .map(inst => ({ rack, inst })));
}
function sortedRacks(ws) {
  return [...(ws?.racks || [])]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
}

function invRows(ws) {
  const rows = [['Rack', 'Site', 'Étage', 'Taille', 'Nom', 'Catégorie', 'Marque', 'Modèle', 'Référence',
                 'N° série', 'IP mgmt', 'VLAN(s)', 'Puissance (W)', 'Poids (kg)',
                 'Garantie (contrat)', 'Fin de garantie', 'Statut garantie', 'Ports']];
  for (const { rack, inst } of sortedRackInstances(ws || { racks: [] })) {
    const wi = warrantyInfo(inst);
    rows.push([rack.name, siteName(ws, rack), slotLabel(inst), inst.sizeU + 'U', inst.name,
               catLabel(inst.cat),
               inst.brand || '', inst.model || '', inst.partRef || '', inst.serial || '',
               inst.ipMgmt || '', inst.vlan || '',
               inst.watts || '', inst.weightKg || '',
               inst.warranty || '',
               wi.status === 'none' ? '' : wi.label,
               warrantyShortStatus(wi.status),
               (inst.ports || []).length]);
  }
  return rows;
}

// Suivi des garanties (échéances, de la plus proche à la plus lointaine) :
// ch. 3.1 du PDF, feuille « Garanties » du classeur Excel et export CSV.
function warrantyRows(ws) {
  const rows = [['Rack', 'Site', 'Étage', 'Device', 'N° série', 'Garantie (contrat)',
                 'Fin de garantie', 'Garantie', 'Échéance']];
  const items = sortedRackInstances(ws || { racks: [] })
    .map(({ rack, inst }) => ({ rack, inst, w: warrantyInfo(inst) }))
    .filter(x => x.w.status !== 'none');
  items.sort((a, b) => a.w.days - b.w.days);   // la plus proche échéance en tête
  for (const { rack, inst, w } of items) {
    rows.push([rack.name, siteName(ws, rack), slotLabel(inst), inst.name, inst.serial || '',
               inst.warranty || '', w.label,
               warrantyStatusLabel(w.status), warrantyDaysText(w)]);
  }
  return rows;
}
// Bilan des garanties du workspace : { total, in, out, soon, none, without }
function warrantySummary(ws) {
  const all = (ws?.racks || []).flatMap(r => r.instances.map(i => warrantyInfo(i)));
  const known = all.filter(w => w.status !== 'none');
  return {
    total: all.length,
    known: known.length,
    in: known.filter(w => w.status === 'in').length,
    out: known.filter(w => w.status === 'out').length,
    soon: known.filter(w => w.soon).length,
    without: all.length - known.length
  };
}
// Récapitulatif des équipements par catégorie (ch. 3.1 du PDF)
function catSummaryRows(ws) {
  const rows = [['Catégorie', 'Nb', 'Modèles', 'Sites', 'Hors garantie']];
  const byCat = new Map();
  for (const { rack, inst } of sortedRackInstances(ws || { racks: [] })) {
    const c = normCat(inst.cat);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push({ rack, inst });
  }
  const order = Object.fromEntries(DEV_CATEGORIES.map(([id], i) => [id, i]));
  [...byCat.keys()].sort((a, b) => order[a] - order[b]).forEach(c => {
    const items = byCat.get(c);
    const models = [...new Set(items.map(x => [x.inst.brand, x.inst.model].filter(Boolean).join(' ')).filter(Boolean))];
    const sites = [...new Set(items.map(x => siteName(ws, x.rack)).filter(Boolean))];
    const out = items.filter(x => warrantyInfo(x.inst).status === 'out').length;
    rows.push([`${catIcon(c)} ${catLabel(c)}`, items.length,
               models.join(', ') || '\u2014', sites.join(', ') || '\u2014',
               out ? String(out) : '\u2014']);
  });
  return rows;
}

// Nom de la zone de switching d'un device posé (ch. 8)
function zoneNameOf(ws, inst) {
  const z = (ws?.lld?.swZones || []).find(x => x.id === (inst?.zone || ''));
  return z ? z.name : '';
}

// Équipements d'un chapitre : filtrés par catégories (et par zone de switching).
// zoneId = null -> toutes les zones ; '' -> hors zone ; sinon id de zone.
function catEquipRows(ws, cats, zoneId = null) {
  const rows = [['Rack', 'Site', 'Étage', 'Nom', 'Marque', 'Modèle', 'IP mgmt', 'VLAN(s)',
                 'Fin de garantie', 'Garantie', 'Ports']];
  for (const { rack, inst } of sortedRackInstances(ws || { racks: [] })) {
    if (!cats.includes(normCat(inst.cat))) continue;
    if (zoneId !== null && (inst.zone || '') !== zoneId) continue;
    const wi = warrantyInfo(inst);
    rows.push([rack.name, siteName(ws, rack), slotLabel(inst), inst.name,
               inst.brand || '', inst.model || '', inst.ipMgmt || '', inst.vlan || '',
               wi.status === 'none' ? '' : wi.label,
               wi.status === 'none' ? '' : warrantyStatusLabel(wi.status),
               (inst.ports || []).length]);
  }
  return rows;
}
// Largeurs + coloriage du tableau « Équipements » des chapitres 7 → 13
// (la colonne « Garantie » est écrite en vert / rouge, colonne n° 9)
const CAT_EQUIP_WIDTHS = [1.05, 0.7, 0.45, 1.35, 1.0, 1.15, 0.8, 0.75, 0.85, 1.05, 0.45];
const PDF_GREEN = [0.09, 0.64, 0.29], PDF_RED = [0.86, 0.15, 0.15], PDF_MUTED = [0.42, 0.45, 0.5];
// Couleur d'une cellule de statut de garantie (deux couleurs, comme l'app)
function pdfWarrantyCellColor(ci, statusCol, val) {
  if (ci !== statusCol || !val) return null;
  return val === WARRANTY_STATUS.in.lbl ? PDF_GREEN : PDF_RED;
}

// Ports & adressage des équipements d'un chapitre
function portsRowsByCat(ws, cats) {
  const rows = [['Rack', 'Site', 'Étage', 'Device', 'Port', 'Étiquette', 'IP', 'VLAN']];
  for (const { rack, inst } of sortedRackInstances(ws || { racks: [] })) {
    if (!cats.includes(normCat(inst.cat))) continue;
    for (const p of (inst.ports || [])) {
      rows.push([rack.name, siteName(ws, rack), slotLabel(inst), inst.name, p.name,
                 p.label || '', p.ip || '', p.vlan || '']);
    }
  }
  return rows;
}

// ---------- Flux réseau (ch. 14) ----------
// Tableau de la matrice des flux (PDF / exports)
function flowsRows(ws) {
  const L = normLldInfo(ws || {});
  const cols = lldExportCols(L, 'flows', LLD_FLOW_COLS);
  const rows = [cols.map(c => String(c[1]))];
  for (const f of (ws?.flows || [])) {
    rows.push(cols.map(c => (c[0] === 'sens'
      ? (f.sens === 'uni' ? 'Unidirectionnel' : 'Bidirectionnel')
      : String(f[c[0]] ?? ''))));
  }
  return rows;
}

// Un flux « concerne » un device si son nom apparaît dans la source ou la
// destination (insensible à la casse) — utilisé pour la mise en évidence
// des équipements d'un flux dans la vue Topologie.
function flowMatchesInst(flow, inst) {
  const hay = `${flow?.src || ''} ${flow?.dst || ''}`.toLowerCase();
  const name = String(inst?.name || '').trim().toLowerCase();
  return !!name && hay.includes(name);
}

// Sites (feuille Excel / CSV)
function sitesRows(ws) {
  const L = normLldInfo(ws || {});
  const cols = lldExportCols(L, 'sites', LLD_SITE_COLS);
  const rows = [[...cols.map(c => String(c[1])), 'Racks']];
  for (const s of (ws?.sites || [])) {
    const nb = (ws?.racks || []).filter(r => r.siteId === s.id).length;
    rows.push([...cols.map(c => String(s[c[0]] ?? '')), nb]);
  }
  return rows;
}

// Nomenclature (feuille Excel / CSV)
function nomenRows(ws) {
  const L = normLldInfo(ws || {});
  const cols = lldExportCols(L, 'nomen', LLD_NOMEN_COLS);
  const rows = [cols.map(c => String(c[1]))];
  L.nomen.forEach(r => rows.push(cols.map(c => String(r[c[0]] ?? ''))));
  return rows;
}

// Adressage IP global : registre VLANs & subnets (feuille Excel / CSV)
function addressingRows(ws) {
  const L = normLldInfo(ws || {});
  const cols = lldExportCols(L, 'vlans', LLD_VLAN_COLS);
  const rows = [cols.map(c => String(c[1]))];
  L.vlans.forEach(v => rows.push(cols.map(c => String(v[c[0]] ?? ''))));
  return rows;
}

// Corps commun du tableau de câblage. domain = null : tous les câbles ;
// withDomain : ajoute la colonne « Domaine » (chapitre du dossier LLD).
function cablingRowsBase(ws, domain = null, withDomain = false) {
  const head = ['ID câble', 'Couleur'];
  if (withDomain) head.push('Domaine');
  head.push('Rack A', 'Device A', 'Port A', 'Étiquette A',
            'Rack B', 'Device B', 'Port B', 'Étiquette B');
  const rows = [head];
  const epDesc = ep => {
    const d = resolveEndpoint(ws, ep);
    return d ? [d.rack.name, d.inst.name, d.port.name, d.port.label || ''] : ['', '', '', ''];
  };
  for (const c of (ws?.cables || [])) {
    if (domain !== null && (c.domain || '') !== domain) continue;
    const r = [c.name || '', c.color || ''];
    if (withDomain) r.push(cableDomainLabel(c.domain));
    r.push(...epDesc(c.a), ...epDesc(c.b));
    rows.push(r);
  }
  return rows;
}
function cablingRows(ws) { return cablingRowsBase(ws, null, true); }
// Câbles d'un seul domaine (ch. 5.2 FAI, 6.2 interconnexion…) : sans la colonne Domaine
function cablingRowsByDomain(ws, domain) { return cablingRowsBase(ws, domain, false); }
function portsRows(ws) {
  const rows = [['Rack', 'Site', 'Étage', 'Device', 'Port', 'Étiquette', 'IP', 'VLAN', 'Câble']];
  const cableOf = (instId, portId) => {
    const c = (ws?.cables || []).find(cb =>
      (cb.a?.instId === instId && cb.a?.portId === portId) ||
      (cb.b?.instId === instId && cb.b?.portId === portId));
    return c ? c.name : '';
  };
  for (const { rack, inst } of sortedRackInstances(ws || { racks: [] })) {
    for (const p of (inst.ports || [])) {
      rows.push([rack.name, siteName(ws, rack), slotLabel(inst), inst.name, p.name, p.label || '',
                 p.ip || '', p.vlan || '', cableOf(inst.id, p.id)]);
    }
  }
  return rows;
}
function racksRows(ws) {
  const rows = [['Rack', 'Site', 'Taille', 'U occupés', 'U libres',
                 'Puissance totale (W)', 'Budget puissance (W)',
                 'Poids total (kg)', 'Charge max (kg)', 'Devices']];
  for (const rack of sortedRacks(ws)) {
    const usedU = rack.instances.reduce((s, i) => s + i.sizeU, 0);
    rows.push([
      rack.name, siteName(ws, rack), rack.sizeU + 'U', usedU, rack.sizeU - usedU,
      rack.instances.reduce((s, i) => s + (i.watts || 0), 0) || '',
      rack.maxWatts || '',
      Math.round(rack.instances.reduce((s, i) => s + (i.weightKg || 0), 0) * 10) / 10 || '',
      rack.maxKg || '',
      rack.instances.length
    ]);
  }
  return rows;
}

$('#export-csv-inv').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = invRows(active());
  if (rows.length < 2) { lldAlert("Aucun device placé dans ce workspace : l'inventaire serait vide.", { title: '📊 Export Inventaire' }); return; }
  downloadCsv(rows, 'inventaire');
});

$('#export-csv-cab').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = cablingRows(active());
  if (rows.length < 2) { lldAlert('Aucun câble dans ce workspace : le tableau de câblage serait vide.', { title: '📊 Export Câblage' }); return; }
  downloadCsv(rows, 'cablage');
});

$('#export-csv-ports').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = portsRows(active());
  if (rows.length < 2) { lldAlert('Aucun port étiqueté dans ce workspace : l\'export serait vide.', { title: '📊 Export Ports' }); return; }
  downloadCsv(rows, 'ports');
});

$('#export-csv-sites').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = sitesRows(active());
  if (rows.length < 2) { lldAlert('Aucun site déclaré dans ce workspace : l\'export serait vide.', { title: '📊 Export Sites' }); return; }
  downloadCsv(rows, 'sites');
});

$('#export-csv-warranty').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = warrantyRows(active());
  if (rows.length < 2) { lldAlert("Aucune garantie renseignée : ouvrez la fiche d'un device placé (double-clic sur « Fin de garantie ») ou la fiche d'inventaire de son modèle.", { title: '📊 Export Garanties' }); return; }
  downloadCsv(rows, 'garanties');
});
$('#export-csv-nomen').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = [...nomenRows(active()), ...addressingRows(active()).slice(1)];
  if (rows.length < 3) { lldAlert('Nomenclature et registre VLANs non renseignés (fiche du dossier, onglet Réseau) : l\'export serait vide.', { title: '📊 Export Nomenclature & Adressage' }); return; }
  downloadCsv(rows, 'nomenclature-adressage');
});

$('#export-csv-flux').addEventListener('click', () => {
  $('#export-menu').classList.add('hidden');
  const rows = flowsRows(active());
  if (rows.length < 2) { lldAlert('Aucun flux défini dans ce workspace (fiche du dossier, onglet Flux) : l\'export serait vide.', { title: '📊 Export Flux' }); return; }
  downloadCsv(rows, 'flux');
});

/* ---------- Générateur Excel .xlsx (OOXML minimal, sans dépendance) ----------
   Un classeur = un ZIP contenant des fichiers XML, écrit à la main :
   ZIP « store » (sans compression) + CRC32 + cellules en chaînes inline.
   En-têtes en gras sur fond bleu, largeurs de colonnes auto, 1re ligne figée. */
const XLSX = (() => {
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
  const enc = new TextEncoder();
  const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function dataUrlBytes(dataUrl) {
    const b64 = String(dataUrl || '').split(',')[1] || '';
    let bin;
    if (typeof atob === 'function') bin = atob(b64);
    else {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let buf = '';
      const clean = b64.replace(/=+$/, '');
      for (let i = 0; i < clean.length; i += 4) {
        const a = chars.indexOf(clean[i]);
        const b = chars.indexOf(clean[i + 1]);
        const c = chars.indexOf(clean[i + 2]);
        const d = chars.indexOf(clean[i + 3]);
        buf += String.fromCharCode((a << 2) | (b >> 4));
        if (clean[i + 2] !== undefined && clean[i + 2] !== '-' && c >= 0) buf += String.fromCharCode(((b & 15) << 4) | (c >> 2));
        if (clean[i + 3] !== undefined && clean[i + 3] !== '-' && d >= 0) buf += String.fromCharCode(((c & 3) << 6) | d);
      }
      bin = buf;
    }
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function drawingXml(images) {
    const anchors = images.map((im, i) => {
      const col = im.col || 1;
      const row = Math.max(0, (im.row | 0));
      const toCol = col + Math.max(4, Math.ceil((im.widthPx || 480) / 70));
      const toRow = row + Math.max(6, Math.ceil((im.heightPx || 240) / 18));
      return `<xdr:twoCellAnchor editAs="oneCell">` +
        `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:pic><xdr:nvPicPr>` +
        `<xdr:cNvPr id="${i + 2}" name="${xmlEsc(im.name || ('img' + i))}"/>` +
        `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>` +
        `</xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${im.relId}"/>` +
        `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        `</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
    }).join('');
    return XML_DECL +
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"` +
      ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      anchors + `</xdr:wsDr>`;
  }
  function sheetXml(rows, opts = {}) {
    // freeze: false -> aucun volet figé ; freezeRows: N -> N premières lignes figées (défaut 1)
    const freeze = opts.freeze !== false;
    const freezeRows = freeze ? (Number.isFinite(opts.freezeRows) ? opts.freezeRows : 1) : 0;
    const autoHeader = opts.autoHeader !== false;
    let cols;
    if (opts.cols) {
      // largeurs imposées par la feuille (réplique du template)
      cols = '<cols>' + opts.cols.map((w, i) =>
        (w && typeof w === 'object')
          ? `<col min="${w.min}" max="${w.max}" width="${w.width}" customWidth="1"/>`
          : `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    } else {
      const nCols = Math.max(8, ...rows.map(r => r.length));
      const widths = [];
      for (let c = 0; c < nCols; c++) {
        let m = 8;
        for (const r of rows) {
          const v = r[c];
          const t = (v && typeof v === 'object') ? v.v : v;
          if (t !== undefined && t !== null) m = Math.max(m, String(t).length);
        }
        widths.push(Math.min(42, m + 2));
      }
      cols = '<cols>' + widths.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }
    let body = '';
    // Regroupement repliable (plan/outline) : rowMeta[n° ligne] = { outline: 1, hidden?, collapsed? }
    const rowMeta = opts.rowMeta || null;
    rows.forEach((row, ri) => {
      const ht = opts.heights && opts.heights[ri + 1];
      const cells = row.map((v, ci) => {
        let val = v, st = null, fx = null;
        if (v && typeof v === 'object') { val = v.v; st = v.s; fx = v.f || null; }
        if (fx) {
          const refF = colName(ci) + (ri + 1);
          return `<c r="${refF}" t="str"${st ? ` s="${st}"` : ''}><f>${xmlEsc(fx)}</f><v>${xmlEsc(val ?? '')}</v></c>`;
        }
        if (val === undefined || val === null || val === '') {
          // cellule vide MAIS stylée (barreaux bleus, bordures) : on l'émet
          if (st === null || st === 0) return '';
          return `<c r="${colName(ci)}${ri + 1}" s="${st}"/>`;
        }
        const ref = colName(ci) + (ri + 1);
        if (st === null) st = (ri === 0 && autoHeader) ? 1 : 0;
        const sAttr = st ? ` s="${st}"` : '';
        if (typeof val === 'number' && Number.isFinite(val)) return `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${sAttr}>` +
               `<is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
      }).join('');
      const rm = rowMeta && rowMeta[ri + 1];
      const rmAttrs = rm
        ? (rm.outline ? ` outlineLevel="${rm.outline}"` : '') +
          (rm.hidden ? ' hidden="1"' : '') +
          (rm.collapsed ? ' collapsed="1"' : '')
        : '';
      body += `<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}${rmAttrs}>${cells}</row>`;
    });
    const merges = (opts.merges && opts.merges.length)
      ? `<mergeCells count="${opts.merges.length}">` +
        opts.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('') + '</mergeCells>'
      : '';
    const views = freezeRows
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const hasOutline = !!(rowMeta && Object.values(rowMeta).some(m => m && (m.outline || m.collapsed)));
    const fmtPr = (opts.dcw || hasOutline)
      ? `<sheetFormatPr${opts.dcw ? ` defaultColWidth="${opts.dcw}"` : ''} defaultRowHeight="15"${hasOutline ? ' outlineLevelRow="1"' : ''}/>`
      : '';
    // Filtres automatiques de la « vue données » (zone d'en-têtes incluse)
    const autofilter = opts.autofilter ? `<autoFilter ref="${xmlEsc(opts.autofilter)}"/>` : '';
    const hasIm = !!(opts.images && opts.images.length);
    const rootOpen = hasIm
      ? '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      : '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    const drawing = hasIm ? '<drawing r:id="rId1"/>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      rootOpen +
      views + fmtPr + cols + '<sheetData>' + body + '</sheetData>' + autofilter + merges + drawing + '</worksheet>';
  }
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  // ZIP minimal (méthode « store », sans compression)
  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0, cdSize = 0;
    const DOS_TIME = 0;
    const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(8, 0, true);          // store
      lh.setUint16(10, DOS_TIME, true);
      lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, DOS_TIME, true);
      ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
      cdSize += 46 + name.length;
    }
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
    const out = new Uint8Array(all.reduce((s, u) => s + u.length, 0));
    let p = 0;
    for (const u of all) { out.set(u, p); p += u.length; }
    return out;
  }

  function sheetHasIm(s) { return !!((s.opts && s.opts.images) || s.images || []).length; }
  function allImgs(s) { return (s.opts && s.opts.images) || s.images || []; }
  function patchContentTypes(files, sheets) {
    const hasIm = sheets.some(sheetHasIm);
    if (!hasIm) return files;
    return files.map(f => {
      if (f.name !== '[Content_Types].xml') return f;
      let xml = String(f.data);
      if (!/Extension="jpeg"/.test(xml))
        xml = xml.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
      if (!/Extension="png"/.test(xml))
        xml = xml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
      sheets.forEach((s, i) => {
        if (!sheetHasIm(s)) return;
        const part = `/xl/drawings/drawing${i + 1}.xml`;
        if (!xml.includes(`PartName="${part}"`))
          xml = xml.replace('</Types>',
            `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      });
      return { name: f.name, data: xml };
    });
  }
  function imageFiles(sheets) {
    const files = [];
    sheets.forEach((s, i) => {
      const imgs = allImgs(s);
      if (!imgs.length) return;
      const rels = [];
      const prepared = imgs.map((im, k) => {
        const ext = /data:image\/png/i.test(im.dataUrl || '') ? 'png' : 'jpeg';
        const mediaName = `image${i + 1}_${k + 1}.${ext}`;
        files.push({ name: `xl/media/${mediaName}`, data: dataUrlBytes(im.dataUrl) });
        const relId = `rId${k + 1}`;
        rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`);
        return Object.assign({}, im, { relId });
      });
      files.push({ name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`, data: XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rels.join('') + '</Relationships>' });
      files.push({ name: `xl/drawings/drawing${i + 1}.xml`, data: drawingXml(prepared) });
      files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/>` +
        '</Relationships>' });
    });
    return files;
  }

  function build(sheets, extra = {}) {
    /* extra = { stylesXml, themeXml } : styles et thème repris VERBATIM d'un
       template Excel — les indices s= des cellules référencent alors directement
       ses cellXfs (fidélité parfaite). Sans extra, moteur de styles interne. */
    if (extra.stylesXml) {
      const files2 = [
        { name: '[Content_Types].xml', data: XML_DECL +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '</Types>' },
        { name: '_rels/.rels', data: XML_DECL +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>' },
        { name: 'xl/workbook.xml', data: XML_DECL +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets>' + sheets.map((s, i) =>
            `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
          '</sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data: XML_DECL +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
          '</Relationships>' },
        { name: 'xl/styles.xml', data: extra.stylesXml },
        { name: 'xl/theme/theme1.xml', data: extra.themeXml },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.opts || {}) })),
        ...imageFiles(sheets)
      ];
      return new Blob([zip(patchContentTypes(files2, sheets))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    /* Moteur de styles : les 9 styles historiques (0..8) gardent leur index pour
       les 9 feuilles existantes ; les feuilles LLD/Governance passent des
       descripteurs { b, sz, name, color, fill, border:{l,r,t,b}, h, v, wrap,
       numFmt } enregistrés à la demande (dédupe fonts/fills/borders/cellXfs),
       en répliquant la mise en forme du template Excel fourni. */
    const fonts = [
      '<font><sz val="11"/><name val="Calibri"/></font>',
      '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>',
      '<font><b/><color rgb="FF1F2733"/><sz val="18"/><name val="Calibri"/></font>',
      '<font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Calibri"/></font>',
      '<font><b/><color rgb="FF1F2733"/><sz val="11"/><name val="Calibri"/></font>',
      '<font><color rgb="FF1F2733"/><sz val="12"/><name val="Calibri"/></font>',
      '<font><b/><color rgb="FF1F2733"/><sz val="16"/><name val="Calibri"/></font>'
    ];
    const fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>',
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>'
    ];
    const borders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      '<border><left style="thin"><color rgb="FF8EA0B8"/></left>' +
      '<right style="thin"><color rgb="FF8EA0B8"/></right>' +
      '<top style="thin"><color rgb="FF8EA0B8"/></top>' +
      '<bottom style="thin"><color rgb="FF8EA0B8"/></bottom><diagonal/></border>'
    ];
    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
      '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
      '<alignment vertical="top" wrapText="1"/></xf>',
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
      '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
      '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    ];
    const fontIdx = new Map(), fillIdx = new Map(), borderIdx = new Map(), xfIdx = new Map();
    function regStyle(d) {
      const k = JSON.stringify(d);
      if (xfIdx.has(k)) return xfIdx.get(k);
      const fk = JSON.stringify([d.name || 'Calibri', d.sz || 11, !!d.b, !!d.i, !!d.u, d.color || '']);
      if (!fontIdx.has(fk)) {
        fontIdx.set(fk, fonts.length);
        fonts.push('<font>' + (d.b ? '<b/>' : '') + (d.i ? '<i/>' : '') + (d.u ? '<u/>' : '') +
          (d.color ? `<color rgb="${d.color}"/>` : '') +
          `<sz val="${d.sz || 11}"/><name val="${d.name || 'Calibri'}"/></font>`);
      }
      let fillId = 0;
      if (d.fill) {
        if (!fillIdx.has(d.fill)) {
          fillIdx.set(d.fill, fills.length);
          fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${d.fill}"/><bgColor indexed="64"/></patternFill></fill>`);
        }
        fillId = fillIdx.get(d.fill);
      }
      const bd = d.border || {};
      const bk = JSON.stringify([bd.l || '', bd.r || '', bd.t || '', bd.b || '']);
      let borderId = 0;
      if (bk !== '["","","",""]') {
        if (!borderIdx.has(bk)) {
          borderIdx.set(bk, borders.length);
          const side = (st, tag) => st ? `<${tag} style="${st}"><color rgb="FF000000"/></${tag}>` : `<${tag}/>`;
          borders.push('<border>' + side(bd.l, 'left') + side(bd.r, 'right') +
            side(bd.t, 'top') + side(bd.b, 'bottom') + '<diagonal/></border>');
        }
        borderId = borderIdx.get(bk);
      }
      const al = (d.h || d.v || d.wrap)
        ? '<alignment' + (d.h ? ` horizontal="${d.h}"` : '') + (d.v ? ` vertical="${d.v}"` : '') +
          (d.wrap ? ' wrapText="1"' : '') + '/>'
        : '';
      xfs.push(`<xf numFmtId="${d.numFmt || 0}" fontId="${fontIdx.get(fk)}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
        (d.numFmt ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' +
        (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') +
        (al ? ' applyAlignment="1">' + al + '</xf>' : '/>'));
      const idx = xfs.length - 1;
      xfIdx.set(k, idx);
      return idx;
    }
    // normalisation : les descripteurs de style deviennent des indices numériques
    for (const s of sheets) for (const row of s.rows) for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c && typeof c === 'object' && c.s && typeof c.s === 'object') c.s = regStyle(c.s);
    }
    const stylesXml = XML_DECL +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<fonts count="${fonts.length}">` + fonts.join('') + '</fonts>' +
      `<fills count="${fills.length}">` + fills.join('') + '</fills>' +
      `<borders count="${borders.length}">` + borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">` + xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
    const files = [
      { name: '[Content_Types].xml', data: XML_DECL +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>' },
      { name: '_rels/.rels', data: XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', data: XML_DECL +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + sheets.map((s, i) =>
          `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>' },
      { name: 'xl/styles.xml', data: stylesXml },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.opts || {}) })),
      ...imageFiles(sheets)
    ];
    const u8 = zip(patchContentTypes(files, sheets));
    return new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  return { build };
})();

/* ============================================================
   EXCEL « VUE DONNÉES » (.xlsx) — alternative lisible au classeur
   « chapitres » : DES DONNÉES exploitables, pas un document plaqué.
     • quelques onglets tabulaires (Inventaire, Ports, Câblage,
       Garanties, Racks, Sites, VLANs, Nomenclature, Flux) ;
     • en-têtes figées + filtres automatiques partout ;
     • Inventaire & Ports REGROUPÉS par baie (plan repliable ± à
       gauche) — fini « RACK-A — Siège … » répété sur chaque ligne ;
     • Garanties colorées (vert / orange / rouge), câbles avec
       pastille de couleur ;
     • Sommaire avec liens hypertextes vers chaque onglet.
   Généré avec le moteur XLSX maison (zéro dépendance).
   ============================================================ */
const DX = (() => {
  // Palette sobre, alignée sur le rapport HTML
  const INK = 'FF1F2733', MUT = 'FF64748B', ACC = 'FF1F6FEB', HDR = 'FF16233D',
        GRP = 'FFE8EEFB', ZEB = 'FFF4F7FA',
        OK = 'FF15803D', SOON = 'FFB45309', KO = 'FFB91C1C',
        OK_BG = 'FFDCFCE7', SOON_BG = 'FFFEF3C7', KO_BG = 'FFFEE2E2';
  // Descripteurs de style (moteur interne de XLSX.build)
  const S = {
    title:  { b: true, sz: 15, color: INK },
    sub:    { sz: 10, color: MUT },
    head:   { b: true, sz: 10.5, color: 'FFFFFFFF', fill: HDR, v: 'center', wrap: true,
              border: { b: 'thin' } },
    cell:   { sz: 11, color: INK, v: 'top' },
    cellZ:  { sz: 11, color: INK, v: 'top', fill: ZEB },
    grp:    { b: true, sz: 11, color: INK, fill: GRP, border: { b: 'thin' } },
    link:   { b: true, sz: 11.5, color: ACC, u: true },
    linkSm: { sz: 10, color: ACC, u: true },
    ok:     { sz: 11, color: OK, v: 'top' },
    okZ:    { sz: 11, color: OK, v: 'top', fill: ZEB },
    soon:   { b: true, sz: 11, color: SOON, v: 'top' },
    ko:     { b: true, sz: 11, color: KO, v: 'top' },
    num:    { sz: 11, color: INK, v: 'top', h: 'right' },
    numZ:   { sz: 11, color: INK, v: 'top', h: 'right', fill: ZEB }
  };
  const escF = s => String(s ?? '').replace(/"/g, '""');
  // Lien interne vers un onglet (formule HYPERLINK : pas de relationship à gérer)
  const linkTo = (sheet, label, st = S.link) =>
    ({ f: `HYPERLINK("#'${escF(sheet)}'!A1","${escF(label)}")`, v: label, s: st });
  // Statut garantie → style de texte
  const wStyle = (val, zeb) =>
    val === 'En garantie' ? (zeb ? S.okZ : S.ok)
    : val === 'Hors garantie' ? S.ko
    : null;
  // Ligne de cellules stylées (zebra optionnel + styles spéciaux par colonne)
  const line = (vals, zeb, special = {}) => vals.map((v, i) =>
    (special[i] && special[i](v))
      ? { v, s: special[i](v) }
      : (typeof v === 'number' ? { v, s: (zeb ? S.numZ : S.num) } : { v, s: (zeb ? S.cellZ : S.cell) }));

  // En-tête standard d'une feuille de données : titre + retour + sous-titre + en-têtes
  function dataSheet(name, title, subtitle, head, body, opts = {}) {
    const rows = [
      [{ v: title, s: S.title }, ...(new Array(head.length - 2).fill(null)), linkTo('Sommaire', '⌂ Sommaire', S.linkSm)],
      [{ v: subtitle, s: S.sub }],
      [],
      head.map(h => ({ v: h, s: S.head }))
    ];
    const rowMeta = {};
    let r = 5;
    for (const b of body) {
      if (b && b.__group) {           // ligne de groupe (baie) non repliable
        rows.push([{ v: b.label, s: S.grp }]);
        // Étendre la ligne de groupe sur toute la largeur (visuel)
        for (let i = 1; i < head.length; i++) rows[rows.length - 1].push({ v: '', s: S.grp });
      } else {
        rows.push(b.cells);
        if (b.outline) rowMeta[r] = { outline: 1 };
      }
      r++;
    }
    const lastCol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[head.length - 1] || 'Z';
    return {
      name, rows,
      opts: {
        freezeRows: 4, autoHeader: false,
        autofilter: opts.noFilter ? null : `A4:${lastCol}${Math.max(4, r - 1)}`,
        rowMeta: Object.keys(rowMeta).length ? rowMeta : null
      }
    };
  }
  const groupRow = label => ({ __group: true, label });
  const dataRow = (cells, outline = false) => ({ cells, outline });

  // Onglets exportables (ordre d'affichage du sélecteur d'export)
  const SHEET_ITEMS = [
    ['Inventaire', '📦 Inventaire — équipements regroupés par baie (repliable)'],
    ['Ports', '🗂️ Ports & adressage'],
    ['Câblage', '🔌 Câblage — couleurs réelles des cordons'],
    ['Garanties', '🛡️ Garanties — triées par échéance, colorées'],
    ['Racks', '🗄️ Racks — capacités & budgets'],
    ['Sites', '🏢 Sites'],
    ['VLANs', '🏷️ Registre VLANs & subnets'],
    ['Nomenclature', '📛 Nomenclature'],
    ['Flux', '🔄 Matrice des flux réseau']
  ];

  // ---------- Construction des feuilles ----------
  function sheets(ws, keep = () => true) {
    const L = normLldInfo(ws);
    const out = [];
    // Sélecteur d'export : ne pousse que les feuilles cochées
    const add = sheetObj => { if (keep(sheetObj.name)) out.push(sheetObj); };
    const totalDev = sortedRackInstances(ws).length;
    const totalPorts = portsRows(ws).length - 1;
    const wsum = warrantySummary(ws);
    const today = new Date().toLocaleDateString('fr-FR');
    const meta = [ws.name, L.client, 'v' + (L.version || '1.0'), 'généré le ' + today].filter(Boolean).join(' · ');

    // 1) Inventaire — regroupé par baie (repliable), sans colonnes Rack/Site répétées
    const invHead = ['Étage', 'Nom', 'Catégorie', 'Marque', 'Modèle', 'Référence', 'N° série',
                     'IP mgmt', 'VLAN(s)', 'Puissance (W)', 'Poids (kg)', 'Contrat garantie',
                     'Fin de garantie', 'Statut garantie', 'Ports'];
    const invBody = [];
    const byRack = new Map();
    sortedRackInstances(ws).forEach(({ rack, inst }) => {
      if (!byRack.has(rack.id)) byRack.set(rack.id, { rack, items: [] });
      byRack.get(rack.id).items.push(inst);
    });
    let zeb = false;
    // Le site n'est pas répété sur la ligne de groupe s'il figure déjà dans le nom de la baie
    const rackSiteSuffix = r => {
      const s = siteName(ws, r);
      return (s && !r.name.includes(s.split('—')[0].trim())) ? '  —  ' + s : '';
    };
    for (const { rack, items } of byRack.values()) {
      invBody.push(groupRow(
        `🗄️  ${rack.name}${rackSiteSuffix(rack)}   ·   ${items.length} équipement${items.length > 1 ? 's' : ''}   ·   ${rack.sizeU}U`));
      zeb = false;
      for (const inst of items) {
        const wi = warrantyInfo(inst);
        invBody.push(dataRow(line([
          slotLabel(inst), inst.name, `${catIcon(normCat(inst.cat))} ${catLabel(normCat(inst.cat))}`,
          inst.brand || '', inst.model || '', inst.partRef || '', inst.serial || '',
          inst.ipMgmt || '', inst.vlan || '',
          inst.watts ? Number(inst.watts) : '', inst.weightKg ? Number(inst.weightKg) : '',
          inst.warranty || '',
          wi.status === 'none' ? '' : wi.label,
          warrantyShortStatus(wi.status),
          (inst.ports || []).length
        ], zeb, { 13: v => wStyle(v, zeb) }), true));
        zeb = !zeb;
      }
    }
    add(dataSheet('Inventaire', `📦 Inventaire des équipements — ${totalDev} équipements`,
      `${meta} — regroupé par baie : repliez/dépliez avec les boutons ± à gauche, filtrez avec les flèches d'en-tête.`,
      invHead, invBody));

    // 2) Ports & adressage — regroupé par baie également
    if (totalPorts > 0) {
      const portHead = ['Équipement', 'Port', 'Étiquette', 'IP', 'VLAN', 'Câble'];
      const portBody = [];
      const cableOf = (instId, portId) => {
        const c = (ws.cables || []).find(cb =>
          (cb.a?.instId === instId && cb.a?.portId === portId) ||
          (cb.b?.instId === instId && cb.b?.portId === portId));
        return c ? c.name : '';
      };
      for (const { rack, items } of byRack.values()) {
        const rackPorts = items.filter(i => (i.ports || []).length);
        if (!rackPorts.length) continue;
        portBody.push(groupRow(`🗄️  ${rack.name}   ·   ${rackPorts.reduce((s, i) => s + i.ports.length, 0)} ports`));
        zeb = false;
        for (const inst of rackPorts) {
          for (const p of inst.ports) {
            portBody.push(dataRow(line([
              `${slotLabel(inst)} · ${inst.name}`, p.name, p.label || '',
              p.ip || '', p.vlan || '', cableOf(inst.id, p.id)
            ], zeb), true));
            zeb = !zeb;
          }
        }
      }
      add(dataSheet('Ports', `🗂️ Ports & adressage — ${totalPorts} ports étiquetés`,
        `${meta} — regroupé par baie (boutons ±), filtrable.`,
        portHead, portBody));
    }

    // 3) Câblage — pastille de couleur réelle, filtrable
    const cabRows = cablingRows(ws);
    if (cabRows.length > 1) {
      const cabBody = [];
      zeb = false;
      for (const r of cabRows.slice(1)) {
        const [name, color, domain, ...rest] = r;
        cabBody.push(dataRow(line([name, color || '', domain, ...rest], zeb, {
          1: v => {
            const hex = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : 'FFB8C2D4';
            // Texte clair ou foncé selon la luminance de la couleur du câble
            const rr = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), bb = parseInt(hex.slice(5, 7), 16);
            const luma = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
            const fill = 'FF' + hex.replace('#', '');
            return { sz: 10, b: true, color: luma > 0.6 ? 'FF1F2733' : 'FFFFFFFF', fill, h: 'center', v: 'center' };
          }
        })));
        zeb = !zeb;
      }
      add(dataSheet('Câblage', `🔌 Tableau de câblage — ${cabRows.length - 1} câbles`,
        `${meta} — la colonne Couleur reprend la couleur réelle du cordon ; filtrez par Domaine, Rack…`,
        cabRows[0], cabBody));
    }

    // 4) Garanties — triées par échéance, statut coloré
    const garRows = warrantyRows(ws);
    if (garRows.length > 1) {
      const garBody = [];
      zeb = false;
      for (const r of garRows.slice(1)) {
        garBody.push(dataRow(line(r, zeb, { 7: v => wStyle(v, zeb) })));
        zeb = !zeb;
      }
      add(dataSheet('Garanties', `🛡️ Suivi des garanties — ${garRows.length - 1} équipements suivis`,
        `${meta} — trié de l'échéance la plus proche à la plus lointaine.`,
        garRows[0], garBody));
    }

    // 5) Racks — capacités (occupation en % ajoutée)
    {
      const rr = racksRows(ws);
      const rackBody = [];
      zeb = false;
      for (const r of rr.slice(1)) {
        const usedU = parseInt(r[3], 10), sizeU = parseInt(r[2], 10);
        const pct = (Number.isFinite(usedU) && Number.isFinite(sizeU) && sizeU)
          ? Math.round(usedU * 100 / sizeU) : '';
        rackBody.push(dataRow(line([...r, pct === '' ? '' : pct / 100], zeb, {
          10: v => (v !== '' && v >= 0.85)
            ? { numFmt: 10, sz: 11, b: true, color: 'FFB91C1C', v: 'top', h: 'right' }   // 10 = 0%
            : { numFmt: 10, sz: 11, color: INK, v: 'top', h: 'right', ...(zeb ? { fill: ZEB } : {}) }
        })));
        zeb = !zeb;
      }
      add(dataSheet('Racks', `🗄️ Baies — capacités & budgets`,
        `${meta} — occupation, puissance et charge par baie (« % U occupés » calculé sur la taille).`,
        [...rr[0], '% U occupés'], rackBody));
    }

    // 6) Feuilles simples (si renseignées) : Sites / VLANs / Nomenclature / Flux
    const simple = [
      ['Sites', '🏢 Sites', sitesRows(ws)],
      ['VLANs', '🏷️ Registre VLANs & subnets', addressingRows(ws)],
      ['Nomenclature', '📛 Nomenclature (règles de nommage)', nomenRows(ws)],
      ['Flux', '🔄 Matrice des flux réseau', flowsRows(ws)]
    ];
    for (const [sheetName, title, rows] of simple) {
      if (rows.length < 2) continue;
      zeb = false;
      const b = rows.slice(1).map(r => dataRow(line(r, (zeb = !zeb))));
      add(dataSheet(sheetName, `${title} — ${rows.length - 1} lignes`, meta, rows[0], b));
    }
    return out;
  }

  // ---------- Feuille Sommaire (toujours en premier) ----------
  function summarySheet(ws, dataSheets) {
    const L = normLldInfo(ws);
    const wsum = warrantySummary(ws);
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const counts = {
      Inventaire: `${sortedRackInstances(ws).length} équipements, par baie (repliable)`,
      Ports: `${portsRows(ws).length - 1} ports étiquetés`,
      Câblage: `${(ws.cables || []).length} câbles, couleurs réelles`,
      Garanties: `${wsum.known} suivies — ${wsum.in} en garantie${wsum.soon ? `, ${wsum.soon} expire(nt) < 90 j` : ''}${wsum.out ? `, ${wsum.out} hors garantie` : ''}`,
      Racks: `${ws.racks.length} baie${ws.racks.length > 1 ? 's' : ''} (capacités)`,
      Sites: `${(ws.sites || []).length} site${(ws.sites || []).length > 1 ? 's' : ''}`,
      VLANs: `${addressingRows(ws).length - 1} VLANs`,
      Nomenclature: `${nomenRows(ws).length - 1} règles`,
      Flux: `${(ws.flows || []).length} flux`
    };
    const rows = [
      [{ v: `⌂ ${ws.name} — Sommaire`, s: S.title }],
      [{ v: [L.client && 'Client : ' + L.client, 'Version ' + (L.version || '1.0'),
             'Auteur : ' + (L.author || '—'), 'Généré le ' + today].filter(Boolean).join('   ·   '), s: S.sub }],
      [],
      [{ v: 'Ce classeur est la « vue données » du dossier : chaque onglet est un tableau filtrable aux en-têtes figées.', s: S.sub }],
      [{ v: 'Sur Inventaire et Ports, les lignes se replient/enroulent par baie avec les boutons  ➖/➕  à gauche.', s: S.sub }],
      []
    ];
    let r = 7;
    for (const ds of dataSheets) {
      rows.push([linkTo(ds.name, ds.name), { v: counts[ds.name] || '', s: S.sub }]);
      r++;
    }
    return { name: 'Sommaire', rows, opts: { freeze: false, autoHeader: false } };
  }

  function buildAll(ws, only = null) {
    const keep = only ? name => only.has(name) : () => true;
    const data = sheets(ws, keep);
    return XLSX.build([summarySheet(ws, data), ...data]);
  }
  return { buildAll, SHEET_ITEMS };
})();

$('#export-xlsx-data').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = lldWorkspaceForExport();
  if (!ws || !ws.racks.length) {
    lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📊 Excel — vue données' });
    return;
  }
  const only = await lldPickSections({
    title: '📊 Excel « vue données » — que voulez-vous exporter ?',
    hint: 'Chaque rubrique cochée devient un onglet du classeur. L\u2019onglet Sommaire (avec liens) est toujours inclus.',
    items: DX.SHEET_ITEMS.map(([k, lbl]) => [k, lbl])
  });
  if (!only) return;
  if (!only.size) { lldAlert("Cochez au moins un onglet à exporter.", { title: '📊 Excel — vue données' }); return; }
  downloadBlob(DX.buildAll(ws, only), exportFileBase() + '-donnees.xlsx');
});

/* ============================================================
   EXPORT XLSX « template » : réplique exacte du classeur LLD
   ------------------------------------------------------------
   Le classeur exporté reproduit le template Excel fourni
   (24 feuilles : LLD, Governance, Contenu, chapitres 1→15.1)
   feuille par feuille, cellule par cellule : les largeurs de
   colonnes, hauteurs, fusions et STYLES (indices s=) proviennent
   d'assets/lld/layout.json, extrait du template, et xl/styles.xml
   + xl/theme1.xml sont recopiés verbatim. Seules les valeurs
   project-specific sont remplacées par les données du workspace.
   ============================================================ */
const LLD_TPL = (() => {

  function colIdx(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /* Reconstruit les lignes d'une feuille depuis le layout (runs RLE).
     Les plages de cellules vides stylées sont plafonnées à la colonne 120. */
  function fromLayout(sheet) {
    const rows = [], heights = {};
    for (let r = 1; r <= sheet.maxrow; r++) rows.push([]);
    for (const [rn, rd] of Object.entries(sheet.rows)) {
      const r = +rn;
      if (rd.ht) heights[r] = rd.ht;
      // format run (extrait du template) : [colDébut, style, valeur, colFin]
      for (const [c0, s, v, c1] of rd.cells) {
        const stop = v == null ? Math.min(c1, 119) : c1;   // bandes : cap col 120
        for (let c = c0; c <= stop; c++) rows[r - 1][c] = { v: v == null ? '' : v, s };
      }
    }
    return { rows, heights };
  }

  function set(rows, ref, value, forceStyle) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const r = rows[+m[2] - 1];
    const c = colIdx(m[1]);
    const prev = r[c];
    r[c] = { v: value, s: forceStyle !== undefined ? forceStyle : (prev ? prev.s : 0) };
  }

  function out(sheet, rows, heights, replacesMerges, colsOv) {
    // replacesMerges : fusions recalculées (Governance) -> REMPLACENT celles du
    // template ; sinon on reprend les fusions d'origine. Dédupe + refuse les
    // références à une seule cellule (Excel les jugerait corrompues).
    const raw = replacesMerges || sheet.merges || [];
    const seen = new Set(), merges = [];
    for (const ref of raw) {
      if (!/^[A-Z]+\d+:[A-Z]+\d+$/.test(ref) || ref.split(':')[0] === ref.split(':')[1]) continue;
      if (seen.has(ref)) continue;
      seen.add(ref);
      merges.push(ref);
    }
    return {
      name: sheet.name,
      rows,
      opts: {
        freeze: false, autoHeader: false,
        cols: colsOv || sheet.cols, dcw: sheet.dcw,
        heights, merges
      }
    };
  }

  /* — Aides communes pour les chapitres 7 → 15 (styles du template) — */
  const H = cells => cells.map((v, i) => ({ v, s: i === 0 ? 141 : (i === cells.length - 1 ? 143 : 2) }));
  const D = (cells, alt) => cells.map(v => ({ v, s: alt ? 197 : 8 }));
  const NOTE = t => [{ v: t, s: 129 }];
  const SEC = (t, col) => [{ v: t, s: col === undefined ? 47 : col }];
  const isEmptyCat = (ws, cats) => !byCat(ws, cats).length;

  function byCat(ws, cats) {
    return sortedRackInstances(ws).filter(x => cats.includes(normCat(x.inst.cat)));
  }
  /* Table équipements : Nom / Modèle / IP mgmt / Position */
  function equipTable(rows, list, headers) {
    rows.push([]); rows.push([]);
    rows.push(SEC(headers ? headers.titre : 'Equipements'));
    rows.push([]);
    rows.push(H(headers ? headers.cols : ['Nom', 'Modèle', 'IP mgmt', 'Position']));
    list.forEach(({ rack, inst }, i) => {
      rows.push(D([
        inst.name || '',
        `${inst.brand || ''} ${inst.model || ''}`.trim() || '',
        inst.ipMgmt || '',
        `${rack.name} — ${slotLabel(inst)}`
      ], i % 2));
    });
  }
  function pushNote(rows, t) { rows.push([]); rows.push(NOTE(t)); }

  /* — 7. Firewall : équipements + interfaces VLAN — */
  function ch7(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const fws = byCat(ws, ['firewall', 'router']);
    if (fws.length) equipTable(rows, fws, { titre: '7.1. Equipements Firewall / Routeurs',
      cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
    const vlans = (ws.lld && ws.lld.vlans) || [];
    if (vlans.length) {
      rows.push([]); rows.push([]);
      rows.push(SEC('7.2. Interfaces VLAN'));
      rows.push([]);
      rows.push(H(['VLAN', 'Nom', 'Sous-réseau', 'Passerelle']));
      vlans.forEach((v, i) => rows.push(D([
        v.vid ? `VLAN ${v.vid}` : '', v.name || '', v.subnet || '', v.gw || ''], i % 2)));
    }
    const fw = hasB('7', 'fw') ? ((ws.lld && ws.lld.fw) || []) : [];
    if (fw.length) {
      const Lw = ws.lld || {};
      const dyn = lldExportCols(Lw, 'fw', LLD_FW_COLS);
      rows.push([]); rows.push([]);
      rows.push(SEC('7.3. Règles et NAT'));
      rows.push([]);
      rows.push(H(dyn.map(c => String(c[1]))));
      fw.forEach((r0, i) => rows.push(D(dyn.map(c => String(r0[c[0]] ?? '')), i % 2)));
    }
    /* Note dynamique : ne mentionner QUE ce qui manque vraiment */
    const L7 = ws.lld || {};
    const fp7 = L7.fwProfiles || {};
    const missing7 = [];
    if (!(L7.fw || []).length) missing7.push('NAT et règles');
    if (!(L7.aliases || []).length) missing7.push('alias');
    if (!(L7.vpns || []).length) missing7.push('tunnels VPN S2S');
    if (!fp7.vpnSsl && !fp7.appCtrl && !fp7.webBlocker && !fp7.httpProxy) missing7.push('profils (VPN SSL, AppControl…)');
    if (missing7.length) pushNote(rows, `À compléter manuellement : ${missing7.join(', ')} (cluster/HA : voir fiche matériel).`);
    const cfg7 = hasB('7', 'note:firewall') ? ((ws.lld && ws.lld.catNotes) || {}).firewall : '';
    if (cfg7) pushNote(rows, `Config : ${String(cfg7).split('\n')[0]}`);
    const s7 = out(sheet, rows, heights, null, [3.43, 46, 30, 22, 22, 30, 16]);
    const im7 = insertChapterExtras(s7.rows, ws, '7');
    if (im7) s7.opts.images = im7;
    return s7;
  }

  /* — 8.x Switching : équipements de la zone correspondant au titre — */
  function switchZone(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    // la feuille du template ne porte que le titre (la ligne « Config: Voir
    // CMDB », placeholder à 30 lignes du titre, est remplacée par le contenu)
    rows.length = 1;
    const title = String(rows[0][0] && rows[0][0].v || '');
    const zones = (ws.lld && ws.lld.swZones) || [];
    /* 8.3/8.4 portent le même titre « (AP) » (idem 8.2/8.5 « (LAN) ») :
       on les distingue par l'ORDINAL de la feuille -> nième zone AP / LAN
       déclarée dans la fiche LLD (8.2 = 1re zone LAN, 8.5 = 2e, etc.). */
    const nth = (arr, n) => arr[n] || arr[0] || null;
    const apZones = zones.filter(z => /\bAP\b/i.test(z.name));
    const lanZones = zones.filter(z => /lan/i.test(z.name) && !/infra/i.test(z.name));
    let zone = null;
    if (/INFRA/i.test(title)) zone = zones.find(z => /infra/i.test(z.name));
    else if (/\(AP\)/i.test(title)) zone = nth(apZones, sheet.name === '8.4' ? 1 : 0);
    else if (/\(LAN\)/i.test(title)) zone = nth(lanZones, sheet.name === '8.5' ? 1 : 0);
    const catList = /\(AP\)/i.test(title) ? ['switch', 'ap'] : ['switch'];
    const sws = byCat(ws, catList).filter(x => !zone || x.inst.zone === zone.id);
    const notes = (ws.lld && ws.lld.catNotes) || {};
    if (sws.length) {
      equipTable(rows, sws, { titre: `Equipements Switching${zone ? ' — zone ' + zone.name : ''}`,
        cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
      if (zone && zone.vlans) rows.push([{ v: `VLANs de la zone : ${zone.vlans}`, s: 129 }]);
      const zoneNames = new Set(sws.map(x => x.inst.name));
      const portRows = portsRowsByCat(ws, catList).slice(1)
        .filter(p => zoneNames.has(p[3]));
      if (portRows.length) {
        rows.push([]); rows.push([]);
        rows.push(SEC('Plan de ports'));
        rows.push([]);
        rows.push(H(['Rack', 'Device', 'Port', 'Étiquette', 'VLAN']));
        portRows.slice(0, 200).forEach((p, i) => rows.push(D([p[0], p[3], p[4], p[5], p[7]], i % 2)));
      }
    }
    // Note de configuration de la zone (info « zones/notes » du sommaire)
    const note = hasB(sheet.name, 'note:switching') ? notes.switching : '';
    if (note) { rows.push([]); rows.push([{ v: `Config : ${String(note).split('\n')[0]}`, s: 129 }]); }
    return out(sheet, rows, heights, null, [3.43, 30, 34, 18, 24, 12]);
  }

  /* — 9 à 13 : équipements par spécialité — */
  function chapterEquip(cats, titre, note, catKey) {
    return (sheet, ws) => {
      const { rows, heights } = fromLayout(sheet);
      const list = byCat(ws, cats);
      if (list.length) equipTable(rows, list, { titre, cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
      else pushNote(rows, note || "Aucun équipement de cette catégorie dans l'inventaire actuel.");
      const cfg = catKey && hasB(sheet.name, `note:${catKey}`)
        ? ((ws.lld && ws.lld.catNotes) || {})[catKey] : '';
      if (cfg) pushNote(rows, `Config : ${String(cfg).split('\n')[0]}`);
      return out(sheet, rows, heights, null, [3.43, 40, 36, 22, 26]);
    };
  }

  /* — Équipements d'une catégorie + table annexe (VMs, volumes, caméras…) — */
  function chapterWith(cat, titre, titre2, cols2, key, note, catKey) {
    return (sheet, ws) => {
      const { rows, heights } = fromLayout(sheet);
      const list = byCat(ws, [cat]);
      if (list.length) equipTable(rows, list, { titre, cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
      const tbl = hasB(sheet.name, key) ? ((ws.lld && ws.lld[key]) || []) : [];
      if (tbl.length) {
        const Lw = ws.lld || {};
        const dyn = lldExportCols(Lw, key, cols2.map(([lbl, k]) => [k, lbl, null]));
        rows.push([]); rows.push([]);
        rows.push(SEC(titre2));
        rows.push([]);
        rows.push(H(dyn.map(c => String(c[1]))));
        tbl.forEach((r0, i) => rows.push(D(dyn.map(c => String(r0[c[0]] ?? '')), i % 2)));
      }
      if (!list.length && !tbl.length) pushNote(rows, "Aucun équipement de cette catégorie dans l'inventaire actuel.");
      else if (note && !tbl.length) pushNote(rows, note);
      const nkey = `note:${catKey || cat}`;
      const cfg = hasB(sheet.name, nkey)
        ? ((ws.lld && ws.lld.catNotes) || {})[catKey || cat] : '';
      if (cfg) pushNote(rows, `Config : ${String(cfg).split('\n')[0]}`);
      return out(sheet, rows, heights, null, [3.43, 40, 36, 22, 26]);
    };
  }

  /* — 14. Flux réseau — */
  function ch14(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const allF = hasB('14', 'flows') ? flowsRows(ws) : [];
    const flows = allF.slice(1);
    if (flows.length) {
      rows.push([]); rows.push([]);
      rows.push(SEC('Flux applicatifs'));
      rows.push([]);
      rows.push(H(allF[0]));
      flows.forEach((f, i) => rows.push(D(f, i % 2)));
    }
    pushNote(rows, "Le diagramme de flux reste à insérer (capture d'écran) — non généré par l'application.");
    return out(sheet, rows, heights, null, [4, 26, 26, 26, 22, 16, 44]);
  }

  /* — 15. Cablage global — */
  function ch15(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const cab = cablingRows(ws);
    if (cab.length > 1) {
      rows.push([]); rows.push([]);
      rows.push(SEC('Tableau de câblage'));
      rows.push([]);
      rows.push(H(['ID', 'Couleur', 'Domaine', 'Rack A', 'Device A', 'Port A', 'Rack B', 'Device B', 'Port B']));
      // c[] : ID, Couleur, Domaine, Rack A, Device A, Port A, Étiquette A,
      //       Rack B (7), Device B (8), Port B (9), Étiquette B (10)
      cab.slice(1).forEach((c, i) => rows.push(D([c[0], c[1], c[2], c[3], c[4], c[5], c[7], c[8], c[9]], i % 2)));
    }
    return out(sheet, rows, heights, null, [4, 10, 10, 14, 12, 26, 10, 12, 26, 10]);
  }

  /* — 15.1. Elevations par baie — */
  function ch151(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    rows.push([]); rows.push([]);
    rows.push(SEC('Elevations des baies', 50));
    for (const rack of sortedRacks(ws)) {
      rows.push([]);
      rows.push(SEC(`${rack.name} — ${siteName(ws, rack)} (${rack.sizeU}U)`, 47));
      rows.push([]);
      rows.push(H(['Position', 'Nom', 'Catégorie', 'Marque / Modèle', 'Taille', 'IP mgmt']));
      const insts = rack.instances.slice().sort((a, b) => (a.pos ?? 1e9) - (b.pos ?? 1e9));
      insts.forEach((inst, i) => rows.push(D([
        slotLabel(inst), inst.name || '', catLabel(inst.cat),
        `${inst.brand || ''} ${inst.model || ''}`.trim() || '',
        inst.sizeU + 'U', inst.ipMgmt || ''], i % 2)));
    }
    return out(sheet, rows, heights, null, [4, 12, 34, 20, 34, 10, 20]);
  }

  const proseLines = (t, max) => String(t || '').split('\n').map(x => x.trim())
    .filter(Boolean).slice(0, max || 40);

  function dateSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569 : (iso || '');
  }

  /* Groupements inventaire : par catégorie et par modèle.
     Les modèles sont triés par domaine métier (routeur, firewall, switch…),
     puis par quantité décroissante — pour des tableaux stables et lisibles. */
  function invGroups(ws) {
    const info = new Map(), byCat = new Map();
    for (const { inst } of sortedRackInstances(ws)) {
      const model = `${inst.brand || ''} ${inst.model || ''}`.trim() || inst.name;
      const g = info.get(model) || { n: 0, cat: inst.cat };
      g.n++;
      info.set(model, g);
      const lbl = catLabel(inst.cat);
      const c = byCat.get(lbl) || { n: 0, models: new Map() };
      c.n++;
      c.models.set(model, (c.models.get(model) || 0) + 1);
      byCat.set(lbl, c);
    }
    const rank = c => DEV_CATEGORIES.findIndex(([id]) => id === normCat(c));
    const ordered = [...info.entries()].sort((a, b) =>
      rank(a[1].cat) - rank(b[1].cat) || b[1].n - a[1].n || a[0].localeCompare(b[0], 'fr'));
    const byModel = new Map(ordered.map(([m, g]) => [m, g.n]));
    return { byCat, byModel, totalModels: info.size };
  }

  /* — Feuille « LLD » : page de garde — */
  function lld(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const sites = ws.sites || [];
    const project = L.client
      ? `Mise en place d'une infrastructure IT pour ${L.client}`
      : (sites.map(s => s.name).join(' / ') || ws.name);
    set(rows, 'E1', project);
    // valeurs directes : jamais de cellule à côté de « Auteur »/« Version » vide
    set(rows, 'E3', (L.author || '').trim() || 'Amine MJID', 104);
    // ligne « Version » (absente du template, ajoutée avec ses styles)
    rows[3] = new Array(17).fill('');
    rows[3][0] = { v: 'Version', s: 14 };
    for (let c = 4; c < 17; c++) {
      rows[3][c] = { v: c === 4 ? ((L.version || '').trim() || '1.0') : '', s: 104 };
    }
    heights[4] = 28.5;
    return out(sheet, rows, heights);
  }

  /* — Feuille « Governance » : reconstruite (contenu variable),
       styles strictement ceux du template — */
  function governance(sheet, ws) {
    const L = ws.lld || {};
    const revs = L.revs || [], approvers = L.approvers || [], reviewers = L.reviewers || [];
    const rows = [], merges = [], heights = {};
    const R = (cells, ht) => { rows.push(cells); if (ht) heights[rows.length] = ht; };
    const banner = (title, first, mid, last, n) => {
      const st = n <= 1 ? [first] : [first, ...Array(n - 2).fill(mid), last];
      const r0 = rows.length + 1;
      R(st.map((s, i) => ({ v: i === 0 ? title : '', s })), 14.45);
      merges.push(`A${r0}:${xle(n - 1)}${r0}`);
    };
    // Lettre de colonne Excel (index 0-based) — au-delà de E quand la modale
    // 📘 a ajouté des colonnes au tableau.
    const xle = i => {
      let s = '', n = i + 1;
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = (n - m - 1) / 26;
      }
      return s;
    };
    // Styles d'en-tête : 1ʳᵉ / avant-dernière / dernière, milieu paramétrable
    // (utilisé aussi pour la ligne de bordure bas).
    const hdrStyles = (n, first, secondLast, last, mid = 2) =>
      Array.from({ length: n }, (_, i) =>
        i === 0 ? first : (i === n - 1 ? last : (i === n - 2 ? secondLast : mid)));
    R([{ v: 'Governance', s: 51 }], 25.9);
    R([]);

    // 1) Statut de révision du document — colonnes pilotées par la modale 📘
    //    (gridCols.revs : suppressions / renommages / ordre pris en compte),
    //    + la colonne calculée « Statut » toujours en dernière position.
    const approvedVers = new Set(approvers.map(a => a.approvedVersion).filter(Boolean));
    const rc = lldExportCols(L, 'revs', LLD_REV_COLS);
    const nR = rc.length + 1;
    banner('Statut de révision du document', 177, 178, 179, nR);
    const rcHdr = hdrStyles(nR, 141, 142, 143);
    R([...rc.map((c, i) => ({ v: String(c[1]), s: rcHdr[i] })),
       { v: 'Statut', s: 143 }], 14.45);
    const revStyle = { rev: [144, 146], date: [145, 147], author: [8, 102], note: [150, 150] };
    revs.forEach((rv, i) => {
      const last = i === revs.length - 1;
      const cells = rc.map(c => {
        const k = c[0];
        const s = (revStyle[k] || [8, 102])[last ? 1 : 0];
        if (k === 'date') return { v: dateSerial(rv.date), s };
        return { v: String(rv[k] ?? ''), s };
      });
      cells.push({
        v: (rv.rev && approvedVers.has(rv.rev)) ? 'Approuvé'
          : (approvers.length ? 'Pas encore approuvé' : ''),
        s: last ? 158 : 133
      });
      const lines = cells.reduce(
        (m, c) => Math.max(m, typeof c.v === 'string' ? c.v.split('\n').length : 1), 1);
      R(cells, lines * 15);
    });
    R(hdrStyles(nR, 148, 149, 136, 135).map(s => ({ v: '', s })), 15.75);
    R([]); R([]);

    // 2) Approbateurs : un bloc de 3 lignes par version cible (hors 0.x).
    //    Colonnes pilotées par la modale 📘 (gridCols.approvers) + « Signature ».
    const sc = lldExportCols(L, 'approvers', LLD_SIGNATORY_COLS);
    const nA = sc.length + 1;
    banner('Approbateurs', 174, 175, 176, nA);
    const scHdr = hdrStyles(nA, 141, 142, 143);
    R([...sc.map((c, i) => ({ v: String(c[1]), s: scHdr[i] })),
       { v: 'Signature', s: 143 }], 14.45);
    let vers = revs.map(x => x.rev).filter(v => v && !/^0\./.test(v));
    if (!vers.length && L.version) vers = [L.version];
    if (!vers.length) vers = [''];
    const apStyle = {
      name: [144, 148], position: [8, 135],
      organization: [8, 135], approvedVersion: [180, 182]
    };
    const vi = sc.findIndex(c => c[0] === 'approvedVersion');
    vers.forEach(ver => {
      const sign = approvers.filter(a => a.approvedVersion === ver);
      const r0 = rows.length + 1;
      if (vi >= 0) merges.push(`${xle(vi)}${r0}:${xle(vi)}${r0 + 2}`);
      for (let k = 0; k < 3; k++) {
        const a = sign[k] || {};
        const last = k === 2;
        const cells = sc.map(c => {
          const key = c[0];
          const s = (apStyle[key] || [8, 135])[last ? 1 : 0];
          if (key === 'approvedVersion') return { v: k === 0 ? ver : '', s };
          return { v: String(a[key] ?? ''), s };
        });
        cells.push({ v: '', s: last ? 136 : 133 });
        R(cells, 14.45);
      }
    });
    R([{ v: '', s: 151 }]);
    R([]);

    // 3) Réviseurs : une ligne par version — colonnes pilotées par la modale 📘
    const rcv = lldExportCols(L, 'reviewers', LLD_SIGNATORY_COLS);
    const nV = rcv.length;
    banner('Réviseurs', 174, 175, 176, nV);
    R(rcv.map((c, i) => ({ v: String(c[1]), s: hdrStyles(nV, 3, 2, 4)[i] })), 14.45);
    const rvVers = revs.length ? revs.map(x => x.rev || '')
      : (reviewers.length ? reviewers.map(x => x.approvedVersion || '') : ['']);
    const rvStyle = { name: 102, position: 8, organization: 8, approvedVersion: 9 };
    rvVers.forEach(ver => {
      const rv = reviewers.find(x => x.approvedVersion === ver) || {};
      R(rcv.map(c => ({
        v: c[0] === 'approvedVersion' ? ver : String(rv[c[0]] ?? ''),
        s: rvStyle[c[0]] ?? 8
      })), 14.45);
    });
    R(rcv.map((c, i) => ({ v: '', s: i === 0 ? 10 : (i === nV - 1 ? 12 : 11) })), 14.45);
    return out(sheet, rows, heights, merges);
  }

  /* — Feuille « 1 » : objectif du document (texte de l'app) — */
  function ch1(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    // Le paragraphe par défaut gravé dans le template (lignes 5-8) est
    // effacé : l'objectif vient de la modale 📘 (pré-rempli par normLldInfo,
    // modifiable / supprimable) — plus aucun doublon dans l'export.
    for (let r = 5; r <= 8; r++) rows[r - 1] = [];
    if (!hasB('1', 'objectif')) return out(sheet, rows, heights);
    const lines = proseLines(ws.lld && ws.lld.objectif, 40);
    if (!lines.length) {
      rows[4] = [{ v: 'Section à compléter.', s: 129 }];
      return out(sheet, rows, heights);
    }
    lines.forEach((t, i) => {
      const r = 5 + i;
      while (rows.length < r) rows.push([]);
      rows[r - 1][0] = { v: t, s: 129 };
    });
    return out(sheet, rows, heights);
  }

  /* — Feuille « 2 » : aperçu du site + infrastructure existante — */
  function ch2(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const fai = L.fai || {};
    // 2.1 : tableau des sites = mêmes colonnes que l'app / le PDF (schéma
    // dynamique, gridCols compris), un site par ligne. Remplace le formulaire
    // gravé du template (Nom/Adresse/… + « Capacité Total de FAI » +
    // « Commentaires » : ces deux champs appartenaient à la fiche FAI ch.5).
    const siteCols = lldExportCols(L, 'sites', LLD_SITE_COLS);
    for (let r = 6; r <= 10; r++) rows[r - 1] = [];   // efface le formulaire gravé
    let tblW = null;                                  // largeurs A + colonnes tableau
    if (hasB('2.1', 'sites')) {
      const allSites = ws.sites || [];
      const shift = cells => {
        const rw = [];
        cells.forEach((c, i) => { rw[1 + i] = c; });   // colonne A vide (numéro)
        return rw;
      };
      if (allSites.length) {
        rows[5] = shift(H(siteCols.map(c => String(c[1]))));
        // 8 lignes max (Excel 7→14) : au-delà, 7 sites + note sur la
        // dernière ligne libre (la ligne 15 est le titre du ch. 2.2).
        const shown = allSites.length > 8 ? allSites.slice(0, 7) : allSites;
        shown.forEach((s, i) => {
          rows[6 + i] = shift(D(siteCols.map(c => String(s[c[0]] ?? '')), i % 2));
        });
        if (allSites.length > shown.length)
          rows[13] = [{ v: `+ ${allSites.length - shown.length} autre(s) site(s) — voir le PDF`, s: 129 }];
        tblW = [8.14];                                // colonne A (template)
        siteCols.forEach(c => {
          let m = String(c[1]).length;
          shown.forEach(s => String(s[c[0]] ?? '').split('\n')
            .forEach(ln => { m = Math.max(m, ln.length); }));
          tblW.push(Math.min(40, Math.max(10, m + 2)));
        });
      } else {
        rows[5] = [{ v: 'Aucun site déclaré (info « Sites » du sommaire).', s: 129 }];
      }
    }
    // 2.2 : texte « infrastructure existante » de l'app (zone vide r16+)
    if (hasB('2.2', 'existant')) proseLines(L.existant, 30).forEach((t, i) => {
      const r = 16 + i;
      rows[r - 1][1] = { v: t, s: 129 };
    });
    // 2.2 : tableau des dispositifs (r51-59) : FAI + un dispositif par modèle
    const { byModel, totalModels } = invGroups(ws);
    const models = [...byModel.entries()];
    set(rows, 'D51', fai.operator
      ? `${fai.operator}${fai.down ? ' — ' + fai.down : ''}` : '');
    models.slice(0, 8).forEach(([model, n], i) => {
      const r = 52 + i;
      set(rows, `B${r}`, model);
      set(rows, `D${r}`, `x${n}`);
    });
    for (let r = 52 + Math.min(models.length, 8); r <= 59; r++) { set(rows, `B${r}`, ''); set(rows, `D${r}`, ''); }
    if (totalModels > 8)
      rows[60] = [{ v: `+ ${totalModels - 8} autres modèles — voir chapitre 3.1 (Equipments)`, s: 129 }];
    const colsOv = tblW
      ? tblW.concat([{ min: 2 + siteCols.length, max: 16384, width: sheet.dcw || 11.57 }])
      : null;
    return out(sheet, rows, heights, null, colsOv);
  }

  /* — Feuille « 3 » : architecture cible + équipements — */
  function ch3(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    // Reconstruit sous le titre (ligne 1) : architecture puis 3.1 collé juste
    // après (plus de bloc vide jusqu'à la ligne 37 du template). Le tableau
    // 3.1 n'affiche QUE les lignes du sommaire (info « equip ») — l'inventaire
    // de l'élévation se génère dans la modale 📘 (bouton 🔎), jamais ici.
    for (let r = 2; r <= sheet.maxrow; r++) {
      rows[r - 1] = [];
      delete heights[r];
    }
    let r = 2;
    if (hasB('3', 'architecture')) proseLines(ws.lld && ws.lld.architecture, 40).forEach(t => {
      rows[r - 1][0] = { v: t, s: 129 };
      r++;
    });
    r++;                                   // ligne vide avant 3.1
    const n31 = BUILD_TOC.get('3.1');
    while (rows.length < r) rows.push([]);
    rows[r - 1][1] = { v: n31 ? `${n31.num}. ${n31.title}` : '3.1. Equipments', s: 47 };
    heights[r] = 15.75;
    r += 2;                                // ligne vide (comme 38-39 du template)
    const merges = [];
    const Lw = ws.lld || {};
    const dyn = lldExportCols(Lw, 'equip', LLD_EQUIP_COLS);
    // En-tête : mêmes colonnes que le sommaire (schéma dynamique), à partir de B
    while (rows.length < r) rows.push([]);
    rows[r - 1][1] = { v: 'Datacenter / Comms room devices', s: 199 };
    for (let c = 2; c < 1 + dyn.length; c++) rows[r - 1][c] = { v: '', s: 200 };
    // libellés réels de colonnes sur la ligne d'en-tête (2e ligne du tableau)
    // -> non : le template fusionne B:E pour le titre. On écrit les libellés
    // sur UNE ligne d'en-tête dédiée juste après, style 116/117 comme le template.
    merges.push(`B${r}:E${r}`);
    r++;
    while (rows.length < r) rows.push([]);
    dyn.forEach((c, ci) => {
      rows[r - 1][1 + ci] = { v: String(c[1]), s: ci === 0 ? 116 : 117 };
    });
    r++;
    const equip = (hasB('3.1', 'equip') ? ((ws.lld && ws.lld.equip) || []) : [])
      .filter(e => e && String(e.model || '').trim());
    if (equip.length) {
      equip.forEach((e, i) => {
        while (rows.length < r) rows.push([]);
        const alt = i % 2;
        dyn.forEach((c, ci) => {
          const col = 1 + ci;
          const v = String(e[c[0]] ?? '');
          if (ci === 0) rows[r - 1][col] = { v, s: alt ? 197 : 190 };
          else if (ci === 1) rows[r - 1][col] = { v, s: alt ? 198 : 195 };
          else rows[r - 1][col] = { v, s: alt ? 190 : 114 };
        });
        r++;
      });
    } else {
      while (rows.length < r) rows.push([]);
      rows[r - 1][1] = {
        v: hasB('3.1', 'equip')
          ? "Aucun élément — bouton « 🔎 Générer depuis l'élévation » dans le sommaire 📘."
          : 'Section à compléter.',
        s: 129
      };
    }
    // Fusions recalculées : celles du template (lignes 40-76) sont remplacées
    return out(sheet, rows, heights, merges);
  }

  /* — Feuille « 4 » : matrice d'adressage globale + registre VLAN + nomenclature — */
  function ch4(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    /* — Matrice du haut : remplie depuis l'app (identités + IP) — */
    const ipFrom = s => { const m = /((?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?)/.exec(String(s || '')); return m ? m[1] : ''; };
    const shortName = s => String(s || '').split(/[ (—]/)[0].trim();
    const fais = (L.fais && L.fais.length) ? L.fais : (L.fai && L.fai.operator ? [L.fai] : []);
    // FAI (FTTH 1-3) et WAN 1-3 : adressage WAN complet
    // (sans IP fixe : affiche le mode de connexion, ex. « DHCP » pour la 5G)
    fais.slice(0, 3).forEach((f, i) => {
      set(rows, `D${6 + i}`, f.wanIp || (f.ipMode ? f.ipMode : ''));
      set(rows, `E${6 + i}`, f.wanMask || '');
      set(rows, `F${6 + i}`, f.wanGw || '');
      set(rows, `G${6 + i}`, f.wanDns || '');
      set(rows, `D${12 + i}`, f.wanIp || (f.ipMode ? f.ipMode : ''));
      set(rows, `E${12 + i}`, f.wanMask || '');
      set(rows, `F${12 + i}`, f.wanGw || '');
      set(rows, `G${12 + i}`, f.wanDns || '');
    });
    // VPN S2S 1-4 (r15-18) : tunnels saisis dans la fiche LLD
    (L.vpns || []).slice(0, 4).forEach((v, i) => {
      set(rows, `C${15 + i}`, v.name || '');
      set(rows, `D${15 + i}`, v.peer || '');
    });
    for (let r = 15 + Math.min((L.vpns || []).length, 4); r <= 18; r++) { set(rows, `C${r}`, ''); set(rows, `D${r}`, ''); }
    // Interconnexion S2S : extrémités, VIP
    const ic = L.interco || {};
    const srvs = byCat(ws, ['server']);
    const stos = byCat(ws, ['storage']);
    if (ic.epA) { set(rows, 'C9', shortName(ic.epA)); set(rows, 'D9', ipFrom(ic.epA)); }
    if (ic.epB) { set(rows, 'C10', shortName(ic.epB)); set(rows, 'D10', ipFrom(ic.epB)); }
    if (ic.vipA) set(rows, 'D11', ic.vipA);
    // Firewall : équipements + première règle NAT
    const fws = byCat(ws, ['firewall']);
    fws.slice(0, 2).forEach((x, i) => {
      set(rows, `C${19 + i}`, x.inst.name || '');
      set(rows, `D${19 + i}`, x.inst.ipMgmt || '');
    });
    const nat = (L.fw || []).find(r0 => /nat/i.test(r0.type || ''));
    if (nat) { set(rows, 'C21', nat.name || ''); set(rows, 'D21', nat.dst || ''); }
    // Alias firewall (r24-32) : table alias de la fiche LLD
    (L.aliases || []).slice(0, 9).forEach((a, i) => {
      set(rows, `C${24 + i}`, a.name || '');
      set(rows, `D${24 + i}`, a.value || '');
    });
    for (let r = 24 + Math.min((L.aliases || []).length, 9); r <= 32; r++) { set(rows, `C${r}`, ''); set(rows, `D${r}`, ''); }
    // Profils firewall (r34-37)
    const fp = L.fwProfiles || {};
    set(rows, 'C34', fp.vpnSsl || '');
    set(rows, 'C35', fp.appCtrl || '');
    set(rows, 'C36', fp.webBlocker || '');
    set(rows, 'C37', fp.httpProxy || '');
    // VLANs firewall (r38-49 et r50-63) : appariement par mots-clés du registre VLAN
    const vlansAll = L.vlans || [];
    const KW = [
      [/dmz/i, /dmz/i, /dmz/i],
      [/storage/i, /storage/i, /storage|stg|backup|sauvegarde|nas|san/i],
      [/ups|onduleur/i, /ups/i, /ups|onduleur|energie|énergie/i],
      [/manegement|management|mgmt/i, /mgmt|management|gestion/i, /mgmt|management|gestion|admin/i],
      [/users wired|wired/i, /user|utilisateur|bureau/i, /user|utilisateur|bureau|corp/i, /wifi|wireless|guest|invite|invité/i],
      [/wireless|wifi|wlan/i, /guest|invite|invité|wifi|wlan|wireless/i, /wifi|wlan|wireless|invite|invité|sans[- ]fil/i, /wired|user|utilisateur/i],
      [/print/i, /print|imprim/i, /print|imprim/i],
      [/\bids\b|intrusion/i, /\bids\b|\bips\b|intrusion/i, /ids|ips|intrusion/i],
      [/cctv|cam/i, /cctv|cam|video|vidéo/i, /cctv|cam|video|vidéo|surveillance/i],
      [/\bspo\b|pointage/i, /spo|pointage|badge/i, /spo|pointage|badge/i],
      [/voip|toip/i, /voip|toip|téléph|teleph/i, /voip|toip|téléph|teleph/i],
      [/idrac/i, /idrac/i, /ipmi|bmc|oob/i]
    ];
    /* Masque déduit d'un CIDR (« 10.10.10.0/24 » -> « 255.255.255.0 ») */
    const maskOfCidr = s => {
      const m = /\/(\d+)\s*$/.exec(String(s || ''));
      if (!m) return '';
      const n = +m[1];
      if (n < 0 || n > 32) return '';
      const bits = n === 0 ? 0 : (0xFFFFFFFF << (32 - n)) >>> 0;
      return [24, 16, 8, 0].map(sh => (bits >>> sh) & 255).join('.');
    };
    /* Le bloc r38-49 décrit le 1er site (firewall 1), r50-63 le second.
       On filtre le registre VLAN par la colonne « Site » si elle est renseignée. */
    const isSiteB = v => /agence|rabat|site\s?b/i.test(v.site || '');
    const vlanFor = (label, side) => {
      const hit = KW.find(([a]) => a.test(label));
      if (!hit) return null;
      const [, primary, full, excl] = hit;
      // exclusion (ex. « Users Wireless » ne doit pas retomber sur vUsers)
      const ok = x => !(excl && excl.test(x.name || ''))
        && (side === 'B' ? isSiteB(x) : !isSiteB(x));
      // 1) nom correspondant au terme principal, 2) nom (tous termes),
      // 3) usage (tous termes)
      const v = vlansAll.find(x => ok(x) && primary.test(x.name || '')) ||
                vlansAll.find(x => ok(x) && full.test(x.name || '')) ||
                vlansAll.find(x => ok(x) && full.test(x.purpose || ''));
      return v && v.vid ? v : null;
    };
    // C = nomenclature du VLAN, D = IP (passerelle), E = masque (du subnet)
    const putVlanRow = (r, side) => {
      const lbl = rows[r - 1][1] && rows[r - 1][1].v;
      const v = lbl && !/VM\d/i.test(String(lbl)) ? vlanFor(String(lbl), side) : null;
      const sC = rows[r - 1][2] ? rows[r - 1][2].s : 1;
      set(rows, `C${r}`, v ? `VLAN ${v.vid}` : '', sC);
      const st = c => (rows[r - 1][c] ? rows[r - 1][c].s : sC);
      set(rows, `D${r}`, v ? (v.gw || '') : '', st(3));
      set(rows, `E${r}`, v ? (maskOfCidr(v.subnet) || '') : '', st(4));
    };
    for (let r = 38; r <= 49; r++) putVlanRow(r, 'A');
    for (let r = 50; r <= 63; r++) putVlanRow(r, 'B');
    // Master/Slave mgmt (r64-65) et interfaces cluster (r66-69)
    set(rows, 'C64', ic.mgmtA || '');
    set(rows, 'C65', ic.mgmtB || '');
    set(rows, 'C66', ic.clusterA || '');
    set(rows, 'C67', '');
    set(rows, 'C68', ic.clusterB || '');
    set(rows, 'C69', '');
    // VLANs par switch (r76-86 switch 1, r88-99 switch 2) : listes des zones
    const zoneLists = (L.swZones || []).filter(z => z.vlans).map(z => String(z.vlans || ''))
      .map(s => s.split(',').flatMap(x => {
        x = x.trim(); const m = /^(\d+)\s*-\s*(\d+)$/.exec(x);
        return m ? Array.from({ length: Math.min(+m[2], +m[1] + 30) - +m[1] + 1 }, (_, k) => +m[1] + k) : (x ? [x] : []);
      }).filter(Boolean));
    const fillVlanRows = (list, r0, r1) => {
      for (let r = r0; r <= r1; r++) set(rows, `C${r}`, '');
      list.slice(0, r1 - r0 + 1).forEach((v, i) => set(rows, `C${r0 + i}`, `VLAN ${v}`));
    };
    fillVlanRows(zoneLists[0] || [], 76, 86);
    fillVlanRows(zoneLists[1] || [], 88, 99);
    // Ports du 1er serveur (r101-107) et du SAN (r109-112)
    const ports = list0 => (list0[0] && list0[0].inst.ports || []);
    ports(srvs).slice(0, 7).forEach((p, i) => {
      set(rows, `C${101 + i}`, p.label || p.name || '');
      set(rows, `D${101 + i}`, p.ip || '');
    });
    for (let r = 101 + Math.min(ports(srvs).length, 7); r <= 107; r++) { set(rows, `C${r}`, ''); set(rows, `D${r}`, ''); }
    ports(stos).slice(0, 4).forEach((p, i) => {
      set(rows, `C${109 + i}`, p.label || p.name || '');
      set(rows, `D${109 + i}`, p.ip || '');
    });
    for (let r = 109 + Math.min(ports(stos).length, 4); r <= 112; r++) { set(rows, `C${r}`, ''); set(rows, `D${r}`, ''); }
    // Imprimantes (r127-130) et clime (r137) : devices par nom
    const byNameRe = re => sortedRackInstances(ws).filter(x => re.test(x.inst.name || ''));
    byNameRe(/^PR[NT]/i).slice(0, 4).forEach((x, i) => {
      set(rows, `C${127 + i}`, x.inst.name || '');
      set(rows, `D${127 + i}`, x.inst.ipMgmt || '');
    });
    for (let r = 127 + Math.min(byNameRe(/^PR[NT]/i).length, 4); r <= 130; r++) { set(rows, `C${r}`, ''); set(rows, `D${r}`, ''); }
    byNameRe(/CLIM|FROID/i).slice(0, 1).forEach(x => {
      set(rows, 'C137', x.inst.name || '');
      set(rows, 'D137', x.inst.ipMgmt || '');
    });
    // Switch 1-6 : IP de mgmt
    const sws = byCat(ws, ['switch']);
    sws.slice(0, 6).forEach((x, i) => set(rows, `D${70 + i}`, x.inst.ipMgmt || ''));
    // Serveur physique 1 / SAN
    if (srvs[0]) { set(rows, 'C100', srvs[0].inst.name || ''); set(rows, 'D100', srvs[0].inst.ipMgmt || ''); }
    if (stos[0]) { set(rows, 'C108', stos[0].inst.name || ''); set(rows, 'D108', stos[0].inst.ipMgmt || ''); }
    // VM NX (BI/BC/AD/Web ×2) : appariement par mots-clés sur nom + rôle
    const vms = L.vms || [];
    const pick = (re, idx) => vms.filter(v => re.test(`${v.name} ${v.role}`))[idx];
    [['113', /\bBI\b|BI[-_ ]/i, 0], ['114', /\bBC\b|BC[-_ ]|VEEAM|backup|sauvegarde/i, 0],
     ['115', /\bAD\b|AD[-_ ]|DC[-_ ]|Active.?Directory/i, 0], ['116', /WEB|proxy/i, 0],
     ['117', /\bBI\b|BI[-_ ]/i, 1], ['118', /\bBC\b|BC[-_ ]|VEEAM|backup|sauvegarde/i, 1],
     ['119', /\bAD\b|AD[-_ ]|DC[-_ ]|Active.?Directory/i, 1], ['120', /WEB|proxy/i, 1]]
      .forEach(([r, re, idx]) => {
        const v = pick(re, idx);
        if (v) { set(rows, `C${r}`, v.name || ''); set(rows, `D${r}`, v.ip || ''); }
      });
    // Points d'accès, onduleurs, IDS, NVR, pointeuses
    const fillRows = (list, r0, n) => list.slice(0, n).forEach((x, i) => {
      set(rows, `C${r0 + i}`, x.inst.name || '');
      set(rows, `D${r0 + i}`, x.inst.ipMgmt || '');
    });
    fillRows(byCat(ws, ['ap']), 121, 6);
    fillRows(byCat(ws, ['ups']), 131, 2);
    fillRows(byCat(ws, ['ids']), 133, 2);
    fillRows(byCat(ws, ['cctv']), 135, 1);
    fillRows(byCat(ws, ['pointage']), 136, 1);

    const vlans = L.vlans || [];
    vlans.slice(0, 27).forEach((v, i) => {
      const r = 143 + i;
      set(rows, `B${r}`, v.vid ? `VLAN ${v.vid} — ${v.name || ''}` : (v.name || ''), 6);
      set(rows, `C${r}`, v.subnet || '', 1);
      // colonne GW : garde le style du template si la cellule existe déjà
      set(rows, `D${r}`, v.gw || '', rows[r - 1][3] ? rows[r - 1][3].s : 1);
    });
    for (let r = 143 + Math.min(vlans.length, 27); r <= 169; r++) {
      set(rows, `B${r}`, '', 6);
      set(rows, `C${r}`, '', 1);
      if (rows[r - 1][3]) set(rows, `D${r}`, '', 1);
    }
    // Nomenclature : le registre saisi dans l'app est ajouté sous le tableau
    const nomen = L.nomen || [];
    if (nomen.length) {
      const put = (r, col, v, s) => {
        while (rows.length < r) rows.push([]);
        rows[r - 1][col] = { v, s };
      };
      const ncols = lldExportCols(L, 'nomen', LLD_NOMEN_COLS);
      put(171, 1, "Nomenclature — registre de l'application", 50);
      ncols.forEach((c, ci) => {
        const hs = ci === 0 ? 141 : (ci === ncols.length - 1 ? 143 : 2);
        put(172, 1 + ci, String(c[1]), hs);
      });
      nomen.slice(0, 25).forEach((nm, i) => {
        const st = i % 2 ? 197 : 8;
        ncols.forEach((c, ci) => put(173 + i, 1 + ci, String(nm[c[0]] ?? ''), st));
      });
    }
    /* Lignes « Equipment Firewall 1/2 » (r19/20) : le template les fusionne
       (cluster) — on défusionne pour écrire chaque équipement séparément.
       B156:D156 : ligne de séparation du registre VLAN, défusionnée car le
       registre de l'app y écrit une entrée (viDRAC). */
    // Surcharges saisies librement dans la matrice de la modale (toutes colonnes C-H)
    Object.entries(L.ch4ov || {}).forEach(([ref, v]) => {
      if (/^[C-H]\d{1,3}$/.test(ref)) set(rows, ref, String(v || '').slice(0, 80));
    });
    const merges4 = (sheet.merges || [])
      .filter(m => !/^[C-H]19:[C-H]20$/.test(m) && !/^B156:D156$/.test(m));
    return out(sheet, rows, heights, merges4);
  }

  /* — Feuille « 5 » : FAI (infos + réglages avancés) + câblage — */
  function ch5(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const fais = (L.fais && L.fais.length) ? L.fais
      : (L.fai && (L.fai.operator || L.fai.offer || L.fai.down) ? [L.fai] : []);
    const lblFai = f => String(f.desc || '').trim()
      || (f.operator ? `${f.operator}${f.offer ? ' — ' + f.offer : ''}` : '');
    const COLS5 = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
    fais.slice(0, 4).forEach((f, i) => {
      const r = 35 + i;
      set(rows, `C${r}`, lblFai(f));
      set(rows, `D${r}`, f.down || '');
      set(rows, `E${r}`, f.lanIp || '');
      set(rows, `F${r}`, f.lanMask || '');
      set(rows, `G${r}`, f.lanGw || '');
      set(rows, `H${r}`, f.lanDns || '');
      set(rows, `I${r}`, f.ipv6 || '');
      set(rows, `J${r}`, f.dhcp || '');
      set(rows, `K${r}`, f.pf || '');
      set(rows, `L${r}`, f.pfPortWan || '');
      set(rows, `M${r}`, f.pfPortLan || '');
      set(rows, `N${r}`, f.pfClient || '');
      set(rows, `O${r}`, f.pfProto || '');
      set(rows, `P${r}`, f.dmz || '');
      set(rows, `Q${r}`, f.firewall || '');
      set(rows, `R${r}`, f.wlanStat || '');
      set(rows, `S${r}`, f.wlan || '');
      set(rows, `T${r}`, String(f.notes || '').split('\n')[0]);
    });
    for (let r = 35 + Math.min(fais.length, 4); r <= 38; r++)
      COLS5.forEach(c2 => set(rows, `${c2}${r}`, ''));
    // 5.2 câblage : source prioritaire = tableau du sommaire L.faiCab
    // (généré/enregistré dans la modale) ; sinon dérivé des FAI (CPE → WAN).
    const cab5 = (Array.isArray(L.faiCab) && L.faiCab.length)
      ? L.faiCab.filter(r => r && ((r.desc || '').trim() || (r.conn || '').trim()))
      : fais.slice(0, 4).map(f => ({
        cat: 'FAI',
        desc: f.cpe || lblFai(f),
        conn: f.wanLabel || ''
      }));
    for (let r = 46; r <= 53; r++) {
      set(rows, `B${r}`, r === 46 ? 'FAI' : '');
      set(rows, `C${r}`, '');
      set(rows, `D${r}`, '');
    }
    cab5.slice(0, 8).forEach((c, i) => {
      const r = 46 + i;
      set(rows, `B${r}`, c.cat || (i === 0 ? 'FAI' : ''));
      set(rows, `C${r}`, String(c.desc || ''));
      set(rows, `D${r}`, String(c.conn || ''));
    });
    /* Le template fusionne L36:O36 (sous-colonnes « Port Forwarding » de la
       ligne FAI 2) : on défusionne pour écrire chaque champ séparément. */
    const merges5 = (sheet.merges || []).filter(m => !/^L3[6-8]:O3[6-8]$/.test(m));
    const s5 = out(sheet, rows, heights, merges5);
    const im5 = insertChapterExtras(s5.rows, ws, '5');
    if (im5) s5.opts.images = im5;
    return s5;
  }

  /* — Feuille « 6 » : interconnexion site à site (complète) — */
  function ch6(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const ic = L.interco || {};
    const fais = (L.fais && L.fais.length) ? L.fais
      : (L.fai && (L.fai.operator || L.fai.down) ? [L.fai] : []);
    const short = s => String(s || '').split(' — ')[0];
    const ipOf = s => { const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(String(s || '')); return m ? m[1] : ''; };
    // FAI rattaché à chaque extrémité : IP WAN trouvée dans le libellé, sinon par ordre
    const faiOf = (ep, idx) => {
      const ip = ipOf(ep);
      return fais.find(f => ip && f.wanIp === ip) || fais[idx] || {};
    };
    // 6.1 — extrémités (r30/31) : identité, SN, firmware, adressage WAN du FAI,
    // HA (J→P), VIP partagée (N30/31), commentaire
    // Source prioritaire : tableau 6.1 du sommaire (L.ic61), sinon champs interco
    const ic61 = (Array.isArray(L.ic61) && L.ic61.length)
      ? L.ic61.filter(r => r && Object.values(r).some(v => String(v ?? '').trim()))
      : [];
    const epFrom = (row, sideEp, idx) => {
      if (row) {
        return [
          row.equip || sideEp,
          row.sn || '', row.fw || '',
          row.haEn === 'Oui' || row.haGroup ? (row.haGroup || 'Oui') : '',
          row.haRole || '',
          row.mgmt || '', row.mgmtMask || '',
          // FAI comment + IP depuis row.ip si présent
          { wanIp: row.ip || '', wanMask: row.mask || '', wanGw: row.gw || '', wanDns: row.dns || '',
            operator: /FAI\s*:/.test(row.note || '') ? String(row.note).replace(/^FAI\s*:\s*/, '').split(' — ')[0] : '',
            offer: '' },
          'C62'
        ];
      }
      const side = idx === 0 ? 'A' : 'B';
      const ep = sideEp;
      const sn = side === 'A' ? ic.snA : ic.snB;
      const fw = side === 'A' ? ic.fwA : ic.fwB;
      const ha = side === 'A' ? ic.haA : ic.haB;
      const role = side === 'A' ? ic.roleA : ic.roleB;
      const mgmt = side === 'A' ? ic.mgmtA : ic.mgmtB;
      const mgmtMask = side === 'A' ? ic.mgmtMaskA : ic.mgmtMaskB;
      return [ep, sn, fw, ha, role, mgmt, mgmtMask, faiOf(ep, idx), idx === 0 ? 'C62' : 'C67'];
    };
    const endpoints = [
      (() => { const a = epFrom(ic61[0], ic.epA, 0); a[8] = 'C62'; return ['30', ...a]; })(),
      (() => { const b = epFrom(ic61[1], ic.epB, 1); b[8] = 'C67'; return ['31', ...b]; })()
    ].map(arr => {
      // arr = [r, ep, sn, fw, ha, role, mgmt, mgmtMask, f, cabRef]
      return [arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7], arr[8], arr[9]];
    });
    endpoints.forEach(([r, ep, sn, fw, ha, role, mgmt, mgmtMask, f, cabRef]) => {
      if (ep) {
        set(rows, `B${r}`, ep);
        if (cabRef) set(rows, cabRef, short(ep));
      }
      // Nomenclature : saisie 6.1 si presente, sinon device d'inventaire
      const nm = short(ep).split(/[\s(]/)[0].toLowerCase();
      const inst = sortedRackInstances(ws).find(x => (x.inst.name || '').toLowerCase() === nm);
      const rowIc = (r === '30' || r === '31') ? ic61[r === '30' ? 0 : 1] : null;
      const nomen = (rowIc && rowIc.nomen)
        || (inst ? [inst.inst.brand, inst.inst.model].filter(Boolean).join(' ') : '');
      set(rows, `C${r}`, nomen);
      set(rows, `D${r}`, sn || '');
      set(rows, `E${r}`, fw || '');
      const ipR = (r === '30' || r === '31') ? ic61[r === '30' ? 0 : 1] : null;
      set(rows, `F${r}`, (ipR && ipR.ip) || f.wanIp || ipOf(ep) || '');
      set(rows, `G${r}`, (ipR && ipR.mask) || f.wanMask || '');
      set(rows, `H${r}`, (ipR && ipR.gw) || f.wanGw || '');
      set(rows, `I${r}`, (ipR && ipR.dns) || f.wanDns || '');
      const haR = (r === '30' || r === '31') ? ic61[r === '30' ? 0 : 1] : null;
      set(rows, `J${r}`, (haR && haR.haEn) || (ha ? 'Oui' : ''));
      set(rows, `K${r}`, (haR && haR.haGroup) || ha || '');
      set(rows, `L${r}`, (haR && haR.haRole) || role || '');
      set(rows, `M${r}`, (haR && haR.haMaster) || (/master/i.test(role || '') ? 'Oui' : ''));
      set(rows, `O${r}`, (haR && haR.mgmt) || mgmt || '');
      set(rows, `P${r}`, (haR && haR.mgmtMask) || mgmtMask || '');
      const noteIc = haR && haR.note;
      if (noteIc) set(rows, `Q${r}`, noteIc);
      else if (f.operator) set(rows, `Q${r}`, `FAI : ${f.operator}${f.offer ? ' — ' + f.offer : ''}`);
    });
    const vipA = (ic61[0] && ic61[0].vip) || ic.vipA || '';
    const vipB = (ic61[1] && ic61[1].vip) || ic.vipB || '';
    if (vipA) set(rows, 'N30', vipA);
    if (vipB) set(rows, 'N31', vipB);
    // System — Admin Security (r37-38) : comptes d'administration saisis dans la fiche LLD
    (L.adminSec || []).slice(0, 2).forEach((a, i) => {
      const r = 37 + i;
      set(rows, `B${r}`, a.user || '');
      set(rows, `C${r}`, a.auth || '');
      set(rows, `D${r}`, a.proto || '');
      set(rows, `E${r}`, a.host || '');
      set(rows, `F${r}`, a.port || '');
      set(rows, `G${r}`, a.cli || '');
      set(rows, `H${r}`, a.sec || '');
      set(rows, `I${r}`, a.webA || '');
      set(rows, `K${r}`, a.webB || '');
      set(rows, `M${r}`, a.note || '');
    });
    for (let r = 37 + Math.min((L.adminSec || []).length, 2); r <= 38; r++)
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'M'].forEach(c2 => set(rows, `${c2}${r}`, ''));
    // WAN Connection Settings (r45-47) — source prioritaire : tableau L.icWan
    // du sommaire ; sinon dérivation FAI (comportement historique).
    const icWan = (Array.isArray(L.icWan) && L.icWan.length)
      ? L.icWan.filter(r => r && ((r.name || '').trim() || (r.ip || '').trim()
          || (r.provider || '').trim() || (r.enable || '').trim()))
      : [];
    const wanCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                     'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
                     'Y', 'Z', 'AA', 'AB'];
    const wanKeys = ['name', 'enable', 'connMethod', 'routingMode', 'ip', 'mask',
                     'gw', 'dns', 'priority', 'up', 'down', 'portSpeed',
                     'mtu', 'mss', 'macClone', 'vlan', 'hcMethod', 'hcDns',
                     'hcTimeout', 'hcInterval', 'hcRetries', 'hcRecovery',
                     'provider', 'dynDns', 'ipv6', 'doh', 'qos'];
    if (icWan.length) {
      for (let i = 0; i < 3; i++) {
        const r = 45 + i;
        const row = icWan[i] || {};
        wanCols.forEach((col, ci) => set(rows, `${col}${r}`, String(row[wanKeys[ci]] ?? '')));
      }
    } else {
      fais.slice(0, 3).forEach((f, i) => {
        const r = 45 + i;
        set(rows, `B${r}`, f.operator ? `WAN ${i + 1} — ${f.operator}` : `WAN ${i + 1}`);
        set(rows, `C${r}`, 'Oui');
        set(rows, `D${r}`, f.ipMode || '');
        set(rows, `E${r}`, 'NAT');
        set(rows, `F${r}`, f.wanIp || '');
        set(rows, `G${r}`, f.wanMask || '');
        set(rows, `H${r}`, f.wanGw || '');
        set(rows, `I${r}`, f.wanDns || '');
        set(rows, `K${r}`, f.up || '');
        set(rows, `L${r}`, f.down || '');
        set(rows, `M${r}`, f.down || '');
        set(rows, `X${r}`, f.operator || '');
      });
      for (let r = 45 + Math.min(fais.length, 3); r <= 47; r++)
        ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'X'].forEach(c2 => set(rows, `${c2}${r}`, ''));
    }
    // LAN (r52 = en-têtes ; r53-55 = données) — source prioritaire : L.icLan
    const icLan = (Array.isArray(L.icLan) && L.icLan.length)
      ? L.icLan.filter(r => r && ((r.lan || '').trim() || (r.routing || '').trim() || (r.network || '').trim()))
      : [];
    if (icLan.length) {
      for (let i = 0; i < 3; i++) {
        const r = 53 + i;
        const row = icLan[i] || {};
        set(rows, `B${r}`, String(row.lan ?? ''));
        set(rows, `C${r}`, String(row.routing ?? ''));
        set(rows, `D${r}`, String(row.network ?? ''));
      }
      // défusionner B/C/D 53:55 si plusieurs lignes (merges verticaux du template)
      if (icLan.length > 1) {
        // no-op sur merges : out() gère via merges6 — voir filtre plus bas
      }
    } else {
      if (ic.routing) set(rows, 'C53', ic.routing);
      const nv = (L.vlans || []).length;
      set(rows, 'D53', nv ? `x${nv} VLANs routés` : '');
      if (ic.localSubnets) set(rows, 'B53', `LAN — ${ic.localSubnets}`);
      if (ic.remoteSubnets) {
        set(rows, 'B54', 'LAN — distant');
        set(rows, 'D54', ic.remoteSubnets);
      }
    }
    // 6.2 câblage — source prioritaire : tableau L.icCab (sommaire) ;
    // sinon dérivation FAI/interco sur les lignes du template (62-71).
    const icCab = (Array.isArray(L.icCab) && L.icCab.length)
      ? L.icCab.filter(r => r && ((r.desc || '').trim() || (r.port || '').trim() || (r.conn || '').trim()))
      : [];
    if (icCab.length) {
      // template : B=Categorie (col1), C=Description, D=Port, E=Connecté a
      for (let r = 62; r <= 71; r++) {
        set(rows, `B${r}`, '');
        set(rows, `C${r}`, '');
        set(rows, `D${r}`, '');
        set(rows, `E${r}`, '');
      }
      icCab.slice(0, 10).forEach((c, i) => {
        const r = 62 + i;
        set(rows, `B${r}`, i === 0 ? String(c.cat || 'Interconnexion S2S') : '');
        set(rows, `C${r}`, String(c.desc || ''));
        set(rows, `D${r}`, String(c.port || ''));
        set(rows, `E${r}`, String(c.conn || ''));
      });
    } else {
      const labA = (faiOf(ic.epA, 0).wanLabel || '');
      const labB = (faiOf(ic.epB, 1).wanLabel || '');
      const extraFor = (ownA, ownB, re) => fais.map(f => f.wanLabel || '')
        .find(l => l && l !== ownA && l !== ownB && re.test(l)) || '';
      set(rows, 'E62', labA);
      set(rows, 'E63', extraFor(labA, labB, /rtr-?01|siège|siege/i));
      set(rows, 'E64', '');
      set(rows, 'E67', labB);
      set(rows, 'E68', extraFor(labA, labB, /rtr-?02|agence/i));
      set(rows, 'E69', '');
      set(rows, 'E66', ic.lanA || '');
      set(rows, 'E71', ic.lanB || '');
    }
    // VIP (N30/31) et masque admin (P30/31) : le template fusionne N30:N31 et
    // P30:P31 alors que chaque extrémité a ses propres valeurs -> on défusionne.
    const merges6 = (sheet.merges || []).filter(m =>
      !/^(N30:N31|P30:P31)$/.test(m)
      && !(icLan.length > 1 && /^(B53:B55|C53:C55|D53:D55)$/.test(m)));
    const s6 = out(sheet, rows, heights, merges6);
    const im6 = insertChapterExtras(s6.rows, ws, '6');
    if (im6) s6.opts.images = im6;
    return s6;
  }

  /* — Sommaire du dossier (modale 📘) : index par numéro de chapitre —
     Posé par buildAll ; les fonctions de feuille consultent hasB() pour
     n'imprimer que les informations rattachées au sommaire (synchro). */
  let BUILD_TOC = new Map();
  function hasB(num, key) {
    let n = BUILD_TOC.get(String(num));
    if (!n && String(num).includes('.')) n = BUILD_TOC.get(String(num).split('.')[0]);
    return !!(n && Array.isArray(n.blocks) && n.blocks.includes(key));
  }

  /* — Blocs de contenu pour les chapitres AJOUTÉS au sommaire —
     (indépendant de LLD_INFOS pour rester auto-suffisant côté export) */
  const BLOCK_TABLES = {
    nomen: ['Nomenclature', ['Type d\u2019objet', 'Préfixe', 'Exemple', 'Règle de nommage'],
            ['type', 'prefix', 'example', 'rule']],
    vlans: ['Registre VLANs & subnets', ['VLAN', 'Nom', 'Site', 'Subnet', 'Passerelle', 'Usage'],
            ['vid', 'name', 'site', 'subnet', 'gw', 'purpose']],
    fw: ['Règles et NAT', ['Type', 'Nom', 'Source', 'Destination', 'Service / Ports', 'Action'],
         ['type', 'name', 'src', 'dst', 'service', 'action']],
    vms: ['Machines virtuelles', ['VM', 'Rôle', 'Hôte', 'IP / VLAN'], ['name', 'role', 'host', 'ip']],
    vols: ['Volumes / LUN', ['Volume', 'Capacité', 'Type', 'Serveur'], ['name', 'size', 'type', 'srv']],
    cams: ['Caméras', ['Caméra', 'Emplacement', 'Modèle', 'IP'], ['name', 'loc', 'model', 'ip']],
    vpns: ['Tunnels VPN S2S', ['Tunnel', 'Pair / subnet distant'], ['name', 'peer']],
    aliases: ['Alias firewall', ['Alias', 'Définition'], ['name', 'value']],
    equip: ['Équipements hors baie', ['Élément', 'Quantité', 'Remarque', 'Statut'],
            ['model', 'qty', 'remark', 'status']],
    adminSec: ["Comptes d'administration", ['Admin user/pwd', 'Authentification', 'Host'],
               ['user', 'auth', 'host']]
  };

  /* Métadonnées des blocs diagramme/captures (LLD_INFOS si présent, sinon repli). */
  function lldBlockDef(key, L) {
    if (typeof lldInfoDef === 'function') {
      const d = lldInfoDef(key, L);
      if (d) return d;
    }
    if (typeof LLD_INFOS !== 'undefined' && LLD_INFOS && LLD_INFOS[key]) return LLD_INFOS[key];
    const m = {
      diag5: { label: 'Diagramme d’accès FAI (avant 5.1)', kind: 'diagram', mode: 'fai' },
      diag6: { label: 'Diagramme d’interconnexion (avant 6.1)', kind: 'diagram', mode: 'interco' },
      diag7: { label: 'Diagramme Firewall (avant le reste du ch. 7)', kind: 'diagram', mode: 'fw' },
      shots5: { label: 'Captures d’écran — ch. 5', kind: 'shots' },
      shots6: { label: 'Captures d’écran — ch. 6', kind: 'shots' },
      shots7: { label: 'Captures d’écran — ch. 7', kind: 'shots' }
    };
    return m[key] || null;
  }

  function blockRows(key, ws, imgSink) {
    const L = ws.lld || {};
    const out = [];
    const texts = {
      objectif: ['Objectif du document', L.objectif],
      existant: ['Infrastructure existante', L.existant],
      architecture: ['Architecture cible', L.architecture],
      'note:firewall': ['Notes — Firewall', (L.catNotes || {}).firewall],
      'note:switching': ['Notes — Switching', (L.catNotes || {}).switching],
      'note:server': ['Notes — Serveurs', (L.catNotes || {}).server],
      'note:storage': ['Notes — Stockage', (L.catNotes || {}).storage],
      'note:ids': ['Notes — Intrusion (IDS)', (L.catNotes || {}).ids],
      'note:cctv': ['Notes — CCTV', (L.catNotes || {}).cctv],
      'note:pointage': ['Notes — Pointage (SPO)', (L.catNotes || {}).pointage]
    };
    if (texts[key]) {
      const [label, val] = texts[key];
      out.push([]); out.push(SEC(label));
      const lines = proseLines(val, 40);
      if (lines.length) lines.forEach(t => out.push(NOTE(t)));
      else out.push(NOTE('Section à compléter.'));
      return out;
    }
    if (key === 'faiCab' || key === 'fais' || key === 'ic61' || key === 'icCab'
        || key === 'icWan' || key === 'icLan') {
      const META = {
        faiCab: [LLD_FAI_CAB_COLS, '5.2. Câblage FAI'],
        fais: [LLD_FAI51_COLS, '5.1. Informations & Configuration'],
        ic61: [LLD_IC61_COLS, '6.1. Informations & Configuration'],
        icCab: [LLD_IC_CAB_COLS, '6.2. Câblage interconnexion'],
        icWan: [LLD_IC_WAN_COLS, '6.1. WAN Connection Settings'],
        icLan: [LLD_IC_LAN_COLS, '6.1. LAN / Network settings']
      };
      const [cols, titre] = META[key];
      const tbl = (L[key] || []).filter(r => r && Object.values(r).some(v => String(v ?? '').trim()));
      out.push([]);
      if (tbl.length) {
        out.push(SEC(titre)); out.push([]);
        out.push(H(cols.map(c => String(c[1]))));
        tbl.forEach((r, i) => out.push(D(cols.map(c => String(r[c[0]] ?? '')), i % 2)));
      } else out.push(NOTE(`${titre} : aucune ligne (🔎 Générer depuis l’élévation).`));
      return out;
    }
    if (BLOCK_TABLES[key]) {
      const [titre, labels, ks] = BLOCK_TABLES[key];
      const defCols = ks.map((k, i) => [k, labels[i], null]);
      const cols = lldExportCols(L, key, defCols);
      const tbl = L[key] || [];
      out.push([]);
      if (tbl.length) {
        out.push(SEC(titre)); out.push([]);
        out.push(H(cols.map(c => String(c[1]))));
        tbl.forEach((r, i) => out.push(D(cols.map(c => String(r[c[0]] ?? '')), i % 2)));
      } else out.push(NOTE(`${titre} : aucune ligne renseignée.`));
      return out;
    }
    if (key === 'sites') {
      const sites = ws.sites || [];
      const cols = lldExportCols(L, 'sites', LLD_SITE_COLS);
      out.push([]);
      if (sites.length) {
        out.push(SEC('Sites')); out.push([]);
        out.push(H(cols.map(c => String(c[1]))));
        sites.forEach((s, i) => out.push(D(cols.map(c => String(s[c[0]] ?? '')), i % 2)));
      } else out.push(NOTE('Aucun site déclaré.'));
      return out;
    }
    if (key === 'zones') {
      const zs = L.swZones || [];
      const cols = lldExportCols(L, 'zones', LLD_ZONE_COLS);
      out.push([]);
      if (zs.length) {
        out.push(SEC('Zones de Switching')); out.push([]);
        out.push(H(cols.map(c => String(c[1]))));
        zs.forEach((z, i) => out.push(D(cols.map(c => String(z[c[0]] ?? '')), i % 2)));
      } else out.push(NOTE('Aucune zone de switching.'));
      return out;
    }
    if (key === 'flows') {
      const all = flowsRows(ws);
      const fr = all.slice(1);
      out.push([]);
      if (fr.length) {
        out.push(SEC('Matrice des flux')); out.push([]);
        out.push(H(all[0]));
        fr.forEach((f, i) => out.push(D(f, i % 2)));
      } else out.push(NOTE('Aucun flux réseau.'));
      return out;
    }
    if (key === 'fais') {
      out.push([]); out.push(SEC('FAI — accès Internet'));
      const fais = (L.fais && L.fais.length) ? L.fais : (L.fai ? [L.fai] : []);
      let any = false;
      fais.forEach((f, i) => {
        const pairs = [
          [fais.length > 1 ? `FAI ${i + 1} — opérateur` : 'Opérateur', f.operator],
          ['Offre', f.offer], ['Débit descendant', f.down], ['Débit montant', f.up],
          ['Bloc IP publiques', f.publicBlock], ['Notes', f.notes]
        ];
        pairs.forEach(([a, b]) => {
          if (b && String(b).trim()) { out.push(D([a, String(b)], any)); any = true; }
        });
      });
      if (!any) out.push(NOTE('Section à compléter.'));
      return out;
    }
    if (key === 'interco' || key === 'fwProfiles' || key === 'meta') {
      const tgt = key === 'interco' ? (L.interco || {})
        : key === 'fwProfiles' ? (L.fwProfiles || {}) : L;
      const labels = key === 'meta'
        ? { client: 'Client', author: 'Auteur', version: 'Version' }
        : key === 'fwProfiles'
          ? { vpnSsl: 'VPN SSL — utilisateurs', appCtrl: 'Application Control',
              webBlocker: 'WebBlocker', httpProxy: 'HTTP Proxy' }
          : { tech: 'Technologie', routing: 'Routage', epA: 'Endpoint public site A',
              epB: 'Endpoint public site B', localSubnets: 'Subnets locaux (A)',
              remoteSubnets: 'Subnets distants (B)', encryption: 'Chiffrement', notes: 'Notes' };
      out.push([]);
      out.push(SEC(key === 'meta' ? 'Informations du document'
        : key === 'fwProfiles' ? 'Profils firewall' : 'Interconnexion site à site'));
      let any = false;
      Object.entries(labels).forEach(([k, lbl]) => {
        if (tgt[k] && String(tgt[k]).trim()) { out.push(D([lbl, String(tgt[k])], any)); any = true; }
      });
      if (!any) out.push(NOTE('Section à compléter.'));
      return out;
    }
    if (key === 'governance') {
      out.push([]); out.push(SEC('Governance du document'));
      if ((L.revs || []).length) {
        out.push(H(['Rév', 'Date', 'Auteur', 'Modifications']));
        (L.revs || []).forEach((r, i) => out.push(D([r.rev, r.date, r.author, r.note], i % 2)));
      } else out.push(NOTE('Aucune révision.'));
      return out;
    }
    // Blocs libres (chapitre ajouté) : paragraphe / tableau
    {
      const cdef = lldBlockDef(key, L);
      if (cdef && cdef.custom && cdef.kind === 'textarea') {
        out.push([]); out.push(SEC(cdef.label));
        const lines = proseLines(L[key], 40);
        if (lines.length) lines.forEach(t => out.push(NOTE(t)));
        else out.push(NOTE('Section à compléter.'));
        return out;
      }
      if (cdef && cdef.custom && cdef.kind === 'table') {
        const cols = lldExportCols(L, key, cdef.cols || LLD_CUSTOM_TABLE_COLS);
        const tbl = (L[key] || []).filter(r => r && Object.values(r).some(v => String(v ?? '').trim()));
        out.push([]);
        if (tbl.length) {
          out.push(SEC(cdef.label)); out.push([]);
          out.push(H(cols.map(c => String(c[1]))));
          tbl.forEach((r, i) => out.push(D(cols.map(c => String(r[c[0]] ?? '')), i % 2)));
        } else out.push(NOTE(`${cdef.label} : aucune ligne renseignée.`));
        return out;
      }
    }
    // Diagramme ch. 5/6/7 — image du schéma (JPEG pré-rasterisé) si dispo ;
    // sinon tableaux texte De/Liaison/Vers (repli harnais / rendu échoué).
    if (lldBlockDef(key, L) && lldBlockDef(key, L).kind === 'diagram') {
      const def = lldBlockDef(key, L);
      const mode = def.mode || 'fai';
      const d = (L.diagrams || {})[mode];
      out.push([]);
      out.push(SEC(def.label));
      if (def.hint) out.push(NOTE(String(def.hint).split('\n')[0]));
      const pre = (typeof globalThis !== 'undefined' && globalThis.__LLD_DIAG_IMGS)
        ? globalThis.__LLD_DIAG_IMGS[mode] : null;
      if (d && (d.nodes || []).length && imgSink && pre
          && typeof pre.dataUrl === 'string' && pre.dataUrl.startsWith('data:image/')) {
        out.push(NOTE('Schéma embarqué ci-dessous — mêmes nœuds et liens que dans la modale 📘.'));
        imgSink.push({
          dataUrl: pre.dataUrl,
          widthPx: Math.min(1400, pre.widthPx || 960),
          heightPx: Math.min(900, pre.heightPx || 560),
          name: 'diagramme-' + mode
        });
        return out;
      }
      if (d && (d.nodes || []).length) {
        const byId = Object.fromEntries(d.nodes.map(n => [n.id, n]));
        out.push([]);
        out.push(H(['Élément', 'Type', 'Détail']));
        d.nodes.forEach((n, i) => out.push(D([
          String(n.label || n.id || ''),
          String(n.kind || ''),
          String(n.sub || '')
        ], i % 2)));
        if ((d.links || []).length) {
          out.push([]);
          out.push(H(['De', 'Liaison', 'Vers']));
          d.links.forEach((l, i) => {
            const a = byId[l.a], b = byId[l.b];
            out.push(D([
              a ? String(a.label) : String(l.a || ''),
              String(l.label || (l.dashed ? 'secours' : '—')),
              b ? String(b.label) : String(l.b || '')
            ], i % 2));
          });
        }
      } else {
        out.push(NOTE('Diagramme non généré — bouton « 🔎 Générer depuis l’élévation » dans la modale 📘.'));
      }
      return out;
    }
    // Captures d'écran — légende + image embarquée (opts.images)
    if (lldBlockDef(key, L) && lldBlockDef(key, L).kind === 'shots') {
      const def = lldBlockDef(key, L);
      const shots = (L[key] || []).slice(0, 8);
      out.push([]);
      out.push(SEC(def.label));
      if (!shots.length) {
        out.push(NOTE('Aucune capture (glisser-déposer dans la modale 📘).'));
        return out;
      }
      out.push(H(['Fichier', 'Dimensions (px)']));
      shots.forEach((s, i) => {
        out.push(D([String(s.name || 'capture'), `${s.w || ''} × ${s.h || ''}`], i % 2));
        if (imgSink && typeof s.dataUrl === 'string' && s.dataUrl.startsWith('data:image/')) {
          imgSink.push({
            dataUrl: s.dataUrl,
            widthPx: Math.min(900, s.w || 640),
            heightPx: Math.min(500, s.h || 360),
            name: String(s.name || ('capture-' + (i + 1))).slice(0, 40)
          });
        }
      });
      return out;
    }
    return out;
  }

  /* — Feuille Excel pour un chapitre / sous-chapitre ajouté au sommaire — */
  /* Blocs de chapitre absents du template Excel (diagramme / captures) :
     écrits dans la première zone vide sous le titre, sinon après le contenu. */
  function insertChapterExtras(rows, ws, num) {
    const n = BUILD_TOC.get(String(num));
    if (!n || !Array.isArray(n.blocks) || !n.blocks.length) return null;
    const imgs = [];
    const chunks = [];
    n.blocks.forEach(k => {
      const def = lldBlockDef(k, ws.lld);
      if (!def || (def.kind !== 'diagram' && def.kind !== 'shots')) return;
      const local = [];
      blockRows(k, ws, imgs).forEach(r => local.push(r));
      if (local.length) chunks.push(local);
    });
    if (!chunks.length) return null;
    const flat = [];
    chunks.forEach(chunk => { flat.push([]); flat.push(...chunk); });
    let firstOcc = rows.length;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i].length) { firstOcc = i; break; }
    }
    const gap = Math.max(0, firstOcc - 1);
    const use = Math.min(gap, flat.length);
    for (let i = 0; i < use; i++) rows[1 + i] = flat[i];
    let imgRowBase;
    if (flat.length > use) {
      rows.push(...flat.slice(use));
      imgRowBase = rows.length;
    } else {
      imgRowBase = firstOcc;
    }
    imgs.forEach((im, i) => { im.row = Math.max(0, imgRowBase + 1 + i * 16); });
    return imgs;
  }

  function customSheet(name, node, ws) {
    const rows = [];
    rows.push([{ v: `${node.num}. ${node.title}`, s: 50 }, { v: '', s: 50 }]);
    rows.push([]);
    const imgs = [];
    const keys = node.blocks || [];
    if (keys.length) keys.forEach(k => blockRows(k, ws, imgs).forEach(r => rows.push(r)));
    else rows.push(NOTE('Section à compléter.'));
    (node.subs || []).forEach(s => {
      if (!s.custom) return;
      rows.push([]);
      rows.push(SEC(`${s.num}. ${s.title}`));
      if ((s.blocks || []).length) s.blocks.forEach(k => blockRows(k, ws, imgs).forEach(r => rows.push(r)));
      else rows.push(NOTE('Section à compléter.'));
    });
    imgs.forEach((im, i) => { im.row = rows.length + 1 + i * 16; });
    return { name, rows, opts: { freeze: false, autoHeader: false, dcw: 11.57, heights: {}, merges: [], images: imgs } };
  }

  const FILLS = { 'LLD': lld, 'Governance': governance, '1': ch1, '2': ch2,
                  '3': ch3, '4': ch4, '5': ch5, '6': ch6,
                  '7': ch7,
                  '8': switchZone, '8.1': switchZone, '8.2': switchZone,
                  '8.3': switchZone, '8.4': switchZone, '8.5': switchZone,
                  '9':  chapterWith('server', '9.1. Serveurs', '9.2. Machines virtuelles',
                        [['VM', 'name'], ['Rôle', 'role'], ['Hôte', 'host'], ['IP / VLAN', 'ip']], 'vms',
                        "À compléter : rôles et affectation des machines virtuelles.", 'server'),
                  '10': chapterWith('storage', '10.1. Stockage', '10.2. Volumes / LUN',
                        [['Volume', 'name'], ['Capacité', 'size'], ['Type', 'type'], ['Serveur', 'srv']], 'vols',
                        "À compléter : volumes/LUN et plan de sauvegarde.", 'storage'),
                  '11': chapterEquip(['ids'], "11.1. Détection d'intrusion", null, 'ids'),
                  '12': chapterWith('cctv', '12.1. Caméras et enregistreur (NVR)', '12.2. Caméras',
                        [['Caméra', 'name'], ['Emplacement', 'loc'], ['Modèle', 'model'], ['IP', 'ip']], 'cams',
                        "À compléter : emplacements et plans d'implantation des caméras.", 'cctv'),
                  '13': chapterEquip(['pointage'], '13.1. Pointeuses', null, 'pointage'),
                  '14': ch14, '15': ch15, '15.1': ch151 };

  function buildAll(ws, layout, stylesXml, themeXml, only = null) {
    // Sélecteur de rubriques : racines de chapitres cochées (null = tout).
    // Feuilles « chapter » filtrées par racine (« 8 » garde 8, 8.1…8.5).
    const keepRoot = only ? (num => only.has(String(num).split('.')[0])) : () => true;
    // Sommaire (modale 📘) : index des chapitres + titres renommés
    BUILD_TOC = new Map();
    const tocNodes = [];
    (function walk(ns) {
      (ns || []).forEach(x => { BUILD_TOC.set(String(x.num), x); tocNodes.push(x); walk(x.subs); });
    })(normLldInfo(ws).toc);
    const isCustom = n => !!(n && n.custom);
    const numPrefix = /^\d+(?:\.\d+)?$/;
    const layoutKept = layout.filter(sheet =>
      numPrefix.test(String(sheet.name)) ? keepRoot(sheet.name) : true);
    const sheets = layoutKept.map(sheet => {
      const fill = FILLS[sheet.name];
      let s;
      if (fill) s = fill(sheet, ws);
      else {
        const built = fromLayout(sheet);
        s = out(sheet, built.rows, built.heights);
      }
      if (sheet.name === 'Contenu') {
        // Sommaire Excel : titres renommés (racines + sous-chapitres)…
        const re = /^(\d+(?:\.\d+)?)\.\s+/;
        s.rows.forEach(row => row.forEach(cell => {
          if (!cell || typeof cell.v !== 'string') return;
          const m = re.exec(cell.v);
          if (!m) return;
          const n = BUILD_TOC.get(m[1]);
          if (n && !isCustom(n) && !n.cover) cell.v = `${m[1]}. ${n.title}`;
        }));
        if (only) {
          // Sélecteur : retirer du sommaire les chapitres non exportés
          s.rows = s.rows.filter(row => {
            const first = row.find(cell => cell && typeof cell.v === 'string' && re.exec(cell.v));
            if (!first) return true;
            return keepRoot(re.exec(first.v)[1]);
          });
        }
        // … puis les chapitres/sous-chapitres ajoutés, en fin de liste
        tocNodes.filter(n => isCustom(n) && keepRoot(n.num)).forEach(n => {
          const isSub = String(n.num).includes('.');
          s.rows.push(isSub
            ? [{ v: '', s: 50 }, { v: `${n.num}. ${n.title}`, s: 47 }]
            : [{ v: `${n.num}. ${n.title}`, s: 50 }, { v: '', s: 50 }]);
        });
        return s;
      }
      // Titre renommé dans le sommaire -> remplacé en A1 (« 7. … »)
      const n = BUILD_TOC.get(String(sheet.name));
      if (n && !isCustom(n) && !n.cover) {
        const cell = s.rows[0] && s.rows[0][0];
        const re = new RegExp('^' + String(sheet.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\s');
        if (cell && re.test(String(cell.v || ''))) cell.v = `${sheet.name}. ${n.title}`;
      }
      return s;
    });
    // Chapitres / sous-chapitres AJOUTÉS au sommaire -> feuilles en plus
    const reserved = new Set(layout.map(x => String(x.name)));
    tocNodes.filter(n => isCustom(n) && keepRoot(n.num)).forEach(n => {
      let name = String(n.num).slice(0, 31);
      if (reserved.has(name)) name = (name + ' bis').slice(0, 31);
      reserved.add(name);
      sheets.push(customSheet(name, n, ws));
    });
    return XLSX.build(sheets, { stylesXml, themeXml });
  }

  return { buildAll };
})();

/* Miroir export : si la modale 📘 est ouverte, partir du brouillon (lldDraft)
   — diagrammes/captures doivent partir dans le XLSX/PDF même sans clic
   « Enregistrer » oublié. */
function lldWorkspaceForExport() {
  const ws = active();
  if (!ws) return null;
  if (!lldDraft) return ws;
  try { lldFlushDetail(); } catch (_) {}
  return Object.assign({}, ws, {
    lld: lldDraft.lld || ws.lld,
    sites: lldDraft.sites || ws.sites,
    flows: lldDraft.flows || ws.flows
  });
}

$('#export-xlsx').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = lldWorkspaceForExport();
  if (!ws || !ws.racks.length) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📊 Export Excel' }); return; }
  const only = await lldPickSections({
    title: '📗 Classeur Excel — que voulez-vous exporter ?',
    hint: 'Décochez les chapitres à exclure. Les pages de garde (LLD, Governance, Contenu) sont toujours incluses.',
    items: lldChapterPickItems(ws)
  });
  if (!only) return;
  if (!only.size) { lldAlert('Cochez au moins un chapitre à exporter.', { title: '📗 Classeur Excel' }); return; }
  try {
    const [layout, stylesXml, themeXml] = await Promise.all([
      fetch('assets/lld/layout.json').then(r => { if (!r.ok) throw new Error('layout'); return r.json(); }),
      fetch('assets/lld/styles.xml').then(r => { if (!r.ok) throw new Error('styles'); return r.text(); }),
      fetch('assets/lld/theme1.xml').then(r => { if (!r.ok) throw new Error('theme'); return r.text(); })
    ]);
    // Schéma ch.5/6/7 : rasterise en JPEG (sinon seuls des tableaux texte partent)
    if (typeof lldRenderDiagExportImgs === 'function') {
      try { await lldRenderDiagExportImgs(ws); } catch (_) { globalThis.__LLD_DIAG_IMGS = {}; }
    }
    downloadBlob(LLD_TPL.buildAll(ws, layout, stylesXml, themeXml, only), exportFileBase() + '.xlsx');
  } catch (e) {
    lldAlert("Impossible de charger le template Excel (assets/lld/) : l'export XLSX nécessite ces fichiers à côté de l'application.", { title: '📊 Export Excel' });
  }
});

/* ============================================================
   DOCUMENT LLD (PDF multi-pages)
   ------------------------------------------------------------
   Génère un dossier complet : page de garde + synthèse +
   tableaux (racks, inventaire, adressage, câblage) + élévations.
   Écriture PDF native (polices standard Helvetica, WinAnsi),
   sans dépendance — même approche que l'export Excel.
   ============================================================ */

const WINANSI_EXTRA = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E
};
function pdfEsc(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0);
    let b = null;
    if (cp >= 0x20 && cp <= 0x7E) b = cp;
    else if (cp >= 0xA0 && cp <= 0xFF) b = cp;
    else if (WINANSI_EXTRA[cp] !== undefined) b = WINANSI_EXTRA[cp];
    else if (cp === 0x2026) b = 0x85;
    if (b === null) continue;
    const c = String.fromCharCode(b);
    if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
    else out += c;
  }
  return out;
}
const strBytes = s => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF;
  return u;
};

function buildLldPdf(ws, planJpeg, planW, planH, topoJpeg, topoW, topoH, opts = {}) {
  const PW = 595.28, PH = 841.89, M = 42;
  const pagesOps = [];
  let cur = null, y = 0;
  // Sélecteur de rubriques : racines de chapitres à imprimer (null = tout).
  const onlyRoots = (opts.only && typeof opts.only.has === 'function')
    ? new Set([...opts.only].map(String)) : null;
  let SKIP = false;   // true tant qu'un chapitre non sélectionné est parcouru

  // Opérations PDF réutilisables (permettent d'ajouter des pieds de page a posteriori)
  const textOp = (x, yy, s, size = 10, bold = false, color = [0.13, 0.16, 0.22]) =>
    `BT ${color.map(c => (+c).toFixed(2)).join(' ')} rg /${bold ? 'F2' : 'F1'} ${(+size).toFixed(1)} Tf 1 0 0 1 ${(+x).toFixed(2)} ${(+yy).toFixed(2)} Tm (${pdfEsc(s)}) Tj ET`;
  const lineOp = (x1, yy, x2, color = [0.82, 0.85, 0.89], lw = 0.7) =>
    `${color.map(c => (+c).toFixed(2)).join(' ')} RG ${lw} w ${(+x1).toFixed(2)} ${(+yy).toFixed(2)} m ${(+x2).toFixed(2)} ${(+yy).toFixed(2)} l S`;

  const txt = (x, yy, s, size, bold, color) => { if (!SKIP) cur.push(textOp(x, yy, s, size, bold, color)); };
  const rectFill = (x, yy, w, h, color) => {
    if (SKIP) return;
    cur.push(`${color.map(c => (+c).toFixed(2)).join(' ')} rg ${(+x).toFixed(2)} ${(+yy).toFixed(2)} ${(+w).toFixed(2)} ${(+h).toFixed(2)} re f`);
  };
  const hline = (x1, x2, yy) => { if (!SKIP) cur.push(lineOp(x1, yy, x2)); };
  // Ligne libre (2 points) + contour de rectangle — diagrammes ch. 5/6/7
  const hexToRgb = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return [0.38, 0.65, 0.98];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const line2 = (x1, y1, x2, y2, color = [0.4, 0.6, 0.9], lw = 2) =>
    `${color.map(c => (+c).toFixed(2)).join(' ')} RG ${lw} w ${(+x1).toFixed(2)} ${(+y1).toFixed(2)} m ${(+x2).toFixed(2)} ${(+y2).toFixed(2)} l S`;
  const strokeRect = (x, yy, w, h, color = [0.4, 0.6, 0.9], lw = 1.2) =>
    `${color.map(c => (+c).toFixed(2)).join(' ')} RG ${lw} w ${(+x).toFixed(2)} ${(+yy).toFixed(2)} ${(+w).toFixed(2)} ${(+h).toFixed(2)} re S`;

  const newPage = () => { if (SKIP) return; cur = []; pagesOps.push(cur); y = PH - M; };

  // ---- Structure du dossier : sommaire piloté par L.toc (modale 📘) ----
  // Les titres renommés dans la modale remplacent les titres d'origine
  // (sommaire + en-têtes de chapitres) ; les contenus rattachés aux
  // nœuds (L.toc[].blocks) décident de ce qui est effectivement imprimé.
  const L = normLldInfo(ws);
  // Sélecteur de rubriques : seuls les chapitres racine cochés (+ la page de
  // garde et leurs sous-chapitres) sont imprimés.
  if (opts.only && typeof opts.only.has === 'function') {
    L.toc = L.toc.filter(n => n.cover || opts.only.has(String(n.num)));
  }
  const tocByNum = new Map();
  (function walkToc(ns) {
    (ns || []).forEach(n => {
      tocByNum.set(String(n.num), n);
      if (n.cover) tocByNum.set('cover', n);   // page de garde : num = 📄
      walkToc(n.subs);
    });
  })(L.toc);
  // true si l'info `key` est rattachée au nœud `num` dans le sommaire
  const hasB = (num, key) => {
    const n = tocByNum.get(String(num));
    return !!(n && Array.isArray(n.blocks) && n.blocks.includes(key));
  };
  // Captures d'écran rattachées à un chapitre (ch. 5/6/7 + blocs libres
  // cshots:… des chapitres ajoutés) → images JPEG dont le numéro d'objet
  // est fixé maintenant (dessin + assemblage PDF).
  const shotImgs = [];   // { ref: '/ImS0', key, bytes, w, h, name }
  const shotKeys = new Set();
  tocByNum.forEach(n => (n.blocks || []).forEach(k => {
    const d = lldInfoDef(k, L);
    if (d && d.kind === 'shots') shotKeys.add(k);
  }));
  shotKeys.forEach(k => {
    (L[k] || []).slice(0, 8).forEach(s => {
      if (!s || typeof s.dataUrl !== 'string' || !s.dataUrl.startsWith('data:image/')) return;
      let bytes = null;
      try { bytes = dataURLBytes(s.dataUrl); } catch (_) { return; }
      if (!bytes || bytes.length < 300) return;
      const ref = `/ImS${shotImgs.length}`;
      shotImgs.push({ ref, srcKey: k, bytes, w: s.w || 900, h: s.h || 600, name: s.name || '' });
    });
  });
  // Titre issu du sommaire — seuls les nœuds d'origine sont surchargés
  // (les nums dynamiques 8.x des zones ne collisionnent pas avec un
  // sous-chapitre personnalisé, le ch. 8 n'en accepte pas).
  const tocTitle = (label, fallback) => {
    const n = tocByNum.get(String(label));
    return n && !n.custom && !n.cover ? String(n.title || fallback) : fallback;
  };
  const tocEntries = [];   // {label, title, level, pageIdx} — pageIdx AVANT insertion du sommaire
  const GRAY = [0.45, 0.5, 0.58];
  function chapter(label, title, opts = {}) {
    // Rubrique décochée à l'export → chapitre entièrement masqué :
    // SKIP rend toutes les primitives de dessin inertes jusqu'au prochain
    // chapitre sélectionné.
    SKIP = !!(onlyRoots && !onlyRoots.has(String(label).split('.')[0]));
    if (SKIP) return;
    title = tocTitle(label, title);
    if (opts.flow) {          // chapitre compact : peut rester sur la page en cours
      if (y < M + 110) newPage(); else y -= 12;
    } else {
      newPage();
    }
    tocEntries.push({ label: String(label), title, level: 0, pageIdx: pagesOps.length - 1 });
    txt(M, y - 13, `${label}. ${title}`, 15, true, [0.12, 0.31, 0.47]);
    hline(M, PW - M, y - 21);
    y -= 33;
  }
  function sub(label, title) {
    title = tocTitle(label, title);
    if (y < M + 70) newPage();
    tocEntries.push({ label: String(label), title, level: 1, pageIdx: pagesOps.length - 1 });
    txt(M + 14, y - 10, `${label}. ${title}`, 12, true, [0.2, 0.35, 0.5]);
    y -= 26;
  }
  function miniTitle(s) {     // titre de bloc interne (n'apparaît pas au sommaire)
    if (y < M + 60) newPage(); else y -= 4;
    txt(M, y - 10, s, 11.5, true, [0.3, 0.4, 0.52]);
    y -= 22;
  }
  function note(s) {          // petite note grise sur une ligne
    if (y < M + 40) newPage();
    txt(M, y - 8, s, 9.5, false, GRAY);
    y -= 22;
  }
  function placeholder() { note('Section à compléter.'); }
  function paragraph(s, size = 10) {   // paragraphe multi-lignes (retours à la ligne conservés)
    const lh = 15;
    const maxChars = Math.max(24, Math.floor((PW - 2 * M) / (size * 0.52)));
    const lines = [];
    String(s || '').split('\n').forEach(raw => {
      if (!raw.trim()) { lines.push(''); return; }
      let line = '';
      for (const word of raw.trim().split(/\s+/)) {
        const test = line ? line + ' ' + word : word;
        if (test.length > maxChars) {
          if (line) lines.push(line);
          let w = word;
          while (w.length > maxChars) { lines.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
          line = w;
        } else line = test;
      }
      if (line) lines.push(line);
    });
    for (const l of lines) {
      if (y - lh < M + 26) newPage();
      if (l) txt(M, y - 8, l, size, false, [0.2, 0.24, 0.3]);
      y -= lh;
    }
    y -= 5;
  }

  // opts.cellColor(ri, ci, value) -> couleur du texte de la cellule
  // (utilisé pour colorer le statut de garantie : vert / rouge)
  function drawTable(rows, widths, size = 7.5, opts = {}) {
    const rowH = 14;
    const W = PW - 2 * M;
    const total = widths.reduce((a, b) => a + b, 0);
    const cw = widths.map(w => w / total * W);
    const drawHeader = () => {
      rectFill(M, y - rowH + 3.5, W, rowH, [0.12, 0.31, 0.47]);
      let x = M + 4;
      rows[0].forEach((h, i) => { txt(x, y - rowH + 3.5 + 4, String(h), size, true, [1, 1, 1]); x += cw[i]; });
      y -= rowH + 3.5;
    };
    drawHeader();
    for (let ri = 1; ri < rows.length; ri++) {
      if (y - rowH < M + 26) { newPage(); drawHeader(); }
      let x = M + 4;
      rows[ri].forEach((c, i) => {
        let s = String(c ?? '');
        const maxChars = Math.max(3, Math.floor(cw[i] / (size * 0.5)));
        if (s.length > maxChars) s = s.slice(0, Math.max(2, maxChars - 1)) + '\u2026';
        const col = opts.cellColor ? opts.cellColor(ri, i, c) : null;
        txt(x, y - rowH + 4.5, s, size, false, col || undefined);
        x += cw[i];
      });
      y -= rowH;
      hline(M, M + W, y + 3.5, [0.9, 0.92, 0.94]);
    }
    y -= 8;
  }

  // Largeurs de colonnes issues du schéma (px) — drawTable les normalise.
  const pdfColW = cols => cols.map(c => (typeof c[2] === 'number' && c[2]) || 140);

  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = new Date().toLocaleDateString('fr-FR');

  // ---- Sections « intégrées » : déjà dessinées par le code des chapitres
  // ci-dessous ; les autres blocs de `blocks` sont imprimés par extras ----
  const PDF_BUILTIN = {
    'cover': ['meta', 'governance'],
    '1': ['objectif'], '2.1': ['sites'], '2.2': ['existant'],
    '3': ['architecture'], '4': ['nomen', 'vlans'],
    '5.1': ['fais'], '6.1': ['ic61', 'icWan', 'icLan'],
    '7': ['note:firewall'], '8': ['zones', 'note:switching'],
    '9': ['note:server'], '10': ['note:storage'], '11': ['note:ids'],
    '12': ['note:cctv'], '13': ['note:pointage'], '14': ['flows']
  };

  // Imprime une information rattachée à un nœud du sommaire (synchrone
  // avec la modale : même stockage ws.lld.* que l'interface).
  function pdfDrawBlock(key) {
    if (SKIP) return;   // chapitre masqué par le sélecteur d'export
    const def = lldInfoDef(key, L);
    if (!def) return;
    miniTitle(def.label);
    if (def.kind === 'textarea') {
      const v = def.catKey ? String((L.catNotes || {})[def.catKey] || '') : String(L[key] || '');
      if (v.trim()) paragraph(v); else placeholder();
    } else if (def.kind === 'ch4matrix') {
      // Matrice ch. 4 : sous-tableaux éditables (VPN, alias, profils) — le reste
      // du tableau Excel est calqué sur devices/FAI/interco à la génération xlsx.
      const vpnRows = (L.vpns || []).filter(v => String(v.name || v.peer || '').trim());
      const aliasRows = (L.aliases || []).filter(a => String(a.name || a.value || '').trim());
      const fp = L.fwProfiles || {};
      const fpPairs = [
        ['Utilisateurs VPN SSL', fp.vpnSsl],
        ['Application Control', fp.appCtrl],
        ['WebBlocker', fp.webBlocker],
        ['HTTP Proxy', fp.httpProxy]
      ].filter(pr => String(pr[1] || '').trim());
      if (vpnRows.length) {
        drawTable([
          ['Nom du tunnel', 'Pair / subnet distant'],
          ...vpnRows.map(v => [String(v.name || ''), String(v.peer || '')])
        ], [2.2, 3.0], 7.5);
      }
      if (aliasRows.length) {
        drawTable([
          ['Nom de l\u2019alias', 'hosts / subnet definition'],
          ...aliasRows.map(a => [String(a.name || ''), String(a.value || '')])
        ], [1.8, 3.4], 7.5);
      }
      if (fpPairs.length) {
        drawTable([['Profil', 'Valeur'],
          ...fpPairs.map(pr => [String(pr[0]), String(pr[1])])], [2.2, 3.0], 7.5);
      }
      if (!vpnRows.length && !aliasRows.length && !fpPairs.length) placeholder();
    } else if (def.kind === 'diagram') {
      const mode = def.mode || 'fai';
      const d = (L.diagrams || {})[mode];
      if (!d || !(d.nodes || []).length) {
        placeholder();
        note("Généré depuis l'élévation dans la modale 📘 (bouton « 🔎 »).");
      } else {
        const byId = Object.fromEntries(d.nodes.map(n => [n.id, n]));
        let maxX = 700, maxY = 400;
        d.nodes.forEach(n => {
          maxX = Math.max(maxX, (n.x || 0) + (n.w || 150));
          maxY = Math.max(maxY, (n.y || 0) + (n.h || 56));
        });
        const availW = PW - 2 * M;
        const maxH = Math.min(y - M - 16, 360);
        const scale = Math.min(availW / (maxX + 8), maxH / (maxY + 8), 1.15);
        const ox = M, oyTop = y - 4;
        const X = x0 => ox + (x0 || 0) * scale;
        const Y = y0 => oyTop - (y0 || 0) * scale;
        (d.links || []).forEach(l => {
          const a = byId[l.a], b = byId[l.b];
          if (!a || !b) return;
          const x1 = X(a.x + (a.w || 150) / 2), y1 = Y(a.y + (a.h || 56) / 2);
          const x2 = X(b.x + (b.w || 150) / 2), y2 = Y(b.y + (b.h || 56) / 2);
          const col = hexToRgb(l.color || '#60a5fa');
          if (l.dashed) {
            const steps = 10;
            for (let i = 0; i < steps; i += 2) {
              const t0 = i / steps, t1 = Math.min(1, (i + 1) / steps);
              cur.push(line2(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0,
                x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, col, 1.6));
            }
          } else {
            cur.push(line2(x1, y1, x2, y2, col, 2));
          }
          if (l.label) {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 3;
            txt(mx - Math.min(48, String(l.label).length * 2.6), my,
              String(l.label).slice(0, 30), 7.5, true, col);
          }
        });
        d.nodes.forEach(n => {
          const w = (n.w || 150) * scale, h = (n.h || 56) * scale;
          const x0 = X(n.x), y0 = Y(n.y + (n.h || 56));  // bas de la boîte
          rectFill(x0, y0, w, h, [0.97, 0.98, 1.0]);
          const col = hexToRgb(lldDiagColors(n.kind));
          cur.push(strokeRect(x0, y0, w, h, col, 1.3));
          rectFill(x0, y0 + 3, 4, Math.max(4, h - 6), col);
          const fs = Math.max(7.5, Math.min(10, 9 * scale + 2));
          txt(x0 + 10, y0 + h - fs - 6, String(n.label || '').slice(0, 24), fs, true, [0.12, 0.16, 0.22]);
          if (n.sub) {
            txt(x0 + 10, y0 + 8, String(n.sub).slice(0, 32), Math.max(6.5, fs - 1.5), false, [0.4, 0.45, 0.52]);
          }
        });
        y = Y(maxY) - 10;
        if (y < M + 40) y = M + 40;
      }
    } else if (def.kind === 'shots') {
      const drawList = shotImgs.filter(s => s.srcKey === key);
      if (!drawList.length) {
        placeholder();
        note('Aucune capture (glisser-déposer dans la modale 📘).');
      } else {
        drawList.forEach(im => {
          if (y < M + 80) newPage();
          const availW = PW - 2 * M, availH = y - M - 36;
          const k = Math.min(availW / im.w, availH / im.h, 1.5);
          const iw = im.w * k, ih = im.h * k;
          const ix = M + (availW - iw) / 2, iy = y - ih;
          cur.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm ${im.ref} Do Q`);
          y = iy - 10;
        });
        if (y < M + 30) newPage();
      }
    } else if (def.kind === 'table') {
      const rows = L[key] || [];
      if (rows.length) {
        const cols = lldExportCols(L, key, def.cols);
        drawTable([cols.map(c => String(c[1])),
          ...rows.map(r => cols.map(c => String(r[c[0]] ?? '')))], pdfColW(cols), 7.5);
      } else placeholder();
    } else if (def.kind === 'fields') {
      const tgt = def.path ? (L[def.path] || {}) : L;
      const pairs = def.fields
        .filter(f => f.type !== 'textarea' && String(tgt[f.k] || '').trim())
        .map(f => [f.label, String(tgt[f.k])]);
      const noteF = def.fields.find(f => f.type === 'textarea');
      const noteV = noteF ? String(tgt[noteF.k] || '') : '';
      if (pairs.length) drawTable([['Élément', 'Valeur'], ...pairs], [1.9, 3.1], 8.5);
      else if (!noteV.trim()) placeholder();
      if (noteV.trim()) paragraph(noteV);
    } else if (def.kind === 'sites') {
      const sites = ws.sites || [];
      if (sites.length) {
        const scols = lldExportCols(L, 'sites', LLD_SITE_COLS);
        const sr = [scols.map(c => String(c[1]))];
        sites.forEach(s => sr.push(scols.map(c => String(s[c[0]] ?? ''))));
        drawTable(sr, pdfColW(scols), 8);
      } else placeholder();
    } else if (def.kind === 'zones') {
      const zs = L.swZones || [];
      if (zs.length) {
        const zcols = lldExportCols(L, 'zones', LLD_ZONE_COLS);
        drawTable([zcols.map(c => String(c[1])),
          ...zs.map(z => zcols.map(c => String(z[c[0]] ?? '')))], pdfColW(zcols), 8);
      } else placeholder();
    } else if (def.kind === 'fais') {
      const F = (L.fais && L.fais[0]) || L.fai || {};
      const fr2 = [['Opérateur', F.operator], ['Offre', F.offer], ['Type de lien', F.linkType],
                   ['Débit descendant', F.down], ['Débit montant', F.up],
                   ['Bloc IP publiques', F.publicBlock], ['CPE (modèle)', F.cpe], ['CPE (IP)', F.cpeIp]]
        .filter(([, v]) => v && String(v).trim());
      if (fr2.length) {
        drawTable([['Élément', 'Valeur'], ...fr2], [1.5, 3.5], 8.5);
        if (F.notes && F.notes.trim()) paragraph(F.notes);
      } else placeholder();
      if ((L.fais || []).length > 1)
        note(`${L.fais.length} FAI(s) déclaré(s) — détail complet dans le chapitre FAI.`);
    } else if (def.kind === 'flows') {
      const fr3 = flowsRows(ws);
      if (fr3.length > 1) {
        const fwW = [1.7, 2.3, 2.3, 1.6, 1.4, 2.7];
        drawTable(fr3, fr3[0].map((_, i) => fwW[i] ?? 1.6));
      } else placeholder();
    } else if (def.kind === 'governance') {
      if ((L.revs || []).length) {
        const rc = lldExportCols(L, 'revs', LLD_REV_COLS);
        const revRows = [rc.map(c => String(c[1]))];
        L.revs.forEach(r => revRows.push(rc.map(c => String(r[c[0]] ?? ''))));
        drawTable(revRows, pdfColW(rc), 8);
      }
      signatoryTable('Approbateurs', L.approvers, 'approvers');
      signatoryTable('Réviseurs', L.reviewers, 'reviewers');
    } else if (def.kind === 'meta') {
      const pairs = [['Client', L.client], ['Auteur', L.author], ['Version', L.version]]
        .filter(([, v]) => v && String(v).trim());
      if (pairs.length) drawTable([['Champ', 'Valeur'], ...pairs], [1.5, 3.5], 8.5);
      else placeholder();
    }
  }

  // Infos rattachées au nœud mais couvertes par les sections intégrées ?
  // non → imprimées en fin de nœud (permet aussi d'insérer une même info
  // dans plusieurs chapitres : elle est alors imprimée dans chacun).
  function drawNodeExtras(num) {
    const n = tocByNum.get(String(num));
    if (!n) return;
    const builtin = PDF_BUILTIN[String(num)] || [];
    for (const key of n.blocks || []) {
      if (builtin.includes(key)) continue;
      pdfDrawBlock(key);
    }
  }
  // Sous-chapitres ajoutés dans la modale sous `parentNum` (hors ch. 8 :
  // ses 8.x sont générés depuis les zones de Switching).
  function drawCustomSubs(parentNum) {
    const p = tocByNum.get(String(parentNum));
    if (!p) return;
    for (const s of p.subs || []) {
      if (!s.custom) continue;
      sub(s.num, s.title);
      const builtin = PDF_BUILTIN[s.num] || [];
      let any = false;
      for (const key of s.blocks || []) {
        if (builtin.includes(key)) continue;
        pdfDrawBlock(key);
        any = true;
      }
      if (!any && !(s.blocks || []).length) placeholder();
    }
  }
  // Fin d'un nœud du sommaire : extras + sous-chapitres personnalisés
  function endNode(num) { drawNodeExtras(num); drawCustomSubs(num); }

  // ---- Page de garde ----
  newPage();
  y -= 60;
  txt(M, y, 'Dossier LLD', 30, true, [0.12, 0.31, 0.47]); y -= 20;
  txt(M, y, 'Low Level Design \u2014 Datacenter & Infrastructure', 12, false, [0.45, 0.5, 0.58]); y -= 36;
  txt(M, y, ws.name, 20, true); y -= 30;
  if (hasB('cover', 'meta')) {
    const meta = [['Client', L.client], ['Auteur', L.author], ['Version', L.version], ['Date', dateStr]];
    meta.forEach(([k, v]) => {
      if (!v) return;
      txt(M, y, k, 10, false, [0.45, 0.5, 0.58]);
      txt(M + 100, y, v, 10, true);
      y -= 16;
    });
  }
  y -= 12;

  const totU = ws.racks.reduce((s, r) => s + r.sizeU, 0);
  const usedU = ws.racks.reduce((s, r) => s + r.instances.reduce((a, i) => a + i.sizeU, 0), 0);
  const totW = ws.racks.reduce((s, r) => s + r.instances.reduce((a, i) => a + (i.watts || 0), 0), 0);
  const totKg = ws.racks.reduce((s, r) => s + r.instances.reduce((a, i) => a + (i.weightKg || 0), 0), 0);
  const totPorts = ws.racks.reduce((s, r) => s + r.instances.reduce((a, i) => a + (i.ports || []).length, 0), 0);
  const stats = [
    ['Racks', String(ws.racks.length)],
    ['Devices pos\u00e9s', String(ws.racks.reduce((s, r) => s + r.instances.length, 0))],
    ['Ports \u00e9tiquet\u00e9s', String(totPorts)],
    ['C\u00e2bles', String((ws.cables || []).length)],
    ['Occupation', `${usedU}U / ${totU}U`],
    ['Puissance estim\u00e9e', fmtWatts(totW)],
    ['Poids estim\u00e9', `${Math.round(totKg)} kg`],
    ['Liens logiques', String((ws.topology?.links || []).length)]
  ];
  // Garanties : équipements hors de garantie + échéances proches (< 90 j)
  const wsm = warrantySummary(ws);
  if (wsm.known) stats.push(['Garanties renseignées', `${wsm.in} en garantie / ${wsm.out} hors garantie`]);
  if (wsm.soon) stats.push([`Échéances < ${WARRANTY_SOON_DAYS} j`, String(wsm.soon)]);
  stats.forEach(([k, v]) => {
    txt(M, y, k, 10, false, [0.45, 0.5, 0.58]);
    txt(M + 160, y, v, 10, true);
    y -= 17;
  });

  if (L.revs.length && hasB('cover', 'governance')) {
    y -= 16;
    txt(M, y, 'Historique des r\u00e9visions', 12, true, [0.12, 0.31, 0.47]); y -= 8;
    const rc0 = lldExportCols(L, 'revs', LLD_REV_COLS);
    const revRows = [rc0.map(c => String(c[1]))];
    L.revs.forEach(r => revRows.push(rc0.map(c => String(r[c[0]] ?? ''))));
    drawTable(revRows, pdfColW(rc0), 8);
  }

  // Gouvernance documentaire, placée après l'historique des révisions.
  const signatoryTable = (title, rows, tableId) => {
    if (y < M + 55) newPage();
    txt(M, y, title, 11.5, true, [0.12, 0.31, 0.47]);
    y -= 8;
    const sc = lldExportCols(L, tableId, LLD_SIGNATORY_COLS);
    const data = [sc.map(c => String(c[1]))];
    rows.forEach(r => data.push(sc.map(c => String(r[c[0]] ?? ''))));
    drawTable(data, pdfColW(sc), 7.5);
  };
  if (hasB('cover', 'governance')) {
    signatoryTable('Approbateurs', L.approvers, 'approvers');
    signatoryTable('Réviseurs', L.reviewers, 'reviewers');
  }
  // Infos supplémentaires éventuellement rattachées à la page de garde
  drawNodeExtras('cover');

  y = Math.min(y, M + 24);
  txt(M, y, 'G\u00e9n\u00e9r\u00e9 par LLDraw', 9, false, [0.6, 0.65, 0.72]);

  // ================= Chapitres (structure cible : 15 chapitres) =================

  // ---- 1. Objectif du document ----
  chapter('1', 'Objectif du document');
  if (hasB('1', 'objectif')) {
    if (L.objectif.trim()) paragraph(L.objectif);
    else placeholder();
  }
  endNode('1');

  // ---- 2. Aperçu du site ----
  chapter('2', 'Aperçu du site');
  sub('2.1', 'Information sur le site');
  const sites = ws.sites || [];
  if (hasB('2.1', 'sites')) {
    if (sites.length) {
      const sc = lldExportCols(L, 'sites', LLD_SITE_COLS);
      const sr = [sc.map(c => String(c[1]))];
      sites.forEach(s => sr.push(sc.map(c => String(s[c[0]] ?? ''))));
      drawTable(sr, pdfColW(sc), 8);
    } else {
      note('Aucun site d\u00e9clar\u00e9 (info « Sites » du sommaire).');
    }
  }
  miniTitle('Racks par site');
  const rks = sortedRacks(ws);
  if (rks.length) {
    const rr = [['Site', 'Rack', 'Taille', 'U occup\u00e9s', 'U libres', 'Devices', 'Puissance (W)', 'Poids (kg)']];
    [...rks].sort((a, b) =>
      (siteName(ws, a) || '\uFFFF').localeCompare(siteName(ws, b) || '\uFFFF', 'fr') ||
      a.name.localeCompare(b.name, 'fr', { numeric: true })
    ).forEach(r => {
      const usedU = r.instances.reduce((s, i) => s + i.sizeU, 0);
      rr.push([
        siteName(ws, r) || '\u2014', r.name, r.sizeU + 'U', usedU, r.sizeU - usedU,
        r.instances.length,
        r.instances.reduce((s, i) => s + (i.watts || 0), 0) || '',
        Math.round(r.instances.reduce((s, i) => s + (i.weightKg || 0), 0)) || ''
      ]);
    });
    drawTable(rr, [1.4, 2.2, 0.9, 1, 0.9, 1, 1.4, 1.2], 8);
  } else {
    note('Aucun rack dans ce workspace.');
  }
  endNode('2.1');
  sub('2.2', 'L\u2019infrastructure existante');
  if (hasB('2.2', 'existant')) {
    if (L.existant.trim()) paragraph(L.existant);
    else placeholder();
  }
  endNode('2.2');
  endNode('2');

  // ---- 3. Architecture cible ----
  chapter('3', 'Architecture cible');
  if (hasB('3', 'architecture')) {
    if (L.architecture.trim()) paragraph(L.architecture);
    else placeholder();
  }
  sub('3.1', 'Équipements');
  miniTitle('Récapitulatif par catégorie');
  const csr = catSummaryRows(ws);
  if (csr.length > 1) drawTable(csr, [2.3, 0.5, 3.3, 2.1, 0.9], 8);
  else note('Aucun équipement placé dans les racks de ce workspace.');
  miniTitle('Inventaire détaillé');
  const ir = invRows(ws);
  if (ir.length > 1) {
    drawTable(ir, [1.15, 0.75, 0.5, 0.45, 1.4, 0.95, 1.0, 1.25, 1.05, 0.95,
                   0.8, 0.65, 0.55, 0.55, 0.9, 0.8, 1.7, 0.4], 7.5,
              { cellColor: (ri, ci, val) => pdfWarrantyCellColor(ci, 16, val) });
  } else note('Aucun équipement placé dans les racks de ce workspace.');
  miniTitle('Suivi des garanties');
  {
    const wsm = warrantySummary(ws);
    const wr = warrantyRows(ws);
    if (wr.length > 1) {
      // Bilan chiffré : équipements en garantie / hors de garantie
      paragraph(`Sur ${wsm.known} équipement${wsm.known > 1 ? 's' : ''} dont la garantie est renseignée : `
        + `${wsm.in} en garantie et ${wsm.out} hors de garantie.`
        + (wsm.soon ? ` ${wsm.soon} garantie${wsm.soon > 1 ? 's arrivent' : ' arrive'} à échéance sous ${WARRANTY_SOON_DAYS} jours.` : '')
        + (wsm.without ? ` ${wsm.without} équipement${wsm.without > 1 ? 's' : ''} sans date de garantie.` : ''));
      // Statut coloré comme dans l'application : vert en garantie, rouge hors garantie
      drawTable(wr, [1.0, 0.75, 0.5, 1.45, 1.1, 1.5, 0.85, 1.0, 0.7], 8,
                { cellColor: (ri, ci, val) => pdfWarrantyCellColor(ci, 7, val) });
      note('Légende : statut « En garantie » écrit en vert, « Hors garantie » en rouge '
         + '(comme la pastille de garantie affichée sur chaque équipement de l\u2019application).');
    } else {
      note("Aucune garantie renseignée : la fin de garantie et le contrat se saisissent device par device (fiche de survol, double-clic sur « Fin de garantie »).");
    }
  }
  endNode('3.1');
  endNode('3');

  // ---- 4. Conception Nomenclature et Adressage IP Global ----
  chapter('4', 'Conception Nomenclature et Adressage IP Global');
  if (hasB('4', 'nomen')) {
    miniTitle('Nomenclature');
    if (L.nomen.length) {
      const nc = lldExportCols(L, 'nomen', LLD_NOMEN_COLS);
      const nr = [nc.map(c => String(c[1]))];
      L.nomen.forEach(r => nr.push(nc.map(c => String(r[c[0]] ?? ''))));
      drawTable(nr, pdfColW(nc), 8);
    } else note('Nomenclature non renseignée (info « Nomenclature » du sommaire).');
  }
  if (hasB('4', 'vlans')) {
    miniTitle('Registre VLANs & subnets');
    if (L.vlans.length) {
      const vc = lldExportCols(L, 'vlans', LLD_VLAN_COLS);
      const vr = [vc.map(c => String(c[1]))];
      L.vlans.forEach(v => vr.push(vc.map(c => String(v[c[0]] ?? ''))));
      drawTable(vr, pdfColW(vc), 8);
    } else note('Aucun VLAN enregistré (info « Adressage IP global » du sommaire).');
  }
  miniTitle('Plan d\u2019adressage & ports');
  const pr = portsRows(ws);
  if (pr.length > 1) drawTable(pr, [1.4, 0.9, 0.8, 1.8, 1.4, 1.6, 1.6, 0.9, 1.2]);
  else note('Aucun port étiqueté.');
  endNode('4');

  // ---- 5. Conception et Configuration FAI ----
  chapter('5', 'Conception et Configuration FAI', { flow: true });
  drawNodeExtras('5');          // diagramme + captures AVANT 5.1
  sub('5.1', 'Informations & Configuration');
  if (hasB('5.1', 'fais')) {
    const rows51 = (L.fais || []).filter(f =>
      f && Object.values(f).some(v => String(v ?? '').trim()));
    if (rows51.length) {
      const hdr = LLD_FAI51_COLS.map(c => String(c[1]));
      drawTable([
        hdr,
        ...rows51.map(f => LLD_FAI51_COLS.map(c => String(f[c[0]] ?? '')))
      ], pdfColW(LLD_FAI51_COLS), 6.5);
    } else placeholder();
  }
  endNode('5.1');
  sub('5.2', 'Câblage');
  const cabTable5 = (Array.isArray(L.faiCab) && L.faiCab.length)
    ? L.faiCab.filter(r => r && ((r.desc || '').trim() || (r.conn || '').trim()))
    : [];
  if (cabTable5.length) {
    drawTable([
      ['Categorie', 'Description', 'Connecté a'],
      ...cabTable5.map(r => [String(r.cat || 'FAI'), String(r.desc || ''), String(r.conn || '')])
    ], [1.0, 2.2, 2.4], 8);
  } else {
    const cabFai = cablingRowsByDomain(ws, 'fai');
    if (cabFai.length > 1) drawTable(cabFai, [1.3, 1.1, 1.5, 1.8, 1.5, 1.7, 1.5, 1.8, 1.5, 1.7]);
    else note('Aucun câble classé « FAI » (mode Câblage : domaine du câble).');
  }
  endNode('5.2');
  drawCustomSubs('5');          // extras déjà imprimés avant 5.1

  // ---- 6. Conception et Configuration Interconnexion site 2 site ----
  chapter('6', 'Conception et Configuration Interconnexion site 2 site', { flow: true });
  drawNodeExtras('6');          // diagramme + captures AVANT 6.1
  sub('6.1', 'Informations & Configuration');
  if (hasB('6.1', 'ic61')) {
    const rowsIc = (L.ic61 || []).filter(r =>
      r && Object.values(r).some(v => String(v ?? '').trim()));
    if (rowsIc.length) {
      drawTable([
        LLD_IC61_COLS.map(c => String(c[1])),
        ...rowsIc.map(r => LLD_IC61_COLS.map(c => String(r[c[0]] ?? '')))
      ], pdfColW(LLD_IC61_COLS), 6.5);
    } else placeholder();
  }
  // Fiche interco retirée du sommaire (demande) : le PDF imprime quand même
  // les paramètres si des valeurs existent dans L.interco (source interne).
  {
    const I = L.interco || {};
    const icr = [['Technologie', I.tech], ['Endpoint public site A', I.epA], ['Endpoint public site B', I.epB],
                 ['Subnets locaux (A)', I.localSubnets], ['Subnets distants (B)', I.remoteSubnets],
                 ['Routage', I.routing], ['Chiffrement', I.encryption]]
      .filter(([, v]) => v && String(v).trim());
    if (icr.length) {
      miniTitle('Paramètres d’interconnexion');
      drawTable([['Élément', 'Valeur'], ...icr], [1.9, 3.1], 8.5);
      if (I.notes && I.notes.trim()) { miniTitle('Notes de configuration'); paragraph(I.notes); }
    }
  }
  if (hasB('6.1', 'icWan')) {
    const rowsW = (L.icWan || []).filter(r =>
      r && Object.values(r).some(v => String(v ?? '').trim()));
    if (rowsW.length) {
      miniTitle('WAN Connection Settings');
      // Colonnes principales (largeur PDF) — mêmes en-têtes que l’Excel / sommaire
      const wc = ['name', 'enable', 'connMethod', 'routingMode', 'ip', 'mask',
                  'gw', 'dns', 'up', 'down', 'provider'];
      const hdr = LLD_IC_WAN_COLS.filter(c => wc.includes(c[0]));
      drawTable([
        hdr.map(c => String(c[1])),
        ...rowsW.map(r => hdr.map(c => String(r[c[0]] ?? '')))
      ], hdr.map(c => c[2] || 90), 6.5);
    } else placeholder();
  }
  if (hasB('6.1', 'icLan')) {
    const rowsL = (L.icLan || []).filter(r =>
      r && Object.values(r).some(v => String(v ?? '').trim()));
    if (rowsL.length) {
      miniTitle('LAN / Network settings');
      drawTable([
        LLD_IC_LAN_COLS.map(c => String(c[1])),
        ...rowsL.map(r => LLD_IC_LAN_COLS.map(c => String(r[c[0]] ?? '')))
      ], [1.6, 1.6, 1.8], 8);
    } else placeholder();
  }
  endNode('6.1');   // extras : comptes Admin Security (et toute info ajoutée)
  sub('6.2', 'Câblage');
  const icCabRows = (Array.isArray(L.icCab) && L.icCab.length)
    ? L.icCab.filter(r => r && ((r.desc || '').trim() || (r.port || '').trim() || (r.conn || '').trim()))
    : [];
  if (icCabRows.length) {
    drawTable([
      ['Categorie', 'Description', 'Port', 'Connecté a'],
      ...icCabRows.map(r => [
        String(r.cat || 'Interconnexion S2S'), String(r.desc || ''),
        String(r.port || ''), String(r.conn || '')
      ])
    ], [1.2, 1.6, 0.9, 2.0], 8);
  } else {
    const cabIc = cablingRowsByDomain(ws, 'interco');
    if (cabIc.length > 1) drawTable(cabIc, [1.3, 1.1, 1.5, 1.8, 1.5, 1.7, 1.5, 1.8, 1.5, 1.7]);
    else note('Aucun câble classé « Interconnexion » (mode Câblage : domaine du câble).');
  }
  endNode('6.2');
  drawCustomSubs('6');

  // ---- 7 à 13 : chapitres par domaine (générés depuis les catégories) ----
  const CAT_CHAPTERS = [
    ['7',  'Conception et Configuration Firewall',        ['firewall'],          'firewall'],
    ['8',  'Conception et Configuration Switching',       ['switch', 'ap'],      'switching'],
    ['9',  'Conception et Configuration Serveurs',        ['server'],            'server'],
    ['10', 'Conception et Configuration Stockage',        ['storage'],           'storage'],
    ['11', 'Conception et Configuration Intrusion (IDS)', ['ids'],               'ids'],
    ['12', 'Conception et Configuration CCTV',            ['cctv'],              'cctv'],
    ['13', 'Conception et Configuration Pointage (SPO)',  ['pointage'],          'pointage']
  ];
  for (const [num, title, cats, dom] of CAT_CHAPTERS) {
    chapter(num, title, { flow: true });
    // ch. 7 : diagramme + captures avant les tableaux du domaine
    if (num === '7') drawNodeExtras('7');
    const notes = L.catNotes[dom] || '';
    if (hasB(num, `note:${dom}`) && notes.trim()) {
      miniTitle('Notes de configuration'); paragraph(notes);
    }
    if (dom === 'switching' && hasB(num, 'zones') && (L.swZones || []).length) {
      // Sous-chapitres par zone de switching (8.1, 8.2… dans l'ordre des zones)
      let zi = 0;
      for (const z of L.swZones) {
        zi++;
        sub(`${num}.${zi}`, `Switching (${z.name})`);
        const zr = catEquipRows(ws, cats, z.id);
        if (zr.length > 1) drawTable(zr, CAT_EQUIP_WIDTHS, 7.5, { cellColor: (ri, ci, val) => pdfWarrantyCellColor(ci, 9, val) });
        else note('Aucun équipement dans cette zone.');
      }
      const unz = catEquipRows(ws, cats, '');
      if (unz.length > 1) {
        zi++;
        sub(`${num}.${zi}`, 'Switching (hors zone)');
        drawTable(unz, CAT_EQUIP_WIDTHS, 7.5, { cellColor: (ri, ci, val) => pdfWarrantyCellColor(ci, 9, val) });
      }
    } else {
      miniTitle('Équipements');
      const er = catEquipRows(ws, cats);
      if (er.length > 1) drawTable(er, CAT_EQUIP_WIDTHS, 7.5, { cellColor: (ri, ci, val) => pdfWarrantyCellColor(ci, 9, val) });
      else note('Aucun équipement de cette catégorie dans ce workspace.');
    }
    miniTitle('Ports & adressage');
    const por = portsRowsByCat(ws, cats);
    if (por.length > 1) drawTable(por, [1.4, 0.9, 0.8, 1.8, 1.4, 1.6, 1.6, 0.9]);
    else note('Aucun port étiqueté sur ces équipements.');
    miniTitle('Câblage');
    const cabD = cablingRowsByDomain(ws, dom);
    if (cabD.length > 1) drawTable(cabD, [1.3, 1.1, 1.5, 1.8, 1.5, 1.7, 1.5, 1.8, 1.5, 1.7]);
    else note('Aucun câble classé dans ce domaine (mode Câblage : domaine du câble).');
    // Extras du sommaire : VMs (9), volumes (10), caméras (12), Admin (6.1)…
    // + sous-chapitres personnalisés. Pour le ch. 7, extras déjà imprimés
    // en tête (diagramme/captures) → ne garder que les sous-chapitres.
    if (num === '7') drawCustomSubs('7');
    else endNode(num);
  }

  // ---- 14. Flux réseau et diagram ----
  chapter('14', 'Flux réseau et diagram');
  if (hasB('14', 'flows')) {
    miniTitle('Matrice des flux');
    const fr = flowsRows(ws);
    if (fr.length > 1) {
      const fwW = [1.7, 2.3, 2.3, 1.6, 1.4, 2.7];
      drawTable(fr, fr[0].map((_, i) => fwW[i] ?? 1.6));
    } else note('Aucun flux défini (info « Matrice des flux » du sommaire).');
  }
  miniTitle('Diagramme de topologie');
  if (!SKIP && topoJpeg && topoW && topoH) {
    const availW = PW - 2 * M, availH = y - M - 10;
    const k = Math.min(availW / topoW, availH / topoH);
    const iw = topoW * k, ih = topoH * k;
    const ix = M + (availW - iw) / 2, iy = y - ih;
    cur.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im1 Do Q`);
  } else {
    note('Diagramme de topologie non généré (vue Topologie du workspace).');
  }
  endNode('14');

  // ---- 15. Câblage / Rack ----
  chapter('15', 'C\u00e2blage / Rack');
  miniTitle('Synthèse des racks (capacités)');
  drawTable(racksRows(ws), [2.4, 1.1, 0.9, 1, 0.9, 1.5, 1.5, 1.4, 1.4, 1]);
  miniTitle('Tableau de c\u00e2blage');
  const cr = cablingRows(ws);
  if (cr.length > 1) drawTable(cr, [1.1, 0.8, 1.15, 1.3, 1.55, 1.3, 1.5, 1.3, 1.55, 1.3, 1.5]);
  else note('Aucun câble.');
  endNode('15');
  if (!SKIP && planJpeg && planW && planH) {
    newPage();
    miniTitle('\u00c9l\u00e9vations des racks');
    const availW = PW - 2 * M, availH = y - M - 10;
    const k = Math.min(availW / planW, availH / planH);
    const iw = planW * k, ih = planH * k;
    const ix = M + (availW - iw) / 2, iy = y - ih;
    cur.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q`);
  }
  // ---- Chapitres ajoutés au sommaire (personnalisés, dans l'ordre) ----
  for (const n of L.toc) {
    if (!n.custom) continue;
    chapter(n.num, n.title);   // newPage garanti : pas de recouvrement
    if ((n.blocks || []).length) n.blocks.forEach(k => pdfDrawBlock(k));
    else placeholder();
    drawCustomSubs(n.num);
  }

  // Toute fin du dossier : détail du câblage pour chaque device posé
  // (rattaché au chapitre 15 « Câblage / Rack » du sélecteur d'export).
  SKIP = false;
  const placedDevices = sortedRackInstances(ws);
  if (placedDevices.length && (!onlyRoots || onlyRoots.has('15'))) {
    newPage();
    txt(M, y - 13, 'Détail des connexions par device', 15, true, [0.12, 0.31, 0.47]);
    hline(M, PW - M, y - 21);
    y -= 33;
    placedDevices.forEach(({ rack, inst }) => {
      miniTitle(`${inst.name} — ${rack.name}${siteName(ws, rack) ? ` — ${siteName(ws, rack)}` : ''}`);
      const rows = [['Câble', 'Port local', 'Origine', 'Destination', 'Domaine']];
      (ws.cables || []).forEach(c => {
        const isA = c.a?.instId === inst.id;
        const isB = c.b?.instId === inst.id;
        if (!isA && !isB) return;
        const ea = resolveEndpoint(ws, c.a);
        const eb = resolveEndpoint(ws, c.b);
        if (!ea || !eb) return;
        const endpointText = e => `${e.inst.name} / ${e.port.name} (${e.rack.name})`;
        rows.push([
          c.name || '',
          isA ? ea.port.name : eb.port.name,
          endpointText(ea),
          endpointText(eb),
          cableDomainLabel(c.domain)
        ]);
      });
      if (rows.length > 1) drawTable(rows, [1.2, 1.4, 2.8, 2.8, 1.5], 7.5);
      else note('Aucun câble branché sur ce device.');
    });
  }

  // ================= Sommaire (inséré en page 2, après la garde) =================
  // Une page construite à l'index i avant insertion se retrouve en page i + 2
  // (page de garde = 1, sommaire = 2, première page de contenu = 3).
  const tocOps = [];
  let ty = PH - M - 30;
  tocOps.push(textOp(M, ty, 'Sommaire', 22, true, [0.12, 0.31, 0.47]));
  ty -= 12;
  tocOps.push(lineOp(M, PW - M, ty, [0.82, 0.85, 0.89], 1));
  ty -= 28;
  for (const e of tocEntries) {
    const pageNum = e.pageIdx + 2;
    const x = e.level ? M + 16 : M;
    const size = e.level ? 9.5 : 10.5;
    tocOps.push(textOp(x, ty, `${e.label}. ${e.title}`, size, !e.level,
      e.level ? [0.35, 0.4, 0.48] : [0.13, 0.16, 0.22]));
    tocOps.push(textOp(PW - M - 20, ty, String(pageNum), size, !e.level, [0.35, 0.4, 0.48]));
    ty -= e.level ? 14.5 : 18.5;
  }
  pagesOps.splice(1, 0, tocOps);

  // ---- Pieds de page (toutes les pages sauf la garde) ----
  const nPages = pagesOps.length;
  const footerName = String(ws.name).slice(0, 60);
  pagesOps.forEach((ops, i) => {
    if (i === 0) return;
    ops.push(lineOp(M, 34, PW - M, [0.85, 0.87, 0.9], 0.6));
    ops.push(textOp(M, 22, `${footerName} \u2014 Dossier LLD`, 8, false, [0.55, 0.58, 0.64]));
    ops.push(textOp(PW - M - 60, 22, `Page ${i + 1} / ${nPages}`, 8, false, [0.55, 0.58, 0.64]));
    ops.push(textOp(PW / 2 - 22, 22, dateShort, 8, false, [0.55, 0.58, 0.64]));
  });

  // ================= Assemblage du fichier PDF =================
  const strBytes = s => {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF;
    return u;
  };

  const parts = [];
  let offset = 0;
  const push = data => {
    const u = typeof data === 'string' ? strBytes(data) : data;
    parts.push(u);
    offset += u.length;
  };
  const offsets = [];
  const addObj = body => {
    offsets.push(offset);
    push(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');

  const hasPlan = !!(planJpeg && planW && planH);
  const hasTopo = !!(topoJpeg && topoW && topoH);
  const firstPageObj = 5;
  const contentObjs = [];
  pagesOps.forEach((_, i) => contentObjs.push(firstPageObj + nPages + i));
  const img0Num = firstPageObj + 2 * nPages;          // élévations
  const img1Num = img0Num + 1;                        // topologie
  const shotNum0 = img1Num + 1;                       // captures ch. 5/6/7…
  // Numéros d'objets des captures (ordre de shotImgs)
  shotImgs.forEach((im, i) => { im.num = shotNum0 + i; });

  addObj(`<< /Type /Catalog /Pages 2 0 R >>`);
  const kids = pagesOps.map((_, i) => `${firstPageObj + i} 0 R`).join(' ');
  addObj(`<< /Type /Pages /Count ${nPages} /Kids [${kids}] >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  pagesOps.forEach((ops, i) => {
    // Une seule entrée /XObject par image (double clé = image invisible chez
    // certains lecteurs) — plan, topo puis captures éventuelles.
    const xobjs = [];
    if (hasPlan) xobjs.push(`/Im0 ${img0Num} 0 R`);
    if (hasTopo) xobjs.push(`/Im1 ${img1Num} 0 R`);
    shotImgs.forEach(im => xobjs.push(`${im.ref} ${im.num} 0 R`));
    let res = `<< /Font << /F1 3 0 R /F2 4 0 R >>`;
    if (xobjs.length) res += ` /XObject << ${xobjs.join(' ')} >>`;
    res += ` >>`;
    addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${res} /Contents ${contentObjs[i]} 0 R >>`);
  });
  pagesOps.forEach(ops => {
    const body = ops.join('\n');
    addObj(`<< /Length ${strBytes(body).length} >>\nstream\n${body}\nendstream`);
  });
  const addImage = (num, bytes, w, h) => {
    offsets.push(offset); // re-numérotation : voir ci-dessous
    push(`${num} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    push(bytes);
    push(`\nendstream\nendobj\n`);
  };
  if (hasPlan) addImage(img0Num, planJpeg, planW, planH);
  if (hasTopo) addImage(img1Num, topoJpeg, topoW, topoH);
  shotImgs.forEach(im => addImage(im.num, im.bytes, im.w, im.h));

  const xrefPos = offset;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const total = parts.reduce((s, u) => s + u.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const u of parts) { out.set(u, p); p += u.length; }
  return out;
}

// Rubriques = chapitres racine du sommaire 📘 (page de garde toujours incluse)
function lldChapterPickItems(ws) {
  return normLldInfo(ws).toc.filter(n => !n.cover)
    .map(n => [String(n.num), `${n.num}. ${n.title}`]);
}

$('#export-lld').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = lldWorkspaceForExport();
  if (!ws || !ws.racks.length) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📄 Export LLD (PDF)' }); return; }
  const only = await lldPickSections({
    title: '📕 Document LLD (PDF) — que voulez-vous exporter ?',
    hint: 'Décochez les chapitres à exclure. La page de garde et le sommaire sont toujours inclus.',
    items: lldChapterPickItems(ws)
  });
  if (!only) return;
  if (!only.size) { lldAlert('Cochez au moins un chapitre à exporter.', { title: '📕 Document LLD (PDF)' }); return; }
  const c = await renderPlanCanvas();
  let jpeg = null, w = 0, h = 0;
  if (c) {
    jpeg = dataURLBytes(c.toDataURL('image/jpeg', 0.85));
    w = c.width; h = c.height;
  }
  const tc = renderTopoCanvas();
  let tj = null, tw = 0, th = 0;
  if (tc) {
    tj = dataURLBytes(tc.toDataURL('image/jpeg', 0.9));
    tw = tc.width; th = tc.height;
  }
  const u8 = buildLldPdf(ws, jpeg, w, h, tj, tw, th, { only });
  downloadBlob(new Blob([u8], { type: 'application/pdf' }), exportFileBase() + '-LLD.pdf');
});


function dataURLBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// PDF minimal : une page contenant une image JPEG plein format
function canvasToPdfBlob(w, h, jpegBytes) {
  const W = w, H = h;
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = b => { chunks.push(b); pos += b.length; };
  const s = str => push(enc.encode(str));

  s('%PDF-1.4\n');
  offsets[1] = pos;
  s('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  offsets[2] = pos;
  s('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
  offsets[3] = pos;
  s(`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im1 4 0 R>>>>/Contents 5 0 R>>endobj\n`);
  offsets[4] = pos;
  s(`4 0 obj<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpegBytes.length}>>stream\n`);
  push(jpegBytes);
  s('\nendstream\nendobj\n');
  offsets[5] = pos;
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q\n`;
  s(`5 0 obj<</Length ${content.length}>>stream\n${content}endstream\nendobj\n`);
  const xrefStart = pos;
  s(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) {
    s(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  }
  s(`trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

/* ============================================================
   RECHERCHE GLOBALE (device / port / étiquette), tous workspaces
   ============================================================ */

const searchInput = $('#global-search');
const searchResults = $('#search-results');

function doSearch(query) {
  const q = query.trim().toLowerCase();
  const results = [];
  if (!q) return results;

  for (const ws of state.workspaces) {
    for (const rack of ws.racks) {
      for (const inst of rack.instances) {
        // Device (nom)
        if (inst.name.toLowerCase().includes(q)) {
          results.push({
            type: 'device', ws, rack, inst,
            label: inst.name,
            path: `${rack.name} · ${ws.name}`
          });
        }
        // Ports (nom + étiquette)
        (inst.ports || []).forEach(port => {
          if ((port.name || '').toLowerCase().includes(q) ||
              (port.label || '').toLowerCase().includes(q)) {
            results.push({
              type: 'port', ws, rack, inst, port,
              label: `${port.name}${port.label ? ' — ' + port.label : ''}`,
              path: `${inst.name} · ${rack.name} · ${ws.name}`
            });
          }
        });
      }
    }
    // Sites (nom, adresse, contacts, description)
    (ws.sites || []).forEach(site => {
      const hay = [site.name, site.address, site.contact, site.desc]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) {
        results.push({
          type: 'site', ws, site,
          label: site.name,
          path: `Site · ${ws.name}`
        });
      }
    });
    // Flux réseau (nom, source, destination, protocole, usage)
    (ws.flows || []).forEach(flow => {
      const hay = [flow.name, flow.src, flow.dst, flow.proto, flow.usage]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) {
        results.push({
          type: 'flow', ws, flow,
          label: flow.name || flow.src || 'Flux',
          path: `${flow.src || '?'} → ${flow.dst || '?'} · ${ws.name}`
        });
      }
    });
  }
  return results.slice(0, 30);
}

function renderSearchResults(results, query) {
  searchResults.innerHTML = '';
  if (!results.length) {
    searchResults.innerHTML = `<div class="sr-empty">Aucun résultat pour « ${escapeHtml(query)} »</div>`;
    searchResults.classList.remove('hidden');
    return;
  }
  results.forEach(r => {
    const item = document.createElement('button');
    item.className = 'sr-item';
    const SR_TYPES = { device: 'Device', port: 'Port', site: 'Site', flow: 'Flux' };
    item.innerHTML = `
      <span class="sr-type ${r.type}">${SR_TYPES[r.type] || '?'}</span>
      <span class="sr-body">
        <span class="sr-name"></span>
        <span class="sr-path"></span>
      </span>`;
    item.querySelector('.sr-name').textContent = r.label;
    item.querySelector('.sr-path').textContent = r.path;
    item.addEventListener('click', () => {
      searchResults.classList.add('hidden');
      searchInput.value = r.label.split(' — ')[0];
      focusOnResult(r);
    });
    searchResults.appendChild(item);
  });
  searchResults.classList.remove('hidden');
}

searchInput.addEventListener('input', e => {
  const q = e.target.value;
  if (!q.trim()) { searchResults.classList.add('hidden'); return; }
  renderSearchResults(doSearch(q), q);
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) renderSearchResults(doSearch(searchInput.value), searchInput.value);
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.search-box')) searchResults.classList.add('hidden');
});

// Centre la vue sur un rack et fait clignoter le résultat
function focusOnResult(r) {
  if (r.type === 'site' || r.type === 'flow') {
    // Site ou flux : ouvrir la fiche du dossier sur l'onglet correspondant
    if (state.activeWorkspaceId !== r.ws.id) {
      openWorkspace(r.ws.id);
    }
    hideHome();
    // Ouvre la fiche du dossier directement sur le chapitre qui porte
    // l'information recherchée (sites → 2.1, flux → ch. 14).
    openLldModal(r.type === 'site' ? 'sites' : 'flows');
    return;
  }
  if (state.activeWorkspaceId !== r.ws.id) {
    openWorkspace(r.ws.id);
  }
  hideHome();

  const rect = viewport.getBoundingClientRect();
  const scale = 1;
  view.scale = scale;
  view.x = rect.width  / 2 - (r.rack.x + RACK_W / 2) * scale;
  view.y = rect.height / 2 - (r.rack.y + rackHeight(r.rack) / 2) * scale;
  markViewTouched();
  applyView();
  renderBoard();

  // Laisser le DOM se mettre à jour avant de clignoter
  requestAnimationFrame(() => {
    const rackEl = board.querySelector(`.rack[data-rack-id="${r.rack.id}"]`);
    const devEl = rackEl?.querySelector(`.device[data-instance-id="${r.inst.id}"]`);
    if (!devEl) return;
    if (r.port) {
      const portEl = devEl.querySelector(`.port[data-port-id="${r.port.id}"]`);
      if (portEl) {
        portEl.classList.remove('flash-port');
        void portEl.offsetWidth; // relancer l'animation
        portEl.classList.add('flash-port');
        setTimeout(() => portEl.classList.remove('flash-port'), 5500);
      }
    } else {
      devEl.classList.remove('flash-target');
      void devEl.offsetWidth;
      devEl.classList.add('flash-target');
      setTimeout(() => devEl.classList.remove('flash-target'), 5500);
    }
  });
}

// ---------- Initialisation ----------
async function boot() {
  // Récupère l'état depuis le serveur (JSON) ou, à défaut, le navigateur
  await bootState();
  renderPalette();
  renderBoard();
  // Recadrage automatique sur le contenu du workspace courant (ou vue par défaut)
  applyWorkspaceView();
  // Démarrage sur l'écran d'accueil
  showHome();
}
boot();
