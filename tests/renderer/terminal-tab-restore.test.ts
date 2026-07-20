// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RestoreTerminalTabDeps } from '../../src/renderer/state/workspace/terminal-tab-restore';
import { resumeRestoredTerminalTab } from '../../src/renderer/state/workspace/terminal-tab-restore';
import type { LaunchAgentHarnessResult } from '../../src/shared/ipc/contracts/agents';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

/**
 * Builds a restored terminal (harness) tab wire row carrying the given metadata.
 * @param metadata - Harness metadata (harnessId, agentSessionId).
 * @returns A minimal terminal `ChatTabWire`.
 */
function terminalTab(metadata: Record<string, unknown>): ChatTabWire {
	return {
		closedAt: null,
		id: 'tab-1',
		kind: 'terminal',
		metadata,
		openedAt: '2026-07-20T10:00:00.000Z',
		piSessionId: null,
		position: 0,
		title: 'Claude Code',
		workspaceId: 'ws-1',
	};
}

/**
 * Assembles the restore collaborators with spy stubs, defaulting `sessionTabs`
 * to empty so no already-open conversation is detected.
 * @param overrides - Partial deps to override the spy defaults.
 * @returns The deps object plus references to the spies for assertion.
 */
function makeDeps(overrides: Partial<RestoreTerminalTabDeps> = {}) {
	const deps: RestoreTerminalTabDeps = {
		claimTab: vi.fn(),
		closeTab: vi.fn(async () => undefined),
		invalidate: vi.fn(),
		releaseTab: vi.fn(),
		selectTab: vi.fn(),
		sessionTabs: [],
		workspaceId: 'ws-1',
		...overrides,
	};
	return deps;
}

const OK_RESULT: LaunchAgentHarnessResult = {
	diagnostics: [],
	session: { agentSessionId: null } as LaunchAgentHarnessResult['session'],
};

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('resumeRestoredTerminalTab', () => {
	test('reattaches the exact conversation when a session id was captured', () => {
		const resumeAgentHarness = vi.fn(async () => OK_RESULT);
		installEnsemblrApi({ resumeAgentHarness });
		const deps = makeDeps();

		resumeRestoredTerminalTab(
			terminalTab({ agentSessionId: 'claude-abc', harnessId: 'claude' }),
			deps,
		);

		expect(resumeAgentHarness).toHaveBeenCalledWith({
			chatTabId: 'tab-1',
			fresh: false,
			harnessId: 'claude',
			sessionId: 'claude-abc',
			workspaceId: 'ws-1',
		});
	});

	test('spawns fresh (never an unguarded cwd resume) when no session id exists', () => {
		const resumeAgentHarness = vi.fn(async () => OK_RESULT);
		installEnsemblrApi({ resumeAgentHarness });
		const deps = makeDeps();

		resumeRestoredTerminalTab(terminalTab({ harnessId: 'claude' }), deps);

		expect(resumeAgentHarness).toHaveBeenCalledWith({
			chatTabId: 'tab-1',
			fresh: true,
			harnessId: 'claude',
			sessionId: undefined,
			workspaceId: 'ws-1',
		});
	});

	test('focuses an already-open conversation instead of respawning it', () => {
		const resumeAgentHarness = vi.fn(async () => OK_RESULT);
		installEnsemblrApi({ resumeAgentHarness });
		const deps = makeDeps({
			sessionTabs: [
				{
					agentSessionId: 'claude-abc',
					chatTabId: 'tab-open',
					harnessId: 'claude',
					harnessLabel: 'Claude Code',
					id: 'tab-open',
					kind: 'terminal',
					label: 'Claude Code',
					status: 'idle',
					terminalId: 'pty-live',
				},
			],
		});

		resumeRestoredTerminalTab(
			terminalTab({ agentSessionId: 'claude-abc', harnessId: 'claude' }),
			deps,
		);

		expect(resumeAgentHarness).not.toHaveBeenCalled();
		expect(deps.closeTab).toHaveBeenCalledWith('tab-1');
		expect(deps.selectTab).toHaveBeenCalledWith('tab-open');
	});
});
