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

// Infos du dossier LLD portées par le workspace (page de garde, révisions, VLANs)
function normLldInfo(w) {
  if (!w.lld || typeof w.lld !== 'object') w.lld = {};
  const L = w.lld;
  for (const k of ['client', 'author', 'version']) {
    if (typeof L[k] !== 'string') L[k] = '';
    L[k] = L[k].slice(0, 80);
  }
  // Textes documentaires (ch. 1, 2.2 et 3 du dossier LLD)
  for (const k of ['objectif', 'existant', 'architecture']) {
    if (typeof L[k] !== 'string') L[k] = '';
    L[k] = L[k].slice(0, 4000);
  }
  // Nomenclature (ch. 4) : type d'objet -> préfixe -> exemple -> règle de nommage
  L.nomen = Array.isArray(L.nomen) ? L.nomen.filter(r => r && typeof r === 'object').map(r => ({
    type:    String(r.type ?? '').slice(0, 40),
    prefix:  String(r.prefix ?? '').slice(0, 20),
    example: String(r.example ?? '').slice(0, 60),
    rule:    String(r.rule ?? '').slice(0, 100)
  })) : [];
  // Approbateurs et réviseurs affichés sur la page de garde du PDF.
  const normSignatories = rows => Array.isArray(rows) ? rows
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      name: String(r.name ?? '').slice(0, 80),
      position: String(r.position ?? '').slice(0, 80),
      organization: String(r.organization ?? '').slice(0, 80),
      approvedVersion: String(r.approvedVersion ?? '').slice(0, 30)
    })) : [];
  L.approvers = normSignatories(L.approvers);
  L.reviewers = normSignatories(L.reviewers);
  L.revs = Array.isArray(L.revs) ? L.revs.filter(r => r && typeof r === 'object').map(r => ({
    rev: String(r.rev ?? '').slice(0, 10),
    date: String(r.date ?? '').slice(0, 10),
    author: String(r.author ?? '').slice(0, 60),
    note: String(r.note ?? '').slice(0, 120)
  })) : [];
  L.vlans = Array.isArray(L.vlans) ? L.vlans.filter(v => v && typeof v === 'object').map(v => ({
    vid: String(v.vid ?? '').slice(0, 6),
    name: String(v.name ?? '').slice(0, 40),
    subnet: String(v.subnet ?? '').slice(0, 50),
    gw: String(v.gw ?? '').slice(0, 50),
    purpose: String(v.purpose ?? '').slice(0, 60)
  })) : [];
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
                     'ipMode', 'wanIp', 'wanLabel', 'lanIp', 'lanMask', 'lanGw', 'lanDns',
                     'ipv6', 'dhcp', 'pf', 'dmz', 'firewall', 'wlan'])
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
                   'snA', 'fwA', 'haA', 'roleA', 'vipA', 'mgmtA', 'lanA',
                   'snB', 'fwB', 'haB', 'roleB', 'vipB', 'mgmtB', 'lanB']) {
    if (typeof L.interco[k] !== 'string') L.interco[k] = '';
    L.interco[k] = L.interco[k].slice(0, 120);
  }
  // Règles/NAT firewall (ch. 7), VMs (ch. 9), volumes/LUN (ch. 10), caméras (ch. 12)
  const normTable = (arr, spec) => Array.isArray(arr)
    ? arr.filter(r => r && typeof r === 'object').map(r => {
        const o = {};
        for (const [k, n] of spec) o[k] = String(r[k] ?? '').slice(0, n);
        return o;
      })
    : [];
  L.fw = normTable(L.fw, [['type', 12], ['name', 40], ['src', 60], ['dst', 60], ['service', 60], ['action', 20]]);
  L.vms = normTable(L.vms, [['name', 40], ['role', 60], ['host', 40], ['ip', 40]]);
  L.vols = normTable(L.vols, [['name', 40], ['size', 30], ['type', 30], ['srv', 40]]);
  L.cams = normTable(L.cams, [['name', 40], ['loc', 60], ['model', 40], ['ip', 40]]);
  if (typeof L.interco.notes !== 'string') L.interco.notes = '';
  L.interco.notes = L.interco.notes.slice(0, 2000);
  // Notes de configuration par chapitre (ch. 7 à 13)
  if (!L.catNotes || typeof L.catNotes !== 'object') L.catNotes = {};
  for (const k of ['firewall', 'switching', 'server', 'storage', 'ids', 'cctv', 'pointage']) {
    if (typeof L.catNotes[k] !== 'string') L.catNotes[k] = '';
    L.catNotes[k] = L.catNotes[k].slice(0, 2000);
  }
  // Zones de Switching (sous-chapitres 8.1, 8.2…) — par défaut : structure cible
  L.swZones = Array.isArray(L.swZones) ? L.swZones.filter(z => z && typeof z === 'object').map(z => ({
    id: String(z.id || uid()),
    name: String(z.name ?? '').slice(0, 40).trim() || 'Zone',
    vlans: String(z.vlans ?? '').slice(0, 100)
  })) : [
    { id: uid(), name: 'INFRA' },
    { id: uid(), name: 'LAN Site B' },
    { id: uid(), name: 'Aruba AP Site A' },
    { id: uid(), name: 'Aruba AP Site B' },
    { id: uid(), name: 'LAN Site A' }
  ];
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
  w.sites = (arr ?? defaultSites()).filter(s => s && typeof s === 'object').map(s => ({
    id: String(s.id || uid()),
    name: String(s.name ?? '').slice(0, 40).trim() || 'Site',
    type: String(s.type ?? '').slice(0, 40),
    country: String(s.country ?? '').slice(0, 40),
    users: String(s.users ?? '').slice(0, 20),
    address: String(s.address ?? '').slice(0, 80),
    contact: String(s.contact ?? '').slice(0, 80),
    desc: String(s.desc ?? '').slice(0, 200)
  }));
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
    w.flows = w.flows.filter(f => f && typeof f === 'object').map(f => ({
      id: String(f.id || uid()),
      name: String(f.name ?? '').slice(0, 60),
      src: String(f.src ?? '').slice(0, 80),
      dst: String(f.dst ?? '').slice(0, 80),
      proto: String(f.proto ?? '').slice(0, 60),
      sens: f.sens === 'uni' ? 'uni' : 'bi',
      usage: String(f.usage ?? '').slice(0, 120)
    }));
    // Sites du workspace + nettoyage des racks pointant vers un site disparu
    normSites(w);
    const siteIds = new Set(w.sites.map(x => x.id));
    w.racks.forEach(r => { if (r.siteId && !siteIds.has(r.siteId)) r.siteId = ''; });
    if (typeof w.updatedAt !== 'number') w.updatedAt = 0;
    w.bundled = !!w.bundled;      // workspace issu de la démo embarquée
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
  if (already) { openWorkspace(wsId); return; }   // pas de doublon

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
   INFOS DOSSIER LLD — onglets Document / Réseau
   (Sites et Chapitres arriveront avec les lots 2 et 5)
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
// Champs interconnexion (ch. 6) : [clé, sélecteur HTML]
const LLD_IC_FIELDS = [
  ['tech', '#lld-ic-tech'], ['epA', '#lld-ic-epa'], ['epB', '#lld-ic-epb'],
  ['localSubnets', '#lld-ic-local'], ['remoteSubnets', '#lld-ic-remote'],
  ['routing', '#lld-ic-routing'], ['encryption', '#lld-ic-enc'], ['notes', '#lld-ic-notes'],
  ['snA', '#lld-ic-sna'], ['fwA', '#lld-ic-fwa'], ['haA', '#lld-ic-haa'], ['roleA', '#lld-ic-rolea'],
  ['vipA', '#lld-ic-vipa'], ['mgmtA', '#lld-ic-mgmta'], ['lanA', '#lld-ic-lana'],
  ['snB', '#lld-ic-snb'], ['fwB', '#lld-ic-fwb'], ['haB', '#lld-ic-hab'], ['roleB', '#lld-ic-roleb'],
  ['vipB', '#lld-ic-vipb'], ['mgmtB', '#lld-ic-mgmtb'], ['lanB', '#lld-ic-lanb']
];
// Tables par chapitre : règles/NAT firewall (7), VMs (9), volumes (10), caméras (12)
const LLD_FW_COLS = [['type', 'Type', 74], ['name', 'Nom / Règle', 'flex'], ['src', 'Source', 130],
                     ['dst', 'Destination', 130], ['service', 'Service / Ports', 120], ['action', 'Action', 66]];
const LLD_VM_COLS = [['name', 'VM', 120], ['role', 'Rôle', 'flex'], ['host', 'Hôte', 110], ['ip', 'IP / VLAN', 100]];
const LLD_VOL_COLS = [['name', 'Volume / LUN', 'flex'], ['size', 'Capacité', 90], ['type', 'Type', 90], ['srv', 'Serveur', 120]];
const LLD_CAM_COLS = [['name', 'Caméra', 110], ['loc', 'Emplacement', 'flex'], ['model', 'Modèle', 120], ['ip', 'IP', 100]];
// Notes de configuration par chapitre (clé = domaine du chapitre)
const LLD_NOTE_FIELDS = [
  ['firewall', '#lld-note-firewall'], ['switching', '#lld-note-switching'],
  ['server', '#lld-note-server'], ['storage', '#lld-note-storage'],
  ['ids', '#lld-note-ids'], ['cctv', '#lld-note-cctv'], ['pointage', '#lld-note-pointage']
];

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

function lldRowsFrom(container) {
  return [...container.querySelectorAll('.lld-row')].map(row => {
    const o = {};
    row.querySelectorAll('input').forEach(inp => { o[inp.dataset.k] = inp.value; });
    return o;
  });
}

function lldAddRow(container, cols, data = {}) {
  const row = document.createElement('div');
  row.className = 'lld-row';
  for (const [k, ph, w] of cols) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.dataset.k = k;
    inp.placeholder = ph;
    if (w !== 'flex') inp.style.width = w + 'px';
    else inp.className = 'lld-flex';
    if (k === 'date') inp.placeholder = 'AAAA-MM-JJ';
    inp.value = data[k] || '';
    row.appendChild(inp);
  }
  const del = document.createElement('button');
  del.className = 'lld-row-del';
  del.textContent = '✕';
  del.title = 'Supprimer cette ligne';
  del.addEventListener('click', () => row.remove());
  row.appendChild(del);
  container.appendChild(row);
}

// ---- Lignes « site » (2 lignes : nom/adresse/contacts + description) ----
function lldAddSiteRow(container, site = {}) {
  const card = document.createElement('div');
  card.className = 'lld-site';
  card.dataset.id = site.id || '';
  card.innerHTML = `
    <div class="lld-row">
      <input type="text" data-k="name" placeholder="Nom (ex : Site A)" maxlength="40" style="width:112px">
      <input type="text" data-k="address" placeholder="Adresse" maxlength="80" class="lld-flex">
      <input type="text" data-k="contact" placeholder="Contacts" maxlength="80" style="width:118px">
      <button type="button" class="lld-row-del" title="Supprimer ce site">✕</button>
    </div>
    <div class="lld-row">
      <input type="text" data-k="type" placeholder="Type (ex : Siège)" maxlength="40" style="width:112px">
      <input type="text" data-k="country" placeholder="Pays" maxlength="40" style="width:92px">
      <input type="text" data-k="users" placeholder="Utilisateurs" maxlength="20" style="width:92px">
      <input type="text" data-k="desc" placeholder="Description / notes" maxlength="200" class="lld-flex">
    </div>`;
  card.querySelectorAll('input').forEach(inp => { inp.value = site[inp.dataset.k] || ''; });
  card.querySelector('.lld-row-del').addEventListener('click', () => card.remove());
  container.appendChild(card);
}

function lldSitesFrom(container) {
  return [...container.querySelectorAll('.lld-site')].map(card => {
    const o = { id: card.dataset.id || '' };
    card.querySelectorAll('input').forEach(inp => { o[inp.dataset.k] = inp.value; });
    return o;
  });
}

// ---- Blocs « FAI » (ch. 5) : liste dynamique de fournisseurs d'accès ----
function lldRenumberFais(container) {
  container.querySelectorAll('.lld-fai-num').forEach((el, i) => { el.textContent = `FAI ${i + 1}`; });
}
function lldAddFaiBlock(container, fai = {}) {
  const card = document.createElement('div');
  card.className = 'lld-site lld-fai';
  card.innerHTML = `
    <div class="lld-fai-head">
      <strong class="lld-fai-num"></strong>
      <button type="button" class="lld-row-del" title="Supprimer ce FAI">✕</button>
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
      <label>Liaison physique (boîtier → port WAN)
        <input type="text" data-k="wanLabel" placeholder="Ex : Port eth1 (ONT) → WAN 1" maxlength="120">
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
      <label>Port Forwarding
        <input type="text" data-k="pf" placeholder="Ex : TCP 443 → 10.10.20.11" maxlength="120">
      </label>
      <label>DMZ
        <input type="text" data-k="dmz" placeholder="Ex : 10.10.20.11 (reverse-proxy)" maxlength="120">
      </label>
      <label>Firewall
        <input type="text" data-k="firewall" placeholder="Ex : entrée 443 uniquement" maxlength="120">
      </label>
      <label>WLAN (SSID)
        <input type="text" data-k="wlan" placeholder="Ex : corp-secure / invité" maxlength="120">
      </label>
    </div>
    <label class="lld-fai-notes">Notes de configuration
      <textarea data-k="notes" rows="2" maxlength="2000"
        placeholder="Ex : CPE en mode bridge, IP publique sur l'interface WAN du pare-feu…"></textarea>
    </label>`;
  card.querySelectorAll('[data-k]').forEach(inp => { inp.value = fai[inp.dataset.k] || ''; });
  card.querySelector('.lld-row-del').addEventListener('click', () => {
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
function lldAddZoneRow(container, zone = {}) {
  const row = document.createElement('div');
  row.className = 'lld-row lld-zone-row';
  row.dataset.id = zone.id || '';
  row.innerHTML = `
    <button type="button" class="lld-zone-up" title="Monter cette zone">↑</button>
    <button type="button" class="lld-zone-down" title="Descendre cette zone">↓</button>
    <input type="text" data-k="name" placeholder="Nom de la zone (ex : LAN Site A)" maxlength="40" class="lld-flex">
    <input type="text" data-k="vlans" placeholder="VLANs (ex : 10,20,30-40)" maxlength="100" style="width:170px">
    <button type="button" class="lld-row-del" title="Supprimer cette zone">✕</button>`;
  const nameInp = row.querySelector('input[data-k="name"]');
  nameInp.value = zone.name || '';
  row.querySelector('input[data-k="vlans"]').value = zone.vlans || '';
  row.querySelector('.lld-zone-up').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('lld-zone-row')) container.insertBefore(row, prev);
  });
  row.querySelector('.lld-zone-down').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('lld-zone-row')) container.insertBefore(next, row);
  });
  row.querySelector('.lld-row-del').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function lldZonesFrom(container) {
  return [...container.querySelectorAll('.lld-zone-row')].map(r => ({
    id: r.dataset.id || '',
    name: r.querySelector('input[data-k="name"]').value,
    vlans: (r.querySelector('input[data-k="vlans"]') || {}).value || ''
  }));
}

// ---- Lignes « flux » (2 lignes : nom/source/destination + protocole/sens/usage) ----
function lldAddFlowRow(container, flow = {}) {
  const card = document.createElement('div');
  card.className = 'lld-flow';
  card.dataset.id = flow.id || '';
  card.innerHTML = `
    <div class="lld-row">
      <input type="text" data-k="name" placeholder="Nom du flux" maxlength="60" style="width:148px">
      <input type="text" data-k="src" placeholder="Source (ex : LAN Site A, SRV-01…)" maxlength="80" class="lld-flex">
      <input type="text" data-k="dst" placeholder="Destination (ex : Internet, FW-01…)" maxlength="80" class="lld-flex">
      <button type="button" class="lld-row-del" title="Supprimer ce flux">✕</button>
    </div>
    <div class="lld-row">
      <input type="text" data-k="proto" placeholder="Protocole / ports" maxlength="60" style="width:148px">
      <select data-k="sens" style="width:140px" title="Sens du flux">
        <option value="bi">⇄ Bidirectionnel</option>
        <option value="uni">→ Unidirectionnel</option>
      </select>
      <input type="text" data-k="usage" placeholder="Usage / description" maxlength="120" class="lld-flex">
    </div>`;
  card.querySelectorAll('[data-k]').forEach(el => {
    if (el.dataset.k === 'sens') el.value = flow.sens === 'uni' ? 'uni' : 'bi';
    else el.value = flow[el.dataset.k] || '';
  });
  card.querySelector('.lld-row-del').addEventListener('click', () => card.remove());
  container.appendChild(card);
}

function lldFlowsFrom(container) {
  return [...container.querySelectorAll('.lld-flow')].map(card => {
    const o = { id: card.dataset.id || '' };
    card.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value; });
    return o;
  });
}

// ---- Onglets de la modale ----
document.querySelectorAll('#lld-modal .lld-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    document.querySelectorAll('#lld-modal .lld-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('#lld-modal .lld-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== btn.dataset.tab));
  });
});
function lldShowTab(name) {
  const btn = document.querySelector(`#lld-modal .lld-tab[data-tab="${name}"]`);
  if (btn && !btn.disabled) btn.click();
}

function openLldModal() {
  const ws = active();
  if (!ws) return;
  const L = normLldInfo(ws);
  $('#lld-client').value = L.client;
  $('#lld-author').value = L.author;
  $('#lld-version').value = L.version;
  $('#lld-objectif').value = L.objectif;
  $('#lld-existant').value = L.existant;
  $('#lld-architecture').value = L.architecture;
  const approvers = $('#lld-approvers');
  approvers.innerHTML = '';
  L.approvers.forEach(r => lldAddRow(approvers, LLD_SIGNATORY_COLS, r));
  const reviewers = $('#lld-reviewers');
  reviewers.innerHTML = '';
  L.reviewers.forEach(r => lldAddRow(reviewers, LLD_SIGNATORY_COLS, r));
  const revs = $('#lld-revs');
  revs.innerHTML = '';
  L.revs.forEach(r => lldAddRow(revs, LLD_REV_COLS, r));
  const nomen = $('#lld-nomen');
  nomen.innerHTML = '';
  L.nomen.forEach(r => lldAddRow(nomen, LLD_NOMEN_COLS, r));
  const vlans = $('#lld-vlans');
  vlans.innerHTML = '';
  L.vlans.forEach(v => lldAddRow(vlans, LLD_VLAN_COLS, v));
  const faisEl = $('#lld-fais');
  faisEl.innerHTML = '';
  (L.fais && L.fais.length ? L.fais : [{}]).forEach(f => lldAddFaiBlock(faisEl, f));
  [['#lld-fw', L.fw, LLD_FW_COLS], ['#lld-vms', L.vms, LLD_VM_COLS],
   ['#lld-vols', L.vols, LLD_VOL_COLS], ['#lld-cams', L.cams, LLD_CAM_COLS]]
    .forEach(([sel, tbl, cols]) => {
      const el = $(sel);
      el.innerHTML = '';
      (tbl || []).forEach(r => lldAddRow(el, cols, r));
    });
  LLD_IC_FIELDS.forEach(([k, sel]) => { $(sel).value = L.interco[k] || ''; });
  const zonesEl = $('#lld-zones');
  zonesEl.innerHTML = '';
  L.swZones.forEach(z => lldAddZoneRow(zonesEl, z));
  LLD_NOTE_FIELDS.forEach(([k, sel]) => { $(sel).value = L.catNotes[k] || ''; });
  const flowsEl = $('#lld-flows');
  flowsEl.innerHTML = '';
  (ws.flows || []).forEach(f => lldAddFlowRow(flowsEl, f));
  const sitesEl = $('#lld-sites');
  sitesEl.innerHTML = '';
  normSites(ws).forEach(s => lldAddSiteRow(sitesEl, s));
  lldShowTab('doc');
  $('#lld-modal').classList.remove('hidden');
  $('#lld-client').focus();
}

$('#ws-info').addEventListener('click', openLldModal);
$('#lld-cancel').addEventListener('click', () => $('#lld-modal').classList.add('hidden'));
$('#lld-modal').addEventListener('click', e => {
  if (e.target === $('#lld-modal')) $('#lld-modal').classList.add('hidden');
});
function addSignatoryRow(containerSelector) {
  const container = $(containerSelector);
  lldAddRow(container, LLD_SIGNATORY_COLS, {});
  [...container.querySelectorAll('.lld-row')].pop().querySelector('input').focus();
}
$('#lld-add-approver').addEventListener('click', () => addSignatoryRow('#lld-approvers'));
$('#lld-add-reviewer').addEventListener('click', () => addSignatoryRow('#lld-reviewers'));
$('#lld-add-rev').addEventListener('click', () => {
  const revs = $('#lld-revs');
  const n = revs.querySelectorAll('.lld-row').length;
  lldAddRow(revs, LLD_REV_COLS, { rev: String(n + 1), date: new Date().toISOString().slice(0, 10) });
  [...revs.querySelectorAll('.lld-row')].pop().querySelector('input').focus();
});
$('#lld-add-vlan').addEventListener('click', () => lldAddRow($('#lld-vlans'), LLD_VLAN_COLS, {}));
$('#lld-add-nomen').addEventListener('click', () => {
  lldAddRow($('#lld-nomen'), LLD_NOMEN_COLS, {});
  [...$('#lld-nomen').querySelectorAll('.lld-row')].pop().querySelector('input').focus();
});
$('#lld-add-fw').addEventListener('click', () => lldAddRow($('#lld-fw'), LLD_FW_COLS, { type: 'Règle' }));
$('#lld-add-vm').addEventListener('click', () => lldAddRow($('#lld-vms'), LLD_VM_COLS, {}));
$('#lld-add-vol').addEventListener('click', () => lldAddRow($('#lld-vols'), LLD_VOL_COLS, {}));
$('#lld-add-cam').addEventListener('click', () => lldAddRow($('#lld-cams'), LLD_CAM_COLS, {}));
$('#lld-add-fai').addEventListener('click', () => {
  const el = $('#lld-fais');
  lldAddFaiBlock(el, {});
  [...el.querySelectorAll('.lld-fai')].pop().querySelector('input').focus();
});
$('#lld-add-site').addEventListener('click', () => {
  lldAddSiteRow($('#lld-sites'), {});
  const cards = $('#lld-sites').querySelectorAll('.lld-site');
  cards[cards.length - 1].querySelector('input').focus();
});
$('#lld-add-zone').addEventListener('click', () => {
  lldAddZoneRow($('#lld-zones'), {});
  const rows = $('#lld-zones').querySelectorAll('.lld-zone-row');
  rows[rows.length - 1].querySelector('input').focus();
});
$('#lld-add-flow').addEventListener('click', () => {
  lldAddFlowRow($('#lld-flows'), {});
  const cards = $('#lld-flows').querySelectorAll('.lld-flow');
  cards[cards.length - 1].querySelector('input').focus();
});

// Détecte les préfixes utilisés par les devices et câbles du workspace
// (ex : « SW-CORE-01 » → préfixe SW) et les ajoute à la nomenclature.
$('#lld-gen-nomen').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  const L = normLldInfo(ws);
  const known = new Set(L.nomen.map(r => r.prefix.trim().toUpperCase()).filter(Boolean));
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
  if (!missing.length) { lldAlert('Aucun nouveau préfixe détecté (ou tous sont déjà dans la nomenclature).', { title: '🔍 Détection des préfixes' }); return; }
  missing.forEach(p => lldAddRow($('#lld-nomen'), LLD_NOMEN_COLS, {
    type: NOMEN_GUESS[p] || '', prefix: p, example: found[p]
  }));
  lldAlert(`${missing.length} préfixe(s) ajouté(s) à la nomenclature : ${missing.join(', ')}.\nVérifiez le type d'objet et complétez la règle de nommage.`, { title: '🔍 Détection des préfixes' });
});

// Ajoute au registre les VLANs utilisés sur les ports mais pas encore enregistrés
$('#lld-detect-vlans').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  const L = normLldInfo(ws);
  const known = new Set(L.vlans.map(v => v.vid.trim()).filter(Boolean));
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
  if (!missing.length) { lldAlert('Tous les VLANs utilisés sont déjà dans le registre.', { title: '🔍 Détection des VLANs' }); return; }
  const vlans = $('#lld-vlans');
  missing.forEach(vid => lldAddRow(vlans, LLD_VLAN_COLS, { vid }));
  lldAlert(`${missing.length} VLAN(s) ajouté(s) au registre : ${missing.join(', ')}\nRenseignez leur nom, subnet et passerelle.`, { title: '🔍 Détection des VLANs' });
});

$('#lld-save').addEventListener('click', () => {
  const ws = active();
  if (!ws) return;
  pushHistory();
  const L = normLldInfo(ws);
  L.client = $('#lld-client').value.trim().slice(0, 80);
  L.author = $('#lld-author').value.trim().slice(0, 80);
  L.version = $('#lld-version').value.trim().slice(0, 80);
  L.objectif = $('#lld-objectif').value.slice(0, 4000);
  L.existant = $('#lld-existant').value.slice(0, 4000);
  L.architecture = $('#lld-architecture').value.slice(0, 4000);
  L.approvers = lldRowsFrom($('#lld-approvers'))
    .filter(r => r.name.trim() || r.position.trim() || r.organization.trim() || r.approvedVersion.trim());
  L.reviewers = lldRowsFrom($('#lld-reviewers'))
    .filter(r => r.name.trim() || r.position.trim() || r.organization.trim() || r.approvedVersion.trim());
  L.revs = lldRowsFrom($('#lld-revs')).filter(r => r.rev.trim() || r.note.trim());
  L.nomen = lldRowsFrom($('#lld-nomen')).filter(r => r.type.trim() || r.prefix.trim());
  L.vlans = lldRowsFrom($('#lld-vlans')).filter(v => v.vid.trim() || v.name.trim());
  L.fw = lldRowsFrom($('#lld-fw')).filter(r => r.name.trim());
  L.vms = lldRowsFrom($('#lld-vms')).filter(r => r.name.trim());
  L.vols = lldRowsFrom($('#lld-vols')).filter(r => r.name.trim());
  L.cams = lldRowsFrom($('#lld-cams')).filter(r => r.name.trim());
  L.fais = lldFaisFrom($('#lld-fais'))
    .filter(f => f.operator.trim() || f.offer.trim() || f.down.trim() ||
                 f.publicBlock.trim() || f.notes.trim());
  L.fai = L.fais[0] || { operator: '', offer: '', linkType: '', down: '', up: '',
                         publicBlock: '', cpe: '', cpeIp: '', notes: '' };
  LLD_IC_FIELDS.forEach(([k, sel]) => { L.interco[k] = $(sel).value.slice(0, 2000); });
  LLD_NOTE_FIELDS.forEach(([k, sel]) => { L.catNotes[k] = $(sel).value.slice(0, 2000); });

  // Zones de switching (ch. 8) : on reserialize la liste
  const prevZoneIds = new Set(L.swZones.map(z => z.id));
  L.swZones = lldZonesFrom($('#lld-zones'))
    .filter(z => z.name.trim())
    .map(z => ({ id: z.id && prevZoneIds.has(z.id) ? z.id : uid(),
                 name: z.name.trim().slice(0, 40), vlans: z.vlans.trim().slice(0, 100) }));
  const zoneIds = new Set(L.swZones.map(z => z.id));
  let dezoned = 0;
  ws.racks.forEach(r => r.instances.forEach(i => {
    if (i.zone && !zoneIds.has(i.zone)) { i.zone = ''; dezoned++; }
  }));
  if (dezoned) {
    lldAlert(`${dezoned} device(s) switching étaient rattaché(s) à une zone supprimée :\nils sont maintenant « hors zone ».`, { title: 'ℹ️ Zones de switching' });
  }

  // Flux réseau (ch. 14)
  const prevFlowIds = new Set((ws.flows || []).map(f => f.id));
  ws.flows = lldFlowsFrom($('#lld-flows'))
    .filter(f => f.name.trim() || f.src.trim() || f.dst.trim())
    .map(f => ({
      id: f.id && prevFlowIds.has(f.id) ? f.id : uid(),
      name: f.name.trim().slice(0, 60),
      src: f.src.trim().slice(0, 80),
      dst: f.dst.trim().slice(0, 80),
      proto: f.proto.trim().slice(0, 60),
      sens: f.sens === 'uni' ? 'uni' : 'bi',
      usage: f.usage.trim().slice(0, 120)
    }));

  // Sites : on reserialize la liste (les nouveaux reçoivent un id généré)
  const prevIds = new Set(ws.sites.map(s => s.id));
  ws.sites = lldSitesFrom($('#lld-sites'))
    .filter(s => s.name.trim())
    .map(s => ({
      id: s.id && prevIds.has(s.id) ? s.id : uid(),
      name: s.name.trim().slice(0, 40),
      type: s.type.trim().slice(0, 40),
      country: s.country.trim().slice(0, 40),
      users: s.users.trim().slice(0, 20),
      address: s.address.trim().slice(0, 80),
      contact: s.contact.trim().slice(0, 80),
      desc: s.desc.trim().slice(0, 200)
    }));
  // Racks pointant vers un site supprimé -> détachés
  const newIds = new Set(ws.sites.map(s => s.id));
  let detached = 0;
  ws.racks.forEach(r => { if (r.siteId && !newIds.has(r.siteId)) { r.siteId = ''; detached++; } });
  if (detached) {
    lldAlert(`${detached} rack(s) étaient rattaché(s) à un site supprimé :\nils sont maintenant « sans site ».`, { title: 'ℹ️ Sites' });
  }

  touchWorkspace(ws);
  saveState();
  $('#lld-modal').classList.add('hidden');
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
  const rows = [['Flux', 'Source', 'Destination', 'Protocole / ports', 'Sens', 'Usage']];
  for (const f of (ws?.flows || [])) {
    rows.push([f.name || '', f.src || '', f.dst || '', f.proto || '',
               f.sens === 'uni' ? 'Unidirectionnel' : 'Bidirectionnel', f.usage || '']);
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
  const rows = [['Site', 'Adresse', 'Contacts', 'Description', 'Racks']];
  for (const s of (ws?.sites || [])) {
    const nb = (ws?.racks || []).filter(r => r.siteId === s.id).length;
    rows.push([s.name, s.address || '', s.contact || '', s.desc || '', nb]);
  }
  return rows;
}

// Nomenclature (feuille Excel / CSV)
function nomenRows(ws) {
  const L = normLldInfo(ws || {});
  const rows = [["Type d'objet", 'Préfixe', 'Exemple', 'Règle de nommage']];
  L.nomen.forEach(r => rows.push([r.type, r.prefix, r.example, r.rule]));
  return rows;
}

// Adressage IP global : registre VLANs & subnets (feuille Excel / CSV)
function addressingRows(ws) {
  const L = normLldInfo(ws || {});
  const rows = [['VLAN', 'Nom', 'Site', 'Subnet', 'Passerelle', 'Usage']];
  L.vlans.forEach(v => rows.push([v.vid, v.name, v.site, v.subnet, v.gw, v.purpose]));
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

  function sheetXml(rows, opts = {}) {
    const freeze = opts.freeze !== false;
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
    rows.forEach((row, ri) => {
      const ht = opts.heights && opts.heights[ri + 1];
      const cells = row.map((v, ci) => {
        let val = v, st = null;
        if (v && typeof v === 'object') { val = v.v; st = v.s; }
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
      body += `<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
    });
    const merges = (opts.merges && opts.merges.length)
      ? `<mergeCells count="${opts.merges.length}">` +
        opts.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('') + '</mergeCells>'
      : '';
    const views = freeze
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const fmtPr = opts.dcw ? `<sheetFormatPr defaultColWidth="${opts.dcw}" defaultRowHeight="15"/>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      views + fmtPr + cols + '<sheetData>' + body + '</sheetData>' + merges + '</worksheet>';
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
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.opts || {}) }))
      ];
      return new Blob([zip(files2)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
      const fk = JSON.stringify([d.name || 'Calibri', d.sz || 11, !!d.b, !!d.i, d.color || '']);
      if (!fontIdx.has(fk)) {
        fontIdx.set(fk, fonts.length);
        fonts.push('<font>' + (d.b ? '<b/>' : '') + (d.i ? '<i/>' : '') +
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
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.opts || {}) }))
    ];
    const u8 = zip(files);
    return new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  return { build };
})();

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
    const fw = (ws.lld && ws.lld.fw) || [];
    if (fw.length) {
      rows.push([]); rows.push([]);
      rows.push(SEC('7.3. Règles et NAT'));
      rows.push([]);
      rows.push(H(['Type', 'Nom', 'Source', 'Destination', 'Service / Ports', 'Action']));
      fw.forEach((r0, i) => rows.push(D([
        r0.type || '', r0.name || '', r0.src || '', r0.dst || '', r0.service || '', r0.action || ''], i % 2)));
    }
    pushNote(rows, fw.length
      ? "À compléter manuellement : alias, VPN SSL (profils utilisateurs) et cluster/HA."
      : "À compléter manuellement : NAT, règles et alias, VPN SSL, cluster/HA (non saisis dans l'application).");
    return out(sheet, rows, heights, null, [3.43, 46, 30, 22, 22, 30, 16]);
  }

  /* — 8.x Switching : équipements de la zone correspondant au titre — */
  function switchZone(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    // la feuille du template ne porte que le titre (la ligne « Config: Voir
    // CMDB », placeholder à 30 lignes du titre, est remplacée par le contenu)
    rows.length = 1;
    const title = String(rows[0][0] && rows[0][0].v || '');
    const zones = (ws.lld && ws.lld.swZones) || [];
    let zone = null;
    if (/INFRA/i.test(title)) zone = zones.find(z => /infra/i.test(z.name));
    else if (/\(AP\)/i.test(title)) zone = zones.find(z => /\bAP\b/i.test(z.name));
    else if (/\(LAN\)/i.test(title)) zone = zones.find(z => /lan/i.test(z.name) && !/infra/i.test(z.name));
    const catList = /\(AP\)/i.test(title) ? ['switch', 'ap'] : ['switch'];
    const sws = byCat(ws, catList).filter(x => !zone || x.inst.zone === zone.id);
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
    return out(sheet, rows, heights, null, [3.43, 30, 34, 18, 24, 12]);
  }

  /* — 9 à 13 : équipements par spécialité — */
  function chapterEquip(cats, titre, note) {
    return (sheet, ws) => {
      const { rows, heights } = fromLayout(sheet);
      const list = byCat(ws, cats);
      if (list.length) equipTable(rows, list, { titre, cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
      else pushNote(rows, note || "Aucun équipement de cette catégorie dans l'inventaire actuel.");
      if (note) pushNote(rows, note);
      return out(sheet, rows, heights, null, [3.43, 40, 36, 22, 26]);
    };
  }

  /* — Équipements d'une catégorie + table annexe (VMs, volumes, caméras…) — */
  function chapterWith(cat, titre, titre2, cols2, key, note) {
    return (sheet, ws) => {
      const { rows, heights } = fromLayout(sheet);
      const list = byCat(ws, [cat]);
      if (list.length) equipTable(rows, list, { titre, cols: ['Nom', 'Marque / Modèle', 'IP mgmt', 'Position'] });
      const tbl = (ws.lld && ws.lld[key]) || [];
      if (tbl.length) {
        rows.push([]); rows.push([]);
        rows.push(SEC(titre2));
        rows.push([]);
        rows.push(H(cols2.map(([lbl]) => lbl)));
        tbl.forEach((r0, i) => rows.push(D(cols2.map(([, k]) => r0[k] || ''), i % 2)));
      }
      if (!list.length && !tbl.length) pushNote(rows, "Aucun équipement de cette catégorie dans l'inventaire actuel.");
      else if (note) pushNote(rows, note);
      return out(sheet, rows, heights, null, [3.43, 40, 36, 22, 26]);
    };
  }

  /* — 14. Flux réseau — */
  function ch14(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const flows = flowsRows(ws).slice(1);
    if (flows.length) {
      rows.push([]); rows.push([]);
      rows.push(SEC('Flux applicatifs'));
      rows.push([]);
      rows.push(H(['Flux', 'Source', 'Destination', 'Protocole / ports', 'Sens', 'Usage']));
      flows.forEach((f, i) => rows.push(D([f[0], f[1], f[2], f[3], f[4], f[5]], i % 2)));
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
      cab.slice(1).forEach((c, i) => rows.push(D([c[0], c[1], c[2], c[3], c[4], c[5], c[8], c[9], c[10]], i % 2)));
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

  /* Groupements inventaire : par catégorie et par modèle */
  function invGroups(ws) {
    const byCat = new Map(), byModel = new Map();
    for (const { inst } of sortedRackInstances(ws)) {
      const model = `${inst.brand || ''} ${inst.model || ''}`.trim() || inst.name;
      byModel.set(model, (byModel.get(model) || 0) + 1);
      const cat = catLabel(inst.cat);
      const g = byCat.get(cat) || { n: 0, models: new Map() };
      g.n++;
      g.models.set(model, (g.models.get(model) || 0) + 1);
      byCat.set(cat, g);
    }
    return { byCat, byModel };
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
    set(rows, 'E3', L.author || '', 104);
    // ligne « Version » (absente du template, ajoutée avec ses styles)
    rows[3] = new Array(17).fill('');
    rows[3][0] = { v: 'Version', s: 14 };
    for (let c = 4; c < 17; c++) rows[3][c] = { v: c === 4 ? (L.version || '') : '', s: 104 };
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
    const banner = (styles, title, n) => {
      const r0 = rows.length + 1;
      R(styles.map((s, i) => ({ v: i === 0 ? title : '', s })), 14.45);
      merges.push(`A${r0}:${'ABCDE'[n - 1]}${r0}`);
    };
    const headers5 = () => R([141, 2, 2, 142, 143].map((s, i) =>
      ({ v: ['Version', 'Auteur', 'Commentaires et mises à jour', 'Date', 'Statut'][i], s })), 14.45);

    R([{ v: 'Governance', s: 51 }], 25.9);
    R([]);

    // 1) Statut de révision du document
    banner([177, 178, 178, 178, 179], 'Statut de révision du document', 5);
    headers5();
    const approvedVers = new Set(approvers.map(a => a.approvedVersion).filter(Boolean));
    revs.forEach((rv, i) => {
      const last = i === revs.length - 1;
      const note = String(rv.note || '');
      R([
        { v: rv.rev || '', s: last ? 146 : 144 },
        { v: rv.author || '', s: last ? 102 : 8 },
        { v: note, s: 150 },
        { v: dateSerial(rv.date), s: last ? 147 : 145 },
        { v: (rv.rev && approvedVers.has(rv.rev)) ? 'Approuvé'
              : (approvers.length ? 'Pas encore approuvé' : ''), s: last ? 158 : 133 }
      ], Math.max(1, note.split('\n').length) * 15);
    });
    R([148, 135, 135, 149, 136].map(s => ({ v: '', s })), 15.75);
    R([]); R([]);

    // 2) Approbateurs : un bloc de 3 lignes par version cible (hors 0.x)
    banner([174, 175, 175, 175, 176], 'Approbateurs', 5);
    R([141, 2, 2, 142, 143].map((s, i) =>
      ({ v: ['Nom', 'Position', 'Organisation', 'Version approuvée', 'Signature'][i], s })), 14.45);
    let vers = revs.map(x => x.rev).filter(v => v && !/^0\./.test(v));
    if (!vers.length && L.version) vers = [L.version];
    if (!vers.length) vers = [''];
    vers.forEach(ver => {
      const sign = approvers.filter(a => a.approvedVersion === ver);
      const r0 = rows.length + 1;
      merges.push(`D${r0}:D${r0 + 2}`);
      for (let k = 0; k < 3; k++) {
        const a = sign[k] || {};
        const last = k === 2;
        R([
          { v: a.name || '', s: last ? 148 : 144 },
          { v: a.position || '', s: last ? 135 : 8 },
          { v: a.organization || '', s: last ? 135 : 8 },
          { v: k === 0 ? ver : '', s: last ? 182 : 180 },
          { v: '', s: last ? 136 : 133 }
        ], 14.45);
      }
    });
    R([{ v: '', s: 151 }]);
    R([]);

    // 3) Réviseurs : une ligne par version
    banner([174, 175, 175, 176], 'Réviseurs', 4);
    R([3, 2, 2, 4].map((s, i) =>
      ({ v: ['Nom', 'Position', 'Organisation', 'Version approuvée'][i], s })), 14.45);
    const rvVers = revs.length ? revs.map(x => x.rev || '')
      : (reviewers.length ? reviewers.map(x => x.approvedVersion || '') : ['']);
    rvVers.forEach(ver => {
      const rv = reviewers.find(x => x.approvedVersion === ver) || {};
      R([{ v: rv.name || '', s: 102 }, { v: rv.position || '', s: 8 },
         { v: rv.organization || '', s: 8 }, { v: ver, s: 9 }], 14.45);
    });
    R([{ v: '', s: 10 }, { v: '', s: 11 }, { v: '', s: 11 }, { v: '', s: 12 }], 14.45);
    return out(sheet, rows, heights, merges);
  }

  /* — Feuille « 1 » : objectif du document (texte de l'app) — */
  function ch1(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    proseLines(ws.lld && ws.lld.objectif, 40).forEach((t, i) => {
      const r = 9 + i;
      while (rows.length < r) rows.push([]);
      rows[r - 1][0] = { v: t, s: 129 };
    });
    return out(sheet, rows, heights);
  }

  /* — Feuille « 2 » : aperçu du site + infrastructure existante — */
  function ch2(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const site = (ws.sites || [])[0] || {};
    const fai = L.fai || {};
    set(rows, 'C6', site.name || '');
    set(rows, 'E6', site.address || '');
    set(rows, 'C7', site.type || '');
    set(rows, 'E7', site.country || '');
    set(rows, 'C8', site.users || '');
    set(rows, 'C9', fai.down || '');
    set(rows, 'C10', String(fai.notes || '').split('\n')[0]);
    // 2.2 : texte « infrastructure existante » de l'app (zone vide r16+)
    proseLines(L.existant, 30).forEach((t, i) => {
      const r = 16 + i;
      rows[r - 1][1] = { v: t, s: 129 };
    });
    // 2.2 : tableau des dispositifs (r51-59) : FAI + un dispositif par modèle
    const { byModel } = invGroups(ws);
    const models = [...byModel.entries()];
    set(rows, 'D51', fai.operator
      ? `${fai.operator}${fai.down ? ' — ' + fai.down : ''}` : '');
    models.slice(0, 8).forEach(([model, n], i) => {
      const r = 52 + i;
      set(rows, `B${r}`, model);
      set(rows, `D${r}`, `x${n}`);
    });
    for (let r = 52 + Math.min(models.length, 8); r <= 59; r++) { set(rows, `B${r}`, ''); set(rows, `D${r}`, ''); }
    return out(sheet, rows, heights);
  }

  /* — Feuille « 3 » : architecture cible + équipements — */
  function ch3(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    proseLines(ws.lld && ws.lld.architecture, 33).forEach((t, i) => {
      rows[1 + i][0] = { v: t, s: 129 };
    });
    // 3.1 : équipements (r41-76) depuis l'inventaire, groupés par modèle
    const { byModel } = invGroups(ws);
    const groups = [...byModel.entries()];
    groups.slice(0, 36).forEach(([model, n], i) => {
      const r = 41 + i;
      set(rows, `B${r}`, model, i % 2 ? 197 : 190);
      set(rows, `D${r}`, `x${n}`, i % 2 ? 198 : 195);
    });
    for (let r = 41 + Math.min(groups.length, 36); r <= 76; r++) {
      set(rows, `B${r}`, '', rows[r - 1][1] ? rows[r - 1][1].s : 190);
      set(rows, `D${r}`, '', rows[r - 1][3] ? rows[r - 1][3].s : 195);
    }
    return out(sheet, rows, heights);
  }

  /* — Feuille « 4 » : nomenclature (template) + adressage VLAN (app) — */
  function ch4(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const vlans = (ws.lld && ws.lld.vlans) || [];
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
    const nomen = (ws.lld && ws.lld.nomen) || [];
    if (nomen.length) {
      const put = (r, col, v, s) => {
        while (rows.length < r) rows.push([]);
        rows[r - 1][col] = { v, s };
      };
      put(171, 1, "Nomenclature — registre de l'application", 50);
      put(172, 1, "Type d'objet", 141); put(172, 2, 'Préfixe', 2);
      put(172, 3, 'Exemple', 2); put(172, 4, 'Règle de nommage', 143);
      nomen.slice(0, 25).forEach((nm, i) => {
        const st = i % 2 ? 197 : 8;
        put(173 + i, 1, nm.type || '', st); put(173 + i, 2, nm.prefix || '', st);
        put(173 + i, 3, nm.example || '', st); put(173 + i, 4, nm.rule || '', st);
      });
    }
    return out(sheet, rows, heights);
  }

  /* — Feuille « 5 » : FAI (infos + réglages avancés) + câblage — */
  function ch5(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const fais = (L.fais && L.fais.length) ? L.fais
      : (L.fai && (L.fai.operator || L.fai.offer || L.fai.down) ? [L.fai] : []);
    const lblFai = f => f.operator ? `${f.operator}${f.offer ? ' — ' + f.offer : ''}` : '';
    const COLS5 = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'P', 'Q', 'R', 'T'];
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
      set(rows, `P${r}`, f.dmz || '');
      set(rows, `Q${r}`, f.firewall || '');
      set(rows, `R${r}`, f.wlan || '');
      set(rows, `T${r}`, String(f.notes || '').split('\n')[0]);
    });
    for (let r = 35 + Math.min(fais.length, 4); r <= 38; r++)
      COLS5.forEach(c2 => set(rows, `${c2}${r}`, ''));
    // 5.2 câblage : boîtier (CPE) + liaison physique saisie sur le FAI
    fais.slice(0, 4).forEach((f, i) => {
      set(rows, `C${46 + i * 2}`, f.cpe ? f.cpe : lblFai(f));
      set(rows, `D${46 + i * 2}`, f.wanLabel || '');
      set(rows, `D${47 + i * 2}`, '');
    });
    for (let i = Math.min(fais.length, 4); i < 4; i++) {
      set(rows, `C${46 + i * 2}`, '');
      set(rows, `D${46 + i * 2}`, '');
      set(rows, `D${47 + i * 2}`, '');
    }
    return out(sheet, rows, heights);
  }

  /* — Feuille « 6 » : interconnexion site à site (complète) — */
  function ch6(sheet, ws) {
    const { rows, heights } = fromLayout(sheet);
    const L = ws.lld || {};
    const ic = L.interco || {};
    const fais = (L.fais && L.fais.length) ? L.fais
      : (L.fai && (L.fai.operator || L.fai.down) ? [L.fai] : []);
    const short = s => String(s || '').split(' — ')[0];
    // 6.1 — extrémités (r30/31) : identité, SN, firmware, HA (J→O), VIP partagée (N30)
    const endpoints = [
      ['30', 'B', ic.epA, ic.snA, ic.fwA, ic.haA, ic.roleA, ic.mgmtA, 'C62'],
      ['31', 'B', ic.epB, ic.snB, ic.fwB, ic.haB, ic.roleB, ic.mgmtB, 'C67']
    ];
    endpoints.forEach(([r, col, ep, sn, fw, ha, role, mgmt, cabRef]) => {
      if (ep) {
        set(rows, `${col}${r}`, ep);
        if (cabRef) set(rows, cabRef, short(ep));
      }
      set(rows, `D${r}`, sn || '');
      set(rows, `E${r}`, fw || '');
      set(rows, `J${r}`, ha ? 'Oui' : '');
      set(rows, `K${r}`, ha || '');
      set(rows, `L${r}`, role || '');
      set(rows, `M${r}`, /master/i.test(role || '') ? 'Oui' : '');
      set(rows, `O${r}`, mgmt || '');
    });
    if (ic.vipA) set(rows, 'N30', ic.vipA);
    if (ic.vipB) set(rows, 'N31', ic.vipB);
    // WAN Connection Settings (r45-47) : alimenté par les FAI
    fais.slice(0, 3).forEach((f, i) => {
      const r = 45 + i;
      set(rows, `B${r}`, f.operator ? `WAN ${i + 1} — ${f.operator}` : `WAN ${i + 1}`);
      set(rows, `C${r}`, 'Oui');
      set(rows, `D${r}`, f.ipMode || '');
      set(rows, `E${r}`, 'NAT');
      set(rows, `F${r}`, f.wanIp || '');
      set(rows, `K${r}`, f.up || '');
      set(rows, `L${r}`, f.down || '');
      set(rows, `M${r}`, f.down || '');
    });
    for (let r = 45 + Math.min(fais.length, 3); r <= 47; r++)
      ['B', 'C', 'D', 'E', 'F', 'K', 'L', 'M'].forEach(c2 => set(rows, `${c2}${r}`, ''));
    // LAN (r52-53)
    if (ic.routing) set(rows, 'C52', ic.routing);
    const nv = (L.vlans || []).length;
    set(rows, 'D52', nv ? `x${nv} VLANs routés` : '');
    if (ic.localSubnets) set(rows, 'B53', `LAN — ${ic.localSubnets}`);
    // 6.2 câblage : liaisons WAN (E62-64 / E67-69) + LAN 1 (E66 / E71)
    fais.slice(0, 3).forEach((f, i) => {
      set(rows, `E${62 + i}`, f.wanLabel || '');
      set(rows, `E${67 + i}`, f.wanLabel || '');
    });
    for (let i = Math.min(fais.length, 3); i < 3; i++) {
      set(rows, `E${62 + i}`, '');
      set(rows, `E${67 + i}`, '');
    }
    set(rows, 'E66', ic.lanA || '');
    set(rows, 'E71', ic.lanB || '');
    return out(sheet, rows, heights);
  }

  const FILLS = { 'LLD': lld, 'Governance': governance, '1': ch1, '2': ch2,
                  '3': ch3, '4': ch4, '5': ch5, '6': ch6,
                  '7': ch7,
                  '8': switchZone, '8.1': switchZone, '8.2': switchZone,
                  '8.3': switchZone, '8.4': switchZone, '8.5': switchZone,
                  '9':  chapterWith('server', '9.1. Serveurs', '9.2. Machines virtuelles',
                        [['VM', 'name'], ['Rôle', 'role'], ['Hôte', 'host'], ['IP / VLAN', 'ip']], 'vms',
                        "À compléter : rôles et affectation des machines virtuelles."),
                  '10': chapterWith('storage', '10.1. Stockage', '10.2. Volumes / LUN',
                        [['Volume', 'name'], ['Capacité', 'size'], ['Type', 'type'], ['Serveur', 'srv']], 'vols',
                        "À compléter : volumes/LUN et plan de sauvegarde."),
                  '11': chapterEquip(['ids'], "11.1. Détection d'intrusion"),
                  '12': chapterWith('cctv', '12.1. Caméras et enregistreur (NVR)', '12.2. Caméras',
                        [['Caméra', 'name'], ['Emplacement', 'loc'], ['Modèle', 'model'], ['IP', 'ip']], 'cams',
                        "À compléter : emplacements et plans d'implantation des caméras."),
                  '13': chapterEquip(['pointage'], '13.1. Pointeuses'),
                  '14': ch14, '15': ch15, '15.1': ch151 };

  function buildAll(ws, layout, stylesXml, themeXml) {
    const sheets = layout.map(sheet => {
      const fill = FILLS[sheet.name];
      if (fill) return fill(sheet, ws);
      const { rows, heights } = fromLayout(sheet);
      return out(sheet, rows, heights);
    });
    return XLSX.build(sheets, { stylesXml, themeXml });
  }

  return { buildAll };
})();

$('#export-xlsx').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = active();
  if (!ws || !ws.racks.length) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📊 Export Excel' }); return; }
  try {
    const [layout, stylesXml, themeXml] = await Promise.all([
      fetch('assets/lld/layout.json').then(r => { if (!r.ok) throw new Error('layout'); return r.json(); }),
      fetch('assets/lld/styles.xml').then(r => { if (!r.ok) throw new Error('styles'); return r.text(); }),
      fetch('assets/lld/theme1.xml').then(r => { if (!r.ok) throw new Error('theme'); return r.text(); })
    ]);
    downloadBlob(LLD_TPL.buildAll(ws, layout, stylesXml, themeXml), exportFileBase() + '.xlsx');
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

function buildLldPdf(ws, planJpeg, planW, planH, topoJpeg, topoW, topoH) {
  const PW = 595.28, PH = 841.89, M = 42;
  const pagesOps = [];
  let cur = null, y = 0;

  // Opérations PDF réutilisables (permettent d'ajouter des pieds de page a posteriori)
  const textOp = (x, yy, s, size = 10, bold = false, color = [0.13, 0.16, 0.22]) =>
    `BT ${color.map(c => (+c).toFixed(2)).join(' ')} rg /${bold ? 'F2' : 'F1'} ${(+size).toFixed(1)} Tf 1 0 0 1 ${(+x).toFixed(2)} ${(+yy).toFixed(2)} Tm (${pdfEsc(s)}) Tj ET`;
  const lineOp = (x1, yy, x2, color = [0.82, 0.85, 0.89], lw = 0.7) =>
    `${color.map(c => (+c).toFixed(2)).join(' ')} RG ${lw} w ${(+x1).toFixed(2)} ${(+yy).toFixed(2)} m ${(+x2).toFixed(2)} ${(+yy).toFixed(2)} l S`;

  const txt = (x, yy, s, size, bold, color) => cur.push(textOp(x, yy, s, size, bold, color));
  const rectFill = (x, yy, w, h, color) => {
    cur.push(`${color.map(c => (+c).toFixed(2)).join(' ')} rg ${(+x).toFixed(2)} ${(+yy).toFixed(2)} ${(+w).toFixed(2)} ${(+h).toFixed(2)} re f`);
  };
  const hline = (x1, x2, yy) => cur.push(lineOp(x1, yy, x2));

  const newPage = () => { cur = []; pagesOps.push(cur); y = PH - M; };

  // ---- Structure du dossier : 15 chapitres (sommaire généré à la fin) ----
  const tocEntries = [];   // {label, title, level, pageIdx} — pageIdx AVANT insertion du sommaire
  const GRAY = [0.45, 0.5, 0.58];
  function chapter(label, title, opts = {}) {
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

  const L = normLldInfo(ws);
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = new Date().toLocaleDateString('fr-FR');

  // ---- Page de garde ----
  newPage();
  y -= 60;
  txt(M, y, 'Dossier LLD', 30, true, [0.12, 0.31, 0.47]); y -= 20;
  txt(M, y, 'Low Level Design \u2014 Datacenter & Infrastructure', 12, false, [0.45, 0.5, 0.58]); y -= 36;
  txt(M, y, ws.name, 20, true); y -= 30;
  const meta = [['Client', L.client], ['Auteur', L.author], ['Version', L.version], ['Date', dateStr]];
  meta.forEach(([k, v]) => {
    if (!v) return;
    txt(M, y, k, 10, false, [0.45, 0.5, 0.58]);
    txt(M + 100, y, v, 10, true);
    y -= 16;
  });
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

  if (L.revs.length) {
    y -= 16;
    txt(M, y, 'Historique des r\u00e9visions', 12, true, [0.12, 0.31, 0.47]); y -= 8;
    const revRows = [['R\u00e9v', 'Date', 'Auteur', 'Modifications']];
    L.revs.forEach(r => revRows.push([r.rev, r.date, r.author, r.note]));
    drawTable(revRows, [0.8, 1.6, 2.4, 5.2], 8);
  }

  // Gouvernance documentaire, placée après l'historique des révisions.
  const signatoryTable = (title, rows) => {
    if (y < M + 55) newPage();
    txt(M, y, title, 11.5, true, [0.12, 0.31, 0.47]);
    y -= 8;
    const data = [['Nom', 'Position', 'Organisation', 'Version approuvée']];
    rows.forEach(r => data.push([r.name, r.position, r.organization, r.approvedVersion]));
    drawTable(data, [2.2, 2.2, 2.7, 1.9], 7.5);
  };
  signatoryTable('Approbateurs', L.approvers);
  signatoryTable('Réviseurs', L.reviewers);

  y = Math.min(y, M + 24);
  txt(M, y, 'G\u00e9n\u00e9r\u00e9 par LLDraw', 9, false, [0.6, 0.65, 0.72]);

  // ================= Chapitres (structure cible : 15 chapitres) =================

  // ---- 1. Objectif du document ----
  chapter('1', 'Objectif du document');
  if (L.objectif.trim()) paragraph(L.objectif);
  else placeholder();

  // ---- 2. Aperçu du site ----
  chapter('2', 'Aperçu du site');
  sub('2.1', 'Information sur le site');
  const sites = ws.sites || [];
  if (sites.length) {
    const sr = [['Site', 'Adresse', 'Contacts', 'Description']];
    sites.forEach(s => sr.push([s.name, s.address, s.contact, s.desc]));
    drawTable(sr, [1.5, 2.7, 2.1, 3.7], 8);
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
  } else {
    note('Aucun site d\u00e9clar\u00e9 (fiche du dossier, onglet Sites).');
  }
  sub('2.2', 'L\u2019infrastructure existante');
  if (L.existant.trim()) paragraph(L.existant);
  else placeholder();

  // ---- 3. Architecture cible ----
  chapter('3', 'Architecture cible');
  if (L.architecture.trim()) paragraph(L.architecture);
  else placeholder();
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

  // ---- 4. Conception Nomenclature et Adressage IP Global ----
  chapter('4', 'Conception Nomenclature et Adressage IP Global');
  miniTitle('Nomenclature');
  if (L.nomen.length) {
    const nr = [['Type d\u2019objet', 'Préfixe', 'Exemple', 'Règle de nommage']];
    L.nomen.forEach(r => nr.push([r.type, r.prefix, r.example, r.rule]));
    drawTable(nr, [2.4, 1.1, 2.6, 3.9], 8);
  } else note('Nomenclature non renseignée (fiche du dossier, onglet Réseau).');
  miniTitle('Registre VLANs & subnets');
  if (L.vlans.length) {
    const vr = [['VLAN', 'Nom', 'Site', 'Subnet', 'Passerelle', 'Usage']];
    L.vlans.forEach(v => vr.push([v.vid, v.name, v.site, v.subnet, v.gw, v.purpose]));
    drawTable(vr, [0.8, 2.1, 1.4, 2.6, 2.2, 2.9], 8);
  } else note('Aucun VLAN enregistré (fiche du dossier, onglet Réseau).');
  miniTitle('Plan d\u2019adressage & ports');
  const pr = portsRows(ws);
  if (pr.length > 1) drawTable(pr, [1.4, 0.9, 0.8, 1.8, 1.4, 1.6, 1.6, 0.9, 1.2]);
  else note('Aucun port étiqueté.');

  // ---- 5. Conception et Configuration FAI ----
  chapter('5', 'Conception et Configuration FAI', { flow: true });
  sub('5.1', 'Informations & Configuration');
  {
    const F = L.fai;
    const fr = [['Opérateur', F.operator], ['Offre', F.offer], ['Type de lien', F.linkType],
                ['Débit descendant', F.down], ['Débit montant', F.up],
                ['Bloc IP publiques', F.publicBlock], ['CPE (modèle)', F.cpe], ['CPE (IP)', F.cpeIp]]
      .filter(([, v]) => v && v.trim());
    if (fr.length) {
      drawTable([['Élément', 'Valeur'], ...fr], [1.5, 3.5], 8.5);
      if (F.notes.trim()) { miniTitle('Notes de configuration'); paragraph(F.notes); }
    } else placeholder();
  }
  sub('5.2', 'Câblage');
  const cabFai = cablingRowsByDomain(ws, 'fai');
  if (cabFai.length > 1) drawTable(cabFai, [1.3, 1.1, 1.5, 1.8, 1.5, 1.7, 1.5, 1.8, 1.5, 1.7]);
  else note('Aucun câble classé « FAI » (mode Câblage : domaine du câble).');

  // ---- 6. Conception et Configuration Interconnexion site 2 site ----
  chapter('6', 'Conception et Configuration Interconnexion site 2 site', { flow: true });
  sub('6.1', 'Informations & Configuration');
  {
    const I = L.interco;
    const icr = [['Technologie', I.tech], ['Endpoint public site A', I.epA], ['Endpoint public site B', I.epB],
                 ['Subnets locaux (A)', I.localSubnets], ['Subnets distants (B)', I.remoteSubnets],
                 ['Routage', I.routing], ['Chiffrement', I.encryption]]
      .filter(([, v]) => v && v.trim());
    if (icr.length) {
      drawTable([['Élément', 'Valeur'], ...icr], [1.9, 3.1], 8.5);
      if (I.notes.trim()) { miniTitle('Notes de configuration'); paragraph(I.notes); }
    } else placeholder();
  }
  sub('6.2', 'Câblage');
  const cabIc = cablingRowsByDomain(ws, 'interco');
  if (cabIc.length > 1) drawTable(cabIc, [1.3, 1.1, 1.5, 1.8, 1.5, 1.7, 1.5, 1.8, 1.5, 1.7]);
  else note('Aucun câble classé « Interconnexion » (mode Câblage : domaine du câble).');

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
    const notes = L.catNotes[dom] || '';
    if (notes.trim()) { miniTitle('Notes de configuration'); paragraph(notes); }
    if (dom === 'switching' && (L.swZones || []).length) {
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
  }

  // ---- 14. Flux réseau et diagram ----
  chapter('14', 'Flux réseau et diagram');
  miniTitle('Matrice des flux');
  const fr = flowsRows(ws);
  if (fr.length > 1) drawTable(fr, [1.7, 2.3, 2.3, 1.6, 1.4, 2.7]);
  else note('Aucun flux défini (fiche du dossier, onglet Flux).');
  miniTitle('Diagramme de topologie');
  if (topoJpeg && topoW && topoH) {
    const availW = PW - 2 * M, availH = y - M - 10;
    const k = Math.min(availW / topoW, availH / topoH);
    const iw = topoW * k, ih = topoH * k;
    const ix = M + (availW - iw) / 2, iy = y - ih;
    cur.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im1 Do Q`);
  } else {
    note('Diagramme de topologie non généré (vue Topologie du workspace).');
  }

  // ---- 15. Câblage / Rack ----
  chapter('15', 'C\u00e2blage / Rack');
  miniTitle('Synthèse des racks (capacités)');
  drawTable(racksRows(ws), [2.4, 1.1, 0.9, 1, 0.9, 1.5, 1.5, 1.4, 1.4, 1]);
  miniTitle('Tableau de c\u00e2blage');
  const cr = cablingRows(ws);
  if (cr.length > 1) drawTable(cr, [1.1, 0.8, 1.15, 1.3, 1.55, 1.3, 1.5, 1.3, 1.55, 1.3, 1.5]);
  else note('Aucun câble.');
  if (planJpeg && planW && planH) {
    newPage();
    miniTitle('\u00c9l\u00e9vations des racks');
    const availW = PW - 2 * M, availH = y - M - 10;
    const k = Math.min(availW / planW, availH / planH);
    const iw = planW * k, ih = planH * k;
    const ix = M + (availW - iw) / 2, iy = y - ih;
    cur.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q`);
  }

  // Toute fin du dossier : détail du câblage pour chaque device posé.
  const placedDevices = sortedRackInstances(ws);
  if (placedDevices.length) {
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
  const img0Num = firstPageObj + 2 * nPages;
  const img1Num = img0Num + 1;

  addObj(`<< /Type /Catalog /Pages 2 0 R >>`);
  const kids = pagesOps.map((_, i) => `${firstPageObj + i} 0 R`).join(' ');
  addObj(`<< /Type /Pages /Count ${nPages} /Kids [${kids}] >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  pagesOps.forEach((ops, i) => {
    // Une seule entrée /XObject pour les deux images (topologie + élévations) :
    // définir la clé deux fois rend l'image d'élévations invisible selon les lecteurs.
    const xobjs = [];
    if (hasPlan) xobjs.push(`/Im0 ${img0Num} 0 R`);
    if (hasTopo) xobjs.push(`/Im1 ${img1Num} 0 R`);
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

$('#export-lld').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = active();
  if (!ws || !ws.racks.length) { lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '📄 Export LLD (PDF)' }); return; }
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
  const u8 = buildLldPdf(ws, jpeg, w, h, tj, tw, th);
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
    openLldModal();
    lldShowTab(r.type === 'site' ? 'sites' : 'flux');
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
