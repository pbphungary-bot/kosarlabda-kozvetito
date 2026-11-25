"""Names with ő / ű from the mkosz.hu match page (the live feed writes them as '?'). Run: python3 tests/mkosz_names.test.py
The fixture is a saved mkosz.hu match page (Csata DSE, women's U18)."""
import importlib.util
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('mkosz_names', ROOT / 'tools' / 'mkosz_names.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
PAGE = (ROOT / 'tests' / 'fixtures' / 'mkosz' / 'csata_ksc_match.htm').read_text(encoding='utf-8')


class MkoszNames(unittest.TestCase):
    def test_names_by_player_number(self):
        n = mod.parse_names(PAGE)
        self.assertEqual(len(n), 21)
        self.assertEqual(n['201536'], 'Halasy Enikő')  # the feed has "Halasy Enik?" for the same number

    def test_first_spelling_wins_and_entities_are_decoded(self):
        page = '<a href="https://mkosz.hu/jatekos/x2627/whun/123/a-b" title="Kov&aacute;cs &#337;rs"><img></a> <a href="https://mkosz.hu/jatekos/x2627/whun/123/a-b" title="Other">'
        self.assertEqual(mod.parse_names(page), {'123': 'Kovács őrs'})

    def test_nothing_found_is_empty(self):
        self.assertEqual(mod.parse_names('<html>no players</html>'), {})
        self.assertEqual(mod.parse_names(None), {})

    def test_match_address(self):
        self.assertEqual(mod.match_url('whunu18_142813', time.strptime('2026-11-25', '%Y-%m-%d')), 'https://mkosz.hu/merkozes/x2627/whunu18/whunu18_142813')
        self.assertEqual(mod.match_url('hun_134841', time.strptime('2027-03-01', '%Y-%m-%d')), 'https://mkosz.hu/merkozes/x2627/hun/hun_134841')
        self.assertEqual(mod.season(time.strptime('2027-09-01', '%Y-%m-%d')), 'x2728')


if __name__ == '__main__':
    unittest.main()
