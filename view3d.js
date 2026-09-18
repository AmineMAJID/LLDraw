/* ============================================================
   LLDraw — Vue 3D immersive des baies
   ------------------------------------------------------------
   Module ES chargé après app.js (globals partagés : active(),
   saveState(), escapeHtml(), catLabel(), …).
   Rendu Three.js (WebGL) : baies 19", devices texturés (photo
   de face + panneau arrière procédural), câbles 3D colorés par
   domaine, orbit caméra (avant / arrière / dessus / allée).
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ---------------- Constantes physiques (mètres) ---------------- */
const U_M     = 0.04445;         // 1U
const RACK_W_M = 0.60;            // largeur hors-tout d'une baie 19" (mètres)
const RACK_D  = 1.00;            // profondeur
const BASE_H  = 0.10;            // socle
const TOP_H   = 0.05;            // capot
const INNER_W = 0.4826;          // largeur utile 19"
const POST    = 0.05;
const PX2M    = 0.0035;          // coordonnées board (px) -> monde (m)

const SCENERY = { bg: 0xe8ecf2, fog: 0.009 };   // salle blanche lumineuse

const DOMAIN_COLORS = {
  '':         '#6b7280',
  fai:        '#e11d48',
  interco:    '#9333ea',
  firewall:   '#f97316',
  switching:  '#2563eb',
  server:     '#16a34a',
  storage:    '#eab308',
  ids:        '#fb7185',
  cctv:       '#22d3ee',
  pointage:   '#facc15'
};

const CAT_ACCENT = {
  router: '#38bdf8', firewall: '#f87171', switch: '#60a5fa', ap: '#34d399',
  server: '#a78bfa', storage: '#fbbf24', ids: '#fb7185', cctv: '#22d3ee',
  pointage: '#facc15', ups: '#4ade80', patch: '#94a3b8', other: '#64748b'
};

/* ---------------- État du module ---------------- */
let renderer = null, scene = null, camera = null, controls = null, envTex = null;
let rafId = 0;
let world = null;                        // groupe racine reconstruit à chaque refresh
let clock = new THREE.Clock();
let active3d = false;
let refreshTimer = null;
let camTween = null;

let pickables = [];                      // meshes raycastables
let portIndex = new Map();               // "rack|inst|port" -> info monde
let cableById = new Map();               // id -> cable (state)
let tubeByCable = new Map();             // id -> mesh tube
let cableAnchors = new Map();            // id -> [{pos, face}, {pos, face}]
let leds = [];                           // LEDs clignotantes {mat, phase, speed}
let nameplates = [];                     // sprites étiquettes
let deviceMeshes = [];                   // boîtes devices (survol)
let deviceByMesh = new Map();            // mesh box -> {rack, inst}
let hoverRing = null, focusRings = [];
let layout = { racks: [], center: new THREE.Vector3(), radius: 2, rearZ: -1 };

let pointerPix = { x: 0, y: 0, inside: false, dirty: false };
let downPix = null;                      // distinguer clic vs orbite
let hovered = null;                      // {type, ...}
let focusCableId = null;
let domainFilter = '';

let photoCache = new Map();              // dataURL -> {tex, users:Set}
const texLoader = new THREE.TextureLoader();

/* Raccourcis vers app.js (déclaré avant ce module) */
const app = {
  ws:        () => (typeof active === 'function' ? active() : null),
  esc:       (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '')),
  catLabel:  (c) => (typeof catLabel === 'function' ? catLabel(c) : ''),
  catIcon:   (c) => (typeof catIcon === 'function' ? catIcon(c) : '📦'),
  domLabel:  (d) => (typeof cableDomainLabel === 'function' ? cableDomainLabel(d) : (d || 'Général')),
  siteName:  (ws, r) => (typeof siteName === 'function' ? siteName(ws, r) : ''),
  siteColor: (ws, r) => (typeof siteColor === 'function' ? siteColor(ws, r) : null),
  save:      () => (typeof saveState === 'function' ? saveState() : null)
};

/* ============================================================
   Initialisation renderer / scène
   ============================================================ */
function ensureRenderer() {
  if (renderer) return;
  const holder = document.getElementById('v3d-canvas');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  holder.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENERY.bg);
  scene.fog = new THREE.FogExp2(SCENERY.bg, SCENERY.fog);

  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  camera.position.set(3.2, 2.2, 4.5);

  // Éclairage d'ambiance par environnement (reflets métallo)
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.6;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.4;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI * 0.495;   // ne pas passer sous le sol
  controls.autoRotateSpeed = 0.7;
  controls.target.set(0, 1.0, 0);

  const ro = new ResizeObserver(resize);
  ro.observe(document.getElementById('board-viewport'));
  window.addEventListener('resize', resize);

  bindPointer(renderer.domElement);
  bindToolbar();
}

function resize() {
  if (!renderer) return;
  const vp = document.getElementById('board-viewport');
  const w = Math.max(vp.clientWidth, 2), h = Math.max(vp.clientHeight, 2);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ============================================================
   Fabrication : sol, plafond, lumière
   ============================================================ */
function makeFloorTexture(rackRects, fs) {
  const S = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const w2p = S / fs;   // m -> px

  // Dalle technique claire
  ctx.fillStyle = '#d7dbdf';
  ctx.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Grandes variations douces (usure, reflets)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = rnd() * 190 + 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() > 0.5;
    g.addColorStop(0, light ? 'rgba(255,255,255,0.055)' : 'rgba(96,104,114,0.045)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Dalles 600 mm : légère variation par tuile
  const tile = 0.6 * w2p;
  for (let ty = 0; ty * tile < S; ty++) {
    for (let tx = 0; tx * tile < S; tx++) {
      const v = rnd();
      if (v > 0.72) {
        ctx.fillStyle = `rgba(255,255,255,${((v - 0.72) * 0.10 + 0.008).toFixed(3)})`;
        ctx.fillRect(tx * tile, ty * tile, tile, tile);
      } else if (v < 0.16) {
        ctx.fillStyle = `rgba(90,98,110,${((0.16 - v) * 0.22 + 0.008).toFixed(3)})`;
        ctx.fillRect(tx * tile, ty * tile, tile, tile);
      }
    }
  }
  // Grain fin
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * S, y = rnd() * S, r = rnd() * 1.4 + 0.3;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.050)' : 'rgba(0,0,0,0.035)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Joints blancs entre dalles + ombre portée du joint
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.4;
  for (let p = 0; p <= S + tile; p += tile) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70,78,90,0.16)';
  ctx.lineWidth = 1;
  for (let p = 0; p <= S + tile; p += tile) {
    ctx.beginPath(); ctx.moveTo(p + 1.4, 0); ctx.lineTo(p + 1.4, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 1.4); ctx.lineTo(S, p + 1.4); ctx.stroke();
  }
  // Joints de structure tous les 3 m
  ctx.strokeStyle = 'rgba(60,68,80,0.20)';
  ctx.lineWidth = 2.5;
  for (let p = 0; p <= S + 3 * w2p; p += 3 * w2p) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  // Marquage de sécurité jaune autour des baies
  ctx.strokeStyle = '#c9a233';
  ctx.lineWidth = Math.max(3, 0.05 * w2p);
  ctx.setLineDash([0.3 * w2p, 0.18 * w2p]);
  const M = 0.55;   // marge autour d'une baie
  for (const r of rackRects) {
    const x1 = (r.x1 - M + fs / 2) * w2p, z1 = (r.z1 - M + fs / 2) * w2p;
    const x2 = (r.x2 + M + fs / 2) * w2p, z2 = (r.z2 + M + fs / 2) * w2p;
    ctx.strokeRect(x1, z1, x2 - x1, z2 - z1);
  }
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}
function makeWallTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#e2e7ee');
  g.addColorStop(0.72, '#eef1f5');
  g.addColorStop(1, '#f3f5f8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  let seed = 11;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(70,80,95,0.02)';
    ctx.fillRect(rnd() * 512, rnd() * 512, rnd() * 26 + 2, 1);
  }
  // Bande technique + plinthe en pied de mur
  ctx.fillStyle = 'rgba(120,130,145,0.10)';
  ctx.fillRect(0, 430, 512, 3);
  ctx.fillStyle = '#99a1ac';
  ctx.fillRect(0, 494, 512, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0, 491, 512, 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function buildEnvironment(root, fs, rackRects) {
  const c = layout.center;
  const span = Math.max(fs, 18);       // la salle couvre le sol
  const H = 3.2;                       // hauteur sous plafond

  // Sol clair (dalle technique)
  const floorGeo = new THREE.PlaneGeometry(fs, fs);
  const floorMat = new THREE.MeshStandardMaterial({
    map: makeFloorTexture(rackRects, fs),
    roughness: 0.52, metalness: 0.06, envMapIntensity: 0.7
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // Murs blancs texturés (visibles depuis l'intérieur de la salle)
  const wallTex = makeWallTexture();
  wallTex.repeat.set(Math.max(4, Math.round(span / 3.2)), 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.94, metalness: 0.0 });
  const mkWall = (x, z, ry) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(span, H), wallMat);
    w.position.set(x, H / 2, z);
    w.rotation.y = ry;
    w.receiveShadow = true;
    root.add(w);
  };
  mkWall(c.x, c.z - span / 2, 0);            // fond (face +z)
  mkWall(c.x, c.z + span / 2, Math.PI);      // face -z
  mkWall(c.x + span / 2, c.z, -Math.PI / 2); // face -x
  mkWall(c.x - span / 2, c.z, Math.PI / 2);  // face +x

  // Plafond blanc
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshStandardMaterial({ color: 0xf3f5f8, roughness: 0.96 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(c.x, H, c.z);
  root.add(ceil);

  // Dalles lumineuses blanches encastrées (2 colonnes, rangées régulières)
  const fixGeo = new THREE.BoxGeometry(1.25, 0.035, 0.55);
  const fixMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.55
  });
  const rows = Math.min(14, Math.max(6, Math.round(span / 2.4)));
  for (let i = 0; i < rows; i++) {
    for (let col = -1; col <= 1; col += 2) {
      const fix = new THREE.Mesh(fixGeo, fixMat);
      fix.position.set(
        c.x + col * 2.1,
        H - 0.035,
        c.z + (i - (rows - 1) / 2) * 2.4
      );
      root.add(fix);
    }
  }

  // Chemin de câbles au-dessus de l'allée arrière
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xb9bfc8, roughness: 0.45, metalness: 0.75 });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(span * 0.8, 0.025, 0.45), trayMat);
  tray.position.set(c.x, 2.72, layout.rearZ - 0.55);
  tray.castShadow = true;
  root.add(tray);

  // Lumières : salle claire et homogène
  const hemi = new THREE.HemisphereLight(0xf4f7ff, 0xd6d9de, 0.95);
  root.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(c.x + 7, 10, c.z + 5);
  key.target.position.copy(c);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera, R = layout.radius + 3;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
  sc.near = 1; sc.far = 40;
  root.add(key); root.add(key.target);

  const fill = new THREE.DirectionalLight(0xe8eeff, 0.85);
  fill.position.set(c.x - 6, 6, c.z - 7);
  root.add(fill);
}
/* ============================================================
   Fabrication : une baie (frame, panneaux, PDU, guides câbles)
   ============================================================ */
function rackTotalH(sizeU) { return BASE_H + sizeU * U_M + TOP_H; }

function buildRack(root, ws, rack, wx, wz) {
  const g = new THREE.Group();
  g.position.set(wx, 0, wz);
  const nU = rack.sizeU || 12;
  const H = rackTotalH(nU);
  const hw = RACK_W_M / 2, hd = RACK_D / 2;

  const postMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.35, metalness: 0.85 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.45, metalness: 0.7 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5, metalness: 0.6 });

  const postGeo = new THREE.BoxGeometry(POST, H, POST);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(sx * (hw - POST / 2), H / 2, sz * (hd - POST / 2));
    p.castShadow = true;
    g.add(p);
  }
  // Socle + capot
  const base = new THREE.Mesh(new THREE.BoxGeometry(RACK_W_M, BASE_H, RACK_D - 0.02), panelMat);
  base.position.y = BASE_H / 2; base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(RACK_W_M, TOP_H, RACK_D), panelMat);
  cap.position.y = H - TOP_H / 2; cap.castShadow = true;
  g.add(cap);

  // Panneaux latéraux
  const sideGeo = new THREE.BoxGeometry(0.012, H - 0.07, RACK_D - 0.02);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(sideGeo, panelMat);
    s.position.set(sx * (hw - 0.006), H / 2 - 0.015, 0);
    s.castShadow = true; s.receiveShadow = true;
    g.add(s);
  }

  // Guides de câbles verticaux (arrière) + anneaux D
  const ductGeo = new THREE.BoxGeometry(0.05, H - 0.18, 0.04);
  const ringGeo = new THREE.TorusGeometry(0.026, 0.005, 8, 20);
  for (const sx of [-1, 1]) {
    const duct = new THREE.Mesh(ductGeo, darkMat);
    duct.position.set(sx * 0.19, H / 2, -(hd - 0.07));
    g.add(duct);
    for (let k = 0; k < 4; k++) {
      const ring = new THREE.Mesh(ringGeo, postMat);
      ring.position.set(sx * 0.19, BASE_H + 0.25 + k * ((H - BASE_H - 0.5) / 3), -(hd - 0.10));
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
    }
  }

  // PDU verticales (arrière)
  const pduTex = pduTexture();
  const pduMat = new THREE.MeshStandardMaterial({ map: pduTex, roughness: 0.55, metalness: 0.4 });
  const pduGeo = new THREE.BoxGeometry(0.038, H - 0.3, 0.024);
  for (const sx of [-1, 1]) {
    const pdu = new THREE.Mesh(pduGeo, pduMat);
    pdu.position.set(sx * 0.235, H / 2 - 0.05, -(hd - 0.035));
    g.add(pdu);
  }

  // LED d'identification site (face avant, en haut)
  const sc = app.siteColor(ws, rack);
  if (sc) {
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(sc) });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), ledMat);
    led.position.set(0, H - TOP_H - 0.006, hd - 0.012);
    g.add(led);
    leds.push({ mat: ledMat, phase: Math.random() * 6, speed: 1.2 });
  }

  // Étiquette flottante
  const site = app.siteName(ws, rack);
  const sprite = makeLabelSprite(rack.name || 'Rack', site, sc || '#2563eb');
  sprite.position.set(0, H + 0.07, 0);
  g.add(sprite);
  nameplates.push(sprite);

  root.add(g);
  return { group: g, height: H };
}

let _pduTex = null;
function pduTexture() {
  if (_pduTex) return _pduTex;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#191b1f'; ctx.fillRect(0, 0, 64, 512);
  for (let y = 20; y < 500; y += 42) {
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(14, y, 15, 22); ctx.fillRect(35, y, 15, 22);
    ctx.fillStyle = '#2c2f35';
    ctx.fillRect(17, y + 4, 9, 6); ctx.fillRect(38, y + 4, 9, 6);
    ctx.fillRect(17, y + 13, 9, 6); ctx.fillRect(38, y + 13, 9, 6);
  }
  _pduTex = new THREE.CanvasTexture(cv);
  _pduTex.colorSpace = THREE.SRGBColorSpace;
  return _pduTex;
}

/* ============================================================
   Fabrication : devices (face avant photo / arrière procédural)
   ============================================================ */
function deviceDepth(cat) {
  switch (cat) {
    case 'server': case 'storage': return 0.66;
    case 'ups': return 0.55;
    case 'patch': return 0.24;
    case 'ap': return 0.30;
    default: return 0.42;
  }
}

function getPhotoTexture(dataURL, mat) {
  if (!dataURL) return null;
  let entry = photoCache.get(dataURL);
  if (!entry) {
    if (photoCache.size > 80) photoCache.clear();
    const tex = texLoader.load(dataURL, () => {
      entry.users.forEach(m => { m.needsUpdate = true; });
    });
    tex.userData.shared = true;   // en cache partagé : jamais disposé
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    entry = { tex, users: new Set() };
    photoCache.set(dataURL, entry);
  }
  if (mat) entry.users.add(mat);
  return entry.tex;
}

function instPhoto(inst) {
  if (inst.photo) return inst.photo;
  const dev = (typeof state !== 'undefined' && state.devices) ?
    state.devices.find(d => d.id === inst.deviceId) : null;
  return dev ? dev.photo : null;
}

/* Face avant procédurale (fallback sans photo) */
function frontFallbackTexture(inst) {
  const w = 1024, h = Math.max(96, Math.round(1024 * (inst.sizeU * U_M) / INNER_W));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a2d33'); grad.addColorStop(1, '#1c1e23');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  const accent = CAT_ACCENT[normCat(inst.cat)] || '#64748b';
  ctx.fillStyle = accent; ctx.fillRect(0, 0, w, Math.max(6, h * 0.05));
  // ouïes
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const rows = Math.max(2, Math.floor(h / 60) - 1);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < 14; k++) {
      const x = 40 + k * ((w - 80) / 14), y = h * 0.22 + r * (h * 0.7 / rows);
      roundRect(ctx, x, y, (w - 80) / 14 - 12, Math.min(14, h * 0.08), 4, true, false);
    }
  }
  ctx.fillStyle = '#e8eaf0';
  ctx.font = `700 ${Math.min(64, h * 0.30)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText((inst.name || '').slice(0, 24), 28, h * 0.08 + 4);
  if (h > 130) {
    ctx.fillStyle = '#9aa1ad';
    ctx.font = `500 ${Math.min(34, h * 0.16)}px Inter, system-ui, sans-serif`;
    ctx.fillText(`${inst.brand || ''} ${inst.model || ''}`.trim().slice(0, 34), 30, h * 0.42);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/* Position des ports (u,v normalisés, v=0 en haut).
   Reproduit EXACTEMENT la vue Élévations : le centre du port est à
   (xPct %, yPct %) de la face du device (cf. app.js : style.left/top).
   Repli : distribution en grille si un port n'a pas de coordonnées. */
function portLayout(inst) {
  const ports = inst.ports || [];
  const n = ports.length;
  if (!n) return [];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  if (ports.every(p => Number.isFinite(p.xPct) && Number.isFinite(p.yPct))) {
    return ports.map(p => ({
      port: p,
      u: clamp(p.xPct / 100, 0.03, 0.97),
      v: clamp(p.yPct / 100, 0.05, 0.95)
    }));
  }
  const out = [];
  const perRow = n === 1 ? 1 : Math.min(n, inst.sizeU >= 2 ? 12 : Math.max(4, Math.min(10, n)));
  const rows = Math.ceil(n / perRow);
  const cellU = 0.88 / Math.max(perRow - 1, 1);
  const rowV = Math.min(0.34, 0.8 / Math.max(rows, 1));
  const vC = inst.sizeU <= 1 ? 0.5 : 0.60;
  ports.forEach((p, i) => {
    const r = Math.floor(i / perRow), cIdx = i % perRow;
    const rowCount = Math.min(perRow, n - r * perRow);
    const u = 0.5 + (cIdx - (rowCount - 1) / 2) * cellU;
    const v = vC + (r - (rows - 1) / 2) * rowV;
    out.push({ port: p, u: clamp(u, 0.04, 0.96), v: clamp(v, 0.04, 0.96) });
  });
  return out;
}

function portKind(inst, port) {
  const nm = String(port.name || port.label || '').toLowerCase();
  if (nm.includes('sfp') || nm.includes('qsfp') || (port.size || 1) >= 1.5) return 'sfp';
  if (nm.includes('pwr') || nm.includes('psu') || nm.includes('alim')) return 'power';
  if (nm.includes('con') || nm.includes('usb')) return 'usb';
  if (nm.includes('tone') || nm.includes('rj11')) return 'rj11';
  return 'rj45';
}

/* Panneau arrière procédural */
function backTexture(inst, layoutPorts, cableColorByPort) {
  const hM = inst.sizeU * U_M;
  const w = 1024;
  const h = Math.max(72, Math.min(1024, Math.round(w * hM / INNER_W)));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  // Tôle brossée sombre
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#22242a'); grad.addColorStop(0.5, '#1b1d22'); grad.addColorStop(1, '#17181d');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  let seed = 3; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 500; i++) ctx.fillRect(rnd() * w, rnd() * h, rnd() * 40 + 4, 1);

  const cat = normCat(inst.cat);
  const px = u => u * w, py = v => v * h;

  // Blocs d'alimentation (devices >= 2U, sauf brassage/UPS)
  if (inst.sizeU >= 2 && !['patch', 'ups', 'ap'].includes(cat)) {
    for (const u of [0.16, 0.84]) {
      const x = px(u) - w * 0.075, y = py(0.10), pw = w * 0.15, ph = h * 0.30;
      ctx.fillStyle = '#131418'; roundRect(ctx, x, y, pw, ph, 8, true, false);
      ctx.strokeStyle = '#2e3239'; ctx.lineWidth = 2; roundRect(ctx, x, y, pw, ph, 8, false, true);
      // poignée
      ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 5;
      roundRect(ctx, x + pw * 0.2, y + ph * 0.15, pw * 0.6, ph * 0.28, 6, false, true);
      // LED verte
      ctx.fillStyle = '#39d98a';
      ctx.beginPath(); ctx.arc(x + pw * 0.5, y + ph * 0.72, Math.max(3, h * 0.018), 0, Math.PI * 2); ctx.fill();
      ctx.font = `600 ${Math.max(9, h * 0.05)}px Inter, system-ui`;
      ctx.fillStyle = '#7d838d'; ctx.textAlign = 'center';
      ctx.fillText(u < 0.5 ? 'PSU1' : 'PSU2', px(u), y + ph + h * 0.055);
    }
  }

  // Ventilation centrale (serveurs/stockage)
  if (['server', 'storage', 'ids'].includes(cat) && inst.sizeU >= 2 && h > 220) {
    const cx = px(0.5), cy = py(0.22), R = Math.min(w, h) * 0.10;
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 3;
    for (let a = 0; a < 8; a++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a * Math.PI / 4 + 0.25, a * Math.PI / 4 + 1.1);
      ctx.stroke();
    }
  }

  // UPS : prises IEC au lieu de ports réseau
  if (cat === 'ups') {
    ctx.fillStyle = '#0d0e11';
    for (let r = 0; r < Math.max(2, inst.sizeU); r++) {
      for (let k = 0; k < 8; k++) {
        const x = px(0.10 + k * 0.114), y = py(0.35 + (r % 2) * 0.3);
        roundRect(ctx, x, y, w * 0.07, h * 0.22, 5, true, false);
        ctx.fillStyle = '#26292f';
        ctx.fillRect(x + w * 0.014, y + h * 0.06, w * 0.016, h * 0.09);
        ctx.fillRect(x + w * 0.04, y + h * 0.06, w * 0.016, h * 0.09);
        ctx.fillStyle = '#0d0e11';
      }
    }
  }

  // Connecteurs de ports
  const cellW = w * 0.075, cellH = Math.min(h * 0.34, cellW);
  for (const item of layoutPorts) {
    const { u, v, port } = item;
    const cx = px(u), cy = py(v);
    const kind = portKind(inst, port);
    const kw = kind === 'sfp' ? cellW * 1.15 : cellW;
    const x = cx - kw / 2, y = cy - cellH / 2;
    // logement
    ctx.fillStyle = '#0c0d10'; roundRect(ctx, x, y, kw, cellH, 5, true, false);
    ctx.strokeStyle = '#33373e'; ctx.lineWidth = 1.5; roundRect(ctx, x, y, kw, cellH, 5, false, true);

    const col = cableColorByPort.get(port.id);
    if (kind === 'rj45' || kind === 'rj11') {
      const jw = kw * (kind === 'rj11' ? 0.4 : 0.62), jh = cellH * 0.55;
      ctx.fillStyle = col || '#1f2126';
      roundRect(ctx, cx - jw / 2, cy - jh / 2, jw, jh, 3, true, false);
      ctx.fillStyle = '#c9a227';   // contacts dorés
      ctx.fillRect(cx - jw * 0.32, cy - jh * 0.42, jw * 0.64, jh * 0.2);
      if (col) { ctx.fillStyle = col; ctx.fillRect(cx - jw / 2, cy + jh / 2 - 2, jw, 3); }
    } else if (kind === 'sfp') {
      const jw = kw * 0.8, jh = cellH * 0.5;
      ctx.fillStyle = col || '#23262b';
      roundRect(ctx, cx - jw / 2, cy - jh / 2, jw, jh, 3, true, false);
      ctx.fillStyle = col || '#3a3f47';
      ctx.fillRect(cx - jw * 0.12, cy - jh * 0.85, jw * 0.24, jh * 0.35);  // latch
      if (col) { ctx.fillStyle = col; ctx.fillRect(cx - jw / 2, cy + jh / 2 - 2, jw, 3); }
    } else if (kind === 'power') {
      ctx.fillStyle = '#1a1c20';
      roundRect(ctx, cx - kw * 0.32, cy - cellH * 0.28, kw * 0.64, cellH * 0.56, 4, true, false);
      ctx.fillStyle = '#0a0b0d';
      ctx.beginPath(); ctx.arc(cx - kw * 0.12, cy, cellH * 0.09, 0, Math.PI * 2); ctx.arc(cx + kw * 0.12, cy, cellH * 0.09, 0, Math.PI * 2); ctx.fill();
    } else { // usb
      ctx.fillStyle = col || '#26292f';
      roundRect(ctx, cx - kw * 0.22, cy - cellH * 0.2, kw * 0.44, cellH * 0.4, 3, true, false);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function buildDevice(root, ws, rack, rackH, inst, wx, wz) {
  const nU = rack.sizeU || 12;
  const cat = normCat(inst.cat);
  const depth = deviceDepth(cat);
  const sizeU = Math.max(1, inst.sizeU || 1);
  const topY = BASE_H + (nU - inst.slot) * U_M - 0.002;
  const h = sizeU * U_M - 0.004;
  const cy = topY - h / 2;
  const zFront = RACK_D / 2 - 0.06;
  const bz = zFront - depth / 2;       // centre en z (repère baie)

  const g = new THREE.Group();
  g.position.set(wx, cy, wz + bz);

  // Couleur de câble par port (pour teinter les connecteurs arrière)
  const cableColorByPort = new Map();
  for (const c of app.ws()?.cables || []) {
    for (const end of [c.a, c.b]) {
      if (end && end.instId === inst.id && end.portId) {
        if (!cableColorByPort.has(end.portId)) cableColorByPort.set(end.portId, cableDisplayColor(c));
      }
    }
  }

  const layoutPorts = portLayout(inst);
  const frontTex = getPhotoTexture(instPhoto(inst), null);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.4, metalness: 0.7 });
  const frontTexFinal = frontTex || frontFallbackTexture(inst);
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTexFinal,
    roughness: 0.55, metalness: 0.25, envMapIntensity: 0.7,
    emissive: 0xffffff, emissiveMap: frontTex ? null : frontTexFinal,
    emissiveIntensity: frontTex ? 0.0 : 0.30
  });
  const backTex = backTexture(inst, layoutPorts, cableColorByPort);
  const backMat = new THREE.MeshStandardMaterial({
    map: backTex,
    roughness: 0.5, metalness: 0.45, envMapIntensity: 0.7,
    // Panneau auto-éclairé (texture en emissiveMap) : les connecteurs,
    // PSUs et LED restent lisibles même à contre-jour depuis l'allée arrière.
    emissive: 0xffffff, emissiveMap: backTex, emissiveIntensity: 0.42
  });
  const mats = [sideMat, sideMat, sideMat, sideMat, frontMat, backMat];
  const geo = new THREE.BoxGeometry(INNER_W - 0.008, h, depth);
  const box = new THREE.Mesh(geo, mats);
  box.castShadow = true; box.receiveShadow = true;
  box.userData = { type: 'device', rackId: rack.id, instId: inst.id };
  g.add(box);
  pickables.push(box);
  deviceMeshes.push(box);
  deviceByMesh.set(box, { rack, inst, mats });

  // Oreilles de montage
  const earGeo = new THREE.BoxGeometry(0.018, h, 0.03);
  const earMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.45, metalness: 0.7 });
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, earMat);
    ear.position.set(sx * (INNER_W / 2 + 0.008), 0, depth / 2 - 0.015);
    ear.castShadow = true;
    g.add(ear);
  }

  // LEDs d'activité en face avant
  const ledZ = depth / 2 + 0.002;
  const ledGeo = new THREE.CircleGeometry(0.0035, 10);
  const mk = (color, x, y, speed) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const led = new THREE.Mesh(ledGeo, m);
    led.position.set(x, y, ledZ);
    g.add(led);
    leds.push({ mat: m, phase: Math.random() * 6.28, speed });
  };
  mk(0x2bff88, INNER_W / 2 - 0.05, h / 2 - 0.014, 3.5 + Math.random() * 3);
  if (sizeU >= 1) mk(0xffb020, INNER_W / 2 - 0.035, h / 2 - 0.014, 5 + Math.random() * 4);

  // Colliders invisibles par port, sur les DEUX faces : les équipements
  // actifs se câblent en FAÇADE ; un panneau de brassage / à balais est
  // traversé (le cordon qui continue ressort À L'ARRIÈRE du panneau).
  const colMat = new THREE.MeshBasicMaterial({ visible: false });
  const colGeo = new THREE.BoxGeometry(0.030, 0.030, 0.014);
  g.updateMatrixWorld(true);
  for (const item of layoutPorts) {
    const px = (item.u - 0.5) * (INNER_W - 0.008);
    const py = h / 2 - item.v * h;
    const key = `${rack.id}|${inst.id}|${item.port.id}`;
    let entry = portIndex.get(key);
    if (!entry) {
      entry = { rack, inst, port: item.port, kind: portKind(inst, item.port), u: item.u, v: item.v };
      portIndex.set(key, entry);
    }
    for (const face of ['front', 'rear']) {
      const pz = face === 'front' ? depth / 2 + 0.005 : -depth / 2 - 0.005;
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(px, py, pz);
      col.userData = { type: 'port', rackId: rack.id, instId: inst.id, portId: item.port.id, face };
      g.add(col);
      pickables.push(col);
      const world3 = col.getWorldPosition(new THREE.Vector3());
      if (face === 'front') entry.posFront = world3; else entry.posRear = world3;
    }
  }

  root.add(g);
  return g;
}

/* ============================================================
   Fabrication : câbles 3D
   ============================================================ */
function cableDisplayColor(c) {
  return c.color || DOMAIN_COLORS[c.domain] || DOMAIN_COLORS[''];
}

function buildCables(root, ws) {
  let i = 0;
  for (const c of ws.cables || []) {
    cableById.set(c.id, c);
    const ea = resolve3d(ws, c.a), eb = resolve3d(ws, c.b);
    if (!ea || !eb) continue;
    const pa = portIndex.get(`${ea.rack.id}|${ea.inst.id}|${ea.port.id}`);
    const pb = portIndex.get(`${eb.rack.id}|${eb.inst.id}|${eb.port.id}`);
    if (!pa || !pb) continue;
    // Face de branchement de chaque extrémité : un panneau de brassage est
    // TRAVERSÉ — le cordon branché devant par un équipement actif ressort
    // derrière le panneau quand il poursuit vers un équipement passif.
    const patchA = normCat(ea.inst.cat) === 'patch';
    const patchB = normCat(eb.inst.cat) === 'patch';
    const faceA = !patchA ? 'front' : (patchB ? 'rear' : 'front');
    const faceB = !patchB ? 'front' : (patchA ? 'rear' : 'front');
    let pts = cableWaypoints(pa, pb, faceA, faceB, i);
    // Supprimer les points confondus (tangente nulle -> TubeGeometry NaN)
    pts = pts.filter((p, k) => k === 0 || p.distanceToSquared(pts[k - 1]) > 4e-6);
    if (pts.length < 2) continue;
    // Coordonnées valides uniquement
    if (pts.some(p => !Number.isFinite(p.x + p.y + p.z))) {
      console.warn('[3D] câble ignoré (coordonnées invalides) :', c.name);
      continue;
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    if (!Number.isFinite(len) || len < 0.02) continue;
    const seg = Math.min(220, Math.max(28, Math.round(len * 30)));
    const thick = /alim|pwr|power/i.test(c.name || '') ? 0.008 : 0.0055;
    let geo;
    try {
      geo = new THREE.TubeGeometry(curve, seg, thick, 8, false);
    } catch (err) {
      console.warn('[3D] câble ignoré (courbe dégénérée) :', c.name, err);
      continue;
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(cableDisplayColor(c)),
      roughness: 0.42, metalness: 0.05,
      clearcoat: 0.6, clearcoatRoughness: 0.3,
      transparent: true, opacity: 1
    });
    const tube = new THREE.Mesh(geo, mat);
    tube.userData = { type: 'cable', cableId: c.id };
    root.add(tube);
    pickables.push(tube);
    tubeByCable.set(c.id, tube);
    cableAnchors.set(c.id, [
      { pos: pa[faceA === 'front' ? 'posFront' : 'posRear'], face: faceA },
      { pos: pb[faceB === 'front' ? 'posFront' : 'posRear'], face: faceB }
    ]);
    i++;
  }
}

/* ---------- Routage réaliste des cordons ----------
   PRINCIPE (photo d'une vraie baie) :
   - Le cordon SORT du port à la position exacte de la vue Élévations
     (xPct/yPct), puis monte ou descend VERTICALEMENT en colonne, juste
     devant la face du device, et entre dans le port de destination.
   - Câble vers un PANNEAU À BROSSE / de brassage : le cordon entre devant
     le panneau (au niveau du repère porté par le câble), TRAVERSE le
     panneau et repart derrière dans le guide vertical jusqu'au sol
     (le lien permanent continue dans le chemin de câbles).
   - Inter-baies : descente par le guide arrière, traversée au sol de
     l'allée arrière, remontée dans la baie de destination. */
const ACTIVE_CATS = new Set(['switch', 'router', 'firewall']);
const FRONT_CH_X = 0.225;   // canal vertical avant (repère baie)
const REAR_CH_X  = 0.19;    // guide vertical arrière
const SIDE_IN_X  = 0.245;   // passage intérieur le long des rails
const FACE_D     = RACK_D / 2 - 0.06;  // plan des faces avant des devices
const FLOOR_Y    = 0.045;   // hauteur d'un cordon au sol

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function rackPos3d(rack) {
  return rackPositions.get(rack.id) || { wx: 0, wz: 0 };
}

/* Plan z des cordons devant la face (empilement 4 couches ~1 cm) */
function cordZ(wz, idx) {
  return wz + FACE_D + 0.008 + (idx % 4) * 0.0035;
}

/* Écartement horizontal des colonnes verticales (faisceau parallèle) */
function fanX(idx) {
  return (((idx * 29) % 7) - 3) * 0.0055;
}

function cableWaypoints(pa, pb, fa, fb, idx) {
  const A = { pos: pa[fa === 'front' ? 'posFront' : 'posRear'], u: pa.u, inst: pa.inst };
  const B = { pos: pb[fb === 'front' ? 'posFront' : 'posRear'], u: pb.u, inst: pb.inst };
  const patchA = normCat(pa.inst.cat) === 'patch';
  const patchB = normCat(pb.inst.cat) === 'patch';
  const ra = rackPos3d(pa.rack), rb = rackPos3d(pb.rack);
  const dy0 = B.pos.y - A.pos.y;
  const dirY = dy0 >= 0 ? 1 : -1;
  const fan = fanX(idx);

  /* ---------- Même baie ---------- */
  if (pa.rack === pb.rack) {
    const wz = ra.wz;
    const zF = cordZ(wz, idx);

    // Cordon vertical devant les faces : A -> colonne -> B
    const frontCord = () => {
      const xMid = (A.pos.x + B.pos.x) / 2 + fan;
      const s = Math.min(0.05, Math.abs(dy0) * 0.35);
      return [
        v3(A.pos.x, A.pos.y, zF + 0.008),       // sortie droite du port
        v3(xMid, A.pos.y + dirY * s, zF),       // coude vers la colonne
        v3(xMid, B.pos.y - dirY * s, zF),       // TRONÇON VERTICAL
        v3(B.pos.x, B.pos.y, zF + 0.008)        // entrée dans le port B
      ];
    };

    // Passage DERRIÈRE un panneau à brosse : traversée + guide + sol
    const rearThrough = (side, portU, rearPos) => {
      const chX = ra.wx + side * (REAR_CH_X + fan * 0.5);
      const rZ = wz - RACK_D / 2 - 0.05;
      return [
        v3(chX, rearPos.y, rZ + 0.02),
        v3(chX, Math.min(Math.max(FLOOR_Y + 0.05, rearPos.y - dirY * 0.06), rearPos.y), rZ),
        v3(chX, FLOOR_Y + 0.02, rZ),
        v3(chX, FLOOR_Y, rZ - 0.09)             // fin dans le lit de câbles au sol
      ];
    };

    const pts = [A.pos, ...frontCord(), B.pos];
    // Lien permanent derrière le panneau (le câble continue au sol)
    if (patchB) pts.push(...rearThrough(B.u < 0.5 ? -1 : 1, B.u, pb.posRear));
    else if (patchA) pts.push(...rearThrough(A.u < 0.5 ? -1 : 1, A.u, pa.posRear));
    return pts;
  }

  /* ---------- Baies différentes ---------- */
  const zFA = cordZ(ra.wz, idx), zFB = cordZ(rb.wz, idx);
  const sA = A.u < 0.5 ? -1 : 1, sB = B.u < 0.5 ? -1 : 1;
  const chXA = ra.wx + sA * (REAR_CH_X + fan * 0.5);
  const chXB = rb.wx + sB * (REAR_CH_X + fan * 0.5);
  const rzA = ra.wz - RACK_D / 2 - 0.05, rzB = rb.wz - RACK_D / 2 - 0.05;
  const laneZ = Math.min(rzA, rzB) - 0.30 + (((idx * 53) % 9) - 4) * 0.008;
  const y0 = FLOOR_Y;
  const exitA = Math.max(y0 + 0.10, A.pos.y - 0.12);
  const exitB = Math.max(y0 + 0.10, B.pos.y - 0.12);

  const p = [A.pos, v3(A.pos.x, A.pos.y, zFA + 0.008)];
  if (fa === 'front') {
    // descente VERTICALE devant la face, à la colonne du port
    p.push(v3(A.pos.x, exitA + 0.05, zFA));
    p.push(v3(A.pos.x, exitA, zFA - 0.03));
    p.push(v3(ra.wx + sA * SIDE_IN_X, exitA - 0.01, zFA - 0.06));
    p.push(v3(chXA + sA * 0.02, exitA - 0.02, rzA + 0.05));
  } else {
    p.push(v3(chXA, A.pos.y, rzA));
  }
  p.push(v3(chXA, exitA - 0.03, rzA));
  p.push(v3(chXA, y0 + 0.02, rzA - 0.05));
  p.push(v3(chXA, y0, rzA - 0.12));
  // traversée au sol de l'allée arrière
  p.push(v3((chXA + chXB) / 2, y0, laneZ));
  p.push(v3(chXB, y0, rzB - 0.12));
  p.push(v3(chXB, y0 + 0.02, rzB - 0.05));
  p.push(v3(chXB, exitB - 0.03, rzB));
  if (fb === 'front') {
    p.push(v3(chXB + sB * 0.02, exitB - 0.02, rzB + 0.05));
    p.push(v3(rb.wx + sB * SIDE_IN_X, exitB - 0.01, zFB - 0.06));
    // remontée VERTICALE devant la face, à la colonne du port B
    p.push(v3(B.pos.x, exitB, zFB - 0.03));
    p.push(v3(B.pos.x, exitB + 0.05, zFB));
    p.push(v3(B.pos.x, B.pos.y, zFB + 0.008));
  } else {
    p.push(v3(chXB, B.pos.y, rzB));
  }
  p.push(B.pos);
  return p;
}
const rackPositions = new Map();   // id -> { wx, wz }

function resolve3d(ws, ep) {
  if (!ep) return null;
  const rack = ws.racks.find(r => r.id === ep.rackId);
  if (!rack) return null;
  const inst = rack.instances.find(i => i.id === ep.instId);
  if (!inst) return null;
  const port = inst.ports.find(p => p.id === ep.portId);
  if (!port) return null;
  return { rack, inst, port };
}

/* ============================================================
   Étiquettes (sprites canvas)
   ============================================================ */
function makeLabelSprite(name, sub, accent) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const f1 = '700 46px Inter, system-ui, sans-serif';
  const f2 = '500 30px Inter, system-ui, sans-serif';
  ctx.font = f1;
  const w1 = ctx.measureText(name).width;
  ctx.font = f2;
  const w2 = sub ? ctx.measureText(sub).width : 0;
  const W = Math.ceil(Math.max(w1, w2)) + 110;
  const H = sub ? 116 : 84;
  cv.width = W; cv.height = H;
  const c2 = cv.getContext('2d');
  c2.fillStyle = 'rgba(9, 11, 15, 0.86)';
  roundRect(c2, 0, 0, W, H, 16, true, false);
  c2.fillStyle = accent || '#2563eb';
  roundRect(c2, 0, 0, 10, H, 5, true, false);
  c2.textBaseline = 'middle';
  c2.font = f1; c2.fillStyle = '#f1f3f7';
  c2.fillText(name, 46, sub ? H * 0.36 : H * 0.5);
  if (sub) {
    c2.font = f2; c2.fillStyle = '#9aa1ad';
    c2.fillText(sub, 46, H * 0.72);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.92
  }));
  const s = 0.00098;              // discretes, même en vue allée rapprochée
  sprite.scale.set(W * s, H * s, 1);
  sprite.userData = { type: 'label' };
  return sprite;
}

/* ============================================================
   Construction / destruction de la scène
   ============================================================ */
function disposeWorld() {
  if (world) {
    world.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          // les textures en cache partagé (photos, PDU) ne sont jamais disposées
          if (m.map && !m.map.userData?.shared) m.map.dispose?.();
          m.dispose();
        }
      }
    });
    scene.remove(world);
  }
  world = new THREE.Group();
  scene.add(world);
  pickables = []; portIndex = new Map(); cableById = new Map();
  tubeByCable = new Map(); cableAnchors = new Map(); leds = []; nameplates = []; deviceMeshes = [];
  deviceByMesh = new Map(); rackPositions.clear();
  layout = { racks: [], center: new THREE.Vector3(0, 1, 0), radius: 2.5, rearZ: -1 };
  hoverRing = null; focusRings = [];
  hovered = null; focusCableId = null; domainFilter = ''; hideTooltip();
  const card = document.getElementById('v3d-card');
  card?.classList.add('hidden');
}

function buildScene() {
  ensureRenderer();
  disposeWorld();
  const ws = app.ws();
  const emptyEl = document.getElementById('v3d-empty');
  const hasRacks = !!(ws && ws.racks.length);
  emptyEl?.classList.toggle('hidden', hasRacks);
  buildLegend();
  if (!hasRacks) { resetCameraDefault(); return; }

  // Positions monde (plan du board -> sol)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const RACK_PX_W = 356;   // largeur d'un rack en coordonnées board (cf. app.js)
  ws.racks.forEach(r => {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + RACK_PX_W); maxY = Math.max(maxY, r.y + rackHeight3d(r));
  });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rects = [];
  for (const rack of ws.racks) {
    const wx = (rack.x + RACK_PX_W / 2 - cx) * PX2M;
    const wz = (rack.y + rackHeight3d(rack) / 2 - cy) * PX2M;
    rackPositions.set(rack.id, { wx, wz });
    const halfW = RACK_W_M * PX2M + 0.3 / 2, halfD = RACK_D / 2;
    rects.push({ x1: wx - halfW, x2: wx + halfW, z1: wz - halfD, z2: wz + halfD });
    layout.racks.push({ rack, wx, wz });
  }
  layout.center.set(0, Math.min(2.2, BASE_H + Math.max(...ws.racks.map(r => (r.sizeU || 12))) * U_M * 0.55), 0);
  layout.radius = Math.max(2.2,
    Math.hypot((maxX - minX) * PX2M, (maxY - minY) * PX2M) / 2 + 1.2);
  layout.rearZ = Math.min(...rects.map(r => r.z1));

  buildEnvironment(world, Math.max(40, layout.radius * 4.5), rects);

  // Baies + devices
  for (const { rack, wx, wz } of layout.racks) {
    const { height } = buildRack(world, ws, rack, wx, wz);
    for (const inst of rack.instances) buildDevice(world, ws, rack, height, inst, wx, wz);
  }

  // Câbles
  buildCables(world, ws);

  // Anneaux de survol / focus
  hoverRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.02, 0.0028, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  hoverRing.visible = false;
  world.add(hoverRing);
  focusRings = [0, 1].map(() => {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.02, 0.003, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    r.visible = false;
    world.add(r);
    return r;
  });

  // Vue par défaut à chaque entrée en 3D : dans l'allée, près des baies.
  resetCameraDefault();
  applyVisibility();
}

function rackHeight3d(rack) { return 28 + 16 + (rack.sizeU || 12) * 33; }  // px board (miroir app.js)

function resetCameraDefault() {
  // Vue par défaut : DEBOUT DANS L'ALLÉE AVANT, à hauteur d'œil, face
  // aux baies (le cadrage large reste accessible via « ⧢ Tout voir »).
  const { pos, target } = camPose('aisle');
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
}

/* ============================================================
   Légende des domaines + filtre
   ============================================================ */
function buildLegend() {
  const el = document.getElementById('v3d-legend');
  if (!el) return;
  const ws = app.ws();
  // Regroupement par libellé de domaine (les domaines inconnus partagent
  // le libellé « Général » mais gardent la couleur de leur premier câble)
  const groups = new Map();   // label -> {count, color, dom}
  for (const c of ws?.cables || []) {
    const d = c.domain || '';
    const label = app.domLabel(d);
    const color = DOMAIN_COLORS[d] || cableDisplayColor(c);
    if (!groups.has(label)) groups.set(label, { count: 0, color, dom: d });
    groups.get(label).count++;
  }
  domainFilter = '';
  focusCableId = null;
  if (!groups.size) {
    el.innerHTML = '<span class="v3d-legend-empty">Aucun câble — câblez vos ports en vue Élévations.</span>';
    return;
  }
  const chips = [['Tous', { count: (ws?.cables || []).length, color: null, dom: '' }]]
    .concat([...groups.entries()].sort((a, b) => b[1].count - a[1].count));
  el.innerHTML = chips.map(([lbl, g]) =>
    `<button class="v3d-chip ${g.dom === '' ? 'all' : ''}" data-domain="${app.esc(g.dom)}">
       <span class="v3d-dot" style="background:${g.color || '#64748b'}"></span>${app.esc(lbl)} · ${g.count}
     </button>`).join('');
  el.querySelectorAll('.v3d-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.domain;
      // « Tous » ou re-clic sur le même domaine -> réinitialiser
      domainFilter = (d === '' || domainFilter === d) ? '' : d;
      el.querySelectorAll('.v3d-chip').forEach(b => b.classList.toggle('active',
        b.dataset.domain === domainFilter));
      applyVisibility();
    });
  });
}

function applyVisibility() {
  const showLabels = document.getElementById('v3d-labels')?.checked ?? true;
  nameplates.forEach(s => { s.visible = showLabels; });
  for (const [id, tube] of tubeByCable) {
    const c = cableById.get(id);
    let op = 1;
    if (focusCableId && id !== focusCableId) op = 0.08;
    else if (domainFilter && (c?.domain || '') !== domainFilter) op = 0.06;
    tube.material.opacity = op;
  }
}

function setFocus(cableId) {
  focusCableId = cableId === focusCableId ? null : cableId;
  applyVisibility();
  updateFocusRings();
  if (focusCableId) showCableCard(cableById.get(focusCableId));
  else hideCard();
}

function updateFocusRings() {
  focusRings.forEach(r => { r.visible = false; });
  if (!focusCableId) return;
  const c = cableById.get(focusCableId);
  if (!c) return;
  const anchors = cableAnchors.get(focusCableId);
  if (!anchors) return;
  anchors.forEach((a, k) => {
    if (!a?.pos || !focusRings[k]) return;
    focusRings[k].position.copy(a.pos)
      .add(new THREE.Vector3(0, 0, a.face === 'front' ? 0.008 : -0.008));
    focusRings[k].material.color.set(cableDisplayColor(c));
    focusRings[k].visible = true;
  });
}

/* ============================================================
   Survol / sélection (raycasting)
   ============================================================ */
function bindPointer(dom) {
  dom.addEventListener('pointermove', e => {
    const rect = dom.getBoundingClientRect();
    pointerPix.x = e.clientX - rect.left;
    pointerPix.y = e.clientY - rect.top;
    pointerPix.cx = e.clientX; pointerPix.cy = e.clientY;
    pointerPix.inside = true;
    pointerPix.dirty = true;
  });
  dom.addEventListener('pointerleave', () => {
    pointerPix.inside = false;
    setHovered(null);
  });
  dom.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    downPix = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  dom.addEventListener('pointerup', e => {
    if (e.button !== 0 || !downPix) return;
    const moved = Math.hypot(e.clientX - downPix.x, e.clientY - downPix.y);
    const dt = performance.now() - downPix.t;
    downPix = null;
    if (moved > 5 || dt > 500) return;      // c'était une orbite
    handleClick();
  });
  dom.addEventListener('dblclick', () => {
    if (hovered?.type === 'device') focusOnDevice(hovered.rack, hovered.inst);
  });
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickAt() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  ndc.set((pointerPix.x / w) * 2 - 1, -(pointerPix.y / h) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  return hits.length ? hits[0] : null;
}

function setHovered(hit) {
  // reset précédent
  if (hovered?.box) {
    const mats = deviceByMesh.get(hovered.box)?.mats || [];
    mats.forEach(m => { m.emissive?.setHex(0x000000); m.emissiveIntensity = 1; });
  }
  if (hovered?.tube) hovered.tube.material.emissive?.setHex(0x000000);
  if (hoverRing) hoverRing.visible = false;
  hovered = null;
  renderer.domElement.style.cursor = '';

  if (!hit) { hideTooltip(); return; }
  const ud = hit.object.userData;

  if (ud.type === 'device') {
    const ws = app.ws();
    const rack = ws?.racks.find(r => r.id === ud.rackId);
    const inst = rack?.instances.find(i => i.id === ud.instId);
    if (!rack || !inst) return;
    hovered = { type: 'device', rack, inst, box: hit.object };
    const mats = deviceByMesh.get(hit.object)?.mats || [];
    mats.forEach(m => { if (m.emissive) { m.emissive.setHex(0x1d3f7a); m.emissiveIntensity = 0.55; } });
    renderer.domElement.style.cursor = 'pointer';
    showTooltip(deviceTooltipHtml(rack, inst));
  } else if (ud.type === 'port') {
    const ws = app.ws();
    const rack = ws?.racks.find(r => r.id === ud.rackId);
    const inst = rack?.instances.find(i => i.id === ud.instId);
    const port = inst?.ports.find(p => p.id === ud.portId);
    if (!rack || !inst || !port) return;
    const info = portIndex.get(`${rack.id}|${inst.id}|${port.id}`);
    hovered = { type: 'port', rack, inst, port };
    if (hoverRing && info) {
      // L'anneau suit la face réellement survolée (façade ou arrière)
      const n = hit.face ? hit.face.normal.clone()
        : new THREE.Vector3(0, 0, ud.face === 'front' ? 1 : -1);
      hoverRing.position.copy(hit.point).addScaledVector(n, 0.005);
      hoverRing.visible = true;
    }
    renderer.domElement.style.cursor = 'pointer';
    showTooltip(portTooltipHtml(rack, inst, port));
  } else if (ud.type === 'cable') {
    const c = cableById.get(ud.cableId);
    if (!c) return;
    hovered = { type: 'cable', cable: c, tube: hit.object };
    hit.object.material.emissive = new THREE.Color(0xffffff);
    hit.object.material.emissiveIntensity = 0.28;
    renderer.domElement.style.cursor = 'pointer';
    showTooltip(cableTooltipHtml(c));
  }
}

function handleClick() {
  if (!hovered) { setFocusQuiet(null); hideCard(); return; }
  if (hovered.type === 'device') {
    showDeviceCard(hovered.rack, hovered.inst);
  } else if (hovered.type === 'port') {
    const ws = app.ws();
    const c = (ws?.cables || []).find(x =>
      (x.a?.portId === hovered.port.id && x.a?.instId === hovered.inst.id) ||
      (x.b?.portId === hovered.port.id && x.b?.instId === hovered.inst.id));
    if (c) { setFocusQuiet(c.id); showCableCard(c); }
    else showDeviceCard(hovered.rack, hovered.inst);
  } else if (hovered.type === 'cable') {
    setFocus(hovered.cable.id);
  }
}

function setFocusQuiet(id) {
  focusCableId = (id === focusCableId) ? null : id;
  applyVisibility();
  updateFocusRings();
}

/* ============================================================
   Info-bulles & fiches
   ============================================================ */
const tipEl = () => document.getElementById('v3d-tooltip');

function showTooltip(html) {
  const tip = tipEl();
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  positionTooltip();
}
function positionTooltip() {
  const tip = tipEl();
  if (!tip || tip.classList.contains('hidden') || !pointerPix.inside) return;
  const root = document.getElementById('view3d-root');
  const rw = root.clientWidth, rh = root.clientHeight;
  let x = pointerPix.x + 16, y = pointerPix.y + 14;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > rw - 8) x = pointerPix.x - tw - 12;
  if (y + th > rh - 8) y = pointerPix.y - th - 10;
  tip.style.left = Math.max(6, x) + 'px';
  tip.style.top = Math.max(6, y) + 'px';
}
function hideTooltip() { tipEl()?.classList.add('hidden'); }

function fmtW(w) {
  w = Number(w) || 0;
  return w >= 1000 ? (Math.round(w / 100) / 10) + ' kW' : w + ' W';
}

function uRange(inst) {
  return `U${(inst.slot || 0) + 1}${inst.sizeU > 1 ? '–U' + ((inst.slot || 0) + inst.sizeU) : ''}`;
}

function cableOfPort(inst, port) {
  const ws = app.ws();
  return (ws?.cables || []).find(x =>
    (x.a?.portId === port.id && x.a?.instId === inst.id) ||
    (x.b?.portId === port.id && x.b?.instId === inst.id)) || null;
}

function peerOf(cable, inst, port) {
  const ws = app.ws();
  const end = (cable.a?.instId === inst.id && cable.a?.portId === port.id) ? cable.b : cable.a;
  if (!end) return null;
  for (const r of ws?.racks || []) {
    const i = r.instances.find(x => x.id === end.instId);
    if (i) {
      const p = i.ports.find(x => x.id === end.portId);
      return { device: i.name, port: p ? (p.label || p.name) : '?', rack: r.name };
    }
  }
  return null;
}

function deviceTooltipHtml(rack, inst) {
  const nCables = (app.ws()?.cables || [])
    .filter(c => c.a?.instId === inst.id || c.b?.instId === inst.id).length;
  return `<b>${app.catIcon(inst.cat)} ${app.esc(inst.name || 'Device')}</b>
    <span>${app.esc(rack.name)} · ${uRange(inst)}</span>
    ${`${inst.brand || ''} ${inst.model || ''}`.trim() ? `<span>${app.esc(`${inst.brand || ''} ${inst.model || ''}`.trim())}</span>` : ''}
    ${inst.ipMgmt ? `<span>🌐 ${app.esc(inst.ipMgmt)}</span>` : ''}
    <span class="v3d-tip-muted">${nCables} câble(s) · double-clic : zoom</span>`;
}

function portTooltipHtml(rack, inst, port) {
  const c = cableOfPort(inst, port);
  let html = `<b>🔌 ${app.esc(port.label || port.name || 'Port')}</b>
    <span>${app.esc(inst.name || '')} · ${uRange(inst)}</span>`;
  if (port.ip) html += `<span>IP ${app.esc(port.ip)}${port.vlan ? ' · VLAN ' + app.esc(port.vlan) : ''}</span>`;
  if (c) {
    const peer = peerOf(c, inst, port);
    html += `<span><span class="v3d-dot" style="background:${cableDisplayColor(c)}"></span> ${app.esc(c.name || 'Câble')}</span>`;
    if (peer) html += `<span>→ ${app.esc(peer.device)} · ${app.esc(peer.port)}</span>`;
  } else {
    html += `<span class="v3d-tip-muted">port libre</span>`;
  }
  return html;
}

function cableTooltipHtml(c) {
  const ws = app.ws();
  const fmt = end => {
    for (const r of ws?.racks || []) {
      const i = r.instances.find(x => x.id === end?.instId);
      if (i) {
        const p = i.ports.find(x => x.id === end?.portId);
        return `${i.name} · ${p ? (p.label || p.name) : '?'}`;
      }
    }
    return '?';
  };
  return `<b><span class="v3d-dot" style="background:${cableDisplayColor(c)}"></span> ${app.esc(c.name || 'Câble')}</b>
    <span>${app.esc(app.domLabel(c.domain))}</span>
    <span>${app.esc(fmt(c.a))}</span>
    <span>→ ${app.esc(fmt(c.b))}</span>
    <span class="v3d-tip-muted">clic : isoler ce câble</span>`;
}

/* --------- Fiches latérales --------- */
function showCard(html) {
  const card = document.getElementById('v3d-card');
  if (!card) return;
  card.innerHTML = html + '<button class="v3d-card-close" data-close title="Fermer">✕</button>';
  card.classList.remove('hidden');
}
function hideCard() { document.getElementById('v3d-card')?.classList.add('hidden'); }

function showDeviceCard(rack, inst) {
  const cables = (app.ws()?.cables || [])
    .filter(c => c.a?.instId === inst.id || c.b?.instId === inst.id);
  const portsRows = (inst.ports || []).slice(0, 12).map(p => {
    const c = cables.find(x =>
      (x.a?.portId === p.id && x.a?.instId === inst.id) ||
      (x.b?.portId === p.id && x.b?.instId === inst.id));
    const peer = c ? peerOf(c, inst, p) : null;
    return `<div class="v3d-port-row">
      <span class="v3d-port-name">${app.esc(p.label || p.name || '?')}</span>
      ${c ? `<span class="v3d-dot" style="background:${cableDisplayColor(c)}"></span>
             <span class="v3d-port-peer">${app.esc(peer ? `${peer.device} · ${peer.port}` : '—')}</span>`
          : '<span class="v3d-port-free">libre</span>'}
    </div>`;
  }).join('');
  showCard(`
    <h3>${app.catIcon(inst.cat)} ${app.esc(inst.name || 'Device')}</h3>
    <p class="v3d-sub">${app.esc(rack.name)} · ${uRange(inst)} · ${app.esc(app.catLabel(inst.cat))}</p>
    <div class="v3d-kv"><span>Modèle</span><b>${app.esc(`${inst.brand || ''} ${inst.model || ''}`.trim() || '—')}</b></div>
    <div class="v3d-kv"><span>Réf.</span><b>${app.esc(inst.partRef || '—')}</b></div>
    <div class="v3d-kv"><span>N° série</span><b>${app.esc(inst.serial || '—')}</b></div>
    <div class="v3d-kv"><span>IP gestión</span><b>${app.esc(inst.ipMgmt || '—')}</b></div>
    <div class="v3d-kv"><span>Puissance</span><b>${fmtW(inst.watts || 0)}</b></div>
    ${inst.ports?.length ? `<div class="v3d-ports-head">Ports (${inst.ports.length})</div>${portsRows}
      ${inst.ports.length > 12 ? `<div class="v3d-port-more">+ ${inst.ports.length - 12} autres…</div>` : ''}` : ''}
  `);
}

function showCableCard(c) {
  if (!c) return;
  const ws = app.ws();
  const fmt = end => {
    for (const r of ws?.racks || []) {
      const i = r.instances.find(x => x.id === end?.instId);
      if (i) {
        const p = i.ports.find(x => x.id === end?.portId);
        return `${app.esc(i.name)} <span class="v3d-port-peer">· ${app.esc(p ? (p.label || p.name) : '?')} @ ${app.esc(r.name)}</span>`;
      }
    }
    return '?';
  };
  showCard(`
    <h3><span class="v3d-dot" style="background:${cableDisplayColor(c)}"></span> ${app.esc(c.name || 'Câble')}</h3>
    <p class="v3d-sub">${app.esc(app.domLabel(c.domain))}</p>
    <div class="v3d-kv"><span>A</span><b>${fmt(c.a)}</b></div>
    <div class="v3d-kv"><span>B</span><b>${fmt(c.b)}</b></div>
  `);
}

/* ============================================================
   Caméra : presets + tween
   ============================================================ */
function tweenCam(pos, target, dur = 650) {
  camTween = {
    p0: camera.position.clone(), p1: pos.clone(),
    t0: controls.target.clone(), t1: target.clone(),
    start: performance.now(), dur
  };
}

function stepTween() {
  if (!camTween) return;
  const k = Math.min(1, (performance.now() - camTween.start) / camTween.dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(camTween.p0, camTween.p1, e);
  controls.target.lerpVectors(camTween.t0, camTween.t1, e);
  if (k >= 1) camTween = null;
}

function camPose(dirName) {
  const c = layout.center.clone();
  const d = Math.max(3.2, layout.radius * 2.05);
  const poses = {
    front: new THREE.Vector3(c.x + d * 0.35, c.y + d * 0.30, c.z + d * 0.92),
    back:  new THREE.Vector3(c.x - d * 0.35, c.y + d * 0.30, c.z - d * 0.92),
    top:   new THREE.Vector3(c.x + 0.01, c.y + d * 1.25, c.z + d * 0.30),
    aisle: new THREE.Vector3(c.x, Math.max(1.45, c.y + 0.55), c.z + Math.max(1.6, Math.min(layout.radius * 0.6, 5.5))),
    fit:   new THREE.Vector3(c.x + d * 0.42, c.y + d * 0.30, c.z + d * 0.92)
  };
  return { pos: poses[dirName] || poses.fit, target: c };
}

function focusOnDevice(rack, inst) {
  const info = deviceByMesh.get(deviceMeshes.find(b => deviceByMesh.get(b)?.inst === inst));
  const wz = rackPositions.get(rack.id)?.wz || 0;
  const nU = rack.sizeU || 12;
  const topY = BASE_H + (nU - inst.slot) * U_M;
  const y = topY - (inst.sizeU * U_M) / 2;
  const target = new THREE.Vector3(0, y, wz + deviceDepth(normCat(inst.cat)) / 2 - 0.06);
  const pos = new THREE.Vector3(0.75, y + 0.25, wz + 1.25);
  tweenCam(pos, target, 700);
}

/* ============================================================
   Barre d'outils 3D
   ============================================================ */
function bindToolbar() {
  document.querySelectorAll('#v3d-toolbar [data-cam]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { pos, target } = camPose(btn.dataset.cam);
      tweenCam(pos, target);
    });
  });
  const labels = document.getElementById('v3d-labels');
  labels?.addEventListener('change', applyVisibility);
  document.getElementById('v3d-rotate')?.addEventListener('change', e => {
    controls.autoRotate = e.target.checked;
  });
  document.getElementById('v3d-shot')?.addEventListener('click', takeScreenshot);
  const card = document.getElementById('v3d-card');
  card?.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { setFocusQuiet(null); hideCard(); }
  });
  window.addEventListener('keydown', e => {
    if (!active3d) return;
    if (e.key === 'Escape') { setFocusQuiet(null); hideCard(); }
  });
}

function takeScreenshot() {
  if (!renderer) return;
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = `lldraw-3d-${new Date().toISOString().slice(0, 10)}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
}

/* ============================================================
   Boucle de rendu
   ============================================================ */
let framesRendered = 0;
function loop() {
  rafId = requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  stepTween();
  controls.update();
  // LEDs
  for (const led of leds) {
    const on = Math.sin(t * led.speed + led.phase) > -0.25;
    led.mat.opacity = on ? 1 : 0.18;
  }
  // survol
  if (pointerPix.dirty && pointerPix.inside && !camTween) {
    pointerPix.dirty = false;
    setHovered(pickAt());
    positionTooltip();
  }
  renderer.render(scene, camera);
  framesRendered++;
}

/* ============================================================
   API publique
   ============================================================ */
function enter() {
  active3d = true;
  ensureRenderer();
  document.getElementById('view3d-root')?.classList.remove('hidden');
  resize();
  buildScene();
  if (!rafId) { clock.start(); loop(); }
}

function exit() {
  active3d = false;
  document.getElementById('view3d-root')?.classList.add('hidden');
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}

function refresh() {
  if (!active3d) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (active3d) buildScene(); }, 250);
}

window.LLDraw3D = {
  enter, exit, refresh,
  isActive: () => active3d,
  _cam: () => ({ pos: camera.position.toArray().map(v => +v.toFixed(2)), target: controls.target.toArray().map(v => +v.toFixed(2)) }),
  _cables: () => (app.ws()?.cables || []).map(c => ({
    id: c.id, name: c.name,
    a: c.a?.instId + '/' + c.a?.portId, b: c.b?.instId + '/' + c.b?.portId,
    aRack: c.a?.rackId, bRack: c.b?.rackId
  })),
  _focus: id => setFocusQuiet(id),
  _anchors: id => (cableAnchors.get(id) || []).map(a => ({
    face: a.face, p: a.pos ? a.pos.toArray().map(v => +v.toFixed(2)) : null
  })),
  _go: (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); },
  _debug: () => ({
    racks: layout.racks.length,
    devices: deviceMeshes.length,
    pickables: pickables.length,
    ports: portIndex.size,
    tubes: tubeByCable.size,
    leds: leds.length,
    labels: nameplates.length,
    worldChildren: world?.children.length,
    frames: framesRendered,
    camPos: camera ? camera.position.toArray().map(v => +v.toFixed(2)) : null,
    tween: !!camTween
  })
};

/* ---------------- util canvas ---------------- */
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
  else r = { tl: 0, tr: 0, br: 0, bl: 0 };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
