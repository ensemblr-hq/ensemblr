// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useWorkspaceTerminalSessions } from '../../src/renderer/state/workspace/terminal-sessions';
import type {
	CreateTerminalSessionRequest,
	TerminalSessionSnapshot,
} from '../../src/shared/ipc/contracts/terminal';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

/** Builds a running dock terminal snapshot for a relaunched session. */
function relaunchedSnapshot(
	request: CreateTerminalSessionRequest,
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentSessionId: null,
		agentTitle: null,
		cols: 80,
		commandLabel: 'fish',
		createdAt: '2026-07-21T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		id: 'new-1',
		kind: 'terminal',
		previewUrl: null,
		restored: Boolean(request.seedOutput),
		rows: 24,
		status: 'running',
		title: request.title ?? 'Terminal',
		workspaceId: request.workspaceId,
	};
}

/**
 * Installs a bridge whose live-session list is empty and whose restorable list
 * carries a single interactive terminal, returning the create spy for assertion.
 * @param terminals - Restorable terminals to offer.
 * @returns The `createTerminalSession` spy.
 */
function installRestorableBridge(
	terminals: { id: string; output: string; title: string }[],
) {
	const createTerminalSession = vi.fn(
		async (request: CreateTerminalSessionRequest) => ({
			diagnostics: [],
			session: relaunchedSnapshot(request),
		}),
	);
	const listRestorableTerminals = vi.fn(async () => ({ terminals }));

	installEnsemblrApi({
		createTerminalSession,
		listRestorableTerminals,
		listTerminalSessions: vi.fn(async () => ({ sessions: [] })),
		onTerminalLifecycle: () => () => undefined,
		onTerminalOutput: () => () => undefined,
	});

	return { createTerminalSession, listRestorableTerminals };
}

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('useWorkspaceTerminalSessions restore', () => {
	test('relaunches an open dock terminal with its persisted output seeded', async () => {
		const { createTerminalSession } = installRestorableBridge([
			{ id: 'old-1', output: 'prior output', title: 'Terminal' },
		]);

		const { result } = renderHook(() => useWorkspaceTerminalSessions('ws-1'));

		await waitFor(() =>
			expect(createTerminalSession).toHaveBeenCalledWith({
				restoredFromId: 'old-1',
				seedOutput: 'prior output',
				title: 'Terminal',
				workspaceId: 'ws-1',
			}),
		);

		await waitFor(() =>
			expect(result.current.sessions.map((s) => s.id)).toContain('new-1'),
		);
	});

	test('does not restore when the workspace already has live sessions', async () => {
		const createTerminalSession = vi.fn();
		const listRestorableTerminals = vi.fn(async () => ({ terminals: [] }));
		const listTerminalSessions = vi.fn(async () => ({
			sessions: [relaunchedSnapshot({ workspaceId: 'ws-1' })],
		}));

		installEnsemblrApi({
			createTerminalSession,
			listRestorableTerminals,
			listTerminalSessions,
			onTerminalLifecycle: () => () => undefined,
			onTerminalOutput: () => () => undefined,
		});

		const { result } = renderHook(() => useWorkspaceTerminalSessions('ws-1'));

		await waitFor(() =>
			expect(result.current.sessions.map((s) => s.id)).toContain('new-1'),
		);
		expect(listRestorableTerminals).not.toHaveBeenCalled();
		expect(createTerminalSession).not.toHaveBeenCalled();
	});
});
