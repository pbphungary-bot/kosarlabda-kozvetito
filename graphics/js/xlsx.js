// Minimal, dependency-light reader for .xlsx (via fflate) and .csv files.
// Returns { sheets: [{ name, rows: [[cell,...],...] }], modified: ISO|null }.
// Cells are strings or numbers; empty cells are null. Formulas use their cached value.
import { unzipSync, strFromU8 } from '../vendor/fflate.js';

const decodeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? decodeXml(m[1]) : null; };

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(xml) {
  // concatenate all <t> nodes (rich text runs), skipping phonetic runs
  const noPh = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of noPh.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
}

export function readXlsx(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const get = p => (files[p] ? strFromU8(files[p]) : null);
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new Error('Ez nem Excel (.xlsx) fájl.');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const relTarget = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relTarget[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const strings = sharedStrings(get('xl/sharedStrings.xml'));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    if (/\bstate="(hidden|veryHidden)"/.test(m[0])) continue;
    const rid = attr(m[0], 'r:id');
    let target = relTarget[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
    const xml = get(target);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = (attr(rm[0], 'r') ? parseInt(attr(rm[0], 'r'), 10) : rows.length + 1) - 1;
      const row = rows[rIdx] || (rows[rIdx] = []);
      for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cm[1];
        const ref = attr(tag, 'r');
        if (!ref) continue;
        const t = attr(tag, 't');
        const inner = cm[2] || '';
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (t === 's' && v !== undefined) val = strings[+v] ?? null;
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'e') val = v !== undefined ? decodeXml(v) : null;
        else if (t === 'b') val = v === '1' ? 1 : 0;
        else if (v !== undefined && v !== '') val = Number(v);
        if (val === '' || (typeof val === 'number' && Number.isNaN(val))) val = null;
        row[colIndex(ref)] = val;
      }
    }
    // fill sparse rows
    const clean = [];
    for (let i = 0; i < rows.length; i++) clean.push(Array.from(rows[i] || [], c => (c === undefined ? null : c)));
    sheets.push({ name, rows: clean });
  }
  let modified = null;
  const core = get('docProps/core.xml');
  const mm = core && core.match(/<dcterms:modified[^>]*>([^<]+)</);
  if (mm) modified = mm[1];
  return { sheets, modified };
}

/** Parses CSV text (comma or semicolon, quotes supported) into one sheet. */
export function readCsv(text, name = 'CSV') {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { sheets: [{ name, rows: rows.map(r => r.map(c => (c === '' ? null : c))) }], modified: null };
}

export async function readFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const parsed = isZip ? readXlsx(buf) : readCsv(new TextDecoder('utf-8').decode(buf), file.name.replace(/\.[^.]+$/, ''));
  if (!parsed.modified && file.lastModified) parsed.modified = new Date(file.lastModified).toISOString();
  return parsed;
}
