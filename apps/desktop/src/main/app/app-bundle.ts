import path from 'node:path';

/**
 * How the packaged renderer is addressed, and which file on disk a request for
 * it resolves to. Pure — no Electron imports — so the path resolution stays
 * unit-testable; the `protocol.handle` glue lives in
 * {@link file://./app-protocol.ts}.
 *
 * The renderer used to be a `file:` document, which Electron grants privileges
 * a browser withholds: such a page can read every file its user can, so a
 * renderer XSS reaches `~/.ssh/id_ed25519` with no IPC handler and no path
 * validation in the loop. Closing that means turning
 * `GrantFileProtocolExtraPrivileges` off, and a `file:` document with the fuse
 * off has no usable origin left — module scripts stop loading and
 * `localStorage` throws. A custom scheme registered `standard` + `secure` gives
 * the document a real origin instead, keeps everything the bundle needs, and
 * refuses `fetch('file:///…')`. See
 * `docs/adr/0072-serve-the-packaged-renderer-from-its-own-origin.md`.
 */

/** Scheme the packaged renderer and its assets are served from. */
export const APP_SCHEME = 'app';

/** Host the renderer bundle is served under, and the only one this scheme answers. */
export const APP_BUNDLE_HOST = 'bundle';

/** Origin of the packaged renderer document, which `'self'` resolves to in its CSP. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_BUNDLE_HOST}`;

/** The packaged renderer entry, as `loadURL` is given it. */
export const APP_RENDERER_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** What a request for the bundle root is served. */
const BUNDLE_INDEX = '/index.html';

/**
 * The origin of a URL in the `scheme://host` shape both web storage and the
 * navigation policy key off.
 *
 * Built from protocol and host rather than read off `URL.origin`, which reports
 * the string `"null"` for `file:` and for any non-special scheme — so
 * `app://bundle` and a `file:` document would be indistinguishable exactly
 * where the distinction matters.
 * @param url - The URL to reduce to its origin.
 * @returns The origin key.
 */
export function documentOrigin(url: URL): string {
	return `${url.protocol}//${url.host}`;
}

/**
 * Resolves a request on the app scheme to the file inside the bundle it may be
 * served from, or refuses it.
 *
 * Refusing rather than clamping is the point: this scheme exists to serve a
 * fixed set of files, so a host it does not recognise and a path that escapes
 * the bundle (`app://bundle/../../.ssh/id_ed25519`) are both answered with
 * nothing at all.
 * @param bundleRoot - Absolute path of the built renderer directory.
 * @param requestUrl - The URL the protocol handler was asked for.
 * @returns The absolute path to serve, or null when the request is not one this scheme answers.
 */
export function bundleFilePath(
	bundleRoot: string,
	requestUrl: string,
): string | null {
	let parsed: URL;

	try {
		parsed = new URL(requestUrl);
	} catch {
		return null;
	}

	if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_BUNDLE_HOST) {
		return null;
	}

	try {
		const pathname = decodeURIComponent(parsed.pathname);
		const requested =
			pathname === '' || pathname === '/' ? BUNDLE_INDEX : pathname;
		const resolved = path.resolve(bundleRoot, `.${requested}`);
		const relative = path.relative(bundleRoot, resolved);
		const escapesBundle =
			relative === '' || relative.startsWith('..') || path.isAbsolute(relative);

		return escapesBundle ? null : resolved;
	} catch {
		return null;
	}
}
