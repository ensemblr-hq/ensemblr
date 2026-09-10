import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import {
	type AgentModelCatalog,
	asModelVendorId,
} from '@/shared/ipc/contracts/agent-models';

/** Mixed native-runtime catalog used by model, role, and delegation settings shots. */
export const DEMO_MODEL_CATALOG: AgentModelCatalog = {
	defaultModelId: 'claude-opus-5',
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'claude',
			contextWindow: 1_000_000,
			displayName: 'Opus 5',
			id: 'claude-opus-5',
			thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
			vendor: asModelVendorId('claude-code'),
		},
		{
			agentProvider: 'claude',
			contextWindow: 200_000,
			displayName: 'Sonnet 5',
			id: 'claude-sonnet-5',
			thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
			vendor: asModelVendorId('claude-code'),
		},
		{
			agentProvider: 'pi',
			contextWindow: null,
			displayName: 'GPT-5.4',
			id: 'openai/gpt-5.4',
			thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
			vendor: asModelVendorId('openai'),
		},
	],
};

/** Full model concern enabling role assignments and cross-runtime delegation. */
export const DEMO_MODEL_ROLE_SETTINGS = {
	...DEFAULT_APP_SETTINGS.models,
	allowCrossRuntimeDelegation: true,
	defaultModel: 'claude-opus-5',
	defaultThinkingLevel: 'medium',
	reviewModel: 'openai/gpt-5.4',
	reviewThinkingLevel: 'high',
	roleAssignments: [
		{
			modelId: 'claude-opus-5',
			roles: ['sage', 'coder'],
			runtime: 'claude',
		},
		{
			modelId: 'openai/gpt-5.4',
			roles: ['builder', 'explorer'],
			runtime: 'pi',
		},
	],
} satisfies typeof DEFAULT_APP_SETTINGS.models;

/** Top-level app settings override enabling model orchestration and gated surfaces. */
export const DEMO_MODEL_ROLE_APP_SETTINGS = {
	experimental: {
		...DEFAULT_APP_SETTINGS.experimental,
		architectureDiagram: true,
		tuiHarnesses: true,
	},
	models: DEMO_MODEL_ROLE_SETTINGS,
} satisfies Partial<typeof DEFAULT_APP_SETTINGS>;
