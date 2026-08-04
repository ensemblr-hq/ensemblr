import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';

import {
	ENSEMBLR_CONTROL_TOOL_NAMES,
	ensemblrToolGlyph,
	ensemblrToolLabel,
	isHiddenEnsemblrToolCall,
} from '../../src/renderer/lib/pi/ensemblr-tool-presentation';
import {
	glyphForToolCall,
	presentToolCall,
} from '../../src/renderer/lib/pi/tool-presentation';

const toolCall = (
	toolName: string,
	input: Record<string, unknown> = {},
	overrides: Partial<DynamicToolUIPart> = {},
): DynamicToolUIPart =>
	({
		input,
		output: { details: null, text: 'ok' },
		state: 'output-available',
		toolCallId: 'call-1',
		toolName,
		type: 'dynamic-tool',
		...overrides,
	}) as DynamicToolUIPart;

const transportFailure = (toolName: string): DynamicToolUIPart =>
	({
		errorText: 'denied-permission',
		input: {},
		state: 'output-error',
		toolCallId: 'call-1',
		toolName,
		type: 'dynamic-tool',
	}) as DynamicToolUIPart;

// The control extension answers a refused op with a normal tool result whose
// `details` carry `{ ok: false }` and never sets the transport's error flag, so
// a denial arrives as `output-available` with no `errorText` at all. This is the
// shape `toToolResult` produces once the wire normalizer and the tool-event
// mapper have flattened Pi's `{ content, details }` envelope.
const deniedCall = (
	toolName: string,
	code = 'denied-permission',
	error = 'The user declined the request.',
	input: Record<string, unknown> = {},
): DynamicToolUIPart =>
	({
		input,
		output: {
			details: { code, error, ok: false },
			text: `Error (${code}): ${error}`,
		},
		state: 'output-available',
		toolCallId: 'call-1',
		toolName,
		type: 'dynamic-tool',
	}) as DynamicToolUIPart;

describe('isHiddenEnsemblrToolCall', () => {
	test.each([
		'ensemblr_set_summary',
		'ensemblr_set_name',
		'ensemblr_set_branch_name',
	])('hides the successful bookkeeping call %s', (toolName) => {
		expect(isHiddenEnsemblrToolCall(toolCall(toolName))).toBe(true);
	});

	// The denial codes these tools return — denied-permission, denied-scope,
	// invalid-args — are the cases a user has to see, so a failure never hides.
	test.each([
		'ensemblr_set_summary',
		'ensemblr_set_name',
		'ensemblr_set_branch_name',
	])('keeps the denied bookkeeping call %s visible', (toolName) => {
		expect(isHiddenEnsemblrToolCall(deniedCall(toolName))).toBe(false);
	});

	test('keeps a bookkeeping call rejected for bad arguments visible', () => {
		expect(
			isHiddenEnsemblrToolCall(
				deniedCall(
					'ensemblr_set_branch_name',
					'invalid-args',
					'Branch name must be a slug.',
				),
			),
		).toBe(false);
	});

	test.each([
		'ensemblr_set_summary',
		'ensemblr_set_name',
		'ensemblr_set_branch_name',
	])('keeps the errored bookkeeping call %s visible', (toolName) => {
		expect(isHiddenEnsemblrToolCall(transportFailure(toolName))).toBe(false);
	});

	// Review work is the user's to see: a comment an agent files lands in their
	// Changes panel, so the row that filed it is not the app's own bookkeeping.
	test.each([
		'ensemblr_start_conversation',
		'ensemblr_wait_for_agents',
		'ensemblr_close_tab',
		'ensemblr_get_workspace_diff',
		'ensemblr_get_diff_comments',
		'ensemblr_add_diff_comments',
		'bash',
		'read',
	])('keeps %s visible', (toolName) => {
		expect(isHiddenEnsemblrToolCall(toolCall(toolName))).toBe(false);
	});
});

describe('ensemblrToolLabel', () => {
	test('names the action rather than the tool', () => {
		expect(ensemblrToolLabel('ensemblr_wait_for_agents', {}, false)).toEqual({
			glyph: 'bot',
			title: 'Waited for sub-agents',
		});
	});

	// A wait blocks for as long as its children run, so the settled past tense
	// over a turn that is still working describes something yet to happen.
	test('reads in the present participle while the call is in flight', () => {
		expect(ensemblrToolLabel('ensemblr_wait_for_agents', {}, true)?.title).toBe(
			'Waiting for sub-agents',
		);
	});

	test('carries both tenses for every control tool', () => {
		for (const toolName of ENSEMBLR_CONTROL_TOOL_NAMES) {
			const settled = ensemblrToolLabel(toolName, {}, false)?.title;
			const running = ensemblrToolLabel(toolName, {}, true)?.title;

			expect(settled).toBeTruthy();
			expect(running).toBeTruthy();
			expect(running).not.toBe(settled);
			expect(running?.endsWith('ing') || running?.includes('ing ')).toBe(true);
		}
	});

	test('reads the review tools as the review action taken', () => {
		expect(ensemblrToolLabel('ensemblr_get_workspace_diff', {}, false)).toEqual(
			{
				glyph: 'file-diff',
				title: 'Read the diff',
			},
		);
		expect(ensemblrToolLabel('ensemblr_get_diff_comments', {}, false)).toEqual({
			glyph: 'message-square-text',
			title: 'Read review comments',
		});
		expect(ensemblrToolLabel('ensemblr_add_diff_comments', {}, true)).toEqual({
			glyph: 'message-square-text',
			title: 'Leaving review comments',
		});
	});

	test('folds the file under review into the diff label', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_get_workspace_diff',
				{ file: 'src/main/main.ts' },
				false,
			)?.title,
		).toBe('Read the diff: src/main/main.ts');
	});

	test('folds the spawned tab title into the label', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_start_conversation',
				{ title: 'Astro config audit' },
				false,
			),
		).toEqual({
			glyph: 'bot',
			title: 'Started a sub-agent: Astro config audit',
		});
	});

	test('keeps the detail when the call is still running', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_start_conversation',
				{ title: 'Astro config audit' },
				true,
			)?.title,
		).toBe('Starting a sub-agent: Astro config audit');
	});

	test('collapses whitespace and truncates an over-long detail', () => {
		const label = ensemblrToolLabel(
			'ensemblr_start_conversation',
			{
				title: `Investigate  how\nthe renderer resolves workspace paths end to end`,
			},
			false,
		);

		expect(
			label?.title.startsWith('Started a sub-agent: Investigate how the'),
		).toBe(true);
		expect(label?.title.endsWith('…')).toBe(true);
		expect(label?.title.length).toBeLessThanOrEqual(70);
	});

	test('omits the detail when the named key is absent or blank', () => {
		expect(
			ensemblrToolLabel('ensemblr_start_conversation', {}, false)?.title,
		).toBe('Started a sub-agent');
		expect(
			ensemblrToolLabel('ensemblr_start_conversation', { title: '   ' }, false)
				?.title,
		).toBe('Started a sub-agent');
	});

	test('returns null for a tool that is not a control tool', () => {
		expect(ensemblrToolLabel('bash', { command: 'ls' }, false)).toBeNull();
		expect(ensemblrToolGlyph('bash')).toBeNull();
	});
});

describe('presentToolCall on control tools', () => {
	// The generic extension row titles itself with the raw wire name, which is
	// what put "ensemblr_start_conversation" in front of the user.
	test('replaces the raw wire name with the human title', () => {
		const presentation = presentToolCall(
			toolCall('ensemblr_start_conversation', { title: 'Astro audit' }),
		);

		expect(presentation.title).toBe('Started a sub-agent: Astro audit');
		expect(presentation.glyph).toBe('bot');
	});

	test('gives every control tool a glyph other than the generic wrench', () => {
		for (const toolName of [
			'ensemblr_start_conversation',
			'ensemblr_wait_for_agents',
			'ensemblr_focus_tab',
			'ensemblr_set_workspace_status',
			'ensemblr_ask_user_question',
			'ensemblr_list_models',
			'ensemblr_exit_plan_mode',
		]) {
			expect(glyphForToolCall(toolCall(toolName))).not.toBe('wrench');
		}
	});

	// A failure short-circuits before the label, on purpose: the raw tool name is
	// what makes a denial diagnosable.
	test('keeps the raw name and failure mark on an errored control call', () => {
		const presentation = presentToolCall(
			transportFailure('ensemblr_set_summary'),
		);

		expect(presentation.title).toBe('Ensemblr set summary failed');
		expect(presentation.glyph).toBe('circle-x');
		expect(presentation.tone).toBe('destructive');
	});

	// A sub-agent's plan submission is refused by scope, and the refusal arrives
	// as an ordinary result. Titling it "Submitted a plan" tells the user a
	// review panel is coming that never appears.
	test('never titles a denied control call as the action it was refused', () => {
		const presentation = presentToolCall(
			deniedCall(
				'ensemblr_exit_plan_mode',
				'denied-scope',
				'Sub-agents cannot submit a plan.',
				{ plan: '# Plan', title: 'Rewrite the mapper' },
			),
		);

		expect(presentation.title).toBe('Ensemblr exit plan mode failed');
		expect(presentation.title).not.toContain('Submitted');
		expect(presentation.tone).toBe('destructive');
		expect(presentation.glyph).toBe('circle-x');
	});

	test('surfaces the denial reason as the preview and the body', () => {
		const presentation = presentToolCall(
			deniedCall('ensemblr_close_tab', 'denied-permission'),
		);

		expect(presentation.preview).toEqual({
			font: 'mono',
			text: 'The user declined the request.',
		});
		expect(presentation.body).toEqual({
			kind: 'error',
			text: 'The user declined the request.',
		});
	});

	// An envelope that reported no reason still has to read as a failure rather
	// than fall back through to the success title.
	test('falls back to the result text when the envelope names no reason', () => {
		const presentation = presentToolCall({
			input: {},
			output: {
				details: { code: 'internal', ok: false },
				text: 'Error (internal): control channel unreachable',
			},
			state: 'output-available',
			toolCallId: 'call-1',
			toolName: 'ensemblr_focus_tab',
			type: 'dynamic-tool',
		} as DynamicToolUIPart);

		expect(presentation.tone).toBe('destructive');
		expect(presentation.preview?.text).toBe(
			'Error (internal): control channel unreachable',
		);
	});

	test('marks a denied control call with the failure glyph in the summary', () => {
		expect(glyphForToolCall(deniedCall('ensemblr_start_conversation'))).toBe(
			'circle-x',
		);
	});

	test('leaves a succeeding control call reading as the action taken', () => {
		const presentation = presentToolCall({
			input: { title: 'Astro audit' },
			output: {
				details: { data: { conversationId: 'c1' }, ok: true },
				text: '{"conversationId":"c1"}',
			},
			state: 'output-available',
			toolCallId: 'call-1',
			toolName: 'ensemblr_start_conversation',
			type: 'dynamic-tool',
		} as DynamicToolUIPart);

		expect(presentation.title).toBe('Started a sub-agent: Astro audit');
		expect(presentation.tone).toBe('default');
		expect(presentation.glyph).toBe('bot');
	});

	// A non-control tool is free to answer with its own `ok` field, and that
	// field says nothing about whether the app refused anything.
	test('ignores an ok field on a tool outside the control channel', () => {
		const presentation = presentToolCall({
			input: { command: 'ls' },
			output: { details: { ok: false }, text: 'no such file' },
			state: 'output-available',
			toolCallId: 'call-1',
			toolName: 'bash',
			type: 'dynamic-tool',
		} as DynamicToolUIPart);

		expect(presentation.tone).toBe('default');
		expect(presentation.glyph).toBe('terminal');
	});

	test('leaves a non-control tool title untouched', () => {
		expect(
			presentToolCall(toolCall('read', { path: 'src/main.ts' })).title,
		).not.toContain('sub-agent');
	});
});
