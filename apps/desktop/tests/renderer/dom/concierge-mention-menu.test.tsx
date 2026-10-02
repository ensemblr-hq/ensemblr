// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AttachmentMenu } from '@/renderer/components/workbench-shell/conversation-panel/composer/attachment-menu';
import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { WorkbenchLayoutModelProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import { useConciergeComposerDraft } from '@/renderer/hooks/concierge/use-concierge-composer-draft';
import type { WorkbenchLayoutModel } from '@/renderer/types/workbench-shell/layout';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const PROJECTS = [
	{
		id: 'repo-1',
		name: 'ensemblr',
		owner: { name: 'me' },
		pathLabel: '/repos/ensemblr',
		workspaces: [
			{
				id: 'ws-1',
				name: 'khachaturian',
				pathLabel: '/workspaces/ensemblr/khachaturian',
			},
		],
	},
];

/** Mounts the draft hook with the shell context and IPC surface it reads. */
function renderDraft() {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={createTestQueryClient()}>
			<WorkbenchLayoutModelProvider
				value={
					{
						displayProjects: PROJECTS,
						navigateToWorkspace: vi.fn(),
					} as unknown as WorkbenchLayoutModel
				}
			>
				{children}
			</WorkbenchLayoutModelProvider>
		</QueryClientProvider>
	);

	const rendered = renderHook(
		() =>
			useConciergeComposerDraft({
				cwd: '/concierge',
				onSubmitSlashCommand: vi.fn(),
				provider: 'pi',
			}),
		{ wrapper },
	);

	const editor = {
		clear: vi.fn(),
		focus: vi.fn(),
		insertAttachment: vi.fn(),
		insertText: vi.fn(),
		replaceRangeWithAttachment: vi.fn(),
		setText: vi.fn(),
	} as unknown as ComposerEditorHandle;
	rendered.result.current.editorRef.current = editor;
	return { editor, ...rendered };
}

/** Publishes a draft the way the Lexical editor does, caret at the end. */
function type(
	draft: ReturnType<typeof renderDraft>['result']['current'],
	text: string,
): void {
	act(() =>
		draft.handleDraftChange({
			caret: text.length,
			segments: [{ kind: 'text', text }],
			text,
		}),
	);
}

/** Sends one key through the editor's own handler. */
function press(
	draft: ReturnType<typeof renderDraft>['result']['current'],
	key: string,
): void {
	act(() =>
		draft.handleKeyDown({
			key,
			preventDefault: () => undefined,
		} as never),
	);
}

describe("the Concierge composer's @ menu", () => {
	beforeEach(() => {
		installEnsemblrApi({
			listAllChatTabs: vi.fn(() =>
				Promise.resolve({
					closed: [],
					open: [
						{
							agentSessionId: 'sess-1',
							closedAt: null,
							fullTitle: 'chip work',
							id: 'tab-1',
							isPreview: false,
							kind: 'chat',
							metadata: {},
							openedAt: '2026-08-24T00:00:00.000Z',
							position: 0,
							title: 'chip work',
							workspaceId: 'ws-1',
						},
					],
				}),
			),
		});
	});

	afterEach(() => clearEnsemblrApi());

	test('stays shut until an @ token is under the caret', () => {
		const { result } = renderDraft();
		type(result.current, 'what changed today');
		expect(result.current.autocompleteKind).toBeNull();
		expect(result.current.referenceMatches).toHaveLength(0);
	});

	test('ranks workspaces and chats against the typed token', async () => {
		const { result } = renderDraft();
		type(result.current, 'look at @kha');

		await waitFor(() => {
			expect(result.current.autocompleteKind).toBe('entity');
			expect(
				result.current.referenceMatches.map((m) => m.reference.label),
			).toEqual(['khachaturian']);
		});

		type(result.current, 'look at @chip');
		await waitFor(() => {
			expect(
				result.current.referenceMatches.map((m) => m.reference.label),
			).toEqual(['chip work']);
		});
	});

	test('a pick replaces the token with a chip carrying the ids', async () => {
		const { editor, result } = renderDraft();
		type(result.current, 'look at @kha');

		await waitFor(() =>
			expect(result.current.referenceMatches).not.toHaveLength(0),
		);
		const match = result.current.referenceMatches[0];
		if (!match) {
			throw new Error('expected a match');
		}
		act(() => result.current.selectReference(match.reference));

		// The space before `@` goes with the token: a chip already reads as one
		// space, so keeping it would leave a double space behind every pick.
		expect(editor.replaceRangeWithAttachment).toHaveBeenCalledWith(
			7,
			12,
			expect.objectContaining({
				id: 'workspace-ref:ws-1',
				kind: 'workspace-ref',
				label: 'khachaturian',
			}),
		);
	});

	test('closing the token closes the menu', async () => {
		const { result } = renderDraft();
		type(result.current, 'look at @kha');
		await waitFor(() => expect(result.current.autocompleteKind).toBe('entity'));

		type(result.current, 'look at @kha and then some');
		expect(result.current.autocompleteKind).toBeNull();
	});

	// The menu still covers the composer when it matched nothing, and editing the
	// token back out is not a dismissal the user should have to work out.
	test('Escape closes a menu that matched nothing', async () => {
		const { result } = renderDraft();
		type(result.current, 'look at @zzzz');
		await waitFor(() => expect(result.current.autocompleteKind).toBe('entity'));
		expect(result.current.referenceMatches).toHaveLength(0);

		press(result.current, 'Escape');
		expect(result.current.autocompleteKind).toBeNull();
	});

	// The list narrows under a stored index without the draft being touched, and
	// an index past the end would make Enter a silent no-op.
	test('holds the highlight inside the list it is offering', async () => {
		const { editor, result } = renderDraft();
		type(result.current, 'look at @');
		await waitFor(() =>
			expect(result.current.referenceMatches.length).toBeGreaterThan(1),
		);
		act(() => result.current.setActiveIndex(99));
		const last = result.current.referenceMatches.length - 1;
		const lastLabel = result.current.referenceMatches[last]?.reference.label;
		expect(result.current.activeIndex).toBe(last);

		press(result.current, 'Enter');
		expect(editor.replaceRangeWithAttachment).toHaveBeenCalledWith(
			expect.any(Number),
			expect.any(Number),
			expect.objectContaining({ label: lastLabel }),
		);
	});
});

describe('the + menu route into the @ menu', () => {
	beforeEach(() => installEnsemblrApi({}));
	afterEach(() => clearEnsemblrApi());

	test('writes the token straight into an empty draft', () => {
		const { editor, result } = renderDraft();
		act(() => result.current.startReference());

		expect(editor.insertText).toHaveBeenCalledWith('@');
		expect(editor.focus).toHaveBeenCalled();
	});

	test('spaces the token off a word, which is what makes it a token at all', () => {
		const { editor, result } = renderDraft();
		type(result.current, 'look at');
		act(() => result.current.startReference());

		expect(editor.insertText).toHaveBeenCalledWith(' @');
	});

	test('adds no second space after one the user already typed', () => {
		const { editor, result } = renderDraft();
		type(result.current, 'look at ');
		act(() => result.current.startReference());

		expect(editor.insertText).toHaveBeenCalledWith('@');
	});
	// Radix returns focus to the trigger from `onCloseAutoFocus`, which runs after
	// the item's `onSelect` — so without the menu standing that down, the token
	// lands in the draft with the keyboard still on the plus button and the menu
	// it just opened takes no keys at all.
	test('leaves the caret where the pick put it, not on the plus button', async () => {
		const user = userEvent.setup();
		const composer = document.createElement('input');
		document.body.append(composer);

		renderWithProviders(
			<AttachmentMenu
				onAddAttachment={() => undefined}
				onLinkDirectory={() => undefined}
				onReference={() => composer.focus()}
			/>,
		);

		await user.click(screen.getByRole('button'));
		await user.click(await screen.findByText('Mention…'));

		await waitFor(() => expect(document.activeElement).toBe(composer));
		composer.remove();
	});
});
