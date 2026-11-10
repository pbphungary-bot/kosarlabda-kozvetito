import json, os, sys, tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import update_news as n
from bs4 import BeautifulSoup
assert n.canonical('https://site.hu/article/?utm_source=foo&id=12')=='https://site.hu/article/?id=12'
assert n.canonical('https://site.hu/article/?id=12&fbclid=123')=='https://site.hu/article/?id=12'
assert n.canonical('https://site.hu/article/?id=13') != n.canonical('https://site.hu/article/?id=12')
assert not n.summary_usable({'title':'Example','summary':'Example','summary_method':'headline_fallback'})
assert n.summary_usable({'title':'Example','summary':'This is a sufficiently detailed summary of a basketball game with verified scores.','summary_method':'article_body'})
assert not n.valid_publication({'published_at':'2012-01-01'})
assert n.valid_publication({'published_at':'2026-11-10T10:00:00+00:00'}, n.datetime(2026,11,10,12,tzinfo=n.timezone.utc))
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'news.json'
 n.atomic_json(p,{'articles':[{'title':'Hungarian text: Szolnok és Pécs'}]})
 assert json.loads(p.read_text())['articles'][0]['title'].endswith('Pécs')
 assert not list(Path(d).glob('*.tmp'))
print('All offline tests passed')
