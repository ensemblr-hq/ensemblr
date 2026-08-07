import { describe, expect, test } from 'vitest';

import {
	getComposerState,
	showsComposer,
} from '../../src/renderer/lib/workbench';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import type { SetupDiagnosticsSnapshot } from '../../src/shared/ipc/contracts/setup';

const readySetup: SetupDiagnosticsSnapshot = {
	blockedCount: 0,
	checks: [],
	generatedAt: '2026-07-30T00:00:00.000Z',
	optionalCount: 0,
	requiredCount: 0,
	status: 'ready',
	successCount: 0,
	warningCount: 0,
};

const chatSession = (isSubAgent: boolean): SessionTabModel => ({
	agentSessionId: 'agent-1',
	chatTabId: 'tab-1',
	id: 'tab-1',
	isPreview: false,
	isSubAgent,
	kind: 'chat',
	label: 'Astro inventory',
	status: 'idle',
	summary: '',
	updatedLabel: 'Astro inventory',
});

const composerStateFor = (
	session: SessionTabModel,
	overrides: {
		isStreaming?: boolean;
		setupDiagnostics?: SetupDiagnosticsSnapshot | null;
		setupError?: string | null;
	} = {},
) =>
	getComposerState({
		activeAgentSessionId: 'agent-1',
		activeSession: session,
		availableModels: [],
		availableThinkingLevels: [],
		isStreaming: overrides.isStreaming ?? false,
		lockedProvider: null,
		modelId: 'gpt-5.5',
		onModelChange: () => undefined,
		onPlanModeChange: () => undefined,
		onStop: () => undefined,
		onSubmit: () => undefined,
		onThinkingChange: () => undefined,
		planMode: false,
		setupDiagnostics:
			overrides.setupDiagnostics === undefined
				? readySetup
				: overrides.setupDiagnostics,
		setupError: overrides.setupError ?? null,
		thinkingLevel: 'high',
	});

describe('sub-agent composer', () => {
	// The tab belongs to the orchestrator that spawned it for the whole life of
	// the conversation, so there is no state in which typing here is the right
	// move — a disabled composer only advertised an affordance that never unlocks.
	test('withholds the composer from a spawned sub-agent tab', () => {
		expect(showsComposer(chatSession(true))).toBe(false);
	});

	test('gives an ordinary chat tab a composer', () => {
		expect(showsComposer(chatSession(false))).toBe(true);
	});

	test('leaves the composer enabled on an ordinary chat tab', () => {
		const composer = composerStateFor(chatSession(false));

		expect(composer.disabled).toBe(false);
		expect(composer.disabledReason).toBeNull();
		expect(composer.placeholder).toBe(
			'Ask the agent to continue astro inventory',
		);
	});

	test('disables an ordinary chat tab’s composer on a setup blocker', () => {
		const composer = composerStateFor(chatSession(false), {
			setupDiagnostics: null,
			setupError: 'Setup script failed',
		});

		expect(composer.disabled).toBe(true);
		expect(composer.disabledReason).toBe('Setup script failed');
	});
});
