import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = async rel => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
export async function loadStore(now = new Date('2026-11-20T18:00:00Z'), withCups = false) {
  const { loadDashboard } = await import('../graphics/js/data.js');
  // the live European-games feed changes daily: the tests that exercise cup handling bring their own games
  return loadDashboard(f => (f.startsWith('cups_') && !withCups ? Promise.reject(new Error('cups feed not used in tests')) : readJson('data/' + f)), now);
}
