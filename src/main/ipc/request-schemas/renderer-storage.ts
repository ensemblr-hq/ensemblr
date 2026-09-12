/**
 * Renderer-storage mirror request schema.
 *
 * **Lenient:** the handler calls `schema.safeParse(raw)` and answers a
 * malformed payload with a `skipped` envelope, because the mirror is a
 * background copy — failing it must never surface as a rejected IPC call in the
 * middle of the renderer's own work.
 */
import { z } from 'zod';

/**
 * Ceiling on one mirrored snapshot, measured over its JSON encoding.
 *
 * Deliberately *below* the ~5 MB an origin's `localStorage` holds rather than
 * above it: whatever is accepted here has to be replayable into a target origin
 * later, and a mirror too large to fit would fail partway through the seed. The
 * JSON encoding is longer than the raw characters it wraps, so this leaves room
 * for the escaping as well. A payload past it is not a user's preferences — it
 * is a renderer that has been made to push arbitrary bytes into the database.
 */
export const MAX_RENDERER_STORAGE_MIRROR_BYTES = 4 * 1024 * 1024;

/** {@link import('../../../shared/ipc/contracts/renderer-storage').RendererStorageSnapshot}. */
export const rendererStorageSnapshotSchema = z.object({
	entries: z.record(z.string(), z.string()),
});
