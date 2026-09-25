/* ============================================================
   LLDraw — RAPPORT HTML INTERACTIF (export « tout-en-un »)
   ------------------------------------------------------------
   Génère un fichier .html AUTONOME (aucune dépendance, aucun
   CDN, fonctionne hors-ligne) : il suffit de l'ouvrir dans un
   navigateur ou de l'envoyer par mail.

   Pourquoi ce format plutôt que le PDF / l'Excel « chapitres » :
     • lecture guidée : sommaire latéral cliquable, sections
       hiérarchiques (site → baie → équipement → ports) ;
     • recherche instantanée sur TOUTES les données (un câble,
       une IP, un device…) sans re-parcourir 18 pages ;
     • tableaux sobres : aucune colonne répétée ligne par ligne,
       les baies forment des blocs repliables ;
     • visuels en grand : une élévation PAR baie + topologie,
       zoomables en lightbox ;
     • garanties en couleur (vert / orange / rouge) ;
     • impression propre (@media print) : Ctrl+P → PDF via le
       navigateur, meilleur rendu que le générateur PDF maison.

   Ce fichier ne dépend que des globales déjà définies par
   app.js (fonctions de données : sortedRackInstances, siteName,
   warrantyInfo, cables via resolveEndpoint, normLldInfo…).
   ============================================================ */

/* ---------- Petits utilitaires locaux ---------- */
const RPT_ESC = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const RPT_ESC_ARIA = s => RPT_ESC(s).replace(/`/g, '&#96;');

/* Couleurs / pastilles réutilisées dans le rapport */
function rptWarrantyBadge(inst) {
  const w = warrantyInfo(inst);
  if (w.status === 'none') return '<span class="badge muted">non renseignée</span>';
  if (w.status === 'out')
    return `<span class="badge ko">⛔ Hors garantie · ${RPT_ESC(w.label)}</span>`;
  return w.soon
    ? `<span class="badge soon">⚠️ ${RPT_ESC(w.label)} · expire dans ${w.days} j</span>`
    : `<span class="badge ok">✅ ${RPT_ESC(w.label)}</span>`;
}
function rptCableChip(color) {
  const c = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#8ea0b8';
  return `<span class="chip" style="--c:${c}" title="${RPT_ESC(color || '')}"></span><span class="chip-cod">${RPT_ESC(color || '—')}</span>`;
}

/* ---------- Sections du rapport ---------- */

// Cartes de synthèse (bandeau de chiffres clés sous la garde)
function rptKpis(ws) {
  const racks = ws.racks.length;
  const devs = sortedRackInstances(ws).length;
  const cables = (ws.cables || []).length;
  const ports = sortedRackInstances(ws).reduce((s, x) => s + (x.inst.ports || []).length, 0);
  const sites = (ws.sites || []).length;
  const wsum = warrantySummary(ws);
  const kpi = (ico, num, lbl, cls = '') =>
    `<div class="kpi ${cls}"><div class="kpi-num">${RPT_ESC(num)}</div><div class="kpi-lbl">${ico} ${RPT_ESC(lbl)}</div></div>`;
  let out = kpi('🏢', sites || '—', 'site' + (sites > 1 ? 's' : ''))
    + kpi('🗄️', racks, 'baie' + (racks > 1 ? 's' : ''))
    + kpi('📦', devs, 'équipement' + (devs > 1 ? 's' : ''))
    + kpi('🔌', cables, 'câble' + (cables > 1 ? 's' : ''))
    + kpi('🗂️', ports, 'ports étiquetés');
  if (wsum.known) {
    out += kpi('✅', wsum.in, 'en garantie', 'k-ok');
    if (wsum.soon) out += kpi('⚠️', wsum.soon, 'expire' + (wsum.soon > 1 ? 'nt' : '') + ' < 90 j', 'k-soon');
    if (wsum.out) out += kpi('⛔', wsum.out, 'hors garantie', 'k-ko');
  }
  return `<div class="kpis">${out}</div>`;
}

// Cartes « site » avec leurs baies et jauges de capacité
function rptSitesBlocks(ws) {
  const sites = ws.sites || [];
  const racksOf = sid => sortedRacks(ws).filter(r => (r.siteId || '') === sid);
  const orphan = sortedRacks(ws).filter(r => !sites.some(s => s.id === r.siteId));
  const gauge = (used, total, unit) => {
    if (!total) return '';
    const pct = Math.min(100, Math.round(used * 100 / total));
    return `<div class="gauge" title="${used} / ${total} ${unit}">
      <div class="gauge-bar${pct > 85 ? ' hot' : ''}" style="width:${pct}%"></div>
      <span class="gauge-txt">${RPT_ESC(used)}&thinsp;/&thinsp;${RPT_ESC(total)} ${RPT_ESC(unit)}</span></div>`;
  };
  const rackCard = r => {
    const usedU = r.instances.reduce((s, i) => s + i.sizeU, 0);
    const watts = r.instances.reduce((s, i) => s + (i.watts || 0), 0);
    const kg = Math.round(r.instances.reduce((s, i) => s + (i.weightKg || 0), 0) * 10) / 10;
    return `<a class="rack-card" href="#rack-${RPT_ESC_ARIA(r.id)}">
      <div class="rack-card-h"><b>${RPT_ESC(r.name)}</b><span>${r.sizeU}U · ${r.instances.length} éq.</span></div>
      ${gauge(usedU, r.sizeU, 'U')}
      ${r.maxWatts ? gauge(watts, r.maxWatts, 'W') : (watts ? `<div class="meta">⚡ ${watts} W</div>` : '')}
      ${r.maxKg ? gauge(kg, r.maxKg, 'kg') : (kg ? `<div class="meta">🏋️ ${kg} kg</div>` : '')}
    </a>`;
  };
  let out = '';
  for (const s of sites) {
    const racks = racksOf(s.id);
    out += `<div class="site-block">
      <h3><span class="dot" style="--c:${RPT_ESC(s.color || '#64748b')}"></span>${RPT_ESC(s.name)}</h3>
      ${s.address ? `<div class="meta">📍 ${RPT_ESC(s.address)}</div>` : ''}
      ${s.contact ? `<div class="meta">👤 ${RPT_ESC(s.contact)}</div>` : ''}
      ${s.desc ? `<p class="meta">${RPT_ESC(s.desc)}</p>` : ''}
      <div class="rack-grid">${racks.map(rackCard).join('') || '<div class="meta">Aucune baie rattachée.</div>'}</div>
    </div>`;
  }
  if (orphan.length) {
    out += `<div class="site-block"><h3><span class="dot" style="--c:#94a3b8"></span>Sans site rattaché</h3>
      <div class="rack-grid">${orphan.map(rackCard).join('')}</div></div>`;
  }
  return out || '<p class="muted">Aucune baie dans ce workspace.</p>';
}

// Une <figure> par baie (image recadrée) + le plan global
function rptElevations(ws, rackShots, planDataUrl) {
  let out = '<div class="elev-grid">';
  for (const r of sortedRacks(ws)) {
    const url = rackShots.get(r.id);
    out += `<figure class="elev" id="rack-${RPT_ESC_ARIA(r.id)}">
      <figcaption><b>${RPT_ESC(r.name)}</b> — ${RPT_ESC(siteName(ws, r)) || 'sans site'} · ${r.sizeU}U</figcaption>
      ${url ? `<img src="${url}" alt="Élévation ${RPT_ESC_ARIA(r.name)}" loading="lazy">`
            : '<div class="meta">(image indisponible)</div>'}
    </figure>`;
  }
  out += '</div>';
  if (planDataUrl) {
    out += `<figure class="elev full">
      <figcaption><b>Vue d'ensemble du board</b> (toutes les baies)</figcaption>
      <img src="${planDataUrl}" alt="Plan d'ensemble" loading="lazy">
    </figure>`;
  }
  return out;
}

// Textes documentaires saisis dans la fiche LLD (ch. 1 → 3)
function rptContext(ws) {
  const L = normLldInfo(ws);
  const block = (title, txt) => {
    const t = (txt || '').trim();
    if (!t) return '';
    return `<div class="prose"><h3>${RPT_ESC(title)}</h3>${
      t.split(/\n+/).map(p => `<p>${RPT_ESC(p)}</p>`).join('')}</div>`;
  };
  return block('Objectif du document', L.objectif)
       + block('Infrastructure existante', L.existant)
       + block('Architecture cible', L.architecture)
    || '<p class="muted">Textes non renseignés (fiche 📘 du dossier, onglet Document).</p>';
}

// Inventaire : un bloc repliable par baie, table sans colonnes répétées
function rptInventory(ws) {
  const byRack = new Map();
  sortedRackInstances(ws).forEach(({ rack, inst }) => {
    if (!byRack.has(rack.id)) byRack.set(rack.id, { rack, items: [] });
    byRack.get(rack.id).items.push(inst);
  });
  if (!byRack.size) return '<p class="muted">Aucun équipement placé.</p>';
  let out = '';
  for (const { rack, items } of byRack.values()) {
    const rows = items.map(inst => {
      const search = [inst.name, inst.brand, inst.model, inst.serial, inst.ipMgmt, inst.vlan,
        catLabel(normCat(inst.cat)), slotLabel(inst)].join(' ').toLowerCase();
      return `<tr data-search="${RPT_ESC_ARIA(search)}">
        <td class="nowrap"><b>${RPT_ESC(slotLabel(inst))}</b></td>
        <td class="nowrap"><b>${RPT_ESC(inst.name)}</b></td>
        <td class="nowrap">${catIcon(normCat(inst.cat))} ${RPT_ESC(catLabel(normCat(inst.cat)))}</td>
        <td>${RPT_ESC(inst.brand || '')}</td><td>${RPT_ESC(inst.model || '')}</td>
        <td class="nowrap">${RPT_ESC(inst.serial || '')}</td>
        <td class="nowrap">${RPT_ESC(inst.ipMgmt || '')}</td>
        <td>${RPT_ESC(inst.vlan || '')}</td>
        <td class="nw-num">${inst.watts || ''}</td><td class="nw-num">${inst.weightKg || ''}</td>
        <td>${rptWarrantyBadge(inst)}</td></tr>`;
    }).join('');
    // Le site n'est répété que s'il ne figure pas déjà dans le nom de la baie
    const sName = siteName(ws, rack);
    const showSite = sName && !rack.name.includes(sName.split('—')[0].trim());
    out += `<details class="grp" open>
      <summary><span class="dot" style="--c:${RPT_ESC(rack.siteId ? siteColor(ws, rack) : '#94a3b8')}"></span>
        <b>${RPT_ESC(rack.name)}</b><span class="meta">${showSite ? RPT_ESC(sName) + ' · ' : ''}${items.length} équipement${items.length > 1 ? 's' : ''} · ${rack.sizeU}U</span>
      </summary>
      <table class="sortable rack-table">
        <thead><tr>
          <th>Étage</th><th>Nom</th><th>Catégorie</th><th>Marque</th><th>Modèle</th>
          <th>N° série</th><th>IP mgmt</th><th>VLAN(s)</th><th>W</th><th>kg</th><th>Garantie</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>
    </details>`;
  }
  return out;
}

// Détail des ports d'un équipement — tableau « Ports & adressage » complet
function rptPorts(ws) {
  const rows = [];
  const cableOf = (instId, portId) => {
    const c = (ws.cables || []).find(cb =>
      (cb.a?.instId === instId && cb.a?.portId === portId) ||
      (cb.b?.instId === instId && cb.b?.portId === portId));
    return c ? c.name : '';
  };
  const byRack = new Map();
  for (const { rack, inst } of sortedRackInstances(ws)) {
    for (const p of (inst.ports || [])) {
      if (!byRack.has(rack.id)) byRack.set(rack.id, { rack, rows: [] });
      byRack.get(rack.id).rows.push({ inst, p, cable: cableOf(inst.id, p.id) });
    }
  }
  if (!byRack.size) return '<p class="muted">Aucun port étiqueté.</p>';
  let out = '';
  for (const { rack, rows: items } of byRack.values()) {
    rows.length = 0;
    const trs = items.map(({ inst, p, cable }) => {
      const search = [rack.name, inst.name, p.name, p.label, p.ip, p.vlan, cable].join(' ').toLowerCase();
      return `<tr data-search="${RPT_ESC_ARIA(search)}">
        <td class="nowrap"><b>${RPT_ESC(slotLabel(inst))}</b> ${RPT_ESC(inst.name)}</td>
        <td class="nowrap"><b>${RPT_ESC(p.name)}</b></td>
        <td>${RPT_ESC(p.label || '')}</td>
        <td class="nowrap">${RPT_ESC(p.ip || '')}</td>
        <td class="nowrap">${RPT_ESC(p.vlan || '')}</td>
        <td class="nowrap">${RPT_ESC(cable)}</td></tr>`;
    }).join('');
    out += `<details class="grp" open>
      <summary><span class="dot"></span><b>${RPT_ESC(rack.name)}</b><span class="meta">${items.length} ports</span></summary>
      <table class="sortable"><thead><tr>
        <th>Équipement</th><th>Port</th><th>Étiquette</th><th>IP</th><th>VLAN</th><th>Câble</th>
      </tr></thead><tbody>${trs}</tbody></table>
    </details>`;
  }
  return out;
}

// Câblage : pastille couleur, sens de lecture A → B, filtre par domaine
function rptCabling(ws) {
  const cables = ws.cables || [];
  if (!cables.length) return '<p class="muted">Aucun câble dans ce workspace.</p>';
  const domains = [...new Set(cables.map(c => c.domain || ''))];
  const filt = domains.length > 1
    ? `<div class="pills no-print" id="cab-filt">
        <button class="pill on" data-dom="">Tous (${cables.length})</button>` +
      domains.map(d => `<button class="pill" data-dom="${RPT_ESC_ARIA(d)}">${RPT_ESC(cableDomainLabel(d))} (${cables.filter(c => (c.domain || '') === d).length})</button>`).join('') +
      `</div>` : '';
  const ep = e => {
    const d = resolveEndpoint(ws, e);
    return d ? `<b>${RPT_ESC(d.rack.name)}</b> · ${RPT_ESC(d.inst.name)} · <b>${RPT_ESC(d.port.name)}</b>${d.port.label ? `<div class="meta">${RPT_ESC(d.port.label)}</div>` : ''}` : '—';
  };
  const rows = cables.map(c => {
    const search = [c.name, cableDomainLabel(c.domain), c.color].join(' ').toLowerCase();
    return `<tr data-search="${RPT_ESC_ARIA(search)}" data-dom="${RPT_ESC_ARIA(c.domain || '')}">
      <td class="nowrap"><b>${RPT_ESC(c.name || '')}</b></td>
      <td class="nowrap">${rptCableChip(c.color)}</td>
      <td>${RPT_ESC(cableDomainLabel(c.domain))}</td>
      <td>${ep(c.a)}</td><td class="arrow">⟶</td><td>${ep(c.b)}</td></tr>`;
  }).join('');
  return filt + `<table class="sortable" id="cab-table">
    <thead><tr><th>ID câble</th><th>Couleur</th><th>Domaine</th><th>Extrémité A</th><th></th><th>Extrémité B</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Garanties : tableau trié selon échéance + pastilles (code couleur de l'app)
function rptWarranties(ws) {
  const items = sortedRackInstances(ws)
    .map(({ rack, inst }) => ({ rack, inst, w: warrantyInfo(inst) }))
    .filter(x => x.w.status !== 'none');
  if (!items.length) return '<p class="muted">Aucune garantie renseignée.</p>';
  items.sort((a, b) => a.w.days - b.w.days);
  const rows = items.map(({ rack, inst, w }) => {
    const cls = w.status === 'out' ? 'ko' : (w.soon ? 'soon' : 'ok');
    const txt = w.status === 'out' ? `expirée depuis ${-w.days} j`
      : (w.days === 0 ? "aujourd'hui" : `dans ${w.days} j${w.soon ? ' — à renouveler' : ''}`);
    const search = [rack.name, inst.name, inst.serial, inst.warranty, w.label].join(' ').toLowerCase();
    return `<tr data-search="${RPT_ESC_ARIA(search)}" class="w-${cls}">
      <td class="nowrap"><b>${RPT_ESC(inst.name)}</b></td>
      <td class="nowrap">${RPT_ESC(rack.name)} · ${RPT_ESC(slotLabel(inst))}</td>
      <td>${RPT_ESC(inst.serial || '')}</td>
      <td>${RPT_ESC(inst.warranty || '')}</td>
      <td class="nowrap">${RPT_ESC(w.label)}</td>
      <td><span class="badge ${cls}">${RPT_ESC(txt)}</span></td></tr>`;
  }).join('');
  return `<table class="sortable"><thead><tr>
      <th>Équipement</th><th>Emplacement</th><th>N° série</th><th>Contrat</th><th>Fin de garantie</th><th>Échéance</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// Deux tableaux côte à côte : registre VLANs + nomenclature
function rptAddressing(ws) {
  const vl = addressingRows(ws);     // [header, ...lignes]
  const no = nomenRows(ws);
  const tbl = (rows) => {
    if (rows.length < 2) return '<p class="muted">Non renseigné.</p>';
    const head = rows[0].map(h => `<th>${RPT_ESC(h)}</th>`).join('');
    const body = rows.slice(1).map(r =>
      `<tr data-search="${RPT_ESC_ARIA(r.join(' ').toLowerCase())}">${
        r.map(c => `<td>${RPT_ESC(c)}</td>`).join('')}</tr>`).join('');
    return `<table class="sortable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };
  return `<h3>Registre VLANs & subnets</h3>${tbl(vl)}<h3 style="margin-top:22px">Nomenclature</h3>${tbl(no)}`;
}

function rptFlows(ws) {
  const rows = flowsRows(ws);
  if (rows.length < 2) return '<p class="muted">Aucun flux défini (fiche 📘, axe Flux).</p>';
  const head = rows[0].map(h => `<th>${RPT_ESC(h)}</th>`).join('');
  const body = rows.slice(1).map(r =>
    `<tr data-search="${RPT_ESC_ARIA(r.join(' ').toLowerCase())}">${
      r.map(c => `<td>${RPT_ESC(c)}</td>`).join('')}</tr>`).join('');
  return `<table class="sortable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function rptRevisions(ws) {
  const L = normLldInfo(ws);
  if (!L.revs.length) return '';
  const rows = L.revs.map(r =>
    `<tr><td class="nowrap"><b>${RPT_ESC(r.rev)}</b></td><td class="nowrap">${RPT_ESC(r.date)}</td>
     <td>${RPT_ESC(r.author)}</td><td>${RPT_ESC(r.note)}</td></tr>`).join('');
  return `<h3 style="margin-top:26px">Historique des révisions</h3>
    <table><thead><tr><th>Rév</th><th>Date</th><th>Auteur</th><th>Modifications</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ---------- Blocs du dossier LLD (mêmes données que le PDF / l'Excel) ----------
   Toutes les grilles saisies dans la fiche 📘 sont reprises ici, AVEC leurs
   colonnes personnalisées éventuelles (lldExportCols), comme les exports
   historiques. Un bloc vide n'est tout simplement pas affiché. */

// Tableau générique à partir de colonnes [[clé, libellé], …] + lignes objets
function rptLldGrid(cols, rows, { searchable = true } = {}) {
  const data = (rows || []).filter(r =>
    r && cols.some(([k]) => String(r[k] ?? '').trim() !== ''));
  if (!data.length) return '';
  const head = cols.map(([, lbl]) => `<th>${RPT_ESC(lbl)}</th>`).join('');
  const body = data.map(r => {
    const search = searchable ? cols.map(([k]) => String(r[k] ?? '')).join(' ').toLowerCase() : '';
    return `<tr${searchable ? ` data-search="${RPT_ESC_ARIA(search)}"` : ''}>${
      cols.map(([k]) => `<td>${RPT_ESC(r[k] ?? '').replace(/\n/g, '<br>')}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="sortable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
// Sous-titre + grille (vide si aucune ligne)
const rptSub = (title, grid) => grid ? `<h3>${RPT_ESC(title)}</h3>${grid}` : '';
// Paires « libellé : valeur » pour les fiches (profils FW, interco…) — lignes vides omises
function rptKv(fields, obj) {
  const rows = fields.map(f => ({ k: f.k, label: f.label, v: obj?.[f.k] }))
    .filter(r => String(r.v ?? '').trim() !== '');
  if (!rows.length) return '';
  return '<table class="kv"><tbody>' + rows.map(r =>
    `<tr data-search="${RPT_ESC_ARIA((r.label + ' ' + r.v).toLowerCase())}">` +
    `<th>${RPT_ESC(r.label)}</th><td>${RPT_ESC(r.v)}</td></tr>`).join('') + '</tbody></table>';
}
// Captures d'écran d'un chapitre (glissées dans la fiche 📘) — embarquées telles quelles
function rptShots(ws, key) {
  const L = normLldInfo(ws);
  const shots = (L[key] || []).filter(s => s && /^data:image\//.test(s.dataUrl || ''));
  if (!shots.length) return '';
  return `<div class="shots">${shots.map(s =>
    `<figure class="shot"><img src="${s.dataUrl}" alt="${RPT_ESC_ARIA(s.name)}" loading="lazy">` +
    `<figcaption>${RPT_ESC(s.name)}</figcaption></figure>`).join('')}</div>`;
}

// Gouvernance (page de garde du PDF) : approbateurs, réviseurs, révisions
function rptGovernance(ws) {
  const L = normLldInfo(ws);
  const appr = rptSub('Approbateurs', rptLldGrid(
    lldExportCols(L, 'approvers', LLD_SIGNATORY_COLS).map(c => [c[0], String(c[1])]), L.approvers));
  const rev = rptSub('Réviseurs', rptLldGrid(
    lldExportCols(L, 'reviewers', LLD_SIGNATORY_COLS).map(c => [c[0], String(c[1])]), L.reviewers));
  const revs = rptSub('Historique des révisions', rptLldGrid(
    lldExportCols(L, 'revs', LLD_REV_COLS).map(c => [c[0], String(c[1])]), L.revs));
  return appr + rev + revs || '';
}

// Notes de configuration par catégorie (ch. 7 → 13 du dossier LLD)
function rptCatNotes(ws) {
  const L = normLldInfo(ws);
  const order = ['firewall', 'switching', 'server', 'storage', 'ids', 'cctv', 'pointage'];
  return order.filter(k => (L.catNotes?.[k] || '').trim()).map(k =>
    `<div class="prose"><h3>${catIcon(k)} Notes de configuration — ${RPT_ESC(catLabel(k))}</h3>${
      L.catNotes[k].trim().split(/\n+/).map(p => `<p>${RPT_ESC(p)}</p>`).join('')}</div>`).join('');
}

// 🌍 FAI & accès Internet (ch. 5) : tableau 5.1, câblage 5.2, captures
function rptFai(ws) {
  const L = normLldInfo(ws);
  const t51 = rptSub('5.1 — Informations & configuration (FAI)', rptLldGrid(
    lldExportCols(L, 'fais', LLD_FAI51_COLS).map(c => [c[0], String(c[1])]), L.fais));
  const cab = rptSub('5.2 — Câblage FAI', rptLldGrid(
    lldExportCols(L, 'faiCab', LLD_FAI_CAB_COLS).map(c => [c[0], String(c[1])]), L.faiCab));
  return t51 + cab + rptShots(ws, 'shots5') || '';
}

// 🔗 Interconnexion site à site (ch. 6) : fiche, extrémités, WAN/LAN, câblage, VPN
function rptInterco(ws) {
  const L = normLldInfo(ws);
  const kv = rptSub('6.1 — Liaison site à site', rptKv(LLD_IC_FIELDS, L.interco));
  const t61 = rptSub('6.1 — Extrémités / HA', rptLldGrid(
    lldExportCols(L, 'ic61', LLD_IC61_COLS).map(c => [c[0], String(c[1])]), L.ic61));
  const wan = rptSub('WAN Connection Settings', rptLldGrid(
    lldExportCols(L, 'icWan', LLD_IC_WAN_COLS).map(c => [c[0], String(c[1])]), L.icWan));
  const lan = rptSub('LAN / Network Settings', rptLldGrid(
    lldExportCols(L, 'icLan', LLD_IC_LAN_COLS).map(c => [c[0], String(c[1])]), L.icLan));
  const cab = rptSub('6.2 — Câblage interconnexion', rptLldGrid(
    lldExportCols(L, 'icCab', LLD_IC_CAB_COLS).map(c => [c[0], String(c[1])]), L.icCab));
  const vpn = rptSub('Tunnels VPN site à site', rptLldGrid(
    lldExportCols(L, 'vpns', LLD_VPN_COLS).map(c => [c[0], String(c[1])]), L.vpns));
  return kv + t61 + wan + lan + cab + vpn + rptShots(ws, 'shots6') || '';
}

// 🔥 Firewall & sécurité (ch. 7 + admin) : règles/NAT, profils, alias, comptes
function rptFirewall(ws) {
  const L = normLldInfo(ws);
  const rules = rptSub('Règles & NAT', rptLldGrid(
    lldExportCols(L, 'fw', LLD_FW_COLS).map(c => [c[0], String(c[1])]), L.fw));
  const prof = rptSub('Profils firewall', rptKv(LLD_FWP_FIELDS, L.fwProfiles));
  const aliases = rptSub('Alias firewall', rptLldGrid(
    lldExportCols(L, 'aliases', LLD_ALIAS_COLS).map(c => [c[0], String(c[1])]), L.aliases));
  const admin = rptSub("Comptes d'administration (Admin Security)", rptLldGrid(
    lldExportCols(L, 'adminSec', LLD_ADMIN_COLS).map(c => [c[0], String(c[1])]), L.adminSec));
  return rules + prof + aliases + admin + rptShots(ws, 'shots7') || '';
}

// 🖥️ Système, stockage & supervision : VMs, volumes, caméras, zones de switching
function rptSystem(ws) {
  const L = normLldInfo(ws);
  const zones = rptSub('Zones de switching (ch. 8)', rptLldGrid(
    lldExportCols(L, 'zones', LLD_ZONE_COLS).map(c => [c[0], String(c[1])]), L.swZones));
  const vms = rptSub('Machines virtuelles (ch. 9)', rptLldGrid(
    lldExportCols(L, 'vms', LLD_VM_COLS).map(c => [c[0], String(c[1])]), L.vms));
  const vols = rptSub('Volumes / LUN (ch. 10)', rptLldGrid(
    lldExportCols(L, 'vols', LLD_VOL_COLS).map(c => [c[0], String(c[1])]), L.vols));
  const cams = rptSub('Caméras CCTV (ch. 12)', rptLldGrid(
    lldExportCols(L, 'cams', LLD_CAM_COLS).map(c => [c[0], String(c[1])]), L.cams));
  return zones + vms + vols + cams || '';
}

// Équipements & licences hors baie (table 3.1 du dossier)
function rptOutOfRack(ws) {
  const L = normLldInfo(ws);
  return rptSub('Équipements & licences hors baie', rptLldGrid(
    lldExportCols(L, 'equip', LLD_EQUIP_COLS).map(c => [c[0], String(c[1])]), L.equip));
}

/* ---------- Assemblage du document ---------- */
// Rubriques proposées au sélecteur d'export (ordre = ordre du rapport)
const RPT_SECTION_ITEMS = [
  ['sec-sites', '🏢 Sites & baies'],
  ['sec-elev', '🧱 Élévations des baies (une image par baie + vue d’ensemble)'],
  ['sec-topo', '🕸️ Topologie réseau (image)'],
  ['sec-contexte', '📝 Contexte, architecture, équipements hors baie & notes'],
  ['sec-inv', '📦 Inventaire des équipements'],
  ['sec-cab', '🔌 Câblage'],
  ['sec-ports', '🗂️ Ports & adressage'],
  ['sec-gar', '🛡️ Garanties'],
  ['sec-addr', '🏷️ VLANs & nomenclature'],
  ['sec-fai', '🌍 FAI & accès Internet'],
  ['sec-ic', '🔗 Interconnexion site à site'],
  ['sec-fw', '🔥 Firewall & sécurité'],
  ['sec-sys', '🖥️ Système, stockage & supervision'],
  ['sec-flux', '🔄 Flux réseau'],
  ['sec-gov', '📑 Gouvernance du document']
];

function buildHtmlReportFile(ws, images = {}, picked = null) {
  const L = normLldInfo(ws);
  const { plan = null, topo = null, rackShots = new Map(), logoSvg = '' } = images;
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = `${ws.name} — Rapport LLD`;

  // Sommaire : seules les sections cochées au sélecteur ET ayant du contenu
  // y figurent. Page de garde + synthèse (KPIs) toujours incluses.
  const secs = [
    ['sec-sites', '🏢', 'Sites & baies', rptSitesBlocks(ws)],
    ['sec-elev', '🧱', 'Élévations des baies', rptElevations(ws, rackShots, plan)],
    ...(topo ? [['sec-topo', '🕸️', 'Topologie réseau', '']] : []),
    ['sec-contexte', '📝', 'Contexte & architecture',
      rptContext(ws) + rptOutOfRack(ws) + rptCatNotes(ws)],
    ['sec-inv', '📦', 'Inventaire des équipements', rptInventory(ws)],
    ['sec-cab', '🔌', 'Câblage', rptCabling(ws)],
    ['sec-ports', '🗂️', 'Ports & adressage', rptPorts(ws)],
    ['sec-gar', '🛡️', 'Garanties', rptWarranties(ws)],
    ['sec-addr', '🏷️', 'VLANs & nomenclature', rptAddressing(ws)],
    ['sec-fai', '🌍', 'FAI & accès Internet', rptFai(ws)],
    ['sec-ic', '🔗', 'Interconnexion site à site', rptInterco(ws)],
    ['sec-fw', '🔥', 'Firewall & sécurité', rptFirewall(ws)],
    ['sec-sys', '🖥️', 'Système, stockage & supervision', rptSystem(ws)],
    ['sec-flux', '🔄', 'Flux réseau', rptFlows(ws)],
    ['sec-gov', '📑', 'Gouvernance du document', rptGovernance(ws)],
  // (sec-topo n'entre dans la liste que si une topologie existe — son contenu
  // est construit plus bas, donc elle échappe au filtre sur contenu vide.)
  ].filter(([id, , , content]) =>
      (id === 'sec-topo' || String(content).trim() !== '') &&
      (!picked || picked.has(id)));
  const nav = secs.map(([id, ico, t]) =>
    `<a class="nav-a" href="#${id}"><span>${ico}</span>${RPT_ESC(t)}</a>`).join('');
  const body = secs.map(([id, ico, t, content]) => {
    if (id === 'sec-topo') {
      return `<section class="section" id="${id}"><h2>${ico} ${RPT_ESC(t)}</h2>
        <figure class="elev full"><figcaption><b>Topologie des liens</b> — cliquez pour zoomer</figcaption>
        <img src="${topo}" alt="Topologie réseau" loading="lazy"></figure></section>`;
    }
    return `<section class="section" id="${id}"><h2>${ico} ${RPT_ESC(t)}</h2>${content}</section>`;
  }).join('\n');

  const css = `
:root{--bg:#eef1f6;--panel:#fff;--ink:#1f2733;--mut:#64748b;--line:#e2e8f0;--acc:#1f6feb;
  --ok:#16a34a;--soon:#d97706;--ko:#dc2626;--rad:12px;--navh:64px}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font:14px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--acc);text-decoration:none}
/* Barre du haut (marque + recherche) : NON collante — elle défile naturellement
   et disparaît vers le bas, réapparaît en remontant. */
#top{background:#fff;border-bottom:1px solid var(--line)}
.bar1{display:flex;gap:14px;align-items:center;padding:10px 22px 9px}
.brand{display:flex;align-items:center;gap:11px;font-weight:700;font-size:15px;white-space:nowrap}
.brand .logo{display:flex;align-items:center;height:30px}
.brand .logo svg,.brand .logo img{height:30px;width:auto;display:block}
.brand .logo .fb{font-size:24px;line-height:1}
.brand-txt small{display:block;font-weight:400;color:var(--mut);font-size:11px}
#q{flex:1;max-width:460px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px}
/* Boutons de chapitres : TOUJOURS collés en haut, aucun fond de bloc
   (flou seul pour rester lisible au-dessus du contenu), retour à la ligne
   automatique sur deux lignes si nécessaire — jamais de scroll horizontal. */
#chapnav{position:sticky;top:0;z-index:30;display:flex;flex-wrap:wrap;gap:5px;
  padding:10px 20px 9px;
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4)}
.nav-a{padding:6px 11px;border-radius:99px;color:var(--ink);font-size:12.5px;white-space:nowrap;
  background:rgba(255,255,255,.85);border:1px solid rgba(226,232,240,.95);box-shadow:0 1px 4px rgba(20,28,45,.07)}
.nav-a span{margin-right:5px}
.nav-a:hover{background:#e2ebfb}
.nav-a.cur{background:#e2ebfb;border-color:#b9cffb;color:#123e8f;font-weight:600}
#top button{margin-left:auto;padding:8px 14px;border:1px solid var(--acc);background:var(--acc);color:#fff;
  border-radius:8px;cursor:pointer;font-size:12.5px;white-space:nowrap}
main{max-width:1180px;margin:0 auto;padding:26px 22px 80px}
.cover{background:linear-gradient(135deg,#16233d,#1f4e79 60%,#2563eb);color:#fff;border-radius:16px;
  padding:32px 36px 30px;margin-bottom:22px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover h1{margin:0 0 6px;font-size:26px}
.cover .sub{opacity:.85;margin-bottom:20px}
.cover .meta{display:flex;flex-wrap:wrap;gap:10px;font-size:13px}
.cover .meta>div{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.17);
  border-radius:10px;padding:9px 15px;min-width:150px;backdrop-filter:blur(4px);
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover .meta span{display:block;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:rgba(255,255,255,.62);margin-bottom:3px}
.cover .meta b{font-size:14px;font-weight:600;color:#fff}
.kpis{display:flex;flex-wrap:wrap;margin-top:22px;background:rgba(255,255,255,.10);
  border:1px solid rgba(255,255,255,.16);border-radius:14px;overflow:hidden;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.kpi{flex:1 1 96px;padding:12px 16px;background:none;border:none;border-radius:0;
  border-right:1px solid rgba(255,255,255,.12);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.kpi:last-child{border-right:none}
.kpi-num{font-size:22px;font-weight:700;color:#fff}
.kpi-lbl{color:rgba(255,255,255,.72);font-size:11.5px;margin-top:1px}
.k-ok .kpi-num{color:#86efac}.k-soon .kpi-num{color:#fcd34d}.k-ko .kpi-num{color:#fca5a5}
.section{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);
  padding:22px 24px;margin-bottom:18px;scroll-margin-top:calc(var(--navh,64px) + 10px)}
.section h2{margin:0 0 14px;font-size:18px;padding-bottom:10px;border-bottom:2px solid var(--line)}
.section h3{font-size:14.5px;margin:14px 0 8px}
.site-block{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.dot{display:inline-block;width:11px;height:11px;border-radius:4px;background:var(--c,#94a3b8);margin-right:8px;vertical-align:-1px}
.meta{color:var(--mut);font-size:12.5px}
.muted{color:var(--mut)}
.rack-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px}
.rack-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fafbfd;color:var(--ink)}
.rack-card:hover{border-color:var(--acc);box-shadow:0 2px 10px #1f6feb22}
.rack-card-h{display:flex;justify-content:space-between;font-size:13px;margin-bottom:7px}
.rack-card-h span{color:var(--mut);font-size:12px}
.gauge{position:relative;height:16px;background:#e6ebf2;border-radius:99px;margin:7px 0;overflow:hidden}
.gauge-bar{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#3b82f6,#2563eb);border-radius:99px}
.gauge-bar.hot{background:linear-gradient(90deg,#f59e0b,#dc2626)}
.gauge-txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-weight:600;color:#0f172a}
.elev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.elev{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#101318}
.elev.full{margin-top:14px}.elev figcaption{background:#fff;padding:9px 12px;font-size:13px;border-bottom:1px solid var(--line)}
.elev img{display:block;width:100%;cursor:zoom-in;transition:transform .2s}
.elev img:hover{transform:scale(1.015)}
.prose p{margin:7px 0}.prose{border-left:3px solid var(--line);padding-left:14px;margin-bottom:14px}
table.kv th{background:#f1f5f9;color:var(--ink);width:240px;font-weight:600;border-bottom:1px solid var(--line);
  position:static;text-align:left;font-size:12.8px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:10px}
.shot{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#101318}
.shot img{display:block;width:100%;cursor:zoom-in;background:#101318}
.shot figcaption{background:#fff;padding:7px 11px;font-size:12px;border-top:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:12.8px;margin:8px 0}
th{background:#16233d;color:#fff;text-align:left;padding:8px 10px;font-size:12px;position:sticky;top:var(--navh,64px);z-index:5}
.sortable th{cursor:pointer;user-select:none}.sortable th:hover{background:#1f3a63}
.sortable th .dir::after{content:" ⇅";opacity:.5}
.sortable th.asc::after{content:" ↑"}.sortable th.desc::after{content:" ↓"}
td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.section{overflow-x:auto}
tbody tr:nth-child(even){background:#f6f8fb}
tbody tr:hover{background:#eaf1fc}
.nowrap,.nw-num{white-space:nowrap}.nw-num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2.5px 9px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge.ok{background:#dcfce7;color:#15803d}.badge.soon{background:#fef3c7;color:#b45309}
.badge.ko{background:#fee2e2;color:#b91c1c}.badge.muted{background:#e2e8f0;color:#64748b}
tr.w-ko{background:#fef2f2}tr.w-soon{background:#fffbeb}
details.grp{border:1px solid var(--line);border-radius:10px;margin:10px 0;overflow:hidden}
details.grp>summary{cursor:pointer;list-style:none;padding:10px 14px;background:#f1f5f9;
  display:flex;align-items:center;gap:8px;user-select:none}
details.grp>summary::-webkit-details-marker{display:none}
details.grp>summary::before{content:"▸";color:var(--mut);transition:transform .15s}
details.grp[open]>summary::before{transform:rotate(90deg)}
details.grp>summary .meta{margin-left:auto}
details.grp table{margin:0}
details.grp th{top:0;position:static}
.chip{display:inline-block;width:14px;height:14px;border-radius:99px;background:var(--c);
  border:1px solid #0003;vertical-align:-2px;margin-right:5px}
.chip-cod{color:var(--mut);font-size:11.5px}
.arrow{color:var(--mut);text-align:center}
.pills{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 12px}
.pill{padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px}
.pill.on{background:var(--acc);border-color:var(--acc);color:#fff}
.pill:hover{border-color:var(--acc)}
#lb{position:fixed;inset:0;background:#0b0f16ee;z-index:100;display:none;align-items:center;justify-content:center;cursor:zoom-out}
#lb img{max-width:96vw;max-height:94vh;border-radius:6px;box-shadow:0 8px 60px #000c}
#lb .hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#cbd5e1;font-size:12px;background:#0008;padding:6px 12px;border-radius:99px}
footer{color:var(--mut);text-align:center;font-size:12px;padding:26px}
@media(max-width:820px){.bar1{flex-wrap:wrap}#chapnav{padding:8px 12px}th{top:0;position:static}}
@media print{
  body{background:#fff}#top,.no-print,#lb{display:none!important}
  main{max-width:none;padding:0}
  .section{border:none;border-bottom:2px solid var(--line);border-radius:0;padding:12px 0;margin:0;break-inside:auto}
  .section h2{border-color:var(--acc)}
  th{position:static}
  thead{display:table-header-group}
  tr{break-inside:avoid}
  details.grp{border:1px solid var(--line)}
  details.grp>summary{background:#eef2f7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .elev{break-inside:avoid}
  .elev img{max-height:88vh;object-fit:contain}
  .cover{border-radius:0}
  .site-block,.rack-card,.badge,.gauge,.gauge-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  a{color:var(--ink)}
}`;

  const js = `
(function(){
  /* Hauteur réelle du bandeau de chapitres (peut faire 2 lignes) -> --navh,
     utilisée pour les en-têtes de tableau collants et la marge des ancres. */
  var nav=document.getElementById('chapnav');
  function syncNavH(){if(nav)document.documentElement.style.setProperty('--navh',(nav.offsetHeight+2)+'px')}
  syncNavH();window.addEventListener('resize',syncNavH);
  window.addEventListener('load',syncNavH);
  var q=document.getElementById('q');
  if(q){q.addEventListener('input',function(){
    var v=q.value.trim().toLowerCase();
    document.querySelectorAll('tr[data-search]').forEach(function(tr){
      tr.style.display=(!v||tr.dataset.search.indexOf(v)>=0)?'':'none'});
    document.querySelectorAll('details.grp').forEach(function(d){
      var any=[].some.call(d.querySelectorAll('tr[data-search]'),function(tr){return tr.style.display!=='none'});
      d.style.display=any?'':'none'});
    document.querySelectorAll('.elev,.site-block').forEach(function(f){
      var img=f.querySelector('figcaption');if(!img)return;
      f.style.display=(!v||f.textContent.toLowerCase().indexOf(v)>=0)?'':'none'});
  });}
  document.querySelectorAll('table.sortable').forEach(function(t){
    var ths=t.tHead&&t.tHead.rows[0]?[].slice.call(t.tHead.rows[0].cells):[];
    ths.forEach(function(th,ci){th.addEventListener('click',function(){
      var dir=th.classList.contains('asc')?'desc':'asc';
      ths.forEach(function(h){h.classList.remove('asc','desc')});
      th.classList.add(dir);
      var tb=t.tBodies[0];var rows=[].slice.call(tb.rows);
      var num=function(s){var n=parseFloat(String(s).replace(/\\s| /g,'').replace(',','.'));return isNaN(n)?null:n};
      rows.sort(function(a,b){
        var x=a.cells[ci]?a.cells[ci].textContent.trim():'';
        var y=b.cells[ci]?b.cells[ci].textContent.trim():'';
        var nx=num(x),ny=num(y);
        var c=(nx!==null&&ny!==null)?nx-ny:x.localeCompare(y,'fr',{numeric:true});
        return dir==='asc'?c:-c});
      rows.forEach(function(r){tb.appendChild(r)})})})});
  var lb=document.getElementById('lb'),lbImg=document.getElementById('lb-img');
  document.addEventListener('click',function(e){
    var img=e.target.closest&&e.target.closest('.elev img, .shot img');
    if(img&&lbImg){lbImg.src=img.src;lb.style.display='flex';return}
    if(e.target===lb||e.target===lbImg){lb.style.display='none';lbImg.src=''}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&lb){lb.style.display='none';lbImg.src=''}});
  window.addEventListener('beforeprint',function(){
    document.querySelectorAll('details').forEach(function(d){d.open=true})});
  var cur=document.querySelectorAll('.nav-a');
  var secs=[].slice.call(document.querySelectorAll('section.section'));
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(en){
      if(en.isIntersecting){cur.forEach(function(a){
        a.classList.toggle('cur',a.getAttribute('href')==='#'+en.target.id)})}})},
      {rootMargin:'-70px 0px -75% 0px'});
    secs.forEach(function(s){io.observe(s)})}
})();`;

  return '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
    + `<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${RPT_ESC(title)}</title>\n`
    + `<style>${css}</style>\n</head>\n<body>\n`
    + `<div id="top">
  <div class="bar1">
    <div class="brand"><span class="logo">${logoSvg || '<span class="fb">🗄️</span>'}</span>
      <span class="brand-txt">LLDraw<small>Rapport interactif — ${RPT_ESC(today)}</small></span></div>
    <input id="q" type="search" placeholder="🔎 Recherche instantanée : device, IP, VLAN, câble, série…" class="no-print">
    <button type="button" class="no-print" onclick="window.print()">🖨️ Imprimer / PDF</button>
  </div>
</div>\n<nav id="chapnav" class="no-print">${nav}</nav>\n<main>\n`
    + `<header class="cover">
  <h1>${RPT_ESC(ws.name)}</h1>
  <div class="sub">Dossier de conception bas niveau (LLD) — datacenter & infrastructure</div>
  <div class="meta">
    ${L.client ? `<div><span>Client</span><b>${RPT_ESC(L.client)}</b></div>` : ''}
    <div><span>Auteur</span><b>${RPT_ESC(L.author)}</b></div>
    <div><span>Version</span><b>${RPT_ESC(L.version)}</b></div>
    ${(L.date || '').trim() ? `<div><span>Date du dossier</span><b>${RPT_ESC(fmtDateFr(L.date) || L.date)}</b></div>` : ''}
    <div><span>Généré le</span><b>${RPT_ESC(today)}</b></div>
  </div>
  ${rptKpis(ws)}
</header>\n`
    + body + '\n'
    + `\n</main>\n<footer class="no-print">Rapport généré par LLDraw — fichier autonome, consultable hors-ligne. `
    + `Cherchez avec la barre 🔎, triez les tableaux en cliquant les en-têtes, cliquez une image pour zoomer.</footer>\n`
    + `<div id="lb"><img id="lb-img" alt=""><span class="hint">Cliquez n'importe où (ou Échap) pour fermer</span></div>\n`
    + `<script>${js}</`
    + `script>\n</body>\n</html>`;
}

/* ---------- Recadrage d'un canvas plan : une élévation par baie ---------- */
// Mêmes constantes que renderPlanCanvas() (app.js) pour recalculer le repère.
function rptCropRacks(planCanvas, ws) {
  const shots = new Map();
  if (!planCanvas || !ws?.racks?.length) return shots;
  const PAD = 60, SCALE = 2, M = 34;   // marge autour de la baie (px « board »)
  const minX = Math.min(...ws.racks.map(r => r.x)) - PAD;
  const minY = Math.min(...ws.racks.map(r => r.y)) - PAD;
  for (const r of ws.racks) {
    const wB = typeof RACK_W === 'number' ? RACK_W : 340;
    const hB = rackHeight(r);
    let sx = (r.x - M - minX) * SCALE, sy = (r.y - M - minY) * SCALE;
    let sw = (wB + 2 * M) * SCALE, sh = (hB + 2 * M) * SCALE;
    // bornage dans le canvas (les baies au bord ont moins de marge)
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(sw, planCanvas.width - sx); sh = Math.min(sh, planCanvas.height - sy);
    if (sw < 20 || sh < 20) continue;
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(planCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    shots.set(r.id, c.toDataURL('image/jpeg', 0.92));
  }
  return shots;
}

/* ---------- Bouton d'export ---------- */
$('#export-html').addEventListener('click', async () => {
  $('#export-menu').classList.add('hidden');
  const ws = lldWorkspaceForExport();
  if (!ws || !ws.racks.length) {
    lldAlert('Ce workspace ne contient aucun rack à exporter.', { title: '🌐 Rapport HTML' });
    return;
  }
  const only = await lldPickSections({
    title: '🌐 Rapport interactif — que voulez-vous exporter ?',
    hint: 'Page de garde et synthèse toujours incluses ; les rubriques vides (ex : pas de flux, pas de topologie) sont ignorées automatiquement.',
    items: RPT_SECTION_ITEMS
  });
  if (!only) return;   // annulé
  if (!only.size) {
    lldAlert('Cochez au moins une rubrique à exporter.', { title: '🌐 Rapport HTML' });
    return;
  }
  // Vrai logo (assets/logo.svg) embarqué en SVG inline dans le fichier généré
  const logoSvg = await fetch('assets/logo.svg')
    .then(r => (r.ok ? r.text() : ''))
    .catch(() => '');
  const c = await renderPlanCanvas();
  const tc = renderTopoCanvas();
  const html = buildHtmlReportFile(ws, {
    plan: c ? c.toDataURL('image/jpeg', 0.88) : null,
    topo: tc ? tc.toDataURL('image/jpeg', 0.92) : null,
    rackShots: rptCropRacks(c, ws),
    logoSvg
  }, only);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), exportFileBase() + '-rapport.html');
});
