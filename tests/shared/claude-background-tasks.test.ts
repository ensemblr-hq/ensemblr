import { describe, expect, it } from 'vitest';
import {
	createClaudeBackgroundTaskState,
	reduceClaudeBackgroundTasks,
} from '../../src/shared/claude-background-tasks.ts';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-session.ts';

const toolResult = (
	toolCallId: string,
	output: unknown,
	isError = false,
): AgentPersistedEnvelope => ({
	kind: 'message',
	payload: {
		isError,
		kind: 'tool-result',
		output,
		toolCallId,
	},
	role: 'tool',
});

const statusEnvelope = (
	status: 'idle' | 'starting' | 'streaming' | 'closed' | 'errored',
): AgentPersistedEnvelope => ({
	kind: 'status',
	previous: 'streaming',
	status,
});

describe('claude background tasks projection', () => {
	it('starts with an empty live-task set', () => {
		expect(createClaudeBackgroundTaskState().liveTaskIds.size).toBe(0);
	});

	it('records a background bash launch by its structured task id', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-1', {
				content: [{ text: 'Command running in background' }],
				details: { backgroundTaskId: 'bash_1' },
			}),
		);
		expect([...state.liveTaskIds]).toEqual(['bash_1']);
	});

	it('records an agent async launch via agentId + isAsync', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-2', {
				content: [{ text: 'Agent launched' }],
				details: { agentId: 'agent_9', isAsync: true },
			}),
		);
		expect([...state.liveTaskIds]).toEqual(['agent_9']);
	});

	it('ignores an agent result without the isAsync flag', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-3', {
				content: [],
				details: { agentId: 'agent_x' },
			}),
		);
		expect(state.liveTaskIds.size).toBe(0);
	});

	it('falls back to a text parse when no details bag is present', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult(
				'call-4',
				'Command running in the background. shell ID: bash_7',
			),
		);
		expect([...state.liveTaskIds]).toEqual(['bash_7']);
	});

	it('clears a task when TaskStop reports it stopped', () => {
		const withOne = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-5', {
				content: [],
				details: { backgroundTaskId: 'bash_2' },
			}),
		);
		const cleared = reduceClaudeBackgroundTasks(
			withOne,
			toolResult('call-6', {
				content: [{ text: 'stopped' }],
				details: { stopped: true, taskId: 'bash_2' },
			}),
		);
		expect(cleared.liveTaskIds.size).toBe(0);
	});

	it('clears a task when TaskOutput reports a terminal status', () => {
		const withOne = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-7', {
				content: [],
				details: { backgroundTaskId: 'bash_3' },
			}),
		);
		const cleared = reduceClaudeBackgroundTasks(
			withOne,
			toolResult('call-8', {
				content: [{ text: 'exit 0' }],
				details: { status: 'completed', taskId: 'bash_3' },
			}),
		);
		expect(cleared.liveTaskIds.size).toBe(0);
	});

	it('does not clear when TaskOutput reports the task still running', () => {
		const withOne = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-9', {
				content: [],
				details: { backgroundTaskId: 'bash_4' },
			}),
		);
		const polled = reduceClaudeBackgroundTasks(
			withOne,
			toolResult('call-10', {
				content: [{ text: 'still running' }],
				details: { status: 'running', taskId: 'bash_4' },
			}),
		);
		expect([...polled.liveTaskIds]).toEqual(['bash_4']);
	});

	it('holds many concurrent tasks and removes them one at a time', () => {
		let state = createClaudeBackgroundTaskState();
		for (const id of ['bash_a', 'bash_b', 'bash_c']) {
			state = reduceClaudeBackgroundTasks(
				state,
				toolResult(`call-${id}`, {
					content: [],
					details: { backgroundTaskId: id },
				}),
			);
		}
		expect(state.liveTaskIds.size).toBe(3);
		state = reduceClaudeBackgroundTasks(
			state,
			toolResult('call-stop-b', {
				content: [],
				details: { stopped: true, taskId: 'bash_b' },
			}),
		);
		expect([...state.liveTaskIds].sort()).toEqual(['bash_a', 'bash_c']);
	});

	it('clears every live task on session shutdown', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-11', {
				content: [],
				details: { backgroundTaskId: 'bash_5' },
			}),
		);
		const shutdown = reduceClaudeBackgroundTasks(withTasks, {
			kind: 'shutdown',
			reason: 'manual',
		});
		expect(shutdown.liveTaskIds.size).toBe(0);
	});

	it('clears every live task on a closed status', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult('call-12', {
				content: [],
				details: { backgroundTaskId: 'bash_6' },
			}),
		);
		const closed = reduceClaudeBackgroundTasks(
			withTasks,
			statusEnvelope('closed'),
		);
		expect(closed.liveTaskIds.size).toBe(0);
	});

	it('returns the same object for irrelevant events', () => {
		const state = createClaudeBackgroundTaskState();
		const after = reduceClaudeBackgroundTasks(state, statusEnvelope('idle'));
		expect(after).toBe(state);
	});

	it('ignores a tool-result flagged as an error', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			toolResult(
				'call-13',
				{
					content: [],
					details: { backgroundTaskId: 'bash_x' },
				},
				true,
			),
		);
		expect(state.liveTaskIds.size).toBe(0);
	});
});
