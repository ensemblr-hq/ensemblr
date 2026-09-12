import { beforeAll, describe, expect, test } from 'vitest';

import { toAgentConversations } from '../../src/renderer/lib/agents/conversation-model';
import { ensureLanguageCatalogue } from '../../src/renderer/lib/i18n';
import type { AgentConversationLiveState } from '../../src/renderer/state/agents';
import { createAgentActivityState } from '../../src/shared/agent-activity';
import type { AgentSessionLineage } from '../../src/shared/agent-control';
import { APP_LANGUAGES } from '../../src/shared/i18n';
import type { AgentSessionSnapshotWire } from '../../src/shared/ipc/contracts/agent-session';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';

/** Creates one persisted chat row with optional legacy hierarchy metadata. */
function chatTab(
	id: string,
	sessionId: string | null,
	options: { closedAt?: string | null; parentChatTabId?: string } = {},
): ChatTabWire {
	return {
		agentSessionId: sessionId,
		closedAt: options.closedAt ?? null,
		fullTitle: `Full ${id}`,
		id,
		isPreview: false,
		kind: 'chat',
		metadata: options.parentChatTabId
			? { parentChatTabId: options.parentChatTabId }
			: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title: id,
		workspaceId: 'workspace-1',
	};
}

/** Creates one renderer-facing session snapshot. */
function session(
	id: string,
	lineage: AgentSessionLineage,
	model = 'model-1',
): AgentSessionSnapshotWire {
	return {
		branchId: `branch-${id}`,
		closedAt: null,
		contextUsage: {
			reading: 'live',
			usage: { contextWindow: 1000, percent: 25, tokens: 250 },
		},
		createdAt: '2026-01-01T00:00:00.000Z',
		currentTools: [],
		cwd: '/tmp/workspace-1',
		id,
		label: null,
		lineage,
		model,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: `runtime-${id}`,
		status: 'streaming',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: 'workspace-1',
	};
}

describe('toAgentConversations', () => {
	// Only the launch language's catalogue is bundled eagerly, so a fixed-language
	// lookup for the other two resolves to its English fallback until they load.
	beforeAll(async () => {
		await Promise.all(APP_LANGUAGES.map(ensureLanguageCatalogue));
	});

	test.each([
		['en', 'New chat', 'Untitled chat'],
		['ru', 'Новый чат', 'Диалог без названия'],
		['el', 'Νέα συνομιλία', 'Συνομιλία χωρίς τίτλο'],
	])(
		'uses localized placeholders until an agent names its tab (%s)',
		(language, openTitle, closedTitle) => {
			const unnamed = {
				...chatTab('new-agent', 'new-session'),
				fullTitle: '',
				title: '',
			};
			const input = {
				blockedSessionIds: new Set<string>(),
				catalog: undefined,
				closedTabs: [
					{
						...unnamed,
						id: 'closed-agent',
						closedAt: '2026-01-02T00:00:00.000Z',
						fullTitle: '  ',
						title: '\t',
					},
				],
				language,
				lineageBySessionId: new Map<string, AgentSessionLineage>(),
				liveBySessionId: {},
				openTabs: [unnamed],
				sessions: [],
			};
			expect(toAgentConversations(input).map((row) => row.title)).toEqual([
				openTitle,
				closedTitle,
			]);
			expect(
				toAgentConversations({
					...input,
					openTabs: [
						{ ...unnamed, title: 'Agent title', fullTitle: 'Full agent title' },
					],
				})[0].title,
			).toBe('Full agent title');
			expect(
				toAgentConversations({
					...input,
					openTabs: [{ ...unnamed, title: 'Agent title', fullTitle: '  ' }],
				})[0].title,
			).toBe('Agent title');
		},
	);

	test('hides untouched chats while retaining started and completed sessions', () => {
		const started = session('started-session', {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'started-session',
		});
		const completed = {
			...session('completed-session', {
				depth: 0,
				parentSessionId: null,
				rootSessionId: 'completed-session',
			}),
			closedAt: '2026-01-02T00:00:00.000Z',
			runtimeOpen: false,
			status: 'idle' as const,
		};
		const input = {
			blockedSessionIds: new Set<string>(),
			catalog: undefined,
			closedTabs: [
				chatTab('completed-chat', 'completed-session', {
					closedAt: '2026-01-02T00:00:00.000Z',
				}),
			],
			language: 'en',
			lineageBySessionId: new Map<string, AgentSessionLineage>([
				['started-session', started.lineage as AgentSessionLineage],
				['completed-session', completed.lineage as AgentSessionLineage],
			]),
			liveBySessionId: {},
			openTabs: [
				chatTab('fresh-chat', null),
				chatTab('started-chat', 'started-session'),
			],
			sessions: [started, completed],
		};

		expect(
			toAgentConversations(input).map((conversation) => conversation.chatTabId),
		).toEqual(['started-chat', 'completed-chat']);

		const activated = session('fresh-session', {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'fresh-session',
		});
		expect(
			toAgentConversations({
				...input,
				lineageBySessionId: new Map([
					...input.lineageBySessionId,
					['fresh-session', activated.lineage as AgentSessionLineage],
				]),
				openTabs: [
					chatTab('fresh-chat', 'fresh-session'),
					chatTab('started-chat', 'started-session'),
				],
				sessions: [...input.sessions, activated],
			}).map((conversation) => conversation.chatTabId),
		).toEqual(['fresh-chat', 'started-chat', 'completed-chat']);
	});

	test('uses durable session lineage and the existing model catalogue', () => {
		const root = session('root-session', {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'root-session',
		});
		const child = session('child-session', {
			depth: 1,
			parentSessionId: 'root-session',
			rootSessionId: 'root-session',
		});
		const conversations = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: {
				defaultModelId: null,
				defaultThinkingLevel: null,
				models: [
					{
						agentProvider: 'pi',
						contextWindow: 1000,
						displayName: 'Model One',
						id: 'model-1',
						thinkingLevels: [],
						vendor: 'vendor' as never,
					},
				],
			},
			closedTabs: [],
			language: 'en',
			lineageBySessionId: new Map([
				['root-session', root.lineage as AgentSessionLineage],
				['child-session', child.lineage as AgentSessionLineage],
			]),
			liveBySessionId: {},
			openTabs: [
				chatTab('root-chat', 'root-session'),
				chatTab('child-chat', 'child-session', {
					parentChatTabId: 'wrong-legacy-parent',
				}),
			],
			sessions: [root, child],
		});

		expect(conversations[1]).toMatchObject({
			contextUsage: { maxTokens: 1000, reading: 'live', usedTokens: 250 },
			depth: 1,
			model: 'Model One',
			parentChatTabId: 'root-chat',
			runtime: 'pi',
			status: 'working',
		});
	});

	test('resolves a child to the open holder when its parent session is also archived', () => {
		const root = session('root-session', {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'root-session',
		});
		const child = session('child-session', {
			depth: 1,
			parentSessionId: 'root-session',
			rootSessionId: 'root-session',
		});
		const conversations = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: undefined,
			closedTabs: [
				chatTab('archived-root', 'root-session', {
					closedAt: '2026-01-02T00:00:00.000Z',
				}),
			],
			language: 'en',
			lineageBySessionId: new Map([
				['root-session', root.lineage as AgentSessionLineage],
				['child-session', child.lineage as AgentSessionLineage],
			]),
			liveBySessionId: {},
			openTabs: [
				chatTab('open-root', 'root-session'),
				chatTab('open-child', 'child-session'),
			],
			sessions: [root, child],
		});

		expect(
			conversations.find(
				(conversation) => conversation.chatTabId === 'open-child',
			)?.parentChatTabId,
		).toBe('open-root');
	});

	test('uses the newest archive as the deterministic parent fallback', () => {
		const root = session('root-session', {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'root-session',
		});
		const child = session('child-session', {
			depth: 1,
			parentSessionId: 'root-session',
			rootSessionId: 'root-session',
		});
		const conversations = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: undefined,
			closedTabs: [
				chatTab('newer-archive', 'root-session', {
					closedAt: '2026-01-03T00:00:00.000Z',
				}),
				chatTab('older-archive', 'root-session', {
					closedAt: '2026-01-02T00:00:00.000Z',
				}),
			],
			language: 'en',
			lineageBySessionId: new Map([
				['root-session', root.lineage as AgentSessionLineage],
				['child-session', child.lineage as AgentSessionLineage],
			]),
			liveBySessionId: {},
			openTabs: [chatTab('open-child', 'child-session')],
			sessions: [root, child],
		});

		expect(
			conversations.find(
				(conversation) => conversation.chatTabId === 'open-child',
			)?.parentChatTabId,
		).toBe('newer-archive');
	});

	test('projects blocking and current tool activity without raw arguments', () => {
		const snapshot = session(
			'session-1',
			{
				depth: 0,
				parentSessionId: null,
				rootSessionId: 'session-1',
			},
			'openai-codex/gpt-5.6-sol',
		);
		const live: AgentConversationLiveState = {
			activity: createAgentActivityState([
				{
					input: { path: 'src/file.ts', secret: 'not rendered' },
					name: 'read',
					toolCallId: 'tool-1',
				},
			]),
			branchId: snapshot.branchId,
			contextUsage: null,
			lastEventOrdinal: -1,
			runtimeIdentity: 'pi:runtime-session-1',
			snapshotUpdatedAt: snapshot.updatedAt,
			status: 'streaming',
		};
		const [conversation] = toAgentConversations({
			blockedSessionIds: new Set(['session-1']),
			catalog: undefined,
			closedTabs: [],
			language: 'en',
			lineageBySessionId: new Map([
				['session-1', snapshot.lineage as AgentSessionLineage],
			]),
			liveBySessionId: { 'session-1': live },
			openTabs: [chatTab('chat-1', 'session-1')],
			sessions: [snapshot],
		});

		expect(conversation).toMatchObject({
			activity: { parallelCount: 1, target: 'src/file.ts' },
			model: 'gpt-5.6-sol',
			status: 'blocked',
		});
		expect(JSON.stringify(conversation)).not.toContain('not rendered');
	});

	test.each([
		[
			'ensemblr_focus_workspace',
			{ workspaceId: 'workspace-target' },
			'workspace-target',
		],
		['ensemblr_focus_tab', { chatTabId: 'chat-target' }, 'chat-target'],
		['private_tool', {}, 'Safe preview'],
	])(
		'projects the prepared target for %s without raw payloads',
		(name, input, target) => {
			const snapshot = session('session-1', {
				depth: 0,
				parentSessionId: null,
				rootSessionId: 'session-1',
			});
			const [conversation] = toAgentConversations({
				blockedSessionIds: new Set(),
				catalog: undefined,
				closedTabs: [],
				language: 'en',
				lineageBySessionId: new Map(),
				liveBySessionId: {
					'session-1': {
						activity: createAgentActivityState([
							{
								input: { ...input, secret: 'never render raw payload' },
								name,
								presentation: {
									version: 1,
									title: 'Safe activity',
									preview: { font: 'sans', text: 'Safe preview' },
								},
								toolCallId: 'tool-1',
							},
						]),
						branchId: snapshot.branchId,
						contextUsage: null,
						lastEventOrdinal: -1,
						runtimeIdentity: 'pi:runtime-session-1',
						snapshotUpdatedAt: snapshot.updatedAt,
						status: 'streaming',
					},
				},
				openTabs: [chatTab('chat-1', 'session-1')],
				sessions: [snapshot],
			});

			expect(conversation.activity).toMatchObject({ parallelCount: 1, target });
			expect(JSON.stringify(conversation)).not.toContain(
				'never render raw payload',
			);
		},
	);

	test('uses legacy hierarchy only when durable lineage is absent', () => {
		const conversations = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: undefined,
			closedTabs: [],
			language: 'en',
			lineageBySessionId: new Map([
				[
					'durable-session',
					{
						depth: 2,
						parentSessionId: 'missing-parent',
						rootSessionId: 'root-session',
					},
				],
			]),
			liveBySessionId: {},
			openTabs: [
				chatTab('legacy-child', 'legacy-session', {
					parentChatTabId: 'legacy-parent',
				}),
				chatTab('durable-child', 'durable-session', {
					parentChatTabId: 'stale-parent',
				}),
			],
			sessions: [],
		});

		expect(conversations).toMatchObject([
			{ chatTabId: 'legacy-child', depth: 1, parentChatTabId: 'legacy-parent' },
			{ chatTabId: 'durable-child', depth: 2, parentChatTabId: null },
		]);
	});

	test('preserves unknown nested model ids and omits generic tool payloads', () => {
		const snapshot = session(
			'session-1',
			{
				depth: 0,
				parentSessionId: null,
				rootSessionId: 'session-1',
			},
			'private-router/team/model-1',
		);
		const [conversation] = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: undefined,
			closedTabs: [],
			language: 'en',
			lineageBySessionId: new Map([
				['session-1', snapshot.lineage as AgentSessionLineage],
			]),
			liveBySessionId: {
				'session-1': {
					activity: createAgentActivityState([
						{
							input: { secret: 'never render this payload' },
							name: 'private_tool',
							toolCallId: 'tool-1',
						},
					]),
					branchId: snapshot.branchId,
					contextUsage: null,
					lastEventOrdinal: -1,
					runtimeIdentity: 'pi:runtime-session-1',
					snapshotUpdatedAt: snapshot.updatedAt,
					status: 'streaming',
				},
			},
			openTabs: [chatTab('chat-1', 'session-1')],
			sessions: [snapshot],
		});

		expect(conversation).toMatchObject({
			activity: { parallelCount: 1, target: null, title: 'private_tool' },
			model: 'private-router/team/model-1',
		});
		expect(JSON.stringify(conversation)).not.toContain(
			'never render this payload',
		);
	});
});
