"""Test for scripts/update_previews.py: statements of a BB1-like preview article (invented names and texts), candidate selection and the incremental build.
Run: python3 tests/previews_parser.test.py"""
import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('update_previews', ROOT / 'scripts' / 'update_previews.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
HTML = (ROOT / 'tests' / 'fixtures' / 'previews' / 'bb1-preview-structure.html').read_text(encoding='utf-8')
NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)


def article(url, title='Alfa KC – Béta SE', days_ago=1, teams=('men|Alfa', 'men|Béta'), source='BB1.hu'):
    return {'source': source, 'title': title, 'url': url, 'published_at': (NOW - timedelta(days=days_ago)).isoformat(), 'teams': list(teams), 'league': 'men', 'summary': 'x'}


class Previews(unittest.TestCase):
    def test_statements_are_the_bold_labelled_paragraphs_inside_the_article_only(self):
        s = mod.extract_statements(HTML)
        self.assertEqual([(x['speaker'], x['club']) for x in s], [('Teszt Elek', 'Alfa KC'), ('Minta Géza', 'Béta SE')])
        self.assertTrue(s[0]['text'].startswith('Ez egy kitalált nyilatkozat'))
        self.assertTrue(s[0]['text'].endswith('Harmadik mondat a végén.'))
        self.assertNotIn('Teszt Elek', s[0]['text'], 'the label is not part of the text')
        self.assertFalse(any('cikken kívüli' in x['text'] for x in s), 'comments below the article are not statements')
        self.assertFalse(any(x['speaker'] == 'Rövid' for x in s), 'a short caption is not a statement')

    def test_no_article_no_statements_and_no_invention(self):
        self.assertEqual(mod.extract_statements('<html><body><p>Semmi sem nyilatkozat.</p></body></html>'), [])
        self.assertEqual(mod.extract_statements(''), [])

    def test_candidates_are_recent_two_team_previews_of_the_listed_sources(self):
        news = {'articles': [article('u1'), article('u2', days_ago=30), article('u3', teams=('men|Alfa',)), article('u4', title='Összefoglaló'),
                             article('u5', source='Másik'), article('u6', days_ago=0.5)]}
        self.assertEqual([a['url'] for a in mod.candidates(news, NOW)], ['u6', 'u1'], 'newest first; old / one-team / no "A – B" title / other source dropped')

    def test_incremental_build_fetches_only_new_or_young_empty_articles(self):
        calls = []
        def fake(url):
            calls.append(url)
            return HTML if url != 'empty' else '<article><p>nincs</p></article>'
        news = {'articles': [article('new'), article('known', days_ago=5), article('empty', days_ago=1), article('oldempty', days_ago=10)]}
        old = {'known': {'url': 'known', 'statements': [{'speaker': 'A', 'club': 'B', 'text': 'x' * 50}], 'title': 'régi cím', 'teams': ['men|Alfa', 'men|Béta']},
               'oldempty': {'url': 'oldempty', 'statements': [], 'title': 't', 'teams': ['men|Alfa', 'men|Béta']}}
        items, fetched = mod.build(news, old, NOW, fetch_fn=fake)
        self.assertEqual(sorted(calls), ['empty', 'new'], 'known (has statements) and old empty ones are not fetched again')
        self.assertEqual(fetched, 2)
        self.assertEqual({i['url'] for i in items}, {'new', 'known', 'empty', 'oldempty'})
        self.assertEqual(next(i for i in items if i['url'] == 'new')['statements'][0]['speaker'], 'Teszt Elek')
        self.assertEqual(next(i for i in items if i['url'] == 'known')['title'], 'Alfa KC – Béta SE', 'title / tags follow the news file')

    def test_network_trouble_keeps_the_old_data(self):
        def boom(url):
            raise OSError('down')
        old = {'u1': {'url': 'u1', 'statements': [], 'title': 't', 'teams': ['men|Alfa', 'men|Béta'], 'published_at': 'x'}}
        items, fetched = mod.build({'articles': [article('u1', days_ago=0.2), article('u2')]}, old, NOW, fetch_fn=boom)
        self.assertEqual([i['url'] for i in items], ['u1'], 'a failed fetch keeps the previous item and invents nothing')

    def test_request_limit_per_run(self):
        news = {'articles': [article(f'u{i}', days_ago=1 + i / 100) for i in range(20)]}
        items, fetched = mod.build(news, {}, NOW, fetch_fn=lambda u: HTML, max_fetch=5)
        self.assertEqual(fetched, 5); self.assertEqual(len(items), 5)


if __name__ == '__main__':
    unittest.main(verbosity=1)
