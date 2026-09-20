// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createRef, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: vi.fn(),
}));

import type { ComposerEditorHandle } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerSubmit } from '../../src/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { primedActionAtomFamily } from '../../src/renderer/state/composer';
import type { ComposerDraftSegment } from '../../src/renderer/types/workbench';
import { createComposerShellState } from './support/composer';
import { installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-tab-primed';
const PRIMED_MESSAGE = 'Review this branch';

const CHIP_SEGMENT: ComposerDraftSegment = {
	attachment: {
		id: 'chip-1',
		kind: 'workspace-file',
		label: 'notes.md',
		path: 'docs/notes.md',
	},
	kind: 'attachment',
};

/**
 * Mounts the send pipeline with a fixed draft and a primed action already
 * waiting, so the consumer effect delivers it on the first render.
 * @param options - The draft the editor holds and whether the action asks to auto-submit
 */
function mountWithPrimedAction({
	autoSubmit,
	draftSegments,
	draftText,
}: {
	autoSubmit: boolean;
	draftSegments: readonly ComposerDraftSegment[];
	draftText: string;
}) {
	const store = createStore();
	store.set(primedActionAtomFamily(CHAT_TAB_ID), {
		attachmentContent: 'prompt body',
		attachmentPath: '.context/prompt.md',
		autoSubmit,
		message: PRIMED_MESSAGE,
	});

	const onSubmit = vi.fn<(prompt: string) => Promise<{ error?: string }>>(() =>
		Promise.resolve({}),
	);
	const editor = {
		appendText: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		restore: vi.fn(),
		setText: vi.fn(),
	};
	const editorRef = createRef<ComposerEditorHandle>();
	editorRef.current = editor as unknown as ComposerEditorHandle;

	renderHook(
		() =>
			useComposerSubmit({
				chatTabId: CHAT_TAB_ID,
				composer: {
					...createComposerShellState(),
					disabled: false,
					isStreaming: false,
					onSubmit,
				},
				editorRef,
				readDraft: () => ({ segments: draftSegments, text: draftText }),
				setAttachmentError: vi.fn(),
			}),
		{
			wrapper: ({ children }: PropsWithChildren) => (
				<Provider store={store}>{children}</Provider>
			),
		},
	);

	return {
		editor,
		onSubmit,
		primed: () => store.get(primedActionAtomFamily(CHAT_TAB_ID)),
	};
}

beforeEach(() => {
	installLocalStorage();
});

describe('delivering a primed agent action over an existing draft', () => {
	test('an attachment-only draft survives an auto-submit action', async () => {
		const { editor, onSubmit, primed } = mountWithPrimedAction({
			autoSubmit: true,
			draftSegments: [CHIP_SEGMENT],
			draftText: ' ',
		});

		await waitFor(() => {
			expect(primed()).toBeNull();
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(editor.clear).not.toHaveBeenCalled();
		expect(editor.appendText).toHaveBeenCalledTimes(1);
		expect(editor.appendText).toHaveBeenCalledWith(
			expect.stringMatching(new RegExp(`^\\n\\n${PRIMED_MESSAGE}`)),
		);
	});

	test('a typed draft survives an auto-submit action', async () => {
		const { editor, onSubmit, primed } = mountWithPrimedAction({
			autoSubmit: true,
			draftSegments: [{ kind: 'text', text: 'half-written' }],
			draftText: 'half-written',
		});

		await waitFor(() => {
			expect(primed()).toBeNull();
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(editor.clear).not.toHaveBeenCalled();
		expect(editor.appendText).toHaveBeenCalledTimes(1);
	});

	test('an empty composer sends an auto-submit action straight away', async () => {
		const { editor, onSubmit, primed } = mountWithPrimedAction({
			autoSubmit: true,
			draftSegments: [],
			draftText: '',
		});

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});
		expect(primed()).toBeNull();
		expect(onSubmit.mock.calls[0]?.[0]).toContain(PRIMED_MESSAGE);
		expect(editor.appendText).not.toHaveBeenCalled();
	});

	test('a seed-only action lands in an empty composer without a separator', async () => {
		const { editor, onSubmit, primed } = mountWithPrimedAction({
			autoSubmit: false,
			draftSegments: [],
			draftText: '',
		});

		await waitFor(() => {
			expect(primed()).toBeNull();
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(editor.appendText).toHaveBeenCalledWith(
			expect.stringMatching(new RegExp(`^${PRIMED_MESSAGE}`)),
		);
	});
});
