import type { AgentProviderId } from '@/shared/agent-provider';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import {
	type AgentModelCatalog,
	asModelVendorId,
} from '@/shared/ipc/contracts/agent-models';
import type {
	AgentProviderReadinessWire,
	ListAgentProviderSlashCommandsResult,
} from '@/shared/ipc/contracts/agent-provider';
import type {
	AgentSessionSnapshotWire,
	ListAgentSessionEventsResult,
	ListAgentSessionsResult,
} from '@/shared/ipc/contracts/agent-session';
import type { AppSettings } from '@/shared/ipc/contracts/app-settings';
import type {
	ChatTabWire,
	ListChatTabsResult,
} from '@/shared/ipc/contracts/chat-tab';
import type { ListTurnCheckpointsResult } from '@/shared/ipc/contracts/checkpoint';
import type {
	ConciergeContextPressureWire,
	ListConciergeEventsResult,
	OpenConciergeSessionResult,
} from '@/shared/ipc/contracts/concierge';
import type { GetPullRequestSnapshotResult } from '@/shared/ipc/contracts/github';
import type { HealthSnapshot } from '@/shared/ipc/contracts/health';
import type {
	GetLinearMetadataResult,
	LinearConnectionSummary,
	LinearMetadataWire,
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';
import type {
	ListReviewCommentsResult,
	ListReviewTodosResult,
} from '@/shared/ipc/contracts/review-comments';
import type { RootDirectorySnapshot } from '@/shared/ipc/contracts/root-directory';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';
import type {
	ListTerminalSessionsResult,
	TerminalSessionSnapshot,
	TerminalSnapshotResult,
} from '@/shared/ipc/contracts/terminal';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';
import type { ListWorkspaceFilesResult } from '@/shared/ipc/contracts/workspace-files';
import {
	type GetWorkspaceFileDiffResult,
	type GetWorkspaceGitStatusResult,
	summarizeWorkspaceGitFiles,
} from '@/shared/ipc/contracts/workspace-git';
import type {
	ListRepositoryBranchesResult,
	ListRepositoryIssuesResult,
	ListRepositoryPullRequestsResult,
} from '@/shared/ipc/contracts/workspace-sources';
import { EMPTY_MENU_BAR, type MenuBarDescriptor } from '@/shared/menu-bar';
import { isPassingSetupStatus } from '@/shared/setup-checks';

import type {
	DemoBridgeHandlers,
	DemoBroadcastChannels,
} from './demo-bridge.ts';
import {
	discoveredExecutable,
	healthyReadiness,
} from './fixtures/providers.ts';
import {
	DEMO_REPOSITORY_BRANCHES,
	DEMO_REPOSITORY_ISSUES,
	DEMO_REPOSITORY_PULL_REQUESTS,
} from './fixtures/repository-sources.ts';
import { demoRootDirectory } from './fixtures/root-directory.ts';
import { DEMO_OPEN_TARGETS } from './open-targets.ts';
import type { DemoChat, DemoScenario } from './scenario.ts';

/** Tab id the scenario's own chat is bound to when it names none. */
const ACTIVE_TAB_ID = 'demo-chat';

/** Bridge channel the timeline's live event stream arrives on. */
export const AGENT_EVENT_CHANNEL = 'onAgentSessionEvent';

/**
 * Bridge channel that opens the Concierge panel. The panel is raised by a
 * request from main rather than by a route, so a scenario that wants it on
 * camera has the runtime send one.
 */
export const CONCIERGE_FOCUS_CHANNEL = 'onFocusConciergeRequested';

/**
 * Bridge channel a finished plan arrives on. The plan-review decision bar is
 * raised by a push from main rather than by a query, so a scenario that stages
 * one has the runtime send it.
 */
export const EXIT_PLAN_MODE_CHANNEL = 'onExitPlanMode';

/**
 * Reads a string field off a bridge request. Handlers are handed `unknown`
 * because the demo bridge bypasses the typed preload surface, so every answer
 * that depends on its request narrows the same way.
 * @param payload - The request a renderer query passed to the bridge.
 * @param field - Field to read.
 * @returns The field's value as a string, or an empty string when absent.
 */
function readField(payload: unknown, field: string): string {
	if (typeof payload !== 'object' || payload === null) {
		return '';
	}
	return field in payload
		? String((payload as Record<string, unknown>)[field])
		: '';
}

/**
 * Builds one chat's tab row.
 * @param chat - The chat the tab is bound to.
 * @param scenario - Scenario being applied.
 * @param position - Slot in the tab strip.
 * @param isSubAgent - Whether the tab hosts a spawned delegate.
 * @returns The tab row the session strip and the timeline both read.
 */
function chatTab(
	chat: DemoChat,
	scenario: DemoScenario,
	position: number,
	isSubAgent: boolean,
): ChatTabWire {
	return {
		agentSessionId: chat.agentSessionId,
		closedAt: null,
		fullTitle: chat.title,
		id: chat.tabId ?? ACTIVE_TAB_ID,
		isPreview: false,
		kind: 'chat',
		// The marker `isSubAgentTab` reads. It is what badges the tab as a delegate
		// and swaps its composer for the read-only runtime readout.
		metadata: isSubAgent ? { agentRole: 'subagent' } : {},
		openedAt: scenario.clock,
		position,
		title: chat.title,
		workspaceId: scenario.workspaceId,
	};
}

/**
 * Builds the agent session one chat's timeline resolves its branch and streaming
 * state from.
 * @param chat - The chat the session belongs to.
 * @param scenario - Scenario being applied.
 * @returns The session snapshot the workspace's session list returns.
 */
function chatSession(
	chat: DemoChat,
	scenario: DemoScenario,
): AgentSessionSnapshotWire {
	return {
		branchId: chat.branchId,
		closedAt: null,
		createdAt: scenario.clock,
		cwd: workspacePath(scenario),
		id: chat.agentSessionId,
		label: chat.title,
		model: chat.model,
		openedTabs: [],
		provider: 'claude',
		runtimeOpen: chat.isStreaming,
		runtimeSessionId: `${chat.agentSessionId}-runtime`,
		status: chat.isStreaming ? 'streaming' : 'idle',
		thinkingLevel: null,
		updatedAt: scenario.clock,
		workspaceId: scenario.workspaceId,
	};
}

/**
 * Every chat the scenario puts in the tab strip: the open one first, then each
 * spawned delegate.
 * @param scenario - Scenario being applied.
 * @returns The chats, in tab-strip order.
 */
function allChats(scenario: DemoScenario): readonly DemoChat[] {
	return [scenario.chat, ...scenario.subAgents];
}

/**
 * Reads the on-disk path of the workspace a scenario opens.
 * @param scenario - Scenario being applied.
 * @returns The workspace's path, or an empty string when the id matches none.
 */
function workspacePath(scenario: DemoScenario): string {
	for (const repository of scenario.repositories) {
		for (const workspace of repository.workspaces) {
			if (workspace.id === scenario.workspaceId) {
				return workspace.path;
			}
		}
	}
	return '';
}

/**
 * Turns a scenario's declared terminal into the session snapshot the dock reads.
 * @param terminal - Terminal as the scenario declares it.
 * @param scenario - Scenario being applied.
 * @returns The session snapshot, reported as running.
 */
function terminalSession(
	terminal: DemoScenario['terminals'][number],
	scenario: DemoScenario,
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 120,
		commandLabel: terminal.title,
		createdAt: scenario.clock,
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: terminal.id,
		kind: terminal.kind,
		previewUrl:
			terminal.kind === 'run-script' ? 'http://localhost:5173/' : null,
		restored: false,
		rows: 30,
		scriptName: terminal.scriptName ?? null,
		status: terminal.status ?? 'running',
		title: terminal.title,
		titleIsDefault: false,
		workspaceId: scenario.workspaceId,
	};
}

/**
 * Rolls a scenario's declared setup checks up the way the main process does, so
 * the summary strip's counts and the rows beneath it are one statement rather
 * than two that can disagree. A scenario declaring no checks reports an empty
 * ready rollup, which is what every shot that is not about setup wants.
 * @param scenario - Scenario being applied.
 * @returns The diagnostics rollup the Diagnostics page and the wizard both read.
 */
function setupSnapshot(scenario: DemoScenario): SetupDiagnosticsSnapshot {
	const checks = scenario.setupChecks.map((check) => ({
		...check,
		updatedAt: scenario.clock,
	}));
	const requiredChecks = checks.filter((check) => check.blocking);
	const blockedChecks = requiredChecks.filter(
		(check) => !isPassingSetupStatus(check.status),
	);

	return {
		blockedCount: blockedChecks.length,
		checks,
		generatedAt: scenario.clock,
		optionalCount: checks.length - requiredChecks.length,
		requiredCount: requiredChecks.length,
		status: blockedChecks.length === 0 ? 'ready' : 'blocked',
		successCount: checks.filter((check) => check.status === 'success').length,
		warningCount: checks.filter((check) => check.status === 'warning').length,
	};
}

/**
 * Answers the settings-resolution call the dock reads its run scripts from.
 *
 * The dock does not read `scenario.runScripts` directly — it derives them from
 * resolved repository settings, the same path the Scripts settings screen
 * writes — so a scenario's scripts have to be handed back in the wire shape a
 * `.ensemblr/settings.toml` would produce, `available_in` and `default` spelling
 * included.
 * @param scenario - Scenario being applied.
 * @returns The resolution snapshot, with only the run-script entry populated.
 */
function scriptSettings(scenario: DemoScenario): SettingsResolutionSnapshot {
	return {
		app: { diagnostics: [], settings: [] },
		repository: {
			diagnostics: [],
			settings: [
				{
					candidates: [],
					key: 'scripts.runScripts',
					locked: false,
					source: 'ensemblr-config',
					value: scenario.runScripts.map((script) => ({
						available_in: script.availableIn,
						command: script.command,
						default: script.isDefault,
						icon: script.icon,
						name: script.name,
					})),
				},
			],
		},
	};
}

/**
 * Reports healthy process and database state, so no diagnostics surface paints a
 * warning over a scenario.
 * @param scenario - Scenario being applied, for its frozen clock.
 * @returns A clean health snapshot.
 */
function cleanHealth(scenario: DemoScenario): HealthSnapshot {
	return {
		appName: 'Ensemblr',
		config: {
			blocksReadiness: false,
			diagnostics: [],
			displayPath: '~/.config/ensemblr/config.json',
			loadedAt: scenario.clock,
			path: '/demo/.config/ensemblr/config.json',
			schemaVersion: 1,
			status: 'ok',
		},
		database: { path: '/demo/ensemblr.db', schemaVersion: 1, status: 'ok' },
		platform: 'darwin',
		status: 'ok',
		timestamp: scenario.clock,
		versions: { chrome: '140.0.0.0', electron: '44.0.0', node: '24.18.1' },
	};
}

/** The model catalogue the composer's picker renders. */
const DEMO_MODEL_CATALOG: AgentModelCatalog = {
	defaultModelId: 'claude-opus-5',
	defaultThinkingLevel: null,
	models: [
		{
			agentProvider: 'claude',
			contextWindow: 1_000_000,
			displayName: 'Opus 5',
			id: 'claude-opus-5',
			thinkingLevels: [],
			vendor: asModelVendorId('anthropic'),
		},
		{
			agentProvider: 'claude',
			contextWindow: 200_000,
			displayName: 'Sonnet 5',
			id: 'claude-sonnet-5',
			thinkingLevels: [],
			vendor: asModelVendorId('anthropic'),
		},
	],
};

/** Reports no update available, so no update banner covers a scenario. */
const DEMO_UPDATE_STATUS: UpdateStatusSnapshot = {
	availableVersion: null,
	channel: 'release',
	currentVersion: '0.1.2',
	failure: null,
	notes: null,
	releaseUrl: null,
	state: 'idle',
};

/** Empty metadata tables, returned alongside a Linear failure envelope. */
const EMPTY_LINEAR_METADATA: LinearMetadataWire = {
	cycles: [],
	labels: [],
	projects: [],
	states: [],
	syncedAt: null,
	teams: [],
	users: [],
};

/** Concierge gauge reading: connected, well under its threshold. */
const DEMO_CONTEXT_PRESSURE: ConciergeContextPressureWire = {
	maxTokens: 1_000_000,
	overThreshold: false,
	percent: 12,
	thresholdPercent: 80,
	usedTokens: 120_000,
};

/**
 * App settings for the demo window: the shipped defaults, with the appearance
 * section pinned to the scenario's theme and the first-run wizard marked done so
 * no route redirects to onboarding.
 * @param scenario - Scenario being applied.
 * @returns The settings the renderer mirrors into its preference atoms.
 */
function demoAppSettings(scenario: DemoScenario): AppSettings {
	return {
		...DEFAULT_APP_SETTINGS,
		appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: scenario.theme },
		// The Concierge's model is a setting rather than a session field, so an
		// unset one leaves its composer reading "Select model".
		concierge: {
			...DEFAULT_APP_SETTINGS.concierge,
			model: scenario.chat.model,
			provider: 'claude',
			thinkingLevel: 'medium',
		},
		models: {
			...DEFAULT_APP_SETTINGS.models,
			defaultModel: scenario.chat.model,
		},
		onboarding: { completedAt: scenario.clock },
	};
}

/**
 * Reads a runtime's readiness, preferring the scenario's own override so a shot
 * can put a provider in a state other than healthy.
 * @param scenario - Scenario being applied.
 * @param payload - The request, naming the provider.
 * @returns The readiness snapshot the Providers page renders.
 */
function providerReadiness(
	scenario: DemoScenario,
	payload: unknown,
): AgentProviderReadinessWire {
	const provider = (readField(payload, 'provider') ||
		'claude') as AgentProviderId;
	return (
		scenario.providers?.[provider] ?? healthyReadiness(provider, scenario.clock)
	);
}

/**
 * Reports Linear as connected to one organization, which is what the Linear
 * views need before they render anything at all.
 * @param scenario - Scenario being applied.
 * @returns The connection summary, or a disconnected one when the scenario declares no Linear data.
 */
function linearConnection(scenario: DemoScenario): LinearConnectionSummary {
	if (!scenario.linear) {
		return { accounts: [], state: 'disconnected' };
	}
	return {
		accounts: [
			{
				expiresAt: null,
				id: 'demo-linear-account',
				lastErrorCode: null,
				organizationId: 'demo-org',
				organizationName: scenario.linear.organizationName,
				organizationUrlKey: scenario.linear.organizationName.toLowerCase(),
				scopes: ['read', 'write'],
				state: 'connected',
				updatedAt: scenario.clock,
				userEmail: 'you@example.com',
				userId: 'user-you',
				userName: 'Philipp',
			},
		],
		state: 'connected',
	};
}

/**
 * Maps the demo bridge's method names onto scenario-derived answers.
 *
 * Everything not named here falls through to the Proxy's no-op, which is the
 * point: a scenario satisfies the calls its own route makes and nothing else.
 * @param getScenario - Reads the scenario currently applied, so an HMR swap takes effect without reinstalling the bridge.
 * @param channels - Broadcast registry backing the `on*` subscriptions.
 * @returns The handler map the demo bridge answers from.
 */
export function createDemoHandlers(
	getScenario: () => DemoScenario,
	channels: DemoBroadcastChannels,
): DemoBridgeHandlers {
	return {
		conciergeContextPressure: (): ConciergeContextPressureWire =>
			DEMO_CONTEXT_PRESSURE,
		getAgentProviderExecutablePath: (payload) =>
			discoveredExecutable(
				(readField(payload, 'provider') || 'claude') as AgentProviderId,
			),
		getAgentProviderReadiness: (payload): AgentProviderReadinessWire =>
			providerReadiness(getScenario(), payload),
		getAppSettings: (): AppSettings => demoAppSettings(getScenario()),
		getMenuBar: (): MenuBarDescriptor => EMPTY_MENU_BAR,
		getPullRequestSnapshot: (): GetPullRequestSnapshotResult => {
			const scenario = getScenario();
			return {
				fromCache: true,
				snapshot: scenario.pullRequest
					? {
							branchSync: {
								ahead: 3,
								behind: 0,
								branchName: scenario.pullRequest.headRefName,
								hasUpstream: true,
							},
							pullRequest: scenario.pullRequest,
							syncedAt: scenario.clock,
						}
					: null,
			};
		},
		getSystemLanguages: (): string[] => ['en-US'],
		getWorkspaceFileDiff: (payload): GetWorkspaceFileDiffResult => {
			const path = readField(payload, 'path');
			return { patch: getScenario().fileDiffs[path], path };
		},
		getWorkspaceGitStatus: (payload): GetWorkspaceGitStatusResult =>
			summarizeWorkspaceGitFiles(
				getScenario().gitFilesByPath[readField(payload, 'workspaceCwd')] ?? [],
			),
		health: (): HealthSnapshot => cleanHealth(getScenario()),
		linearConnectionStatus: (): LinearConnectionSummary =>
			linearConnection(getScenario()),
		linearListIssues: (): ListLinearIssuesResult => ({
			accountFailures: [],
			issues: [...(getScenario().linear?.issues ?? [])],
			source: 'cache',
			status: 'ok',
		}),
		linearMetadata: (): GetLinearMetadataResult => {
			const linear = getScenario().linear;
			return linear
				? { accountFailures: [], metadata: linear.metadata, status: 'ok' }
				: {
						accountFailures: [],
						failure: {
							code: 'not-connected',
							message: 'Linear is not connected.',
							retryAfterSeconds: null,
						},
						metadata: EMPTY_LINEAR_METADATA,
						status: 'error',
					};
		},
		listAgentModels: (): AgentModelCatalog => DEMO_MODEL_CATALOG,
		listAgentProviderSlashCommands:
			(): ListAgentProviderSlashCommandsResult => ({
				commands: [],
				error: null,
				source: 'static',
			}),
		listAgentSessionEvents: (payload): ListAgentSessionEventsResult => {
			const branchId = readField(payload, 'branchId');
			const chat = allChats(getScenario()).find(
				(candidate) => candidate.branchId === branchId,
			);
			return { events: chat?.transcript ?? [] };
		},
		listAgentSessions: (): ListAgentSessionsResult => {
			const scenario = getScenario();
			return {
				sessions: allChats(scenario).map((chat) => chatSession(chat, scenario)),
			};
		},
		listAllChatTabs: (): ListChatTabsResult => listTabs(getScenario()),
		listChatTabs: (): ListChatTabsResult => listTabs(getScenario()),
		listChatTabSummaries: () => ({ entries: [] }),
		listConciergeEvents: (): ListConciergeEventsResult => ({
			events: getScenario().concierge?.transcript ?? [],
		}),
		listRepositoryBranches: (payload): ListRepositoryBranchesResult => ({
			branches: [
				...(DEMO_REPOSITORY_BRANCHES[readField(payload, 'repositoryId')] ?? []),
			],
			status: 'ok',
		}),
		listRepositoryIssues: (payload): ListRepositoryIssuesResult => ({
			issues: [
				...(DEMO_REPOSITORY_ISSUES[readField(payload, 'repositoryId')] ?? []),
			],
			source: 'cache',
			status: 'ok',
			syncedAt: getScenario().clock,
		}),
		listRepositoryPullRequests: (
			payload,
		): ListRepositoryPullRequestsResult => ({
			pullRequests: [
				...(DEMO_REPOSITORY_PULL_REQUESTS[readField(payload, 'repositoryId')] ??
					[]),
			],
			status: 'ok',
		}),
		listRestorableTerminals: () => ({ terminals: [] }),
		listReviewComments: (): ListReviewCommentsResult => ({
			comments: getScenario().reviewComments,
		}),
		listReviewTodos: (): ListReviewTodosResult => ({ todos: [] }),
		listTerminalSessions: (): ListTerminalSessionsResult => {
			const scenario = getScenario();
			return {
				sessions: scenario.terminals.map((terminal) =>
					terminalSession(terminal, scenario),
				),
			};
		},
		listTurnCheckpoints: (): ListTurnCheckpointsResult => ({
			checkpoints: [],
		}),
		listWorkspaceFiles: (): ListWorkspaceFilesResult => ({
			files: getScenario().workspaceFiles,
		}),
		listWorkspaceOpenTargets: () => ({ targets: DEMO_OPEN_TARGETS }),
		onAgentSessionEvent: channels.subscriber(AGENT_EVENT_CHANNEL),
		onExitPlanMode: channels.subscriber(EXIT_PLAN_MODE_CHANNEL),
		onFocusConciergeRequested: channels.subscriber(CONCIERGE_FOCUS_CHANNEL),
		onMenuBarChanged: channels.subscriber('onMenuBarChanged'),
		onTerminalLifecycle: channels.subscriber('onTerminalLifecycle'),
		onTerminalOutput: channels.subscriber('onTerminalOutput'),
		openConciergeSession: (): OpenConciergeSessionResult => {
			const scenario = getScenario();
			if (!scenario.concierge) {
				return {};
			}
			return {
				session: {
					closedAt: null,
					createdAt: scenario.clock,
					cwd: workspacePath(scenario),
					id: 'demo-concierge',
					lastError: null,
					model: scenario.chat.model,
					provider: 'claude',
					runtimeOpen: true,
					status: 'idle',
					thinkingLevel: null,
					title: scenario.concierge.title,
					updatedAt: scenario.clock,
				},
			};
		},
		repositoryWorkspaceNavigation:
			(): RepositoryWorkspaceNavigationSnapshot => ({
				generatedAt: getScenario().clock,
				repositories: [...getScenario().repositories],
			}),
		reportActiveChat: () => undefined,
		resolveSettings: (): SettingsResolutionSnapshot =>
			scriptSettings(getScenario()),
		rootDirectory: (): RootDirectorySnapshot => demoRootDirectory(),
		setupDiagnostics: (): SetupDiagnosticsSnapshot =>
			setupSnapshot(getScenario()),
		terminalSnapshot: (payload): TerminalSnapshotResult => {
			const scenario = getScenario();
			const terminalId = readField(payload, 'terminalId');
			const terminal = scenario.terminals.find(
				(candidate) => candidate.id === terminalId,
			);
			return {
				lastSeq: 0,
				scrollback: terminal?.output ?? '',
				session: terminal ? terminalSession(terminal, scenario) : null,
			};
		},
		updateStatus: (): UpdateStatusSnapshot => DEMO_UPDATE_STATUS,
	};
}

/**
 * Assembles the workspace's tab strip from the open chat plus any extra tabs the
 * scenario declares.
 * @param scenario - Scenario being applied.
 * @returns The open and closed tab lists.
 */
function listTabs(scenario: DemoScenario): ListChatTabsResult {
	const tabs = allChats(scenario).map((chat, index) =>
		chatTab(chat, scenario, index, index > 0),
	);
	if (scenario.openDiffPath) {
		tabs.push(diffTab(scenario, scenario.openDiffPath, tabs.length));
	}
	return { closed: [], open: tabs };
}

/**
 * Builds the diff tab a scenario opens over a changed file. It is an ordinary
 * chat tab of kind `diff` carrying the path in metadata — the same row
 * `openWorkspaceFileDiffTab` writes when the user clicks a file in the Changes
 * list.
 * @param scenario - Scenario being applied.
 * @param filePath - Repo-relative path the tab shows.
 * @param position - Slot in the tab strip.
 * @returns The diff tab as the strip reads it.
 */
function diffTab(
	scenario: DemoScenario,
	filePath: string,
	position: number,
): ChatTabWire {
	const title = filePath.split('/').pop() ?? filePath;
	return {
		agentSessionId: null,
		closedAt: null,
		fullTitle: filePath,
		id: 'demo-diff',
		isPreview: false,
		kind: 'diff',
		metadata: { filePath },
		openedAt: scenario.clock,
		position,
		title,
		workspaceId: scenario.workspaceId,
	};
}
