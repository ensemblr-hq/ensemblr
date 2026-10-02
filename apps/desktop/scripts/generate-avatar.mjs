#!/usr/bin/env node
/**
 * Generates a 512x512 social avatar and writes `assets/avatar.png` (gitignored —
 * regenerate with `npm run avatar:generate`).
 *
 * The avatar shares the icon's glitch "E" mark and emissive bloom but drops the
 * squircle body and rim: it renders full-bleed on the dark canvas token so it
 * fills the square with opaque, borderless corners. Profile surfaces mask
 * corners themselves and render icon transparency as black, so no rim is wanted.
 *
 * Run: `npm run avatar:generate` (or `node scripts/generate-avatar.mjs`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMaster, runTool } from './icon-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');
const AVATAR = join(ASSETS_DIR, 'avatar.png');
const SIZE = 512;

mkdirSync(ASSETS_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ensemblr-avatar-'));
try {
	const master = renderMaster(work, { withSquircle: false });
	runTool('magick', [
		master,
		'-resize',
		`${SIZE}x${SIZE}`,
		'-strip',
		`PNG24:${AVATAR}`,
	]);
	process.stdout.write(`Wrote assets/avatar.png (${SIZE}x${SIZE})\n`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
