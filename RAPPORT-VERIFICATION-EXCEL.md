# Rapport de vérification — Classeur Excel ↔ Application LLDraw

**Date** : 2026-09-21 · **Classeur de référence** : `Datacenter_D_mo-2026-09-18 (4).xlsx`
(export antérieur du workspace démo « Datacenter Démo ») · **Export vérifié** :
`Datacenter_Demo-LLD-export-2026-09-21.xlsx`, régénéré par le code actuel de
l'application sur l'état de démonstration enrichi.

---

## 1. Méthode

1. **Analyse du classeur** : lecture cellule par cellule des 24 feuilles
   (LLD, Governance, Contenu, chapitres 1 → 15.1).
2. **Traçabilité** : pour chaque cellule, identification du champ de
   l'application qui l'alimente (code d'export `LLD_TPL` de `app.js` +
   modale 📘 Infos LLD, fiches devices, câbles, sites, flux).
3. **Export réel** : le code d'export de l'application a été exécuté
   (`tools/run_export.mjs`) sur l'état du workspace pour produire un
   classeur, puis comparé cellule par cellule à la référence
   (`tools/compare_xlsx.py`).
4. **Audit des cases vides** : `tools/audit_export.py` vérifie 247 cases
   attendues et liste les trous restants.
5. **Corrections** : chaque case vide ou mal placée a été traitée —
   soit par un **correctif d'export** (bug de code), soit par un **champ de
   saisie ajouté**, soit par **ajout du device / de la donnée** dans la démo.

---

## 2. Cartographie « case Excel ↔ saisie dans l'application »

| Feuille | Cellules | Source de saisie dans l'application |
|---|---|---|
| **LLD** | E1 projet, E3 auteur, E4 version | 📘 onglet *Document* : Client, Auteur, Version |
| **Governance** | révisions (v/auteur/date/commentaire), statut « Approuvé » | 📘 *Document* : Historique des révisions + Approbateurs (statut déduit) |
| **Governance** | approbateurs (nom/position/organisation/version), réviseurs | 📘 *Document* : tableaux Approbateurs / Réviseurs |
| **Contenu** | sommaire | statique (structure du dossier) |
| **1** | A5+ objectif | 📘 *Document* : Objectif du document |
| **2** | C6/E6 nom + adresse, C7 type, E7 pays, C8 utilisateurs | 📘 *Sites* : fiche de chaque site (2 lignes) |
| **2** | C9 débit FAI cumulé, C10 commentaire, D51 opérateur | 📘 *Réseau* : blocs FAI (opérateur, débits, notes) |
| **2** | B16+ infrastructure existante | 📘 *Document* : Infrastructure existante |
| **2** | B52-D59 dispositifs (modèle × quantité) | automatique : inventaire des baies (groupé par modèle) |
| **3** | A2+ architecture cible | 📘 *Document* : Architecture cible |
| **3** | 3.1 B41-D76 équipements, F remarques, G statut | automatique (inventaire) + 📘 *Chapitres* : Éléments hors baie |
| **4** | D6-G8 / D12-G14 adressage WAN des FAI | 📘 *Réseau* : FAI — IP/Masque/GW/DNS WAN (+ mode DHCP si IP dynamique) |
| **4** | C9/D10 + D9/D10 extrémités S2S, D11 VIP | 📘 *Réseau* : Interconnexion — Extrémités A/B, VIP A |
| **4** | C15-D18 tunnels VPN S2S | 📘 *Réseau* : Tunnels VPN S2S |
| **4** | C19/D19-C20/D20 firewalls | automatique : devices de catégorie Firewall |
| **4** | C21/D21 NAT 1-to-1 | 📘 *Chapitres* : Règles/NAT firewall (1re règle NAT) |
| **4** | C24-D32 alias firewall | 📘 *Réseau* : Alias firewall (9 lignes) |
| **4** | C34-C37 profils (VPN SSL, AppControl, WebBlocker, HTTP Proxy) | 📘 *Réseau* : Profils firewall |
| **4** | C38-E49 VLANs site A (+ IP/masque), C51-E62 VLANs site B | 📘 *Réseau* : Registre VLANs & subnets (colonne **Site** : bloc A = premier site, bloc B = site « Agence/Site B ») |
| **4** | C64-C69 mgmt master/slave + interfaces cluster | 📘 *Réseau* : Interconnexion — LAN admin IP, Interfaces cluster |
| **4** | D70-D75 IP des switches 1-6 | automatique : devices de catégorie Switch (IP mgmt) |
| **4** | C76-C99 VLANs par switch | 📘 *Chapitres* : Zones de Switching — colonne VLANs |
| **4** | C100-D107 serveur physique + ses ports | automatique : 1er device Serveur + ports étiquetés |
| **4** | C108-D112 SAN + ports | automatique : 1er device Stockage + ports |
| **4** | C113-D120 VM (BI/BC/AD/WEB ×2) | 📘 *Chapitres* : Machines virtuelles (appariement BI/BC/AD/WEB) |
| **4** | C121-D126 points d'accès | automatique : devices de catégorie Borne WiFi |
| **4** | C127-D130 imprimantes (PRT*) | automatique : devices nommés `PR*`/`PT*` |
| **4** | C131-D132 onduleurs, C133-D134 IDS, C135 NVR, C136 pointeuse, C137 clime | automatique : catégories Onduleur / IDS / CCTV / Pointage + devices `CLIM*`/`FROID*` |
| **4** | B143-D169 registre VLANs & subnets | 📘 *Réseau* : Registre VLANs (27 entrées) |
| **4** | B171+ nomenclature | 📘 *Réseau* : Nomenclature |
| **5** | C-T35-38 : un bloc par FAI (débit, LAN IP/Mask/GW/DNS, IPv6, DHCP, redirection de ports : règle + port WAN + port LAN + client interne + protocole, DMZ, firewall, WLAN statut + SSID, commentaire) | 📘 *Réseau* : blocs FAI (tous les champs) |
| **5** | 5.2 C46-D51 CPE + liaison physique | 📘 *Réseau* : FAI — CPE (modèle) + Liaison physique |
| **6** | r30/31 : extrémités, nomenclature (auto), SN, firmware, adressage WAN (du FAI rattaché), HA enable/group/rôle/resume, VIP, LAN admin IP + masque, commentaire FAI | 📘 *Réseau* : Interconnexion (tous les champs) + inventaire (modèle) |
| **6** | r37/38 System — Admin Security | 📘 *Réseau* : Comptes d'administration |
| **6** | r45-47 WAN connection settings | 📘 *Réseau* : FAI (mode IP, adressage, débits montante/descendante, opérateur) |
| **6** | r52/53 LAN (routage, VLANs routés, subnets) | 📘 *Réseau* : Interconnexion — Routage + Registre VLANs + subnets locaux |
| **6** | 6.2 r62-71 liaisons WAN/LAN par extrémité | 📘 *Réseau* : FAI — Liaison physique (appariée par extrémité) + LAN admin |
| **7** | 7.1 équipements, 7.2 interfaces VLAN, 7.3 règles/NAT | automatique (Firewall/Routeur) + Registre VLANs + 📘 *Chapitres* : Règles/NAT + note Config |
| **8-8.5** | équipements par zone + VLANs de la zone + plan de ports + Config | automatique (Switch/AP par zone) + 📘 *Chapitres* : Zones + note Switching |
| **9** | 9.1 serveurs, 9.2 machines virtuelles | automatique + 📘 *Chapitres* : Machines virtuelles |
| **10** | 10.1 stockage, 10.2 volumes/LUN | automatique + 📘 *Chapitres* : Volumes/LUN |
| **11-13** | IDS / CCTV (NVR + caméras) / Pointage | automatique (catégories) + 📘 *Chapitres* : Caméras + notes Config |
| **14** | matrice des flux | 📘 *Flux* (nom, source, destination, protocole, sens, usage) |
| **15** | tableau de câblage (ID, couleur, domaine, extrémités A/B) | mode Câblage : cordons posés + domaines |
| **15.1** | élévations par baie | automatique : racks + devices (position, nom, catégorie, modèle, taille, IP) |

---

## 3. Anomalies corrigées dans l'export (code)

| # | Anomalie | Correction |
|---|---|---|
| 1 | **Feuille 15** : colonnes « Rack B / Device B / Port B » décalées d'une colonne (écrivaient Device B/Port B/Étiquette B depuis l'ajout de la colonne « Étiquette A ») — le rack de l'extrémité B était perdu | indices corrigés (`c[7], c[8], c[9]`) |
| 2 | **Feuille 6** : VIP de l'extrémité B (N31) et masque admin B (P31) **écrits mais masqués** par les fusions du template `N30:N31` / `P30:P31` | fusions supprimées à l'export |
| 3 | **Feuille 4** : « Equipment Firewall 2 » (C20/D20) masqué par la fusion cluster `C19:C20` / `D19:D20` | fusions supprimées (2 firewalls distincts) |
| 4 | **Feuille 4** : ligne viDRAC du registre (B156) masquée par la fusion `B156:D156` | fusion supprimée |
| 5 | **Feuille 5** : sous-colonnes « Port WAN / Port LAN / Client interne / Protocol » et « SSID » jamais remplies — **champs inexistants dans l'application** | 5 nouveaux champs de saisie par FAI (PF — Port WAN/Port LAN/Client interne/Protocole, WLAN statut) + export L-O et S |
| 6 | **Feuille 4** : bloc VLANs du 2ᵉ site (r50-63) replié sur les VLANs du site A ; mot-clé iDRAC capté par « vMgmtIPMI » (VLAN 99 au lieu de 121) | filtre par colonne **Site** du registre + mot-clé iDRAC corrigé ; IP (D) et masque (E) désormais remplis pour chaque VLAN |
| 7 | **Feuilles 2/3** : ordre des modèles peu lisible (imprimantes en tête) | tri par domaine métier puis quantité ; feuille 2 : mention « + N autres modèles — voir 3.1 » |
| 8 | **Feuille 6 (6.2)** : libellés WAN des FAI recopiés en bloc sur les deux extrémités | chaque extrémité reçoit le libellé de **son** FAI (apparié par IP WAN) + le secours 5G |
| 9 | **Feuilles 8.2/8.5 et 8.3/8.4** : mêmes titres « (LAN) » / « (AP) » → mêmes zones dupliquées | distinction par ordinal de feuille : 8.2 = 1ʳᵉ zone LAN, 8.5 = 2ᵉ, 8.3 = 1ʳᵉ zone AP, 8.4 = 2ᵉ |
| 10 | **Feuilles 7-13** : notes « À compléter… » affichées même quand les tables étaient remplies ; notes de configuration par chapitre jamais exportées | notes dynamiques (ne mentionnent que le manquant) + export des notes **Config** saisies dans l'onglet Chapitres |
| 11 | **normLldInfo** : la colonne **Site** du registre VLANs était perdue à l'enregistrement | champ `site` conservé |
| 12 | **Feuille 4** : FTTH 3 / WAN 3 (5G en DHCP) restaient vides | affiche le mode de connexion (« DHCP ») |

---

## 4. Cases vides « dues au manque de device » → devices ajoutés

Les cases vides du classeur de référence l'étaient surtout parce que les
**devices correspondants n'existaient pas** dans la baie. La démo a été
complétée (demoVer 5) — chaque case est maintenant alimentée :

| Device ajouté / déplacé | Catégorie | Position | Case(s) remplie(s) |
|---|---|---|---|
| **IDS-01** (déplacé au siège) + **IDS-02** (nouveau, agence) | Intrusion (IDS) | RACK-A U19 · RACK-B U11 | feuille 4 C133-D134, feuille 11, 15.1 |
| **UPS-01** (siège) + **UPS-02** (nouveau, agence) | Onduleur | RACK-A U20 · RACK-B U14 | feuille 4 C131-D132, 15.1 |
| **NVR-01** (déplacé au siège) | CCTV | RACK-A U21 | feuille 4 C135-D135, feuille 12 |
| **SPO-01** (déplacé au siège) | Pointage | RACK-A U22 | feuille 4 C136-D136, feuille 13 |
| **PRT-01/PRT-02** (siège, nouveaux emplacements) + **PRT-03/PRT-04** (agence, nouveaux) | Autre (imprimantes réseau) | RACK-A U23-U24 · RACK-B U12-U13 | feuille 4 C127-D130 (4 lignes) |
| **CLIM-01** : IP de management ajoutée | Autre (clim de précision) | RACK-B U15 | feuille 4 C137-D137 |
| **RACK-A agrandi 18U → 24U** | — | — | place des 6 nouveaux devices du siège |

Autres données de démonstration ajoutées pour la complétude :

- **Registre VLANs** : VLAN 111 (VOIP siège) + bloc agence 123-134 (12 VLANs,
  colonne Site renseignée) → feuille 4 (blocs A et B + registre), feuilles 7.2/8.x ;
- **Alias firewall** 7-9 (LAN3, EXTERNAL3, SSL3) → feuille 4 r30-32 ;
- **VMs** SRV-BI-01, SRV-BI-02, SRV-BC-02, SRV-WEB-02 (8 VM au total) → feuille 4 r113-120 + feuille 9.2 ;
- **FAI 2 (Inwi)** : GW/DNS LAN, IPv6, redirection de ports, WLAN ; **FAI 3 (Orange 5G)** :
  adressage de bride, IPv6, DMZ/WLAN « — » → feuille 5 complète ;
- **Câbles** : 6 câbles cassés re-pointés (ports renommés : SRV-DELL-01 iDRAC/LAN1/LAN2,
  NAS-01 MGMT/ISCSI1) + **CAB-020…028 / CAB-109…111** (IDS, UPS, NVR, SPO, uplinks
  switches) + **CAB-027** restauré (BR-A-03/14 → FW-01 eth3) → feuille 15 : **38 câbles**, aucun trou ;
- **Nomenclature** : 7 préfixes ajoutés (SW-, PRT-, UPS-, IDS-, NVR-, SPO-, CLIM-) ;
- **Notes Config** chapitres 11 (IDS), 12 (CCTV), 13 (Pointage) ;
- **Sites** : descriptions mises à jour (24U / 18U) ; **Architecture cible** réécrite
  en 3 paragraphes (mention des switches, impression, CCTV, pointage, IDS, énergie) ;
- **Révision 1.2** (21/09/2026) + version du document 1.2 ; modèles nettoyés
  (« HPE Aruba Aruba 6000… » → « HPE Aruba 6000… », « WatchGuard WatchGuard
  Dimension » → « WatchGuard Dimension »).

---

## 5. Résultat de l'export final

`python3 tools/audit_export.py` → **247 vérifications, 0 case vide inattendue.**

Feuille par feuille :

- **LLD / Governance / Contenu / 1 / 14** : complètes (3 révisions + 1.2,
  approbateurs/réviseurs, 6 flux) ;
- **2** : site (nom, adresse, type, pays, 120 utilisateurs), FAI cumulé
  100+50+300 Mbps, infrastructure existante, 8 dispositifs + renvoi « + 11
  autres modèles — voir 3.1 » ;
- **3** : architecture en 3 paragraphes + 3.1 avec les 19 modèles (quantités) et
  9 éléments hors baie (licences, DAC, SFP, FAI 5G) avec remarques/statuts ;
- **4** : matrice remplie de bout en bout — WAN des 3 FAI, extrémités S2S + VIP,
  2 tunnels VPN, 2 firewalls distincts, NAT, 9 alias, 4 profils, VLANs site A
  **et** site B (avec IP/masque), mgmt/cluster, 3 switches, serveur + 4 ports,
  NAS + 3 ports, 8 VM, 2 AP, 4 imprimantes, 2 UPS, 2 IDS, NVR, pointeuse, clime,
  registre 27 VLANs, nomenclature 16 lignes ;
- **5** : 3 FAI × 17 colonnes remplies + 5.2 câblage (CPE + liaison) ;
- **6** : extrémités complètes (nomenclature, SN, firmware, adressage, HA,
  VIP **A et B**, admin IP + masques, commentaires), Admin Security (2 comptes),
  WAN 1/2/3, LAN (routage, 27 VLANs routés), 6.2 câblage par extrémité ;
- **7** : 4 équipements, 27 interfaces VLAN, 4 règles/NAT, note Config ;
- **8 → 8.5** : zones distinctes (INFRA, LAN Site B, LAN Site A, AP Site A,
  AP Site B), plans de ports, VLANs de zone, note Config ;
- **9/10/11/12/13** : équipements + 8 VM + 2 volumes + 3 caméras — plus aucun
  « Aucun équipement de cette catégorie » ;
- **15** : 38 câbles, toutes colonnes remplies (dont Rack B désormais correct) ;
- **15.1** : élévations RACK-A (24U, U1-U24 continu) et RACK-B (18U, U1-U15 continu).

### Cases volontairement vides (emplacements de réserve du template)

Ce sont des lignes « supplémentaires » du template, au-delà de l'existant réel :
FTTH 4+ (feuille 5), VPN S2S 3-4, Switch 4-6, points d'accès 3-6 (r123-126),
ports 5-7 du serveur / port 4 du SAN, lignes de liaison secondaires 5.2/6.2
(WAN 3-4). Elles correspondent à des **emplacements libres** : elles se
rempliront automatiquement dès qu'un device ou une donnée sera saisi.

---

## 6. Outils de vérification réutilisables

| Fichier | Rôle |
|---|---|
| `tools/run_export.mjs` | Exécute le code d'export réel de `app.js` sur un état JSON → `.xlsx` |
| `tools/compare_xlsx.py` | Comparaison cellule par cellule de deux classeurs |
| `tools/audit_export.py` | Audit des 247 cases attendues + trous d'élévations |
| `tools/enrich_demo.py` | Enrichissement de la démo (devices, VLANs, FAI, VMs, câbles…) |

Pour re-vérifier : `node tools/run_export.mjs demo/demo-state.json tools/export.xlsx && python3 tools/audit_export.py tools/export.xlsx`.
