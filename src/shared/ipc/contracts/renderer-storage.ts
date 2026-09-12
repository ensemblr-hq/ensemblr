/**
 * The renderer's whole `localStorage`, as a flat string-to-string map. Carried
 * in both directions: the renderer mirrors it into the main process on every
 * change, and the preload bootstrap reads it back when the document's origin
 * has moved and its own storage is therefore empty.
 */
export interface RendererStorageSnapshot {
	entries: Record<string, string>;
}

/**
 * What the main process did with a mirror write. `skipped` is not an error the
 * renderer can act on — it names why the copy is stale so a support bundle says
 * so rather than showing a silently missing mirror.
 *
 * Two of them protect data rather than describe a fault. `seed-not-applied`
 * means main handed this renderer a seed and the snapshot that came back does
 * not carry it, so the renderer's storage is not the storage the seed landed
 * in. `empty-snapshot` means a renderer with nothing in its storage would have
 * replaced a mirror that holds something — which is what a renderer that never
 * received its seed looks like. Either way the older copy is kept, because it
 * may be the only copy of the user's preferences left.
 *
 * `unknown-origin` means main could not tell which origin the snapshot came
 * from. The mirror is keyed by origin in both directions, so a snapshot that
 * cannot be attributed is refused rather than filed under a guess.
 */
export type RendererStorageMirrorResult =
	| { status: 'stored' }
	| {
			status: 'skipped';
			reason:
				| 'database-unavailable'
				| 'empty-snapshot'
				| 'malformed'
				| 'seed-not-applied'
				| 'too-large'
				| 'unknown-origin';
	  };

/** Renderer-facing surface of the `localStorage` mirror. */
export interface RendererStorageApi {
	/**
	 * Replaces the mirrored copy of this renderer's `localStorage` with the
	 * snapshot given.
	 */
	mirrorRendererStorage: (
		request: RendererStorageSnapshot,
	) => Promise<RendererStorageMirrorResult>;
}
