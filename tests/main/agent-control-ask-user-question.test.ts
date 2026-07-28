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
		conversations: {},
		focus: {},
		harnesses: {},
		permissions: { getMode: () => 'workspace-trusted' },
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

	it('releases the agent when the user never answers', async () => {
		vi.useFakeTimers();
		try {
			const { closed, coordinator } = setup();
			const pending = coordinator.port.ask({
				origin: origin(),
				questions: QUESTIONS,
			});
			await vi.advanceTimersByTimeAsync(1_800_000);
			const result = await pending;
			expect(result.cancelled).toBe(true);
			expect(result.summary).toContain('did not answer in time');
			expect(closed).toEqual([{ requestId: 'req-1' }]);
		} finally {
			vi.useRealTimers();
		}
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

describe('askUserQuestion op', () => {
	it('resolves with the user’s answer for a Pi caller', async () => {
		const { asked, coordinator, service } = serviceSetup('pi');
		const pending = service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			token: 'tok-caller',
		});
		await Promise.resolve();
		await Promise.resolve();
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

	it('cancels a pending question when the session is released', async () => {
		const { asked, service } = serviceSetup('pi');
		const pending = service.invoke({
			op: 'askUserQuestion',
			rawArgs: { questions: QUESTIONS },
			token: 'tok-caller',
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(asked).toHaveLength(1);
		service.releaseSession('caller');
		const result = await pending;
		expect(result.ok && result.data).toMatchObject({ cancelled: true });
	});
});
