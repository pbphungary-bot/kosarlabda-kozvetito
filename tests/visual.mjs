// Visual fidelity test: renders every template with the PSD's own sample content
// and compares it with Photoshop's composite. Run: node tests/visual.mjs [outDir]
// (starts its own static server; needs the pre-installed Playwright Chromium)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || path.join(ROOT, 'tests/output/visual');
mkdirSync(out, { recursive: true });
const port = 8790 + Math.floor(Math.random() * 100);
const server = spawn('python3', [path.join(ROOT, 'tools/serve.py'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${port}/tests/harness.html`);
  await page.waitForFunction(() => window.harnessReady && window.harness);
  const fonts = await page.evaluate(() => window.harness.init());
  console.log('fonts loaded:', fonts);
  const ids = await page.evaluate(() => window.harness.ids);
  const rows = [];
  for (const id of ids) {
    const r = await page.evaluate(i => window.harness.renderSample(i), id);
    writeFileSync(path.join(out, `${id}.render.png`), Buffer.from(r.render.split(',')[1], 'base64'));
    writeFileSync(path.join(out, `${id}.diff.png`), Buffer.from(r.diff.split(',')[1], 'base64'));
    rows.push({ id, size: `${r.width}x${r.height}`, badPct: r.badPct, tolerantBadPct: r.tolerantBadPct, meanDiff: r.meanDiff, scaled: r.report.scaled.length, overflow: r.report.overflow.length });
  }
  console.table(rows);
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(rows, null, 1));
} finally {
  await browser.close();
  server.kill();
}
