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

/**
 * Chromium's built-in PDF viewer, which an `<embed type="application/pdf">`
 * instantiates in a subframe of the embedding document. The id is Chromium's
 * own (`extension_misc::kPdfExtensionId`), not something this app registers.
 */
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';

/**
 * Whether a `blob:` URL was minted by the app's own document.
 *
 * A blob URL carries the origin that created it after the `blob:` prefix, which
 * `URL` exposes as the `pathname`. From the dev server that inner origin is the
 * dev origin; from the packaged build the document is `file:`, whose origin is
 * opaque, so the protocol is as tight a comparison as the platform offers.
 * @param url - The navigation target, exactly as the renderer gave it.
 * @param appDocument - Where the app's own renderer is being served from.
 * @returns True when the blob belongs to the app's own document.
 */
function isAppOwnBlob(
	url: string,
	{ appDocumentUrl, appOrigin }: AppDocument,
): boolean {
	let parsed: URL;
	let inner: URL;

	try {
		parsed = new URL(url);
		if (parsed.protocol !== 'blob:') {
			return false;
		}
		inner = new URL(parsed.pathname);
	} catch {
		return false;
	}

	return appOrigin
		? inner.origin === appOrigin
		: appDocumentUrl !== null && inner.protocol === 'file:';
}

/**
 * Decides what to do with a navigation inside a **subframe**, which is allowed
 * two destinations a top-level navigation is not.
 *
 * Both exist only to let the file preview show a PDF. `<embed>` loads the blob
 * the app minted from the file's bytes, and Chromium then instantiates its own
 * viewer in a nested frame; each step is a frame navigation, and the top-level
 * policy refuses both — a `blob:` because nothing the app navigates *to* should
 * be one, and `chrome-extension:` because the app registers no extension.
 * Neither is a destination a document can reach on its own: the blob has to have
 * been created by this renderer, and the viewer frame is opened by the browser
 * rather than by script.
 *
 * A top-level navigation to either is still blocked — this is the subframe
 * handler's decision, not a widening of {@link navigationDecision}.
 * @param url - The navigation target, exactly as the renderer gave it.
 * @param appDocument - Where the app's own renderer is being served from.
 * @returns The decision the Electron handler should act on.
 */
export function subframeNavigationDecision(
	url: string,
	appDocument: AppDocument,
): NavigationDecision {
	if (isAppOwnBlob(url, appDocument)) {
		return { action: 'allow' };
	}

	if (url.startsWith(`${PDF_VIEWER_ORIGIN}/`)) {
		return { action: 'allow' };
	}

	return navigationDecision(url, appDocument);
}
