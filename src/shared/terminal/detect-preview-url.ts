/**
 * Detects a local dev-server preview URL in terminal output. Handles the common
 * framework banners (Vite `Local:`, `listening on`, Next.js `- Local:`, etc.) by
 * matching an http/https URL on a loopback/any host with an explicit port, then
 * trimming the ANSI escapes and quotes that colored output appends.
 */

const PREVIEW_URL_PATTERN =
	/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}(?:\/\S*)?/;

// Vite (and electron-vite) print the URL colored AND bold the port, so the raw
// bytes read `http://localhost:<ESC>[1m5173<ESC>[22m/` — an escape sits between
// the colon and the digits. Strip CSI escapes before matching so the URL is
// contiguous; otherwise `:\d` never matches and the Open button stays hidden.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the whole point.
const ANSI_PATTERN = /\x1B\[[0-9;?]*[A-Za-z]/g;

const QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * Returns the first local preview URL found in `text`, or `null` when none is
 * present. Only loopback/any hosts with an explicit port are matched so agent
 * chatter and remote URLs never trigger the dock's Open button. ANSI color
 * escapes are stripped first so a bolded port (Vite) still matches.
 * @param text - A chunk of raw terminal output.
 * @returns The detected URL (trimmed of trailing control/quote noise), or null.
 */
export function detectPreviewUrl(text: string): string | null {
	const match = PREVIEW_URL_PATTERN.exec(text.replace(ANSI_PATTERN, ''));

	return match ? trimUrl(match[0]) : null;
}

/**
 * Extracts the numeric port from a detected preview URL.
 * @param url - A URL previously returned by {@link detectPreviewUrl}.
 * @returns The port, or `null` when absent or out of range.
 */
export function extractPreviewPort(url: string): number | null {
	const match = /:(\d{1,5})(?:\/|$)/.exec(url);

	if (!match) {
		return null;
	}

	const port = Number(match[1]);

	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

/**
 * Cuts a raw match at the first control character or quote so trailing ANSI
 * reset sequences (e.g. after a colored Vite URL) never leak into the result.
 */
function trimUrl(url: string): string {
	for (let index = 0; index < url.length; index += 1) {
		const code = url.charCodeAt(index);

		if (code < 0x20 || code === 0x7f || QUOTE_CHARS.has(url[index] ?? '')) {
			return url.slice(0, index);
		}
	}

	return url;
}
