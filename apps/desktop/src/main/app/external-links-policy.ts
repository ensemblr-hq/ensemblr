import { documentOrigin } from './app-bundle';

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
 * Decides what to do with a navigation the renderer attempted, denying by
 * default.
 *
 * One destination stays in the window: the app's own origin — the dev server's
 * in development, `app://bundle` in a packaged build. Every other http(s) URL
 * goes to the system browser, and everything else — `file:`, `blob:`, `data:`,
 * `javascript:`, another host on the app scheme, an unparseable string — is
 * cancelled rather than followed, because nothing the app itself does produces
 * one.
 *
 * The origin is the whole test because the packaged renderer now has one. While
 * it was a `file:` document its origin was opaque, so the entry had to be
 * compared as a full URL with the query and fragment stripped off; serving it
 * from a `standard` scheme replaced that with the same comparison development
 * always used.
 *
 * @param url - The navigation target, exactly as the renderer gave it.
 * @param appOrigin - The origin the app's own renderer is served from.
 * @returns The decision the Electron handler should act on.
 */
export function navigationDecision(
	url: string,
	appOrigin: string,
): NavigationDecision {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return { action: 'block', reason: 'unparseable' };
	}

	if (documentOrigin(parsed) === appOrigin) {
		return { action: 'allow' };
	}

	if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
		return { action: 'external', url: parsed };
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
 * `URL` exposes as the `pathname`. Comparing it is exact in both serving modes
 * now that the packaged renderer has a real origin: while it was a `file:`
 * document the only available comparison was the inner protocol, which admitted
 * any `file:` blob rather than this document's.
 * @param url - The navigation target, exactly as the renderer gave it.
 * @param appOrigin - The origin the app's own renderer is served from.
 * @returns True when the blob belongs to the app's own document.
 */
function isAppOwnBlob(url: string, appOrigin: string): boolean {
	try {
		const parsed = new URL(url);

		if (parsed.protocol !== 'blob:') {
			return false;
		}

		return documentOrigin(new URL(parsed.pathname)) === appOrigin;
	} catch {
		return false;
	}
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
 * @param appOrigin - The origin the app's own renderer is served from.
 * @returns The decision the Electron handler should act on.
 */
export function subframeNavigationDecision(
	url: string,
	appOrigin: string,
): NavigationDecision {
	if (isAppOwnBlob(url, appOrigin)) {
		return { action: 'allow' };
	}

	if (url.startsWith(`${PDF_VIEWER_ORIGIN}/`)) {
		return { action: 'allow' };
	}

	return navigationDecision(url, appOrigin);
}
