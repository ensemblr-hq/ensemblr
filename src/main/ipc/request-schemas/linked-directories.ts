/**
 * Linked-directory IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer payload
 * throws rather than being coerced into a path the service would then stat.
 */
import { z } from 'zod';

/**
 * {@link import('../../../shared/ipc').LinkedDirectoryRequest}. Length-capped
 * well past any real filesystem path so a hostile payload cannot force an
 * unbounded `stat` argument; the service does the absolute-path and
 * is-a-directory checks that actually matter.
 */
export const linkedDirectoryRequestSchema = z.object({
	path: z.string().min(1).max(4096),
});
