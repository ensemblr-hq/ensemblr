// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RestoreTerminalTabDeps } from '../../src/renderer/state/workspace/terminal-tab-restore';
import {
	findDuplicateTerminalTabIds,
	isLiveTerminalTab,
	resumeRestoredTerminalTab,
} from '../../src/renderer/state/workspace/terminal-tab-restore';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
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

	test('reattaches the most recent cwd conversation when no session id exists', () => {
		const resumeAgentHarness = vi.fn(async () => OK_RESULT);
		installEnsemblrApi({ resumeAgentHarness });
		const deps = makeDeps();

		resumeRestoredTerminalTab(terminalTab({ harnessId: 'claude' }), deps);

		expect(resumeAgentHarness).toHaveBeenCalledWith({
			chatTabId: 'tab-1',
			fresh: false,
			harnessId: 'claude',
			sessionId: undefined,
			workspaceId: 'ws-1',
		});
	});

	test('spawns fresh with no id when a same-harness tab is already live', () => {
		const resumeAgentHarness = vi.fn(async () => OK_RESULT);
		installEnsemblrApi({ resumeAgentHarness });
		const deps = makeDeps({
			sessionTabs: [
				{
					agentSessionId: null,
					chatTabId: 'tab-live',
					harnessId: 'claude',
					harnessLabel: 'Claude Code',
					id: 'tab-live',
					kind: 'terminal',
					label: 'Claude Code',
					status: 'working',
					terminalId: 'pty-live',
				},
			],
		});

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

/**
 * Builds a terminal session-tab model with sensible defaults, overridable per
 * case.
 * @param over - Fields to override on the base terminal tab.
 * @returns A terminal `SessionTabModel`.
 */
function terminalSessionTab(
	over: Partial<Extract<SessionTabModel, { kind: 'terminal' }>> & {
		id: string;
	},
): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId: over.id,
		harnessId: 'claude',
		harnessLabel: 'Claude Code',
		isSubAgent: false,
		kind: 'terminal',
		label: 'Claude Code',
		piSessionId: null,
		status: 'idle',
		summary: '',
		terminalId: 'pty',
		updatedLabel: '',
		...over,
	};
}

describe('isLiveTerminalTab', () => {
	test('accepts a terminal tab with a non-empty terminal id', () => {
		expect(
			isLiveTerminalTab(terminalSessionTab({ id: 'a', terminalId: 'pty-1' })),
		).toBe(true);
	});

	test('rejects a terminal tab whose terminal id is empty', () => {
		expect(
			isLiveTerminalTab(terminalSessionTab({ id: 'a', terminalId: '' })),
		).toBe(false);
	});

	test('rejects a non-terminal chat tab', () => {
		expect(
			isLiveTerminalTab({
				chatTabId: 'chat',
				id: 'chat',
				isSubAgent: false,
				kind: 'chat',
				label: 'New chat',
				piSessionId: null,
				status: 'idle',
				summary: '',
				updatedLabel: '',
			}),
		).toBe(false);
	});
});

describe('findDuplicateTerminalTabIds', () => {
	test('flags every open tab after the first that shares a captured session id', () => {
		const duplicates = findDuplicateTerminalTabIds([
			terminalSessionTab({
				id: 'a',
				terminalId: 'p1',
				agentSessionId: 'sid-x',
			}),
			terminalSessionTab({
				id: 'b',
				terminalId: 'p2',
				agentSessionId: 'sid-x',
			}),
			terminalSessionTab({
				id: 'c',
				terminalId: 'p3',
				agentSessionId: 'sid-x',
			}),
		]);

		expect(duplicates).toEqual(['b', 'c']);
	});

	test('keeps distinct conversations and never flags tabs without a captured id', () => {
		const duplicates = findDuplicateTerminalTabIds([
			terminalSessionTab({ id: 'a', agentSessionId: 'sid-x' }),
			terminalSessionTab({ id: 'b', agentSessionId: 'sid-y' }),
			terminalSessionTab({ id: 'c', agentSessionId: null }),
			terminalSessionTab({ id: 'd', agentSessionId: null }),
		]);

		expect(duplicates).toEqual([]);
	});

	test('ignores tabs with no live terminal id and non-terminal tabs', () => {
		const duplicates = findDuplicateTerminalTabIds([
			terminalSessionTab({
				id: 'a',
				terminalId: 'p1',
				agentSessionId: 'sid-x',
			}),
			terminalSessionTab({ id: 'b', terminalId: '', agentSessionId: 'sid-x' }),
			{
				chatTabId: 'chat',
				id: 'chat',
				isSubAgent: false,
				kind: 'chat',
				label: 'New chat',
				piSessionId: null,
				status: 'idle',
				summary: '',
				updatedLabel: '',
			},
		]);

		expect(duplicates).toEqual([]);
	});
});
