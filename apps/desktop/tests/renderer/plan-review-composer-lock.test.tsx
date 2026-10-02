// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { type ChangeEvent, createRef, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { ComposerSlot } from '@/renderer/components/workbench-shell/conversation-panel/composer-slot';
import { useComposerAttachments } from '@/renderer/hooks/workbench-shell/composer/use-composer-attachments';
import {
	composerAttachmentsAtomFamily,
	composerValueAtomFamily,
	followUpQueueAtomFamily,
	forgetComposerDraft,
} from '@/renderer/state/composer';
import { pendingPlanReviewsAtom } from '@/renderer/state/plan-mode';
import type {
	ComposerShellState,
	QueuedFollowUp,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { createComposerShellState } from './support/composer';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const { handOff } = vi.hoisted(() => ({ handOff: vi.fn() }));
const writeWorkspaceFileAttachment = vi.fn();

vi.mock(
	'@/renderer/hooks/workbench-shell/conversation-panel/use-plan-handoff',
	() => ({ usePlanHandoff: () => ({ handOff, isHandingOff: false }) }),
);

const CHAT_TAB_ID = 'chat-plan-review';
const SESSION_ID = 'session-plan-review';
const DRAFT = 'Keep this refinement';

const workspace = {
	id: 'workspace-plan-review',
	projectId: 'repo-plan-review',
} as WorkspaceShellModel;

const session: SessionTabModel = {
	agentSessionId: SESSION_ID,
	chatTabId: CHAT_TAB_ID,
	id: CHAT_TAB_ID,
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Plan review',
	status: 'idle',
	summary: '',
	updatedLabel: 'Plan review',
};

const review = (sessionId = SESSION_ID) => ({
	agentSessionId: sessionId,
	planPath: '.context/plans/review.md',
	requestId: `request-${sessionId}`,
	title: 'Review plan',
	workspaceId: workspace.id,
});

/** Mounts the real slot, composer, and plan-review state over one test store. */
function mount({
	composer,
	reviewSessionId = SESSION_ID,
	store = createStore(),
}: {
	composer: ComposerShellState;
	reviewSessionId?: string;
	store?: ReturnType<typeof createStore>;
}) {
	store.set(composerValueAtomFamily(CHAT_TAB_ID), DRAFT);
	store.set(pendingPlanReviewsAtom, {
		[reviewSessionId]: review(reviewSessionId),
	});
	const client = createTestQueryClient();
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<Provider store={store}>{children}</Provider>
			</TooltipProvider>
		</QueryClientProvider>
	);
	const view = render(
		<ComposerSlot
			agentSessionId={SESSION_ID}
			chatTabId={CHAT_TAB_ID}
			composer={composer}
			workspace={workspace}
		/>,
		{ wrapper },
	);
	return { store, view };
}

/** Creates the normal enabled composer state backing the integration surface. */
function composerState(onSubmit = vi.fn().mockResolvedValue({})) {
	return {
		...createComposerShellState({
			activeAgentSessionId: SESSION_ID,
			activeSession: session,
		}),
		onSubmit,
	};
}

/** A queued user turn used to prove the idle auto-flush also respects the lock. */
function queuedTurn(): QueuedFollowUp {
	return {
		id: 'queued-1',
		queuedAt: '2026-09-12T10:00:00.000Z',
		segments: [{ kind: 'text', text: 'Do this next' }],
		snapshot: null,
		source: 'user',
		text: 'Do this next',
	};
}

afterEach(() => {
	forgetComposerDraft(CHAT_TAB_ID);
	clearEnsemblrApi();
	vi.clearAllMocks();
});

test('a file picker opened before the lock may finish after the lock', async () => {
	installEnsemblrApi({ writeWorkspaceFileAttachment });
	writeWorkspaceFileAttachment.mockResolvedValue({
		file: {
			isIgnored: true,
			kind: 'file',
			name: 'selected.txt',
			path: '.context/attachments/abc123/selected.txt',
		},
	});
	const store = createStore();
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);
	const editorRef = createRef<ComposerEditorHandle | null>();
	const { rerender, result } = renderHook(
		({ disabled }: { disabled: boolean }) =>
			useComposerAttachments({
				chatTabId: 'chat-file-picker-lock',
				disabled,
				editorRef,
				insertPlainText: vi.fn(),
				workspaceCwd: '/repo',
			}),
		{ initialProps: { disabled: true }, wrapper },
	);
	const input = document.createElement('input');
	const dataTransfer = new DataTransfer();
	dataTransfer.items.add(
		new File(['content'], 'selected.txt', { type: 'text/plain' }),
	);
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: dataTransfer.files,
	});
	result.current.fileInputRef.current = input;

	act(() =>
		result.current.handleFileChange({
			target: input,
		} as ChangeEvent<HTMLInputElement>),
	);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(writeWorkspaceFileAttachment).not.toHaveBeenCalled();

	rerender({ disabled: false });
	act(() => result.current.handleAddAttachment());
	rerender({ disabled: true });
	act(() =>
		result.current.handleFileChange({
			target: input,
		} as ChangeEvent<HTMLInputElement>),
	);
	await waitFor(() =>
		expect(writeWorkspaceFileAttachment).toHaveBeenCalledTimes(1),
	);
});

test('disabled attachment ingestion consumes pasted files without persisting them', async () => {
	installEnsemblrApi({ writeWorkspaceFileAttachment });
	writeWorkspaceFileAttachment.mockResolvedValue({
		file: {
			isIgnored: true,
			kind: 'file',
			name: 'pasted.txt',
			path: '.context/attachments/abc123/pasted.txt',
		},
	});
	const store = createStore();
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);
	const editorRef = createRef<ComposerEditorHandle | null>();
	const { result } = renderHook(
		() =>
			useComposerAttachments({
				chatTabId: 'chat-disabled-attachment-ingress',
				disabled: true,
				editorRef,
				insertPlainText: vi.fn(),
				workspaceCwd: '/repo',
			}),
		{ wrapper },
	);
	const dataTransfer = new DataTransfer();
	dataTransfer.items.add(
		new File(['content'], 'pasted.txt', { type: 'text/plain' }),
	);

	expect(result.current.consumePastedTransfer(dataTransfer)).toBe(true);
	const textTransfer = new DataTransfer();
	textTransfer.setData('text/plain', 'short text');
	expect(result.current.consumePastedTransfer(textTransfer)).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(writeWorkspaceFileAttachment).not.toHaveBeenCalled();
});

describe('plan-review composer lock', () => {
	test('locks editing, attachments, keyboard submit, and queue delivery while review is pending', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [queuedTurn()]);
		mount({
			composer: composerState(onSubmit),
			store,
		});

		const editor = screen.getByRole('textbox', { name: 'Agent composer' });
		expect(editor).toHaveAttribute('contenteditable', 'false');
		expect(screen.getByRole('button', { name: 'Attachments' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

		fireEvent.keyDown(editor, { key: 'Enter' });
		await Promise.resolve();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(store.get(followUpQueueAtomFamily(CHAT_TAB_ID))).toHaveLength(1);
	});

	test('refine preserves the locked draft and re-enables attachment ingestion', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		installEnsemblrApi({
			pinChatTab: async () => undefined,
			writeWorkspaceFileAttachment,
		});
		const { store } = mount({
			composer: composerState(onSubmit),
		});
		writeWorkspaceFileAttachment.mockResolvedValue({
			file: {
				isIgnored: true,
				kind: 'file',
				name: 'dropped.txt',
				path: '.context/attachments/abc123/dropped.txt',
			},
		});
		const dataTransfer = new DataTransfer();
		dataTransfer.items.add(
			new File(['content'], 'dropped.txt', { type: 'text/plain' }),
		);

		const reviewRegion = screen.getByRole('region', { name: 'Plan review' });
		fireEvent.drop(reviewRegion, { dataTransfer });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(writeWorkspaceFileAttachment).not.toHaveBeenCalled();
		expect(store.get(composerValueAtomFamily(CHAT_TAB_ID))).toBe(DRAFT);
		expect(store.get(composerAttachmentsAtomFamily(CHAT_TAB_ID))).toEqual([]);

		await userEvent.click(screen.getByRole('button', { name: 'Refine' }));

		const editor = screen.getByRole('textbox', { name: 'Agent composer' });
		await waitFor(() =>
			expect(editor).toHaveAttribute('contenteditable', 'true'),
		);
		expect(editor).toHaveTextContent(DRAFT);
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText('Upload attachment'), {
			target: {
				files: [new File(['content'], 'dropped.txt', { type: 'text/plain' })],
			},
		});
		await waitFor(() =>
			expect(writeWorkspaceFileAttachment).toHaveBeenCalledTimes(1),
		);
		await waitFor(() =>
			expect(
				store.get(composerAttachmentsAtomFamily(CHAT_TAB_ID)),
			).toHaveLength(1),
		);
		expect(store.get(composerValueAtomFamily(CHAT_TAB_ID))).toContain(DRAFT);
	});

	test('approve can submit, while failed and in-flight handoffs keep the composer locked', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		const { store } = mount({
			composer: composerState(onSubmit),
		});

		await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
		expect(onSubmit).toHaveBeenCalledWith('Approved — implement the plan.');

		act(() => store.set(pendingPlanReviewsAtom, { [SESSION_ID]: review() }));
		let finishHandoff: (value: null) => void = () => undefined;
		handOff.mockReturnValueOnce(
			new Promise<null>((resolve) => {
				finishHandoff = resolve;
			}),
		);
		await userEvent.click(screen.getByRole('button', { name: 'Hand off' }));
		expect(
			screen.getByRole('textbox', { name: 'Agent composer' }),
		).toHaveAttribute('contenteditable', 'false');

		await act(async () => finishHandoff(null));
		expect(store.get(pendingPlanReviewsAtom)[SESSION_ID]).toBeDefined();
		expect(
			screen.getByRole('textbox', { name: 'Agent composer' }),
		).toHaveAttribute('contenteditable', 'false');
	});

	test('a review for another session does not lock this tab', () => {
		mount({
			composer: composerState(),
			reviewSessionId: 'session-other',
		});

		expect(screen.queryByRole('region', { name: 'Plan review' })).toBeNull();
		expect(
			screen.getByRole('textbox', { name: 'Agent composer' }),
		).toHaveAttribute('contenteditable', 'true');
	});
});
