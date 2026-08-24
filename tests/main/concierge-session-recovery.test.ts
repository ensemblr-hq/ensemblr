import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	type AgentClient,
	AgentClientError,
	type AgentSession,
	type AgentSessionRequest,
} from '../../src/main/agent-runtime';
import { createConciergeSessionService } from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const HOME = '/tmp/root/concierge';

let database: DatabaseSync;
let directory: string;

/** A runtime child the test can kill, to stand in for one that died. */
interface FakeChild {
	kill: () => void;
	session: AgentSession;
	submitted: string[];
}

/**
 * Builds a runtime session that records its prompts and, once killed, refuses
 * them the way the client refuses a submit on a closed session.
 * @param runtimeSessionId - Id the child reports for a later resume.
 * @returns The child handle.
 */
const fakeChild = (runtimeSessionId: string): FakeChild => {
	const submitted: string[] = [];
	let closed = false;
	const session = {
		abort: async () => {
			closed = true;
		},
		close: async () => {
			closed = true;
		},
		getMetadata: () => ({ sessionId: runtimeSessionId }) as never,
		getState: async () => ({}) as never,
		id: runtimeSessionId as never,
		refreshPlanUsage: async () => false,
		setSessionName: async () => undefined,
		subscribe: () => ({ unsubscribe: () => undefined }),
		submit: async (request: { prompt: string }) => {
			if (closed) {
				throw new AgentClientError({
					code: 'session-closed',
					message: 'Cannot submit on a closed agent session.',
					recoverable: false,
				});
			}
			if (!request.prompt.trim()) {
				throw new AgentClientError({
					code: 'submit-failed',
					message: 'Prompt must not be empty.',
					recoverable: true,
				});
			}
			submitted.push(request.prompt);
			return { acceptedAt: '2026-08-24T00:00:00.000Z' } as never;
		},
	} as AgentSession;
	return {
		kill: () => {
			closed = true;
		},
		session,
		submitted,
	};
};

/**
 * Builds the service over a real database with a client that hands out one
 * killable child per open.
 * @param options - Optionally refuse an open, to model a runtime that cannot
 * resume the conversation it is asked for.
 */
const setup = (
	options: { refuseOpen?: (request: AgentSessionRequest) => boolean } = {},
) => {
	const children: FakeChild[] = [];
	const requests: AgentSessionRequest[] = [];
	const agentClient: AgentClient = {
		createSession: async (request) => {
			requests.push(request);
			if (options.refuseOpen?.(request)) {
				throw new Error('The runtime could not resume that session.');
			}
			const child = fakeChild(`runtime-${children.length + 1}`);
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
	return { children, requests, service };
};

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-revive-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

describe('a Concierge prompt sent after its runtime child has died', () => {
	// The panel holds one conversation and offers no control that restarts it,
	// so the refusal used to be terminal: every later prompt bounced off the
	// dead session and the user got an error line instead of an answer.
	it('opens a replacement and sends the prompt there', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });
		children[0]?.kill();

		const result = await service.submitPrompt({
			prompt: 'what am I working on?',
			sessionId: opened.session?.id ?? '',
		});

		expect(result.error).toBeUndefined();
		expect(result.acceptedAt).toBe('2026-08-24T00:00:00.000Z');
		expect(children).toHaveLength(2);
		expect(children[1]?.submitted).toEqual(['what am I working on?']);
	});

	// Also the path a panel takes when it is holding an id the service has since
	// replaced — the transcript is worth keeping either way.
	it('resumes the conversation the dead child was serving', async () => {
		const { children, requests, service } = setup();
		const opened = await service.openSession({ fresh: true });
		children[0]?.kill();

		const result = await service.submitPrompt({
			prompt: 'still there?',
			sessionId: 'a-session-that-is-not-the-live-one',
		});

		expect(result.session?.id).toBe(opened.session?.id);
		expect(requests[1]).toMatchObject({ resumeRuntimeSession: true });
	});

	// A stale id is not a dead session. Rebuilding the child to serve one would
	// throw away the turn it may be streaming for the window that is up to date.
	it('serves a stale id from the live child rather than replacing it', async () => {
		const { children, requests, service } = setup();
		const opened = await service.openSession({ fresh: true });

		const result = await service.submitPrompt({
			prompt: 'still there?',
			sessionId: 'a-session-that-is-not-the-live-one',
		});

		expect(result.error).toBeUndefined();
		expect(children).toHaveLength(1);
		expect(requests).toHaveLength(1);
		expect(children[0]?.submitted).toEqual(['still there?']);
		// Returned even though nothing was replaced, so the panel stops holding
		// the id it came in with.
		expect(result.session?.id).toBe(opened.session?.id);
	});

	it('starts a clean session when the runtime cannot resume the old one', async () => {
		const { children, service } = setup({
			refuseOpen: (request) => request.resumeRuntimeSession === true,
		});
		const opened = await service.openSession({ fresh: true });
		children[0]?.kill();

		const result = await service.submitPrompt({
			prompt: 'start over',
			sessionId: opened.session?.id ?? '',
		});

		expect(result.error).toBeUndefined();
		expect(result.session?.id).not.toBe(opened.session?.id);
		expect(children[1]?.submitted).toEqual(['start over']);
	});

	// Reopening on any failure would hide a runtime that is alive and refusing,
	// and would spend a fresh child on every malformed prompt.
	it('reports a failure the live child raised rather than reopening', async () => {
		const { requests, service } = setup();
		const opened = await service.openSession({ fresh: true });

		const result = await service.submitPrompt({
			prompt: '   ',
			sessionId: opened.session?.id ?? '',
		});

		expect(result.error).toBe('Prompt must not be empty.');
		expect(requests).toHaveLength(1);
	});
});
