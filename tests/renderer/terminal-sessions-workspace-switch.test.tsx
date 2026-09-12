// @vitest-environment happy-dom

import { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { useWorkspaceTerminalSessions } from '../../src/renderer/state/workspace/terminal-sessions';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc/contracts/terminal';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

/** A promise plus the resolver a test calls to settle it on cue. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

/** Builds a running dock terminal snapshot owned by `workspaceId`. */
function terminalSnapshot(
	id: string,
	workspaceId: string,
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: 'fish',
		createdAt: '2026-09-12T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id,
		kind: 'terminal',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		shell: '/bin/zsh',
		status: 'running',
		title: 'Terminal',
		titleIsDefault: true,
		workspaceId,
	};
}

type TerminalSessionsState = ReturnType<typeof useWorkspaceTerminalSessions>;

/**
 * Drives the hook under one workspace id and reports every rendered state. The
 * layout effect fires inside the same commit as the workspace switch — before
 * React flushes the departing effect's cleanup — which is the window a stale
 * list response can land in.
 */
function Probe({
	onCommit,
	onState,
	workspaceId,
}: {
	onCommit: (workspaceId: string) => void;
	onState: (state: TerminalSessionsState) => void;
	workspaceId: string;
}) {
	onState(useWorkspaceTerminalSessions(workspaceId));
	useLayoutEffect(() => {
		onCommit(workspaceId);
	}, [onCommit, workspaceId]);
	return null;
}

/** Yields to the scheduler repeatedly so React's committed and passive work drains. */
async function settle(): Promise<void> {
	for (let index = 0; index < 6; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
	root?.unmount();
	container?.remove();
	root = null;
	container = null;
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

test('a list settling after a workspace switch never reaches the new workspace', async () => {
	const first = deferred<{ sessions: TerminalSessionSnapshot[] }>();
	const second = deferred<{ sessions: TerminalSessionSnapshot[] }>();
	const listTerminalSessions = vi.fn(
		async ({ workspaceId }: { workspaceId: string }) =>
			workspaceId === 'ws-1' ? first.promise : second.promise,
	);

	installEnsemblrApi({
		createTerminalSession: vi.fn(),
		listRestorableTerminals: vi.fn(async () => ({ terminals: [] })),
		listTerminalSessions,
		onTerminalLifecycle: () => () => undefined,
		onTerminalOutput: () => () => undefined,
	});

	const states: TerminalSessionsState[] = [];
	const onState = (state: TerminalSessionsState) => {
		states.push(state);
	};
	const onCommit = (workspaceId: string) => {
		if (workspaceId === 'ws-2') {
			first.resolve({ sessions: [terminalSnapshot('ws1-terminal', 'ws-1')] });
		}
	};

	// The real scheduler has to run: act() flushes passive effects synchronously,
	// which would cancel the departing effect before its response could land.
	const previousActEnvironment = (
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT;
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = false;

	try {
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);

		root.render(
			<Probe onCommit={onCommit} onState={onState} workspaceId='ws-1' />,
		);
		await settle();
		expect(listTerminalSessions).toHaveBeenCalledWith({ workspaceId: 'ws-1' });

		root.render(
			<Probe onCommit={onCommit} onState={onState} workspaceId='ws-2' />,
		);
		await settle();

		expect(listTerminalSessions).toHaveBeenCalledWith({ workspaceId: 'ws-2' });
		const latest = states.at(-1);
		expect(latest?.sessions).toEqual([]);
		expect(latest?.isLoaded).toBe(false);
	} finally {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
	}
});
