import { describe, expect, test } from 'vitest';
import { presentToolCall } from '@/renderer/lib/agent-timeline/tool-presentation';
import type { ToolBodyDescriptor } from '@/renderer/types/tool-presentation';
import { dynamicToolCall } from './support/tool-presentation';

/**
 * The app's own control ops carry their payload two ways. The Pi extension
 * registers the tool under its bare name and hands the whole envelope back on
 * `details`; an MCP client namespaces the same tool and sends only the text it
 * rendered, which for a control op is that payload as JSON. Every presenter has
 * to read both, so the helpers below build a call each way.
 */

function piCall(
	toolName: string,
	input: Record<string, unknown>,
	data: unknown,
) {
	return dynamicToolCall(toolName, input, {
		details: { data, ok: true },
		text: JSON.stringify(data),
	});
}

function mcpCall(
	toolName: string,
	input: Record<string, unknown>,
	data: unknown,
) {
	return dynamicToolCall(`mcp__ensemblr__${toolName}`, input, {
		text: JSON.stringify(data),
	});
}

function markdownOf(body: ToolBodyDescriptor): string {
	if (body.kind !== 'markdown') {
		throw new Error(`expected a markdown body, got ${body.kind}`);
	}
	return body.text;
}

describe('wait_for_agents', () => {
	const payload = {
		completed: [
			{
				agentSessionId: 'child-a',
				contextUsage: { contextWindow: 1_000_000, percent: 12.4, tokens: 124 },
				lastMessage: 'Found the cause in src/main/linear/linear-service.ts.',
				reportTruncated: false,
				signal: null,
				status: 'idle',
			},
		],
		note: 'Not a failure: the wait window expired while 1 child was still working.',
		pending: [
			{
				agentSessionId: 'child-b',
				contextUsage: { contextWindow: 1_000_000, percent: 15.5, tokens: 155 },
				status: 'streaming',
			},
		],
		timedOut: true,
	};

	test('renders each child, its context reading, and the note', () => {
		const body = markdownOf(
			presentToolCall(
				piCall('ensemblr_wait_for_agents', { mode: 'all' }, payload),
			).body,
		);

		expect(body).toContain('**idle**');
		expect(body).toContain('12% context');
		expect(body).toContain('src/main/linear/linear-service.ts');
		expect(body).toContain('**streaming**');
		expect(body).toContain('Not a failure');
	});

	test('summarizes the counts and the expiry in the preview', () => {
		const presentation = presentToolCall(
			piCall('ensemblr_wait_for_agents', { mode: 'all' }, payload),
		);

		expect(presentation.preview).toEqual({
			font: 'sans',
			text: '1 settled · 1 still working · wait window expired',
		});
	});

	test('reads the same payload off the MCP transport', () => {
		const body = markdownOf(
			presentToolCall(mcpCall('ensemblr_wait_for_agents', {}, payload)).body,
		);

		expect(body).toContain('**idle**');
		expect(body).toContain('**streaming**');
	});

	test('surfaces a child signal beside its status', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_wait_for_agents',
					{},
					{
						completed: [
							{
								agentSessionId: 'child-a',
								contextUsage: null,
								lastMessage: null,
								reportTruncated: false,
								signal: {
									message: 'Which base should I rebase onto?',
									reason: 'need_decision',
								},
								status: 'awaiting-input',
							},
						],
						pending: [],
						timedOut: false,
					},
				),
			).body,
		);

		expect(body).toContain('signal: need_decision');
		expect(body).toContain('Which base should I rebase onto?');
	});

	test('keeps a report excerpt from restyling the row it sits in', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_wait_for_agents',
					{},
					{
						completed: [
							{
								agentSessionId: 'child-a',
								contextUsage: null,
								lastMessage: '## Findings\n\nThe gate never hits the cache.',
								reportTruncated: false,
								signal: null,
								status: 'idle',
							},
						],
						pending: [],
						timedOut: false,
					},
				),
			).body,
		);

		expect(body).toContain('\\## Findings');
		expect(body).not.toMatch(/\n\s*## Findings/);
	});

	test('drops a row carrying no session id rather than painting a blank one', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_wait_for_agents',
					{},
					{
						completed: [
							{ status: 'idle' },
							{ agentSessionId: 'real', status: 'idle' },
						],
						pending: [],
						timedOut: false,
					},
				),
			).body,
		);

		expect(body.match(/\*\*idle\*\*/g)).toHaveLength(1);
	});
});

describe('read_conversation', () => {
	test('renders a stat probe as its counts alone', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_read_conversation',
				{ agentSessionId: 'child-a', stat: true },
				{
					agentSessionId: 'child-a',
					entries: [],
					entryCount: 12,
					firstOrdinal: 1,
					lastOrdinal: 12,
					nextOrdinal: null,
					turnCount: 3,
				},
			),
		);

		expect(markdownOf(presentation.body)).toBe('12 entries · 3 turns');
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: '12 entries · 3 turns',
		});
	});

	test('heads each entry by what kind of step it was', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_read_conversation',
					{ agentSessionId: 'child-a' },
					{
						agentSessionId: 'child-a',
						entries: [
							{ kind: 'prompt', ordinal: 1, text: 'Find the cause.' },
							{
								input: '{"pattern":"linear"}',
								isError: false,
								kind: 'tool',
								name: 'grep',
								ordinal: 2,
								output: 'src/main/linear/linear-service.ts:595',
							},
							{ kind: 'message', ordinal: 3, text: 'It is the blocking read.' },
						],
						entryCount: 3,
						firstOrdinal: 1,
						lastOrdinal: 3,
						nextOrdinal: null,
						turnCount: 1,
					},
				),
			).body,
		);

		expect(body).toContain('#### Prompt #1');
		expect(body).toContain('#### Tool: grep #2');
		expect(body).toContain('#### Answer #3');
		expect(body).toContain('```\n{"pattern":"linear"}\n```');
	});
});

describe('get_last_message', () => {
	test('renders the report as prose', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_get_last_message',
				{ agentSessionId: 'child-a' },
				{ message: '## Findings\n\nThe gate never hits the cache.' },
			),
		);

		expect(markdownOf(presentation.body)).toContain('## Findings');
	});

	test('leaves nothing to unfold when no report exists yet', () => {
		const presentation = presentToolCall(
			piCall('ensemblr_get_last_message', {}, { message: null }),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
	});
});

describe('get_conversation_status', () => {
	test('labels the runtime and report, and previews the context reading', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_get_conversation_status',
				{},
				{
					agentSessionId: 'child-a',
					contextUsage: {
						contextWindow: 1_000_000,
						percent: 47.2,
						tokens: 472,
					},
					hasFinalMessage: true,
					runtimeOpen: true,
					status: 'running',
				},
			),
		);

		expect(presentation.body).toEqual({
			kind: 'labeled',
			sections: [
				{ label: 'Runtime:', muted: true, text: 'Open' },
				{ label: 'Report:', muted: true, text: 'Ready to read' },
			],
		});
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'running · 47% context',
		});
	});

	test('adds the pressure note as its own section when one is attached', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_get_conversation_status',
				{},
				{
					agentSessionId: 'child-a',
					contextUsage: null,
					hasFinalMessage: false,
					note: 'Past half its window — retire it rather than reload it.',
					runtimeOpen: false,
					status: 'idle',
				},
			),
		);

		expect(presentation.body).toMatchObject({
			sections: [
				{ text: 'Closed' },
				{ text: 'None yet' },
				{ label: 'Note:', muted: false },
			],
		});
	});
});

describe('list_models', () => {
	test('names each model with the facts that decide a spawn', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_list_models',
				{},
				{
					allowedRuntimes: ['claude'],
					callerRuntime: 'claude',
					crossRuntimeDelegationEnabled: false,
					defaultModelId: 'opus[1m]',
					models: [
						{
							displayName: 'Opus 5',
							id: 'opus[1m]',
							roles: ['sage', 'coder'],
							runtime: 'claude',
							thinkingAxis: 'effort',
							thinkingLevels: ['off', 'high'],
							tier: 'standard',
							vendor: 'claude-code',
						},
					],
				},
			),
		);

		const body = markdownOf(presentation.body);
		expect(body).toBe(
			'- **Opus 5** · `opus[1m]` · claude · standard · sage, coder',
		);
		expect(presentation.preview).toEqual({ font: 'sans', text: '1 model' });
	});
});

describe('recall_memory', () => {
	test('renders each hit with its path as a code span', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_recall_memory',
					{ query: 'release' },
					{
						memories: [
							{
								kind: 'project',
								relativePath: 'memory/release-ritual.md',
								slug: 'release-ritual',
								snippet: 'gh release create fires the build',
								summary: 'How a release is cut',
								title: 'Release ritual',
							},
						],
						omittedSlugs: [],
					},
				),
			).body,
		);

		expect(body).toBe(
			'- **Release ritual** · project · How a release is cut · `memory/release-ritual.md`',
		);
	});
});

describe('list_workspaces', () => {
	test('reads a bare array payload and localizes the board status', () => {
		const presentation = presentToolCall(
			piCall('ensemblr_list_workspaces', {}, [
				{
					boardStatus: 'in-review',
					cwd: '/repos/ensemblr/kavallaris',
					name: 'Structured agent op previews',
					projectId: 'p1',
					projectName: 'ensemblr',
					workspaceId: 'w1',
				},
			]),
		);

		expect(markdownOf(presentation.body)).toBe(
			'- **Structured agent op previews** · ensemblr · In review · `/repos/ensemblr/kavallaris`',
		);
		expect(presentation.preview).toEqual({ font: 'sans', text: '1 workspace' });
	});
});

describe('list_terminals', () => {
	test('marks an idle shell as reusable and names a busy one by its command', () => {
		const body = markdownOf(
			presentToolCall(
				piCall('ensemblr_list_terminals', {}, [
					{
						foregroundCommand: null,
						kind: 'terminal',
						scriptName: null,
						shell: '/opt/homebrew/bin/fish',
						status: 'running',
						terminalId: 't1',
						workspaceId: 'w1',
					},
					{
						foregroundCommand: 'npm run dev',
						kind: 'run',
						scriptName: 'dev',
						shell: '/bin/zsh',
						status: 'running',
						terminalId: 't2',
						workspaceId: 'w1',
					},
				]),
			).body,
		);

		expect(body).toContain('**terminal** · running · idle');
		expect(body).toContain('**run** · running · dev · `npm run dev`');
	});
});

describe('read_terminal_output', () => {
	test('renders scrollback through the shared output bodies', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_read_terminal_output',
				{ terminalId: 't1' },
				{ output: 'vite v8.0.0  ready in 412 ms', terminalId: 't1' },
			),
		);

		expect(presentation.body).toEqual({
			kind: 'terminal',
			text: 'vite v8.0.0  ready in 412 ms',
		});
		expect(presentation.preview).toBeNull();
	});

	test('keeps the tail of a long buffer and says what it dropped', () => {
		const output = Array.from(
			{ length: 260 },
			(_, line) => `line ${line}`,
		).join('\n');
		const presentation = presentToolCall(
			piCall(
				'ensemblr_read_terminal_output',
				{ terminalId: 't1' },
				{ output, terminalId: 't1' },
			),
		);

		expect(presentation.body).toMatchObject({ kind: 'terminal' });
		if (presentation.body.kind === 'terminal') {
			expect(presentation.body.text.split('\n')).toHaveLength(200);
			expect(presentation.body.text).not.toContain('line 0\n');
			expect(presentation.body.text).toContain('line 259');
		}
		expect(presentation.preview?.text).toBe(
			'last 200 lines · 60 earlier hidden',
		);
	});

	test('leaves nothing to unfold when the terminal holds no scrollback', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_read_terminal_output',
				{ terminalId: 't1' },
				{ output: null, terminalId: 't1' },
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
	});
});

describe('linear_list_issues', () => {
	test('renders each issue and names what the payload budget cut', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_linear_list_issues',
				{ query: 'cache' },
				{
					issues: [
						{
							accountId: 'a1',
							assignee: 'Philipp',
							assigneeId: 'u1',
							id: 'i1',
							identifier: 'THE-218',
							organization: 'Ensemblr',
							priority: 2,
							project: null,
							state: 'In Review',
							stateId: 's1',
							stateType: 'started',
							team: 'Core',
							title: 'Serve the renderer from app://',
							updatedAt: null,
							url: 'https://linear.app/THE-218',
						},
					],
					message: 'ok',
					omittedIssues: 3,
					source: 'cache',
					status: 'ok',
					truncated: true,
				},
			),
		);

		const body = markdownOf(presentation.body);
		expect(body).toContain(
			'- `THE-218` · **Serve the renderer from app://** · In Review · Philipp',
		);
		expect(body).toContain('3 more issues did not fit — narrow the search.');
		expect(presentation.preview).toEqual({ font: 'sans', text: '1 issue' });
	});
});

describe('linear_get_issue', () => {
	test('renders the meta line, description, and thread', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_linear_get_issue',
				{ issueId: 'THE-218' },
				{
					comments: [
						{
							author: 'Philipp',
							body: 'Closing the file: fuse is the part that matters.',
							createdAt: null,
						},
					],
					issue: {
						accountId: 'a1',
						assignee: 'Philipp',
						assigneeId: 'u1',
						cycle: 'Cycle 7',
						description: 'Move the renderer onto a custom protocol.',
						id: 'i1',
						identifier: 'THE-218',
						labels: ['security'],
						organization: 'Ensemblr',
						priority: 2,
						project: null,
						state: 'In Review',
						stateId: 's1',
						stateType: 'started',
						team: 'Core',
						title: 'Serve the renderer from app://',
						updatedAt: null,
						url: 'https://linear.app/THE-218',
					},
					message: 'ok',
					omittedComments: 0,
					source: 'remote',
					status: 'ok',
					truncated: false,
				},
			),
		);

		const body = markdownOf(presentation.body);
		expect(body).toContain(
			'In Review · Philipp · Core · Cycle 7 · priority 2 · security',
		);
		expect(body).toContain('Move the renderer onto a custom protocol.');
		expect(body).toContain('### Comments');
		expect(body).toContain('- **Philipp** — Closing the file: fuse');
	});

	test('previews the state and comment count, never the identifier the title carries', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_linear_get_issue',
				{ issueId: 'THE-218' },
				{
					comments: [],
					issue: {
						accountId: 'a1',
						assignee: null,
						assigneeId: null,
						cycle: null,
						description: null,
						id: 'i1',
						identifier: 'THE-218',
						labels: [],
						organization: null,
						priority: null,
						project: null,
						state: 'Todo',
						stateId: 's1',
						stateType: 'unstarted',
						team: null,
						title: 'Serve the renderer from app://',
						updatedAt: null,
						url: 'https://linear.app/THE-218',
					},
					message: 'ok',
					omittedComments: 0,
					source: 'cache',
					status: 'ok',
					truncated: false,
				},
			),
		);

		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'Todo · 0 comments',
		});
		expect(presentation.preview?.text).not.toContain('THE-218');
	});
});

describe('get_diff_comments', () => {
	test('names the line, who left it, and whether it still stands', () => {
		const body = markdownOf(
			presentToolCall(
				piCall(
					'ensemblr_get_diff_comments',
					{},
					{
						comments: [
							{
								body: 'This guard drops the non-zero exit.',
								createdAt: '2026-09-13T00:00:00Z',
								filePath: 'src/main/ipc/handlers/review.ts',
								id: 'c1',
								lineNumber: 42,
								origin: 'user',
								status: 'open',
								updatedAt: '2026-09-13T00:00:00Z',
								workspaceId: 'w1',
							},
						],
					},
				),
			).body,
		);

		expect(body).toBe(
			'- `src/main/ipc/handlers/review.ts:42` · You · Unresolved · This guard drops the non-zero exit.',
		);
	});
});

describe('resolve_diff_comments', () => {
	test('leaves nothing to unfold on a clean run', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_resolve_diff_comments',
				{ commentIds: ['c1', 'c2'] },
				{ alreadyResolved: [], message: 'ok', notFound: [], resolved: 2 },
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
		expect(presentation.preview).toEqual({ font: 'sans', text: '2 resolved' });
	});

	test('surfaces the ids it could not close on a partial run', () => {
		const presentation = presentToolCall(
			piCall(
				'ensemblr_resolve_diff_comments',
				{ commentIds: ['c1', 'c9'] },
				{
					alreadyResolved: ['c1'],
					message: 'partial',
					notFound: ['c9'],
					resolved: 0,
				},
			),
		);

		const body = markdownOf(presentation.body);
		expect(body).toContain('### Already resolved');
		expect(body).toContain('`c1`');
		expect(body).toContain('### Not found');
		expect(body).toContain('`c9`');
		expect(presentation.preview?.text).toBe('0 resolved · 1 not found');
	});
});

describe('untyped control ops', () => {
	test('an op answering a bare ok has nothing to unfold', () => {
		const presentation = presentToolCall(
			dynamicToolCall(
				'ensemblr_close_tab',
				{ chatTabId: 'tab-1' },
				{ details: { data: null, ok: true }, text: '{"ok":true}' },
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
		expect(presentation.preview).toBeNull();
	});

	test('a malformed payload degrades to an empty body rather than throwing', () => {
		const presentation = presentToolCall(
			dynamicToolCall(
				'ensemblr_wait_for_agents',
				{},
				{ text: 'not json at all' },
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
	});

	test('a refused control call still reads as a failure', () => {
		const presentation = presentToolCall(
			dynamicToolCall(
				'ensemblr_wait_for_agents',
				{},
				{
					details: {
						code: 'denied-permission',
						error: 'The workspace permission mode refuses this.',
						ok: false,
					},
					text: '',
				},
			),
		);

		expect(presentation.tone).toBe('destructive');
		expect(presentation.body).toEqual({
			kind: 'error',
			text: 'The workspace permission mode refuses this.',
		});
	});
});

describe('raw execution disclosure', () => {
	test('every settled control row keeps its actual exchange reachable', () => {
		const presentation = presentToolCall(
			piCall('ensemblr_close_tab', { chatTabId: 'tab-1' }, null),
		);

		expect(presentation.rawIO).toEqual({
			input: '{\n  "chatTabId": "tab-1"\n}',
			output: 'null',
			toolName: 'ensemblr_close_tab',
		});
	});

	test('names the tool canonically whichever runtime reported it', () => {
		const presentation = presentToolCall(
			mcpCall('ensemblr_list_models', {}, { models: [] }),
		);

		expect(presentation.rawIO?.toolName).toBe('ensemblr_list_models');
	});

	test('a call still in flight has no exchange to disclose', () => {
		const presentation = presentToolCall(
			dynamicToolCall('ensemblr_wait_for_agents', { mode: 'all' }),
		);

		expect(presentation.rawIO).toBeUndefined();
		expect(presentation.body).toEqual({ kind: 'pending' });
	});

	test('a refused control call still discloses what it was called with', () => {
		const presentation = presentToolCall(
			dynamicToolCall(
				'ensemblr_set_workspace_status',
				{ status: 'done' },
				{
					details: {
						code: 'denied-permission',
						error: 'Agent work stops at In Review.',
						ok: false,
					},
					text: '',
				},
			),
		);

		expect(presentation.tone).toBe('destructive');
		expect(presentation.rawIO).toMatchObject({
			input: '{\n  "status": "done"\n}',
			toolName: 'ensemblr_set_workspace_status',
		});
	});

	test('an ordinary tool carries no control disclosure', () => {
		const presentation = presentToolCall(
			dynamicToolCall('grep', { pattern: 'linear' }, { text: 'one hit' }),
		);

		expect(presentation.rawIO).toBeUndefined();
	});
});
