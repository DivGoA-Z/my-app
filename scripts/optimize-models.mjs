// scripts/optimize-models.mjs — `npm run optimize-models` (§111)
//
// Drop new .glb files anywhere under public/models/, run this once, and
// every model that still needs it is shrunk in place: same file name, so
// catalogue addresses don't change. The original is kept in
// models-originals/ (git-ignored, outside public/ so it's never served),
// in case a result doesn't look right.
//
// A model is skipped when it's ALREADY OPTIMISED (it declares meshopt
// compression, which only this step adds) or SMALL (under --min-kb,
// default 1000 KB): shrinking a small, hand-tuned model gains almost
// nothing and could subtly change it. So re-running is cheap — with
// nothing new it finishes in about a second.
//
// Settings are the ones chosen by side-by-side renders in §111: meshopt
// geometry compression and WebP 1024 px textures (both load with no extra
// download: drei's useGLTF bundles the meshopt decoder), and GENTLE
// simplification. Harder simplification made a fridge look dented.
// Never Draco: its decoder comes from a CDN at runtime.
//
// Options: --min-kb <n>  size threshold (default 1000)
//          --dry-run     list what would be done, change nothing

import { readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const MODELS = join(ROOT, 'public/models');
const BACKUPS = join(ROOT, 'models-originals');
const CLI = join(ROOT, 'node_modules/.bin/gltf-transform');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const minKbArg = args.indexOf('--min-kb');
const minKb = minKbArg >= 0 ? Number(args[minKbArg + 1]) : 1000;

const SETTINGS = [
  '--compress', 'meshopt',
  '--texture-compress', 'webp',
  '--texture-size', '1024',
  '--simplify', 'true',
  '--simplify-ratio', '0.3',
  '--simplify-error', '0.0003',
];

function glbFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return glbFiles(path);
    return name.toLowerCase().endsWith('.glb') ? [path] : [];
  });
}

// The JSON chunk of a .glb: 12-byte header, then chunk length + type.
function extensionsRequired(path) {
  const buf = readFileSync(path);
  if (buf.toString('utf8', 0, 4) !== 'glTF') return null;
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  return json.extensionsRequired ?? [];
}

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString()} KB`;

if (!existsSync(CLI)) {
  console.error('gltf-transform is missing: run `npm install` first.');
  process.exit(1);
}

let done = 0;
let skipped = 0;
let failed = 0;
for (const path of glbFiles(MODELS)) {
  const rel = relative(ROOT, path);
  const size = statSync(path).size;
  const required = extensionsRequired(path);
  if (required === null) {
    console.log(`  skip  ${rel}: not a valid .glb`);
    skipped++;
    continue;
  }
  if (required.includes('EXT_meshopt_compression')) {
    skipped++;
    continue;
  }
  if (size < minKb * 1024) {
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(`  would optimise  ${rel} (${kb(size)})`);
    continue;
  }

  // Outside public/models, so an interrupted run can't leave a stray
  // .glb behind for the next run to pick up as a "new" model.
  const tmp = join(tmpdir(), `optimizing-${process.pid}-${basename(path)}`);
  process.stdout.write(`  optimising  ${rel} (${kb(size)}) … `);
  try {
    execFileSync(CLI, ['optimize', path, tmp, ...SETTINGS], { stdio: 'pipe' });
    const backup = join(BACKUPS, relative(MODELS, path));
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(path, backup);
    copyFileSync(tmp, path);
    rmSync(tmp);
    console.log(`→ ${kb(statSync(path).size)}  (original kept in ${relative(ROOT, backup)})`);
    done++;
  } catch (err) {
    console.log('FAILED');
    console.error(String(err.stderr || err.message).trim().split('\n').slice(-3).join('\n'));
    failed++;
  }
}

console.log(
  dryRun
    ? `Dry run: nothing changed. ${skipped} already optimised or under ${minKb} KB.`
    : `${done} optimised, ${skipped} already optimised or under ${minKb} KB${failed ? `, ${failed} FAILED` : ''}.` +
        (done ? ' Look at the changed models in the 3D view before committing.' : '')
);
process.exit(failed ? 1 : 0);
