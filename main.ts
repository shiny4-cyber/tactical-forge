// CINDER YARD hand-in program (Node 22+, standard library only, no install, no build).
//
// What it does, in order:
//   1. resolve the output directory (MAKEFUN_OUTPUT_DIR, else the grader's /output)
//   2. copy game/ and screenshots/ from beside this file into it, clearing any earlier copy
//   3. measure that copy, not the source tree, against the scorer's caps
//   4. write dossier.json with the vendored library's buildDossier
//   5. print one summary line
//
// Run it locally with:  MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's caps, as its gate.json names them. buildDossier applies them itself; this program
// also checks them so a bad copy is refused here, with a readable reason, before the scorer sees it.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// The platform's own cap on /output: game/, screenshots/ and dossier.json share these entries.
const OUTPUT_ENTRY_CAP = 1000;
const MIN_SCREENSHOTS = 3;

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

type TreeReport = {
  entries: number;
  files: number;
  dirs: number;
  bytes: number;
  longestPathBytes: number;
  symlinks: string[];
};

// One iterative walk of a directory: entries (files plus directories, as the platform counts
// them), file bytes, and the paths themselves so lengths can be measured. No recursion limit.
function walk(root: string): { report: TreeReport; relativePaths: string[] } {
  const report: TreeReport = { entries: 0, files: 0, dirs: 0, bytes: 0, longestPathBytes: 0, symlinks: [] };
  const relativePaths: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const relative = stack.pop() as string;
    const absolute = relative === '' ? root : join(root, relative);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childAbsolute = join(root, childRelative);
      report.entries += 1;
      relativePaths.push(childRelative);
      const pathBytes = Buffer.byteLength(childRelative, 'utf8');
      if (pathBytes > report.longestPathBytes) report.longestPathBytes = pathBytes;
      const info = lstatSync(childAbsolute);
      if (info.isSymbolicLink()) {
        report.symlinks.push(childRelative);
        continue;
      }
      if (info.isDirectory()) {
        report.dirs += 1;
        stack.push(childRelative);
      } else if (info.isFile()) {
        report.files += 1;
        report.bytes += info.size;
      }
    }
  }
  return { report, relativePaths };
}

function fail(problems: string[]): void {
  if (problems.length === 0) return;
  throw new Error(`cinder yard: refusing to hand in:\n  - ${problems.join('\n  - ')}`);
}

// A clean copy: an earlier run's files must not survive into this one, or the dossier would
// describe files the game no longer has. The guard keeps a mis-set output path from deleting the
// repository or the filesystem root.
if (outDir === resolve('/') || outDir === resolve(repoRoot)) {
  throw new Error(`cinder yard: refusing to use ${outDir} as the output directory`);
}
mkdirSync(outDir, { recursive: true });
for (const name of ['game', 'screenshots']) {
  const stale = join(outDir, name);
  if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });
}
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
const screenshotsSource = join(repoRoot, 'screenshots');
if (existsSync(screenshotsSource)) {
  cpSync(screenshotsSource, join(outDir, 'screenshots'), { recursive: true });
}

// Measure the copy.
const problems: string[] = [];
const game = walk(join(outDir, 'game'));
if (game.report.entries > CAPS.game_max_files) {
  problems.push(`game/ holds ${game.report.entries} entries, the scorer allows ${CAPS.game_max_files}`);
}
if (game.report.bytes > CAPS.game_max_bytes) {
  problems.push(`game/ is ${game.report.bytes} bytes, the scorer allows ${CAPS.game_max_bytes}`);
}
if (game.report.longestPathBytes > CAPS.game_path_max_bytes) {
  const worst = game.relativePaths.reduce((longest, path) => (Buffer.byteLength(path) > Buffer.byteLength(longest) ? path : longest), '');
  problems.push(`game/${worst} is ${game.report.longestPathBytes} bytes of path, the scorer allows ${CAPS.game_path_max_bytes}`);
}
for (const link of game.report.symlinks) {
  problems.push(`game/${link} is a symbolic link, and game/ must be plain files and directories`);
}
if (!existsSync(join(outDir, 'game', 'index.html'))) {
  problems.push('game/index.html is missing from the copy');
}

const screenshotNames = existsSync(join(outDir, 'screenshots'))
  ? readdirSync(join(outDir, 'screenshots')).filter((name) => !name.startsWith('.')).sort()
  : [];
if (screenshotNames.length < MIN_SCREENSHOTS || screenshotNames.length > CAPS.screenshots.max) {
  problems.push(`screenshots/ holds ${screenshotNames.length} images, the scorer wants ${MIN_SCREENSHOTS} to ${CAPS.screenshots.max}`);
}
let screenshotBytes = 0;
for (const name of screenshotNames) {
  const size = statSync(join(outDir, 'screenshots', name)).size;
  screenshotBytes += size;
  if (size > CAPS.screenshots.max_bytes) {
    problems.push(`screenshots/${name} is ${size} bytes, the scorer allows ${CAPS.screenshots.max_bytes}`);
  }
}

// /output's own entry cap, counted over what this program is about to leave behind.
const afterCopy = walk(outDir);
if (afterCopy.report.entries + 1 > OUTPUT_ENTRY_CAP) {
  problems.push(`the copy holds ${afterCopy.report.entries} entries before dossier.json, the platform allows ${OUTPUT_ENTRY_CAP} after it`);
}
fail(problems);

// The dossier describes the copy, built by the library the scorer rebuilds it with. buildDossier
// returns the dossier's bytes, ready to write; decoding a copy lets the text cap be checked too.
const dossier = buildDossier(outDir, CAPS);
const dossierBytes = dossier.byteLength;
const decoded = JSON.parse(Buffer.from(dossier).toString('utf8')) as { text?: string };
const textBytes = Buffer.byteLength(decoded.text ?? '', 'utf8');
if (textBytes > CAPS.text_max_bytes) {
  throw new Error(`cinder yard: the dossier text is ${textBytes} bytes, over the ${CAPS.text_max_bytes} allowed`);
}
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `cinder yard: game ${game.report.files} files + ${game.report.dirs} dirs / ${game.report.bytes} bytes, ` +
    `${screenshotNames.length} screenshots / ${screenshotBytes} bytes, text ${textBytes}/${CAPS.text_max_bytes}, ` +
    `dossier ${dossierBytes} bytes -> ${join(outDir, 'dossier.json')}\n`,
);
