#!/usr/bin/env python3
"""Enrichit demo/demo-state.json : ajoute les devices manquants (switch déjà là,
UPS/IDS/NVR/SPO/PRT en double site, clime avec IP), corrige les câbles cassés
(portIds renommés), complète le registre VLAN (VOIP + site B), les alias (x9),
les VMs (x8), les FAI (PF détaillé, IPv6, WLAN), les zones de switching, la
nomenclature, les notes par chapitre, les descriptions de sites et la révision
1.2. Bump demoVer -> 6."""
import json, copy

P = 'demo/demo-state.json'
s = json.load(open(P, encoding="utf-8"))
ws = s['workspaces'][0]
L = ws['lld']

def inst(id, name, slot, cat, brand, model, *, serial='', ipMgmt='', watts=0, weight=0,
         warranty='', wend='', ports=None, zone=''):
    return {
        'id': id, 'name': name, 'slot': slot, 'sizeU': 1, 'cat': cat, 'zone': zone,
        'photo': '', 'brand': brand, 'model': model, 'partRef': '', 'serial': serial,
        'ipMgmt': ipMgmt, 'vlan': '', 'watts': watts, 'weightKg': weight,
        'warranty': warranty, 'warrantyEnd': wend,
        'ports': ports or [],
    }
def port(pid, name, label, vlan='', ip='', xp=14.0, yp=62, size=0.7):
    return {'id': pid, 'name': name, 'label': label, 'xPct': xp, 'yPct': yp,
            'size': size, 'ip': ip, 'vlan': vlan}

rackA = next(r for r in ws['racks'] if r['id'] == 'rack-a')
rackB = next(r for r in ws['racks'] if r['id'] == 'rack-b')

# 1) RACK-A passe de 18U à 24U (place pour IDS/UPS/NVR/SPO/imprimantes siège)
rackA['sizeU'] = 24

def find_inst(iid):
    for r in ws['racks']:
        for i in r['instances']:
            if i['id'] == iid: return i
    raise KeyError(iid)

# 2) Déplacements siège + IP cohérentes (10.10 = siège, 10.11 = agence)
ids01 = find_inst('inst-ids-01'); ids01['slot'] = 18; ids01['ipMgmt'] = '10.10.99.51'
ids01['model'] = 'Dimension + TDR'                      # évite « WatchGuard WatchGuard »
rackA['instances'].append(ids01); rackB['instances'].remove(ids01)
ups01 = find_inst('inst-ups-01'); ups01['slot'] = 19; ups01['ipMgmt'] = '10.10.99.81'
rackA['instances'].append(ups01); rackB['instances'].remove(ups01)
nvr01 = find_inst('inst-nvr-01'); nvr01['slot'] = 20; nvr01['ipMgmt'] = '10.10.99.61'
rackA['instances'].append(nvr01); rackB['instances'].remove(nvr01)
spo01 = find_inst('inst-spo-01'); spo01['slot'] = 21; spo01['ipMgmt'] = '10.10.99.71'
rackA['instances'].append(spo01); rackB['instances'].remove(spo01)
prt01 = find_inst('inst-prt-01'); prt01['slot'] = 22; prt01['ipMgmt'] = '10.10.70.11'
prt01['name'] = 'PRT-01'; prt01['model'] = 'LaserJet Enterprise M527'
rackA['instances'].append(prt01); rackB['instances'].remove(prt01)
prt02 = find_inst('inst-prt-02'); prt02['slot'] = 23; prt02['ipMgmt'] = '10.10.70.12'
prt02['model'] = 'LaserJet M428'
rackA['instances'].append(prt02); rackB['instances'].remove(prt02)
clim01 = find_inst('inst-clim-01'); clim01['slot'] = 14   # reste RACK-B, remonte en U15
clim01['ipMgmt'] = '10.11.99.72'

# 3) Nouveaux devices à l'agence (2e exemplaire de chaque + 2 imprimantes)
rackB['instances'] += [
    inst('inst-ids-02', 'IDS-02', 10, 'ids', 'WatchGuard', 'Dimension + TDR',
         serial='WG-DIM-8842', ipMgmt='10.11.99.51', watts=60, weight=3,
         warranty='CT-2026-88', wend='2028-01-15',
         ports=[port('p-ids-02-1', '1', 'VLAN 99', 'VLAN 99'),
                port('p-ids-02-2', '2', 'VLAN 91', 'VLAN 91', xp=86)]),
    inst('inst-prt-03', 'PRT-03', 11, 'other', 'HP', 'LaserJet M428',
         serial='HP-M428-0203', ipMgmt='10.11.70.11', watts=80, weight=12,
         warranty='CT-2026-91', wend='2027-09-30',
         ports=[port('p-prt-03-1', '1', 'VLAN 70', 'VLAN 70')]),
    inst('inst-prt-04', 'PRT-04', 12, 'other', 'HP', 'LaserJet Enterprise M527',
         serial='HP-M527-0204', ipMgmt='10.11.70.12', watts=120, weight=21,
         warranty='CT-2026-91', wend='2027-09-30',
         ports=[port('p-prt-04-1', '1', 'VLAN 70', 'VLAN 70')]),
    inst('inst-ups-02', 'UPS-02', 13, 'ups', 'APC', 'Smart-UPS SRT 3000VA (SRT3000XLI)',
         serial='APC-SRT-9932', ipMgmt='10.11.99.81', watts=0, weight=28,
         warranty='CT-2026-88', wend='2028-01-15',
         ports=[port('p-ups-02-1', '1', 'VLAN 31', 'VLAN 31')]),
]

# 4) Modèles : supprime les doublons marque/modèle
swi = find_inst('inst-sw-infra'); swi['model'] = '6000 12G (R8N89A)'
sw1 = find_inst('inst-sw-01');    sw1['model'] = '6100 24G PoE (JL677A)'
sw2 = find_inst('inst-sw-02');    sw2['model'] = '6100 12G (JL678A)'

# 5) Câbles : re-pointe les ports renommés + ajoute les câbles des nouveaux devices
def cab(name, dom, color, a, b):
    return {'name': name, 'domain': dom, 'color': color,
            'a': {'rackId': a[0], 'instId': a[1], 'portId': a[2]},
            'b': {'rackId': b[0], 'instId': b[1], 'portId': b[2]}}
RA, RB = 'rack-a', 'rack-b'
fix = {
    'CAB-007 · SRV-DELL-01 iDRAC → BR-A-01/6':        ('CAB-007 · SRV-DELL-01 iDRAC → BR-A-01/6', ('p-srv-idrac',)),
    'CAB-008 · NAS-01 LAN1 → BR-A-01/7':              ('CAB-008 · NAS-01 MGMT → BR-A-01/7', ('p-nas-mgmt',)),
    'CAB-017 · SRV-DELL-01 ETH0 → BR-A-02/8':         ('CAB-017 · SRV-DELL-01 LAN1 → BR-A-02/8', ('p-srv-lan1',)),
    'CAB-018 · SRV-DELL-01 ETH1 → BR-A-02/9':         ('CAB-018 · SRV-DELL-01 LAN2 → BR-A-02/9', ('p-srv-lan2',)),
    'CAB-019 · NAS-01 LAN2 → BR-A-02/10':             ('CAB-019 · NAS-01 ISCSI1 → BR-A-02/10', ('p-nas-iscsi1',)),
}
for c in ws['cables']:
    if c['name'] in fix:
        newname, (pid,) = fix[c['name']]
        c['name'] = newname; c['a']['portId'] = pid
ws['cables'] += [
    cab('CAB-020 · IDS-01 → BR-A-01/9', 'mgmt', '#a78bfa', (RA, 'inst-ids-01', 'p-ids-01-1'), (RA, 'inst-pp-a1', 'p-inst-pp-a1-9')),
    cab('CAB-021 · IDS-01 → BR-A-02/11', 'ids', '#f97316', (RA, 'inst-ids-01', 'p-ids-01-2'), (RA, 'inst-pp-a2', 'p-inst-pp-a2-11')),
    cab('CAB-022 · UPS-01 → BR-A-01/10', 'mgmt', '#a78bfa', (RA, 'inst-ups-01', 'p-ups-01-1'), (RA, 'inst-pp-a1', 'p-inst-pp-a1-10')),
    cab('CAB-023 · NVR-01 → BR-A-01/11', 'mgmt', '#a78bfa', (RA, 'inst-nvr-01', 'p-nvr-01-1'), (RA, 'inst-pp-a1', 'p-inst-pp-a1-11')),
    cab('CAB-024 · NVR-01 → BR-A-02/12', 'cctv', '#22d3ee', (RA, 'inst-nvr-01', 'p-nvr-01-2'), (RA, 'inst-pp-a2', 'p-inst-pp-a2-12')),
    cab('CAB-025 · SPO-01 → BR-A-01/12', 'mgmt', '#a78bfa', (RA, 'inst-spo-01', 'p-spo-01-1'), (RA, 'inst-pp-a1', 'p-inst-pp-a1-12')),
    cab('CAB-026 · SW-01 → BR-A-01/13', 'lan', '#60a5fa', (RA, 'inst-sw-01', 'p-sw-01-8'), (RA, 'inst-pp-a1', 'p-inst-pp-a1-13')),
    cab('CAB-027 · BR-A-03/14 → FW-01 eth3', 'lan', '#e11d48', (RA, 'inst-pp-a3', 'p-inst-pp-a3-14'), (RA, 'inst-fw-a', 'p-inst-fw-a-eth3')),
    cab('CAB-028 · SW-INFRA → BR-A-02/13', 'lan', '#60a5fa', (RA, 'inst-sw-infra', 'p-sw-infra-1'), (RA, 'inst-pp-a2', 'p-inst-pp-a2-13')),
    cab('CAB-109 · IDS-02 → BR-B-01/5', 'mgmt', '#a78bfa', (RB, 'inst-ids-02', 'p-ids-02-1'), (RB, 'inst-pp-b1', 'p-inst-pp-b1-5')),
    cab('CAB-110 · UPS-02 → BR-B-01/6', 'mgmt', '#a78bfa', (RB, 'inst-ups-02', 'p-ups-02-1'), (RB, 'inst-pp-b1', 'p-inst-pp-b1-6')),
    cab('CAB-111 · SW-02 → BR-B-02/3', 'lan', '#60a5fa', (RB, 'inst-sw-02', 'p-sw-02-6'), (RB, 'inst-pp-b2', 'p-inst-pp-b2-3')),
]

# 6) Registre VLAN : site de rattachement + VOIP + bloc agence (123-134)
SA, SB = 'Siège — Casablanca', 'Agence — Rabat'
for v in L['vlans']:
    v.setdefault('site', SA); v['site'] = SA
L['vlans'] += [
    {'vid': '111', 'name': 'vVOIP', 'site': SA, 'subnet': '10.10.111.0/24', 'gw': '10.10.111.1', 'purpose': 'Téléphonie IP (TOIP)'},
    {'vid': '123', 'name': 'vDMZ Agence', 'site': SB, 'subnet': '10.11.11.0/24', 'gw': '10.11.11.1', 'purpose': 'DMZ du site de Rabat'},
    {'vid': '124', 'name': 'vStorage Agence', 'site': SB, 'subnet': '10.11.30.0/24', 'gw': '10.11.30.1', 'purpose': 'Stockage NAS-02 et réplication'},
    {'vid': '125', 'name': 'vUPS Agence', 'site': SB, 'subnet': '10.11.31.0/24', 'gw': '10.11.31.1', 'purpose': 'Onduleurs (UPS-02, PDU)'},
    {'vid': '126', 'name': 'vMgmt Agence', 'site': SB, 'subnet': '10.11.10.0/24', 'gw': '10.11.10.1', 'purpose': 'Management Nutanix agence'},
    {'vid': '127', 'name': 'vUsers Agence', 'site': SB, 'subnet': '10.11.40.0/24', 'gw': '10.11.40.1', 'purpose': 'Utilisateurs filaire et WiFi agence'},
    {'vid': '128', 'name': 'vGuests Agence', 'site': SB, 'subnet': '10.11.60.0/24', 'gw': '10.11.60.1', 'purpose': 'Invités WiFi isolés agence'},
    {'vid': '129', 'name': 'vPrinters Agence', 'site': SB, 'subnet': '10.11.70.0/24', 'gw': '10.11.70.1', 'purpose': 'Imprimantes réseau agence'},
    {'vid': '130', 'name': 'vIDS Agence', 'site': SB, 'subnet': '10.11.81.0/24', 'gw': '10.11.81.1', 'purpose': "Détection d'intrusion agence"},
    {'vid': '131', 'name': 'vCCTV Agence', 'site': SB, 'subnet': '10.11.91.0/24', 'gw': '10.11.91.1', 'purpose': 'Caméras de l’agence'},
    {'vid': '132', 'name': 'vSPO Agence', 'site': SB, 'subnet': '10.11.101.0/24', 'gw': '10.11.101.1', 'purpose': 'Pointeuse agence'},
    {'vid': '133', 'name': 'vVOIP Agence', 'site': SB, 'subnet': '10.11.111.0/24', 'gw': '10.11.111.1', 'purpose': 'Téléphonie IP agence'},
    {'vid': '134', 'name': 'viDRAC Agence', 'site': SB, 'subnet': '10.11.121.0/24', 'gw': '10.11.121.1', 'purpose': 'Management hors-bande agence'},
]

# 7) Alias firewall : 9 lignes (3 paires de sites + secours)
L['aliases'] += [
    {'name': 'LAN3', 'value': '10.10.60.0/24 (invités siège)'},
    {'name': 'EXTERNAL3', 'value': 'NAT opérateur 5G (Orange)'},
    {'name': 'SSL3', 'value': 'pool VPN SSL secours — 10.10.61.0/24'},
]

# 8) VMs : 8 lignes (BI ×2, VEEAM/BC ×2, AD ×2, WEB ×2)
L['vms'] += [
    {'name': 'SRV-BI-01', 'role': 'Décisionnel — SQL + SSRS', 'host': 'NX-02', 'ip': '10.10.20.21 — VLAN 20'},
    {'name': 'SRV-BI-02', 'role': 'Réplique reporting (tests)', 'host': 'NX-03', 'ip': '10.10.20.22 — VLAN 20'},
    {'name': 'SRV-BC-02', 'role': "Continuité — réplique Veeam (agence)", 'host': 'NX-02', 'ip': '10.10.21.11 — VLAN 21'},
    {'name': 'SRV-WEB-02', 'role': 'Reverse-proxy secours', 'host': 'NX-02', 'ip': '10.10.20.13 — VLAN 20'},
]

# 9) FAI : redirection de ports détaillée (L-O), IPv6, WLAN statut/SSID
f1, f2, f3 = L['fais']
f1['ipv6'] = '2a01:cb08:9000:100::/56 (préfixe délégué)'
f1.update(pfPortWan='TCP 443', pfPortLan='443', pfClient='10.10.20.11', pfProto='TCP',
          wlanStat='Activé — 802.1X', wlan='corp-secure · corp-guest')
f2.update(lanGw='10.11.40.254', lanDns='10.11.10.11 (DC agence)',
          ipv6='2a01:cb20:5000:200::/56 (préfixe délégué)',
          pf='UDP 4500 → RTR-02 (VPN)', pfPortWan='UDP 4500', pfPortLan='4500',
          pfClient='10.11.99.12', pfProto='UDP',
          dmz='— (VPN uniquement)',
          wlanStat='Activé — WPA3', wlan='corp-agence')
f3.update(lanIp='192.168.9.2 (bride 5G)', lanMask='255.255.255.0',
          lanGw='192.168.9.1', lanDns='— (DNS opérateur)',
          ipv6='— (SLAAC opérateur)',
          pf='Sortie seule — aucune publication', pfPortWan='—', pfPortLan='—',
          pfClient='—', pfProto='—', dmz='— (sortie seule)',
          wlanStat='—', wlan='—')

# 10 bis) Instances triées par étage (l'ordre du tableau = ordre d'affichage)
for r in ws['racks']:
    r['instances'].sort(key=lambda i: i['slot'])

# 10) Zones de switching : VLANs complets (ordres ch. 4 / ch. 8.x)
zv = {z['name']: z for z in L['swZones']}
zv['INFRA']['vlans'] = '11,21,31,41,51,61,71,81,91,101,111,121'
zv['LAN Site B']['vlans'] = '123,124,125,126,127,128,129,130,131,132,133,134,135'
zv['LAN Site A']['vlans'] = '10,20,21,30,40,50,60,99'
zv['Aruba AP Site A']['vlans'] = '40,60'
zv['Aruba AP Site B']['vlans'] = '127,128'

# 11) Nomenclature : préfixes des nouveaux devices
L['nomen'] += [
    {'type': "Switch d'accès", 'prefix': 'SW-', 'example': 'SW-01', 'rule': 'SW-<SITE/ROLE>-NN.'},
    {'type': 'Imprimante réseau', 'prefix': 'PRT-', 'example': 'PRT-01', 'rule': 'NN sur 2 chiffres, par site (01-02 siège, 03-04 agence).'},
    {'type': 'Onduleur', 'prefix': 'UPS-', 'example': 'UPS-01', 'rule': 'NN sur 2 chiffres, un par baie.'},
    {'type': 'Intrusion (IDS)', 'prefix': 'IDS-', 'example': 'IDS-01', 'rule': 'NN sur 2 chiffres, un par site.'},
    {'type': 'Enregistreur CCTV', 'prefix': 'NVR-', 'example': 'NVR-01', 'rule': 'NN sur 2 chiffres, au siège.'},
    {'type': 'Pointage (SPO)', 'prefix': 'SPO-', 'example': 'SPO-01', 'rule': 'NN sur 2 chiffres, un par site.'},
    {'type': 'Climatisation de précision', 'prefix': 'CLIM-', 'example': 'CLIM-01', 'rule': 'NN sur 2 chiffres, une par salle technique.'},
]

# 12) Notes de configuration des chapitres 11/12/13 (vides jusqu'ici)
L['catNotes']['ids'] = ("Sondes WatchGuard Dimension (TDR) : analyse réseau (NDR) des flux inter-VLAN, "
                        "miroir de ports configuré sur SW-INFRA (siège) et SW-02 (agence). Alertes relayées vers Zabbix (VLAN 99).")
L['catNotes']['cctv'] = ("NVR Hikvision 32 canaux au siège (VLAN 91) : 3 caméras (accès principal, salle technique agence, "
                         "réception agence). Rétention 30 jours, flux H.265, visualisation restreinte au poste de supervision.")
L['catNotes']['pointage'] = ("Pointeuse ZKTeco SpeedFace (reconnaissance faciale + badge) reliée au VLAN 101 ; "
                             "synchronisation du log d'activité vers l'ERP toutes les 15 minutes.")

# 13) Descriptions de sites cohérentes avec les baies (24U / 18U)
for site in ws['sites']:
    if site['id'] == 'site-a':
        site['desc'] = ("Baie principale RACK-A (24U) : hyperconvergence Nutanix (3 nœuds), serveur physique Dell R740, "
                        "NAS Synology, pare-feu WatchGuard, routeur SD-WAN Peplink, switches d'accès Aruba, borne WiFi, "
                        "capteur AKCP, IDS, NVR, pointeuse, onduleur et imprimantes réseau. Refroidissement par façade, double alimentation.")
    else:
        site['desc'] = ("Baie secondaire RACK-B (18U) : pare-feu WatchGuard, routeur SD-WAN Peplink, switch d'accès Aruba, "
                        "NAS de réplication, borne WiFi, capteur environnemental AKCP, IDS, imprimantes, onduleur et "
                        "climatisation de précision. Site de secours relié au siège par tunnel SD-WAN SpeedFusion.")

# 14) Architecture cible : mention des nouveaux équipements (3 paragraphes)
L['architecture'] = (
    "Le siège (RACK-A, 24U) concentre la production : le cluster Nutanix NX-01 à NX-03 porte les machines virtuelles "
    "(ERP, AD/DNS, fichiers, Veeam, BI, reverse-proxy), le Dell R740 héberge la supervision, le NAS-01 sert de cible de "
    "sauvegarde. Le switch d'accès SW-INFRA (Aruba 6000) et SW-01 (Aruba 6100 PoE) desservent le management (VLAN 99), "
    "les utilisateurs, l'impression (VLAN 70), la vidéosurveillance (NVR-01, VLAN 91), le pointage (SPO-01, VLAN 101) et "
    "l'IDS (VLAN 81) ; l'onduleur APC UPS-01 supervise l'énergie (VLAN 31).\n"
    "La baie RACK-B à Rabat (18U) héberge le second pare-feu, le routeur SD-WAN (SW-02), le NAS de réplication, l'IDS-02, "
    "les imprimantes de l'agence et l'onduleur UPS-02.\n"
    "Chaque site dispose d'un accès FTTO dédié (plus une 5G de secours au siège) ; les deux sites sont reliés par un "
    "tunnel SD-WAN SpeedFusion (Peplink). Le WiFi Aruba est déployé en mode contrôleur virtuel instant, un SSID par "
    "population (corporate VLAN 40, invités isolés). La supervision Zabbix collecte les métriques des équipements via le "
    "VLAN 99, y compris la température et l'hygrométrie des baies (sondes AKCP).")

# 15) Révision 1.2 + version du document
L['version'] = '1.2'
L['revs'].append({'rev': '1.2', 'date': '2026-09-21', 'author': 'Amine MJID',
                  'note': "+ Complétude du dossier : imprimantes, UPS, IDS, NVR, pointeuse, clime (site A et B)\n"
                          "+ Registre VLAN agence (123-134) et alias firewall 3\n"
                          "+ Redirection de ports FAI détaillée (ch. 5) et nomenclature étendue"})

s['demoVer'] = 6
json.dump(s, open(P, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('demo-state enrichi — demoVer', s['demoVer'])
print('instances RACK-A:', len(rackA['instances']), '| RACK-B:', len(rackB['instances']))
print('cables:', len(ws['cables']), '| vlans:', len(L['vlans']), '| vms:', len(L['vms']),
      '| aliases:', len(L['aliases']), '| nomen:', len(L['nomen']))
