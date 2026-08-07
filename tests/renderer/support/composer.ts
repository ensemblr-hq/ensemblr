import { getComposerState } from '../../../src/renderer/lib/workbench';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	SessionTabModel,
} from '../../../src/renderer/types/workbench';
import type { AgentProviderId } from '../../../src/shared/agent-provider';
import type { SetupDiagnosticsSnapshot } from '../../../src/shared/ipc/contracts/setup';

const READY_SETUP: SetupDiagnosticsSnapshot = {
	blockedCount: 0,
	checks: [],
	generatedAt: '2026-08-07T00:00:00.000Z',
	optionalCount: 0,
	requiredCount: 0,
	status: 'ready',
	successCount: 0,
	warningCount: 0,
};

const SUB_AGENT_SESSION: SessionTabModel = {
	agentSessionId: 'agent-1',
	chatTabId: 'tab-1',
	id: 'tab-1',
	isPreview: false,
	isSubAgent: true,
	kind: 'chat',
	label: 'Astro inventory',
	status: 'idle',
	summary: '',
	updatedLabel: 'Astro inventory',
};

/**
 * Builds a real `ComposerShellState` through `getComposerState`, so fixtures
 * carry the derived fields (`modelLabel`, `thinkingLabel`, `disabled`) the
 * production path would compute rather than a hand-written partial. The default
 * session is a sub-agent's because that is the composer-less case most of these
 * fixtures exercise; override `activeSession` for anything else, since
 * `getComposerState` derives the placeholder from its label.
 */
export function createComposerShellState(
	overrides: {
		activeAgentSessionId?: string | null;
		activeSession?: SessionTabModel;
		availableModels?: readonly ComposerModelOption[];
		availableThinkingLevels?: readonly ComposerThinkingOption[];
		contextUsage?: ComposerContextUsage | null;
		lockedProvider?: AgentProviderId | null;
		modelId?: string | null;
		thinkingLevel?: string | null;
	} = {},
): ComposerShellState {
	return getComposerState({
		activeAgentSessionId:
			overrides.activeAgentSessionId === undefined
				? 'agent-1'
				: overrides.activeAgentSessionId,
		activeSession: overrides.activeSession ?? SUB_AGENT_SESSION,
		availableModels: overrides.availableModels ?? [],
		availableThinkingLevels: overrides.availableThinkingLevels ?? [],
		contextUsage: overrides.contextUsage ?? null,
		isStreaming: false,
		lockedProvider: overrides.lockedProvider ?? null,
		modelId: overrides.modelId ?? null,
		onModelChange: () => undefined,
		onPlanModeChange: () => undefined,
		onStop: () => undefined,
		onSubmit: () => undefined,
		onThinkingChange: () => undefined,
		planMode: false,
		setupDiagnostics: READY_SETUP,
		setupError: null,
		thinkingLevel: overrides.thinkingLevel ?? null,
	});
}
