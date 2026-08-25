import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
	AgentClient,
	AgentEvent,
	AgentEventListener,
	AgentSession,
	AgentSessionRequest,
} from '../../src/main/agent-runtime';
import { createConciergeSessionService } from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { getConciergeSessionById } from '../../src/main/storage/repositories/concierge-session-repository.ts';

const HOME = '/tmp/root/concierge';

let database: DatabaseSync;
let directory: string;

/** A runtime child the test can drive events out of. */
interface FakeChild {
	emit: (event: AgentEvent) => void;
	request: AgentSessionRequest;
	session: AgentSession;
}

/**
 * Builds a runtime child that reports back the id it was opened under and
 * forwards whatever the test emits to its subscribers.
 * @param request - The session request the client was called with.
 * @returns The child handle.
 */
const fakeChild = (request: AgentSessionRequest): FakeChild => {
	const listeners = new Set<AgentEventListener>();
	const session = {
		abort: async () => undefined,
		close: async () => undefined,
		getMetadata: () => ({ sessionId: request.runtimeSessionId }) as never,
		getState: async () => ({}) as never,
		id: request.runtimeSessionId as never,
		refreshPlanUsage: async () => false,
		setSessionName: async () => undefined,
		subscribe: (listener: AgentEventListener) => {
			listeners.add(listener);
			return {
				unsubscribe: () => {
					listeners.delete(listener);
				},
			};
		},
		submit: async () => ({ acceptedAt: '2026-08-25T00:00:00.000Z' }) as never,
	} as unknown as AgentSession;
	return {
		emit: (event) => {
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
		request,
		session,
	};
};

/**
 * Builds a Concierge service over the shared database, so a second one stands
 * in for the app restarting against the same rows.
 * @returns The service plus every child it opened.
 */
const setup = () => {
	const children: FakeChild[] = [];
	const agentClient: AgentClient = {
		createSession: async (request) => {
			const child = fakeChild(request);
			children.push(child);
			return child.session;
		},
		listSessions: () => [],
		shutdown: async () => undefined,
	};
	const service = createConciergeSessionService({
		agentClient,
		requireDatabase: () => database,
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
	});
	return { children, service };
};

/**
 * Reads the runtime session id a row is carrying.
 * @param id - The Concierge session row id.
 * @returns The stored runtime session id, or null.
 */
const storedRuntimeSessionId = (id: string): string | null =>
	getConciergeSessionById({ database, id })?.runtimeSessionId ?? null;

/**
 * One agent message, which is what proves the runtime has a conversation of its
 * own to reload later.
 * @returns The event.
 */
const messageEvent = (): AgentEvent => ({
	at: '2026-08-25T00:00:01.000Z',
	payload: { kind: 'text', text: 'hello' },
	role: 'agent',
	turnId: null,
	type: 'message',
});

/**
 * The echo an adapter emits from its own `submit`, which crosses the session
 * before the runtime has seen the prompt.
 * @returns The event.
 */
const promptEchoEvent = (): AgentEvent => ({
	at: '2026-08-25T00:00:01.000Z',
	payload: { kind: 'prompt', prompt: 'hello' },
	role: 'user',
	turnId: 'turn-1',
	type: 'message',
});

/**
 * One tool message, which the runtime can produce before its first agent text.
 * @returns The event.
 */
const toolMessageEvent = (): AgentEvent => ({
	at: '2026-08-25T00:00:01.000Z',
	payload: { kind: 'text', text: 'reading' },
	role: 'tool',
	turnId: 'turn-1',
	type: 'message',
});

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-resume-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

describe('the runtime session id a Concierge row carries', () => {
	// The id the runtime reports straight after an open is the one Ensemblr just
	// handed it, not a conversation it holds. Stored then, a session that opened
	// and closed without a turn came back as `resume: <id>`, which Claude Code
	// answers with `No conversation found with session ID` — and the panel sat
	// there swallowing prompts until the user cleared the context.
	it('is not recorded before the runtime has served anything', async () => {
		const { service } = setup();

		const opened = await service.openSession({ fresh: true });

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBeNull();
	});

	it('opens fresh rather than resuming a session that never ran a turn', async () => {
		const first = setup();
		await first.service.openSession({ fresh: true });
		await first.service.shutdown();

		const second = setup();
		await second.service.openSession({ fresh: false });

		expect(second.children[0]?.request.resumeRuntimeSession).toBe(false);
	});

	it('is recorded once a message crosses the session', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		children[0]?.emit(messageEvent());

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBe(
			opened.session?.id,
		);
	});

	it('resumes a conversation the runtime has served', async () => {
		const first = setup();
		await first.service.openSession({ fresh: true });
		first.children[0]?.emit(messageEvent());
		await first.service.shutdown();

		const second = setup();
		await second.service.openSession({ fresh: false });

		expect(second.children[0]?.request.resumeRuntimeSession).toBe(true);
	});

	// The runtime's transcript can go missing under a row that legitimately
	// earned its id. Without this the resume is retried forever, because the CLI
	// reports it as an event long after `createSession` has already resolved.
	it('is forgotten when a resumed child dies without serving anything', async () => {
		const first = setup();
		const opened = await first.service.openSession({ fresh: true });
		first.children[0]?.emit(messageEvent());
		await first.service.shutdown();

		const second = setup();
		await second.service.openSession({ fresh: false });
		second.children[0]?.emit({
			at: '2026-08-25T00:00:02.000Z',
			reason: 'crashed',
			type: 'shutdown',
		});

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBeNull();
	});

	it('keeps the id when a child that served a turn dies', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		children[0]?.emit(messageEvent());
		children[0]?.emit({
			at: '2026-08-25T00:00:02.000Z',
			reason: 'crashed',
			type: 'shutdown',
		});

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBe(
			opened.session?.id,
		);
	});

	// Both adapters raise the user's prompt as a message of their own before the
	// runtime has it: Claude's from inside `submit`, Pi's from the shutdown path
	// that rescues an unechoed prompt. Counting either would record an id under a
	// transcript that does not exist yet.
	it('is not recorded by the prompt echo an adapter raises itself', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		children[0]?.emit(promptEchoEvent());

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBeNull();
	});

	it('is recorded by a tool message, which only the runtime can raise', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		children[0]?.emit(toolMessageEvent());

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBe(
			opened.session?.id,
		);
	});

	it('is forgotten when a resumed child dies having only echoed a prompt', async () => {
		const first = setup();
		const opened = await first.service.openSession({ fresh: true });
		first.children[0]?.emit(messageEvent());
		await first.service.shutdown();

		const second = setup();
		await second.service.openSession({ fresh: false });
		second.children[0]?.emit(promptEchoEvent());
		second.children[0]?.emit({
			at: '2026-08-25T00:00:02.000Z',
			reason: 'crashed',
			type: 'shutdown',
		});

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBeNull();
	});
});
