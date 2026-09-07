import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	type AgentClient,
	AgentClientError,
	type AgentEvent,
	type AgentEventListener,
	type AgentSession,
	type AgentSessionRequest,
} from '../../src/main/agent-runtime';
import { createConciergeSessionService } from '../../src/main/concierge';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	listConciergeSessions,
	updateConciergeSession,
} from '../../src/main/storage/repositories/concierge-session-repository.ts';

const HOME = '/tmp/root/concierge';

let database: DatabaseSync;
let directory: string;

/** Leaves the user with no Concierge conversation at all, as a clear that failed would. */
const closeEverySession = (): void => {
	for (const row of listConciergeSessions({ database })) {
		updateConciergeSession({
			database,
			id: row.id,
			patch: { closedAt: '2026-08-24T00:00:00.000Z', status: 'closed' },
		});
	}
};

/** A runtime child the test can kill, to stand in for one that died. */
interface FakeChild {
	/** Emits the noise a booting child makes before any turn: usage and metadata. */
	announce: () => void;
	kill: () => void;
	/** Emits a plain crash, with nothing said about why the child went away. */
	crash: () => void;
	/**
	 * Emits what a runtime asked to reload a conversation it no longer holds
	 * actually produces: an error naming the missing session, then a crash.
	 */
	refuseResume: () => void;
	/** Carries one turn, which is what leaves the runtime a conversation to reload. */
	serveTurn: () => void;
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
	const listeners = new Set<AgentEventListener>();
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
		subscribe: (listener: AgentEventListener) => {
			listeners.add(listener);
			return {
				unsubscribe: () => {
					listeners.delete(listener);
				},
			};
		},
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
			// Every real adapter announces the prompt it accepted as a `user`
			// message, which is what puts the bubble in the transcript. Without it
			// here a resend that duplicated the bubble would pass unnoticed.
			emit({
				at: '2026-08-24T00:00:00.000Z',
				payload: { kind: 'prompt', prompt: request.prompt },
				role: 'user',
				turnId: null,
				type: 'message',
			});
			return { acceptedAt: '2026-08-24T00:00:00.000Z' } as never;
		},
	} as unknown as AgentSession;
	const emit = (event: AgentEvent): void => {
		for (const listener of [...listeners]) {
			listener(event);
		}
	};
	return {
		announce: () => {
			emit({
				at: '2026-08-24T00:00:00.000Z',
				type: 'context-usage',
				usage: { contextWindow: 1_000_000, percent: 3, tokens: 30_000 },
			} as AgentEvent);
			emit({
				at: '2026-08-24T00:00:00.000Z',
				metadata: { sessionId: runtimeSessionId } as never,
				type: 'metadata',
			});
		},
		crash: () => {
			closed = true;
			emit({
				at: '2026-08-24T00:00:00.000Z',
				reason: 'crashed',
				type: 'shutdown',
			});
		},
		kill: () => {
			closed = true;
		},
		refuseResume: () => {
			emit({
				at: '2026-08-24T00:00:00.000Z',
				error: {
					code: 'adapter-failure',
					detail: `No conversation found with session ID: ${runtimeSessionId}`,
					message: 'The Claude session ended unexpectedly.',
					recoverable: false,
				},
				type: 'error',
			});
			closed = true;
			emit({
				at: '2026-08-24T00:00:00.000Z',
				reason: 'crashed',
				type: 'shutdown',
			});
		},
		serveTurn: () => {
			for (const listener of [...listeners]) {
				listener({
					at: '2026-08-24T00:00:00.000Z',
					payload: { kind: 'text', text: 'served' },
					role: 'agent',
					turnId: null,
					type: 'message',
				});
			}
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
	options: {
		/** Runs against each child as it is handed out, to model one born dead. */
		onChild?: (child: FakeChild) => void;
		refuseOpen?: (request: AgentSessionRequest) => boolean;
		runMemoryPass?: (sessionId: string) => Promise<boolean>;
	} = {},
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
			options.onChild?.(child);
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
		...(options.runMemoryPass ? { runMemoryPass: options.runMemoryPass } : {}),
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
		children[0]?.serveTurn();
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
		children[0]?.serveTurn();
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

// A workspace agent reaching upward takes the opposite branch from a user prompt
// at exactly one point: it must never bring a Concierge conversation into being.
// One that booted from here would spend tokens on a conversation nobody asked
// for and nobody would think to read. What it may do is put a child back under a
// conversation that already exists — the panel unopened this launch, a child the
// user stopped, one that crashed — because the message lands in the transcript
// they already have either way.
describe('a workspace agent message to the Concierge', () => {
	it('delivers into the conversation that is live, and names it', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		const result = await service.deliverAgentMessage({
			prompt: 'MESSAGE FROM AN AGENT — blocked on the schema',
		});

		expect(result).toEqual({
			conciergeSessionId: opened.session?.id,
			delivered: true,
		});
		expect(children[0]?.submitted).toEqual([
			'MESSAGE FROM AN AGENT — blocked on the schema',
		]);
	});

	// The window the guard on the live attachment could not see: the child is gone
	// but the shutdown event has not cleared the attachment yet, so the send gets
	// as far as the runtime before finding out. The conversation is still open, so
	// the message belongs in it.
	it('rebuilds the child that died under the send, into the same conversation', async () => {
		const { children, requests, service } = setup();
		const opened = await service.openSession({ fresh: true });
		children[0]?.kill();

		const result = await service.deliverAgentMessage({ prompt: 'anyone up?' });

		expect(result).toEqual({
			conciergeSessionId: opened.session?.id,
			delivered: true,
		});
		expect(children[1]?.submitted).toEqual(['anyone up?']);
		expect(requests).toHaveLength(2);
	});

	// The case that made the channel unreachable in practice. Nothing attaches a
	// Concierge child at boot — the panel does it when the user opens it — so an
	// agent messaging before they have looked at it once found no attachment while
	// the conversation sat on disk with its whole transcript.
	it('attaches the conversation on disk when nothing is attached yet', async () => {
		const first = setup();
		const opened = await first.service.openSession({ fresh: true });
		await first.service.shutdown();

		const relaunched = setup();
		const result = await relaunched.service.deliverAgentMessage({
			prompt: 'anyone up?',
		});

		expect(result).toEqual({
			conciergeSessionId: opened.session?.id,
			delivered: true,
		});
		expect(relaunched.children[0]?.submitted).toEqual(['anyone up?']);
	});

	it('reports no session when the Concierge was never opened', async () => {
		const { children, service } = setup();

		const result = await service.deliverAgentMessage({ prompt: 'anyone up?' });

		expect(result).toMatchObject({ cause: 'no-session', delivered: false });
		expect(children).toHaveLength(0);
	});

	// The refusal the op was written for still has to hold: every conversation
	// closed means the user has none, and inventing one from here is the thing
	// this path may never do.
	it('starts no conversation when every one of them is closed', async () => {
		const { children, service } = setup();
		await service.openSession({ fresh: true });
		await service.shutdown();
		closeEverySession();

		const result = await service.deliverAgentMessage({ prompt: 'anyone up?' });

		expect(result).toMatchObject({ cause: 'no-session', delivered: false });
		expect(children).toHaveLength(1);
	});

	// A runtime that cannot hold a child at all is not a race, and retrying it is
	// how one message becomes a process per attempt.
	it('gives up rather than rebuilding a child that keeps dying', async () => {
		const { children, service } = setup({
			onChild: (child) => {
				child.kill();
			},
		});
		await service.openSession({ fresh: true });

		const result = await service.deliverAgentMessage({ prompt: 'anyone up?' });

		expect(result).toMatchObject({ cause: 'failed', delivered: false });
		// The one the open spawned, and the single rebuild the retry is worth.
		expect(children).toHaveLength(2);
	});

	it('passes on a refusal from a live child rather than reopening', async () => {
		const { children, service } = setup();
		await service.openSession({ fresh: true });

		const result = await service.deliverAgentMessage({ prompt: '   ' });

		expect(result).toEqual({
			cause: 'failed',
			delivered: false,
			detail: 'Prompt must not be empty.',
		});
		expect(children).toHaveLength(1);
	});
});

/** Lets the fire-and-forget heal run to completion before the test reads state. */
const settle = async (): Promise<void> => {
	for (let pass = 0; pass < 6; pass += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

/** Counts the prompt bubbles a session's transcript carries. */
const promptRowCount = (
	service: ReturnType<typeof setup>['service'],
	sessionId: string,
): number =>
	service.listEvents({ sessionId }).events.filter((event) => {
		const envelope = event.payload;
		return envelope?.kind === 'message' && envelope.payload.kind === 'prompt';
	}).length;

/** Reads a session row's stored runtime conversation id straight from SQLite. */
const storedRuntimeSessionId = (sessionId: string): string | null =>
	(
		database
			.prepare('SELECT runtime_session_id FROM concierge_sessions WHERE id = ?')
			.get(sessionId) as { runtime_session_id: string | null }
	).runtime_session_id;

/**
 * Drives a session to the state the field reports: a row the runtime is asked to
 * reload, attached to a child that is about to refuse.
 * @param harness - The service under test and the children it has handed out.
 * @returns The session id and the prompt the doomed child accepted.
 */
const resumedIntoADoomedChild = async (
	harness: ReturnType<typeof setup>,
): Promise<{ prompt: string; sessionId: string }> => {
	const opened = await harness.service.openSession({ fresh: true });
	const sessionId = opened.session?.id ?? '';
	harness.children[0]?.serveTurn();
	harness.children[0]?.kill();
	const prompt = 'cut a beta release';
	await harness.service.submitPrompt({ prompt, sessionId });
	return { prompt, sessionId };
};

describe('a Concierge conversation the runtime refuses to reload', () => {
	// The trace this repairs, straight off a user's database: a row pinned to a
	// conversation Claude never wrote, two rejected resumes in a row, and the
	// prompt typed between them sitting in the transcript unanswered forever.
	it('rebuilds the conversation and re-sends the prompt that died with it', async () => {
		const harness = setup();
		const { prompt, sessionId } = await resumedIntoADoomedChild(harness);
		expect(harness.requests[1]).toMatchObject({ resumeRuntimeSession: true });

		harness.children[1]?.refuseResume();
		await settle();

		expect(storedRuntimeSessionId(sessionId)).toBeNull();
		expect(harness.requests[2]).toMatchObject({
			agentSessionId: sessionId,
			resumeRuntimeSession: false,
		});
		expect(harness.children[2]?.submitted).toEqual([prompt]);
	});

	// The heal reopens the same row, which is what keeps the panel on the
	// transcript it is already reading — so the replacement child's own
	// announcement of the prompt lands beside the one the dead child already
	// wrote. Printing the user's words twice with the failure between them reads
	// as though they asked twice.
	it('re-sends the turn without printing the prompt twice', async () => {
		const harness = setup();
		const { sessionId } = await resumedIntoADoomedChild(harness);
		expect(promptRowCount(harness.service, sessionId)).toBe(1);

		harness.children[1]?.refuseResume();
		await settle();

		expect(harness.children[2]?.submitted).toHaveLength(1);
		expect(promptRowCount(harness.service, sessionId)).toBe(1);
	});

	// The cap counts children spawned, and a rebuild the runtime refused to open
	// spawned none. Charged for it anyway, the panel would be left with its
	// repair already spent the next time a resume was genuinely refused.
	it('does not spend the heal budget on a rebuild that never opened', async () => {
		let opens = 0;
		const harness = setup({
			refuseOpen: () => {
				opens += 1;
				return opens === 3;
			},
		});
		const { prompt, sessionId } = await resumedIntoADoomedChild(harness);

		harness.children[1]?.refuseResume();
		await settle();
		expect(harness.children).toHaveLength(2);

		await harness.service.submitPrompt({ prompt, sessionId });
		harness.children[2]?.refuseResume();
		await settle();

		expect(harness.children).toHaveLength(4);
		expect(harness.children[3]?.submitted).toEqual([prompt]);
	});

	// The echo guard is armed for one replayed turn only. Left armed, the next
	// time the user typed those same words the transcript would swallow them.
	it('still records the prompt when the user sends it again', async () => {
		const harness = setup();
		const { prompt, sessionId } = await resumedIntoADoomedChild(harness);

		harness.children[1]?.refuseResume();
		await settle();
		harness.children[2]?.serveTurn();
		await harness.service.submitPrompt({ prompt, sessionId });

		expect(promptRowCount(harness.service, sessionId)).toBe(2);
	});

	// A rebuild starts a child from nothing, so a second refusal is a runtime
	// that cannot open a session at all. Retrying that is how a panel nobody can
	// use spawns one process per attempt.
	it('rebuilds once and then leaves the failure on screen', async () => {
		const harness = setup();
		await resumedIntoADoomedChild(harness);

		harness.children[1]?.refuseResume();
		await settle();
		harness.children[2]?.refuseResume();
		await settle();

		expect(harness.children).toHaveLength(3);
	});

	// `wrapSession` has already flipped the child closed by the time its shutdown
	// lands, so an attachment left behind is a corpse every later prompt is aimed
	// at — which is what made the panel answer nothing at all. A crash that says
	// nothing about a resume earns no rebuild, so this is the case where the
	// service is left holding nothing at all.
	it('stops holding a child once it has shut down', async () => {
		const { children, service } = setup();
		await service.openSession({ fresh: true });
		expect(service.describeActiveSession()).not.toBeNull();

		children[0]?.crash();
		await settle();

		expect(service.describeActiveSession()).toBeNull();
		expect(children).toHaveLength(1);
	});

	// A child that boots and is never spoken to has written no transcript, so the
	// row must stay unresumable. Marked otherwise, its next attach asks for a
	// conversation that does not exist and dies on arrival.
	it('does not call a session resumable on boot noise alone', async () => {
		const { children, service } = setup();
		const opened = await service.openSession({ fresh: true });

		children[0]?.announce();

		expect(storedRuntimeSessionId(opened.session?.id ?? '')).toBeNull();
	});
});

describe('two Concierge clears racing each other', () => {
	// Each clear spawns a replacement child plus a retired one running a whole
	// memory-write turn, and a panel that has stopped answering is exactly when
	// the user presses the control repeatedly.
	it('replaces the conversation once', async () => {
		const { service } = setup({ runMemoryPass: async () => true });
		await service.openSession({ fresh: true });

		const [first, second] = await Promise.all([
			service.clearContext({ reason: 'manual' }),
			service.clearContext({ reason: 'manual' }),
		]);

		expect(first.session?.id).toBe(second.session?.id);
		expect(
			database
				.prepare('SELECT COUNT(*) AS total FROM concierge_sessions')
				.get() as { total: number },
		).toMatchObject({ total: 2 });
	});
});
