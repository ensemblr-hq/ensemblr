/**
 * Shared color tokens for the generated Ensemblr icon and social avatar.
 *
 * Colors are derived from `src/renderer/styles/index.css` (`.dark` block) plus
 * the welcome wordmark's literal glitch channels, so `generate-app-icon.mjs`
 * and `generate-avatar.mjs` both track the same design tokens from one source.
 */

/**
 * Converts an OKLCH color to an sRGB hex string using the standard OKLab
 * matrices and the sRGB transfer function, clamped to the displayable gamut.
 *
 * @param l - OKLCH lightness (0..1).
 * @param c - OKLCH chroma.
 * @param hDeg - OKLCH hue in degrees.
 * @returns A `#rrggbb` hex string.
 */
export function oklchToHex(l, c, hDeg) {
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

/** Dark app-canvas fill (`--ensemblr-canvas`); also the avatar background. */
export const COLOR_CANVAS = oklchToHex(0.135, 0.006, 35);
/** Primary glyph ink (`--ensemblr-ink`). */
export const COLOR_INK = oklchToHex(0.91, 0.006, 75);
/** Squircle rim so the icon holds an edge on dark Docks (`--ensemblr-border`). */
export const COLOR_RIM = oklchToHex(0.31, 0.006, 35);
/** Cyan chromatic-split ghost channel (wordmark GhostLayer). */
export const COLOR_GHOST_CYAN = '#22d3ee';
/** Red chromatic-split ghost channel (wordmark GhostLayer). */
export const COLOR_GHOST_RED = '#ff2e63';
