#!/usr/bin/env python3
"""News metadata collector. Keeps prior genuine articles and records source failures."""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, urldefrag
from bs4 import BeautifulSoup

OUT = Path('data/news.json')
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; BasketballNewsCollector/0.2)', 'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.7'}
SOURCES = [
    {'name': 'BB1.hu', 'urls': ['https://bball1.hu/', 'https://bball1.hu/hirek/', 'https://bb1.hu/'], 'hosts': ('bball1.hu', 'bb1.hu'), 'kind': 'bb1'},
    {'name': 'WBasket.hu', 'urls': ['https://wbasket.hu/'], 'hosts': ('wbasket.hu',), 'kind': 'wbasket'},
    {'name': 'Hunbasket', 'urls': ['https://hunbasket.hu/hirek', 'https://hunbasket.hu/hirek/ferfi/', 'https://hunbasket.hu/hirek/noi/'], 'hosts': ('hunbasket.hu',), 'kind': 'hunbasket'},
    {'name': 'Kezdő5.hu', 'urls': ['https://kezdo5.hu/magyar-ferfi/hirek', 'https://kezdo5.hu/magyar-noi/hirek', 'https://kezdo5.hu/'], 'hosts': ('kezdo5.hu',), 'kind': 'kezdo5'},
    {'name': 'Nemzeti Sport', 'urls': ['https://www.nemzetisport.hu/rovat/kosarlabda'], 'hosts': ('nemzetisport.hu',), 'kind': 'nso'},
]

# Optional, manually verified official club feeds. No unverified domains are assumed.
# Each record: {"name": "Club name", "urls": ["https://official.club/news"],
#               "hosts": ["official.club"], "kind": "club"}
CLUB_CONFIG = Path('data/news_club_sources.json')
if CLUB_CONFIG.exists():
    try:
        club_sources = json.loads(CLUB_CONFIG.read_text(encoding='utf-8'))
        if not isinstance(club_sources, list):
            raise ValueError('Club source configuration must be a list')
        for club in club_sources:
            if not isinstance(club, dict) or not club.get('name') or not club.get('urls') or not club.get('hosts'):
                raise ValueError('Invalid club source record')
            hosts = tuple(str(x).lower().removeprefix('www.') for x in club['hosts'])
            urls = [str(u) for u in club['urls'] if str(u).startswith('https://')]
            if not urls or not hosts:
                raise ValueError('Invalid club source URL or host')
            SOURCES.append({'name': 'Klub: ' + club['name'], 'urls': urls, 'hosts': hosts, 'kind': 'club', 'article_pattern': club.get('article_pattern', ''), 'listing_selector': club.get('listing_selector', '')})
    except (ValueError, OSError, TypeError) as exc:
        print('CLUB CONFIG ERROR:', exc, file=sys.stderr)

def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip()

def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=22) as response:
        final = response.geturl()
        return BeautifulSoup(response.read(), 'html.parser'), final

def metadata(soup, *names):
    for name in names:
        tag = soup.find('meta', attrs={'property': name}) or soup.find('meta', attrs={'name': name})
        if tag and tag.get('content'):
            return clean(tag['content'])
    return ''

def canonical(url):
    return urldefrag(url)[0].split('?')[0].rstrip('/') + '/'

def valid_url(url, src):
    p = urlparse(url)
    host = (p.hostname or '').removeprefix('www.')
    if p.scheme not in ('http', 'https') or host not in src['hosts']:
        return False
    path = p.path.lower().rstrip('/')
    if src['kind'] == 'hunbasket':
        return bool(re.match(r'^/hir/\d+/[^/]+$', path))
    if src['kind'] == 'club' and src.get('article_pattern'):
        return bool(re.search(src['article_pattern'], path))
    if src['kind'] == 'nso':
        # Nemzeti Sport news articles have a category prefix and an article slug.
        return bool(re.match(r'^/kosarlabda/\d{4}/\d{2}/[^/]+$', path))
    if src['kind'] == 'kezdo5':
        # Kezdő5 articles: /magyar-ferfi/hirek/article-slug or equivalent categories.
        return bool(re.match(r'^/[^/]+/(?:hirek|cikkek|interjuk)/[^/]+$', path))
    if path in ('', '/hirek', '/latest-news'):
        return False
    if any(path.startswith(prefix) for prefix in ('/tag/', '/category/', '/page/', '/author/', '/kereso/', '/search/', '/csapat/', '/jatekos/', '/menetrend/', '/tabella/', '/wp-content/')):
        return False
    return len([part for part in path.split('/') if part]) >= 1

def candidates(soup, base, src):
    links = {}
    if src['kind'] == 'hunbasket':
        anchors = soup.select('a[href*="/hir/"]')
    elif src['kind'] == 'club' and src.get('listing_selector'):
        anchors = soup.select(src['listing_selector'])
    elif src['kind'] in ('nso', 'kezdo5', 'club'):
        anchors = soup.select('article a[href], h2 a[href], h3 a[href], h4 a[href], .entry-title a[href], .post-title a[href], a[href]')
    else:
        anchors = soup.select('article a[href], h2 a[href], h3 a[href], .entry-title a[href], .post-title a[href]')
        if not anchors:
            anchors = soup.select('a[href]')

