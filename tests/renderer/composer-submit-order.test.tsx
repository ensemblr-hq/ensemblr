// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createRef, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReadWorkspaceFileResult } from '../../src/shared/ipc/contracts/workspace-files';

const readWorkspaceFile =
	vi.fn<(request: { path: string }) => Promise<ReadWorkspaceFileResult>>();

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: (request: { path: string }) => readWorkspaceFile(request),
}));

import type { ComposerEditorHandle } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerSubmit } from '../../src/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { chatLinkedDirectoriesAtomFamily } from '../../src/renderer/state/preferences';
import type {
	ComposerAttachment,
	ComposerDraftSegment,
} from '../../src/renderer/types/workbench';
import { createComposerShellState } from './support/composer';
import { installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-tab-order';

const NOTES: ComposerAttachment = {
	id: 'wsfile:notes.md',
	kind: 'workspace-file',
	label: 'notes.md',
	path: 'notes.md',
};

const PLAN: ComposerAttachment = {
	id: 'wsfile:plan.md',
	kind: 'workspace-file',
	label: 'plan.md',
	path: 'plan.md',
};

/** Drives the real send pipeline over a draft, returning the prompt it built. */
async function submit(
	segments: readonly ComposerDraftSegment[],
	linked: readonly { name: string; path: string }[] = [],
): Promise<string> {
	const store = createStore();
	store.set(chatLinkedDirectoriesAtomFamily(CHAT_TAB_ID), linked);
	const onSubmit = vi.fn();
	const editorRef = createRef<ComposerEditorHandle>();
	editorRef.current = { clear: vi.fn() } as unknown as ComposerEditorHandle;
	const text = segments
		.map((segment) => (segment.kind === 'text' ? segment.text : ''))
		.join('');

	const { result } = renderHook(
		() =>
			useComposerSubmit({
				chatTabId: CHAT_TAB_ID,
				composer: {
					...createComposerShellState(),
					disabled: false,
					onSubmit,
					workspaceCwd: '/repo',
				},
				editorRef,
				readDraft: () => ({ segments, text }),
				setAttachmentError: vi.fn(),
			}),
		{
			wrapper: ({ children }: PropsWithChildren) => (
				<Provider store={store}>{children}</Provider>
			),
		},
	);

	await act(async () => {
		await result.current.handleSubmit();
	});

	expect(onSubmit).toHaveBeenCalledTimes(1);
	return onSubmit.mock.calls[0]?.[0] as string;
}

beforeEach(() => {
	installLocalStorage();
	readWorkspaceFile.mockReset();
	readWorkspaceFile.mockImplementation(async ({ path }) => ({
		content: `body of ${path}`,
		path,
		sizeBytes: 1,
	}));
});

describe('composer send order', () => {
	test('sends each attachment where its chip sat, not bunched at one end', async () => {
		const prompt = await submit([
			{ kind: 'text', text: 'start from ' },
			{ attachment: PLAN, kind: 'attachment' },
			{ kind: 'text', text: ' and cross-check ' },
			{ attachment: NOTES, kind: 'attachment' },
			{ kind: 'text', text: ' before you edit anything' },
		]);

		expect(prompt).toBe(
			[
				'start from',
				'<attached_file path="plan.md">\nbody of plan.md\n</attached_file>',
				'and cross-check',
				'<attached_file path="notes.md">\nbody of notes.md\n</attached_file>',
				'before you edit anything',
			].join('\n\n'),
		);
	});

	test('keeps the linked-directories grant as the preamble it is', async () => {
		const prompt = await submit(
			[
				{ kind: 'text', text: 'read ' },
				{ attachment: NOTES, kind: 'attachment' },
			],
			[{ name: 'Vault', path: '/Users/me/Vault' }],
		);

		expect(prompt).toBe(
			[
				'Linked directories:\n/Users/me/Vault',
				'read',
				'<attached_file path="notes.md">\nbody of notes.md\n</attached_file>',
			].join('\n\n'),
		);
	});

	test('sends a chip the user put before the sentence ahead of the text', async () => {
		const prompt = await submit([
			{ attachment: NOTES, kind: 'attachment' },
			{ kind: 'text', text: ' summarise this' },
		]);

		expect(prompt).toBe(
			[
				'<attached_file path="notes.md">\nbody of notes.md\n</attached_file>',
				'summarise this',
			].join('\n\n'),
		);
	});
});
