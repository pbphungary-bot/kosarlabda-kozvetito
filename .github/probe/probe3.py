"""Third read-only probe: game records inside the Next.js flight data (temporary)."""
import json, re, urllib.request

UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito)'
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')

def flight(html):
    parts = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html)
    out = []
    for p in parts:
        try: out.append(json.loads('"' + p + '"'))
        except Exception: pass
    return ''.join(out)

def balanced(text, i):
    depth = 0; instr = False; esc = False
    for j in range(i, len(text)):
        c = text[j]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0: return text[i:j + 1]
    return None

def probe(name, url, key_hint):
    html = get(url); fl = flight(html)
    print('=' * 90); print(name, url, '| html', len(html), '| flight', len(fl))
    for k in ['"gameId"', '"homeTeam"', '"awayTeam"', '"startTime"', '"gameDate"', '"homeScore"', '"status"', '"games"']:
        print(f'  {k}: {fl.count(k)}', end='')
    print()
    # objects that look like games: start at the opening brace before "gameId"
    objs = []
    for m in re.finditer(r'\{"[a-zA-Z]*[gG]ame[a-zA-Z]*":', fl):
        o = balanced(fl, m.start())
        if o and len(o) > 200: objs.append(o)
        if len(objs) > 400: break
    print('  candidate game-like objects:', len(objs))
    if objs:
        try:
            j = json.loads(objs[0]); print('  first object keys:', list(j.keys())[:40])
        except Exception as e: print('  first object parse fail', e)
    hit = next((o for o in objs if key_hint.lower() in o.lower()), None)
    print('  object mentioning', key_hint, ':', (hit or 'none')[:2600])
    # any record with game-like timing
    m = re.search(r'.{200}"startTime".{600}', fl, re.S)
    print('  startTime context:', (m.group(0) if m else 'none')[:900])

probe('EuroCup W games', 'https://www.fiba.basketball/en/events/eurocup-women-26-27/games', 'dvtk')
probe('BCL games', 'https://www.championsleague.basketball/en/games', 'falco')
