"""Offline regression tests for club source health reporting."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
from bs4 import BeautifulSoup
spec=importlib.util.spec_from_file_location('news',Path(__file__).with_name('update_news.py'))
news=importlib.util.module_from_spec(spec);spec.loader.exec_module(news)
src={'name':'Klub: Test','kind':'club','urls':['https://example.com/'],
     'hosts':('example.com',),'article_pattern':r'^/news/[^/]+$',
     'listing_selector':'a[href]'}
listing=BeautifulSoup('<a href="/news/one">An example basketball club article</a>', 'html.parser')
def run(fetch, article):
    checks=[];entries={}
    with patch.object(news,'fetch',side_effect=fetch),patch.object(news,'article',side_effect=article),patch.object(news.time,'sleep'):
        news.collect_source(src,entries,checks)
    return checks[0],entries
x,_=run([OSError('offline')],[])
assert (x['status'],x['reason'])==('error','listing_unreachable'),x
x,_=run([(BeautifulSoup('', 'html.parser'),'https://example.com/')],[])
assert (x['status'],x['reason'])==('empty','no_article_links'),x
x,_=run([(listing,'https://example.com/')],[ValueError('article extraction failed')])
assert (x['status'],x['reason'])==('error','all_article_extractions_failed'),x
item={'source':src['name'],'title':'An example basketball club article','url':'https://example.com/news/one/',
      'summary':'An example summary about a basketball match and its outcome.',
      'published_at':'2026-11-10','summary_method':'article_body'}
x,entries=run([(listing,'https://example.com/')],[item])
assert x['status']=='ok' and x['added']==1 and len(entries)==1,x
print('Source-health regression tests passed')
