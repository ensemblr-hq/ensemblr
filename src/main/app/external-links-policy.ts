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
 * What should happen to a navigation the renderer attempted.
 *
 * `allow` is the app's own document; `external` hands the URL to the default
 * browser; `block` cancels it and names the scheme that was refused, so the
 * refusal is greppable in a support bundle.
 */
export type NavigationDecision =
	| { action: 'allow' }
	| { action: 'external'; url: URL }
	| { action: 'block'; reason: string };

/**
 * The app's own document, however it is being served: the dev server's origin,
 * or the packaged `index.html` the production build loads from `file:`.
 */
export interface AppDocument {
	/** `file:` URL of the packaged renderer entry, or `null` in development. */
	appDocumentUrl: string | null;
	/** The dev-server origin to treat as internal, or `null` in production. */
	appOrigin: string | null;
}

/**
 * Strips the query and fragment so a hash-routed navigation still compares
 * equal to the document it happens inside.
 * @param url - The URL to reduce to its document identity
 * @returns The href with `search` and `hash` removed
 */
function documentIdentity(url: URL): string {
	const identity = new URL(url.href);
	identity.hash = '';
	identity.search = '';
	return identity.href;
}

/**
 * Decides what to do with a navigation the renderer attempted, denying by
 * default.
 *
 * Only two destinations stay in the window: the app's own document (the dev
 * origin, or the packaged `index.html`) and, in development, anything else on
 * the dev-server origin that Vite serves. Every other http(s) URL goes to the
 * system browser, and everything else — `file:` outside the bundle, `blob:`,
 * `data:`, `javascript:`, an unparseable string — is cancelled rather than
 * followed, because nothing the app itself does produces one.
 *
 * @param url - The navigation target, exactly as the renderer gave it.
 * @param appDocumentUrl - `file:` URL of the packaged renderer entry, or `null` in development.
 * @param appOrigin - The dev-server origin to treat as internal, or `null` in production.
 * @returns The decision the Electron handler should act on.
 */
export function navigationDecision(
	url: string,
	{ appDocumentUrl, appOrigin }: AppDocument,
): NavigationDecision {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return { action: 'block', reason: 'unparseable' };
	}

	if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
		return appOrigin && parsed.origin === appOrigin
			? { action: 'allow' }
			: { action: 'external', url: parsed };
	}

	if (appDocumentUrl && documentIdentity(parsed) === appDocumentUrl) {
		return { action: 'allow' };
	}

	return { action: 'block', reason: parsed.protocol };
}
