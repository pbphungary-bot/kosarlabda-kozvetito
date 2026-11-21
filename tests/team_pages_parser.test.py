"""Parser test for the Hunbasket team pages (real saved pages)."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_team_pages as u


class TeamPages(unittest.TestCase):
    def test_stats_tables(self):
        name, s = u.parse_stats((ROOT / 'tests/fixtures/hunbasket-team-stats.html').read_text(encoding='utf-8'))
        self.assertEqual(name, 'ELTE BEAC Újbuda')
        self.assertEqual(set(s), {'average', 'total', 'per40'})
        for kind in s.values():
            self.assertEqual(len(kind['players']), 13)
            for row in kind['players']:
                self.assertGreaterEqual(len(row), len(u.STAT_COLS))
        first = s['average']['players'][0]
        self.assertEqual(first[1], 'Drahos Leila')
        self.assertEqual(first[4], '18.9')  # points per game
        self.assertTrue(first[-1].startswith('https://hunbasket.hu/jatekos/'))
        self.assertEqual(s['total']['team'][4], '588')  # whole-team points in the totals table

    def test_team_page(self):
        p = u.parse_team_page((ROOT / 'tests/fixtures/hunbasket-team-page.html').read_text(encoding='utf-8'))
        self.assertEqual(len(p['roster']), 13)
        r = p['roster'][0]
        self.assertEqual((r['number'], r['nationality'], r['birth_year'], r['height']), ('1', 'USA', '2002', '186 cm'))
        self.assertTrue(p['zones'] and p['zones'][0]['zone'] == 'Gyűrű')
        self.assertEqual(p['team_records'][0]['label'], 'Legnagyobb arányú győzelem')
        self.assertEqual(p['team_records'][0]['result'], '94 - 56')
        self.assertEqual(p['player_records'][0]['player'], 'Drahos Leila')

    def test_real_data_files(self):
        import json
        for lg, n in (('men', 14), ('women', 11)):
            d = json.loads((ROOT / (__import__('os').environ.get('DATA_DIR') or 'tests/fixtures/data') / f'team_pages_{lg}.json').read_text(encoding='utf-8'))
            self.assertEqual(len(d['teams']), n)
            for t in d['teams']:
                self.assertTrue(t['roster'] and t['stats']['average']['players'], t['name'])


if __name__ == '__main__':
    unittest.main()
