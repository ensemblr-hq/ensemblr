import { describe, expect, it } from 'vitest';

import {
	afterDelegationToolResult,
	beforeDelegationToolCall,
	createDelegationBarrierState,
	delegationBarrierActive,
	restoreDelegationBarrierState,
	sanitizeDelegationMessageContent,
	shouldResumeDelegationWait,
} from '../../resources/pi-extensions/delegation-barrier.mts';
import { readExtensionSource } from './support/pi-extension-source.ts';

const successful = (data: unknown) => ({ ok: true, data });

const startChild = (
	state = createDelegationBarrierState(),
	input: Record<string, unknown> = {},
) => {
	const started = beforeDelegationToolCall(state, {
		batchStartsChild: true,
		input,
		toolCallId: 'start-1',
		toolName: 'ensemblr_start_conversation',
	});
	return afterDelegationToolResult(started.state, {
		details: successful({ agentSessionId: 'child-1', chatTabId: 'tab-1' }),
		input,
		toolCallId: 'start-1',
		toolName: 'ensemblr_start_conversation',
	});
};

const waitFor = (
	state: ReturnType<typeof createDelegationBarrierState>,
	data: unknown,
) => {
	const waiting = beforeDelegationToolCall(state, {
		batchStartsChild: false,
		input: { mode: 'all' },
		toolCallId: 'wait-1',
		toolName: 'ensemblr_wait_for_agents',
	});
	return afterDelegationToolResult(waiting.state, {
		details: successful(data),
		input: { mode: 'all' },
		toolCallId: 'wait-1',
		toolName: 'ensemblr_wait_for_agents',
	});
};

describe('Pi delegation barrier', () => {
	it('wires the barrier into only root Pi sessions', () => {
		const source = readExtensionSource();
		expect(source).toContain('import {\n\tafterDelegationToolResult');
		expect(source).toContain(
			'const delegationBarrierEnabled = !IS_SUBAGENT && !IS_CONCIERGE',
		);
		expect(source).toContain("pi.on('tool_result'");
		expect(source).toContain("pi.on('message_end'");
		expect(source).toContain("pi.on('agent_settled'");
	});

	it('opens on a successful child spawn and blocks unrelated work', () => {
		const state = startChild();

		expect(delegationBarrierActive(state)).toBe(true);
		const read = beforeDelegationToolCall(state, {
			batchStartsChild: false,
			input: { path: 'src/index.ts' },
			toolCallId: 'read-1',
			toolName: 'read',
		});
		expect(read.blockReason).toContain('ensemblr_wait_for_agents');
	});

	it('blocks sibling work and a racing wait while spawn calls are in flight', () => {
		const first = beforeDelegationToolCall(createDelegationBarrierState(), {
			batchStartsChild: true,
			input: {},
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});

		const second = beforeDelegationToolCall(first.state, {
			batchStartsChild: true,
			input: {},
			toolCallId: 'start-2',
			toolName: 'ensemblr_start_conversation',
		});
		const read = beforeDelegationToolCall(second.state, {
			batchStartsChild: true,
			input: {},
			toolCallId: 'read-1',
			toolName: 'read',
		});
		const wait = beforeDelegationToolCall(second.state, {
			batchStartsChild: true,
			input: { mode: 'all' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});

		expect(second.blockReason).toBeUndefined();
		expect(read.blockReason).toContain('same tool batch');
		expect(wait.blockReason).toContain('next turn');
	});

	it('still requires a report-producing wait after start wait=true completes', () => {
		const input = { wait: true };
		const started = beforeDelegationToolCall(createDelegationBarrierState(), {
			batchStartsChild: true,
			input,
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});
		const state = afterDelegationToolResult(started.state, {
			details: successful({
				agentSessionId: 'child-1',
				chatTabId: 'tab-1',
				result: 'completed',
			}),
			input,
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});
		expect(delegationBarrierActive(state)).toBe(true);
	});

	it('does not track a peer conversation as a child', () => {
		const state = startChild(createDelegationBarrierState(), { peer: true });
		expect(delegationBarrierActive(state)).toBe(false);
	});

	it('forces waits to target every outstanding child in all mode', () => {
		const state = startChild();
		const decision = beforeDelegationToolCall(state, {
			batchStartsChild: false,
			input: { mode: 'first', reports: 'brief' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});

		expect(decision.input).toEqual({
			mode: 'all',
			reports: 'brief',
			targets: ['child-1'],
		});
	});

	it('keeps the barrier through timeout and pending wait results', () => {
		const state = waitFor(startChild(), {
			completed: [],
			pending: [{ agentSessionId: 'child-1', status: 'streaming' }],
			timedOut: true,
		});
		expect(delegationBarrierActive(state)).toBe(true);
		expect(shouldResumeDelegationWait(state)).toBe(true);
	});

	it('clears the barrier only after every tracked child settles', () => {
		const state = waitFor(startChild(), {
			completed: [
				{
					agentSessionId: 'child-1',
					signal: null,
					status: 'idle',
				},
			],
			pending: [],
			timedOut: false,
		});
		expect(delegationBarrierActive(state)).toBe(false);
	});

	it.each(['done', 'progress'])(
		'unblocks work after a settled child reports an informational %s signal',
		(reason) => {
			const state = waitFor(startChild(), {
				completed: [
					{
						agentSessionId: 'child-1',
						lastMessage: 'Work complete. Checks passed.',
						signal: { message: 'Checks passed.', reason },
						status: 'idle',
					},
				],
				pending: [],
				timedOut: false,
			});
			const closed = afterDelegationToolResult(state, {
				details: successful({ ok: true }),
				input: { chatTabId: 'tab-1' },
				toolCallId: 'close-1',
				toolName: 'ensemblr_close_tab',
			});
			for (const toolName of ['read', 'bash']) {
				expect(
					beforeDelegationToolCall(closed, {
						batchStartsChild: false,
						input: {},
						toolCallId: `${toolName}-1`,
						toolName,
					}).blockReason,
				).toBeUndefined();
			}
			expect(shouldResumeDelegationWait(closed)).toBe(false);
			expect(
				delegationBarrierActive(restoreDelegationBarrierState(closed)),
			).toBe(false);
		},
	);

	it('keeps signaled children outstanding until a follow-up settles', () => {
		const signaled = waitFor(startChild(), {
			completed: [
				{
					agentSessionId: 'child-1',
					signal: { message: 'Choose one', reason: 'need_decision' },
					status: 'streaming',
				},
			],
			pending: [],
			timedOut: false,
		});
		expect(delegationBarrierActive(signaled)).toBe(true);

		const followUp = beforeDelegationToolCall(signaled, {
			batchStartsChild: false,
			input: { agentSessionId: 'child-1', prompt: 'Use A', wait: true },
			toolCallId: 'follow-1',
			toolName: 'ensemblr_send_follow_up',
		});
		expect(followUp.blockReason).toBeUndefined();
		const followedUp = afterDelegationToolResult(followUp.state, {
			details: successful({ result: 'completed' }),
			input: { agentSessionId: 'child-1', prompt: 'Use A', wait: true },
			toolCallId: 'follow-1',
			toolName: 'ensemblr_send_follow_up',
		});
		expect(delegationBarrierActive(followedUp)).toBe(true);
		const settled = waitFor(followedUp, {
			completed: [
				{
					agentSessionId: 'child-1',
					signal: null,
					status: 'idle',
				},
			],
			pending: [],
			timedOut: false,
		});
		expect(delegationBarrierActive(settled)).toBe(false);
	});

	it('fails closed for an unrecognized child signal', () => {
		const signaled = waitFor(startChild(), {
			completed: [
				{
					agentSessionId: 'child-1',
					signal: { message: 'New signal', reason: 'future_reason' },
					status: 'streaming',
				},
			],
			pending: [],
			timedOut: false,
		});

		expect(delegationBarrierActive(signaled)).toBe(true);
	});

	it('allows only barrier-resolution tools while a child is outstanding', () => {
		const state = startChild();
		for (const [toolName, input] of [
			['ensemblr_start_conversation', {}],
			['ensemblr_send_follow_up', { agentSessionId: 'child-1' }],
			['ensemblr_close_tab', { chatTabId: 'tab-1' }],
		] as const) {
			expect(
				beforeDelegationToolCall(state, {
					batchStartsChild: false,
					input,
					toolCallId: `call-${toolName}`,
					toolName,
				}).blockReason,
			).toBeUndefined();
		}
		expect(
			beforeDelegationToolCall(state, {
				batchStartsChild: false,
				input: { agentSessionId: 'other' },
				toolCallId: 'follow-other',
				toolName: 'ensemblr_send_follow_up',
			}).blockReason,
		).toContain('tracked child');
	});

	it('drops a failed spawn intent instead of stranding the orchestrator', () => {
		const started = beforeDelegationToolCall(createDelegationBarrierState(), {
			batchStartsChild: true,
			input: {},
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});
		const failed = afterDelegationToolResult(started.state, {
			details: { code: 'invalid-args', error: 'bad model', ok: false },
			input: {},
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});
		expect(delegationBarrierActive(failed)).toBe(false);
	});

	it('keeps automatic waiting enabled when Pi blocks a racing wait locally', () => {
		const state = startChild();
		const unchanged = afterDelegationToolResult(state, {
			details: { reason: 'blocked before execution' },
			input: { mode: 'all' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});
		expect(shouldResumeDelegationWait(unchanged)).toBe(true);
	});

	it('stops automatic retries after a hard wait failure', () => {
		const state = startChild();
		const waiting = beforeDelegationToolCall(state, {
			batchStartsChild: false,
			input: { mode: 'all' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});
		const failed = afterDelegationToolResult(waiting.state, {
			details: { code: 'internal', error: 'offline', ok: false },
			input: { mode: 'all' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});

		expect(delegationBarrierActive(failed)).toBe(true);
		expect(shouldResumeDelegationWait(failed)).toBe(false);
	});

	it('removes premature prose while preserving tool calls', () => {
		expect(
			sanitizeDelegationMessageContent([
				{ text: 'I will continue with the finding.', type: 'text' },
				{
					arguments: { prompt: 'inspect' },
					id: 'call-1',
					name: 'ensemblr_start_conversation',
					type: 'toolCall',
				},
			]),
		).toEqual([
			{
				arguments: { prompt: 'inspect' },
				id: 'call-1',
				name: 'ensemblr_start_conversation',
				type: 'toolCall',
			},
		]);
		expect(
			sanitizeDelegationMessageContent([
				{ text: 'The answer is ready.', type: 'text' },
			]),
		).toEqual([
			{
				text: 'Delegated children are still working. Waiting for every child before continuing.',
				type: 'text',
			},
		]);
	});

	it('restores a valid persisted snapshot and rejects malformed state', () => {
		const state = startChild();
		expect(restoreDelegationBarrierState(state)).toEqual(state);
		expect(restoreDelegationBarrierState({ children: 'broken' })).toEqual(
			createDelegationBarrierState(),
		);
	});

	it('fails closed when reload restores an in-flight spawn intent', () => {
		const started = beforeDelegationToolCall(createDelegationBarrierState(), {
			batchStartsChild: true,
			input: {},
			toolCallId: 'start-1',
			toolName: 'ensemblr_start_conversation',
		});
		const restored = restoreDelegationBarrierState(started.state);

		expect(delegationBarrierActive(restored)).toBe(true);
		expect(shouldResumeDelegationWait(restored)).toBe(false);
		const wait = beforeDelegationToolCall(restored, {
			batchStartsChild: false,
			input: { mode: 'first', targets: ['invented-child'] },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});
		expect(wait.blockReason).toBeUndefined();
		expect(wait.clearWaitTargets).toBe(true);
		expect(wait.input).toEqual({ mode: 'all' });

		const stillRecovering = afterDelegationToolResult(restored, {
			details: successful({ completed: [], pending: [] }),
			input: { mode: 'all' },
			toolCallId: 'wait-1',
			toolName: 'ensemblr_wait_for_agents',
		});
		expect(delegationBarrierActive(stillRecovering)).toBe(true);
		expect(shouldResumeDelegationWait(stillRecovering)).toBe(false);

		const signaled = afterDelegationToolResult(restored, {
			details: successful({
				completed: [
					{
						agentSessionId: 'child-2',
						signal: { message: 'Choose one', reason: 'need_decision' },
					},
				],
				pending: [],
			}),
			input: { mode: 'all' },
			toolCallId: 'wait-2',
			toolName: 'ensemblr_wait_for_agents',
		});
		expect(signaled.children).toContainEqual({
			agentSessionId: 'child-2',
			chatTabId: null,
			phase: 'attention',
		});
		const followUp = beforeDelegationToolCall(signaled, {
			batchStartsChild: false,
			input: { agentSessionId: 'child-2', prompt: 'Use A' },
			toolCallId: 'follow-2',
			toolName: 'ensemblr_send_follow_up',
		});
		expect(followUp.blockReason).toBeUndefined();
		expect(
			beforeDelegationToolCall(signaled, {
				batchStartsChild: false,
				input: { questions: [] },
				toolCallId: 'question-1',
				toolName: 'ensemblr_ask_user_question',
			}).blockReason,
		).toBeUndefined();
		const followedUp = afterDelegationToolResult(followUp.state, {
			details: successful({ result: 'sent' }),
			input: { agentSessionId: 'child-2', prompt: 'Use A' },
			toolCallId: 'follow-2',
			toolName: 'ensemblr_send_follow_up',
		});
		const recoveredSettled = waitFor(followedUp, {
			completed: [{ agentSessionId: 'child-2', signal: null }],
			pending: [],
		});
		expect(recoveredSettled.recoveryRequired).toBe(false);
		expect(recoveredSettled.children).toContainEqual({
			agentSessionId: 'child-2',
			chatTabId: null,
			phase: 'settled',
		});

		const knownChildRecovery = {
			...startChild(),
			recoveryRequired: true,
		};
		const knownChildSettled = afterDelegationToolResult(knownChildRecovery, {
			details: successful({
				completed: [{ agentSessionId: 'child-1', signal: null }],
				pending: [],
			}),
			input: { mode: 'all' },
			toolCallId: 'wait-2',
			toolName: 'ensemblr_wait_for_agents',
		});
		expect(delegationBarrierActive(knownChildSettled)).toBe(true);
	});

	it.each([
		[null, false],
		['done', false],
		['progress', false],
		['future_reason', true],
	] as const)(
		'sets recovery after signal %s to active=%s',
		(reason, active) => {
			const started = beforeDelegationToolCall(createDelegationBarrierState(), {
				batchStartsChild: true,
				input: {},
				toolCallId: 'start-1',
				toolName: 'ensemblr_start_conversation',
			});
			const restored = restoreDelegationBarrierState(started.state);
			const settled = waitFor(restored, {
				completed: [
					{
						agentSessionId: 'child-1',
						signal:
							reason === null ? null : { message: 'Checks passed.', reason },
						status: 'idle',
					},
				],
				pending: [],
			});

			expect(delegationBarrierActive(settled)).toBe(active);
		},
	);
});
