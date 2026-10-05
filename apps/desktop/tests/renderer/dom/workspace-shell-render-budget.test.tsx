// @vitest-environment happy-dom

/**
 * The workspace shell used to build the Agents panel's whole row model itself,
 * so every tool call of every running agent re-rendered the shell — the conversation
 * beside it, the review rail, the dock — whichever review tab was showing, and
 * the layout context value was rebuilt on each of those renders so nothing below
 * could hold a memo. The shell now only keeps the live state fed; the Agents tab
 * builds its own rows, and the rail is skipped when nothing it uses has moved.
 *
 * This counts renders of the conversation slot the shell hands its content to
 * and of the dock inside the rail, because those are the quantities the
 * fix changes.
 */

import { act, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr/query-keys';
import { WorkspaceWorkbenchContent } from '../../../src/renderer/components/workbench-shell/workspace-content';
import {
	getDefaultProject,
	getDefaultWorkspace,
} from '../../../src/renderer/fixtures/workbench';
import { agentWorkspaceLiveStateAtomFamily } from '../../../src/renderer/state/agents';
import type { ReviewPanelTab } from '../../../src/renderer/types/workbench';
import type {
	SessionTabActions,
	SessionTabState,
	WorkbenchDockActions,
	WorkbenchShellProps,
} from '../../../src/renderer/types/workbench-shell';
import type {
	AgentSessionEventBroadcast,
	AgentSessionSnapshotWire,
} from '../../../src/shared/ipc/contracts/agent-session';
import type { ChatTabWire } from '../../../src/shared/ipc/contracts/chat-tab';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const counters = vi.hoisted(() => ({ dock: 0, main: 0 }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useNavigate: () => () => undefined,
	useRouter: () => ({ navigate: () => undefined }),
}));
vi.mock('@/renderer/components/ui/resizable', () => ({
	ResizableHandle: () => null,
	ResizablePanel: ({ children }: { children?: ReactNode }) => <>{children}</>,
	ResizablePanelGroup: ({ children }: { children?: ReactNode }) => (
		<>{children}</>
	),
}));
vi.mock('@/renderer/components/workbench-shell/workbench-header', () => ({
	WorkbenchHeader: () => null,
}));
vi.mock(
	'@/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header',
	() => ({ RightSidebarHeader: () => null }),
);
vi.mock('@/renderer/components/workbench-shell/dock-panel/dock-panel', () => ({
	DockPanel: () => {
		counters.dock += 1;
		return null;
	},
}));
vi.mock(
	'@/renderer/components/workbench-shell/review-files/all-files-list',
	() => ({ AllFilesList: () => null }),
);
vi.mock(
	'@/renderer/components/workbench-shell/review-files/all-files-search-dialog',
	() => ({ AllFilesSearchDialog: () => null }),
);
vi.mock(
	'@/renderer/components/workbench-shell/checks-panel/checks-panel',
	() => ({
		ChecksPanel: () => null,
	}),
);

type BridgeListener = (event: AgentSessionEventBroadcast) => void;
type ShellProps = Parameters<typeof WorkspaceWorkbenchContent>[0];

const PROJECT = getDefaultProject();
const WORKSPACE = getDefaultWorkspace();

const NOOP = () => undefined;

const DOCK_ACTIONS: WorkbenchDockActions = {
	onAskAgentSetupScript: () => undefined,
	onCancelQueuedScript: () => undefined,
	onCloseTerminal: () => undefined,
	onNewTerminal: () => undefined,
	onOpenRunPort: () => undefined,
	onOpenSetupScripts: () => undefined,
	onRunScript: () => undefined,
	onRunSetupScript: () => undefined,
	onStartQueuedScript: () => undefined,
	onStopRunScript: () => undefined,
	onStopSetupScript: () => undefined,
};

const SESSION_NAVIGATION: SessionTabState & SessionTabActions = {
	closedSessions: [],
	closeSessionTab: () => undefined,
	closeSessionTabAsync: () => Promise.resolve({ replacementChatTabId: null }),
	effectiveActiveSession: WORKSPACE.sessions[0],
	openArchitectureDiagramTab: () => Promise.resolve(null),
	openCommentPreviewTab: () => Promise.resolve(null),
	openFilePreviewTab: () => Promise.resolve(null),
	openSessionTab: () => Promise.resolve(null),
	openTerminalTab: () => Promise.resolve(null),
	openTurnDiffTab: () => Promise.resolve(null),
	openWorkspaceFileDiffTab: () => Promise.resolve(null),
	pinSessionTab: () => undefined,
	reorderSessionTabs: () => undefined,
	restoreSessionTab: () => undefined,
	restoreSessionTabAsync: () => Promise.resolve(true),
	sessionTabs: WORKSPACE.sessions,
};

/** Stands in for the conversation, tallying every render the shell asks of it. */
function CountingMain() {
	counters.main += 1;
	return null;
}

/** Builds a composer state distinguishable by identity, the way a new streamed frame would. */
function composerState(): WorkbenchShellProps['composer'] {
	return {} as unknown as WorkbenchShellProps['composer'];
}

/** Produces one idle session snapshot for the workspace under test. */
function agentSession(id: string): AgentSessionSnapshotWire {
	return {
		activityOrdinal: 0,
		branchId: `branch-${id}`,
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		currentTools: [],
		cwd: '/tmp/workspace',
		id,
		label: null,
		lineage: { depth: 0, parentSessionId: null, rootSessionId: id },
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: `runtime-${id}`,
		status: 'idle',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE.id,
	};
}

/** Produces one open chat tab that has started the given session. */
function openChat(id: string, agentSessionId: string): ChatTabWire {
	return {
		agentSessionId,
		closedAt: null,
		fullTitle: `Chat ${id}`,
		id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title: id,
		workspaceId: WORKSPACE.id,
	};
}

/** Builds a status broadcast moving a session to streaming. */
function streamingBroadcast(
	sessionId: string,
	ordinal: number,
): AgentSessionEventBroadcast {
	return {
		event: {
			branchId: `branch-${sessionId}`,
			createdAt: '2026-01-01T00:00:01.000Z',
			eventType: 'status',
			id: `event-${ordinal}`,
			ordinal,
			payload: { kind: 'status', previous: 'idle', status: 'streaming' },
			stream: 'protocol',
			turnId: null,
		},
		sessionId,
		workspaceId: WORKSPACE.id,
	};
}

/** Mounts the real shell content over a seeded workspace and a capturing bridge. */
function renderShell(activeReviewTab: ReviewPanelTab) {
	let emit: BridgeListener = () => undefined;
	installEnsemblrApi({
		onAgentSessionEvent: (listener: BridgeListener) => {
			emit = listener;
			return () => undefined;
		},
		onTerminalLifecycle: () => () => undefined,
	});
	const client = createTestQueryClient();
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE.id),
		{ sessions: [agentSession('session-1')] },
	);
	client.setQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE.id), {
		closed: [],
		open: [openChat('chat-1', 'session-1')],
	});
	client.setQueryData(ensemblrQueryKeys.agentModels(), {
		defaultModelId: null,
		defaultThinkingLevel: null,
		models: [],
	});
	const store = createStore();
	const shell = (props: Partial<ShellProps> = {}) => (
		<Provider store={store}>
			<WorkspaceWorkbenchContent
				MainContent={CountingMain}
				activeProject={PROJECT}
				activeReviewTab={activeReviewTab}
				activeWorkspace={WORKSPACE}
				composer={composerState()}
				dockActions={DOCK_ACTIONS}
				dockTabId='setup'
				onDockTabChange={NOOP}
				onReviewTabChange={NOOP}
				onSessionTabChange={NOOP}
				sessionNavigation={SESSION_NAVIGATION}
				{...props}
			/>
		</Provider>
	);
	const view = renderWithProviders(shell(), { client });
	return {
		emit: (broadcast: AgentSessionEventBroadcast) => act(() => emit(broadcast)),
		rerender: (props?: Partial<ShellProps>) => view.rerender(shell(props)),
		store,
	};
}

const originalMatchMedia = window.matchMedia;

/** Reports a window wide enough to seat the rail beside the content. */
function matchWideViewport(query: string): MediaQueryList {
	return {
		addEventListener: () => undefined,
		addListener: () => undefined,
		dispatchEvent: () => false,
		matches: true,
		media: query,
		onchange: null,
		removeEventListener: () => undefined,
		removeListener: () => undefined,
	};
}

beforeEach(() => {
	counters.dock = 0;
	counters.main = 0;
	window.matchMedia = matchWideViewport;
});

afterEach(() => {
	window.matchMedia = originalMatchMedia;
	clearEnsemblrApi();
});

describe('workspace shell', () => {
	test('keeps its workspace live state current while the Agents tab is hidden', () => {
		const { emit, store } = renderShell('files');

		expect(
			store.get(agentWorkspaceLiveStateAtomFamily(WORKSPACE.id))['session-1']
				?.status,
		).toBe('idle');
		emit(streamingBroadcast('session-1', 1));

		expect(
			store.get(agentWorkspaceLiveStateAtomFamily(WORKSPACE.id))['session-1']
				?.status,
		).toBe('streaming');
	});

	test('does not re-render the conversation for agent events with another tab showing', () => {
		const { emit } = renderShell('files');
		const rendersAfterMount = counters.main;

		emit(streamingBroadcast('session-1', 1));
		emit(streamingBroadcast('session-1', 2));

		expect(counters.main).toBe(rendersAfterMount);
	});

	test('does not re-render the conversation for agent events with the Agents tab showing', () => {
		const { emit } = renderShell('agents');
		const rendersAfterMount = counters.main;

		emit(streamingBroadcast('session-1', 1));

		expect(screen.getByRole('status', { name: 'Working' })).toBeVisible();
		expect(counters.main).toBe(rendersAfterMount);
	});

	test('counts open conversations on the Agents tab header without building rows', () => {
		renderShell('files');

		const header = screen.getByRole('button', { name: /^Agents/ });

		expect(within(header).getByText('1')).toBeInTheDocument();
	});

	test('skips the review rail when an unrelated prop changes', () => {
		const { rerender } = renderShell('files');
		const dockRendersAfterMount = counters.dock;

		rerender({ composer: composerState() });

		expect(counters.main).toBeGreaterThan(1);
		expect(counters.dock).toBe(dockRendersAfterMount);
	});
});
