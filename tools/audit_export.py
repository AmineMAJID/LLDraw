#!/usr/bin/env python3
"""Audit du classeur exporté : liste les cellules vides dans les zones de
données de chaque feuille, pour vérifier qu'aucune info attendue ne manque.
Usage : python3 audit_export.py [export.xlsx]"""
import sys, openpyxl

path = sys.argv[1] if len(sys.argv) > 1 else 'tools/export.xlsx'
wb = openpyxl.load_workbook(path, data_only=True)

def get(name, ref):
    return wb[name][ref].value

def rowvals(name, r, cols):
    return {c: get(name, f'{c}{r}') for c in cols}

checks = []

def check(sheet, ref, label, expect_nonempty=True):
    v = get(sheet, ref)
    ok = (v is not None and str(v).strip() != '') if expect_nonempty else True
    checks.append((sheet, ref, label, v, ok))

# ---------- LLD ----------
for ref, lbl in [('A1','label Nom de site'), ('E1','projet (client)'), ('A3','label Auteur'),
                 ('E3','auteur'), ('A4','label Version'), ('E4','version')]:
    check('LLD', ref, lbl)

# ---------- Governance ----------
check('Governance', 'A5', 'révisions présentes')
check('Governance', 'B13', 'approbateur 1')

# ---------- 2 : aperçu site ----------
for ref, lbl in [('C6','nom site A'), ('E6','adresse'), ('C7','type'), ('E7','pays'),
                 ('C8','utilisateurs'), ('C9','débit FAI cumulé'), ('C10','commentaire FAI'),
                 ('B16','existant (texte)'), ('B17','existant (texte 2)'),
                 ('D51','FAI opérateur'), ('B52','dispositif 1'), ('D52','qté 1'),
                 ('B58','dispositif 7'), ('D58','qté 7')]:
    check('2', ref, lbl)

# ---------- 3 : architecture ----------
for ref, lbl in [('A2','architecture (texte)'), ('A3','architecture (texte 2)'),
                 ('B41','équip. 1 modèle'), ('D41','qté'), ('B41','3.1 modèle 1')]:
    check('3', ref, lbl)

# ---------- 4 : matrice ----------
rows4 = [('D6','FTTH1 IP'),('E6','FTTH1 Mask'),('F6','FTTH1 GW'),('G6','FTTH1 DNS'),
         ('D7','FTTH2 IP'),('C9','Interco EP A nom'),('D9','EP A IP'),('C10','EP B nom'),('D10','EP B IP'),('D11','VIP A'),
         ('C15','VPN 1 nom'),('D15','VPN 1 peer'),('C16','VPN 2 nom'),('D16','VPN 2 peer'),
         ('C19','FW1 nom'),('D19','FW1 IP'),('C20','FW2 nom'),('D20','FW2 IP'),
         ('C21','NAT nom'),('D21','NAT IP'),
         ('C24','Alias 1'),('D24','Alias 1 val'),('C30','Alias 7'),('D30','Alias 7 val'),('C32','Alias 9'),('D32','Alias 9 val'),
         ('C34','VPN SSL users'),('C35','AppControl'),('C36','WebBlocker'),('C37','HTTP Proxy'),
         ('C38','VLAN DMZ A'),('D38','DMZ A IP'),('E38','DMZ A Mask'),
         ('C44','VLAN Printers A'),('C47','VLAN SPO A'),('C48','VLAN VOIP A'),('C49','VLAN iDRAC A'),
         ('C51','VLAN DMZ B'),('D51','DMZ B IP'),('C55','VLAN Users B'),('C62','VLAN iDRAC B'),
         ('C64','Master mgmt'),('C65','Slave mgmt'),('C66','Cluster A'),('C68','Cluster B'),
         ('D70','Switch 1 IP'),('D71','Switch 2 IP'),('D72','Switch 3 IP'),
         ('C76','Sw1 VLAN 1'),('C86','Sw1 VLAN 11'),('C88','Sw2 VLAN 1'),('C99','Sw2 VLAN 12'),
         ('C100','Serveur 1 nom'),('D100','IP'),('C101','Port 1'),('D101','IP'),('C104','Port 4'),('D104','IP'),
         ('C108','Stockage nom'),('D108','IP'),('C109','Port 1'),('C111','Port 3'),('D111','IP'),
         ('C113','VM BI1'),('D113','IP'),('C114','VM BC1'),('C116','VM WEB1'),('C117','VM BI2'),
         ('C118','VM BC2'),('C119','VM AD2'),('C120','VM WEB2'),
         ('C121','AP 1'),('D121','IP'),('C122','AP 2'),('D122','IP'),
         ('C127','Printer 1'),('D127','IP'),('C128','Printer 2'),('D128','IP'),
         ('C129','Printer 3'),('D129','IP'),('C130','Printer 4'),('D130','IP'),
         ('C131','UPS 1'),('D131','IP'),('C132','UPS 2'),('D132','IP'),
         ('C133','IDS 1'),('D133','IP'),('C134','IDS 2'),('D134','IP'),
         ('C135','NVR'),('D135','IP'),('C136','SPO'),('D136','IP'),('C137','Clime'),('D137','IP'),
         ('B143','VLAN registre 1'),('C149','VLAN registre 7'),('B156','VLAN registre 14'),
         ('B171','Nomenclature titre'),('B173','Nomen 1'),('B188','Nomen 16')]
for ref, lbl in rows4: check('4', ref, lbl)

# ---------- 5 : FAI ----------
for i, r in enumerate((35, 36, 37), 1):
    for col, lbl in [('C','opérateur'),('D','débit'),('E','LAN IP'),('F','LAN Mask'),
                     ('G','LAN GW'),('H','LAN DNS'),('I','IPv6'),('J','DHCP'),
                     ('K','PF règle'),('L','PF port WAN'),('M','PF port LAN'),('N','PF client'),
                     ('O','PF protocole'),('P','DMZ'),('Q','Firewall'),('R','WLAN statut'),
                     ('S','SSID'),('T','commentaire')]:
        check('5', f'{col}{r}', f'FAI {i} — {lbl}')
for ref, lbl in [('C46','FAI1 CPE'),('D46','FAI1 liaison'),('C48','FAI2 CPE'),('D48','FAI2 liaison'),
                 ('C50','FAI3 CPE'),('D50','FAI3 liaison')]:
    check('5', ref, lbl)

# ---------- 6 : interco ----------
for ref, lbl in [('B30','EP A'),('C30','nomenclature A'),('D30','SN'),('E30','firmware'),
                 ('F30','WAN IP'),('G30','Mask'),('H30','GW'),('I30','DNS'),
                 ('J30','HA'),('K30','Group'),('L30','Rôle'),('M30','Resume'),('N30','VIP A'),
                 ('O30','Admin IP'),('P30','Mask'),('Q30','Commentaire FAI'),
                 ('B31','EP B'),('C31','nomenclature B'),('N31','VIP B'),('P31','Mask B'),
                 ('B37','Admin 1'),('B38','Admin 2'),
                 ('B45','WAN 1'),('F45','IP'),('K45','Upload'),
                 ('B46','WAN 2'),('F46','IP'),('B47','WAN 3'),
                 ('C52','Routage'),('D52','VLANs routés'),('B53','LAN'),
                 ('C62','Câblage EP A'),('E62','liaison'),('E63','secours'),
                 ('C67','Câblage EP B'),('E67','liaison'),('E66','LAN A'),('E71','LAN B')]:
    check('6', ref, lbl)

# ---------- 7 ----------
for ref, lbl in [('A7','FW équip.'), ('A16','VLAN 1')]:
    check('7', ref, lbl)
check('7', 'A35', 'règle NAT 1', True)

# ---------- 8.x : au moins un équipement par feuille ----------
for sh in ('8','8.1','8.2','8.3','8.4','8.5'):
    check(sh, 'A7', 'premier équipement de la zone')

# ---------- 9/10/11/12/13 ----------
for ref, lbl in [('A7','serveur 1'), ('A16','VM 1'), ('A21',None)]:
    if lbl: check('9', ref, lbl)
for ref, lbl in [('A7','NAS-01'), ('A14','volume 1')]:
    check('10', ref, lbl)
for sh in ('11','12','13'):
    check(sh, 'A7', 'équipement')
check('12', 'A13', 'caméra 1')

# ---------- 15 : câblage ----------
ws15 = wb['15']
n_cab = 0
r = 7
while ws15[f'A{r}'].value:
    n_cab += 1
    for col in ('D','E','F','G','H','I'):
        v = ws15[f'{col}{r}'].value
        if v is None or str(v).strip() == '':
            checks.append(('15', f'{col}{r}', f'câble ligne {r} col {col}', v, False))
    r += 1
checks.append(('15', f'A{r-1}', f'nb câbles exportés = {n_cab}', ws15[f'A{r-1}'].value, n_cab >= 30))

# ---------- 15.1 : élévations complètes (pas de trou dans les U) ----------
import re
ws151 = wb['15.1']
cur = None
holes = []
for row in ws151.iter_rows(min_col=1, max_col=1):
    a = row[0].value
    if not a: continue
    m = re.match(r'U(\d+)(?:–U(\d+))?$', str(a))
    if m:
        u0 = int(m.group(1)); u1 = int(m.group(2) or m.group(1))
        if cur is not None and u0 != cur + 1 and not (u0 == 1):
            holes.append((a, cur))
        cur = u1
checks.append(('15.1', 'A*', 'élévations sans trou d\'U', holes or 'continu', not holes))

# ---------- Rapport ----------
bad = [c for c in checks if not c[4]]
print(f"Vérifications : {len(checks)} — vides inattendues : {len(bad)}")
for sheet, ref, lbl, v, ok in checks:
    mark = 'OK ' if ok else 'VIDE'
    val = '' if v is None else str(v)[:70]
    print(f"[{mark}] {sheet:6} {ref:5} {lbl:28} {val}")
if '--quiet' not in sys.argv and not bad:
    print("\n>>> Toutes les cases attendues sont remplies.")
