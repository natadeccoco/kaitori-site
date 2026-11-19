# 宅配買取店（@coco_netshop）のピックアップ買取画像を、その時点の買取価格で作る。
# GitHub Actions（build.yml）でサイトを作り直すたびに動き、dist/xpick/ に
#   today.json … 日付・カテゴリごとの今日のパターン番号と中身（GASが投稿前に読む）
#   <cat>.png  … 今日のカテゴリの画像（box / mega / sv / ss / sm / xy）
# を書き出す。パターンの中身は xpick/patterns.json（雄司さんと決めた42パターン）。
# 価格は data_sheet.json（買取表）の今の値。載せるカードが買取表から消えたら、そのカードだけ外して並べ直す。
import json, os, subprocess, sys, datetime, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
X = os.path.join(ROOT, 'xpick')
OUT = os.path.join(ROOT, 'dist', 'xpick')
CATS = ['box', 'mega', 'sv', 'ss', 'sm', 'xy']          # 投稿順（8:30 / 10:30 / 14:00 / 16:00 / 18:00 / 19:30）
START = datetime.date(2026, 11, 20)                        # この日を1日目としてパターンを回す
JST = datetime.timezone(datetime.timedelta(hours=9))

def load():
    d = json.load(open(os.path.join(ROOT, 'data_sheet.json'), encoding='utf-8'))
    tabs = {t['tab']: t['rows'] for t in d['tabs']}
    its = json.load(open(os.path.join(ROOT, 'dist', 'data', 'items.json'), encoding='utf-8'))['items']
    idx, bx = {}, {}
    for i in its:
        idx.setdefault((i.get('exp', '').upper(), i.get('no', ''), i['name']), i)
        if i['cat'] == 'BOX': bx.setdefault(i['name'], i)
    return tabs, idx, bx

def resolve(p, tabs, idx, bx):
    out, used = [], set()
    for s in p['items']:
        if s['tab'] == 'BOX':
            r = [r for r in tabs.get('BOX', []) if r['name'] == s['name']]
            m = bx.get(s['name'])
            if not r or not m or not m.get('img') or not r[0]['price']: continue
            out.append(dict(name=s['name'], price=r[0]['price'], price2=r[0].get('price2') or 0, img=m['img']))
            continue
        cand = [r for r in tabs.get(s['tab'], []) if r['name'] == s['name'] and r['rarity'] == s['rarity'] and r['price']]
        cand.sort(key=lambda r: -r['price'])
        for r in cand:
            k = (r['exp'], r['no'], r['name'])
            if k in used: continue
            m = idx.get((r['exp'].upper(), r['no'], r['name']))
            if not m or not m.get('img'): continue
            used.add(k); out.append(dict(name=r['name'], price=r['price'], img=m['img'])); break
    out.sort(key=lambda c: -c['price'])
    return out

def imgsrc(img, kind):
    f = os.path.basename(img)
    if kind == 'box':
        cut = os.path.join(X, 'boxcut', f)
        if os.path.exists(cut): return 'file://' + cut
    return 'file://' + os.path.join(ROOT, 'img', 'cards', f)

def panel(c, x, y, w, h, big, kind):
    e = html.escape
    name = c['name'].replace('ポケモンカード', '') if kind == 'box' else c['name'].replace('(SA)', '（SA）')
    L = len(name)
    if big: nf = 56 if L <= 10 else (44 if L <= 14 else 36)
    else:
        cap = max(10, int((w - 40) / 34)); nf = 34 if L <= cap else max(17, int(34 * cap / L))
    nh = 92 if big else 56
    rows = ([('シュリンク付', c['price'])] + ([('シュリンクなし', c['price2'])] if c.get('price2') else [])) if kind == 'box' else [('' if w < 400 else '買取価格', c['price'])]
    horiz = (not big) and len(rows) == 2
    rh = (90 if big else 92) if len(rows) == 2 else (110 if big else 66)
    lf = (40 if big else 22) if len(rows) == 2 else (46 if big else 30)
    pf = (74 if big else 44) if len(rows) == 2 else (80 if big else 56)
    rows_h = rh if horiz else rh * len(rows) + 8 * (len(rows) - 1)
    bp = 16 if big else 12
    it = nh + (6 if big else 2)
    ih = int(h - it - bp - rows_h - 4)
    rh_ = ''.join(f'<div class="row" style="height:{rh}px;{"justify-content:center" if not l else ""}">{f"<b style=font-size:{lf}px>{l}</b>" if l else ""}<span style="font-size:{pf}px"><small>¥</small>{p:,}</span></div>' for l, p in rows)
    return (f'<div class="pn{" nf" if big else ""}" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div class="in">'
            f'<div class="nm" style="font-size:{nf}px;height:{nh}px;line-height:{nh - 4}px">{e(name)}</div>'
            f'<img class="im" src="{imgsrc(c["img"], kind)}" style="top:{it}px;height:{ih}px;width:{w - (20 if big else 0)}px">'
            f'<div class="rows{" h" if horiz else ""}" style="bottom:{bp}px">{rh_}</div></div></div>')

def page(items, chip, kind, stamp, camp):
    css = open(os.path.join(X, 'style.css'), encoding='utf-8').read()
    h = [f'<style>{css}</style>', '<div class="bg"></div><div class="rays"></div>', '<div class="sp" style="left:690px;top:52px">✦</div>']
    h.append(f'<img class="logo" src="file://{ROOT}/logo.png"><img class="chara" src="file://{ROOT}/img/chars/chan3.webp">')
    h.append(f'<div class="sub">{html.escape(chip)}</div>')
    t = '高額買取中!'
    h.append('<div class="title">' + ''.join(f'<span class="t{i}">{t}</span>' for i in (1, 2, 3)) + f'<span style="visibility:hidden;position:static">{t}</span></div>')
    n = len(items)
    if n == 1:
        h.append(panel(items[0], 250, 236, 700, 852, True, kind))
    elif n in (2, 4) and kind == 'box':
        W, H = 545, 422
        for k, c in enumerate(items): h.append(panel(c, [600 - W - 12, 612][k % 2], [236, 668][k // 2] + (216 if n == 2 else 0), W, H, False, kind))
    elif n in (2, 3):
        W = 372; xs = [28, 414, 800] if n == 3 else [214, 600]
        for k, c in enumerate(items): h.append(panel(c, xs[k], 300, W, 700, False, kind))
    elif n == 4:
        W, H = 545, 422
        for k, c in enumerate(items): h.append(panel(c, [600 - W - 12, 612][k % 2], [236, 668][k // 2], W, H, False, kind))
    else:   # 5〜6
        W, H = 372, 422
        for k, c in enumerate(items[:6]):
            row = k // 3; inrow = 3 if row == 0 else len(items) - 3
            x0 = (1200 - (inrow * W + (inrow - 1) * 14)) / 2
            h.append(panel(c, x0 + (k % 3) * (W + 14), [236, 668][row], W, H, False, kind))
    if camp: h.append(camp)
    h.append(f'<div class="note">※{stamp}時点の価格です</div>')
    return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + ''.join(h) + '</body></html>'

def main():
    now = datetime.datetime.now(JST)
    today = now.date()
    if len(sys.argv) > 1: today = datetime.date.fromisoformat(sys.argv[1])
    day = (today - START).days
    tabs, idx, bx = load()
    P = json.load(open(os.path.join(X, 'patterns.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)
    camp = '<div class="bottom">11/30お申込みまで 表記金額から <b>さらに5%UP!</b></div>' if today <= datetime.date(2026, 11, 30) else ''
    stamp = f'{today.month}/{today.day} {now.strftime("%H:%M")}'
    res = {'date': today.isoformat(), 'built': now.isoformat(timespec='seconds'), 'cats': {}}
    for ci, cat in enumerate(CATS):
        ps = sorted([p for p in P if p['cat'] == cat], key=lambda p: p['no'])
        p = ps[(day + ci) % len(ps)]       # カテゴリごとにずらして、同じ日に1枚ドンが重ならないようにする
        items = resolve(p, tabs, idx, bx)
        if not items: print(cat, 'NG: 載せるカードがありません'); continue
        kind = 'box' if cat == 'box' else 'card'
        fn = os.path.join(OUT, f'{cat}.html'); png = os.path.join(OUT, f'{cat}.png')
        open(fn, 'w', encoding='utf-8').write(page(items, p['chip'], kind, stamp, camp))
        r = subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                            '--force-device-scale-factor=1', '--window-size=1200,1200', '--virtual-time-budget=4000', f'--screenshot={png}', 'file://' + fn],
                           capture_output=True, text=True, timeout=120)
        os.remove(fn)
        if not os.path.exists(png): print(cat, 'NG: 画像を作れませんでした', r.stderr[-300:]); continue
        typ = {1: '1card', 3: '3cards', 4: '4cards'}.get(len(p['items']), f'{len(p["items"])}cards')
        res['cats'][cat] = {'no': p['no'], 'chip': p['chip'], 'type': typ, 'count': len(items),
                            'items': [[c['name'], c['price']] + ([c['price2']] if c.get('price2') else []) for c in items]}
        print(cat, p['no'], len(items), os.path.getsize(png))
    json.dump(res, open(os.path.join(OUT, 'today.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
