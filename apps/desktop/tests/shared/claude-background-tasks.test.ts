import { describe, expect, it } from 'vitest';
import {
	activeBackgroundTasks,
	countActiveBackgroundTasks,
	createClaudeBackgroundTaskState,
	reduceClaudeBackgroundTasks,
} from '../../src/shared/claude-background-tasks.ts';
import type {
	AgentBackgroundTaskWire,
	AgentPersistedEnvelope,
} from '../../src/shared/ipc/contracts/agent-session.ts';

const task = (
	taskId: string,
	overrides: Partial<AgentBackgroundTaskWire> = {},
): AgentBackgroundTaskWire => ({
	description: `run ${taskId}`,
	taskId,
	taskType: 'local_bash',
	...overrides,
});

const level = (
	...tasks: readonly AgentBackgroundTaskWire[]
): AgentPersistedEnvelope => ({ kind: 'background-tasks', tasks });

const statusEnvelope = (
	status: 'idle' | 'starting' | 'streaming' | 'closed' | 'errored',
): AgentPersistedEnvelope => ({
	kind: 'status',
	previous: 'streaming',
	status,
});

describe('claude background tasks projection', () => {
	it('starts empty', () => {
		expect(createClaudeBackgroundTaskState().tasks).toEqual([]);
	});

	it('replaces its set with each reported level', () => {
		const one = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		expect(one.tasks.map((entry) => entry.taskId)).toEqual(['a']);

		const two = reduceClaudeBackgroundTasks(one, level(task('a'), task('b')));
		expect(two.tasks.map((entry) => entry.taskId)).toEqual(['a', 'b']);

		// The level is authoritative: `a` vanishing from the payload removes it,
		// with no stop edge anywhere in the stream.
		const dropped = reduceClaudeBackgroundTasks(two, level(task('b')));
		expect(dropped.tasks.map((entry) => entry.taskId)).toEqual(['b']);
	});

	it('empties when the runtime reports no live tasks', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a'), task('b')),
		);
		expect(reduceClaudeBackgroundTasks(withTasks, level()).tasks).toEqual([]);
	});

	it('holds object identity when an unchanged level is re-emitted', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		expect(reduceClaudeBackgroundTasks(withTasks, level(task('a')))).toBe(
			withTasks,
		);
	});

	it('re-renders when only the ambient flag flips', () => {
		const active = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		const flipped = reduceClaudeBackgroundTasks(
			active,
			level(task('a', { ambient: true })),
		);
		expect(flipped).not.toBe(active);
		expect(countActiveBackgroundTasks(flipped)).toBe(0);
	});

	it('excludes ambient housekeeping from the activity count and list', () => {
		const state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a'), task('watcher', { ambient: true }), task('b')),
		);
		expect(countActiveBackgroundTasks(state)).toBe(2);
		expect(activeBackgroundTasks(state).map((entry) => entry.taskId)).toEqual([
			'a',
			'b',
		]);
	});

	it('empties on a session starting, since the set is per runtime process', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		expect(
			reduceClaudeBackgroundTasks(withTasks, statusEnvelope('starting')).tasks,
		).toEqual([]);
	});

	it('empties on close, on error, and on shutdown', () => {
		const withTasks = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		expect(
			reduceClaudeBackgroundTasks(withTasks, statusEnvelope('closed')).tasks,
		).toEqual([]);
		expect(
			reduceClaudeBackgroundTasks(withTasks, statusEnvelope('errored')).tasks,
		).toEqual([]);
		expect(
			reduceClaudeBackgroundTasks(withTasks, {
				kind: 'shutdown',
				reason: 'manual',
			}).tasks,
		).toEqual([]);
	});

	it('survives a turn ending, which is the whole point', () => {
		const launched = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('a')),
		);
		const idle = reduceClaudeBackgroundTasks(launched, statusEnvelope('idle'));
		expect(idle).toBe(launched);
		expect(countActiveBackgroundTasks(idle)).toBe(1);
	});

	it('ignores events that say nothing about background tasks', () => {
		const state = createClaudeBackgroundTaskState();
		expect(
			reduceClaudeBackgroundTasks(state, statusEnvelope('streaming')),
		).toBe(state);
		expect(
			reduceClaudeBackgroundTasks(state, {
				kind: 'message',
				payload: { kind: 'text', text: 'hello' },
				role: 'agent',
			}),
		).toBe(state);
	});
});

describe('the disappearing-notice regression', () => {
	// The first cut kept the level only in the renderer's live projection, which
	// a snapshot re-seed replaces on every turn end. The notice therefore went
	// dark exactly when the agent stopped talking — the one moment it was the
	// only thing still saying the work was running. The reducer's half of the
	// fix is that an idle status moves nothing; the snapshot carries the rest.
	it('keeps its tasks across the whole turn-end sequence', () => {
		let state = reduceClaudeBackgroundTasks(
			createClaudeBackgroundTaskState(),
			level(task('bash_1')),
		);
		for (const status of ['streaming', 'idle'] as const) {
			state = reduceClaudeBackgroundTasks(state, statusEnvelope(status));
		}
		state = reduceClaudeBackgroundTasks(state, {
			kind: 'message',
			payload: {
				endsResponse: true,
				kind: 'message',
				parts: [],
				role: 'assistant',
			},
			role: 'agent',
		});
		expect(countActiveBackgroundTasks(state)).toBe(1);
	});
});
