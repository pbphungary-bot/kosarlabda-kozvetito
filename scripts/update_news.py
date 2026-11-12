#!/usr/bin/env python3
"""News metadata collector. Keeps prior genuine articles and records source failures."""
import json
import os
import tempfile
from collections import Counter
import html
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, urldefrag, urlencode, quote
from bs4 import BeautifulSoup

OUT = Path('data/news.json')
HEALTH = Path('data/news_health.json')
MAX_AGE_DAYS = 45
MIN_SUMMARY_LENGTH = 55
HEADERS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.7', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}
SOURCES = [
    {'name': 'BB1.hu', 'urls': ['https://bball1.hu/', 'https://bball1.hu/hirek/', 'https://bb1.hu/'], 'hosts': ('bball1.hu', 'bb1.hu'), 'kind': 'bb1'},
    {'name': 'WBasket.hu', 'urls': ['https://wbasket.hu/'], 'hosts': ('wbasket.hu',), 'kind': 'wbasket'},
    {'name': 'Hunbasket', 'urls': ['https://hunbasket.hu/hirek', 'https://hunbasket.hu/hirek/ferfi/', 'https://hunbasket.hu/hirek/noi/'], 'hosts': ('hunbasket.hu',), 'kind': 'hunbasket'},
    {'name': 'Kezdő5.hu', 'urls': ['https://kezdo5.hu/magyar-ferfi', 'https://kezdo5.hu/noi', 'https://kezdo5.hu/magyar-ferfi/hirek', 'https://kezdo5.hu/noi/hirek', 'https://kezdo5.hu/europa'], 'hosts': ('kezdo5.hu',), 'kind': 'kezdo5'},
    {'name': 'Nemzeti Sport', 'urls': ['https://www.nemzetisport.hu/kosarlabda'], 'hosts': ('nemzetisport.hu',), 'kind': 'ns'},
]

def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip()

def fetch(url, timeout=12):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        final = response.geturl()
        payload = response.read()
        content_type = response.headers.get('Content-Type', '').lower()
        is_xml = ('xml' in content_type or payload.lstrip().startswith((b'<?xml', b'<rss', b'<feed')))
        return BeautifulSoup(payload, 'xml' if is_xml else 'html.parser'), final

def metadata(soup, *names):
    for name in names:
        tag = soup.find('meta', attrs={'property': name}) or soup.find('meta', attrs={'name': name})
        if tag and tag.get('content'):
            return clean(tag['content'])
    return ''

def canonical(url):
    # Preserve query parameters on legacy club websites where the article ID lives in ?pg=.
    raw = urldefrag(url)[0]
    parsed = urlparse(raw)
    if parsed.query and 'pg=news_3_' in parsed.query:
        return raw
    # Keep meaningful article identifiers in query strings; discard only tracking keys.
    from urllib.parse import parse_qsl, urlunparse
    pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if not (k.lower().startswith('utm_') or k.lower() in ('fbclid','gclid','ref','source'))]
    from urllib.parse import urlencode
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/') + '/', '', urlencode(sorted(pairs)), ''))

def valid_url(url, src):
    p = urlparse(url)
    host = (p.hostname or '').removeprefix('www.')
    if p.scheme not in ('http', 'https') or host not in src['hosts']:
        return False
    path = p.path.lower().rstrip('/')
    if src['kind'] == 'hunbasket':
        return bool(re.match(r'^/hir/\d+/[^/]+$', path))
    if src['kind'] == 'kezdo5':
        return bool(re.match(r'^/(?:magyar-ferfi|noi|europa)/(?!hirek$)[^/]+(?:/[^/]+)?$', path)) and not path.endswith('/hirek')
    if src['kind'] == 'ns':
        # Restrict to the basketball section; the listing contains unrelated sports.
        return bool(re.match(r'^/kosarlabda/20\d{2}/\d{2}/[^/]+', path)) or bool(re.match(r'^/kosarlabda/[^/]+-[a-z0-9]+$', path))
    if src['kind'] == 'club':
        path_query = p.path.rstrip('/') + ('?' + p.query if p.query else '')
        return bool(re.search(src['article_pattern'], path_query, re.I))
    if path in ('', '/hirek', '/latest-news'):
        return False
    if any(path.startswith(prefix) for prefix in ('/tag/', '/category/', '/page/', '/author/', '/kereso/', '/search/', '/csapat/', '/jatekos/', '/menetrend/', '/tabella/', '/wp-content/')):
        return False
    return len([part for part in path.split('/') if part]) >= 1

def candidates(soup, base, src):
    links = {}
    if src['kind'] == 'hunbasket':
        anchors = soup.select('a[href*="/hir/"]')
    elif src['kind'] == 'kezdo5':
        anchors = soup.select('article a[href], h2 a[href], h3 a[href], .entry-title a[href], a[href*="/magyar-ferfi/"], a[href*="/noi/"], a[href*="/europa/"]')
    elif src['kind'] == 'club':
        anchors = soup.select(src.get('listing_selector') or 'article a[href], h2 a[href], h3 a[href]')
        # Club CMS layouts vary; configured selectors frequently miss real article links.
        # The source-specific URL rule remains the final gate.
        if len(anchors) < 7:
            anchors = soup.select('a[href]')
    else:
        anchors = soup.select('article a[href], h2 a[href], h3 a[href], .entry-title a[href], .post-title a[href]')
        if not anchors or src['kind'] == 'bb1':
            anchors = soup.select('a[href]')
    for a in anchors:
        title = clean(a.get_text(' ', strip=True) or a.get('title') or '')
        if not 12 <= len(title) <= 250:
            continue
        url = canonical(urljoin(base, a.get('href', '')))
        if valid_url(url, src):
            links.setdefault(url, title)
    return list(links.items())[:100]

def feed_candidates(soup, base, src):
    """Discover public RSS/Atom links, plus standard WordPress feeds.

    Only publisher-hosted article URLs passing valid_url are accepted.
    """
    feeds = []
    for tag in soup.select('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]'):
        href = tag.get('href')
        if href:
            feeds.append(urljoin(base, href))
    if src['kind'] == 'club':
        parsed = urlparse(base)
        feeds.append(f'{parsed.scheme}://{parsed.netloc}/feed/')
    found = {}
    for feed in dict.fromkeys(feeds):
        if (urlparse(feed).hostname or '').removeprefix('www.') not in src['hosts']:
            continue
        try:
            xml, feed_url = fetch(feed, timeout=6)
            for node in xml.select('item, entry')[:50]:
                link = node.find('link')
                href = (link.get('href') or link.get_text(strip=True)) if link else ''
                title_node = node.find('title')
                title = clean(title_node.get_text(' ', strip=True)) if title_node else ''
                u = canonical(urljoin(feed_url, href))
                if 12 <= len(title) <= 250 and valid_url(u, src):
                    found.setdefault(u, title)
        except (OSError, ValueError, urllib.error.URLError):
            continue
    return found


def structured_date(soup):
    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            obj = json.loads(tag.string or tag.get_text())
        except (ValueError, TypeError):
            continue
        stack = [obj]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                for key in ('datePublished', 'dateCreated'):
                    if isinstance(item.get(key), str) and item[key].strip():
                        return clean(item[key])
                stack.extend(v for v in item.values() if isinstance(v, (list, dict)))
    return ''

def published_date(soup):
    result = metadata(soup, 'article:published_time', 'datePublished', 'pubdate', 'date', 'DC.date.issued')
    if result:
        return result
    result = structured_date(soup)
    if result:
        return result
    for element in soup.select('time[datetime], .entry-date, .post-date, .article-date, .date, [itemprop="datePublished"]'):
        value = clean(element.get('datetime') or element.get('content') or element.get_text(' ', strip=True))
        if re.search(r'20\d\d', value):
            return value
    return None

def sentence(text):
    text = clean(text)
    # Split only at sentence boundaries followed by a capital letter; never cut at '4. fordulo'.
    for part in re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÖŐÚÜŰ„“])', text):
        part = clean(part)
        if 30 <= len(part) <= 500 and not re.match(r'^(fordulójában|fordulóban|mérkőzésén)\b', part, re.I):
            return part
    return ''

def article_body_summary(soup, headline):
    """Extract a factual sentence from article prose, not menus or headlines."""
    containers = (
        'article .entry-content', '.post-content', '.article-content',
        '.article-body', '.cikk-szoveg', '[itemprop="articleBody"]',
        'main article', 'article', '.content', '.article__content',
        '.entry__content', '.post__content', '.news-detail', '.news-content',
        '.article-text', '.cikk-tartalom', '.news-body'
    )
    excluded = re.compile(r'(cookie|hirdet|reklám|feliratkoz|kapcsolódó|'
                          r'olvass|megoszt|kövess|fotó:|forrás:|copyright)', re.I)
    title_key = clean(headline).casefold().rstrip('.!?')
    for selector in containers:
        container = soup.select_one(selector)
        if container is None:
            continue
        paragraphs = container.select('p')
        choices = []
        for p in paragraphs[:18]:
            if p.find_parent(['nav', 'aside', 'footer', 'figcaption', 'blockquote']):
                continue
            value = clean(p.get_text(' ', strip=True))
            if not (55 <= len(value) <= 1800) or excluded.search(value[:100]):
                continue
            if value.casefold().rstrip('.!?') == title_key:
                continue
            candidate = sentence(value)
            if candidate and candidate.casefold().rstrip('.!?') != title_key:
                choices.append(candidate)
        if choices:
            # The lead paragraph normally states the most important verifiable fact.
            return choices[0]
    return ''


def article(url, listing_title, src):
    soup, final_url = fetch(url)
    if not valid_url(final_url, src):
        raise ValueError('redirected to a non-article URL')
    headline_tag = soup.select_one('h1')
    headline = clean(headline_tag.get_text(' ', strip=True)) if headline_tag else listing_title
    if headline.lower() in ('hírek', 'news', 'kosárlabda'):
        headline = listing_title
    if headline.lower() in ('hírek', 'news', 'kosárlabda'):
        raise ValueError('navigation page, not an article')
    body_sentence = article_body_summary(soup, headline)
    description = metadata(soup, 'og:description', 'description', 'twitter:description')
    description_sentence = sentence(description)
    if body_sentence:
        summary, method = body_sentence, 'article_body'
    elif description_sentence and description_sentence.casefold().rstrip('.!?') != headline.casefold().rstrip('.!?'):
        summary, method = description_sentence, 'source_description'
    else:
        summary, method = headline, 'headline_fallback'
    return {'source': src['name'], 'title': headline, 'summary': summary,
            'url': canonical(final_url), 'published_at': published_date(soup),
            'summary_method': method}

def summary_usable(item):
    title = clean(item.get('title', '')).casefold().rstrip('.!?')
    summary = clean(item.get('summary', ''))
    return (len(summary) >= MIN_SUMMARY_LENGTH and summary.casefold().rstrip('.!?') != title
            and item.get('summary_method') != 'headline_fallback')

def valid_publication(item, now=None):
    from datetime import timedelta
    stamp = parse_date(item.get('published_at'))
    if not stamp:
        return False
    try:
        dt = datetime.fromisoformat(stamp)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
        return now - timedelta(days=MAX_AGE_DAYS) <= dt <= now + timedelta(days=1)
    except ValueError:
        return False

def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent,
                                     prefix='.' + path.name + '.', suffix='.tmp', delete=False) as f:
        tmp = Path(f.name)
        try:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    os.replace(tmp, path)

def parse_date(value):
    if not value:
        return ''
    try:
        from datetime import datetime
        return datetime.fromisoformat(value.replace('Z', '+00:00')).isoformat()
    except ValueError:
        pass
    m = re.search(r'(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?', value)
    if m:
        return f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}T{int(m[4] or 0):02d}:{int(m[5] or 0):02d}:00+01:00'
    return ''


# Targeted search supplements the homepage feed. Search terms are specific to
# each league to avoid conflating men's Sopron KC with women's Sopron Basket.
TEAM_SEARCHES = {
 'men': {
  'Alba Fehérvár':['Alba Fehérvár'], 'Atomerőmű SE':['Atomerőmű SE','Paks kosárlabda'],
  'Bp. Honvéd':['Budapesti Honvéd kosárlabda','Honvéd kosárlabda'], 'DEAC':['DEAC kosárlabda'],
  'Falco KC':['Falco KC','Falco Szombathely'], 'Kaposvár':['Kaposvári KK'],
  'Kecskemét':['KTE kosárlabda','Duna Aszfalt Kecskemét'], 'Körmend':['Egis Körmend'],
  'Oroszlány':['OSE Lions','Oroszlány kosárlabda'], 'Sopron':['Sopron KC'],
  'Szedeák':['SZTE-Szedeák'], 'Szolnok':['Szolnoki Olajbányász'],
  'NKA Pécs':['NKA Universitas Pécs férfi'], 'Fót':['Fót kosárlabda']},
 'women': {
  'Sopron Basket':['Sopron Basket'], 'DVTK HUNTHERM':['DVTK HUNTHERM'],
  'NKA Universitas Pécs':['NKA Universitas Pécs női'], 'TFSE':['TFSE női kosárlabda'],
  'ELTE BEAC Újbuda':['ELTE BEAC Újbuda'], 'Vasas Akadémia':['Vasas Akadémia női'],
  'Csata TTK':['Csata TTK'], 'BKG-PRIMA Szigetszentmiklós':['BKG PRIMA női'],
  'TARR KSC Szekszárd':['KSC Szekszárd'], 'SERCO UNI Győr':['UNI Győr női'],
  'VBW CEKK Cegléd':['CEKK Cegléd']}}

def targeted_bb1(entries, checks):
    src = next(x for x in SOURCES if x['kind'] == 'bb1')
    successes, failures, added = 0, [], 0
    # One targeted search page per phrase to stay within workflow time budget.
    for league, clubs in TEAM_SEARCHES.items():
        for club, terms in clubs.items():
            found = {}
            for term in terms[:2]:
                for page in (1,):
                    url = 'https://bball1.hu/' + (f'page/{page}/' if page > 1 else '') + '?' + urlencode({'s':term})
                    try:
                        soup, base = fetch(url)
                        successes += 1
                        for link, title in candidates(soup, base, src):
                            found.setdefault(link, title)
                    except Exception as exc:
                        failures.append(f'{club}: {type(exc).__name__}: {exc}')
            # Avoid asserting affiliation solely because a search engine returns
            # an article. Keep search associations as discovery hints, and
            # validate via the club's full distinctive name in article content.
            for link, title in list(found.items())[:25]:
                existing = entries.get(link)
                if existing:
                    item = existing
                else:
                    try:
                        item = article(link, title, src)
                    except Exception:
                        continue
                    entries[link] = item
                    added += 1
                # Discovery only: centralized tagging below applies the same
                # strict men's/women's and ambiguous-name rules to every article.
    checks.append({'source':'BB1.hu team searches','status':('partial' if failures else 'ok') if successes else 'error',
                   'search_pages_ok':successes,'articles_added':added,
                   'failures':failures[:12]})
    return successes

def load_club_sources():
    path = Path('data/news_club_sources.json')
    if not path.exists():
        return []
    result = []
    for club in json.loads(path.read_text(encoding='utf-8')):
        if not club.get('hosts') or not club.get('article_pattern'):
            continue
        result.append({'name': 'Klub: ' + club['name'], 'urls': club.get('urls', []),
                       'hosts': tuple(club['hosts']), 'kind': 'club',
                       'article_pattern': club['article_pattern'],
                       'listing_selector': club.get('listing_selector', '')})
    return result


def source_league(item):
    url = item.get('url', '').lower()
    if item.get('source') == 'WBasket.hu' or '/noi/' in url and item.get('source') == 'Kezdő5.hu':
        return 'women'
    if item.get('source') == 'Kezdő5.hu' and '/magyar-ferfi/' in url:
        return 'men'
    return None


def collect_source(src, entries, checks, max_articles=12):
    found, listing_errors = {}, []
    listings_ok = 0
    for listing_url in src['urls'][:4]:
        try:
            soup, base = fetch(listing_url, timeout=9 if src['kind']=='club' else 12)
            listings_ok += 1
            for url, title in candidates(soup, base, src):
                found.setdefault(url, title)
            if src['kind'] == 'club':
                try:
                    for url, title in feed_candidates(soup, base, src).items():
                        found.setdefault(url, title)
                except Exception as feed_exc:
                    pass  # Optional feeds must not downgrade a successful HTML listing
        except Exception as exc:
            listing_errors.append(f'{listing_url}: {type(exc).__name__}: {exc}')
    added, repaired, failures, already_saved = 0, 0, 0, 0
    for url, title in list(found.items())[:max_articles]:
        existing = entries.get(url)
        if existing and existing.get('published_at') and existing.get('summary_method') == 'article_body':
            already_saved += 1
            continue
        try:
            item = article(url, title, src)
            if src['kind'] == 'club':
                # A club's own publication is attributable to that club, not its opponent.
                item['publisher_club'] = src['name'][6:]
            item['league'] = source_league(item) or item.get('league')
            if existing and existing.get('summary_method') == 'article_body' and item.get('summary_method') != 'article_body':
                item['summary'] = existing['summary']
                item['summary_method'] = 'article_body'
            if existing and not item.get('published_at'):
                item['published_at'] = existing.get('published_at')
            entries[url] = item
            if existing: repaired += 1
            else: added += 1
        except Exception as exc:
            failures += 1
            listing_errors.append(f'article {url}: {type(exc).__name__}: {exc}')
        time.sleep(0.1)
    # A listing with 40 links but zero extracted articles is NOT a healthy source.
    usable = added + repaired + already_saved
    if not listings_ok:
        status, reason = 'error', 'listing_unreachable'
    elif not found:
        status, reason = 'empty', 'no_article_links'
    elif not usable and failures:
        status, reason = 'error', 'all_article_extractions_failed'
    elif listing_errors or failures:
        status, reason = 'partial', 'partial_extraction_or_listing_failure'
    else:
        status, reason = 'ok', 'articles_available'
    checks.append({'source': src['name'], 'status': status, 'reason': reason,
                   'listing_pages_ok': listings_ok, 'listing_pages_failed': len(src['urls'][:4]) - listings_ok,
                   'candidates': len(found), 'attempted': min(len(found), max_articles),
                   'already_saved': already_saved, 'added': added, 'repaired': repaired,
                   'article_errors': failures, 'listing_errors': listing_errors[:12],
                   'usable_articles': usable, 'source_coverage': bool(usable)})



def club_tags(item):
    publisher = item.get('publisher_club', '')
    if not publisher:
        return
    name = publisher.casefold()
    men = {'fóti': 'Fót', 'szedeák': 'Szedeák', 'kecskemét': 'Kecskemét',
           'falco': 'Falco KC', 'körmend': 'Körmend', 'honvéd': 'Bp. Honvéd',
           'szolnok': 'Szolnok', 'deac': 'DEAC', 'alba': 'Alba Fehérvár',
           'kaposvár': 'Kaposvár', 'oroszlány': 'Oroszlány',
           'atomerőmű': 'Atomerőmű SE', 'sopron kc': 'Sopron'}
    women = {'cekk': 'VBW CEKK Cegléd', 'dvtk': 'DVTK HUNTHERM',
             'sopron basket': 'Sopron Basket', 'szekszárd': 'TARR KSC Szekszárd',
             'beac': 'ELTE BEAC Újbuda', 'csata': 'Csata TTK',
             'bkg': 'BKG-PRIMA Szigetszentmiklós', 'vasas': 'Vasas Akadémia',
             'tfse': 'TFSE', 'eto basket': 'SERCO UNI Győr'}
    if 'nka' in name:
        league, team = ('women', 'NKA Universitas Pécs') if 'női' in name else ('men', 'NKA Pécs')
    elif any(k in name for k in women):
        league, team = 'women', next(v for k,v in women.items() if k in name)
    elif any(k in name for k in men):
        league, team = 'men', next(v for k,v in men.items() if k in name)
    else:
        return
    item['league'] = league
    item['teams'] = [league + '|' + team]


def assign_team_tags(entries):
    # Club-origin stories are tagged only to their publisher. Opponents in the
    # headline or summary do not make the article news about the opponent.
    club_sources = {
        'BKG-PRIMA Szigetszentmiklós': ('women', 'BKG-PRIMA Szigetszentmiklós'),
        'Sopron KC': ('men', 'Sopron'),
        'Sopron Basket': ('women', 'Sopron Basket'),
    }
    for item in entries.values():
        club_tags(item)
        label = str(item.get('source', ''))
        if label.startswith('Klub: '):
            publisher = label[6:].strip()
            if publisher in club_sources:
                comp, team = club_sources[publisher]
                item['league'] = comp
                item['teams'] = [comp + '|' + team]
    # Rebuild club associations consistently for every club, not just Sopron.
    # Publisher identity is authoritative for club-origin articles. For independent
    # publishers, match distinctive club names in title/summary, with strict gender
    # evidence. Generic city references are intentionally insufficient.
    import unicodedata
    def norm(value):
        value = unicodedata.normalize('NFD', str(value or '').casefold())
        return re.sub(r'\s+', ' ', ''.join(c for c in value if not unicodedata.combining(c)))

    men_aliases = {
        'Alba Fehérvár':['alba fehervar','alba fehervar kc'],
        'Atomerőmű SE':['atomeromu se','ase paks'],
        'Bp. Honvéd':['budapesti honved','endo plus service honved','honved'],
        'DEAC':['deac kosarlabda','deac ferfi'],
        'Falco KC':['falco','falco kc'],
        'Kaposvár':['kaposvari kk','kometa kaposvar'],
        'Kecskemét':['duna aszfalt','duna aszfalt-dtkh','kte ferfi kosarlabda'],
        'Körmend':['egis kormend','kormendi kosarlabda'],
        'Oroszlány':['ose lions','oroszlanyi se'],
        'Sopron':['sopron kc','soproni kc','soproni sörördögök'],
        'Szedeák':['szte-szedeak','delut-szte-szedeak'],
        'Szolnok':['szolnoki olaj','olajbanyasz'],
        'NKA Pécs':['nka pecs ferfi','nka universitas pecs ferfi'],
        'Fót':['foti tigrisek','phoenix foti']}
    women_aliases = {
        'Sopron Basket':['sopron basket','soproni darazsak'],
        'DVTK HUNTHERM':['dvtk huntherm','dvtk noi kosarlabda'],
        'NKA Universitas Pécs':['nka universitas pecs noi','nka pecs noi'],
        'TFSE':['tfse noi','tfse'],
        'ELTE BEAC Újbuda':['elte beac','beac ujbuda'],
        'Vasas Akadémia':['vasas akademia noi','vasas noi kosarlabda'],
        'Csata TTK':['csata ttk','csata tkk'],
        'BKG-PRIMA Szigetszentmiklós':['bkg-prima','bkg prima'],
        'TARR KSC Szekszárd':['ksc szekszard','tarr ksc'],
        'SERCO UNI Győr':['serco uni gyor','eto basket','uni gyor'],
        'VBW CEKK Cegléd':['cekk cegled','vbw cekk']}
    def matches(hay, phrase):
        return bool(re.search(r'(?<![a-z0-9])' + re.escape(norm(phrase)) + r'(?![a-z0-9])', hay))
    def gender(item):
        url = norm(item.get('url', ''))
        source = norm(item.get('source', ''))
        hay = norm(' '.join(str(item.get(k, '')) for k in ('title','summary')))
        if 'wbasket' in source or 'wbasket.hu' in url or '/noi/' in url or '/noi-' in url:
            return 'women'
        if '/magyar-ferfi/' in url or '/ferfi/' in url:
            return 'men'
        # An explicit women's marker is a veto on men's tagging even if a
        # shared city/team keyword is present (e.g. Sopron, Pécs, DVTK).
        if re.search(r'(?<![a-z])noi(?![a-z])|noikosarlabda|noi nb|noi bajnoksag|noi csapat|noi keret|noi kupa|noi valogatott', hay):
            return 'women'
        if re.search(r'(?<![a-z])ferfi(?![a-z])|ferfi nb|ferfi bajnoksag|ferfi csapat', hay):
            return 'men'
        return None

    for item in entries.values():
        existing = [str(t) for t in item.get('teams', []) if isinstance(t, str)]
        explicit = gender(item)
        source = str(item.get('source',''))
        # Use official club identity as the strongest evidence, but never let
        # a women's club story leak into the men's team list.
        publisher = source[6:].strip() if source.startswith('Klub: ') else ''
        if publisher:
            known = {
                'Falco KC Szombathely':('men','Falco KC'),
                'DVTK HUNTHERM':('women','DVTK HUNTHERM'),
                'DEAC':('men','DEAC'),
                'Egis Körmend':('men','Körmend'),
                'Alba Fehérvár':('men','Alba Fehérvár'),
                'Atomerőmű SE':('men','Atomerőmű SE'),
                'OSE Lions':('men','Oroszlány'),
                'ELTE BEAC Újbuda':('women','ELTE BEAC Újbuda'),
                'BKG-PRIMA Szigetszentmiklós':('women','BKG-PRIMA Szigetszentmiklós'),
                'Vasas Akadémia':('women','Vasas Akadémia'),
                'VBW CEKK Cegléd':('women','VBW CEKK Cegléd'),
                'TFSE':('women','TFSE'),
                'NHSZ-Szolnoki Olajbányász':('men','Szolnok'),
                'Duna Aszfalt-DTKH Kecskemét':('men','Kecskemét'),
                'PHOENIX Fóti Tigrisek':('men','Fót'),
                'Délút-SZTE-Szedeák':('men','Szedeák'),
                'Endo Plus Service-Honvéd':('men','Bp. Honvéd'),
                'Kometa-KVGY Kaposvári KK':('men','Kaposvár'),
                'NKA Universitas Pécs (férfi)':('men','NKA Pécs'),
                'NKA Universitas Pécs (női)':('women','NKA Universitas Pécs'),
                'Csata TKK':('women','Csata TTK'),
                'ETO Basket':('women','SERCO UNI Győr'),
                'KSC Szekszárd':('women','TARR KSC Szekszárd'),
                'Sopron KC':('men','Sopron'),
                'Sopron Basket':('women','Sopron Basket'),
            }
            owner = known.get(publisher)
            if not owner:
                for competition, mapping in [('men',men_aliases),('women',women_aliases)]:
                    for team, aliases in mapping.items():
                        if any(matches(norm(publisher), a) for a in aliases):
                            owner=(competition,team);break
                    if owner:break
            if owner:
                item['teams']=[owner[0]+'|'+owner[1]]
                item['league']=owner[0]
                continue
        hay = norm(' '.join(str(item.get(k,'')) for k in ('title','summary')))
        tags=[]
        for competition, mapping in [('men',men_aliases),('women',women_aliases)]:
            if explicit and competition!=explicit:continue
            for team, aliases in mapping.items():
                if any(matches(hay,a) for a in aliases):tags.append(competition+'|'+team)
        # The NKA Universitas Pécs name is shared by men's and women's teams.
        # Only classify the unqualified name when article/source context establishes gender.
        if explicit and (matches(hay,'nka universitas pecs') or matches(hay,'nka pecs')):
            nka = 'women|NKA Universitas Pécs' if explicit=='women' else 'men|NKA Pécs'
            if nka not in tags:tags.append(nka)
        # 'Sopron' alone is a city, not a club identifier. Never infer either team
        # from an unqualified city reference.

        # Named player affiliation requires verified editorial knowledge;
        # retain the confirmed Schöll interview but don't guess other players.
        if source=='BB1.hu' and matches(norm(item.get('title','')), 'scholl richard') and explicit!='women':
            tags.append('men|Sopron')
        # Retain previously verified explicit team tags when compatible with
        # gender, but never carry over ambiguous men's tags from older runs.
        # Recompute tags from evidence rather than carrying stale associations
        # from earlier collector versions. Verified publisher identity is handled above.

        item['teams']=list(dict.fromkeys(tags))
        if explicit:item['league']=explicit
        elif tags and len({t.split('|')[0] for t in tags})==1:item['league']=tags[0].split('|')[0]
        else:item.pop('league',None)


def main():
    old = []
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding='utf-8')).get('articles', [])
        except (OSError, ValueError):
            pass
    all_sources = SOURCES + load_club_sources()
    by_name = {src['name']: src for src in all_sources}
    entries = {}
    discarded = 0
    for item in old:
        if not isinstance(item, dict) or not item.get('url'):
            discarded += 1
            continue
        src = by_name.get(item.get('source'))
        if src and not valid_url(item['url'], src):
            # Historical records remain available, but are not considered fresh
            # unless their date and metadata pass the current quality gates.
            item['legacy_source_url'] = True
        url = canonical(item['url'])
        item['url'] = url
        entries[url] = item
    checks = []
    for src in SOURCES:
        found = {}
        listing_errors = []
        for listing_url in src['urls']:
            try:
                soup, base = fetch(listing_url)
                for url, title in candidates(soup, base, src):
                    found.setdefault(url, title)
                if found and src['kind'] not in ('hunbasket', 'kezdo5'):
                    break
            except Exception as exc:
                listing_errors.append(f'{listing_url}: {exc}')
        added, repaired, failed = 0, 0, 0
        for url, title in list(found.items())[:80]:
            existing = entries.get(url)
            needs_repair = existing and (not existing.get('published_at') or existing.get('summary_method') == 'headline_fallback' or clean(existing.get('title', '')).lower() in ('hírek', 'news') or not sentence(existing.get('summary', '')))
            if existing and not needs_repair and existing.get('summary_method') == 'article_body':
                continue
            try:
                item = article(url, title, src)
                if existing:
                    if existing.get('summary_method') == 'article_body' and item.get('summary_method') != 'article_body':
                        item['summary'] = existing['summary']
                        item['summary_method'] = 'article_body'
                    if not item.get('published_at'):
                        item['published_at'] = existing.get('published_at')
                    if item['summary_method'] == 'headline_fallback' and existing.get('summary_method') == 'article_body' and sentence(existing.get('summary', '')):
                        item['summary'] = existing['summary']
                        item['summary_method'] = existing.get('summary_method', 'source_description')
                    repaired += 1
                else:
                    added += 1
                entries[url] = item
            except Exception as exc:
                failed += 1
                print(f'ARTICLE ERROR {src["name"]}: {url}: {exc}', file=sys.stderr)
            time.sleep(0.12)
        status = ('partial' if (listing_errors or failed) else 'ok') if found else ('error' if listing_errors else 'empty')
        checks.append({'source': src['name'], 'status': status, 'candidates': len(found), 'added': added, 'repaired': repaired,
                       'article_errors': failed, 'listing_errors': listing_errors})
    targeted_bb1(entries, checks)
    for src in all_sources:
        if src['kind'] == 'club':
            collect_source(src, entries, checks, max_articles=14 if src['kind'] != 'club' else 10)
    assign_team_tags(entries)
    # Re-key by canonical URL and preserve the highest-quality article on collisions.
    deduplicated = {}
    for item in entries.values():
        url = canonical(item['url'])
        item['url'] = url
        previous = deduplicated.get(url)
        quality = lambda a: (int(valid_publication(a)), int(summary_usable(a)), int(bool(a.get('published_at'))), len(a.get('summary','')))
        if previous is None or quality(item) > quality(previous):
            if previous is not None:
                item['teams'] = sorted(set(item.get('teams', [])) | set(previous.get('teams', [])))
            deduplicated[url] = item
        elif previous is not None:
            previous['teams'] = sorted(set(previous.get('teams', [])) | set(item.get('teams', [])))
    articles = sorted(deduplicated.values(), key=lambda x: (parse_date(x.get('published_at')), x.get('title', '')), reverse=True)
    now = datetime.now(timezone.utc)
    healthy = [x for x in checks if x['status'] in ('ok', 'partial') and x.get('candidates', x.get('search_pages_ok', 0))]
    stats = {'total': len(articles), 'fresh': sum(valid_publication(x, now) for x in articles),
             'fresh_with_summary': sum(valid_publication(x, now) and summary_usable(x) for x in articles),
             'missing_dates': sum(not parse_date(x.get('published_at')) for x in articles),
             'headline_only': sum(not summary_usable(x) for x in articles),
             'untagged': sum(not x.get('teams') for x in articles),
             'sources_ok': sum(x['status']=='ok' for x in checks),
             'sources_partial': sum(x['status']=='partial' for x in checks),
             'sources_failed': sum(x['status'] in ('error','empty','discovered') for x in checks),
             'new_articles': sum(x.get('added',x.get('articles_added',0)) for x in checks),
             'sources_total': len(checks)}
    stats['clubs_with_direct_source_coverage'] = sum(1 for x in checks if x['source'].startswith('Klub: ') and x.get('source_coverage'))
    stats['clubs_configured'] = sum(1 for x in checks if x['source'].startswith('Klub: '))
    health = {'checked_at': now.isoformat(), 'statistics': stats, 'sources': checks,
              'failed_sources': [x['source'] for x in checks if x['status'] in ('error','empty')]} 
    print(json.dumps(health, ensure_ascii=False, indent=2))
    # Never replace a good database with empty or implausibly reduced results.
    if not healthy or (old and len(articles) < max(10, int(len(old) * .8))):
        atomic_json(HEALTH, {**health, 'status':'failed', 'reason':'No healthy source or unsafe article count reduction'})
        raise SystemExit('Unsafe news update; existing news.json preserved')
    result = {'checked_at': now.isoformat(), 'sources': checks, 'articles': articles}
    atomic_json(OUT, result)
    atomic_json(HEALTH, {**health, 'status':'partial' if stats['sources_failed'] or stats['sources_partial'] else 'ok'})

if __name__ == '__main__':
    main()
