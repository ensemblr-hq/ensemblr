import { describe, expect, test } from 'vitest';

import { createAgentModelCatalog } from '../../src/main/agent-providers/agent-model-catalog.ts';
import type { LocalCommandService } from '../../src/main/commands/local-command';
import type { PiExecutableService } from '../../src/main/pi-runtime';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import {
	type AgentModelOption,
	asModelVendorId,
} from '../../src/shared/ipc/contracts/agent-models.ts';

const PI_TABLE = `provider   model              context
anthropic  claude-sonnet-4    200K
`;

/**
 * The prose pi prints instead of a table when the machine has pi installed but
 * no provider configured — the case the catalog has to read as "pi has nothing
 * to offer" rather than as a model called `No/models`.
 */
const PI_NO_MODELS_PROSE = `No models available. Use /login to log into a provider via OAuth or API key. See:
  /usr/local/lib/pi/docs/providers.md
`;

const CLAUDE_MODELS: readonly AgentModelOption[] = [
	{
		agentProvider: 'claude',
		contextWindow: 1_000_000,
		displayName: 'Opus 5',
		id: 'opus[1m]',
		thinkingLevels: ['low', 'medium', 'high'],
		vendor: asModelVendorId('claude-code'),
	},
	{
		agentProvider: 'claude',
		contextWindow: null,
		displayName: 'Haiku 4.5',
		id: 'haiku',
		thinkingLevels: ['low', 'medium'],
		vendor: asModelVendorId('claude-code'),
	},
];

function createReadyExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-08-30T00:00:00.000Z',
	};
}

function createCatalog(stdout: string, claudeModels = CLAUDE_MODELS) {
	const localCommandService = {
		run: async () => ({
			durationMs: 1,
			exitCode: 0,
			failure: null,
			signal: null,
			status: 'success' as const,
			stderr: '',
			stdout,
			stdoutTruncated: false,
		}),
	} as unknown as LocalCommandService;

	return createAgentModelCatalog({
		listClaudeModels: async () => claudeModels,
		localCommandService,
		piExecutableService: {
			getSnapshot: async () => createReadyExecutable(),
		} as unknown as PiExecutableService,
	});
}

describe('agent model catalog', () => {
	test('offers no pi model when pi lists none', async () => {
		const result = await createCatalog(PI_NO_MODELS_PROSE).list();

		expect(
			result.models.every((model) => model.agentProvider === 'claude'),
		).toBe(true);
		expect(result.models.map((model) => model.id)).toEqual([
			'opus[1m]',
			'haiku',
		]);
	});

	test('defaults to the first Claude model when pi contributes none', async () => {
		const result = await createCatalog(PI_NO_MODELS_PROSE).list();

		expect(result.defaultModelId).toBe('opus[1m]');
		expect(result.defaultThinkingLevel).toBe('medium');
	});

	test('defaults to the most capable rung a Claude-defaulted model publishes', async () => {
		const result = await createCatalog(PI_NO_MODELS_PROSE, [
			{
				agentProvider: 'claude',
				contextWindow: null,
				displayName: 'Terse',
				id: 'terse',
				thinkingLevels: ['off', 'low'],
				vendor: asModelVendorId('claude-code'),
			},
		]).list();

		expect(result.defaultThinkingLevel).toBe('low');
	});

	test('leaves the catalog empty when neither runtime lists a model', async () => {
		const result = await createCatalog(PI_NO_MODELS_PROSE, []).list();

		expect(result.models).toEqual([]);
		expect(result.defaultModelId).toBeNull();
		expect(result.defaultThinkingLevel).toBeNull();
	});

	test("keeps pi's own default when pi lists models", async () => {
		const result = await createCatalog(PI_TABLE).list();

		expect(result.defaultModelId).toBe('anthropic/claude-sonnet-4');
		expect(result.defaultThinkingLevel).toBe('medium');
		expect(result.models.map((model) => model.id)).toEqual([
			'anthropic/claude-sonnet-4',
			'opus[1m]',
			'haiku',
		]);
	});

	test('resolves a Claude model to its runtime with pi contributing nothing', async () => {
		const catalog = createCatalog(PI_NO_MODELS_PROSE);

		expect(await catalog.resolveAgentProvider('opus[1m]')).toBe('claude');
		expect(await catalog.resolveAgentProvider('No/models')).toBeNull();
	});
});
