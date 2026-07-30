import { describe, expect, test } from 'vitest';

import { getComposerState } from '../../src/renderer/lib/workbench';
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
	chatTabId: 'tab-1',
	id: 'tab-1',
	isSubAgent,
	kind: 'chat',
	label: 'Astro inventory',
	piSessionId: 'pi-1',
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
		activePiSessionId: 'pi-1',
		activeSession: session,
		availableModels: [],
		availableThinkingLevels: [],
		isStreaming: overrides.isStreaming ?? false,
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
	test('disables the composer while a spawned sub-agent is mid-turn', () => {
		const composer = composerStateFor(chatSession(true), {
			isStreaming: true,
		});

		expect(composer.disabled).toBe(true);
		expect(composer.disabledReason).toBe(
			'This sub-agent is working — the conversation that spawned it steers it until the turn ends.',
		);
		expect(composer.placeholder).toBe(
			'Driven by the conversation that spawned it — send follow-ups from there',
		);
	});

	// A sub-agent tab keeps its marker for life, so locking it on the marker alone
	// left a finished conversation nobody could ever reply to — not the user, and
	// not an orchestrator that has since closed or been lost to a restart.
	test('reopens a settled sub-agent tab to the user', () => {
		const composer = composerStateFor(chatSession(true));

		expect(composer.disabled).toBe(false);
		expect(composer.disabledReason).toBeNull();
		expect(composer.placeholder).toBe('Ask Pi to continue astro inventory');
	});

	test('leaves the composer enabled on an ordinary chat tab', () => {
		const composer = composerStateFor(chatSession(false));

		expect(composer.disabled).toBe(false);
		expect(composer.disabledReason).toBeNull();
		expect(composer.placeholder).toBe('Ask Pi to continue astro inventory');
	});

	// A setup blocker is the actionable one: the sub-agent lock lifts on its own
	// when the turn ends, and a broken workspace does not.
	test('reports a setup blocker ahead of the sub-agent lock', () => {
		const composer = composerStateFor(chatSession(true), {
			isStreaming: true,
			setupDiagnostics: null,
			setupError: 'Setup script failed',
		});

		expect(composer.disabledReason).toBe('Setup script failed');
	});
});
