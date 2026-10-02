import { describe, expect, test } from 'vitest';

import { DemoBroadcastChannels } from '../../demo/demo-bridge';
import {
	DEMO_AGENT_HARNESSES,
	DEMO_AGENT_HIERARCHY,
} from '../../demo/fixtures/agents';
import { DEMO_ARCHITECTURE_SNAPSHOT } from '../../demo/fixtures/architecture';
import {
	DEMO_ENV_FILES,
	DEMO_ENVIRONMENT_VARIABLES,
} from '../../demo/fixtures/environment';
import { DEMO_WORKSPACE_HISTORY } from '../../demo/fixtures/history';
import {
	DEMO_LINEAR_ISSUE_DETAILS,
	DEMO_LINEAR_ISSUES,
	DEMO_LINEAR_METADATA,
} from '../../demo/fixtures/linear';
import {
	DEMO_MODEL_CATALOG,
	DEMO_MODEL_ROLE_APP_SETTINGS,
} from '../../demo/fixtures/models';
import { DEMO_REPOSITORY_SETTINGS } from '../../demo/fixtures/settings';
import { DEMO_UPDATE_AVAILABLE } from '../../demo/fixtures/updates';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../../demo/fixtures/workspaces';
import { createDemoHandlers } from '../../demo/handlers';
import { type DemoScenario, defineScenario } from '../../demo/scenario';
import type { ListAgentSessionsResult } from '../../src/shared/ipc/contracts/agent-session';
import type { ListAgentHarnessesResult } from '../../src/shared/ipc/contracts/agents';
import type { ListChatTabsResult } from '../../src/shared/ipc/contracts/chat-tab';
import type { ListConciergeArtifactsResult } from '../../src/shared/ipc/contracts/concierge';
import type { GetLinearIssueResult } from '../../src/shared/ipc/contracts/linear';
import type {
	GetWorkspaceCommitsResult,
	GetWorkspaceMergeConflictsResult,
} from '../../src/shared/ipc/contracts/workspace-git';

/** Calls one demo bridge handler and narrows its public result for assertions. */
function call<TResult>(
	handlers: ReturnType<typeof createDemoHandlers>,
	method: string,
	payload: unknown = undefined,
): TResult {
	return handlers[method]?.(payload) as TResult;
}

/** Builds a scenario around the shared fixtures with targeted overrides. */
function scenarioWith(overrides: Partial<DemoScenario> = {}): DemoScenario {
	return defineScenario({
		chat: {
			agentSessionId: 'session-root',
			branchId: 'branch-root',
			isStreaming: false,
			model: 'openai/gpt-5.4',
			provider: 'pi',
			tabId: 'tab-root',
			thinkingLevel: 'high',
			title: 'Root chat',
			transcript: [],
		},
		clock: DEMO_CLOCK,
		id: 'handler-test',
		label: 'Handler test',
		repositories: DEMO_REPOSITORIES,
		route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/tab-root',
		workspaceId: 'ws-release-notes',
		...overrides,
	});
}

/** Creates handlers for one frozen scenario. */
function handlersFor(scenario: DemoScenario) {
	return createDemoHandlers(() => scenario, new DemoBroadcastChannels());
}

describe('demo handlers', () => {
	test('projects a root, manager, and depth-two leaves with resolvable parent titles', () => {
		const scenario = scenarioWith({
			chat: DEMO_AGENT_HIERARCHY.root,
			subAgents: [DEMO_AGENT_HIERARCHY.manager, ...DEMO_AGENT_HIERARCHY.leaves],
		});
		const handlers = handlersFor(scenario);
		const { sessions } = call<ListAgentSessionsResult>(
			handlers,
			'listAgentSessions',
		);
		const { open } = call<ListChatTabsResult>(handlers, 'listChatTabs');
		const titleBySessionId = new Map(
			open.map((tab) => [tab.agentSessionId, tab.fullTitle]),
		);
		const leaves = sessions.filter((session) => session.lineage?.depth === 2);

		expect(leaves).toHaveLength(2);
		expect(leaves).toMatchObject([
			{
				lineage: {
					parentSessionId: DEMO_AGENT_HIERARCHY.manager.agentSessionId,
					rootSessionId: DEMO_AGENT_HIERARCHY.root.agentSessionId,
				},
			},
			{
				lineage: {
					parentSessionId: DEMO_AGENT_HIERARCHY.manager.agentSessionId,
					rootSessionId: DEMO_AGENT_HIERARCHY.root.agentSessionId,
				},
			},
		]);
		expect(
			leaves.map((leaf) =>
				titleBySessionId.get(leaf.lineage?.parentSessionId ?? null),
			),
		).toEqual([
			DEMO_AGENT_HIERARCHY.manager.title,
			DEMO_AGENT_HIERARCHY.manager.title,
		]);
	});

	test('preserves native session detail and partitions closed tabs', () => {
		const scenario = scenarioWith({
			subAgents: [
				{
					agentSessionId: 'session-child',
					branchId: 'branch-child',
					closedAt: '2026-09-04T11:10:00.000Z',
					contextUsage: {
						reading: 'last-recorded',
						usage: { contextWindow: 200_000, percent: 40, tokens: 80_000 },
					},
					currentTools: [
						{
							input: { path: 'demo/scenario.ts' },
							name: 'read',
							toolCallId: 'read-1',
						},
					],
					isStreaming: false,
					lineage: {
						depth: 1,
						parentSessionId: 'session-root',
						rootSessionId: 'session-root',
					},
					model: 'claude-sonnet-5',
					provider: 'claude',
					tabId: 'tab-child',
					thinkingLevel: 'medium',
					title: 'Closed delegate',
					transcript: [],
				},
			],
		});
		const handlers = handlersFor(scenario);

		const sessions = call<ListAgentSessionsResult>(
			handlers,
			'listAgentSessions',
		);
		const tabs = call<ListChatTabsResult>(handlers, 'listChatTabs');

		expect(sessions.sessions).toMatchObject([
			{ id: 'session-root', provider: 'pi', thinkingLevel: 'high' },
			{
				closedAt: '2026-09-04T11:10:00.000Z',
				contextUsage: {
					reading: 'last-recorded',
					usage: { contextWindow: 200_000, percent: 40, tokens: 80_000 },
				},
				currentTools: [{ name: 'read', toolCallId: 'read-1' }],
				id: 'session-child',
				lineage: {
					depth: 1,
					parentSessionId: 'session-root',
					rootSessionId: 'session-root',
				},
				provider: 'claude',
				status: 'closed',
				thinkingLevel: 'medium',
			},
		]);
		expect(tabs.open.map((tab) => tab.id)).toEqual(['tab-root']);
		expect(tabs.closed).toMatchObject([
			{
				closedAt: '2026-09-04T11:10:00.000Z',
				id: 'tab-child',
				metadata: { agentRole: 'subagent' },
			},
		]);
	});

	test('serves scenario-backed read surfaces and safe read defaults', () => {
		const scenario = scenarioWith({
			appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
			architecture: DEMO_ARCHITECTURE_SNAPSHOT,
			envFiles: DEMO_ENV_FILES,
			environment: DEMO_ENVIRONMENT_VARIABLES,
			linear: {
				issues: DEMO_LINEAR_ISSUES,
				issueDetails: DEMO_LINEAR_ISSUE_DETAILS,
				metadata: DEMO_LINEAR_METADATA,
				organizationName: 'Northwind',
			},
			repositorySettings: DEMO_REPOSITORY_SETTINGS,
			updateStatus: DEMO_UPDATE_AVAILABLE,
			workspaceHistory: DEMO_WORKSPACE_HISTORY,
		});
		const handlers = handlersFor(scenario);

		expect(call(handlers, 'getAppSettings')).toMatchObject({
			experimental: { architectureDiagram: true, tuiHarnesses: true },
			models: {
				allowCrossRuntimeDelegation: true,
				delegationInitiative: 'on-request',
			},
		});
		expect(call(handlers, 'resolveSettings')).toMatchObject({
			repository: {
				settings: [
					{ key: 'scripts.setup' },
					{ key: 'scripts.run' },
					{ key: 'filesToCopy' },
					{ key: 'archiveAfterMerge' },
					{ key: 'setUpstreamOnPush' },
					{ key: 'scripts.runScripts' },
				],
			},
		});
		expect(call(handlers, 'getArchitectureSnapshot')).toBe(
			DEMO_ARCHITECTURE_SNAPSHOT,
		);
		expect(call(handlers, 'environmentVariables')).toBe(
			DEMO_ENVIRONMENT_VARIABLES,
		);
		expect(call(handlers, 'listEnvFiles')).toBe(DEMO_ENV_FILES);
		expect(call(handlers, 'updateStatus')).toBe(DEMO_UPDATE_AVAILABLE);
		expect(call(handlers, 'listAllWorkspaces')).toBe(DEMO_WORKSPACE_HISTORY);
		const issueDetail = call<GetLinearIssueResult>(handlers, 'linearGetIssue', {
			id: 'ENG-412',
		});
		expect(issueDetail).toMatchObject({
			issue: { identifier: 'ENG-412' },
			status: 'ok',
		});
		expect(issueDetail.status === 'ok' && issueDetail.comments[0]?.id).toBe(
			'comment-eng-412-1',
		);
		expect(call<ListAgentHarnessesResult>(handlers, 'listAgentHarnesses')).toBe(
			DEMO_AGENT_HARNESSES,
		);
		expect(call(handlers, 'listAgentModels')).toBe(DEMO_MODEL_CATALOG);
		expect(
			call<GetWorkspaceCommitsResult>(handlers, 'getWorkspaceCommits'),
		).toEqual({ commits: [] });
		expect(
			call<GetWorkspaceMergeConflictsResult>(
				handlers,
				'getWorkspaceMergeConflicts',
			),
		).toEqual({ paths: [] });
		expect(
			call<ListConciergeArtifactsResult>(handlers, 'listConciergeArtifacts'),
		).toEqual({ artifacts: [] });
	});
});
