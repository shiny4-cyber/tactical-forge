// CINDER YARD entrypoint. Hands the game in: copies game/ and screenshots/ beside this file into
// the output directory, checks the copy against the scorer's caps before the scorer sees it, then
// writes dossier.json from what actually landed there.
//
// Outside the grader:  MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

const root = fileURLToPath(new URL('.', import.meta.url));
const target = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function walk(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 24) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    acc.push(full);
    if (entry.isDirectory()) walk(full, acc, depth + 1);
  }
  return acc;
}

function measure(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const path of walk(dir)) {
    const info = statSync(path);
    if (info.isFile()) {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

// Copy the two directories the entry is made of. Screenshots are optional; game/ is not.
mkdirSync(target, { recursive: true });
cpSync(join(root, 'game'), join(target, 'game'), { recursive: true });
mkdirSync(join(target, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(target, 'screenshots'), { recursive: true });
}

// Refuse locally what the scorer would refuse, measuring the copy rather than the source tree.
const gameDir = join(target, 'game');
const game = measure(gameDir);
if (game.files > LIMITS.game_max_files) {
  throw new Error(`game/ holds ${game.files} entries, the scorer allows ${LIMITS.game_max_files}`);
}
if (game.bytes > LIMITS.game_max_bytes) {
  throw new Error(`game/ is ${game.bytes} bytes, the scorer allows ${LIMITS.game_max_bytes}`);
}
for (const path of walk(gameDir)) {
  const relative = path.slice(target.length + 1);
  if (Buffer.byteLength(relative) > LIMITS.game_path_max_bytes) {
    throw new Error(`a path under game/ exceeds ${LIMITS.game_path_max_bytes} bytes: ${relative}`);
  }
}

const shotsDir = join(target, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((name) => !name.startsWith('.')) : [];
if (shots.length > LIMITS.screenshots.max) {
  throw new Error(`screenshots/ holds ${shots.length} files, the scorer allows ${LIMITS.screenshots.max}`);
}
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > LIMITS.screenshots.max_bytes) {
    throw new Error(`${name} is ${size} bytes, the scorer allows ${LIMITS.screenshots.max_bytes}`);
  }
}

writeFileSync(join(target, 'dossier.json'), buildDossier(target, LIMITS));

const dossierBytes = statSync(join(target, 'dossier.json')).size;
process.stdout.write(
  `cinder yard: game ${game.files} files / ${game.bytes} bytes, ${shots.length} screenshots, dossier ${dossierBytes} bytes\n`,
);
