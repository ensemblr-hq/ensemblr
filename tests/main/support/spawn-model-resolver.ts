import {
	createSpawnModelResolver,
	type SpawnModelResolver,
} from '../../../src/main/agent-providers';
import type { AgentProviderId } from '../../../src/shared/agent-provider';
import {
	type AgentModelOption,
	asModelVendorId,
} from '../../../src/shared/ipc/contracts/agent-models';

/** Builds one catalog row without repeating the fields no assertion reads. */
export const modelOption = (input: {
	id: string;
	runtime: AgentProviderId;
	vendor?: string;
	thinkingLevels?: readonly string[];
}): AgentModelOption => ({
	agentProvider: input.runtime,
	contextWindow: 200_000,
	displayName: input.id,
	id: input.id,
	thinkingLevels: input.thinkingLevels ?? [],
	vendor: asModelVendorId(input.vendor ?? input.id.split('/')[0] ?? 'other'),
});

/**
 * A real {@link SpawnModelResolver} over a fixed catalog, so a test exercises
 * the shipping resolution rules rather than a stub that agrees with itself.
 * @param models - The catalog rows both runtimes' models are drawn from.
 * @param defaultModelId - What the catalog itself calls default; the first row when omitted.
 * @returns The resolver, wired to a catalog that never shells out.
 */
export function fakeSpawnModelResolver(
	models: readonly AgentModelOption[],
	defaultModelId?: string,
): SpawnModelResolver {
	return createSpawnModelResolver({
		catalog: {
			list: async () => ({
				defaultModelId: defaultModelId ?? models[0]?.id ?? null,
				defaultThinkingLevel: 'medium',
				models,
			}),
			resolveAgentProvider: async (modelId) =>
				models.find((model) => model.id === modelId)?.agentProvider ?? null,
		},
	});
}
