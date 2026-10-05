import { createStore } from 'jotai';
import { describe, expect, test } from 'vitest';

import {
	buildWorkspaceScriptSummaries,
	scriptSummaryToDockStatus,
} from '../../src/renderer/lib/terminal';
import {
	computeQueueSnapshotAtom,
	queuedScriptJobsAtomFamily,
} from '../../src/renderer/state/compute-queue';
import type { WorkspaceScriptQueuedJob } from '../../src/renderer/types/workbench';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '../../src/shared/compute-queue';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc';
import type { WorkspaceScriptSettings } from '../../src/shared/scripts';

const SETTINGS: WorkspaceScriptSettings = {
	autoRunAfterSetup: false,
	runScripts: [
		{
			availableIn: null,
			command: 'bun run dev',
			icon: 'play',
			isDefault: true,
			name: 'dev',
		},
	],
	runScriptMode: 'nonconcurrent',
	scripts: { setup: 'bun install' },
};

/** A setup launch waiting first in line, as the atom hands it to the builder. */
const QUEUED_SETUP: WorkspaceScriptQueuedJob = {
	enqueuedAt: 1_000,
	id: 'job-setup',
	initiator: 'auto',
	kind: 'setup',
	position: 1,
	scriptName: null,
};

/** Builds a setup-script session snapshot with any overrides the test needs. */
function setupSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: 'bun install',
		createdAt: '2026-10-05T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: 'setup-1',
		kind: 'setup-script',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		secretPrompt: null,
		shell: '/bin/sh',
		status: 'running',
		titleIsDefault: true,
		title: 'Setup',
		workspaceId: 'workspace-1',
		...overrides,
	};
}

/** Builds one compute-queue job with any overrides the test needs. */
function job(overrides: Partial<ComputeJobSnapshot> = {}): ComputeJobSnapshot {
	return {
		command: 'bun install',
		endedAt: null,
		enqueuedAt: 1_000,
		exitCode: null,
		id: 'job-1',
		initiator: 'auto',
		kind: 'script',
		label: 'bun install',
		logPath: null,
		position: 1,
		script: { kind: 'setup', name: null },
		sessionId: null,
		signal: null,
		startedAt: null,
		state: 'queued',
		terminalId: null,
		workspaceId: 'workspace-1',
		workspaceName: 'Queued setup',
		...overrides,
	};
}

/** Wraps jobs in a queue snapshot. */
function snapshot(jobs: ComputeJobSnapshot[]): ComputeQueueSnapshot {
	return { enabled: true, inUse: 1, jobs, slots: 1 };
}

describe('script summaries and a launch waiting in the compute queue', () => {
	test('marks a never-run setup as queued and lights the tab as queued', () => {
		const { run, setup } = buildWorkspaceScriptSummaries({
			queuedJobs: [QUEUED_SETUP],
			sessions: [],
			settings: SETTINGS,
		});

		expect(setup.status).toBe('not-run');
		expect(setup.queuedJob).toEqual(QUEUED_SETUP);
		expect(scriptSummaryToDockStatus(setup)).toBe('queued');
		expect(run).not.toHaveProperty('queuedJob');
	});

	test('carries a queued rerun over an earlier stopped session', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			queuedJobs: [QUEUED_SETUP],
			sessions: [setupSession({ status: 'failed' })],
			settings: SETTINGS,
		});

		expect(setup.queuedJob).toEqual(QUEUED_SETUP);
		expect(scriptSummaryToDockStatus(setup)).toBe('queued');
	});

	test('lets a running session win over a launch queued behind it', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			queuedJobs: [QUEUED_SETUP],
			sessions: [setupSession()],
			settings: SETTINGS,
		});

		expect(setup).not.toHaveProperty('queuedJob');
		expect(scriptSummaryToDockStatus(setup)).toBe('running');
	});

	test('never offers the queued panel while any session of the kind still runs', () => {
		const { setup } = buildWorkspaceScriptSummaries({
			queuedJobs: [QUEUED_SETUP],
			sessions: [
				setupSession({ id: 'setup-live' }),
				setupSession({ id: 'setup-later', status: 'exited' }),
			],
			settings: SETTINGS,
		});

		expect(setup).not.toHaveProperty('queuedJob');
	});

	test('routes a queued run launch to the run summary only', () => {
		const queuedRun: WorkspaceScriptQueuedJob = {
			...QUEUED_SETUP,
			id: 'job-run',
			initiator: 'agent',
			kind: 'run',
			scriptName: 'dev',
		};
		const { run, setup } = buildWorkspaceScriptSummaries({
			queuedJobs: [queuedRun],
			sessions: [],
			settings: SETTINGS,
		});

		expect(run.queuedJob).toEqual(queuedRun);
		expect(setup).not.toHaveProperty('queuedJob');
	});
});

describe('queuedScriptJobsAtomFamily', () => {
	test('keeps only this workspace’s queued setup and run launches, first in line first', () => {
		const store = createStore();
		store.set(
			computeQueueSnapshotAtom,
			snapshot([
				job({
					id: 'run-later',
					position: 3,
					script: { kind: 'run', name: 'dev' },
				}),
				job({ id: 'setup-first', position: 1 }),
				job({ id: 'elsewhere', position: 2, workspaceId: 'workspace-2' }),
				job({ id: 'running', position: null, state: 'running' }),
				job({ id: 'command', kind: 'command', position: 4, script: null }),
				job({
					id: 'archive',
					position: 5,
					script: { kind: 'archive', name: null },
				}),
			]),
		);

		const jobs = store.get(queuedScriptJobsAtomFamily('workspace-1'));

		expect(jobs.map((queued) => queued.id)).toEqual([
			'setup-first',
			'run-later',
		]);
		expect(jobs[1]).toEqual({
			enqueuedAt: 1_000,
			id: 'run-later',
			initiator: 'auto',
			kind: 'run',
			position: 3,
			scriptName: 'dev',
		});
	});

	test('keeps its reference while only other workspaces’ jobs move', () => {
		const store = createStore();
		const mine = job({ id: 'setup-first', position: 1 });
		store.set(computeQueueSnapshotAtom, snapshot([mine]));
		const atom = queuedScriptJobsAtomFamily('workspace-1');
		const before = store.get(atom);

		store.set(
			computeQueueSnapshotAtom,
			snapshot([
				mine,
				job({ id: 'elsewhere', position: 2, workspaceId: 'workspace-2' }),
			]),
		);

		expect(store.get(atom)).toBe(before);
	});

	test('hands back a new selection when this workspace’s place in line moves', () => {
		const store = createStore();
		store.set(
			computeQueueSnapshotAtom,
			snapshot([job({ id: 'setup-first', position: 2 })]),
		);
		const atom = queuedScriptJobsAtomFamily('workspace-1');
		const before = store.get(atom);

		store.set(
			computeQueueSnapshotAtom,
			snapshot([job({ id: 'setup-first', position: 1 })]),
		);

		expect(store.get(atom)).not.toBe(before);
		expect(store.get(atom)[0]?.position).toBe(1);
	});
});
