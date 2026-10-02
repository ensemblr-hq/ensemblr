import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentClient, AgentSession } from '../../src/main/agent-runtime';
import type { AgentEvent } from '../../src/main/agent-runtime/agent-types.ts';
import {
	createConciergeSessionService,
	MEMORY_PASS_PROMPT,
} from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { getConciergeSessionById } from '../../src/main/storage/repositories/concierge-session-repository.ts';
import type { ConciergeEventBroadcastWire } from '../../src/shared/ipc/contracts/concierge.ts';

const HOME = '/tmp/root/concierge';

let database: DatabaseSync;
let directory: string;

/** One runtime child the test can close over: what it was sent, and its events. */
interface FakeChild {
	closed: boolean;
	emit: (event: AgentEvent) => void;
	prompts: string[];
	session: AgentSession;
}

/**
 * Builds a runtime child whose event stream the test drives, so a memory pass
 * can be run to completion — or deliberately left hanging — on demand.
 */
const makeChild = (): FakeChild => {
	const listeners = new Set<(event: AgentEvent) => void>();
	const child: FakeChild = {
		closed: false,
		emit: (event) => {
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
		prompts: [],
		session: {
			abort: async () => undefined,
			close: async () => {
				child.closed = true;
			},
			getMetadata: () => ({ sessionId: 'runtime' }) as never,
			getState: async () => ({}) as never,
			id: 'runtime' as never,
			refreshPlanUsage: async () => false,
			setSessionName: async () => undefined,
			subscribe: (listener: (event: AgentEvent) => void) => {
				listeners.add(listener);
				return {
					unsubscribe: () => {
						listeners.delete(listener);
					},
				};
			},
			submit: async ({ prompt }: { prompt: string }) => {
				child.prompts.push(prompt);
				return { acceptedAt: '2026-08-24T00:00:00.000Z' } as never;
			},
		} as unknown as AgentSession,
	};
	return child;
};

/** Drives a child through the one status transition a memory pass completes on. */
const finishTurn = (child: FakeChild): void => {
	child.emit({
		at: '2026-08-24T00:00:01.000Z',
		previous: 'idle',
		status: 'streaming',
		type: 'status',
	});
	child.emit({
		at: '2026-08-24T00:00:02.000Z',
		previous: 'streaming',
		status: 'idle',
		type: 'status',
	});
};

/**
 * Builds the service over a real database and a client handing out one fresh
 * child per open, so a clear's replacement is told apart from what it retired.
 */
const setup = (
	options: {
		eventSink?: (broadcast: ConciergeEventBroadcastWire) => void;
		releaseControlOrigin?: (sessionId: string) => void;
		retireControlOrigin?: (sessionId: string) => void;
		runMemoryPass?: (sessionId: string) => Promise<boolean>;
	} = {},
) => {
	const children: FakeChild[] = [];
	const agentClient: AgentClient = {
		createSession: async () => {
			const child = makeChild();
			children.push(child);
			return child.session;
		},
		listSessions: () => [],
		shutdown: async () => undefined,
	};
	const service = createConciergeSessionService({
		agentClient,
		eventSink: options.eventSink,
		releaseControlOrigin: options.releaseControlOrigin,
		requireDatabase: () => database,
		retireControlOrigin: options.retireControlOrigin,
		resolveHome: () => ({
			artifactsPath: path.join(HOME, 'artifacts'),
			memoryIndexPath: path.join(HOME, 'MEMORY.md'),
			memoryPath: path.join(HOME, 'memory'),
			rootPath: HOME,
		}),
		resolveReadableDirectories: () => [],
		resolveSettings: () => ({
			autoClearAtPercent: 0.8,
			model: null,
			provider: 'claude',
			thinkingLevel: null,
		}),
		...(options.runMemoryPass ? { runMemoryPass: options.runMemoryPass } : {}),
	});
	return { children, service };
};

/** Lets every queued microtask run, which is where a background pass settles. */
const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-clear-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

// Clearing used to submit the memory-write prompt into the conversation the user
// was looking at and hold the fresh one back until the agent had answered it, so
// pressing the refresh control showed a prompt nobody wrote and no new
// conversation for a turn. These hold the replacement to arriving first.
describe('clearing the Concierge context', () => {
	it('hands back the replacement without waiting for the memory pass', async () => {
		const { children, service } = setup({
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		const opened = await service.openSession({ fresh: true });

		const cleared = await service.clearContext({ reason: 'manual' });

		expect(cleared.error).toBeUndefined();
		expect(cleared.memoryPassStarted).toBe(true);
		expect(cleared.session?.id).not.toBe(opened.session?.id);
		expect(children).toHaveLength(2);
	});

	// The retired child keeps its subscription so its rows still reach its own
	// transcript, but the turn it runs is background work nobody asked for. Fed
	// to the activity monitor as the user's own it notified "Finished" on every
	// clear, and its trailing `idle` could clear the streaming session out from
	// under the replacement and swallow that turn's real notification.
	it('marks the retired child’s memory-pass turn as not live', async () => {
		const broadcasts: ConciergeEventBroadcastWire[] = [];
		const { children, service } = setup({
			eventSink: (broadcast) => broadcasts.push(broadcast),
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		const opened = await service.openSession({ fresh: true });

		const cleared = await service.clearContext({ reason: 'manual' });
		broadcasts.length = 0;
		finishTurn(children[0] as FakeChild);

		expect(broadcasts).not.toHaveLength(0);
		expect(broadcasts.every((broadcast) => !broadcast.live)).toBe(true);
		expect(
			broadcasts.every(
				(broadcast) => broadcast.sessionId === opened.session?.id,
			),
		).toBe(true);
		expect(cleared.session?.id).not.toBe(opened.session?.id);
	});

	it('marks the replacement’s own turn as live', async () => {
		const broadcasts: ConciergeEventBroadcastWire[] = [];
		const { children, service } = setup({
			eventSink: (broadcast) => broadcasts.push(broadcast),
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		await service.openSession({ fresh: true });
		const cleared = await service.clearContext({ reason: 'manual' });
		broadcasts.length = 0;

		finishTurn(children[1] as FakeChild);

		expect(broadcasts).not.toHaveLength(0);
		expect(broadcasts.every((broadcast) => broadcast.live)).toBe(true);
		expect(
			broadcasts.every(
				(broadcast) => broadcast.sessionId === cleared.session?.id,
			),
		).toBe(true);
	});

	it('submits the memory prompt to the retired child, not the replacement', async () => {
		const { children, service } = setup();
		await service.openSession({ fresh: true });

		await service.clearContext({ reason: 'manual' });

		expect(children[0]?.prompts).toEqual([MEMORY_PASS_PROMPT]);
		expect(children[1]?.prompts).toEqual([]);
	});

	it('leaves the retired child open until its pass lands, then closes it', async () => {
		const releaseControlOrigin = vi.fn();
		const { children, service } = setup({ releaseControlOrigin });
		const opened = await service.openSession({ fresh: true });

		await service.clearContext({ reason: 'manual' });
		expect(children[0]?.closed).toBe(false);

		finishTurn(children[0] as FakeChild);
		await settle();

		expect(children[0]?.closed).toBe(true);
		expect(releaseControlOrigin).toHaveBeenCalledWith(opened.session?.id);
	});

	it('closes the retired child at once when the pass is skipped', async () => {
		const { children, service } = setup();
		await service.openSession({ fresh: true });

		const cleared = await service.clearContext({
			reason: 'manual',
			skipMemoryPass: true,
		});

		expect(cleared.memoryPassStarted).toBe(false);
		expect(children[0]?.closed).toBe(true);
		expect(children[0]?.prompts).toEqual([]);
	});

	// A pass that never comes back would otherwise keep a runtime process and its
	// control token alive past the window that spawned them.
	it('closes a child still mid-pass when the service shuts down', async () => {
		const { children, service } = setup({
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		await service.openSession({ fresh: true });
		await service.clearContext({ reason: 'manual' });

		await service.shutdown();

		expect(children.map((child) => child.closed)).toEqual([true, true]);
	});

	// The row is closed on the way out rather than when the pass lands, so a
	// resume that races the pass cannot find the retired session still open and
	// put the user back into the conversation they just cleared.
	it('closes the retired row with its reason before the pass settles', async () => {
		const { service } = setup({
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		const opened = await service.openSession({ fresh: true });

		await service.clearContext({ reason: 'threshold' });

		const retired = getConciergeSessionById({
			database,
			id: opened.session?.id ?? '',
		});
		expect(retired?.status).toBe('closed');
		expect(retired?.closedAt).not.toBeNull();
		expect(retired?.metadata).toMatchObject({ clearedBy: 'threshold' });
	});
});

// The retired child keeps a live Concierge token so its writes can still be
// cleared, but the transcript it writes into is one the renderer no longer draws
// — so the origin narrows on the way out rather than staying whole until the
// pass lands. Anything it did to the app in between would have no visible cause.
describe('the authority a retired Concierge child keeps', () => {
	it('narrows the control origin the moment the child is retired', async () => {
		const retireControlOrigin = vi.fn();
		const { service } = setup({
			retireControlOrigin,
			runMemoryPass: () => new Promise<boolean>(() => undefined),
		});
		const opened = await service.openSession({ fresh: true });

		await service.clearContext({ reason: 'manual' });

		expect(retireControlOrigin).toHaveBeenCalledWith(opened.session?.id);
	});

	// Retire narrows, release revokes. A child whose pass has landed holds
	// nothing, so both fire in order rather than one standing in for the other.
	it('releases the origin outright once the pass lands', async () => {
		const releaseControlOrigin = vi.fn();
		const retireControlOrigin = vi.fn();
		const { children, service } = setup({
			releaseControlOrigin,
			retireControlOrigin,
		});
		const opened = await service.openSession({ fresh: true });

		await service.clearContext({ reason: 'manual' });
		expect(releaseControlOrigin).not.toHaveBeenCalled();

		finishTurn(children[0] as FakeChild);
		await settle();

		expect(releaseControlOrigin).toHaveBeenCalledWith(opened.session?.id);
	});

	// `skipMemoryPass` used to be defeated by an injected override: the guard read
	// "is there anything to run this on" and answered yes on the stub alone.
	it('runs no pass at all when the caller skipped it, override or not', async () => {
		const runMemoryPass = vi.fn().mockResolvedValue(true);
		const retireControlOrigin = vi.fn();
		const { service } = setup({ retireControlOrigin, runMemoryPass });
		await service.openSession({ fresh: true });

		const cleared = await service.clearContext({
			reason: 'manual',
			skipMemoryPass: true,
		});

		expect(cleared.memoryPassStarted).toBe(false);
		expect(runMemoryPass).not.toHaveBeenCalled();
		expect(retireControlOrigin).not.toHaveBeenCalled();
	});
});
