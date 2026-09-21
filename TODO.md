# TODO LLDraw — Analyser A→Z et couvrir le dossier LLD cible (15 chapitres)

> Objectif : que le **Document LLD (PDF)** généré par LLDraw produise le dossier
> complet avec **exactement la structure cible** (15 chapitres), alimenté par les
> données saisies dans l'application (racks, devices, ports, câbles, sites, flux…).
>
> Méthode de travail convenue : implémenter **lot par lot**, l'utilisateur teste
> après chaque lot, puis on continue.

---

## A. État des lieux — ce qui existe déjà (analyse A→Z)

### A.1 Architecture technique

| Fichier | Rôle | État |
|---|---|---|
| `index.html` (415 l.) | Structure UI : topbar, sidebar, board, modales (device, LLD), popovers | ✅ complet |
| `app.js` (4 500 l.) | Toute la logique : état, racks, devices, ports, câblage, topologie, exports, persistance | ✅ complet, monolithique mais organisé en sections commentées |
| `styles.css` (2 300 l.) | Thème, layout, racks, popovers, topologie, vue 3D | ✅ complet |
| `view3d.js` | Vue 3D immersive (module ES) : scène Three.js, baies, devices, câbles, caméra | ✅ complet |
| `server.py` (148 l.) | Serveur Python stdlib : statique + API `/api/state` (GET/PUT) → `data/state.json` | ✅ fonctionnel |
| `.github/workflows/pages.yml` | Déploiement GitHub Pages (mode 💾 localStorage) | ✅ fonctionnel |
| `assets/` | Logo, favicons, photos WatchGuard, icône RJ45 | ✅ |

### A.2 Fonctionnalités déjà implémentées

1. **Workspaces** : écran d'accueil, création/suppression, historique trié,
   board indépendant par workspace, bibliothèque de devices **partagée**.
2. **Racks** : 6U→42U, déplacement, renommage, changement de taille, métriques
   live (occupation U, puissance totale + budget W, poids total + charge max kg).
3. **Devices** : photo de face avant, détection automatique des ports (analyse
   d'image), fiche d'inventaire (marque, modèle, réf., n° série, IP mgmt, VLAN,
   puissance, poids), édition au survol (double-clic), device WatchGuard permanent.
4. **Ports** : création/édition (nom, étiquette, IP, VLAN, taille 20–250 %),
   drag & drop, infobulle.
5. **Câblage physique** : mode dédié, cordons Bézier réalistes, ID (CAB-001),
   couleurs, panneau Connexions, suppression individuelle/globale.
6. **Topologie logique** : vue dédiée, nœuds générés depuis les racks, liens
   (nom, débit, VLAN, style, couleur), import des câbles physiques.
7. **Infos dossier LLD** (modale 📘) : client, auteur, version,
   historique des révisions, **registre VLANs & subnets** (+ détection auto
   depuis les ports/liens).
8. **Exports** : PNG, Plan PDF 1 page, **Document LLD PDF** (7 sections),
   XLSX (4 feuilles : Inventaire, Câblage, Ports, Racks), 3 CSV (inventaire,
   câblage, ports).
9. **Transverse** : recherche globale multi-workspaces, annuler/rétablir
   (40 niveaux), sauvegarde serveur + secours localStorage, zoom/pan infini.
10. **Vue 3D immersive** (nouveau) : reconstitution WebGL/Three.js du
    datacenter — baies 19" avec PDU et guides de câblage, face avant photo
    des devices + LED animées, face arrière procédurale (PSU, ventilation,
    connecteurs teintés à la couleur du câble branché), câbles 3D routés
    (port → guide vertical → allée arrière), orbite caméra + presets
    (Avant/Arrière/Dessus/Allée), survol/clic device-port-câble avec fiches,
    légende filtrante par domaine, capture PNG, caméra mémorisée par
    workspace. Bibliothèque `vendor/three/` embarquée (hors-ligne).

### A.3 Structure actuelle du PDF LLD généré

```
Page de garde (client, auteur, version, date, stats, révisions)
1. Synthèse des racks (capacités)
2. Inventaire des devices
3. Plan d'adressage & ports
4. Tableau de câblage
5. Registre VLANs & subnets
6. Topologie logique (image)
7. Élévations des racks (image)
```

➡️ **7 sections génériques** : rien sur les sites, le FAI, l'interconnexion,
les catégories d'équipements, ni les flux réseau.

---

## B. Analyse des écarts — chapitre par chapitre (structure cible)

Légende : ✅ existant · 🟡 partiel · ❌ absent

| # | Chapitre cible | État | Ce qui manque |
|---|---|---|---|
| 1 | **Objectif du document** | ❌ | Champ texte « objectif » éditable + rendu PDF |
| 2.1 | **Aperçu — Informations sur le site** | ❌ | Concept de **site** inexistant : fiche site (nom, adresse, contacts, description) + rattachement des racks à un site |
| 2.2 | **Aperçu — Infrastructure existante** | ❌ | Texte structuré/à champs libres sur l'existant |
| 3 | **Architecture cible** | 🟡 | Texte d'architecture + tableau récapitulatif des équipements → nécessite les **catégories de devices** |
| 4 | **Nomenclature & Adressage IP Global** | 🟡 | Registre VLANs existant mais : pas de table **nomenclature** (règles de nommage) ni de colonne **site** dans l'adressage |
| 5.1 | **FAI — Informations & Configuration** | ❌ | Bloc FAI : opérateur, offre, type de lien, débit, IP publiques, CPE, notes de config |
| 5.2 | **FAI — Câblage** | ❌ | Table de câblage **filtrée** par chapitre/domaine |
| 6.1 | **Interconnexion site 2 site — Infos & Config** | ❌ | Bloc interco : techno (IPsec/MPLS/SD-WAN…), endpoints publics, subnets locaux/distansts, routage, chiffrement |
| 6.2 | **Interconnexion — Câblage** | ❌ | Idem 5.2 |
| 7 | **Firewall** | 🟡 | Le device WatchGuard existe comme device photo, mais pas de **catégorie** ni de chapitre dédié (équipements + config + câblage) |
| 8.1–8.5 | **Switching** (INFRA, LAN Site B, Aruba AP Site A, Aruba AP Site B, LAN Site A) | ❌ | Sous-chapitres par **zone/site** : catégories Switch + AP, rattachement site/zone, notes de config par sous-chapitre |
| 9 | **Serveurs** | ❌ | Catégorie « Serveur » + chapitre auto (équipements, IP, config) |
| 10 | **Stockage** | ❌ | Catégorie « Stockage » (NAS/SAN) + chapitre auto |
| 11 | **Intrusion (IDS)** | ❌ | Catégorie « IDS » + chapitre auto |
| 12 | **CCTV** | ❌ | Catégorie « CCTV » + chapitre auto |
| 13 | **Pointage (SPO)** | ❌ | Catégorie « Pointage » + chapitre auto |
| 14 | **Flux réseau et diagram** | 🟡 | Topologie logique existante (image) mais pas de **matrice de flux** (source, destination, protocole/port, sens, usage) |
| 15 | **Cablage/Rack** | 🟡 | Tableau de câblage + élévations existent, mais à renuméroter en ch. 15 et enrichir (câblage global + synthèse racks + élévations) |

### B.1 Les 3 fondations manquantes (briques transverses)

1. **Catégories de devices** — indispensable pour générer automatiquement les
   chapitres 7 à 13 (Firewall, Switching, Serveurs, Stockage, IDS, CCTV,
   Pointage…). Aujourd'hui un device n'a aucun rôle métier.
2. **Sites** (Site A / Site B…) — indispensable pour les chapitres 2, 6, 8.x
   et pour filtrer/adresser par site. Aujourd'hui un rack n'appartient à aucun site.
3. **Champs documentaires par chapitre** — l'application ne sait stocker que
   client/auteur/version/révisions/VLANs. Il faut des zones de texte et des
   tables dédiées à chaque chapitre (objectif, existant, architecture,
   nomenclature, FAI, interco, notes de config par catégorie, flux…).

---

## C. TO-DO — lots d'implémentation incrémentale

> ⚠️ Chaque lot = une session de test. On n'attaque le suivant qu'après
> validation. Rétro-compatibilité garantie à chaque lot (normalisation de
> l'état chargé + undo/redo).

### ✅ Lot 1 — Squelette documentaire (ch. 1, 2.2, 3, 4) — **FAIT**
- [x] Modale 📘 réorganisée en onglets : *Document / Réseau* (+ Sites et
      Chapitres visibles mais désactivés, activés aux lots 2 et 5)
- [x] Onglet Document : **Objectif du document**, **Infrastructure
      existante**, **Architecture cible** (textes multi-lignes) + client /
      auteur / version / révisions
- [x] Table **Nomenclature** éditable (type d'objet → préfixe → exemple →
      règle) + bouton « Générer depuis les devices » (détecte les préfixes
      utilisés, type deviné : FW, SW, SRV, NAS, IDS, CAM…)
- [x] Registre VLANs devient **Adressage IP Global** : colonne **Site** ajoutée
- [x] **Générateur PDF LLD restructuré** : **sommaire** (page 2, 27 entrées
      avec numéros de page exacts) et squelette des **15 chapitres** dans
      l'ordre cible ; ch. 1, 2.2, 3 (textes) et 4 (nomenclature + registre
      VLANs + plan d'adressage & ports) remplis ; ch. 3.1 = inventaire ;
      ch. 5→13 affichent « Section à compléter » ; ch. 14 = topologie ;
      ch. 15 = synthèse racks + câblage + élévations
- [x] Sauvegarde/undo/redo des nouveaux champs (via `pushHistory` + normalisation)
- [x] Bonus : correction d'un bug PDF préexistant (double définition `/XObject`
      quand le document contient topologie **et** élévations — l'image
      d'élévations pouvait être ignorée par certains lecteurs PDF)

### ✅ Lot 2 — Sites (ch. 2.1 + base des ch. 6 et 8) — **FAIT**
- [x] Onglet **🏢 Sites** dans la modale 📘 : cartes éditables (nom, adresse,
      contacts, description), ajout/suppression ; **Site A + Site B créés par
      défaut** (workspaces nouveaux et anciens) ; la suppression d'un site
      détache les racks rattachés (message + Ctrl+Z)
- [x] **Rattachement des racks à un site** : sélecteur dans l'en-tête du rack
      + **pastille colorée** (8 couleurs par position)
- [x] **Filtre par site** dans le panneau de gauche (racks des autres sites
      atténués), options rafraîchies à l'ouverture d'un workspace et par undo
- [x] PDF ch. 2.1 : tableau des sites + racks par site (taille, occupation,
      devices, puissance, poids) ; racks sans site « — »
- [x] Colonne **Site** dans Inventaire / Ports / Synthèse racks (CSV, XLSX,
      PDF) + pastille et nom du site sur les exports PNG / PDF 1 page
- [x] Correctif rétroactif Lot 1 : la sauvegarde de la modale 📘 ne persistait
      pas Objectif / Existant / Architecture / Nomenclature — corrigé

### ✅ Lot 3 — Catégories de devices (prépare ch. 3.1, 7→13) — **FAIT**
- [x] Champ **Catégorie** sur les devices (modèle + exemplaires posés) :
      Routeur/FAI, Firewall, Switch, Borne WiFi (AP), Serveur, Stockage,
      Intrusion (IDS/IPS), CCTV, Pointage (SPO), Onduleur/PDU, Brassage, Autre
- [x] Sélecteur dans la modale device + **catégorie devinée depuis le
      préfixe du nom** (FW→Firewall, SW→Switch, SRV→Serveur, NAS→Stockage,
      NVR/CAM→CCTV, SPO→Pointage…) à la création ET pour les anciens devices
      (migration automatique) ; WatchGuard pré-classé « Firewall »
- [x] Badge **icône + libellé** sur les cartes de la bibliothèque +
      **filtre par catégorie** dans la sidebar
- [x] Ligne **Catégorie** éditable (liste déroulante) dans la fiche popover
      du device posé
- [x] **Icône de catégorie** sur les nœuds de la vue Topologie
- [x] Colonne **Catégorie** dans l'inventaire (CSV / XLSX / PDF)
- [x] PDF ch. 3.1 : **récapitulatif par catégorie** (nombre, modèles,
      sites) + inventaire détaillé

### ✅ Lot 4 — FAI & Interconnexion site 2 site (ch. 5, 6) — **FAIT**
- [x] Onglet **🌐 Réseau** — bloc **FAI** : opérateur, offre, type de lien
      (FTTH/FTTO/fibre dédiée/EoC/ADSL/LS/4G-5G…), débits descendant/montant,
      bloc IP publiques, CPE (modèle, IP), notes de configuration
- [x] Bloc **Interconnexion site 2 site** : technologie (IPsec, MPLS, SD-WAN,
      LAN-to-LAN, VPN SSL), endpoints publics A/B, subnets locaux/distants,
      routage, chiffrement, notes de configuration
- [x] **Domaine de câblage** : chaque câble porte un domaine (Général, FAI,
      Interconnexion, Firewall, Switching, Serveurs, Stockage, IDS, CCTV,
      Pointage) — sélecteur dans le popover du câble, étiquette dans le
      panneau Connexions, colonne « Domaine » dans l'export câblage
      (CSV/XLSX/PDF ch. 15)
- [x] PDF **ch. 5.1 / 6.1** : tableau Élément/Valeur des infos + notes de
      configuration ; **ch. 5.2 / 6.2** : table de câblage filtrée sur le
      domaine correspondant (avec note d'aide si vide)

### ✅ Lot 5 — Chapitres par catégorie (ch. 7 → 13) — **FAIT**
- [x] Onglet **📚 Chapitres** activé : **notes de configuration** par chapitre
      (7 Firewall, 8 Switching, 9 Serveurs, 10 Stockage, 11 IDS, 12 CCTV,
      13 Pointage)
- [x] **Zones de Switching** personnalisables (ajout / suppression /
      réordonnancement ↑↓) — par défaut, la structure cible exacte :
      8.1 INFRA, 8.2 LAN Site B, 8.3 Aruba AP Site A, 8.4 Aruba AP Site B,
      8.5 LAN Site A ; rattachement des switchs/bornes à une zone via la
      fiche de survol (double-clic sur « Zone ») ; suppression d'une zone =
      devices « hors zone » (+ sous-chapitre « hors zone » s'il y en a)
- [x] **Chapitres 7→13 générés automatiquement** : notes + tableau des
      équipements (rack, site, étage, marque/modèle, IP mgmt, VLAN, ports) +
      ports & adressage + câblage du domaine (domains des câbles du lot 4)
- [x] Chapitres/zones vides : mention « Aucun équipement… » (numérotation
      stable, conforme à la décision validée)

### ✅ Lot 6 — Flux réseau (ch. 14) — **FAIT**
- [x] Onglet **🔄 Flux** dans la modale 📘 : éditeur de **matrice de flux**
      (nom, source, destination, protocole/ports, sens ⇄ bidirectionnel /
      → unidirectionnel, usage) — ajout/suppression de lignes
- [x] PDF ch. 14 : **matrice des flux** + rappel du **diagramme de
      topologie** (note d'aide si absent)
- [x] Bonus : sélecteur **🔄 Flux** dans la barre d'outils de la vue
      Topologie — les équipements mentionnés dans la source/destination du
      flux restent nets, les autres (noeuds et liens) sont atténués

### ✅ Lot 7 — Câblage/Rack + exports & finitions (ch. 15) — **FAIT**
- [x] PDF ch. 15 : tableau de câblage global (avec colonne Domaine) +
      synthèse racks + élévations — en place depuis les lots 1/2/4, vérifié
- [x] XLSX : **8 feuilles** — *Inventaire*, *Câblage*, *Ports*, *Racks*,
      *Sites*, *Nomenclature*, *Adressage IP*, *Flux* (feuilles vides omises)
- [x] CSV : **Sites**, **Nomenclature & adressage**, **Flux réseau**
      (3 nouveaux exports dans le menu Exporter)
- [x] Recherche globale étendue : **sites** (nom, adresse, contacts,
      description) et **flux** (nom, source, destination, protocole, usage) —
      un clic ouvre la fiche du dossier sur l'onglet correspondant
- [x] README mis à jour + version de cache v38
- [x] Vérification finale : PDF 15 chapitres dans l'ordre, sommaire exact
      (0 erreur), XLSX validé (ZIP/OOXML, 8 feuilles)

### ✅ Lot 8 — Suivi des garanties (hors plan initial) — **FAIT**
- [x] **Modèle** : champ **fin de garantie** (date ISO `AAAA-MM-JJ`) + **garantie /
      contrat** sur les modèles de la bibliothèque **et** chaque exemplaire posé
      (recopiés au drop, modifiables individuellement) ; normalisation
      rétro-compatible (dates invalides purgées, anciens états intacts)
- [x] **Statut recalculé** à l'affichage en **deux couleurs** : ✅ **En garantie**
      (vert) / ⛔ **Hors garantie** (rouge), avec l'échéance en jours ; une
      échéance < 90 j reste verte et porte la mention « expire bientôt »
- [x] **Modale device** : sélecteur de date + champ contrat + rappel du statut
      sous le champ
- [x] **Fiche de survol** : **badge à côté du nom** (vert « En garantie » /
      rouge « Hors garantie ») + section **Garantie** (fin de garantie écrite
      en vert / rouge + contrat), édition en double-clic (sélecteur de date),
      undo/redo
- [x] **Pastille 🛡️** sur chaque device posé — vert en garantie, rouge hors
      garantie (deux couleurs seulement), sans intercepter les clics
- [x] **Exports** : colonnes *Garantie (contrat)*, *Fin de garantie*, *Statut
      garantie* dans l'inventaire (CSV / XLSX / PDF ch. 3.1) ; feuille XLSX
      **Garanties** ; export CSV **Garanties** ; tableau **Suivi des garanties**
      (trié par échéance) au ch. 3.1 du PDF avec **statut écrit en vert / rouge**
      + bilan chiffré et compteurs sur la page de garde
- [x] **LLD enrichi** : colonnes *Fin de garantie* + *Garantie* (colorée) dans
      les tableaux *Équipements* des chapitres 7 → 13 et colonne *Hors garantie*
      dans le récapitulatif par catégorie du ch. 3.1
- [x] **Démo** : `demo_datacenter.py` et `demo/demo-state.json` enrichis —
      **les 22 équipements portent une garantie** (20 en garantie, 2 hors
      garantie : SRV-DELL-01 et AKCP-02, 2 échéances < 90 j : FW-01, NAS-02),
      PDF LLD de démo régénéré en conséquence

- [x] **Vérification** : 57 contrôles jsdom (helpers, modale, fiche, exports,
      PDF, undo, rétro-compatibilité) + 21 contrôles sur la démo réelle — vert

### ✅ Lot 9 — Démo en ligne (hébergement statique) — **FAIT**
- [x] **Workflow Pages** : `demo/demo-state.json` est publié dans l'artefact
      (il manquait — la démo ne s'affichait qu'en secours) + échec explicite de
      la CI si le fichier est absent
- [x] **Démarrage** : un état local sans aucun workspace (ex. sauvegarde ne
      contenant que le device permanent) ne masque plus la démo ; les devices
      locaux sont conservés à la fusion
- [x] **Bouton « 🎬 Charger la démo »** sur l'écran d'accueil : recharge la
      démonstration à tout moment (fusion non destructive, pas de doublon,
      Ctrl+Z compatible)
- [x] **Suppression volontaire respectée** : la démo supprimée n'est pas
      recréée au rechargement (`demoDismissed`), le bouton la rouvre
- [x] Correctifs : horodatage de la démo (`20260908` lu comme des
      millisecondes → « 01 janv. 1970 »), `activeWorkspaceId` conservé après fusion
- [x] Vérifié par un **test de bout en bout** qui sert le contenu exact publié
      par le workflow et charge la page comme un navigateur (démo, 22 pastilles
      de garantie, reprise après suppression)

---

## 🎉 PROJET TERMINÉ

Les 7 lots sont implémentés et validés : le **Document LLD (PDF)** couvre
désormais la structure cible complète (15 chapitres), alimenté par les
données de l'application (sites, catégories, zones de switching, FAI,
interconnexion, domaines de câblage, flux) et exportable en Excel/CSV.

---

## D. Décisions à valider au fil des lots

1. **Switching 8.1→8.5** : sous-chapitres **fixes** (comme la cible) ou
   **dynamiques** (générés selon les sites/zones déclarés) ? → proposition :
   dynamiques avec jeu par défaut = cible exacte.
2. **Chapitres vides** (ex : pas de CCTV) : masqués ou affichés « néant » ?
   → proposition : affichés avec mention, pour garder une numérotation stable.
3. **Multi-sites par workspace** : un workspace = un dossier LLD complet
   (2 sites), ou un workspace par site ? → proposition : dossier complet
   multi-sites dans un workspace (cohérent avec la cible).
4. **Règles de pare-feu** (politiques NAT/filtering détaillées) : hors périmètre
   pour l'instant, ou table éditable dans le ch. 7 au lot 5 ?

---

*Document créé le 2026-09-08 — à cocher au fur et à mesure des lots.*

---

## X. Export XLSX « template Louis Michel » — état et champs manquants

> Livré : le classeur exporté réplique les **24 feuilles** du template
> (LLD, Governance, Contenu, chapitres 1→15.1) : styles/theme verbatim,
> fusions, largeurs, hauteurs. Rempli depuis l'app : LLD (client/auteur/version),
> Governance (révisions/approbateurs/réviseurs), ch.1 objectif, ch.2 site +
> existant + inventaire par catégorie, ch.3 équipements par modèle, ch.4 VLANs,
> ch.5 FAI, ch.6 interco (extrémités, sous-réseaux locaux).
> Les captures d'écran du template (UI Aruba, diagrammes) restent à recoller
> manuellement dans le fichier exporté.

### Champs NON encore saisis dans l'app (à ajouter plus tard) :

1. ~~**ch.2 — 2.1 Info site** : type de site, pays, nombre d'utilisateurs.~~
   ✅ FAIT — champs ajoutés à la fiche de chaque site (fiche LLD) et projetés
   dans l'export (C7/E7/C8 de la feuille « 2 »).
2. **ch.2 — 2.2 Existant** : ✅ FAIT — tableau rempli dispositif par modèle
   (B52-59 : modèle + quantité), FAI en ligne 51.
3. **ch.3 — 3.1 Equipments** : ✅ FAIT — distinction besoin/existant
   (« x1 (besoin) ») et colonnes Remarques/Statut via la table
   « Équipements & licences hors baie » de la fiche LLD (r65-76 du ch.3) ;
   les devices d'inventaire restent listés par modèle (B41-64).
4. **ch.4 — Nomenclature détaillée** : l'arbre du template reste manuel ;
   ✅ le registre de l'app est projeté en bloc annexe sous le tableau (r171+).
5. **ch.5 — FAI** : ✅ FAIT — FAI multiples avec réglages avancés par FAI :
   mode IP WAN (DHCP/Statique), IP WAN, IPv6, LAN IP/Mask/GW/DNS, DHCP,
   Port Forwarding, DMZ, Firewall, WLAN/SSID → colonnes C-T des lignes 35-38.
6. **ch.5 — 5.2 Câblage FAI** : ✅ FAIT — champ « Liaison physique » par FAI
   (wanLabel) → boîtiers C46-52 + liaisons D46-53.
7. **ch.6 — 6.1 Interco** : ✅ FAIT — par extrémité : N° série, firmware,
   groupe HA, rôle préféré (Master/Slave → Resume Master déduit), IP admin ;
   IP virtuelle par site ; WAN Connection Settings depuis les FAI (méthode,
   IP, débits) ; LAN (routing, nb VLANs, subnets).
   ✅ Admin Security (comptes d'administration) : table « adminSec » de la
   fiche LLD → r37-38 (user/pwd, authentification, protocole, host, port,
   CLI SSH, sécurité, Web Admin Access LAN/WAN, commentaire).
   Reste manuel : health check (méthode/DNS/timeout).
8. **ch.6 — 6.2 Câblage** : ✅ FAIT — liaisons WAN (wanLabel des FAI) et
   LAN 1 (« LAN 1 connecté à » par extrémité) → E62-E71.
9. **ch.7-13** : ✅ FAIT — 7.3 Règles & NAT (table « fw »), 9.2 Machines
   virtuelles (table « vms »), 10.2 Volumes/LUN (table « vols »), 12.2
   Caméras (table « cams »), VLANs par zone de switching (ch. 8). Reste
   ✅ VPN S2S (table « vpns » → VPN Site to Site r15-18 du ch.4), alias
   firewall (table « aliases » → r24-32), profils firewall (VPN SSL /
   AppCtrl / WebBlocker / HTTP Proxy → r34-37), cluster Master/Slave
   (champs clusterA/clusterB → r66-69), VLANs firewall mappés par mots-clés
   (r38-63), mgmt/serveurs/SAN/imprimantes/clime (r64-137). Reste manuel :
   configs poussées par switch (8.x), emplacements IDS/SPO (11/13),
   health-check et Admin Security (ch.6).
10. **ch.15 Cablage/Rack** : ✅ FAIT (câblage complet + élévations par baie).

### Chapitres 7 → 15.1 — remplis par l'export depuis l'app (fait) :

- **ch.7** : équipements Firewall/Routeurs (inventaire) + table des interfaces
  VLAN (lld.vlans).
- **ch.8 → 8.5** : équipements Switching filtrés par zone (lld.swZones rattachée
  aux devices) + plan de ports (ports du device) quand la zone en a ; sinon la
  feuille du template est conservée telle quelle (« Config: Voir CMDB »).
- **ch.9/10/11/12/13** : table équipements de la catégorie (serveurs, stockage,
  IDS, CCTV, pointage) avec position et IP mgmt ; message explicite si vide.
- **ch.14** : tableau des flux (ws.flows) — diagramme reste à coller.
- **ch.15** : tableau de câblage complet (tous câbles, A et B).
- **ch.15.1** : élévations baie par baie (position U, nom, catégorie, modèle,
  taille, IP mgmt).

### Reste NON extractible de l'app (ch.7+) — à ajouter comme saisie plus tard :

- **ch.7** : NAT 1-to-1, règles/alias, VPN SSL (profils utilisateurs),
  paramètres de cluster/HA firewall.
- **ch.8** : liaison zones ↔ VLANs par switch, configs par rôle (STP, DHCP
  snooping, routage inter-VLAN, stacks/HA entre switches), « Config: Voir CMDB »
  reste manuel.
- **ch.9** : inventaire des VMs (nom, rôle, hôte, VLAN) — l'app ne connaît que
  les serveurs physiques.
- **ch.10** : volumes/LUN, targets iSCSI, plan de sauvegarde.
- **ch.11/12/13** : zones de détection/caméras/pointage (emplacements, plans).
- **ch.14** : diagramme de flux (image) — à coller dans le fichier exporté.
- **ch.2/3/5/6** : voir la liste 1-8 ci-dessus.
