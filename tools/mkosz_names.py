"""Official spelling of the players' names from the mkosz.hu match page.

The live feed (netcasting) writes ő and ű as a literal "?" ("Enik?", "Cs?sz"): the letter never reaches us. The mkosz.hu match page
(https://mkosz.hu/merkozes/<season>/<competition>/<game code>) links every player as .../jatekos/<season>/<competition>/<player number>/<slug> with the
correctly spelled name as the link title, and the player number is the very number the feed uses (Jatekos|201536). So the names are matched by number, never guessed.
"""
import html, re, time, urllib.request

LINK = re.compile(r'<a\s+href="https?://(?:www\.)?mkosz\.hu/jatekos/[^/"]+/[^/"]+/(\d+)/[^"]*"\s+title="([^"]*)"', re.I)

def parse_names(page):
    """{player number: name} from the HTML of an mkosz.hu match page (first spelling wins)."""
    out = {}
    for m in LINK.finditer(page or ''):
        name = ' '.join(html.unescape(m.group(2)).split())
        if name and m.group(1) not in out: out[m.group(1)] = name
    return out

def season(now=None):
    """'x2627' for the 2026/27 season (it starts in August)."""
    t = now or time.localtime()
    y = t.tm_year if t.tm_mon >= 8 else t.tm_year - 1
    return f'x{y % 100:02d}{(y + 1) % 100:02d}'

def match_url(game, now=None):
    return f'https://mkosz.hu/merkozes/{season(now)}/{game.split("_")[0]}/{game}'

def fetch_names(game):
    req = urllib.request.Request(match_url(game), headers={'User-Agent': 'kosarlabda-kozvetito-live-relay'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return parse_names(r.read(3_000_000).decode('utf-8', 'replace'))
