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
import { followUpQueueAtomFamily } from '../../src/renderer/state/composer';
import {
	appSettingsAtom,
	type FollowUpBehavior,
} from '../../src/renderer/state/preferences';
import type { QueuedFollowUp } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import { createComposerShellState } from './support/composer';
import { installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-tab-send-now';

/** A queued entry to seed a store with, for a test that mounts onto a queue. */
function queuedEntry(id: string, text: string): QueuedFollowUp {
	return {
		id,
		queuedAt: '2026-09-02T10:00:00.000Z',
		segments: [{ kind: 'text', text }],
		snapshot: null,
		source: 'user',
		text,
	};
}

/**
 * Mounts the send pipeline with a fixed draft in the box.
 *
 * The behavior is written through `appSettingsAtom` rather than
 * `followUpBehaviorAtom`, whose setter persists over a preload bridge that does
 * not exist here.
 */
function mount({
	behavior,
	draft = 'urgent',
	isStreaming,
	seeded = [],
}: {
	behavior: FollowUpBehavior;
	draft?: string;
	isStreaming: boolean;
	seeded?: readonly QueuedFollowUp[];
}) {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		general: { ...DEFAULT_APP_SETTINGS.general, followUpBehavior: behavior },
	});
	store.set(followUpQueueAtomFamily(CHAT_TAB_ID), seeded);

	const onSubmit = vi.fn<
		(
			prompt: string,
			options?: { streamingBehavior?: 'followUp' | 'steer' },
		) => Promise<{ error?: string }>
	>(() => Promise.resolve({}));
	const editor = {
		clear: vi.fn(),
		focus: vi.fn(),
		restore: vi.fn(),
		setText: vi.fn(),
	};
	const editorRef = createRef<ComposerEditorHandle>();
	editorRef.current = editor as unknown as ComposerEditorHandle;

	const view = renderHook(
		() =>
			useComposerSubmit({
				chatTabId: CHAT_TAB_ID,
				composer: {
					...createComposerShellState(),
					disabled: false,
					isStreaming,
					onSubmit,
				},
				editorRef,
				readDraft: () => ({
					segments: draft ? [{ kind: 'text', text: draft }] : [],
					text: draft,
				}),
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
		queued: () => store.get(followUpQueueAtomFamily(CHAT_TAB_ID)),
		sendNow: () => act(async () => view.result.current.sendNow()),
	};
}

beforeEach(() => {
	installLocalStorage();
	readWorkspaceFile.mockReset();
});

describe('sending now instead of queueing', () => {
	test('queue behavior mid-turn goes out as a steer frame rather than onto the queue', async () => {
		const { onSubmit, queued, sendNow } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		await sendNow();

		expect(onSubmit).toHaveBeenCalledWith('urgent', {
			streamingBehavior: 'steer',
		});
		expect(queued()).toEqual([]);
	});

	test('block behavior mid-turn is bypassed the same way', async () => {
		const { onSubmit, queued, sendNow } = mount({
			behavior: 'block',
			isStreaming: true,
		});

		await sendNow();

		expect(onSubmit).toHaveBeenCalledWith('urgent', {
			streamingBehavior: 'steer',
		});
		expect(queued()).toEqual([]);
	});

	// Idle there is no queue to bypass, so the shortcut must not mean something
	// different from the send button — an unsolicited steer frame on a fresh turn.
	test('idle it is an ordinary send, carrying no delivery frame', async () => {
		const { onSubmit, sendNow } = mount({
			behavior: 'queue',
			isStreaming: false,
		});

		await sendNow();

		expect(onSubmit).toHaveBeenCalledWith('urgent', undefined);
	});

	test('an empty box sends nothing', async () => {
		const { onSubmit, sendNow } = mount({
			behavior: 'queue',
			draft: '',
			isStreaming: true,
		});

		await sendNow();

		expect(onSubmit).not.toHaveBeenCalled();
	});

	// Jumping one message past the queue is a decision about that message. Draining
	// the rest behind it would send everything the user had deliberately parked.
	test('messages already parked stay parked', async () => {
		const parked = queuedEntry('queued-1', 'later');
		const { queued, sendNow } = mount({
			behavior: 'queue',
			isStreaming: true,
			seeded: [parked],
		});

		await sendNow();

		expect(queued()).toEqual([parked]);
	});

	test('the box is emptied, so the sent draft is not left looking unsent', async () => {
		const { editor, sendNow } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		await sendNow();

		expect(editor.clear).toHaveBeenCalled();
	});
});
