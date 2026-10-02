/**
 * Addressing for the images Linear embeds in issue descriptions and comments.
 *
 * Linear keeps those files in private storage behind `uploads.linear.app`, which
 * answers 401 to an anonymous request. The renderer holds no Linear credential —
 * the OAuth token lives in the macOS Keychain behind the main process — so an
 * `<img>` pointed straight at that host can never load the bytes. The API does
 * not hand out a bare URL either: it rewrites every one with a `?signature=` JWT
 * that expires 300 seconds later, which the five-minute issue cache reliably
 * outlives.
 *
 * Both halves of the fix meet in this module, which is why it is shared rather
 * than owned by one process. Main strips the signature on the way out, so
 * nothing crossing to the renderer or into an agent's context carries a
 * credential that is already dead. The renderer points each image at the
 * `ensemblr-linear-asset:` scheme instead, naming the account the asset belongs
 * to, and the main-process protocol handler resolves it with that account's
 * bearer token — a request that has no expiry to race.
 */

/** Host Linear serves uploaded issue attachments and images from. */
const LINEAR_UPLOADS_HOST = 'uploads.linear.app';

/** Origin every canonical Linear asset URL is pinned to. */
const LINEAR_UPLOADS_ORIGIN = `https://${LINEAR_UPLOADS_HOST}`;

/** Custom scheme the main process serves authenticated Linear assets over. */
export const LINEAR_ASSET_SCHEME = 'ensemblr-linear-asset';

/** The account an asset belongs to, and the upstream URL its bytes live at. */
export interface LinearAssetTarget {
	accountId: string;
	assetUrl: string;
}

/**
 * A Linear asset URL wherever it appears in markdown. The character class stops
 * at whatever ends a URL in prose or in a markdown destination — whitespace, a
 * closing paren or bracket, an angle bracket, a quote.
 */
const ASSET_URL = /https:\/\/uploads\.linear\.app\/[^\s)<>"'\]]+/g;

/**
 * A Linear asset URL in the destination of a markdown image, captured as its
 * `![alt](` opener plus the URL. Only images are rewritten onto the proxy
 * scheme, because the proxy answers Chromium rather than the OS: an ordinary
 * link to an attachment opens in the user's browser, which cannot resolve a
 * scheme only this app serves, so it keeps its `https:` URL. That URL is
 * unsigned by the time it gets here, so whether it resolves depends on the
 * browser carrying its own Linear session — not measured, and the reason an
 * attachment link is not claimed to work here.
 */
const MARKDOWN_IMAGE_ASSET =
	/(!\[[^\]]*\]\(\s*<?)(https:\/\/uploads\.linear\.app\/[^\s)<>"']+)/g;

/** One path segment of an asset URL, as Linear composes them. */
const ASSET_PATH_SEGMENT = /^[A-Za-z0-9._~%-]+$/;

/** Shape of the account id the proxy scheme carries as its host. */
const ACCOUNT_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Trailing prose punctuation a bare URL in a sentence collects. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Rewrite every Linear asset URL in markdown to its canonical, unsigned form.
 * Main calls this on the way to the renderer and to agents, so a short-lived
 * signature neither crosses the process boundary nor outlives its 300 seconds
 * in something a reader is still looking at.
 * @param markdown - Issue description or comment body, if any.
 * @returns The same markdown with every asset signature dropped.
 */
export function stripLinearAssetSignatures(markdown: string): string;
export function stripLinearAssetSignatures(
	markdown: string | null,
): string | null;
export function stripLinearAssetSignatures(
	markdown: string | null,
): string | null {
	if (!markdown) {
		return markdown;
	}

	return markdown.replace(ASSET_URL, (match) => {
		const trailing = match.match(TRAILING_PUNCTUATION)?.[0] ?? '';
		const url = match.slice(0, match.length - trailing.length);
		const canonical = canonicalAssetUrl(url);

		return canonical ? `${canonical}${trailing}` : match;
	});
}

/**
 * Point every embedded Linear image at the authenticated proxy scheme. The
 * renderer calls this on markdown it is about to render, because the account is
 * what tells the main process which token to resolve the asset with.
 * @param markdown - Issue description or comment body.
 * @param accountId - Linear account the markdown was read through.
 * @returns The markdown with each image destination on the proxy scheme.
 */
export function proxyLinearAssetImages(
	markdown: string,
	accountId: string,
): string {
	if (!ACCOUNT_ID.test(accountId)) {
		return markdown;
	}

	return markdown.replace(
		MARKDOWN_IMAGE_ASSET,
		(match, opener: string, rawUrl: string) => {
			const canonical = canonicalAssetUrl(rawUrl);

			if (!canonical) {
				return match;
			}

			return `${opener}${LINEAR_ASSET_SCHEME}://${accountId}${new URL(canonical).pathname}`;
		},
	);
}

/**
 * Resolve a proxy-scheme URL back to the account and upstream asset it stands
 * for. The upstream origin is pinned rather than read from the request, so a
 * crafted URL cannot steer the authenticated fetch at another host.
 * @param url - URL the protocol handler was asked for.
 * @returns The asset target, or null when the URL is not one this scheme serves.
 */
export function parseLinearAssetUrl(url: string): LinearAssetTarget | null {
	const parsed = parseUrl(url);

	if (parsed?.protocol !== `${LINEAR_ASSET_SCHEME}:`) {
		return null;
	}

	const accountId = parsed.hostname;

	if (!ACCOUNT_ID.test(accountId)) {
		return null;
	}

	const assetUrl = canonicalAssetUrl(
		`${LINEAR_UPLOADS_ORIGIN}${parsed.pathname}`,
	);

	return assetUrl ? { accountId, assetUrl } : null;
}

/**
 * Reduce a Linear asset URL to origin plus path, rejecting anything that is not
 * one. Dropping the query is what removes the signature; pinning the origin and
 * vetting each segment is what keeps a hostile URL out of the authenticated
 * fetch.
 * @param rawUrl - Candidate URL from markdown or from a proxy request.
 * @returns The canonical unsigned URL, or null when it is not a Linear asset.
 */
function canonicalAssetUrl(rawUrl: string): string | null {
	const parsed = parseUrl(rawUrl);

	if (parsed?.protocol !== 'https:' || parsed.host !== LINEAR_UPLOADS_HOST) {
		return null;
	}

	const segments = parsed.pathname.split('/').filter(Boolean);
	const isServable =
		segments.length > 0 &&
		segments.every((segment) => ASSET_PATH_SEGMENT.test(segment));

	return isServable ? `${LINEAR_UPLOADS_ORIGIN}/${segments.join('/')}` : null;
}

/**
 * Parse a URL without throwing on the malformed strings markdown produces.
 * @param rawUrl - Candidate URL.
 * @returns The parsed URL, or null when it is not one.
 */
function parseUrl(rawUrl: string): URL | null {
	try {
		return new URL(rawUrl);
	} catch {
		return null;
	}
}
