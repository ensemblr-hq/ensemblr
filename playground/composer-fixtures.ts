import { useMemo } from 'react';

import type {
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { asModelVendorId } from '@/shared/ipc/contracts/agent-models';

const WORKSPACE_CWD = '/Users/you/Projects/ensemblr';

/**
 * Two runtimes' models in one catalog, so the picker's provider pin has
 * something to lock out. `provider` is the inference provider the picker groups
 * by; `agentProvider` is the runtime the pin compares against.
 */
const MODELS: readonly ComposerModelOption[] = [
	{
		agentProvider: 'pi',
		contextWindow: 1_000_000,
		displayName: 'Opus 5',
		id: 'claude-opus-5',
		isDefault: true,
		vendor: asModelVendorId('anthropic'),
	},
	{
		agentProvider: 'pi',
		contextWindow: 1_000_000,
		displayName: 'Sonnet 5',
		id: 'claude-sonnet-5',
		vendor: asModelVendorId('anthropic'),
	},
	{
		agentProvider: 'claude',
		contextWindow: 200_000,
		displayName: 'Claude Code — Opus 5',
		id: 'claude-code/opus-5',
		vendor: asModelVendorId('claude-code'),
	},
	{
		agentProvider: 'claude',
		contextWindow: 200_000,
		displayName: 'Claude Code — Sonnet 5',
		id: 'claude-code/sonnet-5',
		vendor: asModelVendorId('claude-code'),
	},
];

const THINKING_LEVELS: readonly ComposerThinkingOption[] = [
	{ id: 'off', label: 'Off' },
	{ id: 'think', label: 'Think' },
	{ id: 'ultrathink', label: 'Ultrathink' },
];

/**
 * Enough of a file tree for the `@` mention picker to have something to match,
 * without pulling the app's own fixture list into a scene that only needs the
 * popover to open.
 */
const WORKSPACE_FILES: readonly WorkspaceFileSummary[] = [
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{
		id: 'file-composer-panel',
		kind: 'file',
		name: 'composer-panel.tsx',
		path: 'src/renderer/components/workbench-shell/conversation-panel/composer-panel.tsx',
	},
	{
		id: 'file-plan-review-panel',
		kind: 'file',
		name: 'plan-review-panel.tsx',
		path: 'src/renderer/components/workbench-shell/conversation-panel/plan-review-panel.tsx',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];

/**
 * Builds the `ComposerShellState` the panel reads. Every callback is inert
 * except plan mode, which a scene owns so the chip and the dashed border stay in
 * step with whatever drives them. Shared by both composer scenes so the surface
 * under review is identical in each.
 * @param input - The inputs a scene varies, plus the plan-mode setter.
 * @returns A composer state fixture wired to the scene's plan-mode toggle.
 */
export function useComposerStub({
	disabled = false,
	isStreaming,
	lockedProvider,
	onPlanModeChange,
	planMode,
}: {
	disabled?: boolean;
	isStreaming: boolean;
	lockedProvider: AgentProviderId | null;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
}): ComposerShellState {
	return useMemo(
		() => ({
			activeAgentSessionId: 'playground-session',
			availableModels: MODELS,
			availableThinkingLevels: THINKING_LEVELS,
			contextUsage: { maxTokens: 200_000, usedTokens: 48_000 },
			disabled,
			disabledReason: null,
			isStreaming,
			lockedProvider,
			modelId: MODELS[0].id,
			modelLabel: MODELS[0].displayName,
			onModelChange: () => undefined,
			onPlanModeChange: (next: boolean) => onPlanModeChange?.(next),
			onStop: () => undefined,
			onSubmit: () => Promise.resolve({}),
			onThinkingChange: () => undefined,
			placeholder: '',
			planMode,
			planUsage: {
				limits: [
					{
						displayName: null,
						id: 'five_hour',
						resetsAt: '2026-08-15T21:00:00.000Z',
						utilization: 47,
					},
					{
						displayName: null,
						id: 'seven_day',
						resetsAt: '2026-08-19T09:00:00.000Z',
						utilization: 73,
					},
				],
				status: 'allowed',
				totalCostUsd: 1.284,
			},
			thinkingLabel: 'Think',
			thinkingLevel: 'think',
			workspaceCwd: WORKSPACE_CWD,
			workspaceFiles: WORKSPACE_FILES,
		}),
		[disabled, isStreaming, lockedProvider, onPlanModeChange, planMode],
	);
}
