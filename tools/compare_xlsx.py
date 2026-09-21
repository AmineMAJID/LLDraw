#!/usr/bin/env python3
"""Compare deux classeurs XLSX cellule par cellule (valeurs uniquement).
Usage : python3 compare_xlsx.py export.xlsx reference.xlsx [--sheet NOM] [--out rapport.md]"""
import sys, openpyxl

def load(p):
    wb = openpyxl.load_workbook(p, data_only=True)
    out = {}
    for name in wb.sheetnames:
        ws = wb[name]
        rows = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and str(c.value).strip() != '':
                    rows.setdefault(c.row, {})[c.column] = str(c.value)
        out[name] = rows
    return out

def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    only = None
    if '--sheet' in sys.argv:
        only = sys.argv[sys.argv.index('--sheet') + 1]
    lines = []
    A, B = load(a_path), load(b_path)
    # classeurs de référence : colonnes A..J -> lettres
    def col_letter(i):
        s = ''
        while i: i, r = divmod(i - 1, 26); s = chr(65 + r) + s
        return s
    sheets = [only] if only else list(dict.fromkeys(list(A) + list(B)))
    for name in sheets:
        a, b = A.get(name, {}), B.get(name, {})
        rows = sorted(set(a) | set(b))
        diffs = []
        for r in rows:
            cols = sorted(set(a.get(r, {})) | set(b.get(r, {})))
            for c in cols:
                va, vb = a.get(r, {}).get(c), b.get(r, {}).get(c)
                if va != vb:
                    diffs.append((f"{col_letter(c)}{r}", va, vb))
        if diffs:
            lines.append(f"\n### Feuille « {name} » — {len(diffs)} différence(s)")
            for ref, va, vb in diffs:
                lines.append(f"- {ref}: EXPORT={va!r}  |  REF={vb!r}")
        else:
            lines.append(f"\n### Feuille « {name} » — identique")
    txt = '\n'.join(lines)
    print(txt)
    if '--out' in sys.argv:
        open(sys.argv[sys.argv.index('--out') + 1], 'w').write(txt)

if __name__ == '__main__':
    main()
