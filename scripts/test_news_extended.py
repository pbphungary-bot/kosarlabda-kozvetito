from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
import update_news as n
from bs4 import BeautifulSoup
from unittest.mock import patch
from datetime import datetime, timezone
src={'name':'Klub: Test','kind':'club','hosts':('example.com',),'article_pattern':r'^/hirek/[^/]+$'}
page=BeautifulSoup('<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head></html>','html.parser')
feed=BeautifulSoup('<rss><channel><item><title>Hosszabb kosárlabda hír a klubról</title><link>https://example.com/hirek/uj-cikk/</link></item></channel></rss>','xml')
with patch.object(n,'fetch',return_value=(feed,'https://example.com/feed/')):
 found=n.feed_candidates(page,'https://example.com/',src)
 assert len(found)==1,found
assert n.valid_url('https://example.com/hirek/uj-cikk/',src)
assert not n.valid_url('https://other.com/hirek/uj-cikk/',src)
assert not n.valid_publication({'published_at':'2012-05-10'},datetime(2026,11,10,tzinfo=timezone.utc))
print('Extended RSS and URL validation tests passed')
