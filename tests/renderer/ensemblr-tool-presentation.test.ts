import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';

import {
	canonicalEnsemblrToolName,
	ENSEMBLR_CONTROL_TOOL_NAMES,
	ensemblrToolGlyph,
	ensemblrToolLabel,
	isHiddenEnsemblrToolCall,
} from '../../src/renderer/lib/agent-timeline/ensemblr-tool-presentation';
import {
	glyphForToolCall,
	presentToolCall,
} from '../../src/renderer/lib/agent-timeline/tool-presentation';

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

// Claude Code reaches the control server over MCP, where the SDK namespaces
// every tool by its server: the same call Pi reports as `ensemblr_set_name`
// arrives as `mcp__ensemblr__ensemblr_set_name`.
const mcpName = (toolName: string) => `mcp__ensemblr__${toolName}`;

describe('canonicalEnsemblrToolName', () => {
	test('passes through the name the extension registered', () => {
		expect(canonicalEnsemblrToolName('ensemblr_set_name')).toBe(
			'ensemblr_set_name',
		);
	});

	test('unwraps the MCP namespacing a harness adds', () => {
		expect(canonicalEnsemblrToolName(mcpName('ensemblr_wait_for_agents'))).toBe(
			'ensemblr_wait_for_agents',
		);
	});

	test('resolves every control tool through the wrapped form', () => {
		for (const toolName of ENSEMBLR_CONTROL_TOOL_NAMES) {
			expect(canonicalEnsemblrToolName(mcpName(toolName))).toBe(toolName);
		}
	});

	// A slice that names no registered tool must not borrow a label from one.
	test('refuses a name that only carries the prefix', () => {
		expect(canonicalEnsemblrToolName('mcp__other__load_ensemblr_config')).toBe(
			null,
		);
		expect(canonicalEnsemblrToolName('ensemblr_not_a_real_tool')).toBe(null);
		expect(canonicalEnsemblrToolName('bash')).toBe(null);
	});
});

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

	// Bookkeeping the app asks for on its own behalf has to fold away whichever
	// runtime made the call, or half the turns show the rows the other hides.
	test.each([
		'ensemblr_set_summary',
		'ensemblr_set_name',
		'ensemblr_set_branch_name',
	])('hides the MCP-namespaced bookkeeping call %s', (toolName) => {
		expect(isHiddenEnsemblrToolCall(toolCall(mcpName(toolName)))).toBe(true);
	});

	test('keeps a denied MCP-namespaced bookkeeping call visible', () => {
		expect(
			isHiddenEnsemblrToolCall(deniedCall(mcpName('ensemblr_set_branch_name'))),
		).toBe(false);
	});
});

describe('ensemblrToolLabel', () => {
	test('names the action rather than the tool', () => {
		expect(ensemblrToolLabel('ensemblr_wait_for_agents', {}, false)).toEqual({
			badge: null,
			glyph: 'hourglass',
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
				badge: null,
				glyph: 'file-diff',
				title: 'Read the diff',
			},
		);
		expect(ensemblrToolLabel('ensemblr_get_diff_comments', {}, false)).toEqual({
			badge: null,
			glyph: 'message-square-text',
			title: 'Read review comments',
		});
		expect(ensemblrToolLabel('ensemblr_add_diff_comments', {}, true)).toEqual({
			badge: null,
			glyph: 'message-square-plus',
			title: 'Leaving review comments',
		});
	});

	// The identifier is the whole point of a Linear row: `Updated a Linear issue`
	// says nothing a user can act on, while `Updated a Linear issue: THE-106` is
	// the ticket they can go and look at.
	test('reads the Linear tools with the ticket they acted on', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_linear_update_issue',
				{ issueId: 'THE-106', stateId: 's-review' },
				false,
			),
		).toEqual({
			badge: null,
			glyph: 'ticket-check',
			title: 'Updated a Linear issue: THE-106',
		});
		expect(
			ensemblrToolLabel(
				'ensemblr_linear_create_comment',
				{ commentBody: 'shipped', issueId: 'THE-106' },
				true,
			)?.title,
		).toBe('Commenting on a Linear issue: THE-106');
		expect(
			ensemblrToolLabel(
				'ensemblr_linear_list_issues',
				{ query: 'composer' },
				false,
			)?.title,
		).toBe('Searched Linear issues: composer');
		expect(
			ensemblrToolLabel('ensemblr_linear_get_metadata', {}, false),
		).toEqual({
			badge: null,
			glyph: 'list',
			title: 'Read Linear teams and states',
		});
	});

	// `id`, `identifier`, and `search` are the near-misses the control boundary
	// rewrites, and the timeline records what the model sent, not the rewrite.
	test('reads the forgiven spelling of a Linear argument', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_linear_get_issue',
				{ identifier: 'THE-42' },
				false,
			)?.title,
		).toBe('Read a Linear issue: THE-42');
		expect(
			ensemblrToolLabel(
				'ensemblr_linear_list_issues',
				{ search: 'diff' },
				false,
			)?.title,
		).toBe('Searched Linear issues: diff');
	});

	// A path in the title is a string the reader cannot open and cannot see the
	// end of once the row truncates it. The chip is the same one a `write` row
	// carries, so the file reads and opens the same way whichever tool named it.
	test('pins the file under review as a chip rather than title text', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_get_workspace_diff',
				{ filePath: 'src/main/main.ts' },
				false,
			),
		).toEqual({
			badge: {
				additions: null,
				deletions: null,
				kind: 'file',
				path: 'src/main/main.ts',
			},
			glyph: 'file-diff',
			title: 'Read the diff',
		});
	});

	// `file` and `path` are the near-misses the control boundary rewrites to
	// `filePath`, and the timeline records what the model sent, not the rewrite.
	test('reads the forgiven spelling of a path argument', () => {
		const label = ensemblrToolLabel(
			'ensemblr_get_diff_comments',
			{ file: 'src/main/main.ts' },
			false,
		);

		expect(label?.badge?.path).toBe('src/main/main.ts');
		expect(label?.title).toBe('Read review comments');
	});

	// All three `open_tab` variants take a path, so a row showing only the file
	// cannot say whether it opened a preview, a diff, or a comment. The chip and
	// the title are separate slots — the variant does not have to yield the one to
	// hold the other.
	test('names the variant and the file it opened in their own slots', () => {
		const withFile = ensemblrToolLabel(
			'ensemblr_open_tab',
			{ filePath: 'src/main/main.ts', variant: 'diff' },
			false,
		);
		const withoutFile = ensemblrToolLabel(
			'ensemblr_open_tab',
			{ variant: 'comment' },
			false,
		);

		expect(withFile?.badge?.path).toBe('src/main/main.ts');
		expect(withFile?.title).toBe('Opened a tab: diff');
		expect(withoutFile?.badge).toBeNull();
		expect(withoutFile?.title).toBe('Opened a tab: comment');
	});

	test('reads the arguments the control surface actually names', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_launch_harness',
				{ harnessId: 'claude' },
				true,
			)?.title,
		).toBe('Launching a harness: claude');
		expect(
			ensemblrToolLabel(
				'ensemblr_write_terminal',
				{ input: 'npm run check', terminalId: 't1' },
				false,
			)?.title,
		).toBe('Typed into a terminal: npm run check');
		expect(
			ensemblrToolLabel('ensemblr_focus_panel', { panel: 'changes' }, false)
				?.title,
		).toBe('Focused a panel: changes');
	});

	// One call files comments across as many files as the reviewer touched, so
	// naming the first one labels the row with a file the body below it mostly is
	// not about.
	test('names no file on a batch spanning several', () => {
		const label = ensemblrToolLabel(
			'ensemblr_add_diff_comments',
			{
				comments: [
					{ body: 'This leaks.', filePath: 'src/main/main.ts', lineNumber: 4 },
					{ body: 'Same here.', filePath: 'src/main/ipc.ts', lineNumber: 9 },
				],
			},
			false,
		);

		expect(label?.title).toBe('Left review comments');
		expect(label?.badge).toBeNull();
	});

	// The objection above only holds while the batch disagrees. A pass that stayed
	// in one file — the common one — names it, the same chip a single-path tool
	// would have pinned.
	test('pins the file a batch agreed on', () => {
		const label = ensemblrToolLabel(
			'ensemblr_add_diff_comments',
			{
				comments: [
					{ body: 'This leaks.', filePath: 'src/main/main.ts', lineNumber: 4 },
					{ body: 'And here.', filePath: 'src/main/main.ts', lineNumber: 9 },
				],
			},
			false,
		);

		expect(label?.title).toBe('Left review comments');
		expect(label?.badge?.path).toBe('src/main/main.ts');
	});

	// A question is a sentence, and a sentence cut to the title's length reads as
	// less than the bare action does, so the row deliberately quotes none of it.
	test('leaves a question out of the row it titles', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_ask_user_question',
				{
					questions: [
						{ options: [], question: 'Which branch should this land on?' },
					],
				},
				true,
			)?.title,
		).toBe('Asking you a question');
	});

	test('titles a call the MCP-namespaced name reaches it under', () => {
		expect(
			ensemblrToolLabel(
				'mcp__ensemblr__ensemblr_start_conversation',
				{ title: 'Astro config audit' },
				false,
			),
		).toEqual({
			badge: null,
			glyph: 'bot',
			title: 'Started a sub-agent: Astro config audit',
		});
		expect(ensemblrToolGlyph('mcp__ensemblr__ensemblr_focus_tab')).toBe(
			'crosshair',
		);
	});

	// A folded turn paints one mark per call, so a terminal it started and a
	// terminal it stopped reading as the same mark hides what the turn did.
	test('marks each action with its own glyph', () => {
		const glyphs = [
			'ensemblr_start_terminal',
			'ensemblr_stop_terminal',
			'ensemblr_write_terminal',
			'ensemblr_read_terminal_output',
		].map((toolName) => ensemblrToolGlyph(toolName));

		expect(new Set(glyphs).size).toBe(glyphs.length);
	});

	test('folds the spawned tab title into the label', () => {
		expect(
			ensemblrToolLabel(
				'ensemblr_start_conversation',
				{ title: 'Astro config audit' },
				false,
			),
		).toEqual({
			badge: null,
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

	// This is the row the screenshot showed: an MCP-namespaced control call
	// titled with its wire name and marked with the generic wrench.
	test('replaces the MCP-namespaced wire name too', () => {
		const presentation = presentToolCall(
			toolCall('mcp__ensemblr__ensemblr_get_workspace_diff', {
				filePath: 'src/main/main.ts',
			}),
		);

		expect(presentation.title).toBe('Read the diff');
		expect(presentation.glyph).toBe('file-diff');
		expect(presentation.badge).toEqual({
			additions: null,
			deletions: null,
			kind: 'file',
			path: 'src/main/main.ts',
		});
	});

	test('names the tool rather than its MCP wrapper when it fails', () => {
		expect(
			presentToolCall(transportFailure('mcp__ensemblr__ensemblr_set_summary'))
				.title,
		).toBe('Ensemblr set summary failed');
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
