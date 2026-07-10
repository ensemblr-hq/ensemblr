#!/usr/bin/env node
/**
 * Generates the Ensemblr macOS app icon and writes `assets/icon.{icns,png,svg}`.
 *
 * The icon is a dark "app canvas" squircle carrying the dot-matrix "E" glitch
 * mark; geometry, colors, and rasterization live in `icon-art.mjs` /
 * `icon-colors.mjs` so the icon and the social avatar (`generate-avatar.mjs`)
 * stay in sync. `iconutil` assembles the final `.icns`.
 *
 * Run: `npm run icon:generate` (or `node scripts/generate-app-icon.mjs`).
 */

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSvg, renderMaster, runTool } from './icon-art.mjs';
import { COLOR_CANVAS, COLOR_INK, COLOR_RIM } from './icon-colors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');

// macOS `.iconset` members: [pixel size, filename].
const ICONSET_MEMBERS = [
	[16, 'icon_16x16.png'],
	[32, 'icon_16x16@2x.png'],
	[32, 'icon_32x32.png'],
	[64, 'icon_32x32@2x.png'],
	[128, 'icon_128x128.png'],
	[256, 'icon_128x128@2x.png'],
	[256, 'icon_256x256.png'],
	[512, 'icon_256x256@2x.png'],
	[512, 'icon_512x512.png'],
	[1024, 'icon_512x512@2x.png'],
];

mkdirSync(ASSETS_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ensemblr-icon-'));
try {
	const master = renderMaster(work, { withSquircle: true });

	const iconset = join(work, 'Ensemblr.iconset');
	mkdirSync(iconset);
	for (const [size, name] of ICONSET_MEMBERS) {
		runTool('magick', [
			master,
			'-resize',
			`${size}x${size}`,
			'-strip',
			`PNG32:${join(iconset, name)}`,
		]);
	}

	runTool('iconutil', [
		'-c',
		'icns',
		iconset,
		'-o',
		join(ASSETS_DIR, 'icon.icns'),
	]);
	copyFileSync(master, join(ASSETS_DIR, 'icon.png'));
	writeFileSync(join(ASSETS_DIR, 'icon.svg'), buildSvg());

	process.stdout.write(
		`Wrote assets/icon.icns, assets/icon.png, assets/icon.svg\n` +
			`  canvas ${COLOR_CANVAS}  ink ${COLOR_INK}  rim ${COLOR_RIM}\n`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
