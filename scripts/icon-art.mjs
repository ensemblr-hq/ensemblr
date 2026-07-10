/**
 * Shared geometry and rasterization for the Ensemblr app icon and social
 * avatar. Both marks are the same dot-matrix "E" (from the in-app wordmark,
 * `src/renderer/components/welcome/welcome-wordmark.tsx`) with a cyan/red
 * chromatic-split glitch and an emissive bloom; the icon adds the dark squircle
 * body + rim, the avatar renders the mark full-bleed on a canvas square.
 *
 * Rasterization uses ImageMagick MVG `-draw` primitives rather than an SVG
 * rasterizer: the machine has no `rsvg-convert`/Inkscape delegate, and the
 * artwork is pure geometry (one superellipse + rounded-rect pixels), so drawing
 * primitives are both dependency-free and pixel-exact.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
	COLOR_CANVAS,
	COLOR_GHOST_CYAN,
	COLOR_GHOST_RED,
	COLOR_INK,
	COLOR_RIM,
} from './icon-colors.mjs';

// Canvas + macOS Big Sur icon grid: the rounded shape spans 824px inside 1024px.
export const SIZE = 1024;
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
const CELL = 70.4; // 88 × 0.8 — "E" reduced 20%; grid is 352x492.8, centered in 1024
const GRID_X0 = CENTER - (GLYPH_COLS * CELL) / 2;
const GRID_Y0 = CENTER - (GLYPH_ROWS * CELL) / 2;
const PIXEL_INSET = CELL * 0.12; // matches the wordmark's inter-pixel gap feel
const PIXEL_SIZE = CELL - PIXEL_INSET * 2;
const PIXEL_RADIUS = PIXEL_SIZE * 0.16;
const GHOST_OFFSET = CELL * 0.27; // horizontal chromatic split, ~0.27 of a cell (scales with glyph)
const GHOST_OPACITY = 0.7;
export const BLOOM_SIGMA = 26; // gaussian radius of the emissive glow around the glyph
export const BLOOM_STRENGTH = 0.82; // 0..1 dim factor before the glow is screened in

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
 * Builds an editable SVG source mirroring the rasterized icon geometry (dark
 * squircle body, rim, bloom, and glyph).
 *
 * @returns SVG document string.
 */
export function buildSvg() {
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

/**
 * Runs a CLI tool, surfacing a readable error when the binary is missing.
 *
 * @param file - Executable name.
 * @param cliArgs - Argument list.
 */
export function runTool(file, cliArgs) {
	try {
		execFileSync(file, cliArgs, { stdio: 'inherit' });
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(`Required tool "${file}" not found on PATH.`);
		}
		throw error;
	}
}

/**
 * Draws an MVG string over a `${SIZE}x${SIZE}` canvas and writes a PNG.
 *
 * @param mvg - ImageMagick MVG draw commands.
 * @param out - Output PNG path.
 * @param background - Optional background color; transparent when omitted.
 */
function renderMvg(mvg, out, background) {
	runTool('magick', [
		'-size',
		`${SIZE}x${SIZE}`,
		background ? `xc:${background}` : 'xc:none',
		'-draw',
		mvg,
		'-strip',
		`PNG32:${out}`,
	]);
}

/**
 * Renders the 1024px emissive mark (chromatic glyph + bloom glow) to a PNG.
 *
 * With `withSquircle`, the mark sits on the dark squircle body with a faint rim
 * and the glow is clipped to the squircle (the app icon). Without it, the mark
 * fills a full opaque canvas square with no rim or clip (the social avatar).
 *
 * @param workDir - Scratch directory for intermediate PNGs.
 * @param options - Rendering options; `withSquircle` toggles the body + rim.
 * @returns Absolute path to the 1024x1024 master PNG inside `workDir`.
 */
export function renderMaster(workDir, { withSquircle }) {
	const glyph = join(workDir, 'glyph.png');
	const bloom = join(workDir, 'bloom.png');
	const master = join(workDir, 'master.png');

	renderMvg(buildGlyphMvg(), glyph);

	// Bloom: flatten the glyph onto black, blur, and dim into an emissive glow.
	runTool('magick', [
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

	if (!withSquircle) {
		// Avatar: screen the glow over a full canvas square, then the crisp glyph —
		// no squircle body, rim, or clip mask.
		const base = join(workDir, 'base.png');
		runTool('magick', [
			'-size',
			`${SIZE}x${SIZE}`,
			`xc:${COLOR_CANVAS}`,
			'-strip',
			`PNG24:${base}`,
		]);
		runTool('magick', [
			base,
			bloom,
			'-compose',
			'screen',
			'-composite',
			glyph,
			'-compose',
			'over',
			'-composite',
			'-strip',
			`PNG32:${master}`,
		]);
		return master;
	}

	// Icon: screen the glow over the squircle body, clip to the squircle, then
	// lay the crisp glyph on top.
	const body = join(workDir, 'body.png');
	const mask = join(workDir, 'mask.png');
	renderMvg(buildBodyMvg(), body);
	renderMvg(buildMaskMvg(), mask, 'black');
	runTool('magick', [
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
	return master;
}
