/**
 * Renderer-side scheme allowlist for URLs that came from outside the app —
 * a GitHub check run's `details_url`, a Linear issue link, a release feed's
 * download URL, an OSC 8 hyperlink written by whatever is driving a PTY.
 *
 * It mirrors `parseAllowedExternalUrl` in
 * `src/main/app/external-links-policy.ts` deliberately rather than importing
 * it: that module is main-process code the renderer may not reach across the
 * process boundary. The allowlist is the same two schemes, and
 * `tests/renderer/external-url.test.ts` pins them to each other.
 *
 * The main process refuses anything else on the `openExternal` path already.
 * This is the renderer half, for the two places that refusal cannot cover: an
 * `href` bound straight onto an anchor, which never reaches main at all, and a
 * string the renderer is about to hand to the OS.
 */

/** URL schemes that may be handed to the default system browser. */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses an untrusted URL and returns it only when it uses an allowed external
 * scheme.
 * @param url - The URL exactly as its source gave it
 * @returns The parsed URL, or null when it is unparseable or uses a scheme such
 *   as `javascript:`, `file:`, `data:` or a custom app protocol
 */
export function parseExternalUrl(url: string | null | undefined): URL | null {
	if (!url) {
		return null;
	}

	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed : null;
}

/**
 * Narrows an untrusted URL to something safe to bind to an anchor's `href`.
 *
 * Returns `undefined` rather than `'#'` or the original string so the anchor
 * renders as plain text — a link that silently goes nowhere is a worse outcome
 * than one that is visibly not a link. The accepted string is handed back
 * verbatim rather than re-serialized, so a URL is never rewritten on its way to
 * the browser.
 * @param url - The URL exactly as its source gave it
 * @returns The URL when it is http(s), otherwise undefined
 */
export function externalHref(
	url: string | null | undefined,
): string | undefined {
	return url && parseExternalUrl(url) ? url : undefined;
}
