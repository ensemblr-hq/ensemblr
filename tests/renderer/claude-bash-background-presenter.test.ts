import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';

import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';

function callWithDetails(
	toolName: string,
	input: Record<string, unknown>,
	output: { text: string; details: Record<string, unknown> | null },
	toolCallId = `${toolName}-1`,
): DynamicToolUIPart {
	return {
		input,
		output,
		state: 'output-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	};
}

describe('Claude Code background Bash presenters', () => {
	test('presents a run_in_background Bash call as a background launch', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Bash',
				{ command: 'sleep 60', run_in_background: true },
				{
					text: 'Command running in the background',
					details: { backgroundTaskId: 'bash_1' },
				},
			),
		);

		expect(presentation.title).toContain('Start background shell');
		expect(presentation.glyph).toBe('play');
		expect(presentation.preview).toEqual({
			font: 'mono',
			text: 'bash_1 · sleep 60',
		});
	});

	test('a background launch with no reported id previews the command alone', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Bash',
				{ command: 'sleep 60', run_in_background: true },
				{ text: 'Command running in the background', details: null },
			),
		);

		expect(presentation.preview).toEqual({ font: 'mono', text: 'sleep 60' });
	});

	test('presents an auto-backgrounded Bash call with the auto title', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Bash',
				{ command: 'npm test' },
				{
					text: 'Command auto-backgrounded after 120s',
					details: { backgroundTaskId: 'bash_2', timedOutAfterMs: 120_000 },
				},
			),
		);

		expect(presentation.title).toContain('Auto-backgrounded shell');
		expect(presentation.glyph).toBe('play');
	});

	test('foreground Bash keeps the ordinary shell title and appends exit code', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Bash',
				{ command: 'ls -a' },
				{ text: 'listing', details: { exitCode: 2 } },
			),
		);

		expect(presentation.title).toContain('exit 2');
		expect(presentation.title).not.toContain('background');
	});

	test('foreground Bash keeps the translated title over the SDK description', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Bash',
				{ command: 'git status', description: 'Show working tree status' },
				{ text: 'clean', details: null },
			),
		);

		expect(presentation.title).toBe('Checking git status');
	});

	test('BashOutput routes through the TaskOutput presenter alias', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'BashOutput',
				{ bash_id: 'bash_9' },
				{ text: 'stdout', details: null },
			),
		);

		expect(presentation.title).toContain('bash_9');
	});

	test('KillShell routes through the TaskStop presenter alias', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'KillShell',
				{ shell_id: 'bash_9' },
				{ text: 'stopped', details: null },
			),
		);

		expect(presentation.title).toContain('bash_9');
	});
});

describe('Agent async launch presenter', () => {
	test('presents a run_in_background Agent call as an async launch', () => {
		const presentation = presentToolCall(
			callWithDetails(
				'Agent',
				{ prompt: 'Investigate the flake', run_in_background: true },
				{
					text: 'Agent launched',
					details: {
						agentId: 'agent_1',
						isAsync: true,
						outputFile: '/tmp/agent-1.log',
					},
				},
			),
		);

		expect(presentation.title).toContain('async sub-agent');
		expect(presentation.preview?.text).toContain('agent_1');
	});
});
