<p align="center">
  <img src="assets/logo.svg" alt="Logo LLDraw" width="112" height="112">
</p>

<h1 align="center">LLDraw</h1>

<p align="center">
  Application web de planification de baies data center — type draw.io, spécialisée racks.
</p>

---
Glissez-déposez un rack 12U, placez vos devices (avec photo de face avant) et étiquetez
les ports.

## Lancer l'application

Aucune dépendance à installer (Python 3 suffit). Pour bénéficier de la
**sauvegarde permanente côté serveur** — les workspaces ne disparaissent
pas quand on change de navigateur ou qu'on vide le cache — lancez :

```bash
cd DC
python3 server.py          # http://localhost:8080  (ou : python3 server.py 9000)
```

Puis ouvrez <http://localhost:8080>.

Ce serveur fait deux choses : il sert les fichiers statiques **et** il
enregistre l'état de l'application dans un fichier JSON : **`data/state.json`**
(écriture atomique). Sauvegardez/copiez ce fichier pour sauvegarder ou
déplacer vos plans. L'indicateur dans la barre du haut est **☁️** quand
l'enregistrement se fait sur le serveur, et **💾** quand l'application
tourne sans serveur (dans ce cas les données restent dans le navigateur,
via localStorage, en secours).

> Une ancienne sauvegarde présente dans le navigateur est automatiquement
> reprise et envoyée au serveur au premier démarrage avec `server.py`.

## Utilisation

0. **Écran d'accueil** : au lancement, une page d'accueil affiche un bouton
   **« Créer un workspace »**, un bouton **« 🎬 Charger la démo »** (voir plus
   bas) et l'**historique de vos workspaces** (cartes triées
   par date de modification, avec le nombre de baies / devices et la date).
   Cliquez sur une carte pour ouvrir le workspace, ou sur 🗑 pour le supprimer.
   Cliquez sur le **logo** ou le nom **LLDraw** dans la barre du haut pour revenir à l'accueil à tout moment.
   - Chaque workspace possède **son propre board** : baies, devices placés et ports.
   - La **bibliothèque de devices est partagée** : un device créé dans un workspace
     est disponible dans tous les autres.
   - La position et le niveau de zoom du board sont mémorisés par workspace.
   - **Rien n'est jamais supprimé automatiquement** : la suppression d'un workspace,
     d'une baie ou d'un device se fait uniquement via les boutons prévus, avec
     confirmation.
   - La création et la suppression des workspaces se font depuis l'écran d'accueil.
1. **Navigation** : le board est une surface infinie — **molette** pour zoomer
   (centré sur le curseur), **glisser le fond** pour se déplacer. Les boutons
   en bas à droite (`−`, `+`, `⌂`) donnent aussi le zoom et le recentrage.
2. **Racks** : dans le panneau de gauche, choisissez la **taille** (6U à 42U)
   puis glissez la carte **Rack** sur le board. Vous pouvez placer plusieurs
   racks, les déplacer en tirant l'en-tête, **changer leur taille** via le menu
   dans l'en-tête, et les **renommer** en double-cliquant sur le nom.
   Le sélecteur de **site** de l'en-tête rattache le rack à un site déclaré
   dans la fiche du dossier (onglet **Sites**) : une **pastille colorée**
   identifie le site, reprise dans les exports (PDF, PNG, CSV, Excel). La
   section **Sites** du panneau de gauche permet de **filtrer le board** par
   site (les racks des autres sites sont atténués).
   L'en-tête affiche des **métriques de capacité** mises à jour en direct :
   espace occupé (`8/12U`, en rouge si plein), **puissance totale** et
   **poids total** des devices (si renseignés). **Double-cliquez sur les
   badges puissance/poids** pour définir un **budget électrique (W)** et une
   **charge maximale (kg)** : le badge passe en rouge en cas de dépassement.
   Les racks sont dessinés comme de vrais racks 19" : montants perforés
   (trous de cage nuts), règle des U et faceplates métalliques.
3. **Recherche globale** : le champ de la barre du haut cherche dans **tous les
   workspaces** (nom de device, nom de port, étiquette — ex. `CAB-SRV-01` —,
   **sites** et **flux réseau**). Un clic sur un résultat device/port ouvre le
   bon workspace, centre la vue sur le rack et fait **clignoter** l'élément
   trouvé ; un résultat **site** ou **flux** ouvre directement la fiche du
   dossier (onglet correspondant).
4. **Annuler / Rétablir** : **Ctrl+Z** (ou Ctrl+Maj+Z) et **Ctrl+Y** permettent
   d'annuler/rétablir toutes les actions (placement, suppression, « Vider »,
   création de device/workspace…).
5. **Export du plan** : le bouton **Exporter** de la barre du haut ouvre un
   menu permettant d'enregistrer le plan du workspace courant :
   - **Image PNG** / **Plan PDF (1 page)** — rendu haute définition des racks,
     devices et ports ;
   - **Document LLD (PDF)** — le dossier complet, multi-pages, structuré en
     **15 chapitres** avec **sommaire** (numéros de page) : 1. Objectif,
     2. Aperçu du site, 3. Architecture cible (+ 3.1 Équipements/inventaire et
     suivi des garanties),
     4. Nomenclature & adressage IP global, 5. FAI, 6. Interconnexion
     site 2 site, 7. Firewall, 8. Switching (5 sous-sections), 9. Serveurs,
     10. Stockage, 11. IDS, 12. CCTV, 13. Pointage, 14. Flux réseau &
     diagramme (topologie), 15. Câblage/Rack (synthèse, tableau de câblage,
     élévations). Page de garde (client, auteur, version, révisions,
     statistiques). Les chapitres non encore renseignés affichent
     « Section à compléter ». Pieds de page numérotés (date, page X/Y).
     Généré sans dépendance (PDF natif).
   - **Classeur Excel (.xlsx)** — un vrai fichier Excel (écrit sans dépendance)
     avec jusqu'à 9 feuilles : *Inventaire*, *Câblage*, *Ports*, *Racks*,
     *Sites*, *Nomenclature*, *Adressage IP*, *Garanties* et *Flux*
     (en-têtes stylés, largeurs automatiques, première ligne figée ; les
     feuilles vides sont omises) ;
   - **Inventaire (CSV)** — tableau de tous les devices posés (rack, site,
     étage, taille, nom, catégorie, marque, modèle, référence, n° série,
     IP mgmt, VLAN, puissance, poids, garantie/contrat, fin de garantie,
     statut de garantie, nombre de ports) ;
   - **Câblage (CSV)** — tableau des cordons (ID, couleur, extrémités A/B :
     rack, device, port, étiquette) ;
   - **Ports & étiquettes (CSV)** — tous les ports avec rack, site, étage,
     device, nom du port, étiquette, IP, VLAN et câble connecté ;
   - **Sites (CSV)** — sites du dossier (adresse, contacts, description,
     nombre de racks) ;
   - **Nomenclature & adressage (CSV)** — table de nomenclature puis registre
     VLANs & subnets ;
   - **Garanties (CSV)** — suivi des garanties de tous les devices (rack, site,
     étage, device, n° série, contrat, fin de garantie, statut « En garantie » /
     « Hors garantie », échéance en jours), trié de la plus proche échéance à
     la plus lointaine ;
   - **Flux réseau (CSV)** — matrice des flux (source, destination,
     protocole/ports, sens, usage).
   Les CSV sont au format Excel français (séparateur `;`, UTF-8 BOM).
6. **Créer un device** : cliquez sur **＋ Créer un device**, donnez-lui un nom,
   une taille (1U, 2U…), une **catégorie** (Routeur/FAI, Firewall, Switch,
   Borne WiFi, Serveur, Stockage, IDS, CCTV, Pointage, Onduleur, Brassage,
   Autre) et importez la **photo 2D de la face avant**. Laissée sur « Autre »,
   la catégorie est **devinée depuis le préfixe du nom** (`FW-01` → Firewall,
   `SW-CORE-01` → Switch, `SRV-…` → Serveur…) ; les anciens devices sont
   migrés de la même façon à l'ouverture.
   Une **fiche d'inventaire** optionnelle complète le modèle : marque, modèle,
   référence constructeur, n° série, IP management, VLAN(s), puissance (W),
   poids (kg), **fin de garantie** (sélecteur de date) et **garantie / contrat**
   (ex. « Constructeur 3 ans — NBD »). Ces champs sont recopiés sur chaque
   exemplaire posé dans un rack (et restent modifiables individuellement depuis
   la fiche de survol).
   - **Suivi des garanties** : sous le champ *Fin de garantie*, la modale
     affiche le statut recalculé en direct — **✅ En garantie** ou
     **⛔ Hors garantie**. Chaque device posé porte une **pastille 🛡️**
     dans son coin supérieur gauche, **verte** s'il est encore sous garantie,
     **rouge** dans le cas contraire (les deux seules couleurs, comme demandé).
     Le statut est repris **à côté du nom** dans la fiche de survol, et dans le
     tableau **Suivi des garanties** du chapitre 3.1 du dossier LLD (statut
     écrit en vert / rouge, ligne de bilan + compteurs sur la page de garde).
     Une échéance à moins de 90 jours reste **verte** (le matériel est encore
     garanti) mais est signalée en toutes lettres : *« expire bientôt »*.
   La **bibliothèque** affiche la catégorie de chaque modèle (icône) et peut
   être **filtrée par catégorie** ; le device WatchGuard permanent est
   pré-classé « Firewall ».
   - **Détection automatique des ports** : dès l'import de la photo, l'application
     analyse l'image et repère les connecteurs (RJ45, SFP…) — ports noirs sur
     panneau clair, clairs sur panneau sombre, etc. Les ports trouvés sont
     affichés en vert sur l'aperçu ; décochez la case si vous préférez les
     placer à la main. Chaque exemplaire du device posé dans un rack arrive
     avec ces ports déjà étiquetés (numérotés 1, 2, 3…), prêts à être renommés
     en mode Étiquetage ou câblés en mode Câblage.
7. **Placer un device** : glissez-le depuis la bibliothèque vers un rack : il se place
   automatiquement à l'étage (numéro d'U) où vous le déposez. La zone visée est surlignée
   en vert (libre) ou rouge (occupé). Vous pouvez aussi déplacer un device déjà placé,
   ou le retirer avec le bouton ✕ au survol.
   - **Fiche du device au survol** : laissez le curseur un instant sur un device posé
     (hors modes Étiquetage/Câblage) — une fiche s'affiche avec sa photo, son nom, sa
     taille, sa **catégorie**, son étage de départ et son nombre de ports —
     plus sa **zone de Switching** pour les switchs et bornes WiFi.
     **Double-cliquez sur une valeur pour la modifier** : le nom, la taille en U
     (replacé automatiquement au plus près s'il faut de la place), la catégorie
     et la zone (listes déroulantes) ou l'étage de départ (avec contrôle de
     collision). Entrée valide, Échap annule.
     **À côté du nom** s'affiche un badge de garantie : **vert « ✅ En garantie »**
     ou **rouge « ⛔ Hors garantie »** (gris neutre si la date n'est pas
     renseignée) — son infobulle donne la date de fin, l'échéance en jours et le
     contrat. La section **Garantie** de la fiche donne la **fin de garantie**
     (écrite en vert / rouge) et le **contrat** ; double-cliquez pour les
     modifier, avec un sélecteur de date pour l'échéance — les changements de
     garantie passent par Ctrl+Z comme le reste.
8. **Port et étiquetage** : le bouton **🔌 Port et étiquetage ▾** propose deux modes :
   **➕ Créer des ports** (cliquez sur la face avant d'un device pour y poser un port,
   icône RJ45) et **✏️ Modifier les ports** (cliquez sur un port existant pour changer
   son **nom** — ex. `Gi0/1` —, son **étiquette** — ex. `CAB-SRV-01` —, son **IP**
   et son **VLAN** (plan d'adressage), ou sa **taille**
   via un curseur en pourcentage de 50 % à 250 %, avec un aperçu en transparence ;
   glissez un port pour le repositionner). Un port peut aussi être supprimé depuis sa
   fenêtre d'édition. Au survol, l'infobulle affiche nom, étiquette, IP et VLAN.
9. Au **survol d'un port**, une infobulle affiche son nom et son étiquette.
10. **Mode Câblage** : l'interrupteur **Câblage** de la barre du haut active le
    mode. Cliquez alors **un port, puis un autre port** pour les relier par un
    cordon (courbe réaliste avec effet de poids). Le câble reçoit un identifiant
    (`CAB-001`…), une **couleur** et un **domaine** (FAI, Interconnexion 2
    sites, Switching…) modifiables en cliquant sur le câble — le domaine
    répartit les cordons dans les tableaux de câblage des chapitres du dossier
    LLD (ch. 5.2 FAI, 6.2 interconnexion…). Le
    panneau **Connexions** liste tous les câbles du workspace et permet de les
    retrouver (centrage) ou de les supprimer. Les câbles sont inclus dans
    l'export PNG/PDF. Désactiver l'interrupteur masque les câbles et interdit
    leur édition.
11. **Vue Topologie (diagramme logique)** : le sélecteur **📐 Élévations /
    🕸️ Topologie** de la barre du haut bascule le board en diagramme réseau.
    **⚡ Générer depuis les racks** crée un noeud par device posé (nom avec
    icône de catégorie, marque/modèle, rack · étage, IP mgmt) ; **🔌 Importer les câbles** crée un lien par
    câble physique ; **➕ Nouveau lien** relie deux noeuds cliqués l'un après
    l'autre. Un lien (nom, débit, VLAN, style, couleur) se modifie en cliquant
    dessus ; les noeuds se déplacent à la souris ; **double-clic sur un noeud**
    revient en élévations, centré sur le device. La topologie est sauvegardée
    dans le workspace et se recadre automatiquement (⌂).
12. **Infos du dossier LLD** : le bouton **📘** de la barre du haut ouvre la
    fiche du dossier, organisée en onglets :
    - **📄 Document** — **client**, **auteur**, **version**, textes du dossier
      (**1. Objectif du document**, **2.2. Infrastructure existante**,
      **3. Architecture cible**) et **historique des révisions** (tableau
      ajouté à la page de garde du PDF) ;
    - **🌐 Réseau** — **nomenclature** (type d'objet, préfixe, exemple, règle)
      avec un bouton **🔎 Générer depuis les devices** qui détecte les
      préfixes utilisés (FW, SW, SRV…) et propose le type d'objet ; le
      **registre d'adressage IP global** (VLAN, nom, site, subnet, passerelle,
      usage) avec **🔎 Détecter depuis les ports** ; le bloc **FAI**
      (opérateur, offre, type de lien, débits, bloc IP publiques, CPE,
      notes de configuration — ch. 5) et le bloc **Interconnexion site 2
      site** (technologie IPsec/MPLS/SD-WAN…, endpoints publics, subnets
      locaux/distants, routage, chiffrement, notes — ch. 6) ;
    - **🏢 Sites** — gestion des sites du dossier (nom, adresse, contacts,
      description). **Site A / Site B** sont créés par défaut ; chaque rack se
      rattache à un site via le sélecteur de son en-tête (pastille colorée,
      filtrage du board par site). Supprimer un site détache les racks qui y
      étaient rattachés ;
    - **🔄 Flux** — **matrice des flux réseau** (ch. 14) : nom, source,
      destination, protocole/ports, sens (bidirectionnel/unidirectionnel) et
      usage de chaque flux ; dans la vue Topologie, le sélecteur 🔄 met en
      évidence les équipements mentionnés dans le flux choisi ;
    - **📚 Chapitres** — **notes de configuration** de chaque chapitre 7 à 13
      (Firewall, Switching, Serveurs, Stockage, IDS, CCTV, Pointage) et
      **zones de Switching** qui découpent le chapitre 8 : par défaut INFRA,
      LAN Site B, Aruba AP Site A, Aruba AP Site B, LAN Site A (ajout,
      suppression, réordonnancement ↑↓) ; les chapitres 7 à 13 du PDF sont
      générés automatiquement : notes, équipements par catégorie (et par
      zone pour le Switching), ports & adressage, câblage du domaine.
    Ces informations alimentent les chapitres correspondants du document LLD
    (le ch. 2.1 affiche le tableau des sites et les racks par site, et la
    colonne **Site** apparaît dans l'inventaire, les ports et la synthèse des
    racks de tous les exports).

Tout est sauvegardé automatiquement : sur le **serveur (fichier `data/state.json`)**
quand l'application est lancée avec `server.py`, et sinon dans le navigateur
(localStorage) comme solution de secours. Workspaces, boards, bibliothèque de
devices et ports persistent donc entre les sessions — et même d'un navigateur à
l'autre avec le serveur. Un rack se supprime individuellement via son ✕ ; un
workspace entier se supprime depuis l'écran d'accueil.

### Performances

L'état (photos des faces avant comprises) peut atteindre plusieurs centaines de
Ko. Trois mécanismes en limitent le coût en RAM et en CPU :

- **Historique d'annulation léger** — les 40 snapshots d'undo clonent la
  structure de l'état en **partageant les chaînes** (photos base64, immuables
  en JS) : ~0,2 ms et quelques Ko par snapshot, au lieu de ~3 ms et ~32 Mo
  cumulés avec un clonage JSON complet ;
- **Sérialisation unique** — chaque sauvegarde ne paie `JSON.stringify(state)`
  qu'une seule fois, partagée entre localStorage et le push serveur ;
- **Photos non dupliquées** — un exemplaire posé dans une baie n'embarque plus
  la copie de la photo de son modèle : le rendu retombe sur la bibliothèque
  (surcharge possible par exemplaire), et la photo est matérialisée dans les
  exemplaires concernés si le modèle est supprimé.

### Fluidité du board (pan / zoom / déplacements)

Le board est un élément de 8000×6000 px (grille de points + faces avant).
Sans précaution, chaque frame de pan/zoom **repeint toute la surface visible**
sur le thread principal — d'où un déplacement « à 10 fps » sur machine modeste.
Quatre mécanismes le rendent fluide :

- **calque GPU dédié** — `will-change: transform` sur `.board` : le pan/zoom
  est traité par le compositeur sans repeindre la grille ni les photos ;
- **`requestAnimationFrame`** — les `pointermove` (jusqu'à 240 Hz sur une
  souris gamer) sont coalescés en une mise à jour visuelle par frame de
  l'écran, pour le pan, le déplacement des baies et celui des nœuds de
  topologie ;
- **drag composité des baies** — pendant le déplacement d'une baie, seule une
  translation (`transform`, GPU) est animée ; `left/top` et la sauvegarde ne
  sont écrits qu'au relâchement ;
- **libellé de zoom** — le pourcentage n'écrit dans le DOM que lorsqu'il
  change réellement.

Sur un board **très rempli** (démo : ~170 ports, 22 faces avant), des
optimisations supplémentaires :

- **ports sans filtre par défaut** — chaque port portait un
  `filter: drop-shadow`, l'un des effets les plus coûteux à rastériser,
  multiplié par le nombre de ports ; le halo reste au survol et pendant le
  drag (un seul élément à la fois) ;
- **animations compositées** — la pulsation des ports (mode édition) et des
  LED anime `transform`/`opacity` (GPU) au lieu de `filter` (repaint par
  frame) ;
- **grille de points en tuile PNG** — un blit pré-rendu au lieu d'un
  radial-gradient rejoué sur toute la surface visible à chaque échelle ;
- **`content-visibility: auto` sur les devices** — les équipements hors
  écran ne sont ni layoutés ni peints : zoomé dans une baie, seul le visible
  coûte ;
- **zoom molette coalescé** — les ticks de molette/trackpad sont cumulés et
  appliqués une fois par frame d'écran ;
- **sauvegarde en fin de geste** — l'écriture synchrone de l'état
  (~400 Ko, localStorage) pendant le pan/zoom provoquait des à-coups
  réguliers ; elle n'a plus lieu qu'au relâchement ;
- **calque GPU par port** — diagnostic de l'utilisateur : le lag augmentait
  avec le nombre de ports, et les modes Câblage / « Modifier les ports »
  étaient fluides alors que les modes normal / ajout étaient lents. Cause :
  la pulsation de ces modes (animation `transform`) plaçait chaque port sur
  son propre calque GPU — peint une fois, caché — quand en mode normal les
  ports étaient re-peints dans les tuiles du board géant à chaque
  défilement. `will-change: transform` sur `.port` donne ce calque à tous
  les ports en permanence ;
- **effet de survol des ports rétabli en version sûre** — l'ancien survol
  (`filter: drop-shadow` + transition de filtre) déclenchait des repaints
  en rafale quand le curseur balayait un board rempli. Rétabli sans risque
  depuis que chaque port possède son calque GPU : le grossissement n'anime
  que le calque du port survolé (composité GPU) et le halo est un
  `box-shadow` appliqué sans transition (une re-peinture de 26 px). Les
  ports restent inertes (`pointer-events: none`) pendant pan/zoom/drag de
  baie — le survol ne peut plus se déclencher en rafale pendant un geste.
  Le graphique du port (RJ45) a été retravaillé : biseau métallique, reflet
  satiné, cavité plus profonde, contacts dorés avec ombres portées ;

## 🚀 Déploiement

**Hébergement statique (GitHub Pages…)** — aucun serveur requis :

- Publiez le dépôt (Settings → Pages → branche principale) ;
- au premier chargement, l'application détecte l'absence de serveur et de
  sauvegarde locale et charge **la démo embarquée** (`demo/demo-state.json`,
  versionnée — 2 baies, 26 câbles, dossier LLD rempli) ;
- les modifications sont alors sauvegardées dans le navigateur
  (localStorage) uniquement.

**Mode serveur (`python server.py`)** — état partagé et persistant :

- sert l'application **et** l'API de sauvegarde (`data/state.json`) : les
  workspaces survivent au changement de navigateur ;
- le port honore la variable d'environnement `PORT` (imposée par les
  hébergeurs PaaS — Render, Fly.io, Railway…) puis l'argument explicite
  (`python server.py 9000`) ;
- sur un PaaS, prévoyez un **disque persistant** pour `data/` (sinon l'état
  est remis à zéro à chaque redéploiement) ; un simple VPS avec
  `python3 server.py` suffit aussi (aucune dépendance).

La démo se régénère sur une machine avec Pillow :
`python demo_datacenter.py` met à jour `data/state.json` (workspace démo
ajouté aux données existantes) **et** `demo/demo-state.json` (copie « démo
seule » pour l'hébergement statique — à committer).

## 🌐 Hébergement statique (GitHub Pages)

Sans `server.py`, l'application fonctionne dans le navigateur (localStorage).
Au premier démarrage, **le workspace de démonstration est chargé
automatiquement** depuis `demo/demo-state.json` (publié par le workflow
`.github/workflows/pages.yml`) pour ne jamais arriver sur un écran vide.

- Le bouton **« 🎬 Charger la démo »** de l'écran d'accueil (re)charge la
  démonstration à tout moment, sans jamais écraser vos workspaces : les
  équipements de la démo absents de votre bibliothèque y sont ajoutés, et si
  la démo est déjà là, elle est simplement ouverte (pas de doublon).
- Si vous supprimez le workspace de démonstration, il n'est **pas** recréé au
  rechargement suivant (l'application retient votre choix) ; le bouton permet
  de le faire revenir.
- Un état local ne contenant **aucun workspace** (par exemple une sauvegarde
  réduite au device permanent) déclenche lui aussi le chargement de la démo —
  c'est ce qui garantit que la démonstration ne disparaît plus.

## 🎬 Démonstration

Le dossier **`demo/`** contient un datacenter de démonstration complet
(2 baies : 3 Nutanix, 1 Dell R740, 2 NAS, 2 WatchGuard, 2 Peplink, 2 Aruba,
2 AKCP, 5 panneaux de brassage, 3 passe-câbles à brosse, 26 cordons, 14 nœuds
de topologie, 6 flux, **22 garanties renseignées** (tous les équipements :
20 en garantie, 2 hors garantie — Dell R740 et sonde AKCP de la baie B — et
2 arrivant à échéance sous 90 j, FW-01 et NAS-02) et un dossier LLD
intégralement rempli) ainsi que le PDF
LLD généré et un guide de présentation — voir `demo/GUIDE-DEMO.md`.
Le script `demo_datacenter.py` reconstruit ce workspace dans `data/state.json`
à la demande (les données de démonstration ne sont pas versionnées).

## Fichiers

- `server.py` — serveur HTTP + persistance JSON (`data/state.json`)
- `index.html` — structure de l'interface
- `styles.css` — thème et mise en page
- `app.js` — logique (drag & drop, racks, devices, ports, câbles, persistance)
- `assets/logo.svg` — logo du projet (icône d'application, défini en vectoriel) ;
  décliné en PNG (`logo-512.png`, `logo-192.png`), favicon (`favicon.ico` /
  `favicon-*.png`) et `apple-touch-icon.png`
- `data/state.json` — état sauvegardé (créé automatiquement, non versionné)
- `demo/` — datacenter de démonstration (PDF LLD, rendus, guide) ;
  `demo_datacenter.py` — script de (re)construction du workspace démo
