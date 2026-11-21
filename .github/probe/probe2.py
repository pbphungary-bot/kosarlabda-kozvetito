"""Second read-only probe: structure of FIBA game lists (temporary)."""
import json, re, urllib.request

UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito)'
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')

def show(title, s, n=2500):
    print('=' * 90); print(title); print(s[:n])

pg = get('https://www.fiba.basketball/en/events/eurocup-women-26-27/games')
i = pg.find('DVTK')
show('A. HTML around the first DVTK mention in the EuroCup Women games page', re.sub(r'\s+', ' ', pg[max(0, i - 1800): i + 1800]), 3700)
classes = {}
for c in re.findall(r'class="([^"]+)"', pg):
    for k in c.split():
        if re.search(r'game|match|score|team|date|schedule', k, re.I): classes[k] = classes.get(k, 0) + 1
show('B. class names (game/match/score/team/date) with counts', json.dumps(sorted(classes.items(), key=lambda x: -x[1])[:40]))
links = re.findall(r'href="(/en/events/eurocup-women-26-27/games/[^"]+)"', pg)
show('C. game links on /games page', f'{len(links)} links, unique {len(set(links))}; first: {links[:6]}')
# a DVTK game page
m = re.search(r'href="(/en/events/eurocup-women-26-27/games/[^"]+)"[^>]*>(?:(?!</a>).){0,1500}?DVTK', pg, re.S)
print('DVTK game link:', m.group(1) if m else None)
if m:
    g = get('https://www.fiba.basketball' + m.group(1))
    show('D. DVTK game page title + text', re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', g, flags=re.S)))[:1200], 1300)
    for b in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', g, re.S)[:2]:
        show('E. ld+json of the DVTK game page', b, 1800)
    show('F. meta tags', ' | '.join(re.findall(r'<meta (?:property|name)="(?:og:title|og:description|description)" content="([^"]*)"', g)), 800)
# Champions League game page ld+json + games list page
bg = get('https://www.championsleague.basketball/en/games/136252-FAL-AEK')
for b in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', bg, re.S)[:2]:
    show('G. BCL game ld+json', b, 2500)
try:
    lst = get('https://www.championsleague.basketball/en/games')
    show('H. BCL /en/games', f"{len(lst)} bytes; title={re.search('<title>(.*?)</title>', lst, re.S).group(1)[:90]}; game links={len(set(re.findall(r'/en/games/[0-9]+-[A-Z0-9-]+', lst)))}; Falco={lst.count('Falco')}", 600)
    i = lst.find('FAL-')
    show('I. BCL list HTML around a Falco game link', re.sub(r'\s+', ' ', lst[max(0, i - 1200): i + 1200]), 2500)
except Exception as e:
    print('H failed', e)
