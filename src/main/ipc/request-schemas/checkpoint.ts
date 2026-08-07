/**
 * Turn-checkpoint IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)` inside a try/catch, so a
 * malformed renderer payload throws and is reported as a handled error.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').ListTurnCheckpointsRequest}. */
export const listTurnCheckpointsRequestSchema = z.object({
	agentSessionId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ComputeTurnDiffRequest}. */
export const computeTurnDiffRequestSchema = z.object({
	turnId: z.string().min(1),
});

/**
 * {@link import('../../../shared/ipc').RestoreCheckpointRequest}. The literal
 * `confirm: true` enforces the destructive-action acknowledgment server-side.
 */
export const restoreCheckpointRequestSchema = z.object({
	confirm: z.literal(true),
	turnId: z.string().min(1),
});
