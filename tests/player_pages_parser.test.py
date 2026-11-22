"""Parser test for the Hunbasket player pages (a real saved page) and the shape of the collected data files."""
import json, os, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_player_pages as u


class PlayerPages(unittest.TestCase):
    def test_page(self):
        d = u.parse_player_page((ROOT / 'tests/fixtures/hunbasket-player-page.html').read_text(encoding='utf-8'))
        self.assertEqual(set(d['season']), {'average', 'total', 'per40'})
        self.assertEqual(d['season']['average'][u.SEASON_COLS.index('P.')], '15.6')
        self.assertEqual(d['season']['total'][u.SEASON_COLS.index('P.')], '109')
        self.assertEqual(len(d['advanced']), len(u.ADV_COLS))
        self.assertEqual(len(d['gamelog']), 7)
        g = d['gamelog'][0]
        self.assertEqual((g['date'], g['opponent'], g['result']), ('2026. 09. 24.', 'ETO Basket', '88–74'))
        self.assertEqual(len(g['stats']), len(u.GAME_COLS))
        self.assertEqual(g['stats'][u.GAME_COLS.index('P.')], '20')
        reg = d['career']['regular']
        self.assertEqual([r['label'] for r in reg], ['2026/2027', '1 szezon', 'Összesítés'])
        self.assertEqual(reg[0]['average'][u.SEASON_COLS.index('P.')], '15.6')
        self.assertEqual(reg[0]['total'][u.SEASON_COLS.index('P.')], '109')

    def test_data_files(self):
        for lg in ('men', 'women'):
            p = ROOT / (os.environ.get('DATA_DIR') or 'tests/fixtures/data') / f'player_pages_{lg}.json'
            if not p.exists():
                continue
            d = json.loads(p.read_text(encoding='utf-8'))
            self.assertGreater(len(d['players']), 100, lg)
            for pid, x in list(d['players'].items())[:40]:
                self.assertEqual(len(x['season']['average']), len(u.SEASON_COLS), pid)


if __name__ == '__main__':
    unittest.main()
