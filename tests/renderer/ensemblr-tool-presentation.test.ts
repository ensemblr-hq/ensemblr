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
import type {
	AgentRoleResolver,
	TimelineAgentRole,
	TimelineSurface,
} from '../../src/renderer/types/tool-presentation';

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
	// Every case below goes through a recorded call rather than a bare argument
	// bag, because a control label is read off both halves of one: the arguments
	// the model sent and the payload the app handed back.
	const labelFor = (
		toolName: string,
		input: Record<string, unknown> = {},
		isRunning = false,
		surface: TimelineSurface = 'workspace',
	) => ensemblrToolLabel(toolCall(toolName, input), isRunning, surface);

	/** Reads a badge's path, which only a file badge carries. */
	const badgePathOf = (label: ReturnType<typeof labelFor>) =>
		label?.badge?.kind === 'file' || label?.badge?.kind === 'folder'
			? label.badge.path
			: null;

	test('names the action rather than the tool', () => {
		expect(labelFor('ensemblr_wait_for_agents', {}, false)).toEqual({
			badge: null,
			glyph: 'hourglass',
			title: 'Waited for sub-agents',
		});
	});

	// A wait blocks for as long as its children run, so the settled past tense
	// over a turn that is still working describes something yet to happen.
	test('reads in the present participle while the call is in flight', () => {
		expect(labelFor('ensemblr_wait_for_agents', {}, true)?.title).toBe(
			'Waiting for sub-agents',
		);
	});

	test.each(['workspace', 'concierge'] as const)(
		'carries both tenses for every control tool on the %s surface',
		(surface) => {
			for (const toolName of ENSEMBLR_CONTROL_TOOL_NAMES) {
				const settled = labelFor(toolName, {}, false, surface)?.title;
				const running = labelFor(toolName, {}, true, surface)?.title;

				expect(settled).toBeTruthy();
				expect(running).toBeTruthy();
				expect(running).not.toBe(settled);
				expect(running?.endsWith('ing') || running?.includes('ing ')).toBe(
					true,
				);
			}
		},
	);

	test('reads the review tools as the review action taken', () => {
		expect(labelFor('ensemblr_get_workspace_diff', {}, false)).toEqual({
			badge: null,
			glyph: 'file-diff',
			title: 'Read the diff',
		});
		expect(labelFor('ensemblr_get_diff_comments', {}, false)).toEqual({
			badge: null,
			glyph: 'message-square-text',
			title: 'Read review comments',
		});
		expect(labelFor('ensemblr_add_diff_comments', {}, true)).toEqual({
			badge: null,
			glyph: 'message-square-plus',
			title: 'Leaving review comments',
		});
	});

	// The identifier is the whole point of a Linear row: `Updated a Linear issue`
	// says nothing a user can act on, while `Updated a Linear issue: ENG-106` is
	// the ticket they can go and look at.
	test('reads the Linear tools with the ticket they acted on', () => {
		expect(
			labelFor(
				'ensemblr_linear_update_issue',
				{ issueId: 'ENG-106', stateId: 's-review' },
				false,
			),
		).toEqual({
			badge: null,
			glyph: 'ticket-check',
			title: 'Updated a Linear issue: ENG-106',
		});
		expect(
			labelFor(
				'ensemblr_linear_create_comment',
				{ commentBody: 'shipped', issueId: 'ENG-106' },
				true,
			)?.title,
		).toBe('Commenting on a Linear issue: ENG-106');
		expect(
			labelFor('ensemblr_linear_list_issues', { query: 'composer' }, false)
				?.title,
		).toBe('Searched Linear issues: composer');
		expect(labelFor('ensemblr_linear_get_metadata', {}, false)).toEqual({
			badge: null,
			glyph: 'list',
			title: 'Read Linear teams and states',
		});
	});

	// `id`, `identifier`, and `search` are the near-misses the control boundary
	// rewrites, and the timeline records what the model sent, not the rewrite.
	test('reads the forgiven spelling of a Linear argument', () => {
		expect(
			labelFor('ensemblr_linear_get_issue', { identifier: 'ENG-42' }, false)
				?.title,
		).toBe('Read a Linear issue: ENG-42');
		expect(
			labelFor('ensemblr_linear_list_issues', { search: 'diff' }, false)?.title,
		).toBe('Searched Linear issues: diff');
	});

	// A path in the title is a string the reader cannot open and cannot see the
	// end of once the row truncates it. The chip is the same one a `write` row
	// carries, so the file reads and opens the same way whichever tool named it.
	test('pins the file under review as a chip rather than title text', () => {
		expect(
			labelFor(
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
		const label = labelFor(
			'ensemblr_get_diff_comments',
			{ file: 'src/main/main.ts' },
			false,
		);

		expect(badgePathOf(label)).toBe('src/main/main.ts');
		expect(label?.title).toBe('Read review comments');
	});

	// All three `open_tab` variants take a path, so a row showing only the file
	// cannot say whether it opened a preview, a diff, or a comment. The chip and
	// the title are separate slots — the variant does not have to yield the one to
	// hold the other.
	test('names the variant and the file it opened in their own slots', () => {
		const withFile = labelFor(
			'ensemblr_open_tab',
			{ filePath: 'src/main/main.ts', variant: 'diff' },
			false,
		);
		const withoutFile = labelFor(
			'ensemblr_open_tab',
			{ variant: 'comment' },
			false,
		);

		expect(badgePathOf(withFile)).toBe('src/main/main.ts');
		expect(withFile?.title).toBe('Opened a tab: diff');
		expect(withoutFile?.badge).toBeNull();
		expect(withoutFile?.title).toBe('Opened a tab: comment');
	});

	test('reads the arguments the control surface actually names', () => {
		expect(
			labelFor('ensemblr_launch_harness', { harnessId: 'claude' }, true)?.title,
		).toBe('Launching a harness: claude');
		expect(
			labelFor(
				'ensemblr_write_terminal',
				{ input: 'npm run check', terminalId: 't1' },
				false,
			)?.title,
		).toBe('Typed into a terminal: npm run check');
		expect(
			labelFor('ensemblr_focus_panel', { panel: 'changes' }, false)?.title,
		).toBe('Focused a panel: changes');
	});

	// One call files comments across as many files as the reviewer touched, so
	// naming the first one labels the row with a file the body below it mostly is
	// not about.
	test('names no file on a batch spanning several', () => {
		const label = labelFor(
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
		const label = labelFor(
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
		expect(badgePathOf(label)).toBe('src/main/main.ts');
	});

	// A question is a sentence, and a sentence cut to the title's length reads as
	// less than the bare action does, so the row deliberately quotes none of it.
	test('leaves a question out of the row it titles', () => {
		expect(
			labelFor(
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
			labelFor(
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
			labelFor(
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
			labelFor(
				'ensemblr_start_conversation',
				{ title: 'Astro config audit' },
				true,
			)?.title,
		).toBe('Starting a sub-agent: Astro config audit');
	});

	test('collapses whitespace and truncates an over-long detail', () => {
		const label = labelFor(
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
		expect(labelFor('ensemblr_start_conversation', {}, false)?.title).toBe(
			'Started a sub-agent',
		);
		expect(
			labelFor('ensemblr_start_conversation', { title: '   ' }, false)?.title,
		).toBe('Started a sub-agent');
	});

	// What the Concierge spawns is a root orchestrator in a workspace the user can
	// talk to — `spawnedChildRole` hands it that role — so calling it a sub-agent
	// on the one surface that never has any is wrong in both directions: it names
	// the wrong thing and hides that the user can open it.
	test.each([
		['ensemblr_start_conversation', 'Started a chat', 'Started a sub-agent'],
		['ensemblr_send_follow_up', 'Steered a chat', 'Steered a sub-agent'],
		[
			'ensemblr_get_conversation_status',
			'Checked a chat',
			'Checked a sub-agent',
		],
		[
			'ensemblr_get_last_message',
			"Read a chat's report",
			"Read a sub-agent's report",
		],
		[
			'ensemblr_read_conversation',
			"Read a chat's transcript",
			"Read a sub-agent's transcript",
		],
		[
			'ensemblr_wait_for_agents',
			'Waited for the chats',
			'Waited for sub-agents',
		],
	])('calls %s a chat in the Concierge', (toolName, concierge, workspace) => {
		expect(labelFor(toolName, {}, false, 'concierge')?.title).toBe(concierge);
		expect(labelFor(toolName, {}, false, 'workspace')?.title).toBe(workspace);
	});

	// Every other tool means the same thing wherever it is called, and a surface
	// that quietly reworded them all would be a second catalogue to keep in step.
	test('leaves a tool with no Concierge reading alone', () => {
		expect(labelFor('ensemblr_open_tab', {}, false, 'concierge')?.title).toBe(
			'Opened a tab',
		);
	});

	// A raw workspace id is unreadable, fills the title, and names something the
	// user cannot click. The chip carries the workspace's current name instead,
	// and the id is all the row has to record for it to be resolved.
	test('pins the workspace an argument named as a chip', () => {
		expect(
			labelFor('ensemblr_focus_workspace', { workspaceId: 'ws-1' }, false),
		).toEqual({
			badge: { kind: 'workspace', workspaceId: 'ws-1' },
			glyph: 'crosshair',
			title: 'Opened a workspace',
		});
	});

	// `create_workspace` is handed a project and produces a workspace, so the id
	// its chip needs exists only on the way back.
	test('pins the workspace a call produced, from the Pi envelope', () => {
		const label = ensemblrToolLabel(
			toolCall(
				'ensemblr_create_workspace',
				{ name: 'beta-16', projectId: 'repository-b03382ad' },
				{
					output: {
						details: {
							data: { name: 'beta-16', workspaceId: 'ws-9' },
							ok: true,
						},
						text: '{"name":"beta-16","workspaceId":"ws-9"}',
					},
				} as Partial<DynamicToolUIPart>,
			),
			false,
		);

		expect(label).toEqual({
			badge: { kind: 'workspace', workspaceId: 'ws-9' },
			glyph: 'git-branch-plus',
			title: 'Created a workspace',
		});
	});

	// The MCP bridge sends no envelope at all — only the text it rendered, which
	// for a control op is that same payload as JSON.
	test('pins the workspace a call produced, from the MCP result text', () => {
		const label = ensemblrToolLabel(
			toolCall(
				'mcp__ensemblr__ensemblr_create_workspace',
				{ projectId: 'repository-b03382ad' },
				{
					output: {
						details: null,
						text: '{"branchName":"psoldunov/beta-16","name":"beta-16","workspaceId":"ws-9"}',
					},
				} as Partial<DynamicToolUIPart>,
			),
			false,
		);

		expect(label?.badge).toEqual({ kind: 'workspace', workspaceId: 'ws-9' });
	});

	// A call still in flight has no result to read, and a refused one reports a
	// failure rather than a workspace. Neither may invent a chip.
	test('pins no workspace before the call reports one', () => {
		expect(
			labelFor('ensemblr_create_workspace', { projectId: 'p-1' }, true)?.badge,
		).toBeNull();
		expect(
			ensemblrToolLabel(deniedCall('ensemblr_create_workspace'), false)?.badge,
		).toBeNull();
	});

	// A spawn's subject is the conversation it opened, not the workspace holding
	// it — but it declares both, so a row written before the tab has a name still
	// has a workspace to fall back on when the chat cannot be resolved.
	test('pins the chat a spawn opened, with its workspace behind it', () => {
		const label = ensemblrToolLabel(
			toolCall(
				'ensemblr_start_conversation',
				{ prompt: 'go', title: 'Smoke test', workspaceId: 'ws-9' },
				{
					output: {
						details: {
							data: { agentSessionId: 'session-1', chatTabId: 'tab-1' },
							ok: true,
						},
						text: '{"agentSessionId":"session-1","chatTabId":"tab-1"}',
					},
				} as Partial<DynamicToolUIPart>,
			),
			false,
			'concierge',
		);

		expect(label).toEqual({
			badge: { chatTabId: 'tab-1', kind: 'chat', workspaceId: 'ws-9' },
			glyph: 'bot',
			title: 'Started a chat',
			unpinnedTitle: 'Started a chat: Smoke test',
		});
	});

	// The chip paints the chat's name, so repeating it in the title says the same
	// thing twice. Nothing resolves a chip outside the Concierge, so there the
	// title is the only thing that can carry it.
	test('keeps the spawned title in the row a workspace agent reads', () => {
		expect(
			labelFor(
				'ensemblr_start_conversation',
				{ prompt: 'go', title: 'Smoke test' },
				false,
				'workspace',
			)?.title,
		).toBe('Started a sub-agent: Smoke test');
	});

	// Whether the chip resolves is only known once a component has asked the
	// catalogue, and it comes up empty for a chat and workspace that are both
	// too new to be listed. The row still has to say what it spawned.
	test('offers the dropped detail back for a row that pins nothing', () => {
		const label = labelFor(
			'ensemblr_start_conversation',
			{ prompt: 'go', title: 'Smoke test' },
			false,
			'concierge',
		);

		expect(label?.title).toBe('Started a chat');
		expect(label?.unpinnedTitle).toBe('Started a chat: Smoke test');
	});

	// A surface that never moved the detail to a chip has nothing to put back,
	// and a second title would be the same string twice.
	test.each([
		['ensemblr_start_conversation', 'workspace'],
		['ensemblr_focus_panel', 'concierge'],
	] as const)('carries no fallback title for %s on %s', (toolName, surface) => {
		expect(
			labelFor(
				toolName,
				{ panel: 'changes', title: 'Smoke test' },
				false,
				surface,
			)?.unpinnedTitle,
		).toBeUndefined();
	});

	test('returns null for a tool that is not a control tool', () => {
		expect(labelFor('bash', { command: 'ls' }, false)).toBeNull();
		expect(ensemblrToolGlyph('bash')).toBeNull();
	});
});

// A workspace agent steers a child it owns, a peer beside it, and the Review
// conversation with one op, and the app opens the last two as roots carrying no
// sub-agent marker. Naming all three a sub-agent is what this resolves — and the
// majority case, a genuine child, must keep reading exactly as it did, or an
// orchestrator auditing its own transcript can no longer tell which rows acted
// on something it has to collect.
describe('ensemblrToolLabel against the target role', () => {
	const ROLES: Record<string, TimelineAgentRole> = {
		'session-child': 'subagent',
		'session-peer': 'orchestrator',
		'session-review': 'orchestrator',
	};
	const resolveRole: AgentRoleResolver = (id) => ROLES[id] ?? null;

	const titleFor = (
		toolName: string,
		input: Record<string, unknown>,
		isRunning = false,
	) =>
		ensemblrToolLabel(
			toolCall(toolName, input),
			isRunning,
			'workspace',
			resolveRole,
		)?.title;

	test.each([
		['ensemblr_get_conversation_status', 'Checked a sub-agent'],
		['ensemblr_get_last_message', "Read a sub-agent's report"],
		['ensemblr_read_conversation', "Read a sub-agent's transcript"],
		['ensemblr_send_follow_up', 'Steered a sub-agent'],
	])('keeps the sub-agent wording for %s on a child', (toolName, expected) => {
		expect(titleFor(toolName, { agentSessionId: 'session-child' })).toBe(
			expected,
		);
	});

	test.each([
		['ensemblr_get_conversation_status', 'Checked an orchestrator'],
		['ensemblr_get_last_message', "Read an orchestrator's report"],
		['ensemblr_read_conversation', "Read an orchestrator's transcript"],
		['ensemblr_send_follow_up', 'Steered an orchestrator'],
	])('names a root orchestrator in the %s row', (toolName, expected) => {
		expect(titleFor(toolName, { agentSessionId: 'session-review' })).toBe(
			expected,
		);
	});

	// Neutral is the fallback for ignorance, not a blanket replacement: the app no
	// longer holds this conversation, so neither noun can be claimed.
	test.each([
		['ensemblr_get_conversation_status', 'Checked a chat'],
		['ensemblr_get_last_message', "Read a chat's report"],
		['ensemblr_read_conversation', "Read a chat's transcript"],
		['ensemblr_send_follow_up', 'Steered a chat'],
	])(
		'falls to the neutral noun when %s resolves nothing',
		(toolName, title) => {
			expect(titleFor(toolName, { agentSessionId: 'session-gone' })).toBe(
				title,
			);
		},
	);

	test('reads a steered orchestrator in the present participle', () => {
		expect(
			titleFor(
				'ensemblr_send_follow_up',
				{ agentSessionId: 'session-peer' },
				true,
			),
		).toBe('Steering an orchestrator');
	});

	// A spawn carries the answer in its own arguments — `peer: true` is what made
	// the thing a root — so its row needs no lookup and resolves for certain.
	test.each([
		[{ prompt: 'go' }, 'Started a sub-agent'],
		[{ peer: false, prompt: 'go' }, 'Started a sub-agent'],
		[{ peer: true, prompt: 'go' }, 'Started an orchestrator'],
	])('names what a spawn opened from its own arguments', (input, title) => {
		expect(titleFor('ensemblr_start_conversation', input)).toBe(title);
	});

	// Omitting `targets` means every child the caller spawned, and those are
	// children by construction — so the plural the row has always carried is
	// right, and no lookup runs.
	test('waits on sub-agents when the call names no targets', () => {
		expect(titleFor('ensemblr_wait_for_agents', {})).toBe(
			'Waited for sub-agents',
		);
		expect(titleFor('ensemblr_wait_for_agents', { mode: 'all' }, true)).toBe(
			'Waiting for sub-agents',
		);
	});

	test.each([
		[['session-child'], 'Waited for sub-agents'],
		[['session-child', 'session-child'], 'Waited for sub-agents'],
		[['session-review'], 'Waited for orchestrators'],
		[['session-peer', 'session-review'], 'Waited for orchestrators'],
		[['session-child', 'session-review'], 'Waited for the chats'],
		[['session-gone'], 'Waited for the chats'],
	])('resolves every named target before naming the set', (targets, title) => {
		expect(titleFor('ensemblr_wait_for_agents', { targets })).toBe(title);
	});

	// Without a resolver the surface has not looked, which is a different answer
	// from having looked and found nothing: the sub-agent wording is right for the
	// overwhelming majority of these calls, so it is what an unequipped surface
	// keeps rather than neutralizing every row.
	test('keeps the sub-agent wording when no resolver is supplied', () => {
		expect(
			ensemblrToolLabel(
				toolCall('ensemblr_send_follow_up', {
					agentSessionId: 'session-review',
				}),
				false,
				'workspace',
			)?.title,
		).toBe('Steered a sub-agent');
	});

	// The Concierge spawns nothing but roots, so its own vocabulary already names
	// every target a chat and a lookup could only disagree with it.
	test('leaves the Concierge vocabulary untouched', () => {
		expect(
			ensemblrToolLabel(
				toolCall('ensemblr_send_follow_up', {
					agentSessionId: 'session-child',
				}),
				false,
				'concierge',
				resolveRole,
			)?.title,
		).toBe('Steered a chat');
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
