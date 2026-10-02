// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createRef, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerSubmit } from '@/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { useAgentTurns } from '@/renderer/state/composer/agent-turns';
import {
	chatAppliedLinkedDirectoriesAtomFamily,
	chatLinkedDirectoriesAtomFamily,
} from '@/renderer/state/preferences';
import type {
	ComposerAttachment,
	ComposerDraftSegment,
} from '@/renderer/types/workbench';
import type {
	AgentSessionSnapshotWire,
	OpenAgentSessionResult,
} from '@/shared/ipc/contracts/agent-session';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';
import { formatLinkedDirectoriesBlock } from '@/shared/prompt-scaffolding';
import { createComposerShellState } from './support/composer';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from './support/dom';

const CHAT = 'linked-turn-chat';
const NOTES: ComposerAttachment = {
	id: 'wsfile:notes.md',
	kind: 'workspace-file',
	label: 'notes.md',
	path: 'notes.md',
};
const SESSION: AgentSessionSnapshotWire = {
	branchId: 'branch',
	closedAt: null,
	createdAt: '2026-09-08T00:00:00Z',
	cwd: '/repo',
	id: 'session',
	label: null,
	model: null,
	openedTabs: [],
	provider: 'claude',
	runtimeOpen: true,
	runtimeSessionId: 'native-session',
	status: 'idle',
	thinkingLevel: null,
	updatedAt: '2026-09-08T00:00:00Z',
	workspaceId: 'workspace',
};

function setup() {
	const store = createStore();
	const client = createTestQueryClient();
	const open = vi.fn<() => Promise<OpenAgentSessionResult>>(async () => ({
		session: SESSION,
	}));
	const submit = vi.fn(async () => ({ turnId: 'turn' }));
	installEnsemblrApi({ openAgentSession: open, submitAgentPrompt: submit });
	const hook = renderHook(
		() =>
			useAgentTurns({
				chatTabId: CHAT,
				isResolvingChatTab: false,
				linkedDirectoriesRequest: () =>
					store
						.get(chatLinkedDirectoriesAtomFamily(CHAT))
						.map((entry) => entry.path),
				masterPrompt: '',
				modelId: null,
				persistedActiveSession: undefined,
				planModeRequest: () => ({}),
				afkModeRequest: () => ({}),
				thinkingLevel: null,
				workspaceCwd: '/repo',
				workspaceId: 'workspace',
			}),
		{
			wrapper: ({ children }: PropsWithChildren) => (
				<Provider store={store}>
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				</Provider>
			),
		},
	);
	return { ...hook, store, open, submit };
}

function setupComposer(
	linkedDirectories: readonly { name: string; path: string }[] = [],
) {
	const store = createStore();
	store.set(chatLinkedDirectoriesAtomFamily(CHAT), linkedDirectories);
	const client = createTestQueryClient();
	const open = vi.fn<() => Promise<OpenAgentSessionResult>>(async () => ({
		session: SESSION,
	}));
	const submit = vi.fn(async () => ({ turnId: 'turn' }));
	const readWorkspaceFile =
		vi.fn<(request: { path: string }) => Promise<ReadWorkspaceFileResult>>();
	const editorRef = createRef<ComposerEditorHandle>();
	const setAttachmentError = vi.fn();
	const segments: readonly ComposerDraftSegment[] = [
		{ attachment: NOTES, kind: 'attachment' },
	];
	editorRef.current = {
		clear: vi.fn(),
		restore: vi.fn(),
	} as unknown as ComposerEditorHandle;
	installEnsemblrApi({
		openAgentSession: open,
		readWorkspaceFile,
		submitAgentPrompt: submit,
	});
	const hook = renderHook(
		() => {
			const turns = useAgentTurns({
				chatTabId: CHAT,
				isResolvingChatTab: false,
				linkedDirectoriesRequest: () =>
					store
						.get(chatLinkedDirectoriesAtomFamily(CHAT))
						.map((entry) => entry.path),
				masterPrompt: '',
				modelId: null,
				persistedActiveSession: undefined,
				planModeRequest: () => ({}),
				afkModeRequest: () => ({}),
				thinkingLevel: null,
				workspaceCwd: '/repo',
				workspaceId: 'workspace',
			});
			const composer = useComposerSubmit({
				chatTabId: CHAT,
				composer: {
					...createComposerShellState(),
					disabled: false,
					onSubmit: turns.onSubmit,
					workspaceCwd: '/repo',
				},
				editorRef,
				readDraft: () => ({ segments, text: '' }),
				setAttachmentError,
			});
			return { composer, turns };
		},
		{
			wrapper: ({ children }: PropsWithChildren) => (
				<Provider store={store}>
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				</Provider>
			),
		},
	);
	return {
		...hook,
		editorRef,
		open,
		readWorkspaceFile,
		setAttachmentError,
		store,
		submit,
	};
}

beforeEach(() => {
	installLocalStorage();
	chatAppliedLinkedDirectoriesAtomFamily.remove(CHAT);
	chatLinkedDirectoriesAtomFamily.remove(CHAT);
});
afterEach(clearEnsemblrApi);

describe('linked directory turn delivery', () => {
	it('reconciles additions and removals before submitting to the same chat', async () => {
		const { result, store, open, submit } = setup();
		await act(async () => {
			await result.current.onSubmit('first');
		});
		act(() => {
			store.set(chatLinkedDirectoriesAtomFamily(CHAT), [
				{ name: 'Notes', path: '/outside/Notes' },
			]);
		});
		await act(async () => {
			await result.current.onSubmit('read notes');
		});
		expect(open).toHaveBeenLastCalledWith(
			expect.objectContaining({
				resumeSessionId: SESSION.id,
				linkedDirectories: ['/outside/Notes'],
			}),
		);
		expect(store.get(chatAppliedLinkedDirectoriesAtomFamily(CHAT))).toEqual([
			'/outside/Notes',
		]);
		act(() => {
			store.set(chatLinkedDirectoriesAtomFamily(CHAT), []);
		});
		await act(async () => {
			await result.current.onSubmit('continue');
		});
		expect(open).toHaveBeenLastCalledWith(
			expect.objectContaining({
				resumeSessionId: SESSION.id,
				linkedDirectories: [],
			}),
		);
		expect(submit).toHaveBeenCalledTimes(3);
		expect(store.get(chatAppliedLinkedDirectoriesAtomFamily(CHAT))).toEqual([]);
	});

	it('keeps the send-time grant through delayed attachment serialization', async () => {
		const { editorRef, open, readWorkspaceFile, result, store, submit } =
			setupComposer([{ name: 'Snapshot', path: '/outside/Snapshot' }]);
		let resolveRead: ((result: ReadWorkspaceFileResult) => void) | undefined;
		readWorkspaceFile.mockImplementation(
			() =>
				new Promise<ReadWorkspaceFileResult>((resolve) => {
					resolveRead = resolve;
				}),
		);

		act(() => {
			result.current.composer.handleSubmit();
		});
		await vi.waitFor(() => {
			expect(readWorkspaceFile).toHaveBeenCalledWith({
				path: 'notes.md',
				workspaceCwd: '/repo',
			});
		});
		act(() => {
			store.set(chatLinkedDirectoriesAtomFamily(CHAT), [
				{ name: 'Changed later', path: '/outside/Changed' },
			]);
		});
		await act(async () => {
			resolveRead?.({ content: 'notes', path: 'notes.md', sizeBytes: 5 });
			await vi.waitFor(() => {
				expect(submit).toHaveBeenCalledTimes(1);
			});
		});
		const snapshot = ['/outside/Snapshot'];
		expect(open).toHaveBeenCalledWith(
			expect.objectContaining({ linkedDirectories: snapshot }),
		);
		expect(submit).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: [
					formatLinkedDirectoriesBlock(snapshot),
					'<attached_file path="notes.md">\nnotes\n</attached_file>',
				].join('\n\n'),
			}),
		);
		expect(store.get(chatAppliedLinkedDirectoriesAtomFamily(CHAT))).toEqual(
			snapshot,
		);
		expect(editorRef.current?.clear).toHaveBeenCalledTimes(1);
	});

	it('localizes replacement cancellation instead of exposing service prose', async () => {
		const { result, open } = setup();
		open.mockResolvedValueOnce({
			error: 'Agent session replacement was canceled during teardown.',
			errorCode: 'linked-directories-cancelled',
		});

		await act(async () => {
			expect(await result.current.onSubmit('read notes')).toEqual({
				error:
					'Directory changes were canceled while stopping the agent. Send again once it is idle.',
			});
		});
	});

	it('does not send or mark grants applied after a busy refusal, and retries', async () => {
		const { result, store, open, submit } = setup();
		await act(async () => {
			await result.current.onSubmit('first');
		});
		act(() => {
			store.set(chatLinkedDirectoriesAtomFamily(CHAT), [
				{ name: 'Notes', path: '/outside/Notes' },
			]);
		});
		open.mockResolvedValueOnce({
			error: 'busy',
			errorCode: 'linked-directories-busy',
		});
		await act(async () => {
			expect(await result.current.onSubmit('read notes')).toEqual({
				error: expect.stringContaining('once it is idle'),
			});
		});
		expect(submit).toHaveBeenCalledTimes(1);
		expect(store.get(chatAppliedLinkedDirectoriesAtomFamily(CHAT))).toEqual([]);
		await act(async () => {
			await result.current.onSubmit('read notes');
		});
		expect(submit).toHaveBeenCalledTimes(2);
		expect(store.get(chatAppliedLinkedDirectoriesAtomFamily(CHAT))).toEqual([
			'/outside/Notes',
		]);
	});
});
