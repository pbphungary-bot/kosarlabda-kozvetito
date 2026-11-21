"""Parser test for scripts/update_referees.py on a small page with the structure of the Hunbasket full schedule.
Names and arenas are invented. Run: python3 tests/referees_parser.test.py"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('update_referees', ROOT / 'scripts' / 'update_referees.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def main_row(home, away, link):
    return f'''<tr><td><div class="data-group-team"><div class="home-team-cell"><div class="home-team-name"><a href="https://x/csapat/1"><span>{home}</span></a></div></div>
    <div class="game-cell"><a href="{link}">x</a></div>
    <div class="away-team-cell"><div class="away-team-name"><a href="https://x/csapat/2"><span>{away}</span></a></div></div></div></td></tr>'''


def detail_row(arena, refs, controller, gid):
    title = ','.join(refs) if refs else ',,'
    names = ', '.join(refs)
    return f'''<tr><td class="arena-name" title="{arena}"><span>{arena}</span></td><td colspan="2"><div class="data-group data-group-staff-overview">
    <div class="data-group data-group-team"><div title="{title}"> Játékvezetők: {names} </div><div> Ellenőr: {controller} </div></div>
    <button onclick="location.href='https://hunbasket.hu/merkozes/x2627/hun/{gid}'">összefoglaló</button></div></td></tr>'''


HTML = '<table class="desktop-only"><tbody>' + ''.join([
    main_row('Alfa', 'Béta', 'https://hunbasket.hu/merkozes/x2627/hun/hun_1'),
    detail_row('Teszt Aréna', ['Egy Elek', 'Két Kata', 'Három Hugó'], 'Ellen Őr', 'hun_1'),
    # upcoming game: the main row links to a preview page, the detail row to the match page
    main_row('Gamma', 'Delta', 'https://hunbasket.hu/merkozesbeharangozo/x2627/hun/hun_2'),
    detail_row('Másik Csarnok', [], '', 'hun_2'),
    # a detail row that belongs to a different game id must not be attached to the previous main row
    main_row('Epszilon', 'Zéta', 'https://hunbasket.hu/merkozes/x2627/hun/hun_3'),
    detail_row('Idegen Aréna', ['X Y', 'Z W', 'Q R'], 'Más Ellenőr', 'hun_99'),
]) + '</tbody></table>'


class ParseTests(unittest.TestCase):
    def test_played_and_upcoming_games(self):
        g = mod.parse(HTML)
        k1 = 'https://hunbasket.hu/merkozes/x2627/hun/hun_1'
        k2 = 'https://hunbasket.hu/merkozes/x2627/hun/hun_2'
        self.assertEqual(g[k1], {'home': 'Alfa', 'away': 'Béta', 'venue': 'Teszt Aréna',
                                 'referees': ['Egy Elek', 'Két Kata', 'Három Hugó'], 'controller': 'Ellen Őr'})
        self.assertEqual(g[k2]['referees'], [])        # upcoming game: arena known, referees not yet published
        self.assertEqual(g[k2]['controller'], '')
        self.assertEqual(g[k2]['venue'], 'Másik Csarnok')

    def test_mismatched_detail_row_is_not_attached(self):
        g = mod.parse(HTML)
        self.assertNotIn('https://hunbasket.hu/merkozes/x2627/hun/hun_3', g)
        self.assertNotIn('https://hunbasket.hu/merkozes/x2627/hun/hun_99', g)
        self.assertEqual(len(g), 2)

    def test_published_referees_are_never_blanked(self):
        k = 'https://hunbasket.hu/merkozes/x2627/hun/hun_1'
        old = {k: {'home': 'Alfa', 'away': 'Béta', 'venue': 'Teszt Aréna', 'referees': ['A', 'B', 'C'], 'controller': 'K'}}
        new = {k: {'home': 'Alfa', 'away': 'Béta', 'venue': '', 'referees': [], 'controller': ''}}
        merged = mod.merge_keep_known(old, new)[k]
        self.assertEqual(merged['referees'], ['A', 'B', 'C'])
        self.assertEqual(merged['controller'], 'K')
        self.assertEqual(merged['venue'], 'Teszt Aréna')

    def test_real_data_files_are_consistent(self):
        for lg in ('men', 'women'):
            data = json.loads((ROOT / 'data' / f'referees_{lg}.json').read_text(encoding='utf-8'))
            self.assertEqual(data['league'], lg)
            for url, g in data['matches'].items():
                self.assertIn('/merkozes/', url)
                self.assertIn(len(g['referees']), (0, 3), url)


if __name__ == '__main__':
    unittest.main()
