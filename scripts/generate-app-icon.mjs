#!/usr/bin/env node
/**
 * Generates the Ensemblr macOS app icon and writes `assets/icon.{icns,png,svg}`.
 *
 * The icon is a dark "app canvas" squircle carrying the dot-matrix "E" from the
 * in-app wordmark (`src/renderer/components/welcome/welcome-wordmark.tsx`), with
 * a cyan/red chromatic-split glitch that mirrors the wordmark's RGB ghost
 * layers. Every color is derived from the design tokens in
 * `src/renderer/styles/index.css` (dark theme) so the icon tracks the app.
 *
 * Rasterization uses ImageMagick MVG `-draw` primitives rather than an SVG
 * rasterizer: the machine has no `rsvg-convert`/Inkscape delegate, and the
 * artwork is pure geometry (one superellipse + rounded-rect pixels), so drawing
 * primitives are both dependency-free and pixel-exact. `iconutil` assembles the
 * final `.icns`.
 *
 * Run: `npm run icon:generate` (or `node scripts/generate-app-icon.mjs`).
 */

import { execFileSync } from 'node:child_process';
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');

/**
 * Converts an OKLCH color to an sRGB hex string using the standard OKLab
 * matrices and the sRGB transfer function, clamped to the displayable gamut.
 *
 * @param l - OKLCH lightness (0..1).
 * @param c - OKLCH chroma.
 * @param hDeg - OKLCH hue in degrees.
 * @returns A `#rrggbb` hex string.
 */
function oklchToHex(l, c, hDeg) {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const lp = l + 0.3963377774 * a + 0.2158037573 * b;
	const mp = l - 0.1055613458 * a - 0.0638541728 * b;
	const sp = l - 0.0894841775 * a - 1.291485548 * b;
	const lc = lp ** 3;
	const mc = mp ** 3;
	const sc = sp ** 3;
	const lr = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
	const lg = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
	const lb = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;
	const encode = (channel) => {
		const srgb =
			channel <= 0.0031308
				? 12.92 * channel
				: 1.055 * channel ** (1 / 2.4) - 0.055;
		return Math.max(0, Math.min(255, Math.round(srgb * 255)));
	};
	const hex = (n) => n.toString(16).padStart(2, '0');
	return `#${hex(encode(lr))}${hex(encode(lg))}${hex(encode(lb))}`;
}

// Colors derived from src/renderer/styles/index.css (`.dark` block), plus the
// wordmark's literal glitch channels.
const COLOR_CANVAS = oklchToHex(0.135, 0.006, 35); // --ensemblr-canvas
const COLOR_INK = oklchToHex(0.91, 0.006, 75); // --ensemblr-ink
const COLOR_RIM = oklchToHex(0.31, 0.006, 35); // --ensemblr-border
const COLOR_GHOST_CYAN = '#22d3ee'; // GhostLayer color
const COLOR_GHOST_RED = '#ff2e63'; // GhostLayer color

// Canvas + macOS Big Sur icon grid: the rounded shape spans 824px inside 1024px.
const SIZE = 1024;
const CENTER = SIZE / 2;
const SQUIRCLE_SPAN = 824;
const SQUIRCLE_RADIUS = SQUIRCLE_SPAN / 2;
const SQUIRCLE_EXPONENT = 5; // superellipse power → continuous "squircle" corner
const SQUIRCLE_STEPS = 720;
const RIM_WIDTH = 4;

// Dot-matrix "E" glyph, copied verbatim from GLYPHS.E in welcome-wordmark.tsx.
const GLYPH_E = ['11111', '10000', '10000', '11110', '10000', '10000', '11111'];
const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;
const CELL = 88; // pixel-cell size; grid is 440x616, centered in 1024
const GRID_X0 = CENTER - (GLYPH_COLS * CELL) / 2;
const GRID_Y0 = CENTER - (GLYPH_ROWS * CELL) / 2;
const PIXEL_INSET = CELL * 0.12; // matches the wordmark's inter-pixel gap feel
const PIXEL_SIZE = CELL - PIXEL_INSET * 2;
const PIXEL_RADIUS = PIXEL_SIZE * 0.16;
const GHOST_OFFSET = 24; // horizontal chromatic split, ~0.27 of a cell
const GHOST_OPACITY = 0.7;
const BLOOM_SIGMA = 26; // gaussian radius of the emissive glow around the glyph
const BLOOM_STRENGTH = 0.82; // 0..1 dim factor before the glow is screened in

const round = (value) => Math.round(value * 100) / 100;

/**
 * Computes the vertices of the superellipse squircle as `[x, y]` pairs.
 *
 * @returns Ordered polygon points tracing the squircle outline.
 */
function squirclePoints() {
	const points = [];
	for (let i = 0; i < SQUIRCLE_STEPS; i += 1) {
		const t = (i / SQUIRCLE_STEPS) * 2 * Math.PI;
		const ct = Math.cos(t);
		const st = Math.sin(t);
		const x =
			CENTER +
			Math.sign(ct) * SQUIRCLE_RADIUS * Math.abs(ct) ** (2 / SQUIRCLE_EXPONENT);
		const y =
			CENTER +
			Math.sign(st) * SQUIRCLE_RADIUS * Math.abs(st) ** (2 / SQUIRCLE_EXPONENT);
		points.push([round(x), round(y)]);
	}
	return points;
}

/**
 * Computes the top-left corners of every lit "E" pixel, shifted by an offset.
 *
 * @param dx - Horizontal shift applied to every pixel (for glitch ghosts).
 * @returns Array of `[x, y]` top-left corners of drawn pixels.
 */
function pixelOrigins(dx = 0) {
	const origins = [];
	for (let row = 0; row < GLYPH_ROWS; row += 1) {
		for (let col = 0; col < GLYPH_COLS; col += 1) {
			if (GLYPH_E[row][col] === '1') {
				origins.push([
					round(GRID_X0 + col * CELL + PIXEL_INSET + dx),
					round(GRID_Y0 + row * CELL + PIXEL_INSET),
				]);
			}
		}
	}
	return origins;
}

const SQUIRCLE = squirclePoints();
const INK_PIXELS = pixelOrigins(0);
const CYAN_PIXELS = pixelOrigins(-GHOST_OFFSET);
const RED_PIXELS = pixelOrigins(GHOST_OFFSET);

const SQUIRCLE_POLYGON = SQUIRCLE.map(([x, y]) => `${x},${y}`).join(' ');

const roundRect = ([x, y]) =>
	`roundrectangle ${x},${y} ${round(x + PIXEL_SIZE)},${round(y + PIXEL_SIZE)} ${round(PIXEL_RADIUS)},${round(PIXEL_RADIUS)}`;

/**
 * MVG for the dark squircle body with a faint rim so it holds an edge on dark
 * Docks.
 *
 * @returns MVG draw string.
 */
function buildBodyMvg() {
	return [
		`fill '${COLOR_CANVAS}'`,
		`stroke '${COLOR_RIM}'`,
		`stroke-width ${RIM_WIDTH}`,
		`polygon ${SQUIRCLE_POLYGON}`,
	].join(' ');
}

/**
 * MVG for a solid white squircle used as a clip mask for the bloom.
 *
 * @returns MVG draw string.
 */
function buildMaskMvg() {
	return `fill white stroke white stroke-width ${RIM_WIDTH} polygon ${SQUIRCLE_POLYGON}`;
}

/**
 * MVG for the glyph: cyan/red chromatic-split ghosts, then the solid ink "E".
 *
 * @returns MVG draw string.
 */
function buildGlyphMvg() {
	const parts = ['stroke none', `fill-opacity ${GHOST_OPACITY}`];
	parts.push(`fill '${COLOR_GHOST_CYAN}'`);
	for (const origin of CYAN_PIXELS) parts.push(roundRect(origin));
	parts.push(`fill '${COLOR_GHOST_RED}'`);
	for (const origin of RED_PIXELS) parts.push(roundRect(origin));
	parts.push('fill-opacity 1');
	parts.push(`fill '${COLOR_INK}'`);
	for (const origin of INK_PIXELS) parts.push(roundRect(origin));
	return parts.join(' ');
}

/**
 * Builds an editable SVG source mirroring the rasterized icon geometry.
 *
 * @returns SVG document string.
 */
function buildSvg() {
	const rects = (origins, fill, opacity) =>
		origins
			.map(
				([x, y]) =>
					`      <rect x="${x}" y="${y}" width="${round(PIXEL_SIZE)}" height="${round(PIXEL_SIZE)}" rx="${round(PIXEL_RADIUS)}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`,
			)
			.join('\n');
	const glyph = `    <g>
${rects(CYAN_PIXELS, COLOR_GHOST_CYAN, GHOST_OPACITY)}
    </g>
    <g>
${rects(RED_PIXELS, COLOR_GHOST_RED, GHOST_OPACITY)}
    </g>
    <g>
${rects(INK_PIXELS, COLOR_INK, 1)}
    </g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Ensemblr">
  <title>Ensemblr</title>
  <defs>
    <clipPath id="squircle"><polygon points="${SQUIRCLE_POLYGON}"/></clipPath>
    <filter id="bloom" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${BLOOM_SIGMA}"/>
    </filter>
  </defs>
  <polygon points="${SQUIRCLE_POLYGON}" fill="${COLOR_CANVAS}" stroke="${COLOR_RIM}" stroke-width="${RIM_WIDTH}"/>
  <g clip-path="url(#squircle)">
    <g filter="url(#bloom)" opacity="${BLOOM_STRENGTH}" style="mix-blend-mode:screen">
${glyph}
    </g>
${glyph}
  </g>
</svg>
`;
}

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

/**
 * Runs a CLI tool, surfacing a readable error when the binary is missing.
 *
 * @param file - Executable name.
 * @param cliArgs - Argument list.
 */
function run(file, cliArgs) {
	try {
		execFileSync(file, cliArgs, { stdio: 'inherit' });
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(`Required tool "${file}" not found on PATH.`);
		}
		throw error;
	}
}

mkdirSync(ASSETS_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ensemblr-icon-'));
try {
	const body = join(work, 'body.png');
	const mask = join(work, 'mask.png');
	const glyph = join(work, 'glyph.png');
	const bloom = join(work, 'bloom.png');
	const master = join(work, 'icon_1024.png');

	const renderMvg = (mvg, out, background) =>
		run('magick', [
			'-size',
			`${SIZE}x${SIZE}`,
			background ? `xc:${background}` : 'xc:none',
			'-draw',
			mvg,
			'-strip',
			`PNG32:${out}`,
		]);

	renderMvg(buildBodyMvg(), body);
	renderMvg(buildMaskMvg(), mask, 'black');
	renderMvg(buildGlyphMvg(), glyph);

	// Bloom: flatten the glyph onto black, blur, and dim into an emissive glow.
	run('magick', [
		glyph,
		'-background',
		'black',
		'-alpha',
		'remove',
		'-alpha',
		'off',
		'-blur',
		`0x${BLOOM_SIGMA}`,
		'-evaluate',
		'multiply',
		`${BLOOM_STRENGTH}`,
		`PNG24:${bloom}`,
	]);

	// Screen the glow over the body, clip to the squircle, then lay the crisp
	// glyph on top.
	run('magick', [
		body,
		bloom,
		'-compose',
		'screen',
		'-composite',
		mask,
		'-alpha',
		'off',
		'-compose',
		'CopyOpacity',
		'-composite',
		glyph,
		'-compose',
		'over',
		'-composite',
		'-strip',
		`PNG32:${master}`,
	]);

	const iconset = join(work, 'Ensemblr.iconset');
	mkdirSync(iconset);
	for (const [size, name] of ICONSET_MEMBERS) {
		run('magick', [
			master,
			'-resize',
			`${size}x${size}`,
			'-strip',
			`PNG32:${join(iconset, name)}`,
		]);
	}

	run('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS_DIR, 'icon.icns')]);
	copyFileSync(master, join(ASSETS_DIR, 'icon.png'));
	writeFileSync(join(ASSETS_DIR, 'icon.svg'), buildSvg());

	process.stdout.write(
		`Wrote assets/icon.icns, assets/icon.png, assets/icon.svg\n` +
			`  canvas ${COLOR_CANVAS}  ink ${COLOR_INK}  rim ${COLOR_RIM}\n`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
