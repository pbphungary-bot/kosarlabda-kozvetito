from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
import update_fb_pages as fb

n = fb.normalize_fb
assert n('https://www.facebook.com/FalcoKC/') == 'https://www.facebook.com/FalcoKC'
assert n('https://facebook.com/FalcoKC/posts/123456') == 'https://www.facebook.com/FalcoKC'
assert n('https:\\/\\/www.facebook.com\\/albakosar') == 'https://www.facebook.com/albakosar'
assert n('https://www.facebook.com/profile.php?id=100064') == 'https://www.facebook.com/profile.php?id=100064'
assert n('https://www.facebook.com/people/Vasas-Basket/1000123/') == 'https://www.facebook.com/people/Vasas-Basket/1000123'
for bad in ('https://www.facebook.com/sharer/sharer.php?u=x', 'https://www.facebook.com/sharer.php?u=x', 'https://www.facebook.com/plugins/like.php?href=x',
            'https://www.facebook.com/dialog/share', 'https://www.facebook.com/tr?id=1', 'https://www.facebook.com/groups/abc', 'https://www.facebook.com/',
            'https://evilfacebook.com/FalcoKC', 'https://example.com/facebook.com/FalcoKC', 'https://www.facebook.com/someone/friends'):
    assert n(bad) is None, bad

html = '''<a href="https://www.facebook.com/sharer/sharer.php?u=https://club.hu/x">share</a>
<footer><a href="https://www.facebook.com/KlubKosar">FB</a></footer><script>{"sameAs":["https:\\/\\/www.facebook.com\\/KlubKosar","https:\\/\\/www.facebook.com\\/MasikOldal"]}</script>'''
assert fb.find_fb_links(html) == ['https://www.facebook.com/KlubKosar', 'https://www.facebook.com/KlubKosar', 'https://www.facebook.com/MasikOldal'], fb.find_fb_links(html)

def stub(url, timeout=10):
    return html.encode(), url, 'text/html'
res = fb.discover({'name': 'X', 'urls': ['https://kosarlabda.club.hu/']}, fetch_raw=stub, pause=0)
assert res['official_page'] == 'https://www.facebook.com/KlubKosar' and res['verification'] == 'verified', res
res = fb.discover({'name': 'Y', 'urls': ['https://multisport.hu/']}, fetch_raw=lambda u, timeout=10: (b'<a href="https://www.facebook.com/EgyesuletXY">x</a>', u, 'text/html'), pause=0)
assert res['verification'] == 'linked_from_club_site', res      # multi-sport site: not proven to be the basketball page
def fail(url, timeout=10): raise OSError('blocked')
assert fb.discover({'name': 'Z', 'urls': ['https://down.hu/']}, fetch_raw=fail, pause=0) is None
print('Facebook page discovery tests passed')
