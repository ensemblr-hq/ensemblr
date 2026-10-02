import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';

import { foldTaskPlanRuns } from '../../src/renderer/lib/agent-timeline/task-plan-runs';
import { presentTaskPlan } from '../../src/renderer/lib/agent-timeline/task-tool-presenters';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import type { TimelineActivityNode } from '../../src/renderer/types/agent-timeline';

function call(
	toolName: string,
	input: Record<string, unknown>,
	output?: string,
	toolCallId = `${toolName}-1`,
): DynamicToolUIPart {
	if (output === undefined) {
		return {
			input,
			state: 'input-available',
			toolCallId,
			toolName,
			type: 'dynamic-tool',
		};
	}
	return {
		input,
		output: { details: null, text: output },
		state: 'output-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	};
}

function failedCall(toolName: string, input: Record<string, unknown>) {
	return {
		errorText: 'Task subject is required.',
		input,
		state: 'output-error',
		toolCallId: `${toolName}-err`,
		toolName,
		type: 'dynamic-tool',
	} as unknown as DynamicToolUIPart;
}

function node(part: DynamicToolUIPart, children: TimelineActivityNode[] = []) {
	return { children, key: `t:${part.toolCallId}`, part };
}

const TASK_LIST_OUTPUT =
	'#1 [completed] Register the presenters\n#2 [in_progress] Fold the run\n#3 [pending] Fill ru and el';

describe('task tool presenters', () => {
	test('titles a created task with the number the harness assigned', () => {
		const presentation = presentToolCall(
			call(
				'TaskCreate',
				{ description: 'Register every verb.', subject: 'Add presenters' },
				'Task #4 created successfully: Add presenters',
			),
		);

		expect(presentation.title).toBe('Task #4: Add presenters');
		expect(presentation.glyph).toBe('clipboard-list');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Register every verb.',
		});
		expect(presentation.body).toEqual({
			kind: 'markdown',
			text: 'Register every verb.',
		});
	});

	test('names a created task before the harness has answered with a number', () => {
		const presentation = presentToolCall(
			call('TaskCreate', { description: 'Do it.', subject: 'Add presenters' }),
		);

		expect(presentation.title).toBe('Task: Add presenters');
		expect(presentation.body).toEqual({ kind: 'pending' });
	});

	// The sub-agent tool shares the prefix but nothing else. Matching the whole
	// name is what keeps a task row from claiming a delegate ran.
	test('leaves the sub-agent Task tool presenting as a sub-agent', () => {
		const presentation = presentToolCall(
			call(
				'Task',
				{ description: 'Audit the imports', subagent_type: 'explorer' },
				'Found three.',
			),
		);

		expect(presentation.title).toBe('Sub-agent: explorer');
		expect(presentation.glyph).toBe('bot');
	});

	test('titles an update with the transition rather than the payload', () => {
		const presentation = presentToolCall(
			call(
				'TaskUpdate',
				{ status: 'in_progress', taskId: '2' },
				'Updated task #2 status',
			),
		);

		expect(presentation.title).toBe('Task #2 → In progress');
		expect(presentation.glyph).toBe('message-square-check');
		expect(presentation.preview).toBeNull();
	});

	test('names a deleted task as deleted rather than as unknown', () => {
		const presentation = presentToolCall(
			call('TaskUpdate', { status: 'deleted', taskId: '7' }, 'Deleted task #7'),
		);

		expect(presentation.title).toBe('Task #7 → Deleted');
	});

	// The two updates the tool's own docs give as worked examples — claiming a
	// task and wiring a dependency — name nothing in their arguments worth
	// painting, so the row would otherwise read as a bare number.
	test('previews what the harness reported when an update names no field', () => {
		const presentation = presentToolCall(
			call(
				'TaskUpdate',
				{ addBlockedBy: ['1'], owner: 'reviewer', taskId: '2' },
				'Updated task #2 owner, blockedBy',
			),
		);

		expect(presentation.title).toBe('Task #2');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Updated task #2 owner, blockedBy',
		});
	});

	test('titles a transition with no number without a stray hash', () => {
		const presentation = presentToolCall(
			call('TaskUpdate', { status: 'completed' }, 'Updated'),
		);

		expect(presentation.title).toBe('Task → Completed');
	});

	test('previews the new subject when an update renames a task', () => {
		const presentation = presentToolCall(
			call('TaskUpdate', { subject: 'Fold the run', taskId: '2' }, 'Updated'),
		);

		expect(presentation.title).toBe('Task #2: Fold the run');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Fold the run',
		});
	});

	test('reads a task list as a checklist rather than as prose', () => {
		const presentation = presentToolCall(
			call('TaskList', {}, TASK_LIST_OUTPUT),
		);

		expect(presentation.title).toBe('3 tasks');
		expect(presentation.glyph).toBe('list');
		expect(presentation.body).toEqual({
			items: [
				{
					detail: null,
					id: 'task:1',
					number: '1',
					status: 'completed',
					subject: 'Register the presenters',
				},
				{
					detail: null,
					id: 'task:2',
					number: '2',
					status: 'in-progress',
					subject: 'Fold the run',
				},
				{
					detail: null,
					id: 'task:3',
					number: '3',
					status: 'pending',
					subject: 'Fill ru and el',
				},
			],
			kind: 'checklist',
		});
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Register the presenters · Fold the run · Fill ru and el',
		});
	});

	// A listed task reports its owner and blockers inline. Both are the harness
	// talking, and leaving them on the subject puts them in the collapsed preview
	// as well as in the checklist.
	test('lifts the owner off a listed subject and drops the blocker note', () => {
		const presentation = presentToolCall(
			call(
				'TaskList',
				{},
				'#1 [pending] Probe the payloads\n#2 [pending] Blocked follow-up (reviewer) [blocked by #1]',
			),
		);

		expect(presentation.body).toEqual({
			items: [
				{
					detail: null,
					id: 'task:1',
					number: '1',
					status: 'pending',
					subject: 'Probe the payloads',
				},
				{
					detail: 'reviewer',
					id: 'task:2',
					number: '2',
					status: 'pending',
					subject: 'Blocked follow-up',
				},
			],
			kind: 'checklist',
		});
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Probe the payloads · Blocked follow-up',
		});
	});

	test('says an empty task list is empty instead of opening onto nothing', () => {
		const presentation = presentToolCall(call('TaskList', {}, ''));

		expect(presentation.title).toBe('Task list');
		expect(presentation.preview).toEqual({ font: 'sans', text: 'No tasks' });
		expect(presentation.body).toEqual({ kind: 'empty' });
	});

	test('reads a fetched task into its title, state, and description', () => {
		const presentation = presentToolCall(
			call(
				'TaskGet',
				{ taskId: '2' },
				'Task #2: Fold the run\nStatus: in_progress\nDescription: Collapse a\ncontiguous run into one card.',
			),
		);

		expect(presentation.title).toBe('Task #2: Fold the run');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'In progress',
		});
		expect(presentation.body).toEqual({
			kind: 'markdown',
			text: 'Collapse a\ncontiguous run into one card.',
		});
	});

	// A task with dependencies reports `Blocks:` straight after the description,
	// which wraps across lines — so the description ends at the next field, not at
	// the end of the block.
	test('stops a fetched description at the field that follows it', () => {
		const presentation = presentToolCall(
			call(
				'TaskGet',
				{ taskId: '1' },
				'Task #1: Probe the payloads\nStatus: pending\nDescription: Ground truth for the parsers.\nSecond line of the description.\nBlocks: #2',
			),
		);

		expect(presentation.body).toEqual({
			kind: 'markdown',
			text: 'Ground truth for the parsers.\nSecond line of the description.',
		});
	});

	test('falls back to the named task when a get answers in an unknown shape', () => {
		const presentation = presentToolCall(
			call('TaskGet', { taskId: '9' }, 'No such task.'),
		);

		expect(presentation.title).toBe('Task #9');
		expect(presentation.body).toEqual({
			kind: 'markdown',
			text: 'No such task.',
		});
	});

	test('renders background-task output on the terminal body', () => {
		const presentation = presentToolCall(
			call('TaskOutput', { task_id: 'bash_3' }, 'npm test\n2 passing\n'),
		);

		expect(presentation.title).toBe('Task output: bash_3');
		expect(presentation.glyph).toBe('scroll-text');
		expect(presentation.body).toEqual({
			kind: 'terminal',
			text: 'npm test\n2 passing\n',
		});
	});

	test('keeps whether a stop took on the collapsed row', () => {
		const presentation = presentToolCall(
			call('TaskStop', { shell_id: 'bash_3' }, 'Successfully stopped bash_3'),
		);

		expect(presentation.title).toBe('Stopped task bash_3');
		expect(presentation.glyph).toBe('circle-stop');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Successfully stopped bash_3',
		});
		expect(presentation.body).toEqual({ kind: 'empty' });
	});

	test('marks every task verb without a part to project', () => {
		expect(glyphForToolName('TaskCreate')).toBe('clipboard-list');
		expect(glyphForToolName('taskupdate')).toBe('message-square-check');
		expect(glyphForToolName('TaskStop')).toBe('circle-stop');
		expect(glyphForToolName('Task')).toBe('bot');
	});
});

describe('presentTaskPlan', () => {
	test('lists every subject a run of creations filed', () => {
		const presentation = presentTaskPlan([
			call(
				'TaskCreate',
				{ description: 'Register every verb.', subject: 'Add presenters' },
				'Task #1 created successfully: Add presenters',
				'c1',
			),
			call('TaskCreate', { subject: 'Fold the run' }, 'Task #2 created', 'c2'),
		]);

		expect(presentation.title).toBe('Planned 2 tasks');
		expect(presentation.glyph).toBe('clipboard-list');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Add presenters · Fold the run',
		});
		expect(presentation.body).toEqual({
			items: [
				{
					detail: 'Register every verb.',
					id: 'c1',
					number: '1',
					status: 'pending',
					subject: 'Add presenters',
				},
				{
					detail: null,
					id: 'c2',
					number: '2',
					status: 'pending',
					subject: 'Fold the run',
				},
			],
			kind: 'checklist',
		});
	});
});

describe('foldTaskPlanRuns', () => {
	const creation = (id: string, subject: string) =>
		node(call('TaskCreate', { subject }, `Task #1 created`, id));

	test('folds a contiguous run into one plan row', () => {
		const rows = foldTaskPlanRuns([
			creation('c1', 'One'),
			creation('c2', 'Two'),
			creation('c3', 'Three'),
		]);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe('task-plan');
		expect(rows[0]?.kind === 'task-plan' ? rows[0].parts : []).toHaveLength(3);
	});

	test('leaves a lone creation as its own row', () => {
		const rows = foldTaskPlanRuns([creation('c1', 'One')]);

		expect(rows).toEqual([
			{ key: 't:c1', kind: 'node', node: expect.anything() },
		]);
	});

	test('breaks a run where another call interrupts it', () => {
		const rows = foldTaskPlanRuns([
			creation('c1', 'One'),
			creation('c2', 'Two'),
			node(call('Bash', { command: 'ls' }, 'README.md', 'b1')),
			creation('c3', 'Three'),
			creation('c4', 'Four'),
		]);

		expect(rows.map((row) => row.kind)).toEqual([
			'task-plan',
			'node',
			'task-plan',
		]);
	});

	// A failed creation filed no task, so folding it into a plan would list one
	// that does not exist and hide the reason it does not.
	test('keeps a failed creation on its own destructive row', () => {
		const rows = foldTaskPlanRuns([
			creation('c1', 'One'),
			node(failedCall('TaskCreate', { subject: '' })),
			creation('c2', 'Two'),
		]);

		expect(rows.map((row) => row.kind)).toEqual(['node', 'node', 'node']);
	});

	test('passes rows that are not creations through untouched', () => {
		const rows = foldTaskPlanRuns([
			node(call('Read', { path: 'a.ts' }, 'a', 'r1')),
			node(call('TaskList', {}, TASK_LIST_OUTPUT, 'l1')),
		]);

		expect(rows.map((row) => row.key)).toEqual(['t:r1', 't:l1']);
	});
});
