/**
 * Architecture-diagram IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)` inside a try/catch, so a
 * malformed renderer payload comes back as a typed failure envelope rather
 * than as an unhandled IPC rejection.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').GetArchitectureSnapshotRequest}. */
export const getArchitectureSnapshotRequestSchema = z.object({
	workspaceId: z.string().min(1),
});
