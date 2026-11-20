"""Regression tests for club-site collection fixes (URL handling, 403 retry, WordPress/sitemap fallback)."""
from pathlib import Path
import sys, json, urllib.error
sys.path.insert(0, str(Path(__file__).parent))
import update_news as n
from bs4 import BeautifulSoup
from unittest.mock import patch

# 1. File-style article URLs must not get a trailing slash (Egis Körmend served 404 for *.html/).
assert n.canonical('https://www.egiskormend.hu/Hirek/Valami_cikk.html/') == 'https://www.egiskormend.hu/Hirek/Valami_cikk.html'
assert n.canonical('https://sopronkc.hu/cikk-1') == 'https://sopronkc.hu/cikk-1/'
assert n.canonical('https://www.albakosar.hu/index.php?pg=news_3_123') == 'https://www.albakosar.hu/index.php?pg=news_3_123'

# 2. Non-ASCII slugs (NKA Pécs: ellipsis) must be percent-encoded instead of raising UnicodeEncodeError.
u = n.safe_url('https://www.nkapecs.hu/tartalmak/Remeljuk--melypontja…')
u.encode('ascii')
assert u.endswith('%E2%80%A6'), u
assert n.safe_url('https://example.com/a%20b') == 'https://example.com/a%20b'   # already-encoded input is untouched

# 3. A 403 on the first header set is retried once with browser-like headers; other errors are not retried.
calls = []
class Resp:
    headers = {'Content-Type': 'text/html'}
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return b'<html></html>'
    def geturl(self): return 'https://example.com/'
def fake_urlopen(req, timeout=0):
    calls.append(dict(req.header_items()))
    if len(calls) == 1:
        raise urllib.error.HTTPError(req.full_url, 403, 'Forbidden', {}, None)
    return Resp()
with patch.object(n.urllib.request, 'urlopen', fake_urlopen):
    payload, final, ctype = n.fetch_raw('https://example.com/')
assert len(calls) == 2 and 'Sec-fetch-mode' in calls[1], calls
def not_found(req, timeout=0):
    raise urllib.error.HTTPError(req.full_url, 404, 'Not Found', {}, None)
with patch.object(n.urllib.request, 'urlopen', not_found):
    try:
        n.fetch_raw('https://example.com/x'); raise SystemExit('404 must propagate')
    except urllib.error.HTTPError as e:
        assert e.code == 404

# 4. WordPress REST fallback finds articles that the HTML listing hides; foreign hosts and non-article paths are rejected.
src = {'name': 'Klub: Test', 'kind': 'club', 'hosts': ('example.com',), 'article_pattern': r'^/\d{4}/\d{2}/\d{2}/[^/]+$'}
posts = [{'link': 'https://example.com/2026/11/18/nagy-gyozelem-itthon/', 'title': {'rendered': 'Nagy győzelem itthon &#8211; összefoglaló'}},
         {'link': 'https://evil.example.org/2026/11/18/idegen-cikk/', 'title': {'rendered': 'Idegen oldal cikke itt'}},
         {'link': 'https://example.com/rolunk/', 'title': {'rendered': 'Rólunk és a klubról'}}]
with patch.object(n, 'fetch_raw', return_value=(json.dumps(posts).encode(), 'https://example.com/wp-json/', 'application/json')):
    found, notes = n.fallback_candidates('https://example.com/', src)
assert list(found) == ['https://example.com/2026/11/18/nagy-gyozelem-itthon/'], found
assert 'wp-json:1' in notes

# 5. Sitemap fallback (REST API unavailable) orders newest first and honours the club's URL rule.
sm = BeautifulSoup('<urlset><url><loc>https://example.com/2026/01/02/regi-hir-a-szezonrol/</loc><lastmod>2026-01-02</lastmod></url>'
                   '<url><loc>https://example.com/2026/11/17/friss-hir-a-meccsrol/</loc><lastmod>2026-11-17</lastmod></url>'
                   '<url><loc>https://example.com/kapcsolat/</loc><lastmod>2026-11-18</lastmod></url></urlset>', 'xml')
def fetch_stub(url, timeout=12):
    if 'sitemap' in url and url.endswith('/wp-sitemap-posts-post-1.xml'):
        return sm, url
    raise urllib.error.URLError('no')
with patch.object(n, 'fetch_raw', side_effect=urllib.error.HTTPError('u', 404, 'nf', {}, None)), patch.object(n, 'fetch', fetch_stub):
    found, notes = n.fallback_candidates('https://example.com/', src)
assert list(found)[0].endswith('friss-hir-a-meccsrol/') and len(found) == 2, found

# 6. Shipped club configuration is internally consistent.
cfg = json.loads((Path(__file__).parent.parent / 'data' / 'news_club_sources.json').read_text(encoding='utf-8'))
assert len(cfg) == 25
import re
for club in cfg:
    re.compile(club['article_pattern'])
    assert club['urls'] and club['hosts'], club['name']
    for url in club['urls']:
        assert (n.urlparse(url).hostname or '').removeprefix('www.') in club['hosts'], (club['name'], url)
print('Club collection regression tests passed')
