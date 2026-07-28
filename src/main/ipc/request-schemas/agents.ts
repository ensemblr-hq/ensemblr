/**
 * Agent-harness IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)` inside a try/catch, so a
 * malformed renderer payload throws and is reported as a handled error.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc/contracts/agents').LaunchAgentHarnessRequest}. */
export const launchAgentHarnessRequestSchema = z.object({
	harnessId: z.string().min(1),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc/contracts/agents').ResumeAgentHarnessRequest}. */
export const resumeAgentHarnessRequestSchema = z.object({
	chatTabId: z.string().min(1),
	harnessId: z.string().min(1),
	workspaceId: z.string().min(1),
	fresh: z.boolean().optional(),
	sessionId: z.string().min(1).optional(),
});
