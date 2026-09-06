import { createStore } from 'jotai';
import { describe, expect, test } from 'vitest';

import {
	activeTerminalIdsAtom,
	computeWorkspaceDockActivity,
	reduceTerminalActivitySnapshot,
	type TerminalActivitySnapshot,
	terminalActivitySnapshotsAtom,
	workspaceDockActivityByWorkspaceAtom,
} from '../../src/renderer/state/workspace';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';

function createSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: '/bin/zsh',
		createdAt: '2026-08-15T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: 'terminal-1',
		kind: 'terminal',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		status: 'running',
		title: 'Terminal',
		titleIsDefault: false,
		workspaceId: 'workspace-1',
		...overrides,
	};
}

function createSnapshot(
	overrides: Partial<TerminalActivitySnapshot> = {},
): TerminalActivitySnapshot {
	return {
		kind: 'run-script',
		status: 'running',
		workspaceId: 'workspace-1',
		...overrides,
	};
}

describe('computeWorkspaceDockActivity', () => {
	test('reports a running run script for a workspace with no mounted route', () => {
		expect(
			computeWorkspaceDockActivity({ 'run-1': createSnapshot() }, new Set()),
		).toEqual({ 'workspace-1': 'running' });
	});

	test('keys activity by each session workspace', () => {
		const activity = computeWorkspaceDockActivity(
			{
				'run-1': createSnapshot(),
				'setup-2': createSnapshot({
					kind: 'setup-script',
					workspaceId: 'workspace-2',
				}),
			},
			new Set(),
		);

		expect(activity).toEqual({
			'workspace-1': 'running',
			'workspace-2': 'setup-running',
		});
	});

	test('lets a running setup script outrank other activity in its workspace', () => {
		const activity = computeWorkspaceDockActivity(
			{
				'run-1': createSnapshot(),
				'setup-1': createSnapshot({ kind: 'setup-script' }),
			},
			new Set(),
		);

		expect(activity).toEqual({ 'workspace-1': 'setup-running' });
	});

	test('lights an interactive terminal only while its command produces output', () => {
		const snapshots = { 'terminal-1': createSnapshot({ kind: 'terminal' }) };

		expect(computeWorkspaceDockActivity(snapshots, new Set())).toEqual({});
		expect(
			computeWorkspaceDockActivity(snapshots, new Set(['terminal-1'])),
		).toEqual({ 'workspace-1': 'running' });
	});

	test('ignores sessions that are no longer running and agent harnesses', () => {
		const activity = computeWorkspaceDockActivity(
			{
				'agent-1': createSnapshot({ kind: 'agent' }),
				'run-1': createSnapshot({ status: 'exited' }),
			},
			new Set(),
		);

		expect(activity).toEqual({});
	});
});

describe('reduceTerminalActivitySnapshot', () => {
	test('records a running session', () => {
		expect(
			reduceTerminalActivitySnapshot(
				{},
				createSession({ id: 'run-1', kind: 'run-script' }),
			),
		).toEqual({
			'run-1': {
				kind: 'run-script',
				status: 'running',
				workspaceId: 'workspace-1',
			},
		});
	});

	test('drops a session once it stops running', () => {
		const snapshots = { 'run-1': createSnapshot() };

		expect(
			reduceTerminalActivitySnapshot(
				snapshots,
				createSession({ id: 'run-1', kind: 'run-script', status: 'exited' }),
			),
		).toEqual({});
	});

	test('keeps the same reference when nothing changed', () => {
		const snapshots = { 'run-1': createSnapshot() };

		expect(
			reduceTerminalActivitySnapshot(
				snapshots,
				createSession({ id: 'run-1', kind: 'run-script' }),
			),
		).toBe(snapshots);
		expect(
			reduceTerminalActivitySnapshot({}, createSession({ status: 'exited' })),
		).toEqual({});
	});
});

describe('workspaceDockActivityByWorkspaceAtom', () => {
	test('derives badge state from the app-wide session map', () => {
		const store = createStore();

		expect(store.get(workspaceDockActivityByWorkspaceAtom)).toEqual({});

		store.set(terminalActivitySnapshotsAtom, {
			'terminal-1': createSnapshot({ kind: 'terminal' }),
		});
		expect(store.get(workspaceDockActivityByWorkspaceAtom)).toEqual({});

		store.set(activeTerminalIdsAtom, new Set(['terminal-1']));
		expect(store.get(workspaceDockActivityByWorkspaceAtom)).toEqual({
			'workspace-1': 'running',
		});
	});
});
