
    
  
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
    articles = sorted(entries.values(), key=lambda x: (parse_date(x.get('published_at')), x.get('title', '')), reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'sources': checks, 'articles': articles}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'total': len(articles), 'discarded_navigation': discarded, 'sources': checks}, ensure_ascii=False, indent=2))
    if not any(x['status'] == 'ok' for x in checks):
        sys.exit(1)

if __name__ == '__main__':
    main()

