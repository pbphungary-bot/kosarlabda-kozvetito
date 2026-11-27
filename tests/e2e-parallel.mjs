// Runs the browser tests (tests/e2e.mjs) in several processes at once: node tests/e2e-parallel.mjs [workers] [outDir]
// The checks are cut into contiguous blocks (they run in file order inside a block, because later checks may rely on the state an earlier one left behind),
// each block is one e2e.mjs process with its own server port and browser. Exit code 1 if any check fails.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const workers = Math.max(1, +process.argv[2] || 4);
const out = process.argv[3] || path.join(ROOT, 'tests/output/e2e');
mkdirSync(out, { recursive: true });
const script = path.join(ROOT, 'tests/e2e.mjs');
const names = JSON.parse(execFileSync('node', [script, path.join(out, 'list'), '--list'], { encoding: 'utf8' }).trim().split('\n').pop());
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blocks = [];
const per = Math.ceil(names.length / workers);
for (let i = 0; i < names.length; i += per) blocks.push(names.slice(i, i + per));

const run = (block, i) => new Promise(resolve => {
  const dir = path.join(out, `part${i + 1}`);
  const p = spawn('node', [script, dir, '--only', `^(${block.map(esc).join('|')})$`], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  p.stdout.on('data', d => { buf += d; });
  p.on('close', code => resolve({ code, buf }));
});
const t0 = Date.now();
const done = await Promise.all(blocks.map(run));
const lines = done.flatMap(d => d.buf.split('\n')).filter(l => /^(ok|FAIL) \| /.test(l));
for (const l of lines) console.log(l);
const failed = lines.filter(l => l.startsWith('FAIL')).length;
const missing = names.length - lines.length;
console.log(`${lines.length - failed}/${names.length} passed in ${Math.round((Date.now() - t0) / 1000)} s (${blocks.length} processes)${missing ? `, ${missing} checks did not report (a process crashed?)` : ''}`);
writeFileSync(path.join(out, 'summary-parallel.json'), JSON.stringify(lines, null, 1));
process.exit(failed || missing ? 1 : 0);
