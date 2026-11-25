"""What the builder puts on air (tools/serve.py get_state / set_state). Run: python3 tests/live_state.test.py"""
import importlib.util, json, os, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ['LIVE_STATE_FILE'] = str(Path(tempfile.mkdtemp()) / 'state.json')
spec = importlib.util.spec_from_file_location('serve', ROOT / 'tools' / 'serve.py')
mod = importlib.util.module_from_spec(spec)
os.chdir(ROOT)
spec.loader.exec_module(mod)


class LiveState(unittest.TestCase):
    def test_nothing_chosen_yet(self):
        self.assertEqual(mod.get_state('whun_1111'), {'rev': 0, 'state': {}})

    def test_every_change_raises_the_revision_and_is_saved(self):
        a = mod.set_state('whun_2222', {'graphic': 'liveteam'})
        b = mod.set_state('whun_2222', {'graphic': 'liveleaders', 'leaderStats': ['pts']})
        self.assertEqual((a['rev'], b['rev']), (1, 2))
        self.assertEqual(mod.get_state('whun_2222')['state']['graphic'], 'liveleaders')
        saved = json.load(open(os.environ['LIVE_STATE_FILE'], encoding='utf-8'))
        self.assertEqual(saved['whun_2222']['rev'], 2)
        self.assertEqual(mod.get_state('whun_3333')['rev'], 0, 'games do not share a choice')

    def test_game_code_shape(self):
        self.assertTrue(mod.GAME.match('whunu18_142813')); self.assertFalse(mod.GAME.match('../etc'))


if __name__ == '__main__':
    unittest.main()
