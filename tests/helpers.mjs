import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// All tests run on a frozen copy of the data (tests/fixtures/data) and a frozen clock, so they do not change when the live data does.
// DATA_DIR=data runs them on the live files (the daily data-health workflow does that).
export const DATA_DIR = process.env.DATA_DIR || 'tests/fixtures/data';
export const FIXED_NOW = process.env.DATA_DIR ? undefined : '2026-11-21T21:30:00+01:00';
export const readJson = async rel => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
export async function loadStore(now = new Date('2026-11-20T18:00:00Z'), withCups = false) {
  const { loadDashboard } = await import('../graphics/js/data.js');
  // the live European-games feed changes daily: the tests that exercise cup handling bring their own games
  return loadDashboard(f => (f.startsWith('cups_') && !withCups ? Promise.reject(new Error('cups feed not used in tests')) : readJson(DATA_DIR + '/' + f)), now);
}
