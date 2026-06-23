/**
 * Pure URL policy for external-link handling — no Electron imports, so it stays
 * unit-testable. The Electron glue (`shell.openExternal`, webContents handlers)
 * lives in {@link file://./external-links.ts} and builds on these decisions.
 */

/** URL schemes that may be handed to the default system browser. */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses `url` and returns it only when it uses an allowed external scheme
 * (http/https). Returns `null` for unparseable URLs or disallowed protocols
 * (e.g. `file:`, `javascript:`), so callers never hand those to the OS.
 */
export function parseAllowedExternalUrl(url: string): URL | null {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		console.warn('[external-links] ignored unparseable url', url);
		return null;
	}

	if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
		console.warn(
			'[external-links] blocked disallowed protocol',
			parsed.protocol,
		);
		return null;
	}

	return parsed;
}

/**
 * Decides whether a full-page navigation to `url` should be sent to the system
 * browser. Returns the parsed URL to open externally, or `null` to let the
 * navigation proceed in-app.
 *
 * In-app (returns `null`): non-http(s) schemes — the production `file:` bundle —
 * and same-origin navigations against `appOrigin` (the dev-server origin). Every
 * other http(s) origin is external and returns the parsed URL.
 *
 * @param url - The navigation target.
 * @param appOrigin - The app's own origin, or `null` when served from `file:`.
 */
export function externalNavigationTarget(
	url: string,
	appOrigin: string | null,
): URL | null {
	const parsed = parseAllowedExternalUrl(url);

	if (!parsed || (appOrigin && parsed.origin === appOrigin)) {
		return null;
	}

	return parsed;
}
