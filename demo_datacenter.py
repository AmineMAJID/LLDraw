# -*- coding: utf-8 -*-
"""
Construit le workspace de démonstration « Datacenter Siège » pour LLDraw.

- 2 baies : RACK-A 18U (siège Casablanca) et RACK-B 16U (agence Rabat)
- Équipements : 3 Nutanix, 1 Dell R740, 2 NAS Synology, 2 WatchGuard,
  2 Peplink, 2 Aruba, 2 AKCP, 5 panneaux de brassage, 3 passe-câbles à brosse
- Faces avant générées avec PIL (photos personnalisées par équipement),
  câblage complet (26 cordons), topologie logique, sites, flux et dossier
  LLD rempli (nomenclature, VLANs, FAI, interco, notes par chapitre).

Le workspace existant de l'utilisateur est conservé ; ce script AJOUTE
(ou remplace s'il existe déjà) le workspace « demo-dc ».
"""

import base64
import io
import json
import os
import random
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

# Racine du projet = dossier contenant ce script (portable Windows / Linux / macOS)
ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(ROOT, 'data', 'state.json')
random.seed(42)

DEMO_WS_ID = 'demo-dc'


# ------------------------------------------------------------- polices --
def _find_font(bold):
    """Cherche une police TTF disponible sur le système (Linux, Windows, macOS)."""
    names = (['DejaVuSans-Bold.ttf', 'arialbd.ttf', 'Arial Bold.ttf',
              'calibrib.ttf', 'Consolas-Bold.ttf']
             if bold else
             ['DejaVuSans.ttf', 'arial.ttf', 'Arial.ttf',
              'calibri.ttf', 'Consolas.ttf'])
    windir = os.environ.get('WINDIR', r'C:\Windows')
    dirs = ['/usr/share/fonts/truetype/dejavu',
            os.path.join(windir, 'Fonts'),
            'C:/Windows/Fonts',
            '/System/Library/Fonts/Supplemental',
            '/Library/Fonts']
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.isfile(p):
                return p
    return None


_FONT_B = _find_font(True)
_FONT_R = _find_font(False)


def F(size, bold=True):
    path = _FONT_B if bold else _FONT_R
    if path:
        return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)   # Pillow récent
    except TypeError:
        return ImageFont.load_default()


def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def dataurl(im, q=88):
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=q)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- helpers --
def panel(W, H, top, bottom, border='#0f1116'):
    a, b = hx(top), hx(bottom)
    im = Image.new('RGB', (W, H), a)
    d = ImageDraw.Draw(im)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=mix(a, b, y / max(1, H - 1)))
    d.rectangle([0, 0, W - 1, H - 1], outline=hx(border))
    return im, d


def ears(d, W, H):
    d.rectangle([0, 0, 19, H - 1], fill=hx('#15171c'))
    d.rectangle([W - 20, 0, W - 1, H - 1], fill=hx('#15171c'))
    for cx in (7, W - 13):
        for cy in (8, H - 13):
            d.ellipse([cx, cy, cx + 5, cy + 5], fill=hx('#08090c'))


def jack(d, cx, cy, w=25, h=12, body='#3f434c', rim='#12141a'):
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 2, fill=hx(body), outline=hx(rim))
    d.rectangle([cx - w / 5, cy - h / 4, cx + w / 5, cy + h / 4], fill=hx(rim))


def vent(d, x0, x1, y0, y1, gap=8):
    for x in range(x0, x1, gap):
        for y in range(y0, y1, 7):
            d.ellipse([x, y, x + 2, y + 2], fill=hx('#171a20'))


def pct(x, y, W, H):
    return round(x / W * 100, 1), round(y / H * 100, 1)


# ------------------------------------------------------------- face builder --
# Chaque builder retourne (image PIL, ports gabarit) — ports sans id ni ip.
# 1U = 600x68, 2U = 600x135 (ratio aligné sur le rendu en baie : 292x33 / 292x66)

def face_nutanix(name):
    W, H = 600, 68
    im, d = panel(W, H, '#343941', '#25282e')
    ears(d, W, H)
    for i in range(4):
        x = 26 + i * 40
        d.rounded_rectangle([x, 12, x + 34, 56], 2, fill=hx('#3d434d'), outline=hx('#1a1c21'))
        d.line([(x + 5, 20), (x + 29, 20)], fill=hx('#22252b'), width=2)
        d.ellipse([x + 26, 46, x + 31, 51], fill=hx('#22c55e'))
    d.text((200, 8), 'NUTANIX NX-3155-G6', font=F(10), fill=hx('#e8ebf1'))
    d.text((200, 24), name, font=F(14), fill=hx('#ffffff'))
    vent(d, 205, 385, 44, 62)
    for i in range(3):
        jack(d, 448 + 36 * i, 24)
        jack(d, 448 + 36 * i, 48)
    ports = [
        ('MGMT', 'MGMT (CVM)', 448, 24),
        ('10G-1', '10GbE 1 (VM)', 484, 24),
        ('10G-2', '10GbE 2 (stockage)', 520, 24),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_dell(name):
    W, H = 600, 135
    im, d = panel(W, H, '#343941', '#282c33')
    ears(d, W, H)
    d.rounded_rectangle([26, 6, 574, 129], 6, fill=hx('#2e323a'), outline=hx('#191c21'))
    d.text((40, 14), 'DELL', font=F(26), fill=hx('#f3f5f8'))
    d.text((40, 48), 'PowerEdge R740', font=F(12), fill=hx('#a8aeb9'))
    d.text((40, 72), name, font=F(14), fill=hx('#ffffff'))
    d.rounded_rectangle([230, 18, 320, 54], 3, fill=hx('#0d1f33'), outline=hx('#1e2f47'))
    d.rectangle([240, 34, 310, 37], fill=hx('#3b82f6'))
    vent(d, 230, 390, 66, 122)
    for cx, lab in ((440, 'iDRAC'), (480, 'eth0'), (520, 'eth1')):
        jack(d, cx, 110)
        d.text((cx - 14, 120), lab, font=F(7), fill=hx('#8b929e'))
    ports = [
        ('iDRAC', 'iDRAC9 (mgmt)', 440, 110),
        ('eth0', 'eth0 (VLAN 20)', 480, 110),
        ('eth1', 'eth1 (VLAN 21)', 520, 110),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_nas(name):
    W, H = 600, 135
    im, d = panel(W, H, '#2a2d33', '#22252b')
    ears(d, W, H)
    d.text((28, 8), 'SYNOLOGY RS1221+', font=F(12), fill=hx('#e8ebf1'))
    d.text((28, 26), name + ' · 8× 8 To (RAID 6)', font=F(14), fill=hx('#ffffff'))
    for i in range(8):
        x = 28 + i * 68
        d.rounded_rectangle([x, 46, x + 62, 96], 2, fill=hx('#33373f'), outline=hx('#191c21'))
        d.line([(x + 6, 54), (x + 56, 54)], fill=hx('#22252b'), width=2)
        d.ellipse([x + 8, 84, x + 13, 89], fill=hx('#22c55e'))
    for cx, lab in ((400, 'LAN1'), (440, 'LAN2'), (480, 'LAN3'), (520, 'LAN4')):
        jack(d, cx, 114, w=24, h=11)
        d.text((cx - 10, 124), lab, font=F(7), fill=hx('#8b929e'))
    ports = [
        ('LAN1', 'LAN1 (mgmt)', 400, 114),
        ('LAN2', 'LAN2 (stockage)', 440, 114),
        ('LAN3', 'LAN3 (spare)', 480, 114),
        ('LAN4', 'LAN4 (spare)', 520, 114),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_peplink(name):
    W, H = 600, 68
    im, d = panel(W, H, '#28303c', '#1f252e')
    ears(d, W, H)
    d.text((28, 8), 'PEPLINK', font=F(13), fill=hx('#dfe4ec'))
    d.text((28, 26), 'Balance 20X — SD-WAN', font=F(9), fill=hx('#9aa0ab'))
    d.text((28, 44), name, font=F(13), fill=hx('#ffffff'))
    d.rounded_rectangle([190, 26, 250, 46], 2, fill=hx('#1a1d23'), outline=hx('#32363e'))
    d.text((206, 31), 'SIM 4G', font=F(7), fill=hx('#6b7280'))
    d.ellipse([400, 14, 406, 20], fill=hx('#22c55e'))
    for cx, lab in ((440, 'WAN1'), (476, 'WAN2'), (512, 'LAN1'), (548, 'LAN2')):
        jack(d, cx, 26, w=22, h=12)
        d.text((cx - 12, 38), lab, font=F(7), fill=hx('#8b929e'))
    ports = [
        ('WAN1', 'WAN1 (transit FAI)', 440, 26),
        ('WAN2', 'WAN2 (secours)', 476, 26),
        ('LAN1', 'LAN1 (cœur)', 512, 26),
        ('LAN2', 'LAN2 (spare)', 548, 26),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_aruba(name):
    W, H = 600, 68
    im, d = panel(W, H, '#f0f2f5', '#e6e9ee', border='#c9ced6')
    ears(d, W, H)
    d.text((28, 8), 'ARUBA', font=F(13), fill=hx('#3b414d'))
    d.text((28, 26), 'AP-515 — WiFi 5/6', font=F(9), fill=hx('#6b7280'))
    d.text((28, 44), name, font=F(12), fill=hx('#1f2937'))
    d.ellipse([230, 10, 370, 58], fill=hx('#dfe3e9'), outline=hx('#c3c9d2'))
    d.ellipse([255, 20, 345, 48], fill=hx('#d2d8e0'))
    d.ellipse([395, 14, 401, 20], fill=hx('#22c55e'))
    d.ellipse([395, 40, 401, 46], fill=hx('#f59e0b'))
    jack(d, 450, 34, w=24, h=12)
    jack(d, 510, 34, w=24, h=12)
    d.text((438, 48), 'ETH0', font=F(7), fill=hx('#6b7280'))
    d.text((496, 48), 'CONSOLE', font=F(7), fill=hx('#6b7280'))
    ports = [
        ('eth0', 'eth0 (PoE, trunk)', 450, 34),
        ('console', 'console (série)', 510, 34),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_akcp(name):
    W, H = 600, 68
    im, d = panel(W, H, '#272b31', '#202329')
    ears(d, W, H)
    d.text((28, 8), 'AKCP', font=F(13), fill=hx('#dfe4ec'))
    d.text((28, 26), 'sensorProbe2+ — température / hygrométrie', font=F(8), fill=hx('#9aa0ab'))
    d.text((28, 44), name, font=F(12), fill=hx('#ffffff'))
    for i, cx in enumerate((300, 336, 372, 408)):
        jack(d, cx, 30, w=18, h=10, body='#2f333b')
        d.text((cx - 4, 42), 'S%d' % (i + 1), font=F(7), fill=hx('#8b929e'))
    d.ellipse([450, 22, 456, 28], fill=hx('#22c55e'))
    d.ellipse([450, 40, 456, 46], fill=hx('#f59e0b'))
    jack(d, 540, 34, w=24, h=12)
    d.text((528, 48), 'ETH0', font=F(7), fill=hx('#8b929e'))
    ports = [
        ('S1', 'Sonde T°/H baie', 300, 30),
        ('S2', 'Sonde T°/H salle', 336, 30),
        ('S3', 'Sonde spare', 372, 30),
        ('S4', 'Sonde spare', 408, 30),
        ('eth0', 'eth0 (supervision)', 540, 34),
    ]
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_patch(name):
    W, H = 600, 68
    im, d = panel(W, H, '#1e2126', '#181b20')
    ears(d, W, H)
    d.text((28, 8), name, font=F(12), fill=hx('#e8ebf1'))
    d.text((150, 10), 'BRASSAGE CAT 6A · 24 PORTS', font=F(8), fill=hx('#9aa0ab'))
    ports = []
    for row, cy in ((0, 32), (1, 56)):
        for i in range(12):
            cx = 46 + i * 46
            jack(d, cx, cy, w=26, h=15, body='#464b55')
            n = str(row * 12 + i + 1)
            ports.append((n, 'Port ' + n, cx, cy))
    return im, [(n, l) + pct(x, y, W, H) for n, l, x, y in ports]


def face_brush(name):
    W, H = 600, 68
    im, d = panel(W, H, '#26292f', '#202329')
    ears(d, W, H)
    d.text((28, 4), name + ' · PASSE-CÂBLES À BROSSE', font=F(8), fill=hx('#8b929e'))
    d.rectangle([40, 20, 560, 62], fill=hx('#15171b'), outline=hx('#0e1013'))
    d.rectangle([40, 20, 560, 24], fill=hx('#33363d'))
    d.rectangle([40, 58, 560, 62], fill=hx('#33363d'))
    for x in range(46, 556, 4):
        top = 24 + random.randint(0, 5)
        bot = 58 - random.randint(0, 5)
        d.line([(x, top), (x, bot)], fill=hx(random.choice(['#3d4034', '#4a4d3f', '#43462f'])))
    return im, []


# -------------------------------------------------------- WatchGuard (photo) --
_WG_PATH = os.path.join(ROOT, 'assets', 'watchguard.jpg')
if not os.path.isfile(_WG_PATH):
    raise SystemExit('Image introuvable : %s\n'
                     'Lance le script depuis un clone complet du dépôt (git pull).' % _WG_PATH)
WG_BASE = Image.open(_WG_PATH).convert('RGB')
if WG_BASE.width != 600:
    WG_BASE = WG_BASE.resize((600, max(1, round(WG_BASE.height * 600 / WG_BASE.width))))
WG_H = WG_BASE.height


def face_watchguard(name):
    im = WG_BASE.copy()
    d = ImageDraw.Draw(im)
    d.rectangle([6, WG_H - 22, 112, WG_H - 4], fill=hx('#0d1016'), outline=hx('#1f2937'))
    d.text((12, WG_H - 19), name, font=F(12), fill=hx('#ffffff'))
    d.text((120, WG_H - 19), 'Firebox M390', font=F(8), fill=hx('#cbd5e1'))
    ports = [
        ('eth0', 'eth0 (WAN / transit FAI)', 24, 72),
        ('eth1', 'eth1 (LAN cœur)', 33, 72),
        ('eth2', 'eth2 (DMZ)', 42, 72),
        ('eth3', 'eth3 (spare)', 51, 72),
    ]
    return im, [(n, l, x, y) for n, l, x, y in ports]  # % déjà relatifs


# ------------------------------------------------------------ fabric de l'état --

def make_ports(inst_id, tpl, ips=None):
    """Gabarit -> ports d'instance (avec ids, ip, vlan)."""
    ips = ips or {}
    out = []
    for t in tpl:
        if len(t) == 4 and isinstance(t[2], (int, float)):  # déjà en %
            n, l, x, y = t
        else:
            n, l, x, y = t
        ip, vlan = ips.get(n, ('', ''))
        out.append({
            'id': 'p-%s-%s' % (inst_id, n),
            'name': n, 'label': l,
            'xPct': x, 'yPct': y, 'size': 0.8,
            'ip': ip, 'vlan': vlan,
        })
    return out


# Garanties des modèles de la bibliothèque : (contrat, fin de garantie).
# Un exemplaire peut les surcharger (ex. FW-01, dont l'UTM arrive à échéance).
DEV_WARRANTY = {
    'watchguard-permanent': ('UTM WatchGuard 3 ans — NBD', '2028-04-30'),
    'dev-nutanix':          ('Nutanix 5 ans — NBD 4h',    '2029-06-30'),
    'dev-dell':             ('ProSupport Plus 3 ans',     '2026-07-31'),
    'dev-nas':              ('Extension Synology 5 ans',  '2027-03-12'),
    'dev-peplink':          ('Balance Care 5 ans',        '2029-01-31'),
    'dev-aruba':            ('Aruba Care 5 ans',          '2028-12-31'),
    'dev-akcp':             ('Garantie constructeur 2 ans', '2027-05-31'),
    'dev-pp':               ('Garantie constructeur 5 ans', '2029-12-31'),
    'dev-brush':            ('Garantie constructeur 2 ans',  '2028-06-30'),
}


def make_instance(inst_id, dev_id, name, slot, cat, sizeU, img, tpl, zone='',
                  brand='', model='', partRef='', serial='', ipMgmt='', vlan='',
                  watts=0, weightKg=0, ips=None, photo_scale=1,
                  warranty='', warrantyEnd=''):
    # photo : vide — l'application rend la photo du modèle de la bibliothèque
    # (helper instPhoto d'app.js), ce qui allège state.json d'environ 40 %.
    # Garantie : recopiée du modèle, sauf surcharge explicite de l'exemplaire.
    w_contract, w_end = DEV_WARRANTY.get(dev_id, ('', ''))
    return {
        'id': inst_id, 'deviceId': dev_id, 'name': name,
        'slot': slot, 'sizeU': sizeU, 'cat': cat, 'zone': zone,
        'photo': '', 'ports': make_ports(inst_id, tpl, ips),
        'brand': brand, 'model': model, 'partRef': partRef, 'serial': serial,
        'ipMgmt': ipMgmt, 'vlan': vlan, 'watts': watts, 'weightKg': weightKg,
        'warranty': warranty or w_contract, 'warrantyEnd': warrantyEnd or w_end,
    }


def build():
    # ---------- images + gabarits de ports ----------
    img_nx, tpl_nx = face_nutanix('NX-XX')
    img_dell, tpl_dell = face_dell('SRV-DELL-XX')
    img_nas, tpl_nas = face_nas('NAS-XX')
    img_rtr, tpl_rtr = face_peplink('RTR-XX')
    img_ap, tpl_ap = face_aruba('AP-ARUBA-X')
    img_akcp, tpl_akcp = face_akcp('AKCP-XX')
    img_pp, tpl_pp = face_patch('BR-XX-XX')
    img_brush, tpl_brush = face_brush('BROSSE-XX')
    img_wg, tpl_wg = face_watchguard('FW-XX')

    # ---------- bibliothèque de devices ----------
    new_devices = [
        dict(id='dev-nutanix', name='Nutanix NX-3155-G6', sizeU=1, cat='server',
             photo=dataurl(img_nx), brand='Nutanix', model='NX-3155-G6', partRef='NX-3155-G6-26S',
             serial='', ipMgmt='', vlan='', watts=600, weightKg=16.6,
             ports=[{'id': 'pd-nx-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_nx]),
        dict(id='dev-dell', name='Dell PowerEdge R740', sizeU=2, cat='server',
             photo=dataurl(img_dell), brand='Dell', model='PowerEdge R740', partRef='210-ADXF',
             serial='', ipMgmt='', vlan='', watts=750, weightKg=25.4,
             ports=[{'id': 'pd-dell-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_dell]),
        dict(id='dev-nas', name='Synology RS1221+', sizeU=2, cat='storage',
             photo=dataurl(img_nas), brand='Synology', model='RS1221+', partRef='RS1221+-16G',
             serial='', ipMgmt='', vlan='', watts=250, weightKg=15.6,
             ports=[{'id': 'pd-nas-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_nas]),
        dict(id='dev-peplink', name='Peplink Balance 20X', sizeU=1, cat='router',
             photo=dataurl(img_rtr), brand='Peplink', model='Balance 20X', partRef='BPL-20X',
             serial='', ipMgmt='', vlan='', watts=40, weightKg=1.5,
             ports=[{'id': 'pd-rtr-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_rtr]),
        dict(id='dev-aruba', name='Aruba AP-515', sizeU=1, cat='ap',
             photo=dataurl(img_ap), brand='Aruba', model='AP-515', partRef='R3W29A',
             serial='', ipMgmt='', vlan='', watts=20, weightKg=0.7,
             ports=[{'id': 'pd-ap-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_ap]),
        dict(id='dev-akcp', name='AKCP sensorProbe2+', sizeU=1, cat='other',
             photo=dataurl(img_akcp), brand='AKCP', model='sensorProbe2+', partRef='SP2+E',
             serial='', ipMgmt='', vlan='', watts=15, weightKg=1.2,
             ports=[{'id': 'pd-akcp-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.8} for n, l, x, y in tpl_akcp]),
        dict(id='dev-pp', name='Panneau brassage 24×RJ45 CAT 6A', sizeU=1, cat='patch',
             photo=dataurl(img_pp), brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U',
             serial='', ipMgmt='', vlan='', watts=0, weightKg=2.2,
             ports=[{'id': 'pd-pp-%s' % n, 'name': n, 'label': l, 'xPct': x, 'yPct': y, 'size': 0.6} for n, l, x, y in tpl_pp]),
        dict(id='dev-brush', name='Passe-câbles à brosse 1U', sizeU=1, cat='other',
             photo=dataurl(img_brush), brand='Rittal', model='DK 7706.500', partRef='7706500',
             serial='', ipMgmt='', vlan='', watts=0, weightKg=0.5, ports=[]),
    ]
    # Garantie portée par chaque modèle (recopiée sur les exemplaires posés)
    for d in new_devices:
        d['warranty'], d['warrantyEnd'] = DEV_WARRANTY.get(d['id'], ('', ''))

    # ---------- instances ----------
    # --- RACK-A (siège, 18U) ---
    fw_a_img, _ = face_watchguard('FW-01')
    nx1, _ = face_nutanix('NX-01')
    nx2, _ = face_nutanix('NX-02')
    nx3, _ = face_nutanix('NX-03')
    dell1, _ = face_dell('SRV-DELL-01')
    nas1, _ = face_nas('NAS-01')
    rtr1, _ = face_peplink('RTR-01')
    ap1, _ = face_aruba('AP-ARUBA-A')
    akcp1, _ = face_akcp('AKCP-01')
    ppa1, _ = face_patch('BR-A-01')
    ppa2, _ = face_patch('BR-A-02')
    ppa3, _ = face_patch('BR-A-03')
    bra1, _ = face_brush('BROSSE-A1')
    bra2, _ = face_brush('BROSSE-A2')

    rackA_insts = [
        make_instance('inst-fw-a', 'watchguard-permanent', 'FW-01', 0, 'firewall', 1, fw_a_img, tpl_wg,
                      brand='WatchGuard', model='Firebox M390', partRef='WGM39010', serial='FGC81A0142',
                      ipMgmt='10.10.99.11', vlan='VLAN 99 — Mgmt', watts=150, weightKg=6.0,
                      warranty='UTM WatchGuard 3 ans — NBD', warrantyEnd='2026-10-15'),
        make_instance('inst-pp-a1', 'dev-pp', 'BR-A-01', 1, 'patch', 1, ppa1, tpl_pp,
                      brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U', serial='PPA24-8811',
                      watts=0, weightKg=2.2),
        make_instance('inst-pp-a2', 'dev-pp', 'BR-A-02', 2, 'patch', 1, ppa2, tpl_pp,
                      brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U', serial='PPA24-8812',
                      watts=0, weightKg=2.2),
        make_instance('inst-rtr-a', 'dev-peplink', 'RTR-01', 3, 'router', 1, rtr1, tpl_rtr,
                      zone='zone-lan-a', brand='Peplink', model='Balance 20X', partRef='BPL-20X', serial='PLX20X-77104',
                      ipMgmt='10.10.99.12', vlan='VLAN 99 — Mgmt', watts=40, weightKg=1.5),
        make_instance('inst-ap-a', 'dev-aruba', 'AP-ARUBA-A', 4, 'ap', 1, ap1, tpl_ap,
                      zone='zone-ap-a', brand='Aruba', model='AP-515', partRef='R3W29A', serial='CN9BW4A018',
                      ipMgmt='10.10.99.13', vlan='VLAN 99 — Mgmt', watts=20, weightKg=0.7),
        make_instance('inst-nx-01', 'dev-nutanix', 'NX-01', 5, 'server', 1, nx1, tpl_nx,
                      brand='Nutanix', model='NX-3155-G6', partRef='NX-3155-G6-26S', serial='NXG6-1130A',
                      ipMgmt='10.10.10.21', vlan='VLAN 10 — vMgmt', watts=600, weightKg=16.6,
                      ips={'MGMT': ('10.10.10.21', 'VLAN 10'), '10G-1': ('10.10.20.21', 'VLAN 20'), '10G-2': ('10.10.30.21', 'VLAN 30')}),
        make_instance('inst-nx-02', 'dev-nutanix', 'NX-02', 6, 'server', 1, nx2, tpl_nx,
                      brand='Nutanix', model='NX-3155-G6', partRef='NX-3155-G6-26S', serial='NXG6-1130B',
                      ipMgmt='10.10.10.22', vlan='VLAN 10 — vMgmt', watts=600, weightKg=16.6,
                      ips={'MGMT': ('10.10.10.22', 'VLAN 10'), '10G-1': ('10.10.20.22', 'VLAN 20'), '10G-2': ('10.10.30.22', 'VLAN 30')}),
        make_instance('inst-nx-03', 'dev-nutanix', 'NX-03', 7, 'server', 1, nx3, tpl_nx,
                      brand='Nutanix', model='NX-3155-G6', partRef='NX-3155-G6-26S', serial='NXG6-1130C',
                      ipMgmt='10.10.10.23', vlan='VLAN 10 — vMgmt', watts=600, weightKg=16.6,
                      ips={'MGMT': ('10.10.10.23', 'VLAN 10'), '10G-1': ('10.10.20.23', 'VLAN 20'), '10G-2': ('10.10.30.23', 'VLAN 30')}),
        make_instance('inst-dell-01', 'dev-dell', 'SRV-DELL-01', 8, 'server', 2, dell1, tpl_dell,
                      brand='Dell', model='PowerEdge R740', partRef='210-ADXF', serial='JH7XQ3',
                      ipMgmt='10.10.99.31', vlan='VLAN 99 — Mgmt', watts=750, weightKg=25.4,
                      ips={'iDRAC': ('10.10.99.31', 'VLAN 99'), 'eth0': ('10.10.20.11', 'VLAN 20'), 'eth1': ('10.10.21.11', 'VLAN 21')}),
        make_instance('inst-nas-01', 'dev-nas', 'NAS-01', 10, 'storage', 2, nas1, tpl_nas,
                      brand='Synology', model='RS1221+', partRef='RS1221+-16G', serial='1980LWN48521',
                      ipMgmt='10.10.99.41', vlan='VLAN 99 — Mgmt', watts=250, weightKg=15.6,
                      ips={'LAN1': ('10.10.99.41', 'VLAN 99'), 'LAN2': ('10.10.30.12', 'VLAN 30')}),
        make_instance('inst-akcp-a', 'dev-akcp', 'AKCP-01', 12, 'other', 1, akcp1, tpl_akcp,
                      brand='AKCP', model='sensorProbe2+', partRef='SP2+E', serial='SP2E-0453',
                      ipMgmt='10.10.99.14', vlan='VLAN 99 — Mgmt', watts=15, weightKg=1.2,
                      ips={'eth0': ('10.10.99.14', 'VLAN 99')}),
        make_instance('inst-pp-a3', 'dev-pp', 'BR-A-03', 13, 'patch', 1, ppa3, tpl_pp,
                      brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U', serial='PPA24-8813',
                      watts=0, weightKg=2.2),
        make_instance('inst-brosse-a1', 'dev-brush', 'BROSSE-A1', 14, 'other', 1, bra1, tpl_brush,
                      brand='Rittal', model='DK 7706.500', partRef='7706500', watts=0, weightKg=0.5),
        make_instance('inst-brosse-a2', 'dev-brush', 'BROSSE-A2', 15, 'other', 1, bra2, tpl_brush,
                      brand='Rittal', model='DK 7706.500', partRef='7706500', watts=0, weightKg=0.5),
    ]

    # --- RACK-B (agence Rabat, 16U) ---
    fw_b_img, _ = face_watchguard('FW-02')
    rtr2, _ = face_peplink('RTR-02')
    ap2, _ = face_aruba('AP-ARUBA-B')
    akcp2, _ = face_akcp('AKCP-02')
    nas2, _ = face_nas('NAS-02')
    ppb1, _ = face_patch('BR-B-01')
    ppb2, _ = face_patch('BR-B-02')
    brb1, _ = face_brush('BROSSE-B1')

    rackB_insts = [
        make_instance('inst-fw-b', 'watchguard-permanent', 'FW-02', 0, 'firewall', 1, fw_b_img, tpl_wg,
                      brand='WatchGuard', model='Firebox M390', partRef='WGM39010', serial='FGC81A0143',
                      ipMgmt='10.11.99.11', vlan='VLAN 99 — Mgmt', watts=150, weightKg=6.0),
        make_instance('inst-pp-b1', 'dev-pp', 'BR-B-01', 1, 'patch', 1, ppb1, tpl_pp,
                      brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U', serial='PPB24-9911',
                      watts=0, weightKg=2.2),
        make_instance('inst-rtr-b', 'dev-peplink', 'RTR-02', 2, 'router', 1, rtr2, tpl_rtr,
                      zone='zone-lan-b', brand='Peplink', model='Balance 20X', partRef='BPL-20X', serial='PLX20X-77105',
                      ipMgmt='10.11.99.12', vlan='VLAN 99 — Mgmt', watts=40, weightKg=1.5),
        make_instance('inst-ap-b', 'dev-aruba', 'AP-ARUBA-B', 3, 'ap', 1, ap2, tpl_ap,
                      zone='zone-ap-b', brand='Aruba', model='AP-515', partRef='R3W29A', serial='CN9BW4A019',
                      ipMgmt='10.11.99.13', vlan='VLAN 99 — Mgmt', watts=20, weightKg=0.7),
        make_instance('inst-akcp-b', 'dev-akcp', 'AKCP-02', 4, 'other', 1, akcp2, tpl_akcp,
                      brand='AKCP', model='sensorProbe2+', partRef='SP2+E', serial='SP2E-0454',
                      ipMgmt='10.11.99.14', vlan='VLAN 99 — Mgmt', watts=15, weightKg=1.2,
                      warranty='Garantie constructeur 2 ans', warrantyEnd='2026-08-31',
                      ips={'eth0': ('10.11.99.14', 'VLAN 99')}),
        make_instance('inst-nas-02', 'dev-nas', 'NAS-02', 5, 'storage', 2, nas2, tpl_nas,
                      brand='Synology', model='RS1221+', partRef='RS1221+-16G', serial='1980LWN48522',
                      ipMgmt='10.11.99.41', vlan='VLAN 99 — Mgmt', watts=250, weightKg=15.6,
                      warranty='Extension Synology 5 ans', warrantyEnd='2026-11-30',
                      ips={'LAN1': ('10.11.99.41', 'VLAN 99'), 'LAN2': ('10.11.30.12', 'VLAN 30')}),
        make_instance('inst-pp-b2', 'dev-pp', 'BR-B-02', 7, 'patch', 1, ppb2, tpl_pp,
                      brand='MPO', model='PP-24 CAT6A', partRef='PP24-C6A-1U', serial='PPB24-9912',
                      watts=0, weightKg=2.2),
        make_instance('inst-brosse-b1', 'dev-brush', 'BROSSE-B1', 8, 'other', 1, brb1, tpl_brush,
                      brand='Rittal', model='DK 7706.500', partRef='7706500', watts=0, weightKg=0.5),
    ]

    rackA = {
        'id': 'rack-a', 'name': 'RACK-A — Siège Casablanca', 'x': 150, 'y': 120, 'sizeU': 18,
        'siteId': 'site-a', 'maxWatts': 5000, 'maxKg': 300, 'instances': rackA_insts,
    }
    rackB = {
        'id': 'rack-b', 'name': 'RACK-B — Agence Rabat', 'x': 620, 'y': 120, 'sizeU': 16,
        'siteId': 'site-b', 'maxWatts': 3000, 'maxKg': 200, 'instances': rackB_insts,
    }

    # ---------- câbles ----------
    def cable(cid, name, domain, color, rackA, instA, portA, rackB, instB, portB):
        return {
            'id': cid, 'name': name, 'color': color, 'domain': domain,
            'a': {'rackId': rackA, 'instId': instA, 'portId': portA},
            'b': {'rackId': rackB, 'instId': instB, 'portId': portB},
        }

    LAN, MGMT, FW, SAN, TEN = '#60a5fa', '#a78bfa', '#f59e0b', '#f472b6', '#34d399'
    cables = [
        # --- RACK-A ---
        cable('cab-001', 'CAB-001 · RTR-01 → FW-01 (transit FAI)', 'firewall', FW,
              'rack-a', 'inst-rtr-a', 'p-inst-rtr-a-WAN1', 'rack-a', 'inst-fw-a', 'p-inst-fw-a-eth0'),
        cable('cab-002', 'CAB-002 · FW-01 LAN → BR-A-01/1', 'lan', LAN,
              'rack-a', 'inst-fw-a', 'p-inst-fw-a-eth1', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-1'),
        cable('cab-003', 'CAB-003 · RTR-01 LAN → BR-A-01/2', 'lan', LAN,
              'rack-a', 'inst-rtr-a', 'p-inst-rtr-a-LAN1', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-2'),
        cable('cab-004', 'CAB-004 · NX-01 MGMT → BR-A-01/3', 'mgmt', MGMT,
              'rack-a', 'inst-nx-01', 'p-inst-nx-01-MGMT', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-3'),
        cable('cab-005', 'CAB-005 · NX-02 MGMT → BR-A-01/4', 'mgmt', MGMT,
              'rack-a', 'inst-nx-02', 'p-inst-nx-02-MGMT', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-4'),
        cable('cab-006', 'CAB-006 · NX-03 MGMT → BR-A-01/5', 'mgmt', MGMT,
              'rack-a', 'inst-nx-03', 'p-inst-nx-03-MGMT', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-5'),
        cable('cab-007', 'CAB-007 · SRV-DELL-01 iDRAC → BR-A-01/6', 'mgmt', MGMT,
              'rack-a', 'inst-dell-01', 'p-inst-dell-01-iDRAC', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-6'),
        cable('cab-008', 'CAB-008 · NAS-01 LAN1 → BR-A-01/7', 'mgmt', MGMT,
              'rack-a', 'inst-nas-01', 'p-inst-nas-01-LAN1', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-7'),
        cable('cab-009', 'CAB-009 · AKCP-01 ETH0 → BR-A-01/8', 'mgmt', MGMT,
              'rack-a', 'inst-akcp-a', 'p-inst-akcp-a-eth0', 'rack-a', 'inst-pp-a1', 'p-inst-pp-a1-8'),
        cable('cab-010', 'CAB-010 · AP-ARUBA-A ETH0 → BR-A-02/1', 'lan', LAN,
              'rack-a', 'inst-ap-a', 'p-inst-ap-a-eth0', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-1'),
        cable('cab-011', 'CAB-011 · NX-01 10G-1 → BR-A-02/2', 'lan', TEN,
              'rack-a', 'inst-nx-01', 'p-inst-nx-01-10G-1', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-2'),
        cable('cab-012', 'CAB-012 · NX-01 10G-2 → BR-A-02/3', 'lan', TEN,
              'rack-a', 'inst-nx-01', 'p-inst-nx-01-10G-2', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-3'),
        cable('cab-013', 'CAB-013 · NX-02 10G-1 → BR-A-02/4', 'lan', TEN,
              'rack-a', 'inst-nx-02', 'p-inst-nx-02-10G-1', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-4'),
        cable('cab-014', 'CAB-014 · NX-02 10G-2 → BR-A-02/5', 'lan', TEN,
              'rack-a', 'inst-nx-02', 'p-inst-nx-02-10G-2', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-5'),
        cable('cab-015', 'CAB-015 · NX-03 10G-1 → BR-A-02/6', 'lan', TEN,
              'rack-a', 'inst-nx-03', 'p-inst-nx-03-10G-1', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-6'),
        cable('cab-016', 'CAB-016 · NX-03 10G-2 → BR-A-02/7', 'lan', TEN,
              'rack-a', 'inst-nx-03', 'p-inst-nx-03-10G-2', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-7'),
        cable('cab-017', 'CAB-017 · SRV-DELL-01 ETH0 → BR-A-02/8', 'lan', LAN,
              'rack-a', 'inst-dell-01', 'p-inst-dell-01-eth0', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-8'),
        cable('cab-018', 'CAB-018 · SRV-DELL-01 ETH1 → BR-A-02/9', 'lan', LAN,
              'rack-a', 'inst-dell-01', 'p-inst-dell-01-eth1', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-9'),
        cable('cab-019', 'CAB-019 · NAS-01 LAN2 → BR-A-02/10', 'san', SAN,
              'rack-a', 'inst-nas-01', 'p-inst-nas-01-LAN2', 'rack-a', 'inst-pp-a2', 'p-inst-pp-a2-10'),
        # --- RACK-B ---
        cable('cab-101', 'CAB-101 · RTR-02 → FW-02 (transit FAI)', 'firewall', FW,
              'rack-b', 'inst-rtr-b', 'p-inst-rtr-b-WAN1', 'rack-b', 'inst-fw-b', 'p-inst-fw-b-eth0'),
        cable('cab-102', 'CAB-102 · FW-02 LAN → BR-B-01/1', 'lan', LAN,
              'rack-b', 'inst-fw-b', 'p-inst-fw-b-eth1', 'rack-b', 'inst-pp-b1', 'p-inst-pp-b1-1'),
        cable('cab-103', 'CAB-103 · RTR-02 LAN → BR-B-01/2', 'lan', LAN,
              'rack-b', 'inst-rtr-b', 'p-inst-rtr-b-LAN1', 'rack-b', 'inst-pp-b1', 'p-inst-pp-b1-2'),
        cable('cab-104', 'CAB-104 · AKCP-02 ETH0 → BR-B-01/3', 'mgmt', MGMT,
              'rack-b', 'inst-akcp-b', 'p-inst-akcp-b-eth0', 'rack-b', 'inst-pp-b1', 'p-inst-pp-b1-3'),
        cable('cab-105', 'CAB-105 · NAS-02 LAN1 → BR-B-01/4', 'mgmt', MGMT,
              'rack-b', 'inst-nas-02', 'p-inst-nas-02-LAN1', 'rack-b', 'inst-pp-b1', 'p-inst-pp-b1-4'),
        cable('cab-106', 'CAB-106 · AP-ARUBA-B ETH0 → BR-B-02/1', 'lan', LAN,
              'rack-b', 'inst-ap-b', 'p-inst-ap-b-eth0', 'rack-b', 'inst-pp-b2', 'p-inst-pp-b2-1'),
        cable('cab-107', 'CAB-107 · NAS-02 LAN2 → BR-B-02/2', 'san', SAN,
              'rack-b', 'inst-nas-02', 'p-inst-nas-02-LAN2', 'rack-b', 'inst-pp-b2', 'p-inst-pp-b2-2'),
    ]

    # ---------- sites ----------
    sites = [
        {
            'id': 'site-a', 'name': 'Datacenter Siège — Casablanca',
            'address': 'Zone Industrielle Sidi Maârouf, Casablanca',
            'contact': 'Amine MJID — amine.mjid@demo.ma — +212 6 61 00 00 00',
            'desc': "Baie principale RACK-A (18U) : hyperconvergence Nutanix (3 nœuds), serveur physique Dell R740, NAS Synology, pare-feu WatchGuard, routeur SD-WAN Peplink, borne Aruba et capteur AKCP. Refroidissement par façade, double alimentation.",
        },
        {
            'id': 'site-b', 'name': 'Agence Rabat',
            'address': 'Angle avenue Mohammed V, Rabat',
            'contact': 'Support N2 — support@demo.ma — +212 5 37 00 00 00',
            'desc': "Baie secondaire RACK-B (16U) : pare-feu WatchGuard, routeur SD-WAN Peplink, NAS de réplication, borne Aruba et capteur environnemental AKCP. Site de secours relié au siège par tunnel SD-WAN SpeedFusion.",
        },
    ]

    # ---------- flux ----------
    flows = [
        {'id': 'flow-1', 'name': 'Accès Internet sortant (NAT)',
         'src': 'LAN Siège (10.10.0.0/16)', 'dst': 'Internet via Maroc Telecom',
         'proto': 'TCP/UDP — tous ports', 'sens': 'bi',
         'usage': 'Navigation web, mises à jour, SaaS (Microsoft 365).'},
        {'id': 'flow-2', 'name': 'Publication DMZ (HTTPS)',
         'src': 'Internet', 'dst': 'SRV-DELL-01 (10.10.20.11 — VLAN 20)',
         'proto': 'TCP 443', 'sens': 'uni',
         'usage': 'Reverse-proxy publié pour les applications internes.'},
        {'id': 'flow-3', 'name': 'Réplication NAS inter-sites',
         'src': 'NAS-01 (10.10.30.12)', 'dst': 'NAS-02 (10.11.30.12)',
         'proto': 'TCP 5665 (rsync/SSH)', 'sens': 'uni',
         'usage': 'Snapshot Synology répliqué chaque nuit vers l’agence de Rabat.'},
        {'id': 'flow-4', 'name': 'Sauvegarde Veeam → NAS',
         'src': 'NX-01..03 (VM Veeam)', 'dst': 'NAS-01 (10.10.30.12)',
         'proto': 'TCP 2500-5000', 'sens': 'uni',
         'usage': 'Sauvegarde incrémentale quotidienne des machines virtuelles.'},
        {'id': 'flow-5', 'name': 'Administration & supervision',
         'src': 'Poste admin (VLAN 40)', 'dst': 'Équipements mgmt (VLAN 99)',
         'proto': 'TCP 443/22 · SNMP v2c', 'sens': 'bi',
         'usage': 'Zabbix, Prism Element, interfaces d’administration, sondes AKCP.'},
        {'id': 'flow-6', 'name': 'Tunnel SD-WAN inter-sites',
         'src': 'RTR-01 (Siège)', 'dst': 'RTR-02 (Agence Rabat)',
         'proto': 'UDP 4500 — SpeedFusion', 'sens': 'bi',
         'usage': 'Interconnexion chiffrée entre sites, bascule 4G en secours.'},
    ]

    # ---------- topologie ----------
    def node(nid, inst_id, x, y):
        return {'id': nid, 'instId': inst_id, 'x': x, 'y': y}

    def link(lid, a, b, label, speed='', vlan='', style='solid', color='#60a5fa'):
        return {'id': lid, 'a': a, 'b': b, 'label': label, 'speed': speed,
                'vlan': vlan, 'style': style, 'color': color}

    topology = {
        'nodes': [
            node('n-rtr-a', 'inst-rtr-a', 40, 40),
            node('n-rtr-b', 'inst-rtr-b', 720, 40),
            node('n-fw-a', 'inst-fw-a', 40, 160),
            node('n-akcp-a', 'inst-akcp-a', 280, 40),
            node('n-fw-b', 'inst-fw-b', 720, 160),
            node('n-nx1', 'inst-nx-01', 40, 300),
            node('n-nx2', 'inst-nx-02', 40, 410),
            node('n-nx3', 'inst-nx-03', 40, 520),
            node('n-dell', 'inst-dell-01', 280, 300),
            node('n-nas-a', 'inst-nas-01', 280, 410),
            node('n-ap-a', 'inst-ap-a', 280, 520),
            node('n-nas-b', 'inst-nas-02', 720, 300),
            node('n-ap-b', 'inst-ap-b', 720, 410),
            node('n-akcp-b', 'inst-akcp-b', 720, 520),
        ],
        'links': [
            link('l-1', 'n-rtr-a', 'n-fw-a', 'Transit FAI', '1 Gb/s', '', 'solid', '#f59e0b'),
            link('l-2', 'n-rtr-b', 'n-fw-b', 'Transit FAI', '1 Gb/s', '', 'solid', '#f59e0b'),
            link('l-3', 'n-rtr-a', 'n-rtr-b', 'SD-WAN SpeedFusion', '100 Mbps', '', 'dashed', '#a78bfa'),
            link('l-4', 'n-fw-a', 'n-nx1', 'Cœur 10G', '10 Gb/s', '10/20/30', 'solid', '#60a5fa'),
            link('l-5', 'n-nx1', 'n-nx2', 'Cluster AHV', '10 Gb/s', '10/30', 'solid', '#34d399'),
            link('l-6', 'n-nx2', 'n-nx3', 'Cluster AHV', '10 Gb/s', '10/30', 'solid', '#34d399'),
            link('l-7', 'n-fw-a', 'n-dell', 'LAN serveurs', '1 Gb/s', '20/21', 'solid', '#60a5fa'),
            link('l-8', 'n-fw-a', 'n-nas-a', 'LAN stockage', '1 Gb/s', '30', 'solid', '#60a5fa'),
            link('l-9', 'n-fw-a', 'n-ap-a', 'WiFi corp', '1 Gb/s', '40', 'solid', '#60a5fa'),
            link('l-10', 'n-fw-a', 'n-akcp-a', 'Supervision', '100 Mb/s', '99', 'solid', '#a78bfa'),
            link('l-11', 'n-fw-b', 'n-nas-b', 'LAN stockage', '1 Gb/s', '30', 'solid', '#60a5fa'),
            link('l-12', 'n-fw-b', 'n-ap-b', 'WiFi corp', '1 Gb/s', '40', 'solid', '#60a5fa'),
            link('l-13', 'n-fw-b', 'n-akcp-b', 'Supervision', '100 Mb/s', '99', 'solid', '#a78bfa'),
            link('l-14', 'n-nas-a', 'n-nas-b', 'Réplication', '—', '30', 'dashed', '#f472b6'),
        ],
    }

    # ---------- dossier LLD ----------
    lld = {
        'client': 'Démo Industries SA — Siège Casablanca',
        'author': 'Amine MJID — Ingénieur systèmes & réseaux',
        'version': '1.0',
        'date': '2026-09-08',
        'objectif': (
            "Ce dossier décrit l'infrastructure réseau et système du siège de Démo Industries "
            "(Casablanca) et de son agence de Rabat. Il a été produit avec LLDraw à des fins de "
            "démonstration : il illustre la tenue d'un dossier LLD complet à partir d'un plan de baies.\n\n"
            "L'objectif fonctionnel : héberger la production (ERP, fichiers, applications internes) sur "
            "une plateforme hyperconvergée Nutanix au siège, répliquer les données vers l'agence de "
            "Rabat, et sécuriser les échanges par deux pare-feu WatchGuard reliés par un tunnel "
            "SD-WAN Peplink."
        ),
        'existant': (
            "Avant le projet : une seule baie 24U au siège, des serveurs physiques vieillissants "
            "(5 ans), des sauvegardes sur disques USB externes et aucun équipement sur le site de "
            "Rabat.\n\nLe présent dossier décrit l'infrastructure cible déployée en 2026 : deux baies "
            "(RACK-A au siège, RACK-B à l'agence), un cluster Nutanix de 3 nœuds, un serveur physique "
            "Dell R740, deux NAS Synology en réplication, deux pare-feu WatchGuard Firebox M390, deux "
            "routeurs SD-WAN Peplink Balance 20X, deux bornes WiFi Aruba AP-515 et deux capteurs "
            "environnementaux AKCP."
        ),
        'architecture': (
            "Le siège (RACK-A) concentre la production : le cluster Nutanix NX-01 à NX-03 porte les "
            "machines virtuelles (18 VM : AD/DNS, fichiers, ERP, Veeam, Zabbix), le Dell R740 héberge "
            "le reverse-proxy et la supervision, le NAS-01 sert de cible de sauvegarde. La baie RACK-B "
            "à Rabat héberge le second pare-feu, le routeur SD-WAN et le NAS de réplication.\n\n"
            "Chaque site dispose d'un accès FTTO dédié ; les deux sites sont reliés par un tunnel "
            "SD-WAN SpeedFusion (Peplink) avec secours 4G. Le WiFi Aruba est déployé en mode "
            "contrôleur virtuel instant, un SSID par population (corporate VLAN 40, invités isolés). "
            "La supervision Zabbix collecte les métriques des équipements via le VLAN 99, y compris la "
            "température et l'hygrométrie des baies (sondes AKCP)."
        ),
        'revs': [
            {'rev': '1.0', 'date': '2026-09-08', 'author': 'Amine MJID',
             'note': 'Création — inventaire initial du datacenter de démonstration.'},
        ],
        'nomen': [
            {'type': 'Pare-feu', 'prefix': 'FW-', 'example': 'FW-01',
             'rule': 'NN sur 2 chiffres, un par site (FW-01 siège, FW-02 agence).'},
            {'type': 'Routeur / SD-WAN', 'prefix': 'RTR-', 'example': 'RTR-01',
             'rule': 'NN sur 2 chiffres, un par site.'},
            {'type': 'Nœud hyperconvergé', 'prefix': 'NX-', 'example': 'NX-01',
             'rule': 'NN sur 2 chiffres dans l’ordre du cluster.'},
            {'type': 'Serveur physique', 'prefix': 'SRV-', 'example': 'SRV-DELL-01',
             'rule': 'SRV-<MARQUE>-NN.'},
            {'type': 'Machine virtuelle', 'prefix': 'VM-', 'example': 'VM-ERP-01',
             'rule': 'VM-<APP>-NN.'},
            {'type': 'Stockage / NAS', 'prefix': 'NAS-', 'example': 'NAS-01',
             'rule': 'NN sur 2 chiffres, un par site.'},
            {'type': 'Brassage', 'prefix': 'BR-', 'example': 'BR-A-01',
             'rule': 'BR-<SITE>-NN (A = siège, B = agence).'},
            {'type': 'Borne WiFi', 'prefix': 'AP-', 'example': 'AP-ARUBA-A',
             'rule': 'AP-<MARQUE>-<SITE>.'},
            {'type': 'Capteur / supervision', 'prefix': 'AKCP-', 'example': 'AKCP-01',
             'rule': 'NN sur 2 chiffres, un par baie.'},
        ],
        'vlans': [
            {'vid': '10', 'name': 'vMgmt', 'subnet': '10.10.10.0/24', 'gw': '10.10.10.1',
             'purpose': 'Management Nutanix (CVM, Prism)'},
            {'vid': '20', 'name': 'vServers', 'subnet': '10.10.20.0/24', 'gw': '10.10.20.1',
             'purpose': 'Serveurs et VM de production'},
            {'vid': '21', 'name': 'vBackup', 'subnet': '10.10.21.0/24', 'gw': '10.10.21.1',
             'purpose': 'Réseau de sauvegarde isolé (Veeam)'},
            {'vid': '30', 'name': 'vStorage', 'subnet': '10.10.30.0/24', 'gw': '10.10.30.1',
             'purpose': 'Stockage NAS et réplication inter-sites'},
            {'vid': '40', 'name': 'vUsers', 'subnet': '10.10.40.0/24', 'gw': '10.10.40.1',
             'purpose': 'Utilisateurs filaire et WiFi'},
            {'vid': '99', 'name': 'vMgmtIPMI', 'subnet': '10.10.99.0/24', 'gw': '10.10.99.1',
             'purpose': 'iDRAC, AP, capteurs, IPs de management'},
        ],
        'fai': {
            'operator': 'Maroc Telecom (siège) · Inwi (agence)',
            'offer': 'FTTO Pro — 2 accès',
            'linkType': 'FTTO',
            'down': '100 Mbps',
            'up': '100 Mbps (siège) / 50 Mbps (agence)',
            'publicBlock': '41.92.10.0/29 (siège) · 105.157.20.0/29 (agence)',
            'cpe': 'Huawei EG8148 (siège) · Zyxel (agence) — mode bridge',
            'cpeIp': '41.92.10.1 / 105.157.20.1',
            'notes': (
                'Site A : FTTO Maroc Telecom 100/100 Mbps, CPE en mode bridge sur RTR-01 WAN1.\n'
                'Site B : FTTO Inwi 100/50 Mbps, bloc 105.157.20.0/29, CPE 105.157.20.1 (bridge) sur '
                'RTR-02 WAN1.\nAccès 4G de secours via carte SIM intégrée aux Peplink Balance 20X (WAN2).'
            ),
        },
        'interco': {
            'tech': 'SD-WAN Peplink SpeedFusion (+ IPsec)',
            'epA': 'RTR-01 (siège) — WAN 41.92.10.2',
            'epB': 'RTR-02 (agence) — WAN 105.157.20.2',
            'localSubnets': '10.10.0.0/16 (siège)',
            'remoteSubnets': '10.11.0.0/16 (agence)',
            'routing': 'SpeedFusion — routage statique + priorité de flux',
            'encryption': 'AES-256 — chiffrement de bout en bout',
            'notes': (
                'Tunnel SD-WAN entre les deux Peplink Balance 20X, établi sur les deux accès FTTO. '
                'En cas de coupure d’un accès, le tunnel bascule automatiquement sur la 4G (SIM '
                'intégrée). Le trafic de réplication NAS est prioritaire, les flux d’administration '
                'sont limités à 10 Mbps.'
            ),
        },
        'catNotes': {
            'firewall': (
                "Deux Firebox M390 en architecture déportée (une par site). Politique par défaut : "
                "tout le trafic sortant autorisé en NAT, entrant bloqué sauf publication HTTPS (443) "
                "vers le reverse-proxy du VLAN 20. HA non activé sur la démo — remplacement à froid "
                "sous 4 h (matériel de rechange au siège). Administration via Fireware Web UI sur le "
                "VLAN 99."
            ),
            'switching': (
                "Le cœur de commutation est assuré par les panneaux de brassage CAT 6A : BR-A-01 "
                "(management 1G), BR-A-02 (production 10G), BR-A-03 (réserve), BR-B-01 et BR-B-02 "
                "(agence). Les liens 10 Gb/s des nœuds Nutanix et du Dell R740 sont repris sur la "
                "face arrière des baies. Le WiFi Aruba (AP-515) est déployé en mode contrôleur "
                "virtuel instant, un SSID par population (corporate VLAN 40, invités isolés)."
            ),
            'server': (
                "Cluster Nutanix AHV de 3 nœuds NX-3155-G6 (hyperconvergence, ~12 To utiles, "
                "réplication RF2). Le Dell R740 héberge physiquement le reverse-proxy et le serveur "
                "de supervision. Virtualisation : 18 VM (AD/DNS, fichiers, ERP, Veeam, Zabbix). "
                "Sauvegarde Veeam quotidienne vers NAS-01, réplication nightly vers NAS-02."
            ),
            'storage': (
                "Deux Synology RS1221+ en réplication Snapshot toutes les nuits : NAS-01 (siège, "
                "64 To brut, RAID 6) et NAS-02 (agence, 32 To brut, RAID 6). Le NAS-01 sert aussi "
                "de cible Veeam pour les sauvegardes de VM (VLAN 30 dédié)."
            ),
            'ids': '', 'cctv': '', 'pointage': '',
        },
        'swZones': [
            {'id': 'zone-infra', 'name': 'INFRA'},
            {'id': 'zone-lan-b', 'name': 'LAN Site B'},
            {'id': 'zone-ap-a', 'name': 'Aruba AP Site A'},
            {'id': 'zone-ap-b', 'name': 'Aruba AP Site B'},
            {'id': 'zone-lan-a', 'name': 'LAN Site A'},
        ],
    }

    ws = {
        'id': DEMO_WS_ID,
        'name': 'Datacenter Démo',
        'racks': [rackA, rackB],
        'cables': cables,
        'sites': sites,
        'flows': flows,
        'topology': topology,
        'lld': lld,
        'view': {'x': 0, 'y': 0, 'scale': 1},
        'viewTouched': False,
        # Horodatage en millisecondes (l'historique de l'accueil affiche une
        # date lisible ; 20260908 donnait « 01 janv. 1970 »)
        'updatedAt': 1788868800000,
    }

    # ---------- fusion dans l'état existant ----------
    try:
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            state = json.load(f)
    except Exception:
        state = {'devices': [], 'workspaces': [], 'activeWorkspaceId': None}

    if not isinstance(state.get('devices'), list):
        state['devices'] = []
    if not isinstance(state.get('workspaces'), list):
        state['workspaces'] = []

    if os.path.isfile(STATE_PATH):
        shutil.copyfile(STATE_PATH, STATE_PATH + '.bak-demo')

    # retire un éventuel précédent passage
    state['workspaces'] = [w for w in state['workspaces'] if w.get('id') != DEMO_WS_ID]
    new_dev_ids = {d['id'] for d in new_devices}
    state['devices'] = [d for d in state['devices'] if d.get('id') not in new_dev_ids]
    state['devices'].extend(new_devices)

    # Device WatchGuard permanent (bibliothèque) — partagé entre l'état de
    # l'utilisateur et la copie démo autonome ci-dessous
    wg_device = {
        'id': 'watchguard-permanent', 'name': 'WatchGuard Firebox M390', 'sizeU': 1,
        'photo': dataurl(WG_BASE), 'permanent': True, 'cat': 'firewall',
        'brand': 'WatchGuard', 'model': 'Firebox M390', 'partRef': 'WGM39010',
        'serial': '', 'ipMgmt': '', 'vlan': '', 'watts': 150, 'weightKg': 6.0,
        'warranty': DEV_WARRANTY['watchguard-permanent'][0],
        'warrantyEnd': DEV_WARRANTY['watchguard-permanent'][1],
        'ports': [{'id': 'pd-wg-eth%d' % i, 'name': 'eth%d' % i, 'label': 'eth%d' % i,
                   'xPct': x, 'yPct': 72, 'size': 0.8} for i, x in enumerate((24, 33, 42, 51))],
    }
    if not any(d.get('id') == 'watchguard-permanent' for d in state['devices']):
        state['devices'].insert(0, wg_device)

    state['workspaces'].append(ws)
    state['activeWorkspaceId'] = DEMO_WS_ID

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, separators=(',', ':'))

    # ---------- copie « démo seule » pour hébergement statique ----------
    # demo/demo-state.json (versionné) : bibliothèque + workspace démo, SANS
    # les données perso de l'utilisateur. app.js la charge au démarrage quand
    # il n'y a ni serveur ni sauvegarde locale -> la démo s'affiche telle
    # quelle sur GitHub Pages.
    demo_only = {
        'devices': [wg_device] + new_devices,
        'workspaces': [ws],
        'activeWorkspaceId': DEMO_WS_ID,
    }
    demo_dir = os.path.join(ROOT, 'demo')
    os.makedirs(demo_dir, exist_ok=True)
    bundled_path = os.path.join(demo_dir, 'demo-state.json')
    with open(bundled_path, 'w', encoding='utf-8') as f:
        json.dump(demo_only, f, ensure_ascii=False, separators=(',', ':'))
    print('  démo autonome (statique) : %s (%.0f Ko)'
          % (bundled_path, os.path.getsize(bundled_path) / 1024))

    # ---------- résumé ----------
    nA = len(rackA_insts)
    nB = len(rackB_insts)
    print('Workspace « %s » écrit dans %s' % (DEMO_WS_ID, STATE_PATH))
    print('  baies : 2 (RACK-A 18U — %d équipements, RACK-B 16U — %d équipements)' % (nA, nB))
    print('  câbles : %d · sites : %d · flux : %d' % (len(cables), len(sites), len(flows)))
    print('  topologie : %d nœuds / %d liens' % (len(topology['nodes']), len(topology['links'])))
    print('  devices bibliothèque ajoutés : %d' % len(new_devices))

    # photo de chaque modèle (pour le rendu du plan)
    lib = {d['id']: d.get('photo') for d in new_devices}
    lib['watchguard-permanent'] = dataurl(WG_BASE)
    return ws, lib


# ------------------------------------------------- rendu plan + topo (JPEG) --

RACK_W, U_H = 356, 33


def render_plan(ws, lib_photos, out_path):
    racks = ws['racks']
    PAD = 60
    minX = min(r['x'] for r in racks) - PAD
    minY = min(r['y'] for r in racks) - PAD
    maxX = max(r['x'] + RACK_W for r in racks) + PAD
    maxY = max(r['y'] + 28 + 16 + r['sizeU'] * U_H for r in racks) + PAD
    W, H = maxX - minX, maxY - minY
    SCALE = 2
    im = Image.new('RGB', (W * SCALE, H * SCALE), hx('#e4e7ee'))
    d = ImageDraw.Draw(im)

    # grille de points
    for gx in range(0, W, 24):
        for gy in range(0, H, 24):
            cx, cy = (gx + 12) * SCALE, (gy + 12) * SCALE
            r = 1.3 * SCALE
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hx('#c9cfdb'))

    site_colors = {'site-a': '#60a5fa', 'site-b': '#34d399'}
    site_names = {s['id']: s['name'] for s in ws['sites']}

    def S(v):
        return v * SCALE

    for rack in racks:
        x = S(rack['x'] - minX)
        y = S(rack['y'] - minY)
        sizeU = rack['sizeU']
        bodyH = 16 + sizeU * U_H
        totalH = 28 + bodyH
        d.rounded_rectangle([x, y, x + S(RACK_W), y + S(totalH)], 8 * SCALE, fill=hx('#363b46'))
        d.rounded_rectangle([x, y, x + S(RACK_W), y + S(28)], 8 * SCALE, fill=hx('#3b4250'))
        d.rectangle([x, y + S(14), x + S(RACK_W), y + S(28)], fill=hx('#3b4250'))
        # LED
        d.ellipse([x + S(14), y + S(10), x + S(22), y + S(18)], fill=hx('#22c55e'))
        d.text((x + S(30), y + S(8)), rack['name'], font=F(12), fill=hx('#e8ebf1'))
        sname = site_names.get(rack.get('siteId'), '')
        tw = d.textlength(rack['name'], font=F(12))
        if sname:
            sc = site_colors.get(rack.get('siteId'), '#9aa3b2')
            d.rounded_rectangle([x + S(34) + tw, y + S(11), x + S(40) + tw, y + S(17)], 2, fill=hx(sc))
            d.text((x + S(44) + tw, y + S(8)), sname, font=F(9), fill=hx('#aab4c4'))

        # bâti
        by = y + S(28)
        d.rectangle([x, by, x + S(RACK_W), by + S(bodyH)], fill=hx('#333842'))
        fx, fy = x + S(6), by + S(8)
        fw = S(RACK_W - 12)
        d.rectangle([fx, fy, fx + fw, fy + S(sizeU * U_H)], fill=hx('#101318'))
        # règle des U
        d.rectangle([fx, fy, fx + S(22), fy + S(sizeU * U_H)], fill=hx('#e3e6ec'))
        for i in range(sizeU):
            uy = fy + S(i * U_H)
            d.line([fx, uy + S(U_H), fx + S(22), uy + S(U_H)], fill=hx('#b3b8c2'), width=1)
            num = str(sizeU - i)
            d.text((fx + S(11) - d.textlength(num, font=F(9)) / 2, uy + S(U_H / 2) - 6), num,
                   font=F(9), fill=hx('#606673'))
        # montants
        rail1 = fx + S(22)
        rail2 = fx + fw - S(17)
        for rl in (rail1, rail2):
            d.rectangle([rl, fy, rl + S(17), fy + S(sizeU * U_H)], fill=hx('#101318'))
        for i in range(sizeU):
            uy = fy + S(i * U_H)
            for hy in (4, 14, 24):
                for rl in (rail1, rail2):
                    d.rectangle([rl + S(4), uy + S(hy), rl + S(13), uy + S(hy) + S(5)], fill=hx('#05070a'))
        # zone intérieure
        inX = fx + S(22) + S(17)
        inW = S(292)
        d.rectangle([inX, fy, inX + inW, fy + S(sizeU * U_H)], fill=hx('#0b0d11'))
        # devices (photo : la sienne, sinon celle du modèle — comme instPhoto)
        for inst in rack['instances']:
            photo = inst.get('photo') or lib_photos.get(inst.get('deviceId'))
            dy = fy + S(inst['slot'] * U_H)
            dh = S(inst['sizeU'] * U_H)
            if photo:
                try:
                    b64 = photo.split(',', 1)[1]
                    raw = base64.b64decode(b64)
                    pic = Image.open(io.BytesIO(raw)).convert('RGB').resize((inW, dh))
                    im.paste(pic, (int(inX), int(dy)))
                except Exception:
                    pass
            else:
                d.rectangle([inX, dy, inX + inW, dy + dh], fill=hx('#b6bbc6'))
        # sites : étiquette sous la baie
        d.text((x, by + S(bodyH) + S(10)), site_names.get(rack.get('siteId'), ''), font=F(10), fill=hx('#5b6470'))

    im.save(out_path, 'JPEG', quality=82)
    return im.width, im.height


def render_topo(ws, out_path):
    nodes = ws['topology']['nodes']
    links = ws['topology']['links']
    inst_by_id = {i['id']: (r, i) for r in ws['racks'] for i in r['instances']}
    NW, NH = 190, 64
    xs = [n['x'] for n in nodes] + [n['x'] + NW for n in nodes]
    ys = [n['y'] for n in nodes] + [n['y'] + NH for n in nodes]
    M = 50
    W = max(xs) - min(xs) + 2 * M
    H = max(ys) - min(ys) + 2 * M
    ox, oy = M - min(xs), M - min(ys)
    im = Image.new('RGB', (W, H), hx('#0d1017'))
    d = ImageDraw.Draw(im)

    def P(n):
        return n['x'] + ox, n['y'] + oy

    byid = {n['id']: n for n in nodes}

    # liens
    for l in links:
        na, nb = byid[l['a']], byid[l['b']]
        if not na or not nb:
            continue
        x1, y1 = P(na)
        x2, y2 = P(nb)
        x1 += NW / 2; y1 += NH / 2; x2 += NW / 2; y2 += NH / 2
        color = l.get('color') or '#60a5fa'
        if l.get('style') == 'dashed':
            # ligne pointillée manuelle
            import math
            length = math.hypot(x2 - x1, y2 - y1)
            if length:
                ux, uy = (x2 - x1) / length, (y2 - y1) / length
                pos = 0.0
                while pos < length:
                    end = min(pos + 7, length)
                    d.line([x1 + ux * pos, y1 + uy * pos, x1 + ux * end, y1 + uy * end],
                           fill=hx(color), width=2)
                    pos = end + 5
        else:
            d.line([x1, y1, x2, y2], fill=hx(color), width=2)
        label = ' · '.join(p for p in (l.get('label'), l.get('speed'), 'VLAN ' + l['vlan'] if l.get('vlan') else '') if p)
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2 - 6
            f = F(11)
            for dx in (-1.5, 1.5):
                for dy in (-1.5, 1.5):
                    d.text((mx - d.textlength(label, font=f) / 2 + dx, my + dy), label, font=f, fill=hx('#0b0d11'))
            d.text((mx - d.textlength(label, font=f) / 2, my), label, font=f, fill=hx('#e6ecf5'))

    # nœuds
    for n in nodes:
        x, y = P(n)
        d.rounded_rectangle([x, y, x + NW, y + NH], 8, fill=hx('#1b2536'), outline=hx('#33405a'), width=2)
        d.ellipse([x + 10, y + 12, x + 18, y + 20], fill=hx('#22c55e'))
        info = inst_by_id.get(n.get('instId'))
        name = info[1]['name'] if info else '?'
        brand = (info[1].get('brand', '') + ' ' + info[1].get('model', '')).strip() if info else ''
        rack_u = ('%s · U%d' % (info[0]['name'].split(' — ')[0], info[1]['slot'] + 1)) if info else ''
        ipmg = info[1].get('ipMgmt', '') if info else ''
        d.text((x + 26, y + 8), name, font=F(13), fill=hx('#f3f6fb'))
        d.text((x + 26, y + 28), brand or '—', font=F(10), fill=hx('#8b98ad'))
        sub2 = rack_u + (' · ' + ipmg if ipmg else '')
        d.text((x + 26, y + 45), sub2, font=F(9), fill=hx('#5f6b80'))

    im.save(out_path, 'JPEG', quality=88)
    return im.width, im.height


if __name__ == '__main__':
    # Consoles Windows : s'assurer que les accents s'affichent
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    ws, lib_photos = build()
    demo_dir = os.path.join(ROOT, 'demo')
    os.makedirs(demo_dir, exist_ok=True)
    pw, ph = render_plan(ws, lib_photos, os.path.join(demo_dir, 'plan-baies.jpg'))
    tw, th = render_topo(ws, os.path.join(demo_dir, 'topologie.jpg'))
    print('Plan  : %dx%d -> demo/plan-baies.jpg' % (pw, ph))
    print('Topo  : %dx%d -> demo/topologie.jpg' % (tw, th))
    print('')
    print('Workspace « Datacenter Démo » prêt — ouvre (ou recharge F5) l’application.')
    print('PDF : dans l’application, menu Exporter → 📕 Document LLD.')
