import { describe, expect, it } from 'vitest';
import {
	countNestedToolCalls,
	dropEchoedSubagentReports,
	groupSubagentActivity,
	parentToolCallIdOf,
} from '@/renderer/lib/agent-timeline';
import type {
	ParentedDynamicToolUIPart,
	ParentedUIMessagePart,
	UIMessagePart,
} from '@/renderer/types/agent-timeline';

function toolPart(
	toolCallId: string,
	toolName: string,
	parentToolCallId?: string,
): UIMessagePart {
	return {
		input: {},
		...(parentToolCallId ? { parentToolCallId } : {}),
		state: 'input-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	} satisfies ParentedDynamicToolUIPart as UIMessagePart;
}

function settledToolPart(
	toolCallId: string,
	toolName: string,
	output: string,
): UIMessagePart {
	return {
		input: {},
		output: { details: null, text: output },
		state: 'output-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	} satisfies ParentedDynamicToolUIPart as UIMessagePart;
}

function textPart(text: string, parentToolCallId?: string): UIMessagePart {
	return {
		...(parentToolCallId ? { parentToolCallId } : {}),
		state: 'done',
		text,
		type: 'text',
	} satisfies ParentedUIMessagePart as UIMessagePart;
}

function reasoningPart(text: string, parentToolCallId?: string): UIMessagePart {
	return {
		...(parentToolCallId ? { parentToolCallId } : {}),
		state: 'done',
		text,
		type: 'reasoning',
	} satisfies ParentedUIMessagePart as UIMessagePart;
}

describe('parentToolCallIdOf', () => {
	it('reads main-thread parts as unowned', () => {
		expect(parentToolCallIdOf(toolPart('call-1', 'Grep'))).toBeNull();
	});

	it('ignores an empty link rather than treating it as an owner', () => {
		const part = { ...toolPart('call-1', 'Grep'), parentToolCallId: '' };
		expect(parentToolCallIdOf(part as UIMessagePart)).toBeNull();
	});

	it('reads the owning tool call when one is stamped', () => {
		expect(parentToolCallIdOf(toolPart('call-2', 'Grep', 'task-1'))).toBe(
			'task-1',
		);
	});
});

describe('groupSubagentActivity', () => {
	it('nests a subagent row under the task that spawned it', () => {
		const nodes = groupSubagentActivity([
			toolPart('task-1', 'Task'),
			toolPart('call-1', 'Grep', 'task-1'),
		]);

		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.key).toBe('t:task-1');
		expect(nodes[0]?.children.map((child) => child.key)).toEqual(['t:call-1']);
	});

	it('nests a subagent text part alongside its tool calls', () => {
		const nodes = groupSubagentActivity([
			toolPart('task-1', 'Task'),
			textPart('looking into it', 'task-1'),
			toolPart('call-1', 'Grep', 'task-1'),
		]);

		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.children).toHaveLength(2);
		expect(nodes[0]?.children[0]?.part.type).toBe('text');
	});

	it('leaves parts flat when no link is present, as before subagents nested', () => {
		const nodes = groupSubagentActivity([
			toolPart('call-1', 'Grep'),
			textPart('done'),
			toolPart('call-2', 'Read'),
		]);

		expect(nodes.map((node) => node.key)).toEqual([
			't:call-1',
			'p:1',
			't:call-2',
		]);
		expect(nodes.every((node) => node.children.length === 0)).toBe(true);
	});

	it('keeps an orphan at the top level when its parent never arrived', () => {
		const nodes = groupSubagentActivity([
			toolPart('call-1', 'Grep', 'task-missing'),
		]);

		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.key).toBe('t:call-1');
	});

	it('routes interleaved concurrent subagents to their own parents', () => {
		const nodes = groupSubagentActivity([
			toolPart('task-a', 'Task'),
			toolPart('task-b', 'Task'),
			toolPart('call-a1', 'Grep', 'task-a'),
			toolPart('call-b1', 'Read', 'task-b'),
			toolPart('call-a2', 'Glob', 'task-a'),
		]);

		expect(nodes.map((node) => node.key)).toEqual(['t:task-a', 't:task-b']);
		expect(nodes[0]?.children.map((child) => child.key)).toEqual([
			't:call-a1',
			't:call-a2',
		]);
		expect(nodes[1]?.children.map((child) => child.key)).toEqual(['t:call-b1']);
	});

	it('nests a grandchild when a subagent delegates again', () => {
		const nodes = groupSubagentActivity([
			toolPart('task-1', 'Task'),
			toolPart('task-2', 'Task', 'task-1'),
			toolPart('call-1', 'Grep', 'task-2'),
		]);

		expect(nodes).toHaveLength(1);
		const child = nodes[0]?.children[0];
		expect(child?.key).toBe('t:task-2');
		expect(child?.children.map((node) => node.key)).toEqual(['t:call-1']);
	});

	it('keeps a self-referencing part at the top level instead of looping', () => {
		const nodes = groupSubagentActivity([toolPart('task-1', 'Task', 'task-1')]);

		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.children).toHaveLength(0);
	});

	it('refuses to adopt a parent that appears after the child', () => {
		const nodes = groupSubagentActivity([
			toolPart('call-1', 'Grep', 'task-1'),
			toolPart('task-1', 'Task'),
		]);

		expect(nodes.map((node) => node.key)).toEqual(['t:call-1', 't:task-1']);
	});
});

describe('countNestedToolCalls', () => {
	it('counts tool calls at every depth', () => {
		const [root] = groupSubagentActivity([
			toolPart('task-1', 'Task'),
			toolPart('task-2', 'Task', 'task-1'),
			toolPart('call-1', 'Grep', 'task-2'),
			toolPart('call-2', 'Read', 'task-1'),
		]);

		expect(root).toBeDefined();
		expect(root ? countNestedToolCalls(root) : 0).toBe(3);
	});

	it('leaves forwarded prose and reasoning out of the count', () => {
		const [root] = groupSubagentActivity([
			toolPart('task-1', 'Task'),
			reasoningPart('weighing it up', 'task-1'),
			textPart('narrating progress', 'task-1'),
			toolPart('call-1', 'Grep', 'task-1'),
		]);

		expect(root?.children).toHaveLength(3);
		expect(root ? countNestedToolCalls(root) : 0).toBe(1);
	});
});

describe('dropEchoedSubagentReports', () => {
	it('drops the closing prose the delegation already carries as its result', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-1', 'Task', 'Found it in src/main/auth.ts'),
			toolPart('call-1', 'Grep', 'task-1'),
			textPart('Found it in src/main/auth.ts', 'task-1'),
		]);

		expect(parts.map((part) => part.type)).toEqual([
			'dynamic-tool',
			'dynamic-tool',
		]);
	});

	it('ignores surrounding whitespace when matching the report', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-1', 'Task', 'all done'),
			textPart('  all done\n', 'task-1'),
		]);

		expect(parts).toHaveLength(1);
	});

	it('keeps prose that differs from the report', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-1', 'Task', 'Found it in src/main/auth.ts'),
			textPart('checking the guards first', 'task-1'),
		]);

		expect(parts).toHaveLength(2);
	});

	it('keeps an earlier repeat and drops only the closing one', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-1', 'Task', 'done'),
			textPart('done', 'task-1'),
			toolPart('call-1', 'Grep', 'task-1'),
			textPart('done', 'task-1'),
		]);

		expect(parts.map((part) => part.type)).toEqual([
			'dynamic-tool',
			'text',
			'dynamic-tool',
		]);
	});

	it('keeps the prose while the delegation is still running', () => {
		const parts = dropEchoedSubagentReports([
			toolPart('task-1', 'Task'),
			textPart('all done', 'task-1'),
		]);

		expect(parts).toHaveLength(2);
	});

	it('leaves main-thread text alone even when it matches a result', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-1', 'Task', 'all done'),
			textPart('all done'),
		]);

		expect(parts).toHaveLength(2);
	});

	it('drops each delegation its own report when two ran', () => {
		const parts = dropEchoedSubagentReports([
			settledToolPart('task-a', 'Task', 'report a'),
			settledToolPart('task-b', 'Task', 'report b'),
			textPart('report b', 'task-b'),
			textPart('report a', 'task-a'),
		]);

		expect(parts.map((part) => part.type)).toEqual([
			'dynamic-tool',
			'dynamic-tool',
		]);
	});
});
