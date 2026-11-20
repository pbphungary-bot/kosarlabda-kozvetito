import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = async rel => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
export async function loadStore(now = new Date('2026-11-20T18:00:00Z')) {
  const { loadDashboard } = await import('../graphics/js/data.js');
  return loadDashboard(f => readJson('data/' + f), now);
}
