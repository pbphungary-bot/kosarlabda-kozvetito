"""Find each club's official Facebook page from the club's OWN website and record it in data/fb_club_pages.json.

No Facebook scraping and no guessing: a page is only recorded when the club's website links to it.
  verified              -> the link was found on a basketball-specific site/URL, or the page name itself says basketball
  linked_from_club_site -> the club's (possibly multi-sport) website links to it; may be the whole association's page
Manually curated entries (verified_by == 'manual') are never overwritten.
"""
import json, re, sys, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).parent))
import update_news as news

FB_RE = re.compile(r"https?:(?:\\?/){2}(?:www\.|m\.|hu-hu\.)?(?:facebook\.com|fb\.com)(?:\\?/)[^\"'\s<>)\\]+", re.I)
BLOCKED_FIRST = {'sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'login.php', 'policies', 'help', 'events', 'watch',
                 'groups', 'hashtag', 'l.php', 'photo', 'photo.php', 'permalink.php', 'story.php', 'video', 'videos', 'reel', 'posts', 'public',
                 'facebook', 'home.php', 'privacy', 'legal', 'ads', 'business', 'marketplace', 'gaming', 'stories', 'about', 'people-hub'}
BASKETBALL_HINT = re.compile(r'kosar|kosi|basket|kc$|kk$|kosarlabda', re.I)

def normalize_fb(raw):
    """Return the canonical public Facebook page URL, or None if the link is a share/dialog/post/etc."""
    url = raw.replace('\\/', '/').rstrip('.,;')
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    if not re.fullmatch(r'(?:www\.|m\.|hu-hu\.)?(?:facebook|fb)\.com', host):
        return None
    parts = [p for p in parsed.path.split('/') if p]
    if not parts:
        return None
    first = parts[0].lower()
    if first == 'profile.php':
        pid = (parse_qs(parsed.query).get('id') or [''])[0]
        return f'https://www.facebook.com/profile.php?id={pid}' if pid.isdigit() else None
    if first in BLOCKED_FIRST or first.endswith(('.php', '.html')):
        return None
    if first in ('people', 'pages', 'p'):
        return 'https://www.facebook.com/' + '/'.join(parts[:3 if first != 'p' else 2])
    if len(parts) > 1 and parts[1].lower() in ('posts', 'photos', 'videos', 'events', 'about'):
        parts = parts[:1]     # a link to a post/photo of a page -> the page itself
    elif len(parts) > 1:
        return None
    return 'https://www.facebook.com/' + parts[0]

def find_fb_links(html_text):
    return [u for u in (normalize_fb(m) for m in FB_RE.findall(html_text)) if u]

def discover(club, fetch_raw=news.fetch_raw, pause=0.2):
    counts, where = Counter(), {}
    for page in club['urls'][:3]:
        try:
            payload, final, _ = fetch_raw(page, timeout=10)
        except Exception:
            continue
        for link in find_fb_links(payload.decode('utf-8', 'replace')):
            counts[link] += 1
            where.setdefault(link, final)
        time.sleep(pause)
    if not counts:
        return None
    link, hits = counts.most_common(1)[0]
    source_page = where[link]
    host_path = (urlparse(source_page).hostname or '') + urlparse(source_page).path
    specific = bool(BASKETBALL_HINT.search(host_path) or BASKETBALL_HINT.search(urlparse(link).path))
    return {'official_page': link, 'verification': 'verified' if specific else 'linked_from_club_site',
            'verified_by': 'linked_from_official_site', 'source_url': source_page,
            'alternatives': [u for u, _ in counts.most_common(4)[1:]]}

def main():
    clubs_cfg = json.loads(Path('data/news_club_sources.json').read_text(encoding='utf-8'))
    path = Path('data/fb_club_pages.json')
    doc = json.loads(path.read_text(encoding='utf-8'))
    by_name = {c['club']: c for c in doc['clubs']}
    found = 0
    for club in clubs_cfg:
        entry = by_name.setdefault(club['name'], {'club': club['name'], 'official_page': '', 'verification': 'unverified'})
        if entry.get('verified_by') == 'manual' and entry.get('official_page'):
            found += 1
            continue
        result = discover(club)
        if result:
            entry.update(result); entry['checked_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds'); found += 1
            print(f"{club['name']}: {result['verification']} {result['official_page']}")
        else:
            print(f"{club['name']}: no Facebook link found on the club's site")
    doc['clubs'] = [by_name[c['name']] for c in clubs_cfg] + [v for k, v in by_name.items() if k not in {c['name'] for c in clubs_cfg}]
    doc['updated_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{found}/{len(clubs_cfg)} clubs have a Facebook page linked from their own website')

if __name__ == '__main__':
    main()
