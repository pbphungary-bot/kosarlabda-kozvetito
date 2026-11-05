#!/usr/bin/env python3
"""Conservative pilot: collect article metadata and source-backed one-line descriptions.
No invented summaries: fallback is the headline. Run with Python 3 and bs4.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, urldefrag
from bs4 import BeautifulSoup

SOURCES = [
    {'name':'BB1.hu','url':'https://bb1.hu/latest-news/','host':'bb1.hu'},
    {'name':'WBasket.hu','url':'https://wbasket.hu/','host':'wbasket.hu'},
    {'name':'Hunbasket','url':'https://hunbasket.hu/hirek','host':'hunbasket.hu'},
]
OUT = Path('data/news.json')
HEADERS = {'User-Agent':'BasketballCommentaryNewsPilot/0.1 (metadata only; respectful fetch) Mozilla/5.0'}

def get(url):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=20) as r:
        if r.status!=200: raise RuntimeError('HTTP '+str(r.status))
        return BeautifulSoup(r.read(),'html.parser')

def clean(s): return re.sub(r'\s+',' ',s or '').strip()

def meta(soup, *keys):
    for key in keys:
        tag=soup.find('meta',attrs={'property':key}) or soup.find('meta',attrs={'name':key})
        if tag and tag.get('content'): return clean(tag['content'])
    return ''

def canonical(url):
    url=urldefrag(url)[0]
    return url.rstrip('/')+'/' if urlparse(url).path not in ('','/') else url

def candidates(soup,src):
    found={}
    for a in soup.select('article a[href], h2 a[href], h3 a[href], .post-title a[href], .entry-title a[href], a[href]'):
        href=a.get('href',''); title=clean(a.get_text(' ',strip=True))
        if not 18<=len(title)<=240: continue
        url=canonical(urljoin(src['url'],href)); p=urlparse(url)
        if p.scheme!='https' or not (p.hostname==src['host'] or p.hostname=='www.'+src['host']): continue
        if p.path in ('','/','/hirek','/hirek/','/latest-news','/latest-news/'): continue
        if any(x in p.path.lower() for x in ('/tag/','/category/','/page/','/author/','/csapat/','/tipus/','/kereso/')): continue
        found.setdefault(url,title)
    return list(found.items())[:80]

def article(url,title,src):
    soup=get(url)
    h=soup.find('h1')
    headline=clean(h.get_text(' ',strip=True)) if h else title
    description=meta(soup,'og:description','description','twitter:description')
    if not description:
        body=soup.select_one('article .entry-content p, article p, .post-content p, .article-content p')
        description=clean(body.get_text(' ',strip=True)) if body else ''
    # Do not truncate into a misleading partial sentence. A headline is a safe fallback.
    sentences=re.split(r'(?<=[.!?])\s+',description)
    summary=next((s for s in sentences if 25<=len(s)<=360), '')
    if not summary: summary=headline
    published=meta(soup,'article:published_time','datePublished','pubdate')
    time=soup.find('time')
    if not published and time: published=time.get('datetime') or clean(time.get_text(' ',strip=True))
    return {'source':src['name'],'title':headline,'summary':summary,'url':url,'published_at':published or None,
            'summary_method':'source_description' if summary!=headline else 'headline_fallback'}

def main():
    old=[]
    if OUT.exists():
        try: old=json.loads(OUT.read_text(encoding='utf-8')).get('articles',[])
        except (ValueError,OSError): pass
    entries={x['url']:x for x in old if isinstance(x,dict) and x.get('url')}
    checks=[]
    for src in SOURCES:
        count=0
        try:
            links=candidates(get(src['url']),src)
            for url,title in links:
                if url in entries: continue
                try:
                    item=article(url,title,src)
                    if not item['title']: continue
                    entries[url]=item;count+=1
                except Exception as exc: print(f'ARTICLE ERROR {src["name"]}: {url}: {exc}',file=sys.stderr)
            checks.append({'source':src['name'],'status':'ok','candidates':len(links),'added':count})
        except Exception as exc:
            checks.append({'source':src['name'],'status':'error','message':str(exc)})
            print(f'SOURCE ERROR {src["name"]}: {exc}',file=sys.stderr)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    result={'checked_at':datetime.now(timezone.utc).isoformat(),'sources':checks,'articles':list(entries.values())}
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'total':len(entries),'sources':checks},ensure_ascii=False,indent=2))
    if not any(x['status']=='ok' for x in checks): sys.exit(1)

if __name__=='__main__': main()
