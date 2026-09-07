// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerAutocomplete } from '@/renderer/hooks/workbench-shell/composer/use-composer-autocomplete';
import type {
	ComposerAttachment,
	ComposerShellState,
} from '@/renderer/types/workbench';
import type { ConciergeReference } from '@/shared/concierge-references';

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	getPathForFile: vi.fn(),
	readWorkspaceFile: vi.fn(),
	writeWorkspaceFileAttachment: vi.fn(),
	writeWorkspaceImageAttachment: vi.fn(),
}));

vi.mock('@/renderer/hooks/workbench-shell/composer/use-slash-commands', () => ({
	useSlashCommands: () => ({ commands: [], loading: false }),
}));

/** A chat in this workspace, carrying only what the ranking reads off it. */
function chat(label: string, id: string): ConciergeReference {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		kind: 'chat',
		label,
		role: 'orchestrator',
		state: 'open',
		workspace: 'khachaturian',
		workspaceId: 'ws-1',
	};
}

/**
 * The `@` menu offers `Alpha chat`, `Beta chat`, `alpha.ts`, `beta.ts` over one
 * index space, so rows 0-1 are chats and rows 2-3 are files.
 */
const COMPOSER = {
	availableModels: [],
	chatReferences: [
		chat('Alpha chat', 'tab-alpha'),
		chat('Beta chat', 'tab-beta'),
	],
	lockedProvider: 'pi',
	workspaceCwd: '/workspaces/ensemblr/khachaturian',
	workspaceFiles: [
		{ id: 'wsfile:alpha.ts', kind: 'file', name: 'alpha.ts', path: 'alpha.ts' },
		{ id: 'wsfile:beta.ts', kind: 'file', name: 'beta.ts', path: 'beta.ts' },
	],
} as unknown as ComposerShellState;

const VALUE = 'see @a';

/** Mounts the hook with the `@a` token under the caret and a stubbed editor. */
function mountAutocomplete() {
	const replaceRangeWithAttachment = vi.fn();
	const editorRef = {
		current: {
			replaceRangeWithAttachment,
			replaceRangeWithText: vi.fn(),
		} as unknown as ComposerEditorHandle,
	};
	const hook = renderHook(() =>
		useComposerAutocomplete({
			composer: COMPOSER,
			editorRef,
			onSubmitSlashCommand: vi.fn(),
			setAttachmentError: vi.fn(),
			value: VALUE,
		}),
	);
	act(() => {
		hook.result.current.updateAutocomplete(VALUE, VALUE.length);
	});
	return { hook, replaceRangeWithAttachment };
}

/** The attachment the last confirmed pick handed the editor. */
function insertedAttachment(
	replaceRangeWithAttachment: ReturnType<typeof vi.fn>,
): ComposerAttachment {
	return replaceRangeWithAttachment.mock.calls.at(-1)?.[2];
}

describe('the @ menu confirming a pick across its chat and file halves', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('counts the chats and the files as one list', () => {
		const { hook } = mountAutocomplete();

		expect(hook.result.current.chatMatches).toHaveLength(2);
		expect(hook.result.current.mentionMatches).toHaveLength(2);
		expect(hook.result.current.autocompleteTotal).toBe(4);
	});

	it.each([
		[0, 'chat-ref', 'Alpha chat'],
		[1, 'chat-ref', 'Beta chat'],
		[2, 'workspace-file', 'alpha.ts'],
		[3, 'workspace-file', 'beta.ts'],
	])('picks row %i as the %s named %s', (index, kind, label) => {
		const { hook, replaceRangeWithAttachment } = mountAutocomplete();

		act(() => {
			hook.result.current.setActiveIndex(index);
		});
		act(() => {
			hook.result.current.confirmAutocomplete();
		});

		expect(insertedAttachment(replaceRangeWithAttachment)).toMatchObject({
			kind,
			label,
		});
	});

	it('steps off the last chat onto the first file rather than past it', () => {
		const { hook, replaceRangeWithAttachment } = mountAutocomplete();

		act(() => {
			hook.result.current.stepActive(1);
		});
		act(() => {
			hook.result.current.stepActive(1);
		});
		expect(hook.result.current.activeIndex).toBe(2);

		act(() => {
			hook.result.current.confirmAutocomplete();
		});

		expect(insertedAttachment(replaceRangeWithAttachment)).toMatchObject({
			kind: 'workspace-file',
			label: 'alpha.ts',
		});
	});

	it('steps back off the first file onto the last chat', () => {
		const { hook, replaceRangeWithAttachment } = mountAutocomplete();

		act(() => {
			hook.result.current.setActiveIndex(2);
		});
		act(() => {
			hook.result.current.stepActive(-1);
		});
		expect(hook.result.current.activeIndex).toBe(1);

		act(() => {
			hook.result.current.confirmAutocomplete();
		});

		expect(insertedAttachment(replaceRangeWithAttachment)).toMatchObject({
			kind: 'chat-ref',
			label: 'Beta chat',
		});
	});

	it('wraps past the last file back onto the first chat', () => {
		const { hook } = mountAutocomplete();

		act(() => {
			hook.result.current.setActiveIndex(3);
		});
		act(() => {
			hook.result.current.stepActive(1);
		});

		expect(hook.result.current.activeIndex).toBe(0);
	});
});
