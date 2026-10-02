#!/usr/bin/env node
/**
 * Generates the animated "ENSEMBLR" wordmark and writes `assets/wordmark.gif`
 * (committed — regenerate with `npm run wordmark:generate`).
 *
 * The mark is the in-app dot-matrix wordmark from
 * `src/renderer/components/welcome/welcome-wordmark.tsx`: per-pixel flicker plus
 * a periodic chromatic-split glitch burst (red/cyan ghosts offset either side of
 * a skewed main layer). The app's timings run on a 9-17s burst interval and
 * 12-20s flicker cycles. One seamless 16s loop holds a flicker cycle at the low
 * end of that range: every pixel runs exactly one cycle per loop at a random
 * phase, and one burst fires mid-loop. The burst interval is the part that stays
 * compressed — a loop cannot hold a 9-17s gap between bursts and also start and
 * end quiet — so the loop preserves the *density* of the original, roughly 6% of
 * pixels dipped at any instant, rather than its literal burst period.
 *
 * The canvas is GitHub's dark page background rather than the app's own
 * `--ensemblr-canvas`, so the mark sits flush in the README instead of reading
 * as a near-black card on a dark page.
 *
 * Rasterization follows `icon-art.mjs`: ImageMagick MVG `-draw` primitives, not
 * an SVG rasterizer, because the machine has no `rsvg-convert`/Inkscape delegate
 * and the artwork is pure geometry.
 *
 * Run: `npm run wordmark:generate` (or `node scripts/generate-wordmark-gif.mjs`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './icon-art.mjs';
import {
	COLOR_GHOST_CYAN,
	COLOR_GHOST_RED,
	COLOR_INK,
} from './icon-colors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');
const OUTPUT = join(ASSETS_DIR, 'wordmark.gif');

// GitHub's dark canvas, not an app design token — this GIF only ever renders on
// a GitHub README, where matching that page keeps the mark from showing a seam.
const COLOR_CANVAS = '#0d1117';

// Dot-matrix glyphs, copied verbatim from GLYPHS in welcome-wordmark.tsx.
const GLYPHS = {
	B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
	E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
	L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
	M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
	N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
	R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
	S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
};

const WORD = 'ENSEMBLR';
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const LETTER_GAP = 1;
const GRID_COLUMNS = WORD.length * GLYPH_WIDTH + (WORD.length - 1) * LETTER_GAP;

const CELL = 12;
const PADDING = 12;
const WIDTH = GRID_COLUMNS * CELL + PADDING * 2;
const HEIGHT = GLYPH_HEIGHT * CELL + PADDING * 2;
const PIXEL_INSET = CELL * 0.1;
const PIXEL_SIZE = CELL - PIXEL_INSET * 2;

// The component offsets ghosts by 3 CSS px and the main layer by 1 px at a
// rendered height of 64px (h-16), i.e. ~9.1px per cell — so both are expressed
// as a fraction of a cell here and stay correct at any CELL.
const GHOST_OFFSET = CELL * 0.33;
const GLITCH_SHIFT = CELL * 0.11;
const GHOST_OPACITY = 0.75;
const GLITCH_SKEW_DEGREES = -2;

// Frame count scales with the loop so the delay stays a whole 5cs (20fps): GIF
// delays are centisecond integers, and a loop that does not divide evenly drifts
// the burst away from the moment the glitch constants place it.
const LOOP_MS = 16_000;
const FRAME_COUNT = 320;
const FRAME_DELAY_CENTISECONDS = Math.round(LOOP_MS / FRAME_COUNT / 10);
const GIF_COLORS = 128;

const GLITCH_START_MS = LOOP_MS * 0.55;
const GLITCH_DURATION_MS = 320;
const GLITCH_TRANSITION_MS = 70;

// Opacity stops of `@keyframes ensemblr-wordmark-flicker`, as [progress, opacity].
const FLICKER_STOPS = [
	[0, 1],
	[0.48, 1],
	[0.49, 0.15],
	[0.5, 0.85],
	[0.51, 1],
	[0.76, 1],
	[0.77, 0.4],
	[0.78, 1],
	[1, 1],
];

const PHASE_SEED = 0x5eed_1e55;

/**
 * Creates a seeded pseudo-random generator so a regenerated GIF is byte-stable.
 * @param seed - 32-bit seed value
 * @returns A function returning successive floats in [0, 1)
 */
function createRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b_79f5) >>> 0;
		let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
		drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
		return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * Builds every lit pixel of the wordmark with its own flicker phase.
 * @returns Grid-space pixels, each carrying the phase offset of its flicker cycle
 */
function buildPixels() {
	const random = createRandom(PHASE_SEED);
	const pixels = [];
	for (let letterIndex = 0; letterIndex < WORD.length; letterIndex += 1) {
		const glyph = GLYPHS[WORD[letterIndex]];
		if (!glyph) {
			continue;
		}
		const baseColumn = letterIndex * (GLYPH_WIDTH + LETTER_GAP);
		for (let row = 0; row < glyph.length; row += 1) {
			const rowData = glyph[row];
			for (let column = 0; column < rowData.length; column += 1) {
				if (rowData[column] === '1') {
					pixels.push({
						column: baseColumn + column,
						phase: random(),
						row,
					});
				}
			}
		}
	}
	return pixels;
}

/**
 * Samples the flicker keyframes at a point in a pixel's cycle.
 * @param progress - Position within the flicker cycle, in [0, 1)
 * @returns The interpolated opacity for that moment
 */
function flickerOpacity(progress) {
	for (let index = 1; index < FLICKER_STOPS.length; index += 1) {
		const [stopProgress, stopOpacity] = FLICKER_STOPS[index];
		if (progress <= stopProgress) {
			const [previousProgress, previousOpacity] = FLICKER_STOPS[index - 1];
			const span = stopProgress - previousProgress;
			const ratio = span === 0 ? 0 : (progress - previousProgress) / span;
			return previousOpacity + (stopOpacity - previousOpacity) * ratio;
		}
	}
	return 1;
}

/**
 * Computes how far into the glitch burst the loop is at a given moment. The
 * component eases the ghost layers in and out over 70ms; a linear ramp of the
 * same length is indistinguishable at this frame rate.
 * @param elapsedMs - Milliseconds elapsed within the loop
 * @returns Burst strength in [0, 1], where 0 is no glitch and 1 is fully split
 */
function glitchAmount(elapsedMs) {
	const endMs = GLITCH_START_MS + GLITCH_DURATION_MS;
	if (elapsedMs < GLITCH_START_MS || elapsedMs > endMs + GLITCH_TRANSITION_MS) {
		return 0;
	}
	if (elapsedMs < GLITCH_START_MS + GLITCH_TRANSITION_MS) {
		return (elapsedMs - GLITCH_START_MS) / GLITCH_TRANSITION_MS;
	}
	if (elapsedMs <= endMs) {
		return 1;
	}
	return 1 - (elapsedMs - endMs) / GLITCH_TRANSITION_MS;
}

/**
 * Rounds a coordinate to two decimals so the emitted MVG stays compact.
 * @param value - Raw coordinate or length
 * @returns The value rounded to hundredths
 */
const round = (value) => Math.round(value * 100) / 100;

/**
 * Emits the MVG rectangle for one pixel, shifted horizontally.
 * @param pixel - The grid pixel to draw
 * @param shift - Horizontal offset in device pixels
 * @returns An MVG `rectangle` primitive
 */
function pixelRectangle(pixel, shift) {
	const x0 = PADDING + pixel.column * CELL + PIXEL_INSET + shift;
	const y0 = PADDING + pixel.row * CELL + PIXEL_INSET;
	return `rectangle ${round(x0)},${round(y0)} ${round(x0 + PIXEL_SIZE)},${round(y0 + PIXEL_SIZE)}`;
}

/**
 * Draws one offset, tinted copy of the wordmark — the chromatic ghost the
 * component renders as a `GhostLayer`.
 * @param pixels - Every lit pixel of the wordmark
 * @param color - Ghost channel color
 * @param shift - Horizontal offset in device pixels
 * @param amount - Burst strength in [0, 1]
 * @returns MVG commands for the ghost layer
 */
function ghostLayerMvg(pixels, color, shift, amount) {
	const rectangles = pixels
		.map((pixel) => pixelRectangle(pixel, shift * amount))
		.join(' ');
	return `push graphic-context fill '${color}' fill-opacity ${round(GHOST_OPACITY * amount)} ${rectangles} pop graphic-context`;
}

/**
 * Draws the lit wordmark itself, each pixel at its own flicker opacity and the
 * whole layer skewed while a burst is active.
 * @param pixels - Every lit pixel of the wordmark
 * @param elapsedMs - Milliseconds elapsed within the loop
 * @param amount - Burst strength in [0, 1]
 * @returns MVG commands for the main layer
 */
function inkLayerMvg(pixels, elapsedMs, amount) {
	const loopProgress = elapsedMs / LOOP_MS;
	const rectangles = pixels
		.map((pixel) => {
			const opacity = flickerOpacity((loopProgress + pixel.phase) % 1);
			return `fill-opacity ${round(opacity)} ${pixelRectangle(pixel, GLITCH_SHIFT * amount)}`;
		})
		.join(' ');
	const skew = round(GLITCH_SKEW_DEGREES * amount);
	const centerY = HEIGHT / 2;
	return [
		'push graphic-context',
		`translate 0,${centerY} skewX ${skew} translate 0,${-centerY}`,
		`fill '${COLOR_INK}'`,
		rectangles,
		'pop graphic-context',
	].join(' ');
}

/**
 * Renders one frame of the loop to a PNG.
 * @param pixels - Every lit pixel of the wordmark
 * @param frameIndex - Zero-based index of the frame within the loop
 * @param outputPath - Absolute path of the PNG to write
 */
function renderFrame(pixels, frameIndex, outputPath) {
	const elapsedMs = (frameIndex / FRAME_COUNT) * LOOP_MS;
	const amount = glitchAmount(elapsedMs);
	const mvg = [
		ghostLayerMvg(pixels, COLOR_GHOST_RED, -GHOST_OFFSET, amount),
		ghostLayerMvg(pixels, COLOR_GHOST_CYAN, GHOST_OFFSET, amount),
		inkLayerMvg(pixels, elapsedMs, amount),
	].join(' ');
	runTool('magick', [
		'-size',
		`${WIDTH}x${HEIGHT}`,
		`xc:${COLOR_CANVAS}`,
		'-draw',
		mvg,
		'-strip',
		`PNG32:${outputPath}`,
	]);
}

/**
 * Renders every frame and encodes the looping GIF.
 * @param workDir - Scratch directory for the frame PNGs
 */
function renderWordmark(workDir) {
	const pixels = buildPixels();
	const frames = [];
	for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
		const framePath = join(
			workDir,
			`frame-${String(frameIndex).padStart(3, '0')}.png`,
		);
		renderFrame(pixels, frameIndex, framePath);
		frames.push(framePath);
	}
	runTool('magick', [
		'-delay',
		String(FRAME_DELAY_CENTISECONDS),
		'-loop',
		'0',
		...frames,
		'-colors',
		String(GIF_COLORS),
		'-layers',
		'Optimize',
		OUTPUT,
	]);
}

mkdirSync(ASSETS_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ensemblr-wordmark-'));
try {
	renderWordmark(work);
	process.stdout.write(`Wrote ${OUTPUT}\n`);
} finally {
	rmSync(work, { force: true, recursive: true });
}
