#!/usr/bin/env python3
"""Pre-match coach statements of the preview articles the news collector already gathers (BB1.hu "Team – Team" articles).

A BB1 preview article has one paragraph per statement:   <p><strong>Name, Club:</strong> text …</p>
Reads data/news.json (written by scripts/update_news.py), fetches only NEW (or very recent, still empty) candidates, and writes data/previews.json:
  {"updated_at": ..., "items": [{"url", "source", "title", "published_at", "league", "teams", "statements": [{"speaker", "club", "text"}]}]}
Used by the Graphics Studio's coach graphic (pick a statement -> quote box + speaker's name). The file is written only when its content changed.
Polite: low frequency (runs after the 15-minute news job), a handful of requests per run, an identifiable browser-like User-Agent.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bs4 import BeautifulSoup

NEWS = Path('data/news.json')
OUT = Path('data/previews.json')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'hu-HU,hu;q=0.9'}
SOURCES = ('BB1.hu',)          # sources whose "A – B" articles are match previews (women: add a source here once its preview format is known)
MAX_AGE_DAYS = 21              # previews older than this are dropped
EMPTY_RECHECK_DAYS = 2         # a young article without statements is looked at again (quotes are sometimes added later)
MAX_FETCH = 8                  # requests per run
LABEL = re.compile(r'^(?P<speaker>[^,:]{3,60}),\s*(?P<club>[^:]{3,80}):$')
TITLE = re.compile(r'\s[–-]\s')


def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def extract_statements(html):
    """[{'speaker', 'club', 'text'}] from the paragraphs that start with a bold "Name, Club:" label (one paragraph = one statement)."""
    soup = BeautifulSoup(html, 'html.parser')
    root = soup.find('article') or soup
    out = []
    for p in root.find_all('p'):
        strong = p.find(['strong', 'b'])
        if not strong:
            continue
        label = clean(strong.get_text(' ', strip=True))
        m = LABEL.match(label)
        full = clean(p.get_text(' ', strip=True))
        if not m or not full.startswith(label):
            continue
        text = full[len(label):].strip()
        if len(text) < 40:   # a label alone / a caption, not a statement
            continue
        out.append({'speaker': clean(m.group('speaker')), 'club': clean(m.group('club')), 'text': text})
    return out


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode('utf-8', 'replace')


def parse_time(value):
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def candidates(news, now):
    """News articles that look like match previews: BB1 "Team – Team" with exactly two tagged teams, recent."""
    out = []
    for a in news.get('articles', []):
        t = parse_time(a.get('published_at') or '')
        if a.get('source') not in SOURCES or not t or now - t > timedelta(days=MAX_AGE_DAYS):
            continue
        if len(a.get('teams') or []) == 2 and TITLE.search(a.get('title', '')) and a.get('url'):
            out.append(a)
    return sorted(out, key=lambda a: a['published_at'], reverse=True)


def build(news, old, now, fetch_fn=fetch, max_fetch=MAX_FETCH):
    """New previews document from the news file and the previous previews (url -> item)."""
    items, fetched = [], 0
    for a in candidates(news, now):
        prev = old.get(a['url'])
        young = now - parse_time(a['published_at']) <= timedelta(days=EMPTY_RECHECK_DAYS)
        if prev is not None and (prev.get('statements') or not young):
            items.append(dict(prev, title=a['title'], teams=a['teams']))     # known: keep (a title / tag fix still follows the news file)
            continue
        if fetched >= max_fetch:
            if prev is not None:
                items.append(prev)
            continue
        fetched += 1
        try:
            statements = extract_statements(fetch_fn(a['url']))
        except Exception as exc:  # network / site trouble: keep what we had, never invent
            print(f"preview fetch failed: {a['url']}: {exc}", file=sys.stderr)
            if prev is not None:
                items.append(prev)
            continue
        items.append({'url': a['url'], 'source': a['source'], 'title': a['title'], 'published_at': a['published_at'],
                      'league': a.get('league'), 'teams': a['teams'], 'statements': statements})
    return items, fetched


def main():
    now = datetime.now(timezone.utc)
    news = json.loads(NEWS.read_text(encoding='utf-8'))
    old_doc = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    old = {i['url']: i for i in old_doc.get('items', [])}
    items, fetched = build(news, old, now)
    if items == old_doc.get('items'):
        print(f'previews unchanged ({len(items)} items, {fetched} fetched)')
        return
    doc = {'updated_at': now.isoformat(timespec='seconds'), 'items': items}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    with_quotes = sum(1 for i in items if i['statements'])
    print(f'previews written: {len(items)} items, {with_quotes} with statements, {fetched} fetched')


if __name__ == '__main__':
    main()
