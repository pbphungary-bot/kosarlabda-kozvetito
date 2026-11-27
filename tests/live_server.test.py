"""The supervision of the central computer (tools/live_server.py Child): a process that stops is started again and the stop is logged. Run: python3 tests/live_server.test.py"""
import importlib.util, os, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('live_server', ROOT / 'tools' / 'live_server.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.LOG = str(Path(tempfile.mkdtemp()) / 'log.txt')  # the tests never write the real log


class Clock:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


class Supervision(unittest.TestCase):
    def child(self, code, clock):
        return mod.Child('próba', [sys.executable, '-c', f'import sys; sys.exit({code})'], now=clock)

    def wait(self, c):
        c.p.wait(timeout=20)

    def test_a_stopped_process_is_started_again_after_a_pause_and_logged(self):
        clock = Clock(); c = self.child(3, clock); c.start(); self.wait(c)
        self.assertFalse(c.alive())
        self.assertFalse(c.check(), 'the first look only schedules the restart')
        clock.t += 2
        self.assertFalse(c.check(), 'not yet: the pause is 3 s')
        clock.t += 2
        self.assertTrue(c.check(), 'restarted after the pause')
        self.assertEqual(c.restarts, 1)
        self.wait(c)
        text = open(mod.LOG, encoding='utf-8').read()
        self.assertIn('próba leállt (kilépési kód: 3)', text)
        self.assertIn('újraindítva', text)

    def test_a_process_that_keeps_dying_is_restarted_ever_more_slowly(self):
        clock = Clock(); c = self.child(1, clock); c.start(); delays = []
        for _ in range(4):
            self.wait(c); c.check(); delays.append(round(c.restart_at - clock.t))
            clock.t += delays[-1]; self.assertTrue(c.check())
        self.assertEqual(delays, [3, 6, 12, 24])

    def test_a_process_that_ran_a_while_starts_the_waits_over(self):
        clock = Clock(); c = self.child(1, clock); c.start(); c.fails = 4
        self.wait(c); clock.t += 60  # ran a minute before it stopped
        c.check(); self.assertEqual(round(c.restart_at - clock.t), 3)

    def test_a_running_process_is_left_alone(self):
        clock = Clock(); c = mod.Child('hosszú', [sys.executable, '-c', 'import time; time.sleep(30)'], now=clock); c.start()
        try:
            self.assertFalse(c.check()); self.assertTrue(c.alive())
        finally:
            c.p.terminate(); c.p.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
