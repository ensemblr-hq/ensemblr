import type { DockTabId, ReviewPanelTab } from '@/renderer/types/workbench';
import type { AgentProviderReadinessWire } from '@/shared/ipc/contracts/agent-provider';
import type { AgentSessionEventWire } from '@/shared/ipc/contracts/agent-session';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';
import type { GithubPullRequestWire } from '@/shared/ipc/contracts/github';
import type {
	LinearIssueWire,
	LinearMetadataWire,
} from '@/shared/ipc/contracts/linear';
import type { RepositoryWorkspaceNavigationRepository } from '@/shared/ipc/contracts/repository-navigation';
import type { ReviewCommentWire } from '@/shared/ipc/contracts/review-comments';
import type { SetupCheckSnapshot } from '@/shared/ipc/contracts/setup';
import type {
	TerminalSessionKind,
	TerminalSessionStatus,
} from '@/shared/ipc/contracts/terminal';
import type { WorkspaceFileEntryWire } from '@/shared/ipc/contracts/workspace-files';
import type { WorkspaceGitFileWire } from '@/shared/ipc/contracts/workspace-git';
import type { RunScriptDefinition } from '@/shared/scripts';

/** Which of the app's two root theme classes a scenario is captured under. */
export type DemoTheme = 'dark' | 'light';

/** Content size the demo window is set to before a scenario is captured. */
export interface DemoWindowSize {
	height: number;
	width: number;
}

/**
 * A dock terminal and the output already in its scrollback. Nothing is spawned:
 * the renderer attaches to this the same way it attaches to a live PTY, so what
 * xterm renders is the real terminal with real ANSI handling.
 */
export interface DemoTerminal {
	id: string;
	kind: TerminalSessionKind;
	/** Scrollback the session replays on attach, ANSI escapes included. */
	output: string;
	/** Repository run script this session runs, for a `run-script` kind. */
	scriptName?: string;
	/**
	 * Lifecycle state the session reports; defaults to `running`.
	 *
	 * Load-bearing for the run-script header: while a run script is running the
	 * dock header replaces the split Run button with Stop, so a scenario that
	 * wants the script picker on camera has to report its run session finished.
	 */
	status?: TerminalSessionStatus;
	title: string;
}

/**
 * The chat a scenario opens, with the transcript its timeline replays. `branchId`
 * keys the persisted event list the timeline reads, and `agentSessionId` is what
 * the chat tab binds to — both are scenario-invented ids, not runtime ones.
 */
export interface DemoChat {
	agentSessionId: string;
	branchId: string;
	/** Marks the session `streaming`, which is what raises the working indicator. */
	isStreaming: boolean;
	model: string;
	/** Tab id this chat is bound to; defaults to `demo-chat` for the active one. */
	tabId?: string;
	title: string;
	transcript: readonly AgentSessionEventWire[];
}

/** The Linear data a scenario's Linear views render from. */
export interface DemoLinear {
	issues: readonly LinearIssueWire[];
	metadata: LinearMetadataWire;
	organizationName: string;
}

/** The Concierge panel's session transcript. */
export interface DemoConcierge {
	title: string;
	transcript: readonly ConciergeSessionEventWire[];
}

/**
 * One setup check as a scenario declares it. `updatedAt` is stamped from the
 * scenario's clock rather than authored, so every row carries the same frozen
 * instant the rest of the window does.
 */
export type DemoSetupCheck = Omit<SetupCheckSnapshot, 'updatedAt'>;

/**
 * Something the runtime does to the window once it has settled, before the shot.
 *
 * Several states the shot list needs belong to no route: the Providers page
 * holds its runtime tab in a `useState` seeded from the first descriptor, the
 * onboarding wizard holds its step in one seeded to `welcome`, a dialog is open
 * only while a component says so, a board card's menu opens on right-click, and
 * a settings row far down a long page is reached by scrolling. None of them may
 * be changed from here — `src/` is read-only to demo mode — so a scenario
 * reaches them the way a user would.
 *
 * `text` narrows a selector that matches several elements to the one whose
 * visible text contains it.
 */
export type DemoInteraction =
	| { kind: 'click'; selector: string; text?: string }
	| { kind: 'context-menu'; selector: string; text?: string }
	| { kind: 'press-key'; key: string; selector: string; text?: string }
	| { kind: 'scroll-into-view'; selector: string; text?: string };

/**
 * A finished agent plan waiting on the user, which raises the decision bar over
 * the composer and turns the chat's Plan Mode chip on.
 *
 * Both halves are pushes rather than answers: the plan arrives on main's
 * `onExitPlanMode` broadcast, and the chip reads a `localStorage`-backed atom.
 * Neither is an IPC call the bridge could answer, so a scenario declares the
 * plan and the runtime performs both.
 */
export interface DemoPlanReview {
	/** Workspace-relative path of the written plan. */
	planPath: string;
	title: string;
}

/**
 * One captured state of the app: which repositories exist, which workspace and
 * chat are open, which panels are showing what, and how the window is sized when
 * the shot is taken.
 *
 * Everything the demo bridge answers is derived from this object, so a scenario
 * file is the whole of what a screenshot shows. Every field beyond the first
 * handful is optional: a scenario declares the surfaces it puts on camera and
 * nothing else.
 */
export interface DemoScenario {
	chat: DemoChat;
	/** ISO instant every clock in the app reads, so no shot carries a live time. */
	clock: string;
	concierge?: DemoConcierge;
	/** Dock tab to open, appended to the route as `?dock=`. */
	dockTab?: DockTabId;
	/**
	 * Repo-relative path whose diff opens as the active tab. The diff viewer and
	 * any review comments on that file render with it, which is the state a
	 * review shot wants and the one a `reviewTab` alone does not reach.
	 */
	openDiffPath?: string;
	/**
	 * Spawned delegates, each in its own tab beside the open chat.
	 *
	 * Every one carries its own transcript and its own session, so a shot can open
	 * any of them and find the work it actually did — a tab strip full of empty
	 * panes would sell the opposite of what the fan-out is for.
	 */
	subAgents: readonly DemoChat[];
	/** Unified diff per repo-relative path, for the paths a shot opens. */
	fileDiffs: Readonly<Record<string, string>>;
	/**
	 * Changed files per workspace, keyed by the workspace's own path — which is
	 * what the git-status call carries. Every sidebar row reads its own counts
	 * from this, so a workspace absent from the map shows as clean rather than
	 * borrowing the open workspace's diff.
	 */
	gitFilesByPath: Readonly<Record<string, readonly WorkspaceGitFileWire[]>>;
	id: string;
	/** Gestures applied in order once the window settles, before it is captured. */
	interactions: readonly DemoInteraction[];
	label: string;
	linear?: DemoLinear;
	/** Board column per workspace id, seeded into the store the board reads. */
	boardStatusByWorkspaceId: Readonly<Record<string, string>>;
	/** A submitted plan awaiting the user's decision on the open chat. */
	planReview?: DemoPlanReview;
	/** Readiness per runtime; defaults to both reporting a healthy binary. */
	providers?: Readonly<Record<string, AgentProviderReadinessWire>>;
	pullRequest?: GithubPullRequestWire;
	repositories: readonly RepositoryWorkspaceNavigationRepository[];
	reviewComments: readonly ReviewCommentWire[];
	/** Review panel tab to open, appended to the route as `?review=`. */
	reviewTab?: ReviewPanelTab;
	/** Hash route the window loads, without the leading `#` or search params. */
	route: string;
	runScripts: readonly RunScriptDefinition[];
	/**
	 * The setup checks the diagnostics rollup and the onboarding wizard render.
	 * Both surfaces read the one snapshot, so a scenario that stages a runtime as
	 * missing stages it identically in each.
	 */
	setupChecks: readonly DemoSetupCheck[];
	terminals: readonly DemoTerminal[];
	theme: DemoTheme;
	window: DemoWindowSize;
	/** File tree for the review panel's Files tab. */
	workspaceFiles: readonly WorkspaceFileEntryWire[];
	/** Workspace the route opens; must exist in `repositories`. */
	workspaceId: string;
}

/** Fields every scenario may leave out, defaulted by {@link defineScenario}. */
type DemoScenarioDefaults = Pick<
	DemoScenario,
	| 'boardStatusByWorkspaceId'
	| 'fileDiffs'
	| 'gitFilesByPath'
	| 'interactions'
	| 'reviewComments'
	| 'runScripts'
	| 'setupChecks'
	| 'subAgents'
	| 'terminals'
	| 'theme'
	| 'window'
	| 'workspaceFiles'
>;

/** A scenario as authored, before defaults are filled in. */
type DemoScenarioInput = Omit<DemoScenario, keyof DemoScenarioDefaults> &
	Partial<DemoScenarioDefaults>;

/**
 * Window size the docs screenshots were taken at, and the default a scenario
 * inherits so a new one matches the set already in `docs/guide/images/`.
 */
export const DEFAULT_DEMO_WINDOW: DemoWindowSize = { height: 933, width: 1496 };

/**
 * Fills a scenario's optional fields and returns it typed, so a scenario file
 * states only what makes it different from every other one.
 * @param scenario - The scenario as authored.
 * @returns The scenario with defaults applied.
 */
export function defineScenario(scenario: DemoScenarioInput): DemoScenario {
	return {
		boardStatusByWorkspaceId: {},
		fileDiffs: {},
		gitFilesByPath: {},
		interactions: [],
		reviewComments: [],
		runScripts: [],
		setupChecks: [],
		subAgents: [],
		terminals: [],
		theme: 'dark',
		window: DEFAULT_DEMO_WINDOW,
		workspaceFiles: [],
		...scenario,
	};
}

/**
 * Builds the hash location a scenario opens, folding the panel selections into
 * the route's search params so a scenario names the tab it wants rather than
 * hand-writing a query string.
 * @param scenario - Scenario being applied.
 * @returns The href to navigate to.
 */
export function scenarioHref(scenario: DemoScenario): string {
	const search = new URLSearchParams();
	if (scenario.reviewTab) {
		search.set('review', scenario.reviewTab);
	}
	if (scenario.dockTab) {
		search.set('dock', scenario.dockTab);
	}
	const query = search.toString();
	// The diff opens as its own tab, so the route has to name that tab rather
	// than the chat the scenario's transcript belongs to.
	const path = scenario.openDiffPath
		? scenario.route.replace(/\/chats\/[^/?]+$/, '/chats/demo-diff')
		: scenario.route;
	return query ? `${path}?${query}` : path;
}
