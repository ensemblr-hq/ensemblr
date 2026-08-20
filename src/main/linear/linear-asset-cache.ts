/** How many bytes of Linear asset data the cache holds before evicting. */
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024;

/** One cached asset: its bytes and the content type they were served with. */
export interface CachedLinearAsset {
	body: ArrayBuffer;
	contentType: string;
}

/** Bounded, least-recently-used store of fetched Linear asset bytes. */
export interface LinearAssetCache {
	/** Drops every entry, or only those whose key matches, releasing their bytes. */
	clear: (matches?: (key: string) => boolean) => void;
	get: (key: string) => CachedLinearAsset | null;
	set: (key: string, asset: CachedLinearAsset) => void;
}

/**
 * Builds the byte cache the Linear asset proxy serves repeat reads from.
 *
 * A custom scheme sits outside Chromium's HTTP cache, so every remount of an
 * `<img>` — scrolling a long comment thread, reopening a ticket — would
 * otherwise cost another authenticated round trip to Linear. Eviction is
 * least-recently-used by total bytes rather than by entry count, because a
 * screenshot and a status-dot favicon differ by three orders of magnitude and
 * an entry count would bound neither.
 * @param options - Optional byte ceiling for the whole cache.
 * @returns A fresh {@link LinearAssetCache}.
 */
export function createLinearAssetCache({
	maxBytes = DEFAULT_MAX_BYTES,
}: {
	maxBytes?: number;
} = {}): LinearAssetCache {
	const entries = new Map<string, CachedLinearAsset>();
	let heldBytes = 0;

	/**
	 * Drop the least recently read entries until the cache fits its ceiling.
	 * A `Map` iterates in insertion order and every read reinserts, so the first
	 * key is always the coldest.
	 */
	function evictToFit(): void {
		while (heldBytes > maxBytes) {
			const coldest = entries.keys().next().value;

			if (coldest === undefined) {
				return;
			}

			heldBytes -= entries.get(coldest)?.body.byteLength ?? 0;
			entries.delete(coldest);
		}
	}

	return {
		clear: (matches) => {
			for (const [key, asset] of entries) {
				if (matches && !matches(key)) {
					continue;
				}

				heldBytes -= asset.body.byteLength;
				entries.delete(key);
			}
		},

		get: (key) => {
			const asset = entries.get(key);

			if (!asset) {
				return null;
			}

			entries.delete(key);
			entries.set(key, asset);

			return asset;
		},

		set: (key, asset) => {
			if (asset.body.byteLength > maxBytes) {
				return;
			}

			heldBytes -= entries.get(key)?.body.byteLength ?? 0;
			entries.delete(key);
			entries.set(key, asset);
			heldBytes += asset.body.byteLength;
			evictToFit();
		},
	};
}
