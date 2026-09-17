/* Test d'intégration jsdom : LLDraw + assistant IA (ai.js)
   ----------------------------------------------------------
   Couvre : ancrages UI, composer, streaming SSE, digest (portée workspace
   actif, sans photos), validation + approbation des opérations (UNE
   transaction, undo), ports (add_port/add_cable/remove_port), remove_rack,
   conversations PAR workspace, garde « aucun workspace ouvert », modales
   maison (confirm/prompt natifs remplacés), repli sans streaming, erreurs
   persistantes.

   Usage : npm i jsdom (dev uniquement) puis :  node tests/test-ai.js
   Le harnais lit index.html (sans ses <script>) et injecte app.js + ai.js. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..') + '/';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { ({ JSDOM } = require('/tmp/node_modules/jsdom')); }

const html = fs.readFileSync(ROOT + 'index.html', 'utf8')
  .replace(/<script src="app\.js[^"]*"><\/script>/, '')
  .replace(/<script src="ai\.js[^"]*"><\/script>/, '');
const demo = JSON.parse(fs.readFileSync(ROOT + 'demo/demo-state.json', 'utf8'));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:8080/' });
const w = dom.window;
w.TextDecoder = TextDecoder;
w.TextEncoder = TextEncoder;
if (!w.AbortController) w.AbortController = AbortController;

const calls = [];
let sseQueue = [];
let proxyWorks = false;   // le proxy /api/ai existe
let directFails = false;  // le fetch direct lève TypeError (CORS)
let jsonMode = false;     // le fournisseur répond en JSON non streamé
const enc = new TextEncoder();

function fakeResp(status, ctype, bodyObj) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? ctype : null) },
    json: async () => bodyObj,
    text: async () => JSON.stringify(bodyObj ?? ''),
    body: null
  };
}

function sseResp(fullText) {
  let sse = '';
  const pieces = String(fullText).match(/[\s\S]{1,24}/g) || [];
  for (const p of pieces) sse += `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`;
  sse += 'data: [DONE]\n\n';
  const bytes = enc.encode(sse);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 17) chunks.push(bytes.slice(i, i + 17));
  let idx = 0;
  return {
    ok: true, status: 200,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: { getReader: () => ({ read: async () => (idx < chunks.length ? { done: false, value: chunks[idx++] } : { done: true }) }) },
    json: async () => ({}), text: async () => ''
  };
}

w.fetch = async (url, opts = {}) => {
  const u = String(url && url.url !== undefined ? url.url : url);
  calls.push({ u, method: opts.method || 'GET', body: opts.body });
  if (u.includes('/api/state')) return fakeResp(500, 'application/json', { ok: false });
  if (u.includes('watchguard')) return fakeResp(404, 'text/plain', null);
  if (u.endsWith('/api/ai')) {
    if (!proxyWorks) return fakeResp(404, 'text/html', null);
    const make = sseQueue.shift();
    return sseResp(typeof make === 'function' ? make() : (make || 'pong proxy'));
  }
  if (u.includes('api.openai.com') || u.includes('localhost:9999')) {
    if (directFails) { const t = new TypeError('Failed to fetch'); throw t; }
    if (jsonMode && sseQueue.length === 0) return fakeResp(200, 'application/json', { choices: [{ message: { content: 'pong non-stream' } }] });
    const make = sseQueue.shift();
    if (!make) return fakeResp(500, 'application/json', { error: { message: 'file SSE vide' } });
    return sseResp(typeof make === 'function' ? make() : make);
  }
  return fakeResp(404, 'text/plain', null);
};

w.localStorage.setItem('dc-rack-planner-v1', JSON.stringify(demo));
w.localStorage.setItem('lldraw-ai-settings-v1', JSON.stringify({
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test',
  route: 'direct',
  agentEnabled: true
}));

function inject(code) {
  const s = w.document.createElement('script');
  s.textContent = code;
  w.document.body.appendChild(s);
}
inject(fs.readFileSync(ROOT + 'app.js', 'utf8'));
inject(fs.readFileSync(ROOT + 'ai.js', 'utf8'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
let failures = 0;
function check(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { failures++; console.error('  ❌ ' + label); }
}
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const chatKeyNow = () => 'lldraw-ai-chat-ws-' + w.eval('state.activeWorkspaceId');
const send = async text => {
  $('#ai-input').value = text;
  click($('#ai-send'));
  for (let i = 0; i < 100; i++) { await sleep(40); if (!$('#ai-send').classList.contains('hidden') && !$('#ai-msgs .ai-streaming')) break; }
  await sleep(60);
};
const lastCard = () => $$('.ai-ops').pop();

(async () => {
  await sleep(400);

  console.log('— 1. Ancrages UI & composer —');
  check(!!$('#btn-ai-settings'), 'bouton réglages 🤖 dans la topbar');
  check($('#btn-ai-settings').previousElementSibling === $('#save-status'), '… juste à côté de l\'indicateur ☁️');
  check(!!$('#ai-fab'), 'bouton chat 💬 présent');
  click($('#ai-fab'));
  await sleep(60);
  check($('#ai-panel').classList.contains('open'), 'clic 💬 → panneau ouvert');
  check(!$('#ai-route-hint'), 'mention « via server.py » absente du composer');
  const row = $('#ai-input').parentElement;
  check(row.classList.contains('ai-composer-row') && row.contains($('#ai-send')) && row.contains($('#ai-stop')),
    'barre de saisie + boutons envoyer/stop sur la même ligne');
  check(w.eval('!!active() && active().racks.length === 2'), 'état démo chargé (2 racks)');

  console.log('— 2. Tour agent : streaming SSE + carte d\'approbation —');
  const devBefore = w.eval('state.devices.length');
  const flowsBefore = w.eval('active().flows.length');
  const ops1 = JSON.stringify([
    { op: 'create_device_model', tempId: '$srv', name: 'SRV-TEST-99', sizeU: 1, brand: 'Dell', model: 'R750', watts: 350, weightKg: 18, portsCount: 2 },
    { op: 'add_device', rackId: 'rack-a', deviceId: '$srv', slot: 16, name: 'SRV-TEST-99', ipMgmt: '10.10.99.9', vlan: '99' },
    { op: 'add_device', rackId: 'rack-inexistant', deviceId: 'dev-dell', slot: 0 },
    { op: 'add_flow', name: 'Flux test IA', src: 'SRV-TEST-99', dst: 'NAS', proto: 'TCP/443', sens: 'uni', usage: 'test' },
    { op: 'fill_lld', field: 'objectif', text: "Objectif rédigé par l'assistant (test)." },
    { op: 'update_device', instId: 'inst-fw-a', warrantyEnd: '2027-12-31' }
  ]);
  sseQueue.push('Voici les modifications demandées :\n```lldraw-ops\n' + ops1 + '\n```');
  await send('Ajoute un serveur de test, complète l\'objectif du dossier');

  check(!!$('.ai-ops'), 'carte d\'approbation affichée (diff systématique)');
  check($$('.ai-op-row').length === 6, '6 opérations listées (' + $$('.ai-op-row').length + ')');
  check($$('.ai-op-bad').length === 1, 'opération invalide détectée (rack-inexistant)');
  check($$('.ai-op-bad input')[0] && $$('.ai-op-bad input')[0].disabled, '… sa case est désactivée');
  check(($$('.ai-op-bad .ai-op-desc')[0].textContent || '').includes('Placer'),
    'opération invalide décrite en français (pas le nom brut de l\'op)');
  check($$('.ai-op-row input').filter(c => c.checked).length === 5, '5 opérations valides pré-cochées');

  const openaiCall = calls.filter(c => c.u.includes('api.openai.com')).pop();
  const sysContent = JSON.parse(openaiCall.body).messages[0].content;
  check(sysContent.includes('<PLAN>') && sysContent.includes('"rack-a"'), 'prompt système + condensé <PLAN> avec les vrais ids');
  check(sysContent.includes('portee') && !openaiCall.body.includes('autresWorkspaces'),
    'condensé : portée = workspace actif, autres workspaces non listés');
  check(!openaiCall.body.includes('data:image'), 'aucune photo base64 dans la requête');

  console.log('— 3. Application approuvée : UNE transaction —');
  click($('.ai-btn-apply'));
  await sleep(150);
  check(w.eval('state.devices.length') === devBefore + 1, 'modèle SRV-TEST-99 créé dans la bibliothèque');
  check(w.eval(`(() => { const i = active().racks[0].instances.find(x => x.name === 'SRV-TEST-99');
      return !!i && i.slot === 16 && i.ipMgmt === '10.10.99.9' && i.ports.length === 2 && i.watts === 350; })()`),
    'device placé (slot 16, 2 ports, 350 W)');
  check(w.eval('active().flows.length') === flowsBefore + 1, 'flux ajouté');
  check(w.eval("active().lld.objectif.startsWith('Objectif rédigé')"), 'section LLD « objectif » rédigée');
  check(w.eval('undoStack.length') === 1, 'une SEULE transaction pour 5 opérations');
  check(!!$('.ai-ops-done') && $('.ai-ops-done').textContent.includes('5'), 'carte passée en « ✅ 5 appliquées »');

  console.log('— 4. Ports : add_port → add_cable → remove_port —');
  const portsBefore = w.eval("active().racks[0].instances.find(i => i.id === 'inst-fw-a').ports.length");
  sseQueue.push('fait\n```lldraw-ops\n[{"op":"add_port","instId":"inst-fw-a","name":"AI-PORT","ip":"10.0.0.1"}]\n```');
  await send('ajoute un port');
  let card = lastCard();
  check(!!card && !card.querySelector('.ai-op-bad'), 'add_port validé au dry-run');
  click(card.querySelector('.ai-btn-apply'));
  await sleep(150);
  const newPort = JSON.parse(w.eval("JSON.stringify((() => { const i = active().racks[0].instances.find(x => x.id === 'inst-fw-a'); return i.ports.find(p => p.name === 'AI-PORT') || null; })())"));
  check(!!newPort && w.eval("active().racks[0].instances.find(i => i.id === 'inst-fw-a').ports.length") === portsBefore + 1,
    'port créé sur le device placé (ip incluse)');
  check(typeof (newPort || {}).xPct === 'number', '… positionné automatiquement sur le façade');

  const other = JSON.parse(w.eval("JSON.stringify((() => { const ws = active(); const busy = new Set(); ws.cables.forEach(c => { busy.add(c.a.portId); busy.add(c.b.portId); }); for (const r of ws.racks) for (const i of r.instances) if (i.id !== 'inst-fw-a') for (const p of (i.ports || [])) if (!busy.has(p.id)) return { inst: i.id, port: p.id }; return null; })())"));
  check(!!other, 'second device avec port LIBRE trouvé pour le câblage');
  const cablesB = w.eval('active().cables.length');
  sseQueue.push('fait\n```lldraw-ops\n' + JSON.stringify([{ op: 'add_cable', aInstId: 'inst-fw-a', aPortId: newPort.id, bInstId: other.inst, bPortId: other.port, color: '#2563eb' }]) + '\n```');
  await send('câble-le');
  card = lastCard();
  check(!!card && !card.querySelector('.ai-op-bad'), 'add_cable vers le port créé : validé');
  click(card.querySelector('.ai-btn-apply'));
  await sleep(150);
  check(w.eval('active().cables.length') === cablesB + 1, 'cordon créé entre les deux ports');

  sseQueue.push('fait\n```lldraw-ops\n[{"op":"remove_port","instId":"inst-fw-a","portId":"' + newPort.id + '"}]\n```');
  await send('retire le port');
  card = lastCard();
  check(!!card && !card.querySelector('.ai-op-bad'), 'remove_port validé');
  click(card.querySelector('.ai-btn-apply'));
  await sleep(150);
  check(w.eval("!active().racks[0].instances.find(i => i.id === 'inst-fw-a').ports.some(p => p.name === 'AI-PORT')"), 'port supprimé');
  check(w.eval('active().cables.length') === cablesB, 'cordon branché dessus purgé automatiquement');

  console.log('— 5. remove_rack + undo —');
  const racksBefore = w.eval('active().racks.length');
  sseQueue.push('fait\n```lldraw-ops\n[{"op":"remove_rack","rackId":"rack-b"}]\n```');
  await send('supprime le rack B');
  card = lastCard();
  check(!!card && card.querySelectorAll('.ai-op-row').length === 1 && !card.querySelector('.ai-op-bad'), 'remove_rack validé au dry-run');
  check(((card.querySelectorAll('.ai-op-desc')[0] || {}).textContent || '').includes('supprimé'), '… description lisible');
  click(card.querySelector('.ai-btn-apply'));
  await sleep(150);
  check(w.eval('active().racks.length') === racksBefore - 1, 'rack supprimé après approbation');
  w.eval('undo()');
  await sleep(80);
  check(w.eval('active().racks.length') === racksBefore, 'Ctrl+Z restaure le rack supprimé');

  console.log('— 6. Une conversation par workspace —');
  const wsA = w.eval('active().id');
  w.eval("state.workspaces.push(makeWorkspace('WS-TEST-B')); state.activeWorkspaceId = state.workspaces[state.workspaces.length - 1].id; notifyWorkspaceChanged();");
  await sleep(80);
  check($$('#ai-msgs .ai-msg-user').length === 0, 'conversation VIDE dans le nouveau workspace');
  check(($('#ai-ctx').textContent || '').includes('WS-TEST-B'), 'en-tête 📍 = nom du workspace actif');
  sseQueue.push('pong B');
  await send('message destiné à B');
  check($$('#ai-msgs .ai-msg-user').length === 1, '… conversation B = 1 message utilisateur');
  w.eval("openWorkspace('" + wsA + "')");
  await sleep(80);
  check($$('#ai-msgs .ai-msg').length > 2, 'retour en A : conversation d\'origine retrouvée');
  check(!($('#ai-msgs').textContent || '').includes('destiné à B'), '… sans les messages de B');
  check(!!w.localStorage.getItem('lldraw-ai-chat-ws-' + wsA) && !!w.localStorage.getItem('lldraw-ai-chat-ws-' + w.eval('state.workspaces.find(x => x.name === "WS-TEST-B").id')),
    'conversations A et B stockées sous leurs propres clés');

  console.log('— 7. Ops sans workspace ouvert : écartées + avertissement —');
  w.eval('state.activeWorkspaceId = null; notifyWorkspaceChanged();');
  await sleep(80);
  check(($('#ai-ctx').textContent || '').includes("écran d'accueil"), 'en-tête 📍 signale « aucun workspace »');
  sseQueue.push('voici\n```lldraw-ops\n[{"op":"create_rack","name":"R-X","sizeU":42}]\n```');
  await send('crée un rack');
  check($$('.ai-ops').length === 0 || !lastCard().querySelector('.ai-btn-apply'), 'aucune carte approbable sans workspace actif');
  check(($$('#ai-msgs .ai-msg').pop().textContent || '').includes('ÉCARTÉES'), 'avertissement « opérations écartées » affiché');

  console.log('— 8. Modales maison (confirm/prompt natifs remplacés) —');
  w.eval("openWorkspace('" + wsA + "')");
  await sleep(80);
  const rackDelBtn = w.document.querySelector('.rack-header .rack-del');
  check(!!rackDelBtn && (rackDelBtn.textContent || '').includes('🗑'), 'bouton de suppression du rack VISIBLE avec icône 🗑');
  click(rackDelBtn);
  await sleep(60);
  check(!!w.document.querySelector('.lld-dlg'), '… clic → modale maison (pas un confirm() natif)');
  click(w.document.querySelector('.lld-dlg-cancel'));
  await sleep(60);
  check(!w.document.querySelector('.lld-dlg') && w.eval('active().racks.length') === racksBefore, 'Annuler → rack conservé');

  const nWs = w.eval('state.workspaces.length');
  w.eval('createWorkspace()');
  await sleep(60);
  const dlg = w.document.querySelector('.lld-dlg');
  check(!!dlg && !!dlg.querySelector('.lld-dlg-input'), 'création de workspace : modale maison avec champ de saisie');
  check(((dlg.querySelector('.lld-dlg-input') || {}).value || '').startsWith('Workspace'), '… champ pré-rempli');
  dlg.querySelector('.lld-dlg-input').value = 'WS-MODALE';
  click(dlg.querySelector('.lld-dlg-ok'));
  await sleep(120);
  check(w.eval('state.workspaces.length') === nWs + 1 && w.eval('active().name') === 'WS-MODALE', 'Créer → workspace créé et ouvert');
  const wsNew = w.eval('active().id');
  w.eval("deleteWorkspace('" + wsNew + "')");
  await sleep(60);
  check(!!w.document.querySelector('.lld-dlg-danger'), 'suppression de workspace : modale avec bouton rouge');
  click(w.document.querySelector('.lld-dlg-cancel'));
  await sleep(60);
  check(w.eval('state.workspaces.length') === nWs + 1, 'Annuler → workspace conservé');
  w.eval("deleteWorkspace('" + wsNew + "')");
  await sleep(60);
  click(w.document.querySelector('.lld-dlg-danger'));
  await sleep(120);
  check(w.eval('state.workspaces.length') === nWs, 'Supprimer → workspace supprimé');

  console.log('— 9. Flux vide : erreur « Réponse vide » —');
  sseQueue.push(() => '', () => '');
  await send('ping vide');
  let bb = $$('.ai-msg-bot .ai-bubble');
  check((bb[bb.length - 1].textContent || '').includes('Réponse vide'), '« Réponse vide du fournisseur… » affichée');

  console.log('— 10. SSE muet → repli automatique SANS streaming —');
  sseQueue.push(() => '');
  jsonMode = true;
  await send('ping repli');
  jsonMode = false;
  bb = $$('.ai-msg-bot .ai-bubble');
  check((bb[bb.length - 1].textContent || '').includes('pong non-stream'), 'réponse obtenue via le repli non streamé');
  check((bb[bb.length - 1].textContent || '').includes('sans streaming'), 'note « Réponse reçue sans streaming » affichée');

  console.log('— 11. Erreur réseau : affichée ET persistante —');
  directFails = true;
  await send('ping cors');
  directFails = false;
  bb = $$('.ai-msg-bot .ai-bubble');
  const errTxt = bb[bb.length - 1].textContent || '';
  check(errTxt.includes('❌'), 'erreur affichée dans le chat (bulle ❌)');
  click($('#ai-gear-2')); await sleep(40);
  click($('#ai-settings-close')); await sleep(60);
  bb = $$('.ai-msg-bot .ai-bubble');
  check((bb[bb.length - 1].textContent || '').includes('❌'), 'l\'erreur SURVIT au re-render');
  check(JSON.parse(w.localStorage.getItem(chatKeyNow()) || '[]').some(m => m.error), 'erreur mémorisée dans la conversation persistée');

  console.log(failures ? `\n❌ ${failures} ÉCHEC(S)` : '\n🎉 TOUS LES TESTS PASSENT');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR TEST:', e); process.exit(2); });
