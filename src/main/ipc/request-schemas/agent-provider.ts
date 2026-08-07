/**
 * Agent-provider IPC request schemas.
 *
 * **Strict:** every channel is parameterized by an `AgentProviderId`, and an
 * unknown id is a rejected request rather than a silent fall back to Pi. The
 * handler surfaces a parse failure as a controlled error response.
 */
import { z } from 'zod';

import { listAgentProviderIds } from '../../../shared/agent-provider.ts';

const [firstProviderId, ...remainingProviderIds] = listAgentProviderIds();

/** Accepts only a registered agent runtime id. */
const agentProviderIdSchema = z.enum([
	firstProviderId,
	...remainingProviderIds,
]);

/** {@link import('../../../shared/ipc').AgentProviderRequest}. */
export const agentProviderRequestSchema = z.object({
	provider: agentProviderIdSchema,
});

/** {@link import('../../../shared/ipc').SetAgentProviderExecutablePathRequest}. */
export const setAgentProviderExecutablePathRequestSchema = z.object({
	path: z.string().min(1),
	provider: agentProviderIdSchema,
});

/** {@link import('../../../shared/ipc').OpenAgentProviderSettingsFileRequest}. */
export const openAgentProviderSettingsFileRequestSchema = z.object({
	provider: agentProviderIdSchema,
	target: z.string().min(1),
});
