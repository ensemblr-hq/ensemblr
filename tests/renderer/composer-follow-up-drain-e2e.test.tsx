// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createRef, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import type { ComposerEditorHandle } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerSubmit } from '../../src/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { getComposerState } from '../../src/renderer/lib/workbench';
import { useAgentComposerController } from '../../src/renderer/state/composer';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import type {
	ComposerShellState,
	SessionTabModel,
} from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { AgentModelCatalog } from '../../src/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '../../src/shared/ipc/contracts/agent-models';
import type {
	AgentSessionSnapshotWire,
	AgentSessionStatusWire,
	SubmitAgentPromptRequest,
} from '../../src/shared/ipc/contracts/agent-session';
import type { SetupDiagnosticsSnapshot } from '../../src/shared/ipc/contracts/setup';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from './support/dom';

const CHAT_TAB_ID = 'chat-tab-drain';
const WORKSPACE_ID = 'workspace-drain';
const SESSION_ID = 'session-drain';
const BRANCH_ID = 'branch-drain';
const MODEL_ID = 'anthropic/claude-sonnet';
const WORKSPACE_CWD = '/tmp/workspace-drain';

const CATALOG: AgentModelCatalog = {
	defaultModelId: MODEL_ID,
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: 'Claude Sonnet',
			id: MODEL_ID,
			vendor: asModelVendorId('anthropic'),
			thinkingLevels: ['medium'],
		},
	],
};

const READY_SETUP: SetupDiagnosticsSnapshot = {
	blockedCount: 0,
	checks: [],
	generatedAt: '2026-08-14T00:00:00.000Z',
	optionalCount: 0,
	requiredCount: 0,
	status: 'ready',
	successCount: 0,
	warningCount: 0,
};

const SESSION_TAB: SessionTabModel = {
	agentSessionId: SESSION_ID,
	chatTabId: CHAT_TAB_ID,
	id: CHAT_TAB_ID,
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Drain',
	status: 'idle',
	summary: '',
	updatedLabel: 'Drain',
};

/** The session row as main would return it at a given status. */
function sessionAt(status: AgentSessionStatusWire): AgentSessionSnapshotWire {
	return {
		branchId: BRANCH_ID,
		closedAt: null,
		createdAt: '2026-08-14T00:00:00.000Z',
		cwd: WORKSPACE_CWD,
		id: SESSION_ID,
		label: null,
		model: MODEL_ID,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: 'runtime-drain',
		status,
		thinkingLevel: 'medium',
		updatedAt: '2026-08-14T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/**
 * A bridge that behaves the way the main process does around a turn: a submit
 * flips the persisted row to `streaming` before it answers, and the turn ends
 * only when the test says so, by flipping the row back and broadcasting the
 * status event main emits.
 * @param sessionReadDelayMs - Latency to give the session read, so a test can put a real gap between a submit landing and the renderer learning a turn started
 */
function installTurnBridge(sessionReadDelayMs = 0) {
	let status: AgentSessionStatusWire = 'idle';
	const listeners = new Set<(broadcast: unknown) => void>();
	const submitAgentPrompt = vi.fn(
		async (_request: SubmitAgentPromptRequest) => {
			status = 'streaming';
			return { acceptedAt: '2026-08-14T00:00:01.000Z', turnId: 'turn-drain' };
		},
	);

	installEnsemblrApi({
		listAgentModels: vi.fn(async () => CATALOG),
		listAgentSessionEvents: vi.fn(async () => ({ events: [] })),
		listAgentSessions: vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, sessionReadDelayMs));
			return { sessions: [sessionAt(status)] };
		}),
		onAgentSessionEvent: vi.fn((listener: (broadcast: unknown) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		openAgentSession: vi.fn(async () => ({ session: sessionAt(status) })),
		submitAgentPrompt,
	});

	return {
		/** Ends the running turn exactly as main does: persist, then broadcast. */
		endTurn: () => {
			status = 'idle';
			for (const listener of listeners) {
				listener({
					event: {
						branchId: BRANCH_ID,
						createdAt: '2026-08-14T00:00:02.000Z',
						eventType: 'status',
						id: 'event-drain',
						ordinal: 1,
						payload: null,
						stream: 'agent',
						turnId: 'turn-drain',
					},
					sessionId: SESSION_ID,
					workspaceId: WORKSPACE_ID,
				});
			}
		},
		submitAgentPrompt,
	};
}

/** Yields to the macrotask queue so in-flight mutations and refetches settle. */
function settle(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/** The send pipeline the mounted composer exposes back to the test. */
type SubmitApi = ReturnType<typeof useComposerSubmit>;

const editorRef = createRef<ComposerEditorHandle>();

/**
 * Stands in for `ComposerPanelBody`: it owns the send pipeline and the flush,
 * and the slot above it can take it away, which is what an `ask_user_question`
 * card or a switch to another chat tab does in the app.
 */
function MountedComposer({
	composer,
	publish,
}: {
	composer: ComposerShellState;
	publish: (api: SubmitApi) => void;
}) {
	const api = useComposerSubmit({
		chatTabId: CHAT_TAB_ID,
		composer,
		editorRef,
		readDraft: () => ({ segments: [], text: '' }),
		setAttachmentError: vi.fn(),
	});
	useEffect(() => {
		publish(api);
	});
	return null;
}

/** Stands in for `WorkspaceRouteContent` plus `ComposerSlot`. */
function ChatHarness({
	composerMounted,
	publish,
	publishStreaming,
}: {
	composerMounted: boolean;
	publish: (api: SubmitApi) => void;
	publishStreaming: (isStreaming: boolean) => void;
}) {
	const agentComposer = useAgentComposerController({
		chatTabId: CHAT_TAB_ID,
		currentAgentSessionId: SESSION_ID,
		workspaceCwd: WORKSPACE_CWD,
		workspaceId: WORKSPACE_ID,
	});
	const composer = getComposerState({
		activeAgentSessionId: agentComposer.activeSessionId,
		activeSession: SESSION_TAB,
		availableModels: agentComposer.availableModels,
		availableThinkingLevels: agentComposer.availableThinkingLevels,
		contextUsage: agentComposer.contextUsage,
		isStreaming: agentComposer.isStreaming,
		lockedProvider: agentComposer.lockedProvider,
		modelId: agentComposer.modelId,
		onModelChange: agentComposer.onModelChange,
		afkMode: false,
		onAfkModeChange: () => undefined,
		onPlanModeChange: agentComposer.onPlanModeChange,
		onStop: agentComposer.onStop,
		onSubmit: agentComposer.onSubmit,
		onThinkingChange: agentComposer.onThinkingChange,
		planMode: agentComposer.planMode,
		setupDiagnostics: READY_SETUP,
		setupError: null,
		thinkingLevel: agentComposer.thinkingLevel,
		workspaceCwd: WORKSPACE_CWD,
		workspaceFiles: [],
	});
	useEffect(() => {
		publishStreaming(composer.isStreaming);
	});
	return composerMounted ? (
		<MountedComposer composer={composer} publish={publish} />
	) : null;
}

/** Mounts the controller and the composer over a fresh store and query cache. */
function mountChat() {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.agentModels(), CATALOG);
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{ sessions: [sessionAt('idle')] },
	);

	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		general: { ...DEFAULT_APP_SETTINGS.general, followUpBehavior: 'queue' },
	});

	editorRef.current = {
		appendText: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		restore: vi.fn(),
		setText: vi.fn(),
	} as unknown as ComposerEditorHandle;

	const latest = { streaming: false, submit: null as SubmitApi | null };
	const tree = (composerMounted: boolean) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<ChatHarness
					composerMounted={composerMounted}
					publish={(api) => {
						latest.submit = api;
					}}
					publishStreaming={(isStreaming) => {
						latest.streaming = isStreaming;
					}}
				/>
			</QueryClientProvider>
		</Provider>
	);

	const view = render(tree(true));
	return {
		isStreaming: () => latest.streaming,
		setComposerMounted: (mounted: boolean) => view.rerender(tree(mounted)),
		submit: () => {
			if (!latest.submit) {
				throw new Error('composer is not mounted');
			}
			return latest.submit;
		},
	};
}

/** Sends `text` through the composer the way pressing Send does. */
function send(chat: ReturnType<typeof mountChat>, text: string): void {
	chat.submit().dispatchSubmit({ segments: [{ kind: 'text', text }], text });
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('a queue draining against the real streaming state', () => {
	test('every queued message reaches the agent, one per turn', async () => {
		const { endTurn, submitAgentPrompt } = installTurnBridge();
		const chat = mountChat();

		await act(async () => {
			send(chat, 'start');
			await settle();
		});
		await waitFor(() => expect(chat.isStreaming()).toBe(true));

		act(() => {
			send(chat, 'first');
			send(chat, 'second');
		});
		expect(chat.submit().queue.entries).toHaveLength(2);

		await act(async () => {
			endTurn();
			await settle();
		});
		await waitFor(() => expect(submitAgentPrompt).toHaveBeenCalledTimes(2));

		await act(async () => {
			endTurn();
			await settle();
		});
		await waitFor(() => expect(submitAgentPrompt).toHaveBeenCalledTimes(3));

		expect(submitAgentPrompt.mock.calls.map((call) => call[0]?.prompt)).toEqual(
			['start', 'first', 'second'],
		);
		expect(chat.submit().queue.entries).toHaveLength(0);
	});

	test('a turn that ends while the composer is away still drains the queue', async () => {
		// The composer is not permanently mounted: `ComposerSlot` replaces it with
		// the ask_user_question card and the tool-approval card, and switching chat
		// tabs unmounts it outright. A queue that only drains on a transition it has
		// to be mounted to witness is stranded for good, because nothing else will
		// start the turn whose end it is waiting for.
		const { endTurn, submitAgentPrompt } = installTurnBridge();
		const chat = mountChat();

		await act(async () => {
			send(chat, 'start');
			await settle();
		});
		await waitFor(() => expect(chat.isStreaming()).toBe(true));

		act(() => {
			send(chat, 'queued while working');
		});
		expect(chat.submit().queue.entries).toHaveLength(1);

		await act(async () => {
			chat.setComposerMounted(false);
			await settle();
		});
		await act(async () => {
			endTurn();
			await settle();
		});
		await act(async () => {
			chat.setComposerMounted(true);
			await settle();
		});

		await waitFor(() => expect(submitAgentPrompt).toHaveBeenCalledTimes(2));
		expect(submitAgentPrompt.mock.calls[1]?.[0]?.prompt).toBe(
			'queued while working',
		);
		expect(chat.submit().queue.entries).toHaveLength(0);
	});

	test('a slow session read does not let the rest of the queue jump the turn', async () => {
		// The flush re-reads `isStreaming` the moment a send resolves, and the only
		// thing that makes it describe the turn that send just started is
		// `submitMutation` awaiting its session refetch. Give that read real latency
		// and a submit that stopped awaiting it would answer against the idle
		// snapshot from before the send, emptying the queue into one turn.
		const { endTurn, submitAgentPrompt } = installTurnBridge(20);
		const chat = mountChat();

		await act(async () => {
			send(chat, 'start');
			await settle();
		});
		await waitFor(() => expect(chat.isStreaming()).toBe(true));

		act(() => {
			send(chat, 'first');
			send(chat, 'second');
		});

		await act(async () => {
			endTurn();
			await new Promise((resolve) => setTimeout(resolve, 120));
		});

		expect(submitAgentPrompt).toHaveBeenCalledTimes(2);
		expect(chat.submit().queue.entries.map((entry) => entry.text)).toEqual([
			'second',
		]);
	});
});
