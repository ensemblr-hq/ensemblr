import { afterEach, expect, test, vi } from 'vitest';

import {
	createWorkspaceTeardownService,
	type WorkspaceTeardownPorts,
} from '@/main/repository/workspace-teardown';

const WORKSPACE = { workspaceId: 'ws-1', workspacePath: '/workspaces/ws-1' };

/** A promise plus the handle that settles it, for holding a port open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = (): void => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

/** Teardown ports that wind everything down cleanly, overridable per test. */
function buildPorts(
	overrides: Partial<WorkspaceTeardownPorts> = {},
): WorkspaceTeardownPorts {
	return {
		killTerminal: vi.fn(),
		listAgentSessionIds: () => [],
		listTerminalIds: () => [],
		releaseAgentControl: vi.fn(),
		stopAgentSession: vi.fn(async () => {}),
		stopWatchingFiles: vi.fn(),
		waitForTerminalExit: vi.fn(async () => true),
		...overrides,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

test('stops every session, kills every terminal, and drops the watcher', async () => {
	const ports = buildPorts({
		listAgentSessionIds: () => ['session-a', 'session-b'],
		listTerminalIds: () => ['term-a'],
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(report).toEqual({
		agentSessionsStopped: 2,
		failures: [],
		terminalsKilled: 1,
	});
	expect(ports.stopAgentSession).toHaveBeenCalledWith('session-a');
	expect(ports.stopAgentSession).toHaveBeenCalledWith('session-b');
	expect(ports.killTerminal).toHaveBeenCalledWith('term-a');
	expect(ports.stopWatchingFiles).toHaveBeenCalledWith(WORKSPACE.workspacePath);
});

// Revoking a token first would leave a child that refused to stop making control
// calls that fail rather than calls that work.
test('releases agent control after the stop attempts, including failed ones', async () => {
	const order: string[] = [];
	const ports = buildPorts({
		listAgentSessionIds: () => ['session-a'],
		releaseAgentControl: vi.fn((sessionId: string) => {
			order.push(`release:${sessionId}`);
		}),
		stopAgentSession: vi.fn(async (sessionId: string) => {
			order.push(`stop:${sessionId}`);
			throw new Error('runtime refused');
		}),
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(order).toEqual(['stop:session-a', 'release:session-a']);
	expect(report.agentSessionsStopped).toBe(0);
	expect(report.failures).toEqual([
		'Could not stop agent session session-a: runtime refused',
	]);
});

// Each stopSession already cascades to its own sub-agents, so one wedged runtime
// must not hold the others behind it.
test('stops the sessions concurrently rather than one after another', async () => {
	const held = deferred();
	const started: string[] = [];
	const ports = buildPorts({
		listAgentSessionIds: () => ['session-a', 'session-b'],
		stopAgentSession: vi.fn(async (sessionId: string) => {
			started.push(sessionId);
			await held.promise;
		}),
	});

	const running = createWorkspaceTeardownService(ports).teardown(WORKSPACE);
	await Promise.resolve();

	expect(started).toEqual(['session-a', 'session-b']);

	held.resolve();
	await running;
});

test('gives up on a session that never stops and says so', async () => {
	vi.useFakeTimers();
	const ports = buildPorts({
		listAgentSessionIds: () => ['session-wedged'],
		stopAgentSession: vi.fn(() => new Promise<void>(() => {})),
	});

	const running = createWorkspaceTeardownService(ports).teardown(WORKSPACE);
	await vi.advanceTimersByTimeAsync(10_000);
	const report = await running;

	expect(report.agentSessionsStopped).toBe(0);
	expect(report.failures).toEqual([
		'Agent session session-wedged did not stop within 10000ms; its runtime child may still be running.',
	]);
	expect(ports.releaseAgentControl).toHaveBeenCalledWith('session-wedged');
});

test('reports a terminal that outlives its exit deadline', async () => {
	const ports = buildPorts({
		listTerminalIds: () => ['term-stuck'],
		waitForTerminalExit: vi.fn(async () => false),
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(ports.waitForTerminalExit).toHaveBeenCalledWith('term-stuck', 5_000);
	expect(report.terminalsKilled).toBe(0);
	expect(report.failures).toEqual([
		'Terminal term-stuck did not exit within 5000ms; its output may continue.',
	]);
});

test('does not wait on a terminal it could not kill', async () => {
	const ports = buildPorts({
		killTerminal: vi.fn(() => {
			throw new Error('no such pty');
		}),
		listTerminalIds: () => ['term-gone'],
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(ports.waitForTerminalExit).not.toHaveBeenCalled();
	expect(report.failures).toEqual([
		'Could not stop terminal term-gone: no such pty',
	]);
});

// A listing that throws must read as "nothing to wind down", never as a reason
// to abandon the removal.
test('treats a failed listing as nothing to do and carries on', async () => {
	const ports = buildPorts({
		listAgentSessionIds: () => {
			throw new Error('registry closed');
		},
		listTerminalIds: () => {
			throw new Error('terminal service down');
		},
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(report.agentSessionsStopped).toBe(0);
	expect(report.terminalsKilled).toBe(0);
	expect(report.failures).toEqual([
		'Could not list agent sessions: registry closed',
		'Could not list terminals: terminal service down',
	]);
	expect(ports.stopWatchingFiles).toHaveBeenCalledWith(WORKSPACE.workspacePath);
});

test('reports a watcher that would not close', async () => {
	const ports = buildPorts({
		stopWatchingFiles: vi.fn(() => {
			throw new Error('handle already closed');
		}),
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(report.failures).toEqual([
		'Could not stop watching /workspaces/ws-1: handle already closed',
	]);
});

// Listing the PTYs before the runtimes are down would miss any an agent opens
// through agent control in between.
test('kills the terminals only once the sessions are down', async () => {
	const order: string[] = [];
	const ports = buildPorts({
		killTerminal: vi.fn(() => {
			order.push('kill-terminal');
		}),
		listAgentSessionIds: () => ['session-a'],
		listTerminalIds: () => {
			order.push('list-terminals');
			return ['term-a'];
		},
		stopAgentSession: vi.fn(async () => {
			order.push('stop-session');
		}),
	});

	await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(order).toEqual(['stop-session', 'list-terminals', 'kill-terminal']);
});

test('reports a non-Error throw rather than swallowing it', async () => {
	const ports = buildPorts({
		listAgentSessionIds: () => ['session-a'],
		stopAgentSession: vi.fn(() => Promise.reject('nope')),
	});

	const report =
		await createWorkspaceTeardownService(ports).teardown(WORKSPACE);

	expect(report.failures).toEqual([
		'Could not stop agent session session-a: an unexpected error',
	]);
});
