import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, readJson, DATA_DIR } from './helpers.mjs';
import { capRuns, wordRuns, wrapParagraphs, fitParagraphs, SMALL_CAPS } from '../graphics/js/paragraph.js';
import { templateById, TEMPLATES, TEMPLATE_TYPES, COACH_PANEL, COACH_LOOKS, coachLook } from '../graphics/js/templates.js';
import { bindCoach, coachOpponent } from '../graphics/js/binders.js';

const W = (t, sz) => t.length * sz * 0.4; // a fake, deterministic text width

test('paragraph: small caps = lower-case letters as smaller capitals, capitals and other characters stay', () => {
  assert.deepEqual(capRuns('Dúl,', 0.8), [{ text: 'D', f: 1 }, { text: 'ÚL', f: 0.8 }, { text: ',', f: 1 }]);
  assert.deepEqual(capRuns('BEAC'), [{ text: 'BEAC', f: 1 }]);
  assert.deepEqual(capRuns('őrült'), [{ text: 'ŐRÜLT', f: 0.8 }], 'Hungarian letters');
  assert.equal(SMALL_CAPS, 0.8);
  assert.deepEqual(wordRuns('Ab', 'caps'), [{ text: 'AB', f: 1 }], 'plain capitals: one size');
  assert.deepEqual(wordRuns('Ab', 'plain'), [{ text: 'Ab', f: 1 }]);
});

test('paragraph: paragraphs are wrapped on their own (never merged), empty lines stay, nothing is lost', () => {
  const text = 'egy ketto harom negy ot hat\nmásodik bekezdés\n\nutolsó';
  const lines = wrapParagraphs(text, 'plain', 10, 100, W);
  const asText = lines.map(l => l.runs.map(r => r.text).join(''));
  assert.ok(asText.length > 4, 'the long first paragraph wrapped');
  assert.ok(asText.includes('') , 'the empty line stays');
  assert.equal(asText.at(-1), 'utolsó');
  assert.ok(asText.some(l => l.startsWith('második')), 'the second paragraph starts on its own line');
  assert.equal(asText.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim(), 'every word is there once');
  for (const l of lines) assert.ok(l.w <= 100 + 1e-9 || l.runs.length === 1, 'no line wider than the box (except one long word)');
});

test('paragraph: the size shrinks until the text fits the height, never below the minimum; a locked size is only reported', () => {
  const long = Array.from({ length: 120 }, (_, i) => 'szó' + i).join(' ');
  const fit = fitParagraphs(long, 'plain', 40, 400, 300, 50, W);
  assert.ok(fit.s < 1 && fit.s >= 0.45, `shrunk (${fit.s})`);
  assert.ok(fit.lines.length * 50 * fit.s <= 300 + 0.5 || fit.overflow);
  const short = fitParagraphs('rövid szöveg', 'plain', 40, 400, 300, 50, W);
  assert.equal(short.s, 1); assert.equal(short.overflow, false);
  const huge = fitParagraphs(long.repeat(20), 'plain', 40, 400, 100, 50, W);
  assert.equal(huge.s, 0.45); assert.equal(huge.overflow, true, 'does not fit even at the smallest size: reported');
  const locked = fitParagraphs(long, 'plain', 40, 400, 300, 50, W, { locked: true });
  assert.equal(locked.s, 1); assert.equal(locked.overflow, true);
});

test('coach graphic: both leagues, the geometry of the owner\'s PSD, men / women outline colours', () => {
  assert.equal(TEMPLATE_TYPES.coach, 'Vezetőedző nyilatkozata');
  assert.deepEqual(COACH_PANEL, { x0: 45, y0: 14, x1: 1455, y1: 944 });
  for (const [id, stroke] of [['coach-men', '#0b9444'], ['coach-women', '#ef4036']]) {
    const t = templateById(id), el = i => t.elements.find(e => e.id === i);
    assert.equal(t.type, 'coach'); assert.equal(t.league, id.endsWith('women') ? 'women' : 'men');
    assert.deepEqual(el('panel').box, [750, 479, 1410, 930]); assert.equal(el('panel').stroke, stroke);
    assert.deepEqual(el('photo').box, [328, 488.5, 570, 895]); assert.equal(el('photo').fixedSrc, true); assert.equal(el('photo').anchor, 'bottom');
    const q = el('quote');
    assert.deepEqual([q.x, q.y, q.size, q.lineHeight, q.maxWidth, q.tracking], [475.5, 60.4, 45.83, 58.3, 963, 10]);
    assert.equal(q.paragraph, true); assert.ok(Math.abs(q.hscale - 1.7856 / 2.142) < 0.001, 'the PSD stretch: width squeezed to 0.834');
    assert.deepEqual([el('name').x, el('name').y, el('name').size, el('name').color, el('name').caps], [475.5, 873.25, 108.33, '#010101', true]);
    assert.deepEqual([el('subtitle').x, el('subtitle').y, el('subtitle').size], [476.5, 927, 45.83]);
    assert.deepEqual(el('logo').box, [1348.5, 838, 124, 124]);
    assert.deepEqual(el('strip').box, [750.5, 1024, 467, 80]);
    // text lies inside the panel
    for (const e of ['quote', 'name', 'subtitle']) assert.ok(el(e).x >= 45 && el(e).x + el(e).maxWidth <= 1455, `${e} inside the panel`);
  }
  assert.equal(coachLook('nope'), 'smallcaps'); assert.ok(COACH_LOOKS.smallcaps && COACH_LOOKS.caps, 'both looks are offered');
  assert.equal(TEMPLATES.filter(t => t.type === 'coach').length, 2);
});

test('coach binder: name + logo from the data, subtitle suggestion, quote only what was typed, photo flag', async () => {
  const store = await loadStore();
  const v = bindCoach(store, 'women', 'sercounigyor', { quote: '  Első.\nMásodik.  ', look: 'caps' }, true);
  assert.ok(v.name.text && !v.name.missing, 'head coach from the Hunbasket team page');
  assert.equal(v.logo.src, 'women/sercounigyor');
  assert.equal(v.quote.text, 'Első.\nMásodik.'); assert.equal(v.quote.caseMode, 'caps');
  assert.equal(v.photo.src, 'upload/coachPhoto'); assert.equal(v.strip.src, 'strip/coach');
  const opp = coachOpponent(store, 'women', 'sercounigyor');
  assert.ok(opp && v.subtitle.text.endsWith('elleni mérkőzés előtt'), `suggestion from the next game: ${v.subtitle.text}`);
  assert.match(v.subtitle.source, /Javaslat/);
  // typed subtitle wins; no opponent = no invented subtitle
  assert.equal(bindCoach(store, 'women', 'sercounigyor', { subtitle: 'Saját alcím' }).subtitle.text, 'Saját alcím');
  assert.equal(bindCoach(store, 'women', 'sercounigyor', { oppId: null }).subtitle.text, '');
  // nothing typed: nothing drawn, default look = the PSD's small caps, no photo
  const empty = bindCoach(store, 'women', 'sercounigyor', {});
  assert.equal(empty.quote.text, ''); assert.equal(empty.quote.caseMode, 'smallcaps'); assert.equal(empty.photo.src, '');
  // men: the name order of the data (foreign coaches \"Given Surname\") is kept
  const men = bindCoach(store, 'men', Object.keys(store.league('men').teamPages)[0] && 'falcokc', {});
  assert.ok(men.name.text && /\s/.test(men.name.text));
  // a club without a team page: flagged, not invented
  assert.equal(bindCoach(store, 'women', 'no-such-club', {}).name.missing, true);
});

test('coach: pre-match statements of the collected BB1 previews, per club, newest first (also for a short club name)', async () => {
  const store = await loadStore();
  assert.deepEqual(store.previewStatements('men', 'kecskemet'), [], 'not loaded yet: nothing');
  await store.loadLazy('men', 'previews', f => readJson(DATA_DIR + '/' + f));
  const kec = store.previewStatements('men', 'kecskemet');
  assert.ok(kec.length >= 1 && kec[0].speaker === 'Sztojan Ivkovics' && kec[0].text.length > 100, 'the Kecskemét coach\'s statement');
  assert.match(kec[0].url, /^https:\/\/bball1\.hu\//); assert.ok(kec[0].title.includes('Kecskemét'));
  // "Falco-Vulcano Energia KC" (BB1's short form) is not a known club name: the leftover statement of the two-team article is still found
  const falco = store.previewStatements('men', 'falcokc');
  assert.ok(falco.length >= 2 && falco.every(x => x.speaker === 'Milos Konakov'), 'both Falco previews, short names included');
  assert.ok(falco.every((x, i) => i === 0 || falco[i - 1].published_at >= x.published_at), 'newest first');
  assert.deepEqual(store.previewStatements('women', 'sercounigyor'), [], 'women: none collected (BB1 covers the men)');
  assert.deepEqual(store.previewStatements('men', 'nobody'), []);
});

test('coach binder: a chosen statement sets the quote and the speaker\'s name, with the source of both', async () => {
  const store = await loadStore();
  const v = bindCoach(store, 'men', 'kecskemet', { quote: 'Egy nyilatkozat.', name: 'Sztojan Ivkovics', srcTitle: 'A \u2013 B', srcUrl: 'https://bball1.hu/x/' }, false);
  assert.equal(v.name.text, 'Sztojan Ivkovics'); assert.match(v.name.source, /BB1\.hu előzetes/);
  assert.match(v.quote.source, /BB1\.hu előzetes: A \u2013 B – https:\/\/bball1\.hu\/x\//);
  const own = bindCoach(store, 'men', 'kecskemet', { quote: 'Saját szöveg.' }, false);
  assert.match(own.quote.source, /Beillesztett/); assert.ok(own.name.text, 'back to the Hunbasket head coach');
});
