/* ============================================================
   LLDraw — Assistant IA (consultant + agent)
   ------------------------------------------------------------
   • Multi-fournisseurs : tout endpoint compatible OpenAI
     (OpenAI, OpenRouter, Mistral, Groq, Gemini, Ollama…) et
     Anthropic (Claude) en natif.
   • Clé API : stockée dans le navigateur (BYOK) ET/OU routée via
     le proxy de server.py (/api/ai) — commutable à tout moment
     dans les réglages (Auto / Navigateur / Serveur). Côté serveur,
     la variable d'environnement LLDRAW_AI_KEY peut fournir la clé.
   • Consultant : répond aux questions et audite le plan à partir
     d'un condensé JSON de l'état (jamais les photos base64).
   • Agent : propose des modifications sous forme d'« opérations »
     JSON validées par l'application, soumises à APPROBATION
     SYSTÉMATIQUE (diff + cases à cocher), puis appliquées en une
     seule transaction → Ctrl+Z annule tout le lot.
   Ce fichier n'ajoute qu'un <script> après app.js : il réutilise
   ses fonctions globales (active, pushHistory, refreshAll…) et ne
   modifie aucune logique existante.
   ============================================================ */
(() => {
'use strict';

/* ================= Fournisseurs & réglages ================= */

const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI', api: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
  },
  anthropic: {
    label: 'Anthropic (Claude)', api: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-4-5', 'claude-3-5-haiku-latest', 'claude-opus-4-1']
  },
  openrouter: {
    label: 'OpenRouter (multi-modèles)', api: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'mistralai/mistral-large']
  },
  mistral: {
    label: 'Mistral AI', api: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-small-latest', 'mistral-large-latest', 'magistral-medium-latest']
  },
  groq: {
    label: 'Groq (rapide)', api: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'qwen-2.5-coder-32b-instruct']
  },
  gemini: {
    label: 'Google Gemini', api: 'openai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']
  },
  ollama: {
    label: 'Ollama (local)', api: 'openai',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: ['llama3.1', 'qwen2.5', 'mistral']
  },
  custom: {
    label: 'Personnalisé (compatible OpenAI)', api: 'openai',
    endpoint: '', models: []
  }
};

const AI_SETTINGS_KEY = 'lldraw-ai-settings-v1';
const AI_CHAT_KEY     = 'lldraw-ai-chat-v1';

function defaultSettings() {
  return {
    provider: 'openai',
    endpoint: AI_PROVIDERS.openai.endpoint,
    model: 'gpt-4o-mini',
    apiKey: '',
    route: 'auto',          // 'auto' | 'direct' | 'server'
    agentEnabled: true      // l'IA peut PROPOSER des modifications (approbation requise)
  };
}

let aiSettings = defaultSettings();
try {
  const raw = localStorage.getItem(AI_SETTINGS_KEY);
  if (raw) aiSettings = Object.assign(defaultSettings(), JSON.parse(raw));
} catch (e) { /* réglages illisibles : on repart des valeurs par défaut */ }

function saveSettings() {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings)); } catch (e) {}
}

// Le proxy /api/ai existe-t-il sur ce serveur ? (null = pas encore testé)
let aiServerProxyOk = null;

function aiApiFamily() {
  return (AI_PROVIDERS[aiSettings.provider] || AI_PROVIDERS.openai).api;
}

// Complète un endpoint « base » saisi par l'utilisateur : beaucoup de
// fournisseurs documentent une URL de base (« …/v1 ») alors qu'il faut
// l'URL complète du chat. Évite les 404 silencieux.
function normalizeEndpoint(fam) {
  let ep = String(aiSettings.endpoint || '').trim().replace(/\/+$/, '');
  if (!ep) return ep;
  if (fam === 'anthropic') {
    if (!/\/messages$/.test(ep)) ep += /\/v1$/.test(ep) ? '/messages' : '/v1/messages';
  } else if (!/\/chat\/completions$/.test(ep)) {
    ep += '/chat/completions';
  }
  return ep;
}

function aiConfigured() {
  // En route serveur, la clé peut venir de l'environnement LLDRAW_AI_KEY
  return !!(aiSettings.endpoint && aiSettings.model &&
            (aiSettings.apiKey || aiSettings.route === 'server' || aiSettings.route === 'auto'));
}

/* ================= Petits utilitaires ================= */

const aiEsc = (typeof escapeHtml === 'function')
  ? escapeHtml
  : s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function aiMarkdown(text) {
  // Rendu « markdown léger » sans dépendance : blocs de code, code en
  // ligne, gras, italique, listes à puces, titres ###, sauts de ligne.
  const parts = String(text).split(/```/);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {                       // contenu de bloc de code
      const nl = parts[i].indexOf('\n');
      const body = (parts[i].slice(0, nl).match(/^[a-zA-Z0-9_-]*$/))
        ? parts[i].slice(nl + 1) : parts[i];
      html += '<pre class="ai-pre">' + aiEsc(body.replace(/\n$/, '')) + '</pre>';
    } else {
      let seg = aiEsc(parts[i]);
      seg = seg.replace(/`([^`\n]+)`/g, '<code class="ai-code">$1</code>');
      seg = seg.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      seg = seg.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
      seg = seg.replace(/^###\s+(.+)$/gm, '<strong class="ai-h">$1</strong>');
      seg = seg.replace(/^[ \t]*[-•]\s+(.+)$/gm, '<span class="ai-li">• $1</span>');
      html += seg.replace(/\n/g, '<br>');
    }
  }
  return html;
}

const AI_FENCE = 'lldraw-ops';

function extractOpsBlocks(text) {
  // Repère les blocs ```lldraw-ops … ``` proposés par le modèle
  const re = new RegExp('```' + AI_FENCE + '\\s*\\n?([\\s\\S]*?)```', 'g');
  const ops = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr)) ops.push(...arr.filter(o => o && typeof o === 'object' && typeof o.op === 'string'));
    } catch (e) { /* bloc invalide : ignoré, signalé plus bas */ }
  }
  return ops;
}

function stripOpsBlocks(text) {
  return String(text)
    .replace(new RegExp('```' + AI_FENCE + '\\s*\\n?[\\s\\S]*?```', 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ================= Condensé (digest) du plan ================= */

function truncText(s, n) {
  s = typeof s === 'string' ? s : '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function buildDigest() {
  const ws = (typeof active === 'function') ? active() : null;
  const d = {
    date: new Date().toISOString().slice(0, 10),
    app: 'LLDraw — planificateur de baies data center',
    conventions: {
      slot: "position d'un device dans un rack, en U, comptée depuis le HAUT (0 = U le plus haut)",
      ids: "tous les ids (racks, devices, ports, câbles, sites, flux…) viennent de ce condensé — ne jamais en inventer"
    },
    bibliothequeDevices: state.devices.map(x => ({
      id: x.id, name: x.name, sizeU: x.sizeU, cat: x.cat || 'other',
      brand: x.brand || '', model: x.model || '', ports: (x.ports || []).length
    })),
    autresWorkspaces: state.workspaces
      .filter(w => w.id !== state.activeWorkspaceId)
      .map(w => ({ name: w.name, racks: w.racks.length, devices: w.racks.reduce((n, r) => n + r.instances.length, 0) }))
  };

  if (!ws) {
    d.workspaceActif = null;
    d.note = "Aucun workspace ouvert : les modifications sont impossibles tant que l'utilisateur n'en a pas ouvert un.";
    return JSON.stringify(d);
  }

  const zoneName = id => ((ws.lld && ws.lld.swZones) || []).find(z => z.id === id)?.name || '';
  const instName = iid => {
    for (const r of ws.racks) { const i = r.instances.find(x => x.id === iid); if (i) return i.name; }
    return '?';
  };

  const L = ws.lld || {};
  const sectionsVides = [];
  if (!L.objectif) sectionsVides.push('objectif');
  if (!L.existant) sectionsVides.push('existant');
  if (!L.architecture) sectionsVides.push('architecture');
  if (!(L.fai && L.fai.operator)) sectionsVides.push('fai');
  if (!(L.interco && L.interco.tech)) sectionsVides.push('interco');
  for (const k of ['firewall', 'switching', 'server', 'storage', 'ids', 'cctv', 'pointage'])
    if (!(L.catNotes && L.catNotes[k])) sectionsVides.push('catNotes.' + k);

  d.workspaceActif = {
    id: ws.id,
    name: ws.name,
    sites: (ws.sites || []).map(s => ({ id: s.id, name: s.name, address: s.address || '', contact: s.contact || '', desc: s.desc || '' })),
    racks: ws.racks.map(r => ({
      id: r.id, name: r.name, sizeU: r.sizeU, siteId: r.siteId || '',
      site: (typeof siteName === 'function') ? siteName(ws, r) : '',
      usedU: r.instances.reduce((n, i) => n + i.sizeU, 0),
      maxWatts: r.maxWatts || 0, maxKg: r.maxKg || 0,
      watts: r.instances.reduce((n, i) => n + (i.watts || 0), 0),
      kg: Math.round(r.instances.reduce((n, i) => n + (i.weightKg || 0), 0) * 10) / 10,
      instances: [...r.instances].sort((a, b) => a.slot - b.slot).map(i => ({
        id: i.id, name: i.name, deviceId: i.deviceId, slot: i.slot, sizeU: i.sizeU,
        cat: i.cat || 'other', zone: zoneName(i.zone),
        ipMgmt: i.ipMgmt || '', vlan: i.vlan || '', serial: i.serial || '',
        watts: i.watts || 0, weightKg: i.weightKg || 0,
        warranty: i.warranty || '', warrantyEnd: i.warrantyEnd || '',
        ports: (i.ports || []).map(p => ({ id: p.id, name: p.name, label: p.label || '', ip: p.ip || '', vlan: p.vlan || '' }))
      }))
    })),
    cables: (ws.cables || []).map(c => {
      const a = (typeof resolveEndpoint === 'function') ? resolveEndpoint(ws, c.a) : null;
      const b = (typeof resolveEndpoint === 'function') ? resolveEndpoint(ws, c.b) : null;
      if (!a || !b) return null;
      return {
        id: c.id, name: c.name, color: c.color, domain: c.domain || '',
        a: { instId: a.inst.id, inst: a.inst.name, portId: a.port.id, port: a.port.name },
        b: { instId: b.inst.id, inst: b.inst.name, portId: b.port.id, port: b.port.name }
      };
    }).filter(Boolean),
    flows: (ws.flows || []).map(f => ({ id: f.id, name: f.name, src: f.src, dst: f.dst, proto: f.proto, sens: f.sens, usage: f.usage || '' })),
    topologie: {
      nodes: ((ws.topology && ws.topology.nodes) || []).map(n => ({ id: n.id, instId: n.instId, nom: instName(n.instId) })),
      links: ((ws.topology && ws.topology.links) || []).map(l => {
        const na = ((ws.topology && ws.topology.nodes) || []).find(n => n.id === l.a);
        const nb = ((ws.topology && ws.topology.nodes) || []).find(n => n.id === l.b);
        return { id: l.id, a: na ? instName(na.instId) : l.a, b: nb ? instName(nb.instId) : l.b, label: l.label || '', speed: l.speed || '', vlan: l.vlan || '' };
      })
    },
    dossierLLD: {
      client: L.client || '', author: L.author || '', version: L.version || '',
      objectif: truncText(L.objectif, 500), existant: truncText(L.existant, 500), architecture: truncText(L.architecture, 500),
      fai: L.fai ? { operator: L.fai.operator, offer: L.fai.offer, linkType: L.fai.linkType, down: L.fai.down, up: L.fai.up, publicBlock: L.fai.publicBlock, cpe: L.fai.cpe, cpeIp: L.fai.cpeIp, notes: truncText(L.fai.notes, 300) } : {},
      interco: L.interco ? { tech: L.interco.tech, epA: L.interco.epA, epB: L.interco.epB, localSubnets: L.interco.localSubnets, remoteSubnets: L.interco.remoteSubnets, routing: L.interco.routing, encryption: L.interco.encryption, notes: truncText(L.interco.notes, 300) } : {},
      catNotes: Object.fromEntries(Object.entries(L.catNotes || {}).map(([k, v]) => [k, truncText(v, 300)])),
      vlans: L.vlans || [], nomen: L.nomen || [],
      swZones: (L.swZones || []).map(z => ({ id: z.id, name: z.name })),
      sectionsVides
    }
  };

  let s = JSON.stringify(d);
  if (s.length > 110000) {
    // Filet anti-explosion : on retire le détail des ports (les ids de ports
    // restent disponibles via les câbles) puis les textes du dossier.
    d.workspaceActif.racks.forEach(r => r.instances.forEach(i => {
      i.portsCount = (i.ports || []).length; delete i.ports;
    }));
    s = JSON.stringify(d);
    if (s.length > 110000) { delete d.workspaceActif.dossierLLD.catNotes; s = JSON.stringify(d); }
  }
  return s;
}

/* ================= Prompt système ================= */

function systemPrompt() {
  const opsRef = `
RÉFÉRENCE DES OPÉRATIONS (bloc \`\`\`${AI_FENCE}) :
- create_rack {name, sizeU (6|9|12|15|18|22|27|32|42), siteId?, x?, y?}
- rename_rack {rackId, name}
- resize_rack {rackId, sizeU}
- set_rack_budget {rackId, maxWatts?, maxKg?}   (0 = pas de budget)
- set_rack_site {rackId, siteId}                (siteId "" = détacher)
- create_device_model {tempId?, name, sizeU, cat?, brand?, model?, partRef?, watts?, weightKg?, warranty?, warrantyEnd?, ipMgmt?, vlan?, portsCount?}
    → crée un modèle dans la bibliothèque (sans photo) ; cat ∈ router|firewall|switch|wifi|server|storage|ids|cctv|pointage|ups|patch|other (devinée depuis le nom si absente) ; portsCount génère des ports nommés 1..N
- add_device {rackId, deviceId, slot, name?, zone?, ipMgmt?, vlan?, serial?, watts?, weightKg?, warrantyEnd?}
    → deviceId = id de la bibliothèque OU tempId d'un create_device_model du même bloc
- move_device {instId, rackId?, slot}           (rackId absent = même rack)
- update_device {instId, name?, cat?, zone?, ipMgmt?, vlan?, serial?, brand?, model?, partRef?, watts?, weightKg?, warranty?, warrantyEnd?}
- remove_device {instId}                        (retire aussi ses cordons)
- set_port {instId, portId, name?, label?, ip?, vlan?}
- add_cable {aInstId, aPortId, bInstId, bPortId, color?, domain?}
    → color = hex parmi #e11d48 #2563eb #eab308 #16a34a #7c3aed #f97316 #111827 ; domain ∈ ""|fai|interco|firewall|switching|server|storage|ids|cctv|pointage
- remove_cable {cableId}
- add_flow {name, src, dst, proto?, sens?, usage?}   (sens = "uni"|"bi", défaut "bi")
- remove_flow {flowId}
- fill_lld {field, text}   → field ∈ objectif|existant|architecture|client|author|version|fai.operator|fai.offer|fai.linkType|fai.down|fai.up|fai.publicBlock|fai.cpe|fai.cpeIp|fai.notes|interco.tech|interco.epA|interco.epB|interco.localSubnets|interco.remoteSubnets|interco.routing|interco.encryption|interco.notes|catNotes.firewall|catNotes.switching|catNotes.server|catNotes.storage|catNotes.ids|catNotes.cctv|catNotes.pointage
- add_site {name, address?, contact?, desc?} / update_site {siteId, …mêmes champs} / remove_site {siteId}
- add_vlan {vid, name?, subnet?, gw?, purpose?} / remove_vlan {vid}
- rename_workspace {name}`;

  return `Tu es l'assistant IA intégré à LLDraw, une application web de planification de baies (racks) de data center. Tu joues DEUX rôles :
1. CONSULTANT expert data center / réseau : tu réponds aux questions sur le plan, tu l'audites (capacité U/W/kg, garanties, cohérence des noms, adresses IP et VLANs, câblage, flux, sections du dossier LLD manquantes) et tu donnes des recommandations concrètes.
2. AGENT : tu peux proposer des modifications du plan via des opérations JSON.

À CHAQUE message, le plan courant (condensé JSON sans les photos) est fourni entre balises <PLAN>. Les ids qui s'y trouvent sont les SEULS valables.

RÈGLES DE RÉPONSE :
- Réponds dans la langue de l'utilisateur (français par défaut), en markdown simple et concis.
- Pour une question ou un audit : réponds SANS bloc d'opérations.
- Pour agir : explique d'abord brièvement ce que tu vas faire, puis termine par UN SEUL bloc de code de langage "${AI_FENCE}" contenant un tableau JSON d'opérations. Exemple :
\`\`\`${AI_FENCE}
[{"op":"add_device","rackId":"abc123","deviceId":"dev45","slot":4}]
\`\`\`
- N'invente JAMAIS d'id : utilise uniquement ceux du <PLAN> (pour un modèle de device créé dans le même bloc, utilise son tempId, ex. "$srv1", comme deviceId).
- Vérifie la place : slot + sizeU ≤ sizeU du rack, et l'étage doit être libre dans le condensé.
- Maximum ~25 opérations par bloc ; préfère plusieurs tours si besoin.
- Les propositions seront TOUJOURS validées par l'utilisateur avant application (diff avec cases à cocher) : tu peux donc proposer franchement, mais chaque opération invalide sera refusée et son erreur te sera signalée au tour suivant.
- Ne redemande jamais la clé API ou des informations sensibles.` +
  (aiSettings.agentEnabled ? opsRef : `

Le mode agent est DÉSACTIVÉ par l'utilisateur : ne produis AUCUN bloc ${AI_FENCE}, contente-toi de conseiller.`);
}

/* ================= Couche réseau (streaming) ================= */

function pickRoute() {
  if (aiSettings.route === 'direct') return 'direct';
  if (aiSettings.route === 'server') return 'server';
  // auto : le proxy serveur s'il est disponible (clé via env possible, pas de CORS)
  return (typeof serverAvailable !== 'undefined' && serverAvailable && aiServerProxyOk !== false) ? 'server' : 'direct';
}

function buildBody(fam, sysText, history) {
  if (fam === 'anthropic') {
    // Anthropic : system séparé + rôles strictement alternés (fusion des
    // messages consécutifs de même rôle).
    const msgs = [];
    for (const m of history) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n\n' + m.content;
      else msgs.push({ role, content: m.content });
    }
    if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: 'Bonjour.' });
    return { model: aiSettings.model, max_tokens: 4096, system: sysText, messages: msgs, stream: true };
  }
  return {
    model: aiSettings.model,
    messages: [{ role: 'system', content: sysText }, ...history.map(m => ({ role: m.role, content: m.content }))],
    stream: true,
    temperature: 0.2
  };
}

function directHeaders(fam) {
  if (fam === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': aiSettings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiSettings.apiKey };
}

async function extractApiError(resp) {   // (utilitaire conservé pour tests)
  let detail = '';
  try { detail = (await resp.text()).slice(0, 600); } catch (e) {}
  return new Error(`HTTP ${resp.status} — ${detail || resp.statusText}`);
}

async function aiStream(sysText, history, onDelta, signal) {
  if (!aiSettings.endpoint) throw new Error("Aucun endpoint configuré : ouvrez les réglages 🤖 dans la barre du haut.");
  const fam = aiApiFamily();
  const endpoint = normalizeEndpoint(fam);
  const body = buildBody(fam, sysText, history);

  // Requête via le proxy de server.py (renvoie null si proxy absent)
  const proxyRequest = async () => {
    try {
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: fam, endpoint, apiKey: aiSettings.apiKey || '', body }),
        signal
      });
      if (r.status === 404 || r.status === 405) { aiServerProxyOk = false; return null; }
      aiServerProxyOk = true;
      return r;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      aiServerProxyOk = false;
      return null;
    }
  };

  let resp = null;
  if (pickRoute() === 'server') resp = await proxyRequest();
  if (!resp) {
    const needsKey = aiSettings.provider !== 'ollama';
    if (needsKey && !aiSettings.apiKey) throw new Error("Clé API manquante : ouvrez les réglages 🤖 (ou définissez LLDRAW_AI_KEY côté serveur avec la route « Serveur »).");
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: directHeaders(fam),
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      // Échec réseau ou CORS en appel direct : repli automatique par le
      // proxy serveur (des fournisseurs comme NVIDIA NIM refusent les
      // appels venant d'un navigateur). On retente le proxy à chaque
      // échec direct : un redémarrage de server.py est ainsi pris en
      // compte sans recharger la page.
      if (typeof serverAvailable !== 'undefined' && serverAvailable) {
        resp = await proxyRequest();
      }
      if (!resp) {
        throw new Error("Échec de l'appel direct (« " + ((e && e.message) || e) + " »). Cause fréquente : CORS — ce fournisseur n'accepte pas les appels depuis un navigateur (ex. NVIDIA NIM). Passez la route sur « Serveur » ou « Auto » dans les réglages 🤖 (nécessite server.py), ou vérifiez l'endpoint.");
      }
    }
  }
  if (!resp.ok) {
    // Corps d'erreur lu UNE fois (fournisseur ou proxy serveur)
    let detail = '';
    try { detail = (await resp.text()).slice(0, 700); } catch (e) {}
    let msg = detail;
    try {
      const j = JSON.parse(detail);
      if (j && j.ok === false) msg = String(j.error || '') + (j.detail ? ' — ' + String(j.detail).slice(0, 300) : '');
      else msg = j.error?.message || j.error || j.detail || detail;
    } catch (e) { /* détail non JSON : tel quel */ }
    throw new Error(`HTTP ${resp.status} — ${msg || resp.statusText}`);
  }

  const ctype = resp.headers.get('Content-Type') || '';
  if (ctype.includes('application/json')) {
    // Réponse non streamée (certains proxys) : on la donne d'un bloc
    const j = await resp.json();
    if (j.ok === false) throw new Error(j.error || 'Erreur du proxy serveur');
    const txt = fam === 'anthropic'
      ? (j.content || []).map(c => c.text || '').join('')
      : (j.choices?.[0]?.message?.content || '');
    if (txt) onDelta(txt);
    return;
  }

  // ---- Lecture du flux SSE ----
  if (!resp.body) throw new Error('Flux indisponible (navigateur trop ancien ?).');
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handleEvent = raw => {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch (e) { continue; }
      if (fam === 'anthropic') {
        if (obj.type === 'content_block_delta') onDelta(obj.delta?.text || '');
        else if (obj.type === 'error') throw new Error(obj.error?.message || 'Erreur Anthropic');
      } else {
        if (obj.ok === false) throw new Error(obj.error || 'Erreur du proxy serveur');
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleEvent(raw);
    }
  }
}

/* ================= Moteur d'opérations ================= */
/* Chaque opération est validée puis appliquée via applyOp(op, env).
   env désigne soit le vrai état (application réelle), soit un clone
   jetable sans photos (dry-run de validation pour le diff).          */

const LLD_TEXT_FIELDS = {
  'objectif': 4000, 'existant': 4000, 'architecture': 4000,
  'client': 80, 'author': 80, 'version': 80,
  'fai.operator': 120, 'fai.offer': 120, 'fai.linkType': 120, 'fai.down': 120,
  'fai.up': 120, 'fai.publicBlock': 120, 'fai.cpe': 120, 'fai.cpeIp': 120, 'fai.notes': 2000,
  'interco.tech': 120, 'interco.epA': 120, 'interco.epB': 120, 'interco.localSubnets': 120,
  'interco.remoteSubnets': 120, 'interco.routing': 120, 'interco.encryption': 120, 'interco.notes': 2000,
  'catNotes.firewall': 2000, 'catNotes.switching': 2000, 'catNotes.server': 2000,
  'catNotes.storage': 2000, 'catNotes.ids': 2000, 'catNotes.cctv': 2000, 'catNotes.pointage': 2000
};
const AI_CABLE_HEXES = ['#e11d48', '#2563eb', '#eab308', '#16a34a', '#7c3aed', '#f97316', '#111827'];
const AI_DOMAINS = ['', 'fai', 'interco', 'firewall', 'switching', 'server', 'storage', 'ids', 'cctv', 'pointage'];

function makeEnv(real) {
  if (real) {
    return { real: true, devices: state.devices, ws: active(), tempIds: {}, libChanged: false };
  }
  const ws = active();
  const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'photo' ? '' : x)));
  return { real: false, devices: strip(state.devices), ws: ws ? strip(ws) : null, tempIds: {}, libChanged: false };
}

const envRack = (env, id) => env.ws.racks.find(r => r.id === id) || null;
function envInst(env, id) {
  for (const r of env.ws.racks) {
    const i = r.instances.find(x => x.id === id);
    if (i) return { rack: r, inst: i };
  }
  return null;
}
const envDev = (env, id) => env.devices.find(d => d.id === id) || null;
const asStr = (v, n) => String(v ?? '').slice(0, n);
const asNum = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const okDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fail = m => ({ ok: false, error: m });

function applyOp(op, env) {
  if (!env.ws) return fail('Aucun workspace actif : ouvrez un workspace avant toute modification.');
  const ws = env.ws;
  switch (op.op) {

    case 'create_rack': {
      const name = asStr(op.name, 60).trim();
      if (!name) return fail('create_rack : nom manquant.');
      const sizeU = Number(op.sizeU);
      if (!RACK_SIZES.includes(sizeU)) return fail(`create_rack : taille invalide (${op.sizeU}) — valeurs possibles : ${RACK_SIZES.join(', ')}.`);
      const siteId = op.siteId ? asStr(op.siteId, 40) : '';
      if (siteId && !(ws.sites || []).some(s => s.id === siteId)) return fail('create_rack : siteId inconnu.');
      let x = asNum(op.x), y = asNum(op.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        x = ws.racks.length ? Math.max(...ws.racks.map(r => r.x + RACK_W)) + 140 : 120;
        y = 80;
      }
      x = Math.max(0, Math.min(x, BOARD_W - RACK_W));
      const rack = normalizeRack({ id: uid(), name, x, y: Math.max(0, y), sizeU, siteId, instances: [] });
      rack.y = Math.max(0, Math.min(rack.y, BOARD_H - rackHeight(rack)));
      pushHistorySafe(env);
      ws.racks.push(rack);
      return { ok: true, desc: `🗄️ Nouveau rack « ${name} » (${sizeU}U)${siteId ? ' — ' + ((ws.sites || []).find(s => s.id === siteId)?.name || siteId) : ''}` };
    }

    case 'rename_rack': {
      const r = envRack(env, op.rackId);
      if (!r) return fail(`rename_rack : rack « ${op.rackId} » introuvable.`);
      const name = asStr(op.name, 60).trim();
      if (!name) return fail('rename_rack : nouveau nom vide.');
      pushHistorySafe(env);
      const old = r.name; r.name = name;
      return { ok: true, desc: `✏️ Rack renommé « ${old} » → « ${name} »` };
    }

    case 'resize_rack': {
      const r = envRack(env, op.rackId);
      if (!r) return fail(`resize_rack : rack « ${op.rackId} » introuvable.`);
      const sizeU = Number(op.sizeU);
      if (!RACK_SIZES.includes(sizeU)) return fail(`resize_rack : taille invalide — valeurs possibles : ${RACK_SIZES.join(', ')}.`);
      const over = r.instances.filter(i => i.slot + i.sizeU > sizeU);
      if (over.length) return fail(`resize_rack : ${over.length} device(s) dépassent de ${sizeU}U (${over.map(i => i.name).join(', ')}).`);
      pushHistorySafe(env);
      const old = r.sizeU; r.sizeU = sizeU;
      return { ok: true, desc: `↕️ Rack « ${r.name} » redimensionné ${old}U → ${sizeU}U` };
    }

    case 'set_rack_budget': {
      const r = envRack(env, op.rackId);
      if (!r) return fail(`set_rack_budget : rack « ${op.rackId} » introuvable.`);
      const bits = [];
      let w, k;
      if (op.maxWatts !== undefined) { w = asNum(op.maxWatts); if (isNaN(w) || w < 0) return fail('set_rack_budget : maxWatts invalide.'); bits.push(`budget ${w || 'aucun'} W`); }
      if (op.maxKg !== undefined) { k = asNum(op.maxKg); if (isNaN(k) || k < 0) return fail('set_rack_budget : maxKg invalide.'); bits.push(`charge max ${k || 'aucune'} kg`); }
      if (!bits.length) return fail('set_rack_budget : rien à changer (maxWatts / maxKg absents).');
      pushHistorySafe(env);
      if (w !== undefined) r.maxWatts = w;
      if (k !== undefined) r.maxKg = k;
      return { ok: true, desc: `⚡ Rack « ${r.name} » : ${bits.join(', ')}` };
    }

    case 'set_rack_site': {
      const r = envRack(env, op.rackId);
      if (!r) return fail(`set_rack_site : rack « ${op.rackId} » introuvable.`);
      const siteId = op.siteId ? asStr(op.siteId, 40) : '';
      const site = (ws.sites || []).find(s => s.id === siteId);
      if (siteId && !site) return fail('set_rack_site : siteId inconnu.');
      pushHistorySafe(env);
      r.siteId = siteId;
      return { ok: true, desc: `🏢 Rack « ${r.name} » rattaché au site « ${site ? site.name : '— aucun —'} »` };
    }

    case 'create_device_model': {
      const name = asStr(op.name, 60).trim();
      if (!name) return fail('create_device_model : nom manquant.');
      const sizeU = Math.max(1, Math.min(48, parseInt(op.sizeU, 10) || 1));
      let cat = (typeof normCat === 'function') ? normCat(op.cat) : 'other';
      if (cat === 'other') cat = (typeof guessCatFromName === 'function' ? guessCatFromName(name) : null) || 'other';
      const portsCount = Math.max(0, Math.min(64, parseInt(op.portsCount, 10) || 0));
      const ports = [];
      for (let i = 0; i < portsCount; i++) {
        ports.push({ id: uid(), xPct: ((i + 1) * 100) / (portsCount + 1), yPct: 50, name: String(i + 1), label: '', size: 1, ip: '', vlan: '' });
      }
      const dev = {
        id: uid(), name, sizeU, photo: '', cat, ports,
        brand: asStr(op.brand, 40), model: asStr(op.model, 60), partRef: asStr(op.partRef, 60),
        serial: '', ipMgmt: asStr(op.ipMgmt, 45), vlan: asStr(op.vlan, 60),
        warranty: asStr(op.warranty, 60), warrantyEnd: okDate(op.warrantyEnd) ? String(op.warrantyEnd) : '',
        watts: Math.max(0, asNum(op.watts) || 0), weightKg: Math.max(0, asNum(op.weightKg) || 0)
      };
      pushHistorySafe(env);
      env.devices.push(dev);
      env.libChanged = true;
      if (op.tempId) env.tempIds[String(op.tempId)] = dev.id;
      return { ok: true, desc: `📦 Nouveau modèle « ${name} » (${sizeU}U, ${catLabel(cat)}${portsCount ? ', ' + portsCount + ' ports' : ''}) dans la bibliothèque${op.tempId ? ` [${op.tempId}]` : ''}` };
    }

    case 'add_device': {
      const r = envRack(env, op.rackId);
      if (!r) return fail(`add_device : rack « ${op.rackId} » introuvable.`);
      const devId = env.tempIds[String(op.deviceId)] || op.deviceId;
      const tpl = envDev(env, devId);
      if (!tpl) return fail(`add_device : modèle de device « ${op.deviceId} » introuvable dans la bibliothèque.`);
      const slot = parseInt(op.slot, 10);
      if (!Number.isFinite(slot) || slot < 0) return fail('add_device : slot invalide (entier ≥ 0, compté depuis le haut).');
      if (slot + tpl.sizeU > r.sizeU) return fail(`add_device : « ${tpl.name} » (${tpl.sizeU}U) en slot ${slot} dépasse du rack « ${r.name} » (${r.sizeU}U).`);
      if (!isSlotFree(r, slot, tpl.sizeU)) return fail(`add_device : l'étage ${slot} du rack « ${r.name} » est déjà occupé.`);
      const zone = op.zone ? asStr(op.zone, 40) : '';
      if (zone && !((ws.lld && ws.lld.swZones) || []).some(z => z.id === zone)) return fail('add_device : zone de switching inconnue.');
      const inst = {
        id: uid(), deviceId: tpl.id,
        name: asStr(op.name, 60).trim() || tpl.name,
        sizeU: tpl.sizeU, photo: '', cat: normCat(op.cat ?? tpl.cat), slot, zone,
        brand: tpl.brand || '', model: tpl.model || '', partRef: tpl.partRef || '',
        serial: asStr(op.serial, 60) || tpl.serial || '',
        ipMgmt: asStr(op.ipMgmt, 45) || tpl.ipMgmt || '',
        vlan: asStr(op.vlan, 60) || tpl.vlan || '',
        warranty: tpl.warranty || '',
        warrantyEnd: okDate(op.warrantyEnd) ? String(op.warrantyEnd) : (tpl.warrantyEnd || ''),
        watts: op.watts !== undefined ? Math.max(0, asNum(op.watts) || 0) : (tpl.watts || 0),
        weightKg: op.weightKg !== undefined ? Math.max(0, asNum(op.weightKg) || 0) : (tpl.weightKg || 0),
        ports: (tpl.ports || []).map(p => ({ id: uid(), xPct: p.xPct, yPct: p.yPct, name: p.name, label: p.label || '', size: p.size || 1, ip: p.ip || '', vlan: p.vlan || '' }))
      };
      pushHistorySafe(env);
      r.instances.push(inst);
      return { ok: true, desc: `➕ « ${inst.name} » (${catIcon(inst.cat)} ${inst.sizeU}U) placé dans « ${r.name} », étage ${slot} (id ${inst.id.slice(0, 4)}…)` };
    }

    case 'move_device': {
      const found = envInst(env, op.instId);
      if (!found) return fail(`move_device : device « ${op.instId} » introuvable.`);
      const target = op.rackId ? envRack(env, op.rackId) : found.rack;
      if (!target) return fail(`move_device : rack cible « ${op.rackId} » introuvable.`);
      const slot = parseInt(op.slot, 10);
      if (!Number.isFinite(slot) || slot < 0) return fail('move_device : slot invalide.');
      if (slot + found.inst.sizeU > target.sizeU) return fail(`move_device : dépasse du rack « ${target.name} » (${target.sizeU}U).`);
      if (!isSlotFree(target, slot, found.inst.sizeU, target.id === found.rack.id ? found.inst.id : undefined))
        return fail(`move_device : l'étage ${slot} de « ${target.name} » est occupé.`);
      pushHistorySafe(env);
      if (target.id !== found.rack.id) {
        found.rack.instances.splice(found.rack.instances.indexOf(found.inst), 1);
        target.instances.push(found.inst);
      }
      found.inst.slot = slot;
      return { ok: true, desc: `↔️ « ${found.inst.name} » déplacé vers « ${target.name} », étage ${slot}` };
    }

    case 'update_device': {
      const found = envInst(env, op.instId);
      if (!found) return fail(`update_device : device « ${op.instId} » introuvable.`);
      const i = found.inst;
      // --- Tout valider AVANT de muter (aucune application partielle) ---
      if (op.zone !== undefined) {
        const z = op.zone ? asStr(op.zone, 40) : '';
        if (z && !((ws.lld && ws.lld.swZones) || []).some(x => x.id === z)) return fail('update_device : zone de switching inconnue.');
      }
      if (op.warrantyEnd !== undefined && op.warrantyEnd !== '' && !okDate(op.warrantyEnd))
        return fail('update_device : warrantyEnd doit être une date AAAA-MM-JJ.');
      const watts = op.watts !== undefined ? asNum(op.watts) : undefined;
      if (watts !== undefined && (isNaN(watts) || watts < 0)) return fail('update_device : watts invalide.');
      const kg = op.weightKg !== undefined ? asNum(op.weightKg) : undefined;
      if (kg !== undefined && (isNaN(kg) || kg < 0)) return fail('update_device : weightKg invalide.');
      const FIELDS_S = ['name', 'ipMgmt', 'vlan', 'serial', 'brand', 'model', 'partRef', 'warranty'];
      const hasAny = FIELDS_S.some(k => op[k] !== undefined) ||
        ['cat', 'zone', 'warrantyEnd', 'watts', 'weightKg'].some(k => op[k] !== undefined);
      if (!hasAny) return fail('update_device : aucun champ à modifier.');
      const changes = [];
      const setS = (k, v, n, lbl) => { if (v !== undefined) { i[k] = asStr(v, n); changes.push(`${lbl} → « ${i[k]} »`); } };
      pushHistorySafe(env);
      setS('name', op.name, 60, 'nom');
      if (op.cat !== undefined) { i.cat = normCat(op.cat); changes.push(`catégorie → ${catLabel(i.cat)}`); }
      if (op.zone !== undefined) {
        i.zone = op.zone ? asStr(op.zone, 40) : '';
        changes.push(`zone → ${((ws.lld && ws.lld.swZones) || []).find(x => x.id === i.zone)?.name || '—'}`);
      }
      setS('ipMgmt', op.ipMgmt, 45, 'IP mgmt');
      setS('vlan', op.vlan, 60, 'VLAN');
      setS('serial', op.serial, 60, 'n° série');
      setS('brand', op.brand, 40, 'marque');
      setS('model', op.model, 60, 'modèle');
      setS('partRef', op.partRef, 60, 'référence');
      setS('warranty', op.warranty, 60, 'garantie');
      if (op.warrantyEnd !== undefined) { i.warrantyEnd = String(op.warrantyEnd || ''); changes.push(`fin de garantie → ${i.warrantyEnd || '—'}`); }
      if (watts !== undefined) { i.watts = watts; changes.push(`puissance → ${watts} W`); }
      if (kg !== undefined) { i.weightKg = kg; changes.push(`poids → ${kg} kg`); }
      return { ok: true, desc: `📝 « ${i.name} » : ${changes.join(', ')}` };
    }

    case 'remove_device': {
      const found = envInst(env, op.instId);
      if (!found) return fail(`remove_device : device « ${op.instId} » introuvable.`);
      pushHistorySafe(env);
      found.rack.instances.splice(found.rack.instances.indexOf(found.inst), 1);
      pruneCables(ws);
      pruneTopology(ws);
      return { ok: true, desc: `🗑️ « ${found.inst.name} » retiré du rack « ${found.rack.name} » (cordons supprimés)` };
    }

    case 'set_port': {
      const found = envInst(env, op.instId);
      if (!found) return fail(`set_port : device « ${op.instId} » introuvable.`);
      const p = (found.inst.ports || []).find(x => x.id === op.portId);
      if (!p) return fail(`set_port : port « ${op.portId} » introuvable sur « ${found.inst.name} ».`);
      pushHistorySafe(env);
      const changes = [];
      if (op.name !== undefined) { p.name = asStr(op.name, 30); changes.push(`nom → ${p.name}`); }
      if (op.label !== undefined) { p.label = asStr(op.label, 60); changes.push(`étiquette → ${p.label}`); }
      if (op.ip !== undefined) { p.ip = asStr(op.ip, 45); changes.push(`IP → ${p.ip}`); }
      if (op.vlan !== undefined) { p.vlan = asStr(op.vlan, 30); changes.push(`VLAN → ${p.vlan}`); }
      if (!changes.length) return fail('set_port : aucun champ à modifier.');
      return { ok: true, desc: `🔌 « ${found.inst.name} » port ${p.name} : ${changes.join(', ')}` };
    }

    case 'add_cable': {
      const A = envInst(env, op.aInstId), B = envInst(env, op.bInstId);
      if (!A) return fail(`add_cable : device A « ${op.aInstId} » introuvable.`);
      if (!B) return fail(`add_cable : device B « ${op.bInstId} » introuvable.`);
      const pa = (A.inst.ports || []).find(p => p.id === op.aPortId);
      const pb = (B.inst.ports || []).find(p => p.id === op.bPortId);
      if (!pa) return fail(`add_cable : port A « ${op.aPortId} » introuvable sur « ${A.inst.name} ».`);
      if (!pb) return fail(`add_cable : port B « ${op.bPortId} » introuvable sur « ${B.inst.name} ».`);
      if (A.inst.id === B.inst.id && pa.id === pb.id) return fail('add_cable : impossible de câbler un port sur lui-même.');
      const busy = (ws.cables || []).some(c => c.a.portId === pa.id || c.b.portId === pa.id || c.a.portId === pb.id || c.b.portId === pb.id);
      if (busy) return fail(`add_cable : l'un des ports (${A.inst.name}·${pa.name} ou ${B.inst.name}·${pb.name}) est déjà câblé.`);
      const color = AI_CABLE_HEXES.includes(String(op.color || '').toLowerCase()) ? String(op.color).toLowerCase() : AI_CABLE_HEXES[1];
      const domain = AI_DOMAINS.includes(String(op.domain || '')) ? String(op.domain || '') : '';
      pushHistorySafe(env);
      const cable = {
        id: uid(), name: nextCableId(ws), color, domain,
        a: { rackId: A.rack.id, instId: A.inst.id, portId: pa.id },
        b: { rackId: B.rack.id, instId: B.inst.id, portId: pb.id }
      };
      ws.cables.push(cable);
      return { ok: true, desc: `🔗 Cordon ${cable.name} : ${A.inst.name}·${pa.name} ⇄ ${B.inst.name}·${pb.name}` };
    }

    case 'remove_cable': {
      const c = (ws.cables || []).find(x => x.id === op.cableId);
      if (!c) return fail(`remove_cable : câble « ${op.cableId} » introuvable.`);
      pushHistorySafe(env);
      ws.cables.splice(ws.cables.indexOf(c), 1);
      return { ok: true, desc: `✂️ Cordon « ${c.name} » retiré` };
    }

    case 'add_flow': {
      const name = asStr(op.name, 60).trim();
      const src = asStr(op.src, 80).trim();
      const dst = asStr(op.dst, 80).trim();
      if (!name && !src) return fail('add_flow : nom ou source requis.');
      pushHistorySafe(env);
      ws.flows = ws.flows || [];
      ws.flows.push({ id: uid(), name, src, dst, proto: asStr(op.proto, 60), sens: op.sens === 'uni' ? 'uni' : 'bi', usage: asStr(op.usage, 120) });
      return { ok: true, desc: `🔄 Flux « ${name || src + ' → ' + dst} » ajouté (${asStr(op.proto, 60) || '—'})` };
    }

    case 'remove_flow': {
      ws.flows = ws.flows || [];
      const f = ws.flows.find(x => x.id === op.flowId);
      if (!f) return fail(`remove_flow : flux « ${op.flowId} » introuvable.`);
      pushHistorySafe(env);
      ws.flows.splice(ws.flows.indexOf(f), 1);
      return { ok: true, desc: `🗑️ Flux « ${f.name || f.id} » supprimé` };
    }

    case 'fill_lld': {
      const field = String(op.field || '');
      if (!(field in LLD_TEXT_FIELDS)) return fail(`fill_lld : section « ${field} » inconnue. Sections : ${Object.keys(LLD_TEXT_FIELDS).join(', ')}.`);
      const text = String(op.text ?? '').slice(0, LLD_TEXT_FIELDS[field]);
      if (!text.trim()) return fail('fill_lld : texte vide.');
      pushHistorySafe(env);
      normLldInfo(ws);
      const parts = field.split('.');
      if (parts.length === 1) ws.lld[field] = text;
      else ws.lld[parts[0]][parts[1]] = text;
      return { ok: true, desc: `📘 Dossier LLD — section « ${field} » rédigée (${text.length} car.)` };
    }

    case 'add_site': {
      const name = asStr(op.name, 40).trim();
      if (!name) return fail('add_site : nom manquant.');
      pushHistorySafe(env);
      normSites(ws);
      ws.sites.push({ id: uid(), name, address: asStr(op.address, 80), contact: asStr(op.contact, 80), desc: asStr(op.desc, 200) });
      return { ok: true, desc: `🏢 Site « ${name} » ajouté` };
    }

    case 'update_site': {
      const s = (ws.sites || []).find(x => x.id === op.siteId);
      if (!s) return fail(`update_site : site « ${op.siteId} » introuvable.`);
      pushHistorySafe(env);
      if (op.name !== undefined) s.name = asStr(op.name, 40).trim() || s.name;
      if (op.address !== undefined) s.address = asStr(op.address, 80);
      if (op.contact !== undefined) s.contact = asStr(op.contact, 80);
      if (op.desc !== undefined) s.desc = asStr(op.desc, 200);
      return { ok: true, desc: `🏢 Site « ${s.name} » mis à jour` };
    }

    case 'remove_site': {
      const s = (ws.sites || []).find(x => x.id === op.siteId);
      if (!s) return fail(`remove_site : site « ${op.siteId} » introuvable.`);
      pushHistorySafe(env);
      ws.sites.splice(ws.sites.indexOf(s), 1);
      ws.racks.forEach(r => { if (r.siteId === s.id) r.siteId = ''; });
      return { ok: true, desc: `🗑️ Site « ${s.name} » supprimé (racks détachés)` };
    }

    case 'add_vlan': {
      normLldInfo(ws);
      const vid = asStr(op.vid, 6).trim();
      if (!vid) return fail('add_vlan : vid manquant.');
      if (ws.lld.vlans.some(v => v.vid === vid)) return fail(`add_vlan : le VLAN ${vid} existe déjà.`);
      pushHistorySafe(env);
      ws.lld.vlans.push({ vid, name: asStr(op.name, 40), subnet: asStr(op.subnet, 50), gw: asStr(op.gw, 50), purpose: asStr(op.purpose, 60) });
      return { ok: true, desc: `🏷️ VLAN ${vid} « ${asStr(op.name, 40) || '—'} » ajouté au registre` };
    }

    case 'remove_vlan': {
      normLldInfo(ws);
      const vid = asStr(op.vid, 6).trim();
      const i = ws.lld.vlans.findIndex(v => v.vid === vid);
      if (i < 0) return fail(`remove_vlan : VLAN « ${vid} » introuvable.`);
      pushHistorySafe(env);
      ws.lld.vlans.splice(i, 1);
      return { ok: true, desc: `🗑️ VLAN ${vid} retiré du registre` };
    }

    case 'rename_workspace': {
      const name = asStr(op.name, 80).trim();
      if (!name) return fail('rename_workspace : nom vide.');
      pushHistorySafe(env);
      ws.name = name;
      return { ok: true, desc: `📁 Workspace renommé « ${name} »` };
    }

    default:
      return fail(`opération inconnue « ${op.op} ».`);
  }
}

// En dry-run, on ne touche pas à l'historique ; en réel, UN SEUL
// pushHistory() pour tout le lot (une transaction = un Ctrl+Z).
let realTxStarted = false;
function pushHistorySafe(env) {
  if (!env.real) return;
  if (!realTxStarted) { pushHistory(); realTxStarted = true; }
}

function dryRunOps(ops) {
  const env = makeEnv(false);
  return ops.map((op, idx) => {
    let r;
    try { r = applyOp(op, env); }
    catch (e) { r = fail(String(e && e.message || e)); }
    return { idx, op, ok: !!r.ok, error: r.error || '', desc: r.desc || `${op.op}`, checked: !!r.ok };
  });
}

function applyApprovedOps(ops) {
  const env = makeEnv(true);
  if (!env.ws) return { applied: [], failed: ops.map(op => ({ op, error: 'Aucun workspace actif.' })) };
  realTxStarted = false;
  const applied = [], failed = [];
  for (const op of ops) {
    let r;
    try { r = applyOp(op, env); }
    catch (e) { r = fail(String(e && e.message || e)); }
    if (r.ok) applied.push({ op, desc: r.desc });
    else failed.push({ op, error: r.error });
  }
  if (realTxStarted) {
    touchWorkspace(env.ws);
    saveState();
    refreshAll();
    if (typeof boardMode !== 'undefined' && boardMode === 'topo') renderTopology(env.ws);
  }
  realTxStarted = false;
  return { applied, failed };
}

/* ================= Persistance de la conversation ================= */

let aiChat = [];   // {role, content, ops?: {list, state:'pending'|'applied'|'rejected', results?, report?}}
try {
  const raw = localStorage.getItem(AI_CHAT_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) aiChat = parsed.slice(-40);
} catch (e) {}

function persistChat() {
  try { localStorage.setItem(AI_CHAT_KEY, JSON.stringify(aiChat.slice(-40))); } catch (e) {}
}

function buildHistory() {
  // Limite grossière : on garde les derniers messages dans un budget de caractères
  const out = [];
  let budget = 120000;
  for (let i = aiChat.length - 1; i >= 0; i--) {
    const m = aiChat[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    budget -= (m.content || '').length;
    if (budget < 0 && out.length >= 4) break;
    out.unshift({ role: m.role, content: m.content });
  }
  return out;
}

/* ================= Interface (panneau, modale, FAB) ================= */

document.body.insertAdjacentHTML('beforeend', `
  <button id="ai-fab" class="ai-fab" title="Assistant IA — ouvrir la discussion" aria-label="Assistant IA">
    💬<span id="ai-fab-badge" class="ai-fab-badge hidden">0</span>
  </button>

  <aside id="ai-panel" class="ai-panel" aria-label="Assistant IA">
    <header class="ai-head">
      <div class="ai-head-txt">
        <h3>🤖 Assistant IA</h3>
        <small id="ai-head-sub">non configuré</small>
      </div>
      <div class="ai-head-btns">
        <button id="ai-new-chat" class="ai-ibtn" title="Nouvelle conversation">🗑</button>
        <button id="ai-gear-2" class="ai-ibtn" title="Réglages IA">⚙️</button>
        <button id="ai-close" class="ai-ibtn" title="Fermer">✕</button>
      </div>
    </header>
    <div id="ai-msgs" class="ai-msgs"></div>
    <footer class="ai-composer">
      <div class="ai-composer-row">
        <textarea id="ai-input" rows="1" title="Entrée : envoyer · Maj+Entrée : nouvelle ligne" placeholder="Posez une question ou une modification…"></textarea>
        <button id="ai-stop" class="ai-btn ai-btn-stop hidden" title="Interrompre">⏹</button>
        <button id="ai-send" class="ai-btn ai-btn-send" title="Envoyer (Entrée)">➤</button>
      </div>
    </footer>
  </aside>

  <div id="ai-settings-modal" class="modal hidden">
    <div class="modal-box ai-settings-box">
      <h3>🤖 Réglages de l'assistant IA</h3>

      <label class="ai-field">
        <span>Fournisseur</span>
        <select id="ai-provider"></select>
      </label>

      <label class="ai-field">
        <span>Endpoint (URL de l'API)</span>
        <input id="ai-endpoint" type="text" spellcheck="false" placeholder="https://api.…/v1/chat/completions">
      </label>

      <label class="ai-field">
        <span>Modèle</span>
        <input id="ai-model" type="text" list="ai-model-list" spellcheck="false" placeholder="ex. gpt-4o-mini">
        <datalist id="ai-model-list"></datalist>
      </label>

      <label class="ai-field">
        <span>Clé API</span>
        <span class="ai-key-row">
          <input id="ai-key" type="password" spellcheck="false" placeholder="sk-… (laisser vide si LLDRAW_AI_KEY est défini côté serveur)">
          <button id="ai-key-eye" type="button" class="ai-ibtn" title="Afficher / masquer">👁</button>
        </span>
      </label>

      <label class="ai-field">
        <span>Route des appels</span>
        <select id="ai-route">
          <option value="auto">Auto — proxy serveur si disponible, sinon navigateur</option>
          <option value="direct">Direct — navigateur → fournisseur</option>
          <option value="server">Serveur — navigateur → server.py → fournisseur</option>
        </select>
        <small class="ai-hint">La clé reste dans ce navigateur (localStorage). La route « Serveur » évite les problèmes CORS et permet d'utiliser la clé du serveur (variable d'environnement <code>LLDRAW_AI_KEY</code>) si le champ clé est vide. Certains fournisseurs (NVIDIA NIM, API d'entreprise…) <strong>refusent les appels directs depuis un navigateur</strong> (CORS) : pour eux, utilisez « Serveur » ou « Auto ». L'endpoint « base » (ex. <code>…/v1</code>) est complété automatiquement en <code>…/v1/chat/completions</code>.</small>
      </label>

      <label class="ai-check">
        <input id="ai-agent" type="checkbox">
        <span>Mode agent — l'IA peut <strong>proposer</strong> des modifications du plan (toujours soumises à votre approbation, annulables avec Ctrl+Z)</span>
      </label>

      <div class="ai-test-row">
        <button id="ai-test" class="btn" type="button">🔌 Tester la connexion</button>
        <span id="ai-test-result" class="ai-test-result"></span>
      </div>

      <div class="ai-settings-actions">
        <button id="ai-settings-close" class="btn btn-primary" type="button">Terminé</button>
      </div>
    </div>
  </div>
`);

const aiPanel   = document.getElementById('ai-panel');
const aiMsgs    = document.getElementById('ai-msgs');
const aiInput   = document.getElementById('ai-input');
const aiSendBtn = document.getElementById('ai-send');
const aiStopBtn = document.getElementById('ai-stop');
const aiFab     = document.getElementById('ai-fab');
const aiBadge   = document.getElementById('ai-fab-badge');
const aiSub     = document.getElementById('ai-head-sub');
const aiModal   = document.getElementById('ai-settings-modal');

let aiBusy = false;
let aiAbort = null;

function providerLabel() {
  const p = AI_PROVIDERS[aiSettings.provider];
  return (p ? p.label : aiSettings.provider) + (aiSettings.model ? ' · ' + aiSettings.model : '');
}

function updateAiHeader() {
  aiSub.textContent = aiConfigured() ? providerLabel() : 'non configuré — cliquez ⚙️';
}

function pendingCount() {
  return aiChat.filter(m => m.ops && m.ops.state === 'pending').length;
}

function updateBadge() {
  const n = pendingCount();
  aiBadge.textContent = String(n);
  aiBadge.classList.toggle('hidden', n === 0);
}

function openPanel() {
  aiPanel.classList.add('open');
  aiFab.classList.add('active');
  renderChat();
  aiInput.focus();
}
function closePanel() {
  aiPanel.classList.remove('open');
  aiFab.classList.remove('active');
}

aiFab.addEventListener('click', () => aiPanel.classList.contains('open') ? closePanel() : openPanel());
document.getElementById('ai-close').addEventListener('click', closePanel);
document.getElementById('ai-gear-2').addEventListener('click', () => openAiSettings());
const gearTop = document.getElementById('btn-ai-settings');
if (gearTop) gearTop.addEventListener('click', () => openAiSettings());

document.getElementById('ai-new-chat').addEventListener('click', () => {
  aiChat = [];
  persistChat();
  renderChat();
  updateBadge();
});

/* ---- Modale réglages ---- */

const selProvider = document.getElementById('ai-provider');
for (const [id, p] of Object.entries(AI_PROVIDERS)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = p.label;
  selProvider.appendChild(o);
}
const inpEndpoint = document.getElementById('ai-endpoint');
const inpModel    = document.getElementById('ai-model');
const inpKey      = document.getElementById('ai-key');
const selRoute    = document.getElementById('ai-route');
const chkAgent    = document.getElementById('ai-agent');
const modelList   = document.getElementById('ai-model-list');

function fillModelList() {
  const p = AI_PROVIDERS[selProvider.value] || AI_PROVIDERS.openai;
  modelList.innerHTML = p.models.map(m => `<option value="${aiEsc(m)}">`).join('');
}

function loadSettingsForm() {
  selProvider.value = aiSettings.provider in AI_PROVIDERS ? aiSettings.provider : 'custom';
  inpEndpoint.value = aiSettings.endpoint || '';
  inpModel.value = aiSettings.model || '';
  inpKey.value = aiSettings.apiKey || '';
  selRoute.value = aiSettings.route || 'auto';
  chkAgent.checked = aiSettings.agentEnabled !== false;
  fillModelList();
}

function readSettingsForm() {
  aiSettings.provider = selProvider.value;
  aiSettings.endpoint = inpEndpoint.value.trim();
  aiSettings.model = inpModel.value.trim();
  aiSettings.apiKey = inpKey.value.trim();
  aiSettings.route = selRoute.value;
  aiSettings.agentEnabled = chkAgent.checked;
  saveSettings();
  updateAiHeader();
}

selProvider.addEventListener('change', () => {
  const p = AI_PROVIDERS[selProvider.value];
  if (p && selProvider.value !== 'custom') {
    inpEndpoint.value = p.endpoint;
    if (p.models.length && !inpModel.value) inpModel.value = p.models[0];
  }
  fillModelList();
  readSettingsForm();
});
[inpEndpoint, inpModel, inpKey, selRoute].forEach(el => el.addEventListener('change', readSettingsForm));
[inpEndpoint, inpModel, inpKey].forEach(el => el.addEventListener('input', () => {
  // sauvegarde différée simple pendant la frappe
  clearTimeout(el._t); el._t = setTimeout(readSettingsForm, 400);
}));
chkAgent.addEventListener('change', readSettingsForm);

document.getElementById('ai-key-eye').addEventListener('click', () => {
  inpKey.type = inpKey.type === 'password' ? 'text' : 'password';
});

function openAiSettings() {
  loadSettingsForm();
  document.getElementById('ai-test-result').textContent = '';
  aiModal.classList.remove('hidden');
}
function closeAiSettings() {
  readSettingsForm();
  aiModal.classList.add('hidden');
  renderChat(); // le prompt agent peut avoir changé
}
document.getElementById('ai-settings-close').addEventListener('click', closeAiSettings);
aiModal.addEventListener('pointerdown', e => { if (e.target === aiModal) closeAiSettings(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !aiModal.classList.contains('hidden')) closeAiSettings();
});

document.getElementById('ai-test').addEventListener('click', async () => {
  readSettingsForm();
  const res = document.getElementById('ai-test-result');
  res.textContent = '⏳ test en cours…';
  res.className = 'ai-test-result';
  const t0 = performance.now();
  try {
    let got = '';
    await aiStream('Tu es un assistant de test. Réponds uniquement "pong".', [{ role: 'user', content: 'ping' }], d => { got += d; }, undefined);
    const ms = Math.round(performance.now() - t0);
    res.textContent = `✅ Connexion OK (${ms} ms) — reçu : « ${got.trim().slice(0, 40) || '…'} » via ${pickRoute() === 'server' ? 'server.py' : 'appel direct'}`;
    res.classList.add('ok');
  } catch (e) {
    res.textContent = '❌ ' + (e.message || e);
    res.classList.add('ko');
  }
});

/* ---- Rendu de la conversation ---- */

function renderChat() {
  aiMsgs.innerHTML = '';
  if (!aiChat.length) {
    aiMsgs.insertAdjacentHTML('beforeend', `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-bubble">
          <p><strong>Bonjour 👋</strong> Je suis votre assistant LLDraw.</p>
          <p>• <strong>Consultant</strong> : posez-moi vos questions sur le plan (capacité, câblage, garanties, IP/VLAN…) ou demandez un audit.<br>
             • <strong>Agent</strong> : demandez-moi des modifications — je vous proposerai toujours un récapitulatif à <strong>approuver</strong> avant d'appliquer, et <strong>Ctrl+Z</strong> annule tout.</p>
          <p class="ai-warn">${aiConfigured() ? '' : '⚙️ Configurez d\'abord votre fournisseur et votre clé API (bouton 🤖 en haut à droite).'}</p>
        </div>
      </div>`);
    return;
  }
  for (const m of aiChat) aiMsgs.appendChild(renderMsg(m));
  aiMsgs.scrollTop = aiMsgs.scrollHeight;
}

function renderMsg(m) {
  const wrap = document.createElement('div');
  if (m.role === 'assistant') {
    wrap.className = 'ai-msg ai-msg-bot';
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.innerHTML = aiMarkdown(stripOpsBlocks(m.content));
    wrap.appendChild(bubble);
    if (m.ops && m.ops.list && m.ops.list.length) wrap.appendChild(renderOpsCard(m));
  } else {
    wrap.className = 'ai-msg ai-msg-user' + (String(m.content || '').startsWith('[Système LLDraw]') ? ' ai-msg-sys' : '');
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.innerHTML = aiMarkdown(m.content);
    wrap.appendChild(bubble);
  }
  return wrap;
}

function renderOpsCard(m) {
  const card = document.createElement('div');
  card.className = 'ai-ops';
  const st = m.ops.state;
  const results = m.ops.results || dryRunOps(m.ops.list);
  m.ops.results = results;

  if (st === 'pending') {
    card.innerHTML = `
      <div class="ai-ops-head">🔧 ${results.length} modification(s) proposée(s) — approbation requise</div>
      <div class="ai-ops-list"></div>
      <div class="ai-ops-actions">
        <button class="ai-btn ai-btn-apply" type="button">✔ Appliquer la sélection</button>
        <button class="ai-btn ai-btn-reject" type="button">✖ Refuser</button>
      </div>
      <div class="ai-ops-note">Une fois appliqué, Ctrl+Z annule l'ensemble du lot.</div>`;
    const list = card.querySelector('.ai-ops-list');
    results.forEach((r, i) => {
      const row = document.createElement('label');
      row.className = 'ai-op-row' + (r.ok ? '' : ' ai-op-bad');
      row.innerHTML = `
        <input type="checkbox" ${r.checked ? 'checked' : ''} ${r.ok ? '' : 'disabled'}>
        <span class="ai-op-desc">${aiEsc(r.desc)}</span>
        ${r.ok ? '' : `<span class="ai-op-err">⛔ ${aiEsc(r.error)}</span>`}`;
      row.querySelector('input').addEventListener('change', e => { r.checked = e.target.checked; });
      list.appendChild(row);
    });
    card.querySelector('.ai-btn-apply').addEventListener('click', () => doApplyOps(m, card));
    card.querySelector('.ai-btn-reject').addEventListener('click', () => {
      m.ops.state = 'rejected';
      persistChat(); renderChat(); updateBadge();
    });
  } else if (st === 'applied') {
    const rep = m.ops.report || { applied: [], failed: [] };
    card.innerHTML = `
      <div class="ai-ops-head ai-ops-done">✅ ${rep.applied.length} modification(s) appliquée(s)${rep.failed.length ? ` — ⛔ ${rep.failed.length} refusée(s) par la validation` : ''}</div>
      <div class="ai-ops-list">${rep.applied.map(a => `<div class="ai-op-row ai-op-applied"><span class="ai-op-desc">${aiEsc(a.desc)}</span></div>`).join('')}
      ${rep.failed.map(f => `<div class="ai-op-row ai-op-bad"><span class="ai-op-desc">${aiEsc(f.op.op)}</span><span class="ai-op-err">⛔ ${aiEsc(f.error)}</span></div>`).join('')}</div>
      <div class="ai-ops-note">Ctrl+Z annule l'ensemble du lot.</div>`;
  } else {
    card.innerHTML = `<div class="ai-ops-head ai-ops-rejected">✖ Proposition refusée</div>`;
  }
  return card;
}

function doApplyOps(m, card) {
  const wanted = (m.ops.results || []).filter(r => r.checked && r.ok).map(r => r.op);
  if (!wanted.length) return;
  // Re-validation en direct (l'état a pu changer depuis la proposition) :
  // on applique séquentiellement, les opérations devenues invalides sont
  // ignorées et signalées.
  const rep = applyApprovedOps(wanted);
  m.ops.state = 'applied';
  m.ops.report = rep;
  persistChat();
  renderChat();
  updateBadge();
  // Compte-rendu renvoyé au modèle au prochain tour
  const lines = rep.applied.map(a => a.desc);
  const errs = rep.failed.map(f => `${f.op.op} : ${f.error}`);
  aiChat.push({
    role: 'user',
    content: '[Système LLDraw] Résultat de l\'approbation — appliquées : ' + (lines.length ? '\n' + lines.join('\n') : 'aucune') +
             (errs.length ? '\nRefusées par la validation :\n' + errs.join('\n') : '') +
             '\n(Rappel : l\'utilisateur peut tout annuler avec Ctrl+Z.)'
  });
  persistChat();
  renderChat();
}

/* ---- Envoi / streaming ---- */

aiInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
});
// La zone de saisie grandit vers le haut avec le contenu ; la barre de
// défilement n'apparaît qu'au-delà de ~5 lignes (hauteur plafonnée).
const AI_INPUT_MAX_H = 122;
function aiInputAutoGrow() {
  aiInput.style.height = 'auto';
  aiInput.style.height = Math.min(AI_INPUT_MAX_H, aiInput.scrollHeight) + 'px';
}
aiInput.addEventListener('input', aiInputAutoGrow);
aiSendBtn.addEventListener('click', aiSend);
aiStopBtn.addEventListener('click', () => { if (aiAbort) aiAbort.abort(); });

async function aiSend() {
  const text = aiInput.value.trim();
  if (!text || aiBusy) return;
  const needsKey = aiSettings.provider !== 'ollama';
  const directWithoutKey = needsKey && !aiSettings.apiKey && pickRoute() !== 'server';
  if (!aiSettings.endpoint || !aiSettings.model || directWithoutKey) {
    openAiSettings();
    return;
  }
  aiInput.value = '';
  aiInputAutoGrow();
  aiChat.push({ role: 'user', content: text });
  persistChat();
  renderChat();

  aiBusy = true;
  aiSendBtn.classList.add('hidden');
  aiStopBtn.classList.remove('hidden');

  // Bulle assistant en cours de streaming
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg-bot';
  wrap.innerHTML = '<div class="ai-bubble ai-streaming"><span class="ai-dots">●●●</span></div>';
  aiMsgs.appendChild(wrap);
  const bubble = wrap.querySelector('.ai-bubble');
  aiMsgs.scrollTop = aiMsgs.scrollHeight;

  let full = '';
  let rafPending = false;
  const paint = () => {
    rafPending = false;
    bubble.innerHTML = aiMarkdown(stripOpsBlocks(full)) + '<span class="ai-caret"></span>';
    aiMsgs.scrollTop = aiMsgs.scrollHeight;
  };

  aiAbort = new AbortController();
  try {
    await aiStream(systemPrompt() + '\n\n<PLAN>\n' + buildDigest() + '\n</PLAN>', buildHistory(), delta => {
      full += delta;
      if (!rafPending) { rafPending = true; requestAnimationFrame(paint); }
    }, aiAbort.signal);
  } catch (e) {
    bubble.classList.remove('ai-streaming');
    if (e.name === 'AbortError') {
      bubble.innerHTML = aiMarkdown(stripOpsBlocks(full)) + '<div class="ai-warn">⏹ Interrompu.</div>';
      if (full.trim()) { aiChat.push({ role: 'assistant', content: full }); persistChat(); }
    } else {
      bubble.innerHTML = `<div class="ai-warn">❌ ${aiEsc((e && e.message) || e)}<br><small>Vérifiez la clé API, le modèle et la route dans les réglages 🤖.</small></div>`;
    }
    finishTurn();
    return;
  }

  bubble.classList.remove('ai-streaming');
  const msg = { role: 'assistant', content: full };
  const ops = aiSettings.agentEnabled ? extractOpsBlocks(full) : [];
  if (ops.length) msg.ops = { list: ops, state: 'pending', results: null };
  aiChat.push(msg);
  persistChat();
  renderChat();
  updateBadge();
  finishTurn();

  function finishTurn() {
    aiBusy = false;
    aiAbort = null;
    aiSendBtn.classList.remove('hidden');
    aiStopBtn.classList.add('hidden');
    updateAiHeader();
  }
}

/* ---- Initialisation ---- */

updateAiHeader();
renderChat();
updateBadge();

})();
