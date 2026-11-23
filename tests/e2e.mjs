// End-to-end test of the studio UI in Chromium (pre-installed Playwright).
// Run: node tests/e2e.mjs [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, DATA_DIR, FIXED_NOW } from './helpers.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || path.join(ROOT, 'tests/output/e2e');
mkdirSync(out, { recursive: true });
const port = 8890 + Math.floor(Math.random() * 100);
const server = spawn('python3', [path.join(ROOT, 'tools/serve.py'), String(port)], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: 'close' } })).arrayBuffer(); break; } catch { await new Promise(r => setTimeout(r, 100)); } } // wait until the server answers
const URL = `http://127.0.0.1:${port}`;

function pngInfo(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

/** Selects the panel (frame) in the layout editor by clicking a spot of its edge that no other element covers; retries while the overlay settles. */
async function selectPanel(page) {
  await page.waitForSelector('.hit[data-id="panel"]', { timeout: 15000 });
  for (let attempt = 0; attempt < 6; attempt++) {
    const hit = await page.$('.hit[data-id="panel"]'); await hit.scrollIntoViewIfNeeded();
    const bb = await hit.boundingBox();
    const vp = page.viewportSize();
    const pts = [];
    for (let f = 0.06; f < 0.95; f += 0.03) pts.push([bb.x + bb.width * f, bb.y + bb.height - 4], [bb.x + bb.width * f, bb.y + 4]);
    for (let f = 0.06; f < 0.95; f += 0.03) pts.push([bb.x + 4, bb.y + bb.height * f], [bb.x + bb.width - 4, bb.y + bb.height * f]);
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > vp.width || y > vp.height) continue;
      if (await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.dataset?.id === 'panel', [x, y])) { await page.mouse.click(x, y); return true; }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

const results = [];
const check = (name, fn) => fn().then(() => results.push(['ok', name]), e => { results.push(['FAIL', name, e.message]); });

/** Frozen data + clock for every browser context (see helpers.mjs); the cup feed stays empty, the cup tests bring their own games. */
async function hermetic(c) {
  await c.route(/\/data\/[a-z0-9_]+\.json/, r => {
    const file = path.join(ROOT, DATA_DIR, new globalThis.URL(r.request().url()).pathname.split('/').pop());
    return r.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
  await c.route(/\/data\/cups_[a-z]+\.json/, r => r.fulfill({ contentType: 'application/json', body: '{"updated_at":null,"games":[]}' }));
  if (FIXED_NOW) await c.clock.setFixedTime(new Date(FIXED_NOW));
  return c;
}

const browser = await chromium.launch();
try {
  const ctx = await hermetic(await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  // the live European-games feed changes daily; the cup tests bring their own games (an empty feed is served)
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
    await check(`${lg}: 16 templates offered, all of this league`, async () => {
      assert.equal(ids.length, 16);
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
  await check('intro: position + record line is shown by default and can be switched off and on', async () => {
    const vis = () => page.evaluate(() => window.__studio.current().values['home.rank']);
    let v = await vis();
    assert.notEqual(v.visible, false, 'visible by default');
    assert.match(v.text, /^\(\d+\. hely - \d+-\d+\)$/);
    await page.locator('.field[data-id="home.rank"] input.vis').uncheck();
    await page.waitForTimeout(250);
    assert.equal((await vis()).visible, false);
    await page.locator('.field[data-id="home.rank"] input.vis').check();
    await page.waitForTimeout(250);
    assert.equal((await vis()).visible, true);
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
  await check('missing data is flagged in the editor (referees) and manual entry clears the flag', async () => {
    await page.click('#templateList button[data-id="referees-men"]');
    await page.waitForTimeout(300);
    await page.check('#showPast');
    await page.check('#showOpen');
    await page.waitForTimeout(300);
    // a game whose referees are not published yet
    const open = await page.evaluate(() => { const s = window.__studio.store; return s.league('men').fixtures.find(m => !s.matchStaff('men', m)?.referees?.length).url; });
    await page.selectOption('#matchSel', open);
    await page.waitForTimeout(400);
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
  await check('excel import: several files at once, league auto-detected, graphic uses Excel values, persists, can be switched off', async () => {
    await page.click('.league-toggle button[data-league="men"]'); // wrong league selected on purpose
    await page.click('#templateList button[data-id="comparison-men"]');
    await page.waitForTimeout(300);
    await page.locator('#importBox summary').click();
    await page.setInputFiles('#excelFile', [
      path.join(ROOT, 'tests/fixtures/boxscore_team_avg_women.xlsx'),
      path.join(ROOT, 'tests/fixtures/boxscore_team_avg_men.xlsx'),
      path.join(ROOT, 'tests/fixtures/statalap-layout.xlsx'),
    ]);
    await page.waitForSelector('#applyImport');
    const prev = await page.locator('#importPreview').innerText();
    assert.match(prev, /Női NB I\/A/);
    assert.match(prev, /Férfi NB I\/A/);
    assert.match(prev, /csapatstatisztika/);
    assert.match(prev, /játékosstatisztika/);
    assert.match(prev, /Munka1/);
    await page.screenshot({ path: path.join(out, 'ui-import-preview.png') });
    await page.click('#applyImport');
    await page.waitForTimeout(600);
    // men league: Falco EFF now present from the Excel
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="comparison-men"]');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', '__custom');
    await page.selectOption('#customHome', 'falcokc');
    await page.selectOption('#customAway', 'albafehervar');
    await page.waitForTimeout(400);
    let v = await page.evaluate(() => window.__studio.current().values);
    assert.equal(v['home.val'].text, '118.0');
    assert.match(v['home.val'].source, /^Excel/);
    await page.screenshot({ path: path.join(out, 'ui-comparison-men-excel.png') });
    // women league: DVTK – Csata reproduces the PSD
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="comparison-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', '__custom');
    await page.selectOption('#customHome', 'dvtkhuntherm');
    await page.selectOption('#customAway', 'csatattk');
    await page.waitForTimeout(400);
    v = await page.evaluate(() => window.__studio.current().values);
    assert.equal(v['home.val'].text, '102.8');
    assert.equal(v['home.rank.ppg'].text, '(3.)');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'comparison-women-excel.png'));
    assert.equal(pngInfo(readFileSync(path.join(out, 'comparison-women-excel.png'))).width, 1920);
    await page.screenshot({ path: path.join(out, 'ui-comparison-women-excel.png') });
    // persists across reload
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await page.click('.league-toggle button[data-league="women"]');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#freshness').innerText(), /Excel:/);
    const x = await page.evaluate(() => window.__studio.store.excelInfo('women'));
    assert.equal(x.files.length, 2);
    // switch off → dashboard values return; clear removes it
    await page.locator('#importBox summary').click();
    await page.uncheck('#excelOn');
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(() => window.__studio.store.excelInfo('women'))).enabled, false);
    await page.check('#excelOn'); await page.click('#excelClear');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__studio.store.excelInfo('women')), null);
    assert.notEqual(await page.evaluate(() => window.__studio.store.excelInfo('men')), null, 'men data untouched by clearing women');
  });
  await check('intro: two-line name + rank line do not overlap (DVTK Huntherm), logo stays clear', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="intro-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', '__custom');
    await page.selectOption('#customHome', 'dvtkhuntherm');
    await page.selectOption('#customAway', 'csatattk');
    await page.waitForTimeout(300);
    await page.locator('.field[data-id="home.rank"] input.vis').check();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const g = document.getElementById('canvas').getContext('2d');
      const x0 = 440, y0 = 600, w = 400, h = 360;
      const d = g.getImageData(x0, y0, w, h).data;
      const whiteRows = [];
      for (let y = 0; y < h; y++) {
        let n = 0;
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 200 && d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) n++; }
        if (n) whiteRows.push(y + y0);
      }
      return { whiteRows };
    });
    const nameRows = m.whiteRows.filter(y => y >= 662 && y < 850);
    const inGap = m.whiteRows.filter(y => y >= 815 && y <= 858);
    assert.ok(nameRows.length > 100, 'name drawn');
    assert.deepEqual(inGap, [], 'nothing between the name block (ends ≈809) and the rank line (starts ≈863)');
    assert.ok(Math.min(...nameRows) >= 655, `name top ${Math.min(...nameRows)} must stay below the logo (≈650)`);
    await page.screenshot({ path: path.join(out, 'ui-intro-rank-fixed.png') });
  });
  await check('base opacity: default 96.5 % inside the panel, slider and PSD value work, export keeps it', async () => {
    const alphaAt = () => page.evaluate(() => document.getElementById('canvas').getContext('2d').getImageData(380, 700, 1, 1).data[3]);
    assert.equal(await alphaAt(), 246); // 0.965 * 255
    assert.equal(await page.evaluate(() => document.getElementById('canvas').getContext('2d').getImageData(960, 1030, 1, 1).data[3] >= 0), true);
    await page.locator('#baseOpacity').fill('100');
    await page.waitForTimeout(250);
    assert.equal(await alphaAt(), 255);
    await page.locator('#baseOpacity').fill('90');
    await page.waitForTimeout(250);
    assert.equal(await alphaAt(), 230);
    await page.click('#baseOpacityPsd');
    await page.waitForTimeout(250);
    assert.equal(await alphaAt(), 255); // the intro PSD is fully opaque
    assert.match(await page.locator('#baseOpacityVal').innerText(), /PSD/);
    // outside the panel (logo strip) the opacity is untouched
    await page.locator('#baseOpacity').fill('90');
    await page.waitForTimeout(250);
    const strip = await page.evaluate(() => document.getElementById('canvas').getContext('2d').getImageData(900, 1020, 1, 1).data[3]);
    assert.ok(strip === 0 || strip > 230);
    await page.locator('#baseOpacity').fill('96.5');
    await page.waitForTimeout(250);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'intro-women-rank.png'));
    assert.equal(await alphaAt(), 246);
  });
  await check('cup games: upload sheet, European rows appear with competition logo on results and schedule', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="results-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#teamSel', 'dvtkhuntherm');
    await page.locator('#importBox').evaluate(el => { el.open = true; });
    await page.setInputFiles('#excelFile', path.join(ROOT, 'tests/fixtures/cups-women.xlsx'));
    await page.waitForSelector('#applyImport');
    const prev = await page.locator('#importPreview').innerText();
    assert.match(prev, /kupa-\/európai meccsek/);
    assert.match(prev, /Magyar Kupa/); // no logo warning
    assert.match(prev, /Olympiacos/); // skipped row reported
    await page.screenshot({ path: path.join(out, 'ui-cups-preview.png') });
    await page.click('#applyImport');
    await page.waitForTimeout(500);
    await page.click('#templateList button[data-id="schedule-women"]');
    await page.waitForTimeout(400);
    await page.selectOption('#teamSel', 'dvtkhuntherm');
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => window.__studio.current().values);
    const comps = Object.entries(v).filter(([k, x]) => k.endsWith('.comp') && x.src).map(([k, x]) => x.src);
    assert.ok(comps.includes('comp/eurocup-women'), JSON.stringify(comps));
    const matches = Object.entries(v).filter(([k]) => k.endsWith('.match')).map(([, x]) => x.text);
    assert.ok(matches.some(t => /Brod na Savi/.test(t)), matches.join(' | '));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'schedule-women-cups.png'));
    await page.click('#templateList button[data-id="results-women"]');
    await page.waitForTimeout(400);
    // default = latest six games; choose the European games through the picker
    await page.selectOption('#gameFilter', 'cup');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.gamelist input').count(), 3, 'three played European games');
    while (await page.locator('#rowEdit .rowdel').count()) { await page.locator('#rowEdit .rowdel').first().click(); await page.waitForTimeout(150); } // make room: delete the automatic rows
    for (const cb of await page.locator('.gamelist input').all()) await cb.check();
    await page.waitForTimeout(400);
    assert.match(await page.locator('#selection').innerText(), /kézi választás/);
    const euro = await page.evaluate(() => Object.entries(window.__studio.current().values).filter(([k, x]) => k.endsWith('.comp') && x.src).map(([, x]) => x.src).sort());
    assert.deepEqual(euro, ['comp/eurocup-women', 'comp/eurocup-women', 'comp/euroleague-women']);
    await page.screenshot({ path: path.join(out, 'ui-results-pick-european.png') });
    const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl3.saveAs(path.join(out, 'results-women-european.png'));
    await page.click('#gamesAuto');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#selection').innerText(), /automatikus/);
    const rv = await page.evaluate(() => window.__studio.current().values);
    assert.ok(Object.entries(rv).some(([k, x]) => k.endsWith('.comp') && x.src === 'comp/eurocup-women'));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl2.saveAs(path.join(out, 'results-women-cups.png'));
    await page.screenshot({ path: path.join(out, 'ui-results-cups.png') });
    await page.locator('#importBox').evaluate(el => { el.open = true; });
    await page.click('#excelClear');
    await page.waitForTimeout(300);
  });
  await check('eredmenyek.com paste: DVTK page → EuroCup games on the schedule with logo, 6 rows in the page order', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="schedule-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#teamSel', 'dvtkhuntherm');
    await page.locator('#importBox').evaluate(el => { el.open = true; });
    await page.fill('#pasteBox', readFileSync(path.join(ROOT, 'tests/fixtures/eredmenyek-paste.txt'), 'utf8'));
    await page.click('#pasteRead');
    await page.waitForSelector('#applyImport');
    const prev = await page.locator('#importPreview').innerText();
    assert.match(prev, /Női NB I\/A/);
    assert.match(prev, /Brod na Savi|kupa-\/európai meccsek/);
    assert.match(prev, /7 „NB I - női” mérkőzés kihagyva/);
    await page.click('#applyImport');
    await page.waitForTimeout(500);
    const dates = await page.evaluate(() => Object.entries(window.__studio.current().values).filter(([k]) => k.endsWith('.match')).map(([, x]) => x.text));
    const eu = dates.filter(t => /Brod na Savi|Jairis/.test(t));
    assert.equal(eu.length >= 1, true, dates.join(' | '));
    const comps = await page.evaluate(() => Object.entries(window.__studio.current().values).filter(([k, x]) => k.endsWith('.comp') && x.src).map(([, x]) => x.src));
    assert.ok(comps.every(c => c === 'comp/eurocup-women') && comps.length >= 1);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'schedule-dvtk-eredmenyek.png'));
    await page.screenshot({ path: path.join(out, 'ui-paste-schedule.png') });
    await page.locator('#importBox').evaluate(el => { el.open = true; });
    await page.click('#excelClear');
    await page.waitForTimeout(300);
  });
  await check('add a European game by hand: form → schedule row with logo → delete', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="schedule-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#teamSel', 'dvtkhuntherm');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#selection').innerText(), /nincs kupa-\/európai meccs/);
    await page.locator('#addGame summary').click();
    const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    await page.fill('#agDate', day);
    await page.fill('#agTime', '19:30');
    await page.selectOption('#agComp', 'EuroCup Women');
    await page.fill('#agOpp', 'Teszt Basket');
    await page.click('#agSave');
    await page.waitForTimeout(500);
    let v = await page.evaluate(() => window.__studio.current().values);
    const row = Object.entries(v).find(([k, x]) => k.endsWith('.match') && /Teszt Basket/.test(x.text));
    assert.ok(row, 'row with the added game');
    const r = row[0].split('.')[0];
    assert.equal(v[`${r}.comp`].src, 'comp/eurocup-women');
    assert.match(v[`${r}.date`].text, /19:30$/);
    assert.equal(await page.locator('.gamelist .delcup').count(), 1);
    await page.screenshot({ path: path.join(out, 'ui-add-game.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'schedule-added-game.png'));
    // validation: missing opponent is refused
    await page.fill('#agDate', day); // the form clears itself after a save
    await page.fill('#agOpp', '');
    await page.click('#agSave');
    assert.match(await page.locator('#agMsg').innerText(), /ellenfelet/);
    // delete it again
    await page.locator('.gamelist .delcup').click();
    await page.waitForTimeout(400);
    v = await page.evaluate(() => window.__studio.current().values);
    assert.ok(!Object.entries(v).some(([k, x]) => k.endsWith('.match') && /Teszt Basket/.test(x.text)));
    await page.locator('#importBox').evaluate(el => { el.open = true; });
    await page.click('#excelClear');
    await page.waitForTimeout(300);
  });
  await check('referees graphic and intro venue fill in from the Hunbasket full schedule (women PSD sample game)', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="referees-women"]');
    await page.waitForTimeout(300);
    await page.check('#showPast');
    await page.waitForTimeout(300);
    const url = await page.evaluate(() => window.__studio.store.league('women').fixtures.find(m => m.url.endsWith('whun_135479')).url);
    await page.selectOption('#matchSel', url);
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => window.__studio.current().values);
    assert.deepEqual(['ref1', 'ref2', 'ref3', 'controller'].map(k => v[k].text), ['Györfy Rúben', 'Major Ádám', 'Gombos Márk Bálint', 'Szabó Anita']);
    assert.equal(await page.locator('.field.missing').count(), 0);
    assert.match(await page.locator('#freshness').innerText(), /Játékvezetők:/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'referees-women-real.png'));
    await page.screenshot({ path: path.join(out, 'ui-referees-real.png') });
    // the same game on the intro: the arena is filled in from the data
    await page.click('#templateList button[data-id="intro-women"]');
    await page.waitForTimeout(300);
    await page.check('#showPast');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', url);
    await page.waitForTimeout(400);
    const iv = await page.evaluate(() => window.__studio.current().values);
    assert.equal(iv.venue.text, 'Olimpiai Sport Park');
    assert.match(iv.venue.source, /Hunbasket/);
    // a game without published referees is flagged for manual entry
    await page.click('#templateList button[data-id="referees-women"]');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => { const s = window.__studio.store; return s.league('women').fixtures.find(m => !s.matchStaff('women', m)?.referees?.length).url; });
    await page.check('#showOpen');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', open);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.field.missing').count(), 4);
    assert.match(await page.locator('#notices').innerText(), /nincsenek kiírva/);
  });
  await check('referee page opens on a game that already has referees: nothing to type', async () => {
    await page.evaluate(() => { localStorage.removeItem('nbia.studio.state.v1'); });
    await page.reload(); // fresh state: the tick boxes of earlier checks must not leak in
    await page.waitForSelector('body[data-ready="1"]');
    for (const lg of ['women', 'men']) {
      await page.click(`.league-toggle button[data-league="${lg}"]`);
      await page.click(`#templateList button[data-id="referees-${lg}"]`);
      await page.waitForTimeout(400);
      // default list: only games with published referees (upcoming)
      const opts = await page.$$eval('#matchSel option', os => os.map(o => o.textContent));
      const first = await page.evaluate(() => window.__studio.current().values.ref1.text);
      if (opts.length && opts[0] !== 'Nincs ilyen mérkőzés') {
        assert.ok(opts.every(o => !/nincs kiírva/.test(o)), opts.join(' | '));
        assert.notEqual(first, '—', `${lg}: first game must have referees`);
        assert.equal(await page.locator('.field.missing').count(), 0);
      }
    }
  });
  await check('next match graphic (Következik): picks any game, kick-off time as in the design, logos, optional frame, export', async () => {
    await page.evaluate(() => { localStorage.removeItem('nbia.studio.state.v1'); });
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="nextmatch-women"]');
    await page.waitForTimeout(400);
    const url = await page.evaluate(() => window.__studio.store.upcoming('women')[0].url);
    await page.selectOption('#matchSel', url);
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => window.__studio.current().values);
    const m = await page.evaluate(u => { const f = window.__studio.store.league('women').fixtures.find(x => x.url === u); return { time: f.time, home: f.homeId, away: f.awayId }; }, url);
    assert.equal(v.time.text, m.time.replace(':', '.'));
    assert.equal(v['home.logo'].src, `women/${m.home}`);
    assert.equal(v['away.logo'].src, `women/${m.away}`);
    assert.equal(v.title.text, 'Következik');
    assert.equal(await page.locator('.field[data-id="frame"] input.vis').isChecked(), false, 'frame off by default');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'nextmatch-women-real.png'));
    const info = pngInfo(readFileSync(path.join(out, 'nextmatch-women-real.png')));
    assert.equal(info.width, 1920); assert.equal(info.height, 1080); assert.equal(info.colorType, 6);
    // the frame switch draws the PSD's hidden frame; text and time stay editable
    await page.locator('.field[data-id="frame"] input.vis').check();
    await page.locator('.field[data-id="time"] input.txt').fill('20.30');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__studio.current().values.time.text), '20.30');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl2.saveAs(path.join(out, 'nextmatch-women-frame.png'));
    await page.screenshot({ path: path.join(out, 'ui-nextmatch.png') });
    // men league uses the same PSD
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="nextmatch-men"]');
    await page.waitForTimeout(400);
    assert.match(await page.locator('#selection').innerText(), /Mérkőzés/);
  });
  await check('top button "+ Kupa-/európai meccs" opens the add form from any template', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="referees-women"]'); // a template without the form
    await page.waitForTimeout(300);
    await page.click('#quickCup');
    await page.waitForSelector('#agOpp');
    assert.equal(await page.evaluate(() => document.querySelector('#addGame').open), true);
    assert.equal(await page.evaluate(() => window.__studio.state.template.women), 'schedule-women');
    assert.ok(await page.locator('#agSave').isVisible());
  });
  await check('intro: team name / rank font sizes and offsets can be set by hand, names equalised in one click', async () => {
    await page.evaluate(() => { localStorage.removeItem('nbia.studio.state.v1'); });
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="intro-men"]');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', '__custom');
    await page.selectOption('#customHome', 'kecskemet'); // "Duna Aszfalt-DTKH Kecskemét": long, shrinks automatically
    await page.selectOption('#customAway', 'szolnok');
    await page.waitForTimeout(400);
    const sizes = () => page.evaluate(() => window.__studio.report().sizes);
    let z = await sizes();
    assert.notEqual(Math.round(z['home.name']), Math.round(z['away.name']), 'auto sizes differ: ' + JSON.stringify(z));
    // one click: both names at the smaller (currently valid) size
    await page.click('#eqNames');
    await page.waitForTimeout(400);
    z = await sizes();
    assert.ok(Math.abs(z['home.name'] - z['away.name']) < 0.05, JSON.stringify(z));
    assert.ok(await page.locator('.field[data-id="away.name"] input.sz').inputValue() !== '');
    // set sizes by hand: exactly what was typed is used, nothing is shrunk any more
    await page.locator('.field[data-id="home.name"] input.sz').fill('70');
    await page.locator('.field[data-id="away.name"] input.sz').fill('70');
    await page.waitForTimeout(300);
    z = await sizes();
    assert.equal(z['home.name'], 70); assert.equal(z['away.name'], 70);
    // the rank lines (visible after ticking) and their size / offset
    await page.locator('.field[data-id="home.rank"] input.vis').check();
    await page.locator('.field[data-id="away.rank"] input.vis').check();
    await page.waitForTimeout(300);
    await page.locator('.field[data-id="home.rank"] input.sz').fill('40');
    await page.locator('.field[data-id="away.rank"] input.sz').fill('40');
    await page.waitForTimeout(300);
    z = await sizes();
    assert.equal(z['home.rank'], 40); assert.equal(z['away.rank'], 40);
    const before = await page.evaluate(() => document.getElementById('canvas').toDataURL());
    await page.locator('.field[data-id="away.name"] input.dy').fill('25');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.getElementById('canvas').toDataURL());
    assert.notEqual(before, after, 'the vertical offset moves the text');
    await page.screenshot({ path: path.join(out, 'ui-intro-sizes.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'intro-men-sizes.png'));
    // reset returns to the automatic size
    await page.locator('.field[data-id="home.name"] button.reset').click();
    await page.waitForTimeout(300);
    z = await sizes();
    assert.notEqual(z['home.name'], 70);
    // the size is a per-game choice: another game starts with automatic sizes again
    await page.selectOption('#customAway', 'kormend');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.field[data-id="away.name"] input.sz').inputValue(), '');
  });
  await check('layout editor: drag, snap, keyboard, inspector, global move, benchmark ("alap"), saved layouts', async () => {
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await page.click('.league-toggle button[data-league="women"]');
    await page.click('#templateList button[data-id="intro-women"]');
    await page.waitForTimeout(300);
    await page.selectOption('#matchSel', '__custom');
    await page.selectOption('#customHome', 'dvtkhuntherm');
    await page.selectOption('#customAway', 'csatattk');
    await page.waitForTimeout(400);
    await page.locator('#layoutBox summary').click();
    await page.check('#editMode');
    await page.waitForTimeout(300);
    const val = (id, k) => page.evaluate(([i, kk]) => window.__studio.current().values[i]?.[kk], [id, k]);
    assert.ok(await page.locator('.hit[data-id="home.logo"]').count() === 1, 'drag handle for the home logo');
    assert.ok(await page.locator('.hit[data-id="home.name"]').count() === 1);
    // ----- drag the home logo by (+120, +60) screen px
    const scale = await page.evaluate(() => 1920 / document.getElementById('canvas').getBoundingClientRect().width);
    const box = await page.locator('.hit[data-id="home.logo"]').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 4 }); await page.mouse.move(cx + 120, cy + 60, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const dx = await val('home.logo', 'dx'), dy = await val('home.logo', 'dy');
    assert.ok(Math.abs(dx - Math.round(120 * scale)) <= 2 && Math.abs(dy - Math.round(60 * scale)) <= 2, `moved by ${dx},${dy} (scale ${scale})`);
    assert.equal(await page.locator('.hit.sel').getAttribute('data-id'), 'home.logo');
    assert.ok(await page.locator('#overlay .ghost').count() === 1, 'ghost shows the PSD position');
    // ----- snap back to the PSD position within 6 px
    const box2 = await page.locator('.hit[data-id="home.logo"]').boundingBox();
    const sx = box2.x + box2.width / 2, sy = box2.y + box2.height / 2;
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx - dx / scale + 2, sy - dy / scale + 1, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await val('home.logo', 'dx') || 0, 0, 'snapped to the PSD x');
    assert.equal(await val('home.logo', 'dy') || 0, 0, 'snapped to the PSD y');
    // ----- keyboard nudge (needs focus outside the inputs)
    await page.locator('.hit[data-id="home.logo"]').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(200);
    assert.equal(await val('home.logo', 'dx'), 1); assert.equal(await val('home.logo', 'dy'), 10);
    // ----- inspector: exact values, scale of an image
    await page.fill('#iX', '30');
    await page.fill('#iY', '-12');
    await page.fill('#iS', '80');
    await page.waitForTimeout(300);
    assert.equal(await val('home.logo', 'dx'), 30); assert.equal(await val('home.logo', 'dy'), -12);
    assert.equal(await val('home.logo', 'scale'), 0.8);
    const b1 = await page.evaluate(() => window.__studio.report().boxes['home.logo']);
    // ----- group move: logo + name + rank of "Hazai" travel together
    await page.check('#groupMove');
    await page.waitForTimeout(100);
    // ----- global move / scale of the whole graphic
    await page.fill('#gX', '40'); await page.fill('#gS', '90');
    await page.waitForTimeout(300);
    const gl = await page.evaluate(() => window.__studio.report().global);
    assert.deepEqual([gl.dx, gl.scale], [40, 0.9]);
    await page.fill('#gX', ''); await page.fill('#gS', '');
    await page.uncheck('#groupMove');
    // ----- benchmark: save, the session changes are cleared, the benchmark keeps working
    await page.click('#benchSave');
    await page.waitForTimeout(400);
    assert.equal(await val('home.logo', 'dx'), 30);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nbia.studio.layouts.v1')));
    assert.deepEqual(stored['intro-women'].benchmark.items['home.logo'], { dx: 30, dy: -12, scale: 0.8 });
    assert.match(await page.locator('#benchState').innerText(), /mentve/);
    // a different game starts from the benchmark
    await page.selectOption('#customAway', 'sopronbasket');
    await page.waitForTimeout(400);
    assert.equal(await val('home.logo', 'dx'), 30, 'new game starts from the benchmark');
    // the benchmark survives a reload
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await page.click('.league-toggle button[data-league="women"]');
    await page.waitForTimeout(500);
    assert.equal(await val('home.logo', 'dx'), 30);
    // ----- exported PNG is still 1920 x 1080
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    await dl.saveAs(path.join(out, 'intro-women-moved.png'));
    assert.equal(pngInfo(readFileSync(path.join(out, 'intro-women-moved.png'))).width, 1920);
    await page.screenshot({ path: path.join(out, 'ui-layout-editor.png') });
    // ----- named layout: save, drop the benchmark (PSD), load it again
    await page.fill('#layName', 'Teszt elrendezés');
    await page.click('#laySave');
    await page.waitForTimeout(300);
    await page.click('#benchClear');
    await page.waitForTimeout(300);
    assert.equal(await val('home.logo', 'dx') || 0, 0, 'back at the PSD layout');
    await page.selectOption('#layList', 'Teszt elrendezés');
    await page.click('#layLoad');
    await page.waitForTimeout(300);
    assert.equal(await val('home.logo', 'dx'), 30);
    await page.click('#layDiscard');
    await page.waitForTimeout(300);
    assert.equal(await val('home.logo', 'dx') || 0, 0);
    // per-element reset
    await page.check('#editMode');
    await page.locator('.hit[data-id="home.name"]').click();
    await page.fill('#iY', '15');
    await page.waitForTimeout(200);
    assert.equal(await val('home.name', 'dy'), 15);
    await page.click('#iReset');
    await page.waitForTimeout(300);
    assert.equal(await val('home.name', 'dy') || 0, 0);
    await page.evaluate(() => { localStorage.clear(); });
  });
  await check('schedule rows: delete, add, typed row and reorder work at once; a new team starts clean', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.waitForTimeout(400);
    await page.click('#templateList button[data-id="schedule-men"]');
    await page.waitForSelector('#rowEdit');
    await page.waitForTimeout(800);
    const matches = () => page.evaluate(() => { const v = window.__studio.current().values; return [0, 1, 2, 3, 4, 5].map(i => v[`r${i}.match`]?.text || ''); });
    const before = await matches();
    assert.ok(before.every(Boolean));
    await page.click('#rowEdit li:nth-child(2) .rowdel');
    await page.waitForTimeout(500);
    let now = await matches();
    assert.equal(now.filter(Boolean).length, 5);
    assert.ok(!now.includes(before[1]));
    await page.selectOption('#rowAddSel', { index: 1 }); // adding fills the free row at once
    await page.waitForTimeout(500);
    now = await matches();
    assert.equal(now.filter(Boolean).length, 6);
    await page.click('#rowEdit li:nth-child(1) .rowdel');
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('customRowBox').open = true; });
    await page.fill('#crMatch', 'Teszt - Párosítás'); await page.fill('#crDate', '2026.12.24. - 18:00');
    await page.click('#crAdd');
    await page.waitForTimeout(500);
    now = await matches();
    assert.equal(now[now.filter(Boolean).length - 1], 'Teszt - Párosítás');
    await page.click('#rowEdit li:last-child .rowup');
    await page.waitForTimeout(400);
    assert.equal((await matches())[4], 'Teszt - Párosítás');
    // another team: back to its own automatic list, nothing of the old rows stays
    await page.evaluate(() => { const o = (window.__studio.state.overrides['schedule-men'] ||= {}); (o['r0.match'] ||= {}).text = 'MANUAL'; (o['r1.date'] ||= {}).visible = false; });
    const opts = await page.$$eval('#teamSel option', os => os.map(o => [o.value, o.textContent]));
    await page.selectOption('#teamSel', opts.find(x => x[1].includes('Alba'))[0]);
    await page.waitForTimeout(800);
    now = await matches();
    assert.ok(now.every(m => m.includes('Alba')), now.join(' | '));
    assert.ok(!now.includes('Teszt - Párosítás') && !now.includes('MANUAL'));
    assert.equal(await page.evaluate(() => Object.keys(window.__studio.state.overrides['schedule-men'] || {}).length), 0);
    assert.equal(await page.$$eval('#rowEdit li[data-key]', l => l.length), 6);
  });

  await check('player special: photo upload, player data in the last column, own text replaces a whole line', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.waitForTimeout(400);
    await page.click('#templateList button[data-id="playerspecial-women"]');
    await page.waitForFunction(() => document.getElementById('psPhoto'));
    await page.waitForTimeout(1500);
    await page.setInputFiles('#psPhoto', path.join(ROOT, 'tests/fixtures/photo-cutout.png'));
    await page.waitForFunction(() => window.__studio.report().boxes.photo, null, { timeout: 8000 });
    const v = await page.evaluate(() => { const c = window.__studio.current().values; return { name: c.title.text, last: c['r0.c2'].text, first: c['r0.c1'].text, h2: c.h2.text, pct: c['r1.c2'].runs?.length }; });
    assert.ok(v.name && v.name !== '—');
    assert.match(v.last, /^\d+\.\d$/);
    assert.equal(v.first, ''); // other periods are never invented
    assert.match(v.h2, /idei/);
    assert.equal(v.pct, 2); // made/attempted + small "(41.4%)"
    await page.evaluate(() => { const o = (window.__studio.state.overrides['playerspecial-women'] ||= {}); (o['r1.c2'] ||= {}).text = '3/7(42.9%)'; window.__studio.render(); });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__studio.current().values['r1.c2'].runs.length), 1);
  });

  await check('player special: columns, rows, photo height and layering are configurable', async () => {
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    await page.fill('#psCols', '4'); await page.dispatchEvent('#psCols', 'change'); await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    await page.fill('#psRows', '4'); await page.dispatchEvent('#psRows', 'change'); await page.waitForTimeout(500);
    let ids = await page.evaluate(() => window.__studio.render && Object.keys(window.__studio.current().values));
    assert.ok(ids.includes('r3.c4') && !ids.includes('r4.c1') && ids.includes('h4'));
    // by default all text is in front of the photo; unticking a group puts the photo in front of it
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    await page.locator('#psBox .psFront[data-k="c4"]').uncheck(); await page.waitForTimeout(500);
    const full = await page.evaluate(() => window.__studio.report().boxes.photo);
    assert.ok(full, 'photo drawn');
    assert.ok(full[3] > 900, 'photo as tall as the panel allows: ' + full[3]); // women's inner height 977
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    await page.fill('#psPhotoH', '600'); await page.dispatchEvent('#psPhotoH', 'change'); await page.waitForTimeout(500);
    assert.ok(Math.abs((await page.evaluate(() => window.__studio.report().boxes.photo))[3] - 600) < 2);
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    await page.click('#psReset'); await page.waitForTimeout(500);
    ids = await page.evaluate(() => Object.keys(window.__studio.current().values));
    assert.ok(!ids.includes('h3') && ids.includes('r5.c2'));
  });

  await check('content inside the frame: moves / scales text and photo, the frame stays', async () => {
    await page.click('.league-toggle button[data-league="women"]');
    await page.waitForTimeout(400);
    await page.click('#templateList button[data-id="playerspecial-women"]');
    await page.waitForFunction(() => document.getElementById('psPhoto'));
    await page.waitForTimeout(1500);
    await page.setInputFiles('#psPhoto', path.join(ROOT, 'tests/fixtures/photo-cutout.png'));
    await page.waitForFunction(() => window.__studio.report().boxes.photo, null, { timeout: 8000 });
    await page.evaluate(() => { document.getElementById('layoutBox').open = true; });
    await page.waitForSelector('#cX');
    const bg = () => page.evaluate(() => { const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(1275, 400, 12, 1).data; return Array.from(d).join(','); });
    const before = await bg();
    const t0 = await page.evaluate(() => window.__studio.report().boxes.title);
    await page.fill('#cX', '30'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => window.__studio.report());
    assert.equal(r.content.dx, 30);
    assert.equal(r.boxes.title[0], t0[0]); // template-space boxes are unchanged, the transform is applied on drawing
    assert.equal(await bg(), before, 'frame pixels did not move');
    await page.fill('#cS', '90'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__studio.report().content.scale), 0.9);
    await page.fill('#cX', ''); await page.fill('#cS', ''); await page.waitForTimeout(300);
  });

  // ───────────── phone: tabs, sticky preview, no sideways scrolling, touch zoom, export ─────────────
  const { devices } = require('playwright');
  const mctx = await hermetic(await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true }));
  const mp = await mctx.newPage();
  const merrors = [];
  mp.on('pageerror', e => merrors.push(e.message));
  mp.on('console', m => { if (m.type() === 'error') merrors.push(m.text()); });
  await mp.goto(`${URL}/graphics/index.html`);
  await mp.waitForSelector('body[data-ready="1"]');
  await mp.waitForTimeout(1200);
  await check('phone: bottom tab bar shows one section at a time; picking a template jumps to the data tab', async () => {
    assert.ok(await mp.isVisible('#tabbar'));
    const vis = sel => mp.isVisible(sel);
    await mp.evaluate(() => window.__studio.setTab('template'));
    assert.ok(await vis('#templateList') && !(await vis('#fields')) && !(await vis('#exportBtn')));
    await mp.tap('#templateList button[data-id="comparison-men"]');
    await mp.waitForTimeout(500);
    assert.equal(await mp.evaluate(() => document.body.dataset.tab), 'data');
    assert.ok(await vis('#selection') && !(await vis('#templateList')));
    await mp.tap('#tabbar button[data-tab="fields"]');
    assert.ok(await vis('#fields') && !(await vis('#selection')));
    await mp.tap('#tabbar button[data-tab="export"]');
    assert.ok(await vis('#exportBtn') && await vis('#baseOpacity'));
  });
  await check('phone: no sideways scrolling in any tab, for several templates', async () => {
    for (const [lg, id] of [['men', 'comparison-men'], ['men', 'teamstats-men'], ['women', 'schedule-women'], ['women', 'playerspecial-women'], ['men', 'intro-men']]) {
      await mp.evaluate(l => document.querySelector(`.league-toggle button[data-league="${l}"]`).click(), lg);
      await mp.waitForFunction(i => document.querySelector(`#templateList button[data-id="${i}"]`), id, { timeout: 15000 }); // the list is rebuilt for the league
      await mp.evaluate(i => document.querySelector(`#templateList button[data-id="${i}"]`).click(), id);
      await mp.waitForTimeout(600);
      for (const tab of ['data', 'fields', 'layout', 'export']) {
        await mp.evaluate(t => window.__studio.setTab(t), tab);
        await mp.waitForTimeout(150);
        const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(sw <= 391, `${id} / ${tab}: page is ${sw}px wide`);
      }
    }
  });
  await check('phone: the preview stays on screen while the controls scroll', async () => {
    await mp.evaluate(() => window.__studio.setTab('fields'));
    await mp.evaluate(() => window.scrollTo(0, 900));
    await mp.waitForTimeout(300);
    const r = await mp.evaluate(() => document.getElementById('stage').getBoundingClientRect().toJSON());
    assert.ok(r.top >= -1 && r.top < 4 && r.height > 150, JSON.stringify(r));
  });
  await check('phone: double tap zooms the preview, again resets; tap targets are finger sized', async () => {
    await mp.evaluate(() => window.scrollTo(0, 0));
    await mp.waitForTimeout(200);
    const box = await mp.evaluate(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await mp.touchscreen.tap(box[0], box[1]); await mp.touchscreen.tap(box[0], box[1]);
    await mp.waitForTimeout(300);
    assert.equal(await mp.evaluate(() => window.__studio.state.stageZoom), 2.5);
    await mp.touchscreen.tap(box[0], box[1]); await mp.touchscreen.tap(box[0], box[1]);
    await mp.waitForTimeout(300);
    assert.equal(await mp.evaluate(() => window.__studio.state.stageZoom), 1);
    const small = await mp.evaluate(() => [...document.querySelectorAll('#tabbar button, .league-toggle button, #exportBtn')].filter(b => { const h = b.getBoundingClientRect().height; return h > 0 && h < 40; }).length);
    assert.equal(small, 0);
  });
  await check('phone: PNG export still works (download, full size)', async () => {
    await mp.evaluate(() => window.__studio.setTab('export'));
    await mp.waitForFunction(() => !document.getElementById('exportBtn').disabled);
    mp.on('dialog', d => d.accept());
    const [dl] = await Promise.all([mp.waitForEvent('download'), mp.tap('#exportBtn')]);
    const file = path.join(out, 'phone-export.png');
    await dl.saveAs(file);
    const info = pngInfo(readFileSync(file));
    assert.equal(info.width, 1920); assert.equal(info.height, 1080);
  });
  await check('phone landscape: preview left, controls right', async () => {
    await mp.setViewportSize({ width: 844, height: 390 });
    await mp.waitForTimeout(400);
    const [st, tl] = await mp.evaluate(() => { window.__studio.setTab('export'); return [document.getElementById('stage').getBoundingClientRect().toJSON(), document.getElementById('exportBtn').getBoundingClientRect().toJSON()]; });
    assert.ok(st.right < tl.left + 20 && st.width > 300, JSON.stringify([st.right, tl.left]));
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth) <= 845);
  });
  await check('phone: the dashboard has no sideways scrolling on any tab and finger sized controls', async () => {
    await mp.setViewportSize({ width: 390, height: 844 });
    await mp.goto(`${URL}/index.html`);
    await mp.waitForTimeout(3000);
    await mp.evaluate(() => { const h = document.getElementById('home'), a = document.getElementById('away'); if (h.options.length > 2) { h.selectedIndex = 1; a.selectedIndex = 2; h.dispatchEvent(new Event('change')); a.dispatchEvent(new Event('change')); } document.getElementById('go')?.click(); });
    await mp.waitForTimeout(1200);
    for (const tab of ['league', 'teams', 'matchup', 'notes', 'news', 'fb', 'sources']) {
      await mp.evaluate(t => document.querySelector(`nav button[data-tab="${t}"]`).click(), tab);
      await mp.waitForTimeout(500);
      const r = await mp.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        small: [...document.querySelectorAll('.control select, .control button, .fb-toolbar input, .league-team-picker select')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height < 40; }).length,
      }));
      assert.ok(r.sw <= 391, `${tab}: dashboard is ${r.sw}px wide`);
      assert.equal(r.small, 0, `${tab}: small controls`);
    }
  });
  await check('view switch (studio): auto → mobile → desktop → auto, remembered, works on a wide screen', async () => {
    const vp = await hermetic(await browser.newContext({ viewport: { width: 1400, height: 900 } }));
    const vpage = await vp.newPage();
    await vpage.goto(`${URL}/graphics/index.html`);
    await vpage.waitForSelector('body[data-ready="1"]');
    assert.ok(!(await vpage.isVisible('#tabbar')), 'wide screen: desktop layout');
    await vpage.click('#viewSwitch'); // → mobile
    await vpage.waitForTimeout(300);
    assert.equal(await vpage.evaluate(() => window.__studio.viewMode()), 'mobile');
    assert.ok(await vpage.isVisible('#tabbar'), 'forced mobile layout on a wide screen');
    await vpage.reload();
    await vpage.waitForSelector('body[data-ready="1"]');
    assert.ok(await vpage.isVisible('#tabbar'), 'remembered after reload');
    await vpage.click('#viewSwitch'); // → desktop
    await vpage.waitForTimeout(300);
    assert.ok(!(await vpage.isVisible('#tabbar')));
    assert.equal(await vpage.evaluate(() => document.querySelector('meta[name=viewport]').content), 'width=1280');
    await vpage.click('#viewSwitch'); // → auto
    assert.equal(await vpage.evaluate(() => window.__studio.viewMode()), 'auto');
    await vp.close();
  });
  await check('view switch (phone): forced desktop view lays the page out wide, dashboard too', async () => {
    const pc = await hermetic(await browser.newContext({ ...devices['iPhone 13'] }));
    await pc.addInitScript(() => { try { localStorage.setItem('nbia.view', 'desktop'); localStorage.setItem('nbia.dash.view', 'desktop'); } catch { /* ignore */ } });
    const pp = await pc.newPage();
    await pp.goto(`${URL}/graphics/index.html`);
    await pp.waitForSelector('body[data-ready="1"]');
    assert.ok(!(await pp.isVisible('#tabbar')), 'no mobile tab bar when desktop is forced');
    assert.ok(await pp.evaluate(() => window.innerWidth) >= 1200, 'page laid out at desktop width');
    await pp.goto(`${URL}/index.html`);
    await pp.waitForTimeout(1500);
    assert.ok(await pp.evaluate(() => window.innerWidth) >= 1200, 'dashboard laid out at desktop width');
    assert.equal(await pp.textContent('#dashView'), 'Nézet: asztali');
    await pp.click('#dashView'); // back to auto
    assert.equal(await pp.evaluate(() => document.querySelector('meta[name=viewport]').content), 'width=device-width,initial-scale=1');
    await pc.close();
  });
  await check('phone: no console errors', async () => assert.deepEqual(merrors, []));
  await mctx.close();

  await check('package: one click makes a ZIP with every graphic of the match (1920x1080 PNGs) and an _OLVASSEL.txt', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('pkgBox').open = true; });
    const before = await page.evaluate(() => JSON.stringify(window.__studio.state.template));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#pkgBtn')]);
    const file = path.join(out, 'package.zip');
    await dl.saveAs(file);
    assert.match(dl.suggestedFilename(), /^Ferfi_Csomag_.*\.zip$/);
    const { unzipSync, strFromU8 } = await import('../graphics/vendor/fflate.js');
    const z = unzipSync(new Uint8Array(readFileSync(file)));
    const pngs = Object.keys(z).filter(n => n.endsWith('.png'));
    assert.ok(pngs.length >= 9, pngs.length + ' images');
    assert.ok(pngs.some(n => /Keret_fotokkal/.test(n)), 'the photo roster is in the package');
    for (const off of ['Intro', 'Csillagjatekosok', 'Jatekos_kulonleges']) assert.ok(!pngs.some(n => n.includes(off)), `${off} is unticked by default`);
    for (const n of pngs) { const info = pngInfo(Buffer.from(z[n])); assert.equal(info.width, 1920); assert.equal(info.height, 1080); }
    const readme = strFromU8(z['_OLVASSEL.txt']);
    assert.match(readme, /Adatok frissessége/); assert.match(readme, /GRAFIKAI CSOMAG/);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__studio.state.template)), before, 'what is on screen is untouched');
  });

  await check('dashboard: schedule starts with the newest result, last 2 rounds of results and at most 3 upcoming rounds', async () => {
    const dp = await ctx.newPage();
    await dp.goto(`${URL}/index.html`);
    await dp.waitForTimeout(2500);
    for (const lg of ['men', 'women']) {
      await dp.selectOption('#league', lg);
      await dp.waitForTimeout(800);
      const data = JSON.parse(readFileSync(path.join(ROOT, DATA_DIR, `${lg}.json`), 'utf8')).matches;
      const key = m => { const [y, mo, d] = m.date.match(/\d+/g); return `${y}${mo.padStart(2, '0')}${d.padStart(2, '0')} ${m.time || ''}`; };
      const fin = data.filter(m => m.status === 'finished').sort((a, b) => key(b).localeCompare(key(a)));
      const rows = await dp.$$eval('#fixtures tbody tr:not(.fixture-section)', trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
      const sections = await dp.$$eval('#fixtures tr.fixture-section', t => t.length);
      assert.ok(rows.length && sections >= 1, lg + ': rows');
      assert.equal(rows[0][2].replace(/\s+/g, ' ').trim().length > 0, true);
      assert.equal(rows[0][1].replace(/\s+/g, ' '), `${fin[0].date} ${fin[0].time}`.replace(/\s+/g, ' '), `${lg}: first row = newest result`);
      const finRows = rows.filter(r => /\d+\s*[–-]\s*\d+/.test(r[3]));
      const rounds = new Set(finRows.map(r => r[0]));
      assert.ok(rounds.size <= 3, `${lg}: result rounds ${[...rounds]}`); // 2 rounds + the newest (possibly postponed) game
      const minResult = Math.min(...finRows.map(r => parseInt(r[0], 10)));
      const upRounds = new Set(rows.filter(r => !/\d+\s*[–-]\s*\d+/.test(r[3]) && parseInt(r[0], 10) >= minResult).map(r => r[0]));
      assert.ok(upRounds.size <= 3, `${lg}: upcoming rounds ${[...upRounds]}`); // postponed older-round games are extra
    }
    await dp.close();
  });

  await check('dashboard: Csapatok tab has Keret, full statistics (average / total / 40 min, sortable), records, zones and games', async () => {
    const dp = await ctx.newPage();
    const derrs = [];
    dp.on('pageerror', e => derrs.push(e.message));
    await dp.goto(`${URL}/index.html`);
    await dp.waitForTimeout(2500);
    await dp.evaluate(() => document.querySelector('nav button[data-tab="teams"]').click());
    assert.equal(await dp.$$eval('#teamCards .club-panel .open-team', b => b.length), 14);
    await dp.selectOption('#teamPick', { index: 2 });
    await dp.waitForTimeout(400);
    await dp.click('#teamDetail [data-sub="roster"]');
    assert.ok((await dp.$$eval('#teamDetail tbody tr', r => r.length)) >= 8, 'roster');
    await dp.click('#teamDetail [data-sub="stats"]');
    assert.equal(await dp.$$eval('#teamDetail thead th', t => t.length), 33, 'all Hunbasket columns');
    await dp.click('#teamDetail th[data-col="4"]');
    const pts = await dp.$$eval('#teamDetail tbody tr td:nth-child(5)', t => t.slice(0, 4).map(x => parseFloat(x.textContent)));
    assert.deepEqual(pts, [...pts].sort((a, b) => b - a), 'sorted by points, best first');
    for (const kind of ['total', 'per40']) { await dp.click(`#teamDetail [data-kind="${kind}"]`); assert.ok((await dp.$$eval('#teamDetail tbody tr', r => r.length)) >= 8, kind); }
    await dp.click('#teamDetail [data-sub="records"]');
    assert.ok((await dp.$$eval('#teamDetail tbody tr', r => r.length)) >= 20, 'records + zones');
    await dp.click('#teamDetail [data-sub="games"]');
    assert.ok((await dp.$$eval('#teamDetail tbody tr', r => r.length)) >= 10, 'games');
    await dp.selectOption('#teamPick', '');
    assert.ok(await dp.isVisible('#teamCards'));
    assert.deepEqual(derrs, []);
    await dp.close();
  });

  await check('dashboard: Meccslap (one-page match sheet) with story suggestions prints on a single A4 page', async () => {
    const dp = await ctx.newPage();
    const derrs = [];
    dp.on('pageerror', e => derrs.push(e.message));
    await dp.goto(`${URL}/index.html`);
    await dp.waitForTimeout(2500);
    await dp.selectOption('#league', 'men');
    await dp.waitForTimeout(400);
    await dp.selectOption('#home', { index: 3 });
    await dp.waitForTimeout(300);
    await dp.selectOption('#away', { index: 5 });
    await dp.waitForTimeout(300);
    await dp.click('#go');
    await dp.waitForTimeout(1000);
    const txt = await dp.$eval('#matchSheetCard .sheet-body', e => e.innerText);
    assert.match(txt, /MECCSLAP/); assert.match(txt, /Összevetés/i); assert.match(txt, /Kulcsjátékosok/i); assert.match(txt, /Sztori-javaslatok/i);
    assert.ok(!/\.\./.test(txt.replace(/\.\.\./g, '')), 'no double full stops');
    await dp.click('#sheetPrint');
    await dp.evaluate(() => document.body.classList.add('sheet-printing')); // headless print() ends at once and removes the class again
    const pdf = await dp.pdf({ format: 'A4', printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, 1, 'one page');
    assert.deepEqual(derrs, []);
    await dp.close();
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
  await check('extra (MKOSZ): photo + QR upload, proportional and free resize of the frames', async () => {
    await page.setViewportSize({ width: 1600, height: 1500 }); // preview and handles fully on screen on any runner
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="extra-men"]');
    await page.waitForTimeout(500);
    await page.setInputFiles('.xbox[data-k="A"] .xFile', path.join(ROOT, 'tests/fixtures/img/extra-photo.jpg'));
    await page.setInputFiles('.xbox[data-k="B"] .xFile', path.join(ROOT, 'tests/fixtures/img/extra-qr.png'));
    await page.waitForTimeout(600);
    const size = async k => [+(await page.$eval(`.xbox[data-k="${k}"] .xW`, e => e.value)), +(await page.$eval(`.xbox[data-k="${k}"] .xH`, e => e.value))];
    const [w0, h0] = await size('B');
    assert.deepEqual([w0, h0], [316, 320]); // the PSD's QR frame
    await page.waitForSelector('.hit[data-id="frameB"]', { timeout: 15000 });
    const hit = await page.$('.hit[data-id="frameB"]'); const bb = await hit.boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForSelector('.hit[data-id="frameB"] .rh[data-c="se"]', { timeout: 10000 });
    const drag = async (dx, dy) => {
      const hb = await (await page.$('.hit[data-id="frameB"] .rh[data-c="se"]')).boundingBox();
      await page.mouse.move(hb.x + 8, hb.y + 8); await page.mouse.down(); await page.mouse.move(hb.x + 8 + dx, hb.y + 8 + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400);
    };
    await drag(60, 10); // lock on: grows by the same ratio
    const [w1, h1] = await size('B');
    assert.ok(w1 > w0 && Math.abs(w1 / h1 - w0 / h0) < 0.02, `proportional ${w1}x${h1}`);
    await page.uncheck('#xLock');
    await drag(60, 0); // lock off: only the width changes
    const [w2, h2] = await size('B');
    assert.ok(w2 > w1 && h2 === h1, `free ${w2}x${h2}`);
    const png = await page.$eval('#canvas', c => c.toDataURL('image/png'));
    assert.ok(png.length > 1000);
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  await check('player special: tick columns and move them together as a unit (and put them back)', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="playerspecial-men"]');
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.getElementById('psBox').open = true; });
    const shot = () => page.$eval('#canvas', c => c.toDataURL('image/png'));
    const base = await shot();
    await page.check('.psUnit[data-g="3. oszlop"]');
    await page.fill('#psStep', '30'); await page.dispatchEvent('#psStep', 'change');
    await page.click('.psnudge [data-d="1,0"]');
    await page.waitForTimeout(400);
    const moved = await shot();
    assert.notEqual(moved, base, 'the ticked column moved');
    await page.click('#psUnitReset');
    await page.waitForTimeout(400);
    assert.equal(await shot(), base, 'back at the PSD position');
    await page.uncheck('.psUnit[data-g="3. oszlop"]');
    await page.click('.psnudge [data-d="1,0"]'); // nothing ticked: nothing moves
    await page.waitForTimeout(300);
    assert.equal(await shot(), base);
  });

  await check('background removal (AI, in the browser): the photo gets a transparent background, the slider and undo work', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="playerspecial-men"]');
    await page.waitForTimeout(600);
    await page.setInputFiles('#psPhoto', path.join(ROOT, 'tests/fixtures/img/bg-test.png'));
    await page.waitForTimeout(500);
    await page.click('.bgrow[data-k="photo"] .bgGo');
    await page.waitForFunction(() => document.querySelector('.bgrow[data-k="photo"] .bgMsg')?.textContent.startsWith('Kész'), null, { timeout: 120000 });
    assert.equal(await page.$eval('.bgrow[data-k="photo"] .bgCut', e => e.disabled), false);
    const shot = () => page.$eval('#canvas', c => c.toDataURL('image/png'));
    const a = await shot();
    await page.$eval('.bgrow[data-k="photo"] .bgCut', e => { e.value = 95; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(500);
    assert.notEqual(await shot(), a, 'the slider changes the cut-out');
    await page.click('.bgrow[data-k="photo"] .bgUndo');
    await page.waitForTimeout(500);
    assert.equal(await page.$eval('.bgrow[data-k="photo"] .bgCut', e => e.disabled), true);
  });

  await check('all panels (frames) are resizable shapes: form, head to head and the PSD graphics (edit mode, corner handle)', async () => {
    await page.setViewportSize({ width: 1600, height: 1500 }); // the preview and all four corner handles are on screen on any runner
    for (const id of ['form-men', 'h2h-men', 'roster-men', 'results-women', 'playerspecial-men', 'comparison-men', 'intro-women']) {
      await page.click(`.league-toggle button[data-league="${id.endsWith('women') ? 'women' : 'men'}"]`);
      await page.click(`#templateList button[data-id="${id}"]`);
      await page.waitForTimeout(1800);
      await page.evaluate(() => { document.getElementById('layoutBox').open = true; });
      if (!(await page.$eval('#editMode', e => e.checked))) await page.check('#editMode');
      const shot = () => page.$eval('#canvas', c => c.toDataURL('image/png'));
      const before = await shot();
      const hit = await page.$('.hit[data-id="panel"]'); await hit.scrollIntoViewIfNeeded(); const bb = await hit.boundingBox();
      assert.ok(await selectPanel(page), `${id}: panel selectable`);
      await page.waitForTimeout(300);
      const hb = await (await page.$('.hit[data-id="panel"] .rh[data-c="se"]')).boundingBox();
      await page.mouse.move(hb.x + 8, hb.y + 8); await page.mouse.down(); await page.mouse.move(hb.x + 8 + 90, hb.y + 8 + 40, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(500);
      const after = await page.$eval('.hit[data-id="panel"]', e => e.getBoundingClientRect().width);
      assert.ok(after > bb.width + 40, `${id}: panel grew (${bb.width} -> ${after})`);
      assert.notEqual(await shot(), before);
      await page.uncheck('#editMode');
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  await check('frame = court + outline as one unit: moving the panel carries the court with it (pixel-identical)', async () => {
    await page.setViewportSize({ width: 1600, height: 1500 });
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="roster-men"]');
    await page.waitForTimeout(1800);
    await page.evaluate(() => { document.getElementById('layoutBox').open = true; });
    if (!(await page.$eval('#editMode', e => e.checked))) await page.check('#editMode');
    const hit = await page.$('.hit[data-id="panel"]'); await hit.scrollIntoViewIfNeeded(); const bb = await hit.boundingBox();
    assert.ok(await selectPanel(page), 'panel selectable');
    // a strip of the panel above the table header: only court + border, no dynamic element
    const strip = x => page.evaluate(x0 => Array.from(document.getElementById('canvas').getContext('2d').getImageData(x0, 62, 600, 18).data), x);
    const before = await strip(800);
    await page.focus('body');
    for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight'); // 10 x 10 px
    await page.waitForTimeout(600);
    const after = await strip(900);
    let diff = 0;
    for (let i = 0; i < before.length; i++) diff += Math.abs(before[i] - after[i]);
    assert.ok(diff / before.length < 1, `the court moved with the frame (mean diff ${diff / before.length})`);
    await page.uncheck('#editMode');
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  await check('dashboard: logo line shows every club of the league as a crest tile (men 14, women 11), league label, clean logos, click opens the player report', async () => {
    const dp = await (await hermetic(await browser.newContext({ viewport: { width: 1440, height: 900 } }))).newPage();
    await dp.goto(`${URL}/index.html`);
    await dp.waitForSelector('.club-ribbon .ribbon-team');
    for (const [lg, n, label] of [['men', 14, 'Férfi NB I/A'], ['women', 11, 'Női NB I/A']]) {
      if (lg === 'women') await dp.selectOption('#league', 'women');
      await dp.waitForFunction(c => document.querySelectorAll('.club-ribbon .ribbon-team').length === c && document.querySelector('.club-ribbon').dataset.league, n, { timeout: 15000 });
      assert.equal((await dp.$eval('.ribbon-label b', e => e.textContent)), label);
      assert.equal(await dp.$eval('.club-ribbon', e => e.dataset.league), lg);
      await dp.waitForFunction(() => [...document.querySelectorAll('.ribbon-team img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
      const srcs = await dp.$$eval('.ribbon-team img', is => is.map(i => i.getAttribute('src')));
      assert.ok(srcs.every(x => x.startsWith(`graphics/logos/${lg}/`)), 'transparent studio logos');
      const sizes = await dp.$$eval('.ribbon-team', ts => ts.map(t => t.offsetWidth));
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'all tiles equal');
    }
    await dp.click('.ribbon-team >> nth=0');
    await dp.waitForSelector('.player-modal, #playerReport, .player-report', { timeout: 10000 });
    await dp.context().close();
  });

  await check('dashboard Csapatok: open button sits in the card header row, way back, printable team sheet, clean crests', async () => {
    const dp = await (await hermetic(await browser.newContext({ viewport: { width: 1440, height: 900 } }))).newPage();
    await dp.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await dp.goto(`${URL}/index.html`);
    await dp.click('nav [data-tab="teams"]');
    await dp.waitForSelector('#teamCards .club-panel .club-panel-head .open-team');
    const same = await dp.$eval('#teamCards .club-panel', c => { const h = c.querySelector('h3').getBoundingClientRect(), b = c.querySelector('.open-team').getBoundingClientRect(); return Math.abs((h.top + h.bottom) / 2 - (b.top + b.bottom) / 2) < 30 && b.left > h.right; });
    assert.ok(same, 'button on the same line as the team name, to its right');
    await dp.waitForFunction(() => [...document.querySelectorAll('#teamCards .club-mark img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    assert.ok((await dp.$$eval('#teamCards .club-mark img', is => is.every(i => i.getAttribute('src').startsWith('graphics/logos/')))), 'transparent studio logos');
    await dp.click('.open-team >> nth=0');
    await dp.waitForSelector('.team-back');
    await dp.click('.team-print');
    assert.equal(await dp.evaluate(() => window.__printed), 1);
    const secs = await dp.$$eval('#teamPrint h3', h => h.map(x => x.textContent));
    for (const k of ['Keret', 'Rekordok és zónák', 'Mérkőzések']) assert.ok(secs.includes(k), k);
    assert.ok(secs.filter(x => x.startsWith('Statisztika')).length >= 1);
    await dp.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await dp.evaluate(() => document.body.classList.contains('team-printing') || !!document.getElementById('teamPageStyle')), false, 'print mode cleaned up');
    await dp.click('.team-back');
    await dp.waitForFunction(() => document.getElementById('teamDetail').innerHTML === '' && getComputedStyle(document.getElementById('teamCards')).display !== 'none');
    await dp.context().close();
  });

  await check('key players: the dropdown shows the chosen player, ranks stay for a low-game player, own photo upload works with background removal controls', async () => {
    await page.click('.league-toggle button[data-league="men"]');
    await page.click('#templateList button[data-id="playercompare-men"]');
    await page.waitForSelector('#pc_home');
    const n = await page.$$eval('#pc_home option', o => o.length);
    await page.selectOption('#pc_home', { index: n - 2 });
    await page.waitForTimeout(800);
    const shown = await page.$eval('#pc_home', e => e.selectedIndex);
    assert.equal(shown, n - 2, 'the dropdown keeps the player the graphic uses');
    await page.setInputFiles('.pcUp[data-side="home"]', path.join(ROOT, 'tests/fixtures/img/extra-photo.jpg'));
    await page.waitForSelector('.bgrow[data-k="pcHome"] .bgGo:not([disabled])', { timeout: 15000 });
    const src = await page.evaluate(() => [...document.querySelectorAll('#fields .field')].find(f => f.querySelector('.lbl span')?.textContent.startsWith('Hazai logó'))?.querySelector('.lbl em')?.title);
    assert.equal(src, 'Feltöltött fotó');
    await page.click('.pcUpClear[data-side="home"]');
  });

  await check('desktop studio: the sidebar width can be dragged, is remembered and resets on double click; nothing overflows sideways', async () => {
    const sp = await (await hermetic(await browser.newContext({ viewport: { width: 1600, height: 900 } }))).newPage();
    await sp.goto(`${URL}/graphics/index.html`);
    await sp.waitForSelector('body[data-ready="1"]');
    const w = () => sp.$eval('.controls', e => Math.round(e.getBoundingClientRect().width));
    const w0 = await w();
    const bb = await (await sp.$('#splitter')).boundingBox();
    await sp.mouse.move(bb.x + 5, bb.y + 150); await sp.mouse.down(); await sp.mouse.move(bb.x + 5 + 200, bb.y + 150, { steps: 5 }); await sp.mouse.up();
    const w1 = await w();
    assert.ok(w1 > w0 + 150, `wider ${w0} -> ${w1}`);
    await sp.reload(); await sp.waitForSelector('body[data-ready="1"]');
    assert.equal(await w(), w1, 'remembered');
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal page scroll');
    await sp.dblclick('#splitter');
    assert.equal(await w(), w0, 'reset');
    await sp.context().close();
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
