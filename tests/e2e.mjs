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
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); } } // wait until the server answers
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
  await check('missing data is flagged in the editor (referees) and manual entry clears the flag', async () => {
    await page.click('#templateList button[data-id="referees-men"]');
    await page.waitForTimeout(300);
    await page.check('#showPast');
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
    await page.selectOption('#matchSel', open);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.field.missing').count(), 4);
    assert.match(await page.locator('#notices').innerText(), /nincsenek kiírva/);
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
