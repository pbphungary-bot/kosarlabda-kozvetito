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
from urllib.parse import urljoin, urlparse, urldefrag, urlencode, quote
from bs4 import BeautifulSoup

OUT = Path('data/news.json')
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; BasketballNewsCollector/0.2)', 'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.7'}
SOURCES = [
    {'name': 'BB1.hu', 'urls': ['https://bball1.hu/', 'https://bball1.hu/hirek/', 'https://bb1.hu/'], 'hosts': ('bball1.hu', 'bb1.hu'), 'kind': 'bb1'},
    {'name': 'WBasket.hu', 'urls': ['https://wbasket.hu/'], 'hosts': ('wbasket.hu',), 'kind': 'wbasket'},
    {'name': 'Hunbasket', 'urls': ['https://hunbasket.hu/hirek', 'https://hunbasket.hu/hirek/ferfi/', 'https://hunbasket.hu/hirek/noi/'], 'hosts': ('hunbasket.hu',), 'kind': 'hunbasket'},
]

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
    if path in ('', '/hirek', '/latest-news'):
        return False
    if any(path.startswith(prefix) for prefix in ('/tag/', '/category/', '/page/', '/author/', '/kereso/', '/search/', '/csapat/', '/jatekos/', '/menetrend/', '/tabella/', '/wp-content/')):
        return False
    return len([part for part in path.split('/') if part]) >= 1

def candidates(soup, base, src):
    links = {}
    if src['kind'] == 'hunbasket':
        anchors = soup.select('a[href*="/hir/"]')
    else:
        anchors = soup.select('article a[href], h2 a[href], h3 a[href], .entry-title a[href], .post-title a[href]')
        if not anchors or src['kind'] == 'bb1':
            anchors = soup.select('a[href]')
    for a in anchors:
        title = clean(a.get_text(' ', strip=True))
        if not 12 <= len(title) <= 250:
            continue
        url = canonical(urljoin(base, a.get('href', '')))
        if valid_url(url, src):
            links.setdefault(url, title)
    return list(links.items())[:100]

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
    descriptions = [metadata(soup, 'og:description', 'description', 'twitter:description')]
    for selector in ('article .entry-content p', '.post-content p', '.article-content p', 'article p', '.content p'):
        p = soup.select_one(selector)
        if p:
            descriptions.append(p.get_text(' ', strip=True))
    summary = next((s for description in descriptions if (s := sentence(description))), '')
    return {'source': src['name'], 'title': headline, 'summary': summary or headline, 'url': canonical(final_url),
            'published_at': published_date(soup), 'summary_method': 'source_description' if summary else 'headline_fallback'}

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
        return f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}T{int(m[4] or 0):02d}:{int(m[5] or 0):02d}:00'
    return ''


# Targeted search supplements the homepage feed. Search terms are specific to
# each league to avoid conflating men's Sopron KC with women's Sopron Basket.
TEAM_SEARCHES = {
 'men': {
  'Alba Fehérvár':['Alba Fehérvár'], 'Atomerőmű SE':['Atomerőmű SE','Paks kosárlabda'],
  'Bp. Honvéd':['Budapesti Honvéd kosárlabda'], 'DEAC':['DEAC kosárlabda'],
  'Falco KC':['Falco KC','Falco Szombathely'], 'Kaposvár':['Kaposvári KK'],
  'Kecskemét':['KTE kosárlabda','Duna Aszfalt Kecskemét'], 'Körmend':['Egis Körmend'],
  'Oroszlány':['OSE Lions','Oroszlány kosárlabda'], 'Sopron':['Sopron KC'],
  'Szedeák':['SZTE-Szedeák'], 'Szolnok':['Szolnoki Olajbányász'],
  'NKA Pécs':['NKA Universitas Pécs'], 'Fót':['Fót kosárlabda']},
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
    # Limit to two search phrases per club, first two result pages each.
    for league, clubs in TEAM_SEARCHES.items():
        for club, terms in clubs.items():
            found = {}
            for term in terms[:2]:
                for page in (1, 2):
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
                # Search results can be fuzzy; explicit text match is required.
                body = clean((item.get('title') or '') + ' ' + (item.get('summary') or '')).casefold()
                import unicodedata
                def norm(x):
                    return ''.join(c for c in unicodedata.normalize('NFD', x.casefold()) if not unicodedata.combining(c))
                matched = any(norm(t) in norm(body) for t in terms if len(t) >= 5)
                if matched:
                    tags = item.setdefault('teams', [])
                    tag = league + '|' + club
                    if tag not in tags: tags.append(tag)
    checks.append({'source':'BB1.hu team searches','status':'ok' if successes else 'error',
                   'search_pages_ok':successes,'articles_added':added,
                   'failures':failures[:12]})
    return successes

def main():
    old = []
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding='utf-8')).get('articles', [])
        except (OSError, ValueError):
            pass
    by_name = {src['name']: src for src in SOURCES}
    entries = {}
    discarded = 0
    for item in old:
        if not isinstance(item, dict) or not item.get('url') or item.get('source') not in by_name:
            discarded += 1
            continue
        src = by_name[item['source']]
        if not valid_url(item['url'], src) :
            discarded += 1
            continue
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
                if found and src['kind'] != 'hunbasket':
                    break
            except Exception as exc:
                listing_errors.append(f'{listing_url}: {exc}')
        added, repaired, failed = 0, 0, 0
        for url, title in list(found.items())[:80]:
            existing = entries.get(url)
            needs_repair = existing and (not existing.get('published_at') or existing.get('summary_method') == 'headline_fallback' or clean(existing.get('title', '')).lower() in ('hírek', 'news') or not sentence(existing.get('summary', '')))
            if existing and not needs_repair:
                continue
            try:
                item = article(url, title, src)
                if existing:
                    if not item.get('published_at'):
                        item['published_at'] = existing.get('published_at')
                    if item['summary_method'] == 'headline_fallback' and existing.get('summary_method') == 'source_description' and sentence(existing.get('summary', '')):
                        item['summary'] = existing['summary']
                        item['summary_method'] = 'source_description'
                    repaired += 1
                else:
                    added += 1
                entries[url] = item
            except Exception as exc:
                failed += 1
                print(f'ARTICLE ERROR {src["name"]}: {url}: {exc}', file=sys.stderr)
            time.sleep(0.12)
        status = 'ok' if found else 'error'
        checks.append({'source': src['name'], 'status': status, 'candidates': len(found), 'added': added, 'repaired': repaired,
                       'article_errors': failed, 'listing_errors': listing_errors})
    targeted_bb1(entries, checks)
    # WBasket articles are women's-only, including articles saved in earlier runs.
    # Retain them for women's teams; never publish a men's team association.
    for item in entries.values():
        source = str(item.get('source', '')).casefold()
        host = urlparse(str(item.get('url', ''))).hostname or ''
        if source == 'wbasket.hu' or host == 'wbasket.hu' or host.endswith('.wbasket.hu'):
            item['league'] = 'women'
            if isinstance(item.get('teams'), list):
                item['teams'] = [tag for tag in item['teams'] if not str(tag).startswith('men|')]
    articles = sorted(entries.values(), key=lambda x: (parse_date(x.get('published_at')), x.get('title', '')), reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'sources': checks, 'articles': articles}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'total': len(articles), 'discarded_navigation': discarded, 'sources': checks}, ensure_ascii=False, indent=2))
    if not any(x['status'] == 'ok' for x in checks):
        sys.exit(1)

if __name__ == '__main__':
    main()
