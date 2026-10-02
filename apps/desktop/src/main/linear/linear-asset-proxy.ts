import {
	type LinearAssetTarget,
	parseLinearAssetUrl,
} from '../../shared/linear-assets.ts';
import {
	type CachedLinearAsset,
	createLinearAssetCache,
	type LinearAssetCache,
} from './linear-asset-cache.ts';

/** How long one asset fetch may run before it is abandoned. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** Largest asset the cache will hold; anything bigger is served but not kept. */
const DEFAULT_MAX_CACHED_ASSET_BYTES = 8 * 1024 * 1024;

/** Largest asset the proxy will read into memory at all. */
const DEFAULT_MAX_ASSET_BYTES = 32 * 1024 * 1024;

/** How long the renderer may reuse a served asset without asking again. */
const ASSET_MAX_AGE_SECONDS = 3600;

/**
 * Headers every served asset carries. The scheme is registered as secure and
 * standard, so a response is a real origin as far as Chromium is concerned:
 * refusing to sniff the type and denying every subresource keeps an asset from
 * becoming a document that can load anything.
 */
const RESPONSE_HARDENING = {
	'cache-control': `private, max-age=${ASSET_MAX_AGE_SECONDS}`,
	'content-security-policy': "default-src 'none'",
	'x-content-type-options': 'nosniff',
} as const;

/** Resolves Linear asset requests from the renderer against Linear's storage. */
export interface LinearAssetProxy {
	fetch: (url: string) => Promise<Response>;
	/** Releases everything held for an account, for when it is disconnected. */
	forgetAccount: (accountId: string) => void;
}

/** Options for {@link createLinearAssetProxy}. */
export interface CreateLinearAssetProxyOptions {
	cache?: LinearAssetCache;
	fetchImpl?: typeof fetch;
	getAccessToken: (accountId: string) => Promise<string>;
	listAccountIds: () => Promise<string[]>;
	maxAssetBytes?: number;
	maxCachedAssetBytes?: number;
	requestTimeoutMs?: number;
}

/**
 * Builds the handler behind the `ensemblr-linear-asset:` scheme: it resolves an
 * asset URL with the owning account's bearer token and hands the bytes back to
 * the renderer.
 *
 * The renderer is the wrong place to hold a Linear credential, so an embedded
 * screenshot cannot be a header an `<img>` grows — the fetch has to happen here,
 * where the token already is. Requesting the asset with `Authorization` rather
 * than with Linear's 300-second signature is also what makes a ticket left open
 * keep its images: a bearer token has no window to fall out of.
 *
 * Only `image/*` is served, and only up to `maxAssetBytes`. Linear's storage
 * holds every attachment a ticket ever took, and this scheme is privileged;
 * serving an arbitrary content type from it would turn any uploaded file into a
 * document on a secure origin, and reading one unbounded would let a ticket's
 * largest upload decide how much memory the app holds.
 * @param options - Token source, account allow-list, and optional fetch/cache overrides.
 * @returns A fresh {@link LinearAssetProxy}.
 */
export function createLinearAssetProxy({
	cache = createLinearAssetCache(),
	fetchImpl = fetch,
	getAccessToken,
	listAccountIds,
	maxAssetBytes = DEFAULT_MAX_ASSET_BYTES,
	maxCachedAssetBytes = DEFAULT_MAX_CACHED_ASSET_BYTES,
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: CreateLinearAssetProxyOptions): LinearAssetProxy {
	const inFlight = new Map<string, Promise<CachedLinearAsset | number>>();

	/**
	 * Resolve the request's account against the accounts actually connected, so
	 * the token lookup is driven by the app's own state rather than by the URL.
	 * @param accountId - Account id carried by the proxy URL.
	 * @returns The connected account's own id, or null when none matches.
	 */
	async function connectedAccountId(accountId: string): Promise<string | null> {
		const wanted = accountId.toLowerCase();

		return (
			(await listAccountIds()).find((id) => id.toLowerCase() === wanted) ?? null
		);
	}

	/**
	 * Fetch one asset from Linear with the account's bearer token.
	 * @param target - Account and upstream URL to read.
	 * @returns The asset bytes, or the HTTP status the failure should report.
	 */
	async function readAsset(
		target: LinearAssetTarget,
	): Promise<CachedLinearAsset | number> {
		let accessToken: string;

		try {
			accessToken = await getAccessToken(target.accountId);
		} catch {
			return 401;
		}

		let response: Response;

		try {
			response = await fetchImpl(target.assetUrl, {
				headers: { authorization: `Bearer ${accessToken}` },
				signal: AbortSignal.timeout(requestTimeoutMs),
			});
		} catch {
			return 502;
		}

		if (!response.ok) {
			return response.status;
		}

		const contentType = response.headers.get('content-type') ?? '';

		if (!contentType.toLowerCase().startsWith('image/')) {
			return 415;
		}

		if (Number(response.headers.get('content-length')) > maxAssetBytes) {
			return 413;
		}

		try {
			const body = await response.arrayBuffer();

			return body.byteLength > maxAssetBytes ? 413 : { body, contentType };
		} catch {
			return 502;
		}
	}

	/**
	 * Read an asset once however many `<img>` elements ask for it at the same
	 * time, and remember the bytes for the next one that does. The identity check
	 * before each write is what lets a disconnect drop an in-flight read: a
	 * forgotten read finds itself replaced and neither caches nor evicts.
	 * @param target - Account and upstream URL to read.
	 * @returns The asset bytes, or the HTTP status the failure should report.
	 */
	function loadAsset(
		target: LinearAssetTarget,
	): Promise<CachedLinearAsset | number> {
		const key = `${target.accountId}:${target.assetUrl}`;
		const cached = cache.get(key);

		if (cached) {
			return Promise.resolve(cached);
		}

		const running = inFlight.get(key);

		if (running) {
			return running;
		}

		const started: Promise<CachedLinearAsset | number> = readAsset(target)
			.then((result) => {
				if (
					inFlight.get(key) === started &&
					typeof result !== 'number' &&
					result.body.byteLength <= maxCachedAssetBytes
				) {
					cache.set(key, result);
				}

				return result;
			})
			.finally(() => {
				if (inFlight.get(key) === started) {
					inFlight.delete(key);
				}
			});

		inFlight.set(key, started);

		return started;
	}

	return {
		fetch: async (url) => {
			const requested = parseLinearAssetUrl(url);

			if (!requested) {
				return new Response(null, { status: 400 });
			}

			const accountId = await connectedAccountId(requested.accountId);

			if (!accountId) {
				return new Response(null, { status: 404 });
			}

			const result = await loadAsset({
				accountId,
				assetUrl: requested.assetUrl,
			});

			if (typeof result === 'number') {
				return new Response(null, { status: result });
			}

			return new Response(result.body, {
				headers: { ...RESPONSE_HARDENING, 'content-type': result.contentType },
				status: 200,
			});
		},

		forgetAccount: (accountId) => {
			const held = `${accountId}:`;

			for (const key of inFlight.keys()) {
				if (key.startsWith(held)) {
					inFlight.delete(key);
				}
			}

			cache.clear((key) => key.startsWith(held));
		},
	};
}
