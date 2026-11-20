// End-to-end test of the studio UI in Chromium (pre-installed Playwright).
// Run: node tests/e2e.mjs [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from './helpers.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || path.join(ROOT, 'tests/output/e2e');
mkdirSync(out, { recursive: true });
const port = 8890 + Math.floor(Math.random() * 100);
const server = spawn('python3', [path.join(ROOT, 'tools/serve.py'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const URL = `http://127.0.0.1:${port}`;

function pngInfo(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

const results = [];
const check = (name, fn) => fn().then(() => results.push(['ok', name]), e => { results.push(['FAIL', name, e.message]); });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(`${URL}/graphics/index.html`);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });

  await check('fonts loaded (League Gothic regular + italic)', async () => {
    const ok = await page.evaluate(() => window.__studio.fontsOk() && document.fonts.check('40px "League Gothic Studio"') && document.fonts.check('40px "League Gothic Studio Italic"'));
    assert.ok(ok);
  });

  for (const lg of ['men', 'women']) {
    await page.click(`.league-toggle button[data-league="${lg}"]`);
    await page.waitForTimeout(400);
    const ids = await page.$$eval('#templateList button', bs => bs.map(b => b.dataset.id));
    await check(`${lg}: 7 templates offered, all of this league`, async () => {
      assert.equal(ids.length, 7);
      assert.ok(ids.every(id => id.endsWith('-' + lg)));
    });
    for (const id of ids) {
      await page.click(`#templateList button[data-id="${id}"]`);
      await page.waitForTimeout(350);
      await check(`${id}: export PNG 1920x1080 with alpha`, async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
        const file = path.join(out, `${id}.png`);
        await dl.saveAs(file);
        const info = pngInfo(readFileSync(file));
        assert.equal(info.width, 1920); assert.equal(info.height, 1080);
        assert.equal(info.colorType, 6, 'RGBA');
        assert.match(dl.suggestedFilename(), /^(Ferfi|Noi)_.*\.png$/);
      });
      await check(`${id}: deterministic render`, async () => {
        const [a, b] = await page.evaluate(async () => {
          const c = document.getElementById('canvas');
          const x = c.toDataURL(); await window.__studio.render(); return [x, c.toDataURL()];
        });
        assert.equal(a, b);
      });
    }
  }

  // overrides on the men intro: long Hungarian name, venue memory, visibility, colour
  await page.click('.league-toggle button[data-league="men"]');
  await page.click('#templateList button[data-id="intro-men"]');
  await page.waitForTimeout(300);
  await check('override: long Hungarian team name shrinks / wraps but never overflows', async () => {
    const f = page.locator('.field[data-id="home.name"] textarea');
    await f.fill('Falco-Vulcano Energia KC Szombathely');
    await page.waitForTimeout(300);
    const rep = await page.evaluate(() => window.__studio.report());
    assert.ok(!rep.overflow.includes('home.name'));
    const v = await page.evaluate(() => window.__studio.current().values['home.name']);
    assert.equal(v.text, 'Falco-Vulcano Energia KC Szombathely');
    await page.screenshot({ path: path.join(out, 'override-longname.png') });
  });
  await check('override: venue typed once is remembered for the home team', async () => {
    const f = page.locator('.field[data-id="venue"] input.txt');
    await f.fill('Messzi István Sportcsarnok');
    await f.dispatchEvent('change');
    await page.waitForTimeout(200);
    const venues = await page.evaluate(() => JSON.parse(localStorage.getItem('nbia.studio.venues.v1')));
    assert.ok(Object.values(venues).includes('Messzi István Sportcsarnok'));
  });
  await check('override: hidden element is not drawn, rank line can be switched on', async () => {
    await page.locator('.field[data-id="home.rank"] input.vis').check();
    await page.waitForTimeout(250);
    const v = await page.evaluate(() => window.__studio.current().values['home.rank']);
    assert.equal(v.visible, true);
    assert.match(v.text, /^\(\d+\. hely - \d+-\d+\)$/);
  });
  await check('override: colour change applies', async () => {
    await page.locator('.field[data-id="venue"] select.color').selectOption('#1fbf1b');
    await page.waitForTimeout(250);
    const v = await page.evaluate(() => window.__studio.current().values.venue);
    assert.equal(v.color, '#1fbf1b');
  });
  await check('presets: save, change, load restores overrides', async () => {
    await page.fill('#presetName', 'E2E intro');
    await page.click('#savePreset');
    await page.locator('.field[data-id="home.name"] textarea').fill('Valami Más');
    await page.waitForTimeout(200);
    await page.click('#presetList button[data-load="0"]');
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => window.__studio.current().values['home.name']);
    assert.equal(v.text, 'Falco-Vulcano Energia KC Szombathely');
    await page.screenshot({ path: path.join(out, 'ui-intro-overrides.png') });
  });
  await check('missing data is flagged in the editor (referees)', async () => {
    await page.click('#templateList button[data-id="referees-men"]');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.field.missing').count(), 4);
    await page.locator('.field[data-id="ref1"] input.txt').fill('Goda László');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.field.missing').count(), 3);
  });
  await check('women: stale data warning is shown with the update times', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="results-women"]');
    await page.waitForTimeout(400);
    const txt = await page.locator('#notices').innerText();
    assert.match(txt, /Régi adat/);
    const fresh = await page.locator('#freshness .stale').count();
    assert.ok(fresh >= 1);
    await page.screenshot({ path: path.join(out, 'ui-results-women.png') });
  });
  await check('teamstats: player selection limited to the rows of the design', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="teamstats-men"]');
    await page.waitForTimeout(300);
    await page.selectOption('#teamSel', 'kecskemet');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.players input:checked').count(), 13);
    await page.screenshot({ path: path.join(out, 'ui-teamstats-men.png') });
  });
  await check('no console errors in the studio', async () => assert.deepEqual(errors, []));

  // the existing dashboard still loads cleanly
  await check('dashboard index.html still loads without page errors', async () => {
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(`${URL}/index.html`);
    await p2.waitForTimeout(2500);
    assert.deepEqual(errs, []);
    await p2.close();
  });
} finally {
  await browser.close();
  server.kill();
}
for (const r of results) console.log(r.join(' | '));
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`${results.length - failed}/${results.length} passed`);
writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
