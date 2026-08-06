import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createAskUserQuestionCoordinator,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentControlOrigin } from '../../src/main/agent-control/ports.ts';
import type {
	AskUserQuestionBroadcast,
	AskUserQuestionClosedBroadcast,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from '../../src/shared/agent-control.ts';

const QUESTIONS: readonly AskUserQuestionItem[] = [
	{
		options: [{ label: 'Rewrite' }, { label: 'Patch' }],
		question: 'Which approach?',
	},
];

const origin = (overrides: Partial<AgentControlOrigin> = {}) =>
	({
		depth: 0,
		parentSessionId: null,
		sessionId: 'session-1',
		species: 'pi',
		token: 'token-1',
		workspaceCwd: '/tmp/ws',
		workspaceId: 'workspace-1',
		...overrides,
	}) satisfies AgentControlOrigin;

/** Ports the ask op never touches; only `ask` is exercised here. */
const makeUnusedPorts = (): Omit<AgentControlPorts, 'ask'> =>
	({
		board: {
			getWorkspaceStatus: vi.fn(),
			setWorkspaceStatus: vi.fn(),
		},
		confirm: { confirm: vi.fn() },
		conversations: { isSpawnedSubAgent: vi.fn().mockResolvedValue(false) },
		focus: {},
		harnesses: {},
		permissions: { getMode: () => 'workspace-trusted' },
		planMode: {
			exit: vi.fn(),
			isActive: vi.fn().mockReturnValue(false),
			releaseSession: vi.fn(),
		},
		tabs: {},
		terminals: {},
		workspaces: {},
	}) as unknown as Omit<AgentControlPorts, 'ask'>;

const setup = (hasRenderer = true) => {
	const asked: AskUserQuestionBroadcast[] = [];
	const closed: AskUserQuestionClosedBroadcast[] = [];
	let nextId = 0;
	const coordinator = createAskUserQuestionCoordinator({
		broadcastAsk: (payload) => asked.push(payload),
		broadcastClosed: (payload) => closed.push(payload),
		createRequestId: () => `req-${++nextId}`,
		hasRenderer: () => hasRenderer,
	});
	return { asked, closed, coordinator };
};

describe('ask coordinator', () => {
	it('broadcasts the questionnaire and blocks until it is answered', async () => {
		const { asked, coordinator } = setup();
		let settled: AskUserQuestionResult | null = null;
		const pending = coordinator.port
			.ask({ origin: origin(), questions: QUESTIONS })
			.then((result) => {
				settled = result;
				return result;
			});

		await Promise.resolve();
		expect(asked).toEqual([
			{
				piSessionId: 'session-1',
				questions: QUESTIONS,
				requestId: 'req-1',
				workspaceId: 'workspace-1',
			},
		]);
		expect(settled).toBeNull();

		coordinator.settle({
			answers: [
				{
					answer: 'Rewrite',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: 'req-1',
		});

		await expect(pending).resolves.toMatchObject({
			cancelled: false,
			summary:
				'The user answered: "Which approach?" = "Rewrite". Continue with those answers in mind and do not re-ask.',
		});
	});

	it('renders the summary itself rather than trusting the renderer', async () => {
		const { coordinator } = setup();
		const pending = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		coordinator.settle({
			answers: [
				{
					answer: 'Patch',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: 'req-1',
		});
		const result = await pending;
		expect(result.summary).toContain('"Which approach?" = "Patch"');
	});

	it('withdraws the questionnaire from every window once it is answered', async () => {
		const { closed, coordinator } = setup();
		const pending = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		coordinator.settle({ answers: [], cancelled: false, requestId: 'req-1' });
		await pending;
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});

	it('refuses a second question while one is already on screen', async () => {
		const { asked, coordinator } = setup();
		const first = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		const second = await coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		expect(asked).toHaveLength(1);
		expect(second.summary).toContain('already has a question waiting');
		expect(second.summary).toContain('Do not treat this as a decline');

		coordinator.settle({ answers: [], cancelled: false, requestId: 'req-1' });
		await first;
		const third = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		await Promise.resolve();
		expect(asked).toHaveLength(2);
		coordinator.settle({ answers: [], cancelled: true, requestId: 'req-2' });
		await third;
	});

	it('never releases the agent on its own, however long the user takes', async () => {
		vi.useFakeTimers();
		try {
			const { closed, coordinator } = setup();
			let settled = false;
			const pending = coordinator.port
				.ask({ origin: origin(), questions: QUESTIONS })
				.then((result) => {
					settled = true;
					return result;
				});
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(settled).toBe(false);
			expect(closed).toEqual([]);

			coordinator.settle({ answers: [], cancelled: true, requestId: 'req-1' });
			await expect(pending).resolves.toMatchObject({ cancelled: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it('withdraws the questionnaire when the asking turn is cancelled', async () => {
		const { closed, coordinator } = setup();
		const aborter = new AbortController();
		const pending = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
			signal: aborter.signal,
		});
		await Promise.resolve();

		aborter.abort();
		const result = await pending;
		expect(result.cancelled).toBe(true);
		expect(result.summary).toContain('ended before the user answered');
		expect(result.summary).toContain('Do not treat this as a decline');
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});

	it('frees the session for a new question once a cancelled turn is withdrawn', async () => {
		const { asked, coordinator } = setup();
		const aborter = new AbortController();
		const first = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
			signal: aborter.signal,
		});
		await Promise.resolve();
		aborter.abort();
		await first;

		const second = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		await Promise.resolve();
		expect(asked).toHaveLength(2);

		coordinator.settle({ answers: [], cancelled: false, requestId: 'req-2' });
		await expect(second).resolves.toMatchObject({ cancelled: false });
	});

	// A renderer keeps its pending questions in memory only, so a reload drops the
	// card while the agent stays blocked — with the timeout gone, replay is the
	// only way back in step.
	it('offers every open questionnaire for replay to a window that lost it', async () => {
		const { asked, coordinator } = setup();
		const first = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		const second = coordinator.port.ask({
			origin: origin({ sessionId: 'session-2' }),
			questions: QUESTIONS,
		});
		await Promise.resolve();

		expect(coordinator.openAsks()).toEqual(asked);
		expect(coordinator.openAsks()).toHaveLength(2);

		coordinator.settle({ answers: [], cancelled: true, requestId: 'req-1' });
		await first;
		expect(coordinator.openAsks()).toEqual([
			expect.objectContaining({ piSessionId: 'session-2', requestId: 'req-2' }),
		]);

		coordinator.settle({ answers: [], cancelled: true, requestId: 'req-2' });
		await second;
		expect(coordinator.openAsks()).toEqual([]);
	});

	it('puts nothing on screen for a turn that is already over', async () => {
		const { asked, coordinator } = setup();
		const result = await coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
			signal: AbortSignal.abort(),
		});
		expect(asked).toEqual([]);
		expect(result.cancelled).toBe(true);
		expect(result.summary).toContain('Do not treat this as a decline');
	});

	it('keeps questions from different sessions apart', async () => {
		const { asked, coordinator } = setup();
		const first = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		const second = coordinator.port.ask({
			origin: origin({ sessionId: 'session-2' }),
			questions: QUESTIONS,
		});
		await Promise.resolve();
		expect(asked.map((entry) => entry.requestId)).toEqual(['req-1', 'req-2']);

		coordinator.port.releaseSession('session-1');
		await expect(first).resolves.toMatchObject({ cancelled: true });

		coordinator.settle({ answers: [], cancelled: false, requestId: 'req-2' });
		await expect(second).resolves.toMatchObject({ cancelled: false });
	});

	it('cancels and withdraws a question when its session ends', async () => {
		const { closed, coordinator } = setup();
		const pending = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		coordinator.port.releaseSession('session-1');
		await expect(pending).resolves.toEqual({
			answers: [],
			cancelled: true,
			summary: 'The user declined to answer.',
		});
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});

	it('ignores a reply for an unknown or already-settled request', async () => {
		const { coordinator } = setup();
		expect(() =>
			coordinator.settle({ answers: [], cancelled: true, requestId: 'nope' }),
		).not.toThrow();

		const pending = coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		coordinator.settle({
			answers: [
				{
					answer: 'Rewrite',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: 'req-1',
		});
		coordinator.settle({ answers: [], cancelled: true, requestId: 'req-1' });
		await expect(pending).resolves.toMatchObject({ cancelled: false });
	});

	it('tells the agent the user never saw the question when no window is open', async () => {
		const { asked, coordinator } = setup(false);
		const result = await coordinator.port.ask({
			origin: origin(),
			questions: QUESTIONS,
		});
		expect(asked).toEqual([]);
		expect(result.cancelled).toBe(true);
		expect(result.summary).toContain('Do not treat this as a decline');
	});

	it('does nothing when releasing a session with no pending question', () => {
		const { closed, coordinator } = setup();
		expect(() => coordinator.port.releaseSession('unknown')).not.toThrow();
		expect(closed).toEqual([]);
	});
});

const serviceSetup = (species: 'pi' | 'harness') => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: 'caller',
		species,
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const { asked, coordinator } = setup();
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports: { ...makeUnusedPorts(), ask: coordinator.port },
	});
	return { asked, coordinator, service };
};

/**
 * Drains microtasks until the dialog port has been handed a request, so a test
 * never depends on how many `await`s the service makes before it dispatches.
 */
const waitForAsk = async (asked: readonly unknown[]): Promise<void> => {
	for (let tick = 0; tick < 50 && asked.length === 0; tick += 1) {
		await Promise.resolve();
	}
};

describe('askUserQuestion op', () => {
	it('resolves with the user’s answer for a Pi caller', async () => {
		const { asked, coordinator, service } = serviceSetup('pi');
		const pending = service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			token: 'tok-caller',
		});
		await waitForAsk(asked);
		const requestId = asked[0]?.requestId;
		expect(requestId).toBeDefined();
		coordinator.settle({
			answers: [
				{
					answer: 'Rewrite',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: requestId as string,
		});
		const result = await pending;
		expect(result.ok).toBe(true);
		expect(result.ok && result.data).toMatchObject({
			answers: [expect.objectContaining({ answer: 'Rewrite' })],
			cancelled: false,
			summary: expect.stringContaining('"Which approach?" = "Rewrite"'),
		});
	});

	it('rejects a harness caller, which has no chat tab to host the dialog', async () => {
		const { asked, service } = serviceSetup('harness');
		const result = await service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			token: 'tok-caller',
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.code).toBe('denied-scope');
		expect(asked).toEqual([]);
	});

	it('rejects a malformed questionnaire before it reaches the dialog', async () => {
		const { asked, service } = serviceSetup('pi');
		const result = await service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: [{ options: [], question: 'Which?' }] },
			token: 'tok-caller',
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.code).toBe('invalid-args');
		expect(asked).toEqual([]);
	});

	it('withdraws the question when the caller hangs up mid-call', async () => {
		const { asked, service } = serviceSetup('pi');
		const aborter = new AbortController();
		const pending = service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			signal: aborter.signal,
			token: 'tok-caller',
		});
		await waitForAsk(asked);
		expect(asked).toHaveLength(1);

		aborter.abort();
		const result = await pending;
		expect(result.ok && result.data).toMatchObject({
			cancelled: true,
			summary: expect.stringContaining('ended before the user answered'),
		});
	});

	it('cancels a pending question when the session is released', async () => {
		const { asked, service } = serviceSetup('pi');
		const pending = service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			token: 'tok-caller',
		});
		await waitForAsk(asked);
		expect(asked).toHaveLength(1);
		service.releaseSession('caller');
		const result = await pending;
		expect(result.ok && result.data).toMatchObject({ cancelled: true });
	});
});
