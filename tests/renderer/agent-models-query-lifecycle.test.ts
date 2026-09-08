// @vitest-environment happy-dom

import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { agentModelsQuery } from '@/renderer/api/ensemblr';
import { writeCachedAgentModels } from '@/renderer/api/ensemblr/agent-models-cache';
import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '@/shared/ipc/contracts/agent-models';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

/** Builds a model catalog from provider/model IDs. */
function catalog(ids: readonly string[]): AgentModelCatalog {
	return {
		defaultModelId: ids[0] ?? null,
		defaultThinkingLevel: ids.length > 0 ? 'medium' : null,
		models: ids.map((id) => ({
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: id,
			id,
			thinkingLevels: ['off', 'medium', 'high'],
			vendor: asModelVendorId(id.split('/')[0] ?? 'other'),
		})),
	};
}

const CACHED = catalog(['anthropic/opus', 'openai-codex/sol']);
const REDUCED = catalog(['anthropic/opus']);

afterEach(() => {
	clearEnsemblrApi();
});

describe('agentModelsQuery lifecycle', () => {
	test('requires two fresh provider-reduction observations after reset', async () => {
		writeCachedAgentModels(CACHED);
		installEnsemblrApi({
			listAgentModels: vi.fn().mockResolvedValue(REDUCED),
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const query = { ...agentModelsQuery, staleTime: 0 };

		expect((await client.fetchQuery(query)).models).toEqual(CACHED.models);
		await client.resetQueries({ queryKey: agentModelsQuery.queryKey });

		expect((await client.fetchQuery(query)).models).toEqual(CACHED.models);
		expect((await client.fetchQuery(query)).models).toEqual(REDUCED.models);
	});
});
