// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
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
import {
	MAX_QUEUED_DELIVERY_ATTEMPTS,
	useComposerSubmit,
} from '../../src/renderer/hooks/workbench-shell/composer/use-composer-submit';
import {
	followUpQueueAtomFamily,
	followUpQueueHoldAtomFamily,
} from '../../src/renderer/state/composer';
import {
	appSettingsAtom,
	type FollowUpBehavior,
} from '../../src/renderer/state/preferences';
import type { QueuedFollowUp } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import { createComposerShellState } from './support/composer';
import { installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-tab-flush';
const OTHER_TAB_ID = 'chat-tab-other';

/** What a rerender may vary between renders of the mounted pipeline. */
interface MountProps {
	disabled?: boolean;
	streaming: boolean;
}

/** A queued entry to seed a store with, for a test that mounts onto a queue. */
function queuedEntry(id: string, text: string): QueuedFollowUp {
	return {
		id,
		queuedAt: '2026-08-14T20:00:00.000Z',
		segments: [{ kind: 'text', text }],
		snapshot: null,
		source: 'user',
		text,
	};
}

/**
 * Mounts the send pipeline over a fresh store.
 *
 * The behavior is written through `appSettingsAtom` rather than
 * `followUpBehaviorAtom`: the setting atom's setter persists over the preload
 * bridge, which does not exist here.
 */
function mount({
	behavior,
	chatTabId = CHAT_TAB_ID,
	disabled = false,
	isStreaming,
	store = createStore(),
}: {
	behavior: FollowUpBehavior;
	chatTabId?: string;
	disabled?: boolean;
	isStreaming: boolean;
	/** Pass a seeded store to mount onto a queue that already has entries. */
	store?: ReturnType<typeof createStore>;
}) {
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		general: { ...DEFAULT_APP_SETTINGS.general, followUpBehavior: behavior },
	});
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

	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);

	const onStop = vi.fn(() => Promise.resolve());
	const setAttachmentError = vi.fn<(error: string | null) => void>();
	const initialProps: MountProps = { disabled, streaming: isStreaming };
	const view = renderHook(
		({ disabled: isDisabled, streaming }: MountProps) =>
			useComposerSubmit({
				chatTabId,
				composer: {
					...createComposerShellState(),
					disabled: isDisabled ?? false,
					isStreaming: streaming,
					onStop,
					onSubmit,
				},
				editorRef,
				readDraft: () => ({
					segments: [{ kind: 'text', text: 'draft' }],
					text: 'draft',
				}),
				setAttachmentError,
			}),
		{ initialProps, wrapper },
	);

	const queued = () => store.get(followUpQueueAtomFamily(chatTabId));
	const pauseReason = () =>
		store.get(followUpQueueHoldAtomFamily(chatTabId))?.reason ?? null;
	const send = (text: string) =>
		act(() => {
			view.result.current.dispatchSubmit({
				segments: [{ kind: 'text', text }],
				text,
			});
		});

	return {
		editor,
		editorRef,
		/** Ends the running turn, the way a status event from the runtime does. */
		endTurn: () => act(() => view.rerender({ disabled, streaming: false })),
		onStop,
		onSubmit,
		pauseReason,
		queued,
		send,
		setAttachmentError,
		store,
		/**
		 * Makes a landed send leave the agent busy, which is what the runtime does:
		 * it records the turn before it acknowledges the prompt. Without it the
		 * streaming flag never moves, and "one message per turn" would be an
		 * artifact of the harness rather than something the flush enforces.
		 */
		takeTurnsOnSend: () =>
			onSubmit.mockImplementation(() => {
				act(() => view.rerender({ disabled, streaming: true }));
				return Promise.resolve({});
			}),
		view,
	};
}

/** The prompt each `onSubmit` call carried, in call order. */
const prompts = (onSubmit: ReturnType<typeof vi.fn>) =>
	onSubmit.mock.calls.map((call) => call[0]);

beforeEach(() => {
	installLocalStorage();
	readWorkspaceFile.mockReset();
});

describe('mid-turn routing', () => {
	test('steer goes straight to the runtime as a steer frame', async () => {
		const { onSubmit, queued, send } = mount({
			behavior: 'steer',
			isStreaming: true,
		});

		send('interrupt');

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit.mock.calls[0]?.[1]).toEqual({ streamingBehavior: 'steer' });
		expect(queued()).toHaveLength(0);
	});

	test('queue holds the message in the renderer instead of sending it', () => {
		const { onSubmit, queued, send } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		send('later');

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued().map((entry) => entry.text)).toEqual(['later']);
		expect(queued()[0]?.source).toBe('user');
	});

	test('block queues too, and differs only in not draining on its own', () => {
		const { onSubmit, queued, send } = mount({
			behavior: 'block',
			isStreaming: true,
		});

		send('held');

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued().map((entry) => entry.text)).toEqual(['held']);
	});

	test('an idle send goes out plainly under every behavior', async () => {
		for (const behavior of ['steer', 'queue', 'block'] as const) {
			const { onSubmit, queued, send } = mount({
				behavior,
				isStreaming: false,
			});

			send('now');

			await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
			expect(onSubmit.mock.calls[0]?.[1]).toBeUndefined();
			expect(queued()).toHaveLength(0);
		}
	});
});

describe('flushing when the turn ends', () => {
	test('the queue drains from the head once the agent stops', async () => {
		const { endTurn, onSubmit, queued, send, takeTurnsOnSend } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		takeTurnsOnSend();

		send('first');
		send('second');
		expect(queued()).toHaveLength(2);

		endTurn();

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(prompts(onSubmit)).toEqual(['first']);
		expect(queued().map((entry) => entry.text)).toEqual(['second']);
	});

	test('one entry goes per turn end, not the whole queue at once', async () => {
		// Sending the head leaves the agent busy again, so the rest wait for that
		// turn in its own right. That is what keeps each queued message its own turn.
		const { endTurn, onSubmit, queued, send, takeTurnsOnSend } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		takeTurnsOnSend();

		send('first');
		send('second');

		endTurn();
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

		endTurn();

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
		expect(prompts(onSubmit)).toEqual(['first', 'second']);
		expect(queued()).toHaveLength(0);
	});

	test('a composer that mounts onto an idle agent drains what is waiting', async () => {
		// The composer is not permanently mounted: `ComposerSlot` swaps it out for
		// the ask_user_question and tool-approval cards, and switching chat tabs
		// unmounts it. A turn that ends while it is away offers no transition to
		// witness, so a flush that waited for one would strand the queue for good —
		// the turn it is waiting on is the one it was supposed to start.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			{
				id: 'queued-while-away',
				queuedAt: '2026-08-14T20:00:00.000Z',
				segments: [{ kind: 'text', text: 'sent while I was gone' }],
				snapshot: null,
				source: 'user',
				text: 'sent while I was gone',
			},
		]);
		const { onSubmit, queued } = mount({
			behavior: 'queue',
			isStreaming: false,
			store,
		});

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(prompts(onSubmit)).toEqual(['sent while I was gone']);
		expect(queued()).toHaveLength(0);
	});

	test('a queue paused before the composer went away stays paused', async () => {
		// The composer is swapped out and back for approval cards, so mounting onto
		// a queue the user stopped must not be read as an agent that just went idle
		// with work waiting.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			{
				id: 'parked',
				queuedAt: '2026-08-14T20:00:00.000Z',
				segments: [{ kind: 'text', text: 'parked' }],
				snapshot: null,
				source: 'user',
				text: 'parked',
			},
		]);
		store.set(followUpQueueHoldAtomFamily(CHAT_TAB_ID), {
			entryIds: ['parked'],
			reason: 'turn-stopped',
		});
		const { onSubmit, queued } = mount({
			behavior: 'queue',
			isStreaming: false,
			store,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued()).toHaveLength(1);
	});

	test('an idle rerender does not send a second entry while the first is in flight', async () => {
		// The head is taken before its send resolves, so nothing about the queue
		// stops the next one going out; the in-flight latch is the only thing that
		// does, and idle rerenders are exactly when it is asked to hold.
		const { onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		onSubmit.mockImplementation(() => new Promise(() => undefined));

		send('first');
		send('second');
		act(() => view.rerender({ streaming: false }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

		act(() => view.rerender({ streaming: false }));
		act(() => view.rerender({ streaming: false }));

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(queued().map((entry) => entry.text)).toEqual(['second']);
	});

	test('a block-mode queue sits still when the turn ends', async () => {
		const { onSubmit, queued, send, view } = mount({
			behavior: 'block',
			isStreaming: true,
		});

		send('held');
		act(() => view.rerender({ streaming: false }));

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued()).toHaveLength(1);
	});

	test('a stop pauses the queue rather than draining into the gap', async () => {
		const { onSubmit, pauseReason, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		send('waiting');
		await act(async () => {
			await view.result.current.handleStop();
		});
		act(() => view.rerender({ streaming: false }));

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued()).toHaveLength(1);
		expect(pauseReason()).toBe('turn-stopped');
	});

	test('a message queued after a stop goes without the queue being resumed', async () => {
		// The streaming flag reads a session status that settles a round-trip after
		// the stop, so a message typed straight afterwards is queued rather than
		// sent. Pausing the whole queue stranded it behind an interruption it was
		// written in answer to, and every later queue needed Resume pressed by hand.
		const { onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		await act(async () => {
			await view.result.current.handleStop();
		});
		send('and now do this instead');
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(prompts(onSubmit)).toEqual(['and now do this instead']);
		expect(queued()).toHaveLength(0);
		expect(view.result.current.queueStalled).toBe(false);
	});

	test('the messages a stop parked stay parked while a newer one waits behind them', async () => {
		const { onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		send('parked');
		await act(async () => {
			await view.result.current.handleStop();
		});
		send('newer');
		act(() => view.rerender({ streaming: false }));

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued().map((entry) => entry.text)).toEqual(['parked', 'newer']);
		expect(view.result.current.queueStalled).toBe(true);
	});

	test('clearing the messages a stop parked lets the queue move again', async () => {
		// Stop, discard the stale messages, type a fresh one: the pause has nothing
		// left to protect, so nothing should be asking the user to resume it.
		const { onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		send('parked');
		await act(async () => {
			await view.result.current.handleStop();
		});
		act(() => view.result.current.queue.clear());
		send('fresh');
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(prompts(onSubmit)).toEqual(['fresh']);
		expect(queued()).toHaveLength(0);
	});

	test('sending the message ahead of a parked one leaves the stop in force', async () => {
		// The strip has one button and it says two things: Resume when the head is
		// paused, Send next when the behavior is merely holding it back. With a
		// newer message dragged above a parked one it reads Send next, so releasing
		// the whole pause on that press would throw away the stop the user cannot
		// see from there — and the parked message would come back as an ordinary
		// held-back one, sent by the next routine press.
		const { onSubmit, pauseReason, queued, send, view } = mount({
			behavior: 'block',
			isStreaming: true,
		});

		send('parked');
		await act(async () => {
			await view.result.current.handleStop();
		});
		send('newer');
		const [parked, newer] = queued();
		act(() => view.result.current.queue.reorder([newer.id, parked.id]));
		act(() => view.rerender({ streaming: false }));

		expect(view.result.current.queue.holdReason).toBeNull();

		act(() => view.result.current.flushQueueNow());

		await waitFor(() => expect(prompts(onSubmit)).toEqual(['newer']));
		expect(queued().map((entry) => entry.text)).toEqual(['parked']);
		expect(pauseReason()).toBe('turn-stopped');
		expect(view.result.current.queue.holdReason).toBe('turn-stopped');
	});

	test('a failed send puts the entry back at the head and pauses', async () => {
		const { onSubmit, pauseReason, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		onSubmit.mockImplementation(() =>
			Promise.resolve({ error: 'session closed' }),
		);

		send('first');
		send('second');
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(queued().map((entry) => entry.text)).toEqual(['first', 'second']),
		);

		act(() => view.rerender({ streaming: true }));
		act(() => view.rerender({ streaming: false }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(pauseReason()).toBe('send-failed');
	});

	test('a failed send puts the entry back in one place, not two', async () => {
		// The queue recovers the entry itself, so restoring it into the editor as
		// well would leave the same message queued and drafted at once — send it and
		// the agent gets it twice.
		const { editor, onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		onSubmit.mockImplementation(() =>
			Promise.resolve({ error: 'session closed' }),
		);

		send('only');
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(queued()).toHaveLength(1));
		expect(editor.setText).not.toHaveBeenCalled();
		expect(editor.restore).not.toHaveBeenCalled();
	});

	test('a flush leaves the draft the user is typing alone', async () => {
		// The flush fires on the agent's schedule, not the user's, so the draft in
		// the box is very likely mid-sentence when a turn ends.
		const { editor, onSubmit, send, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		send('queued one');
		const clearsAfterQueueing = editor.clear.mock.calls.length;
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(editor.clear.mock.calls).toHaveLength(clearsAfterQueueing);
	});

	test('a turn that ends while the composer is busy still flushes', async () => {
		// The falling edge is the only trigger there is, so spending it on a guard
		// that will lift in a moment strands the queue until some later turn ends.
		const { onSubmit, queued, send, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: true,
		});

		send('waiting');
		act(() => view.rerender({ disabled: true, streaming: false }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onSubmit).not.toHaveBeenCalled();

		act(() => view.rerender({ disabled: false, streaming: false }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(queued()).toHaveLength(0);
	});

	test("one tab's composer never flushes another tab's queue", async () => {
		const { onSubmit, store, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});
		store.set(followUpQueueAtomFamily(OTHER_TAB_ID), [
			{
				id: 'other-1',
				queuedAt: '2026-08-11T20:00:00.000Z',
				segments: [{ kind: 'text', text: 'not mine' }],
				snapshot: null,
				source: 'user',
				text: 'not mine',
			},
		]);

		act(() => view.rerender({ streaming: false }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(store.get(followUpQueueAtomFamily(OTHER_TAB_ID))).toHaveLength(1);
	});
});

describe('a send the composer will not take right now', () => {
	test('goes back on the queue and lands once the composer frees up', async () => {
		// The flush fires when a turn ends, which is exactly when the composer may
		// still be settling the previous send. Reading that refusal as a failure is
		// what stopped queues for a reason the user could neither see nor reproduce,
		// so it retries instead — and nothing about the queue says paused meanwhile.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			queuedEntry('racing', 'racing the turn'),
		]);
		const { onSubmit, pauseReason, queued, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: false,
			store,
		});

		await act(async () => {
			view.result.current.flushQueueNow();
		});

		expect(onSubmit).not.toHaveBeenCalled();
		expect(queued().map((entry) => entry.text)).toEqual(['racing the turn']);
		expect(pauseReason()).toBeNull();

		act(() => view.rerender({ disabled: false, streaming: false }));

		await waitFor(() => expect(prompts(onSubmit)).toEqual(['racing the turn']));
		expect(queued()).toHaveLength(0);
		expect(pauseReason()).toBeNull();
	});

	test('puts a steered row back where it was steered from, still unpaused', async () => {
		// A steer lifts a row out of the middle, so a refusal that dropped it at the
		// front would reorder a queue the user arranged by hand.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			queuedEntry('a', 'first'),
			queuedEntry('b', 'second'),
			queuedEntry('c', 'third'),
		]);
		const { pauseReason, queued, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: true,
			store,
		});

		await act(async () => {
			view.result.current.steerQueued('c');
		});

		expect(queued().map((entry) => entry.text)).toEqual([
			'first',
			'second',
			'third',
		]);
		expect(pauseReason()).toBeNull();
	});

	test('pauses once the refusals run out, rather than retrying forever', async () => {
		// A composer that never frees up is a failure in slow motion: bounded
		// attempts are what stop the queue spinning instead of saying so.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			queuedEntry('stuck', 'stuck'),
		]);
		const { onSubmit, pauseReason, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: false,
			store,
		});

		for (
			let attempt = 0;
			attempt < MAX_QUEUED_DELIVERY_ATTEMPTS - 1;
			attempt++
		) {
			await act(async () => {
				view.result.current.flushQueueNow();
			});
		}
		expect(pauseReason()).toBeNull();

		await act(async () => {
			view.result.current.flushQueueNow();
		});

		expect(onSubmit).not.toHaveBeenCalled();
		expect(pauseReason()).toBe('send-failed');
	});

	test('says why it paused, since a refusal surfaces nothing on its own', async () => {
		// The strip reads "the last message could not be sent", and only a real
		// failure leaves an error behind it. Without one here that line is the sole
		// account of a stopped queue for a send that was never even attempted.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			queuedEntry('stuck', 'stuck'),
		]);
		const { setAttachmentError, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: false,
			store,
		});

		for (let attempt = 0; attempt < MAX_QUEUED_DELIVERY_ATTEMPTS; attempt++) {
			await act(async () => {
				view.result.current.flushQueueNow();
			});
		}

		expect(setAttachmentError).toHaveBeenCalledWith(
			'The composer never became ready for the queued message, so the queue is paused.',
		);
	});

	test('counts refusals per entry, so steering another row does not reset the head', async () => {
		// One shared slot would zero the head's run every time a different entry was
		// turned away, putting the bound permanently out of reach for a queue the
		// user keeps poking at.
		const store = createStore();
		store.set(followUpQueueAtomFamily(CHAT_TAB_ID), [
			queuedEntry('head', 'head'),
			queuedEntry('other', 'other'),
		]);
		const { pauseReason, view } = mount({
			behavior: 'queue',
			disabled: true,
			isStreaming: false,
			store,
		});

		for (
			let attempt = 0;
			attempt < MAX_QUEUED_DELIVERY_ATTEMPTS - 1;
			attempt++
		) {
			await act(async () => {
				view.result.current.flushQueueNow();
			});
			await act(async () => {
				view.result.current.steerQueued('other');
			});
		}
		expect(pauseReason()).toBeNull();

		await act(async () => {
			view.result.current.flushQueueNow();
		});

		expect(pauseReason()).toBe('send-failed');
	});
});

describe('a queue that is waiting on the user', () => {
	test('a block-mode queue reads as stalled once the agent frees up', async () => {
		// It will never drain on its own, so the panel has to offer a way to send it
		// rather than showing a queue with no exit.
		const { send, view } = mount({ behavior: 'block', isStreaming: true });

		send('held');
		expect(view.result.current.queueStalled).toBe(false);

		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(view.result.current.queueStalled).toBe(true));
	});

	test('a queue-mode queue is not stalled — it drains by itself', () => {
		const { send, view } = mount({ behavior: 'queue', isStreaming: true });

		send('later');

		expect(view.result.current.queueStalled).toBe(false);
	});

	test('a chore is never stalled, because block does not hold chores', async () => {
		const { view } = mount({ behavior: 'block', isStreaming: true });

		act(() => {
			view.result.current.queue.enqueue({
				segments: [{ kind: 'text', text: 'commit and push' }],
				snapshot: null,
				source: 'chore',
				text: 'commit and push',
			});
		});
		act(() => view.rerender({ streaming: false }));

		await waitFor(() => expect(view.result.current.queueStalled).toBe(false));
	});

	test('sending now drains the head of a block-mode queue', async () => {
		const { onSubmit, queued, send, view } = mount({
			behavior: 'block',
			isStreaming: true,
		});

		send('first');
		send('second');
		act(() => view.rerender({ streaming: false }));
		await waitFor(() => expect(view.result.current.queueStalled).toBe(true));

		act(() => view.result.current.flushQueueNow());

		await waitFor(() => expect(prompts(onSubmit)).toEqual(['first']));
		expect(queued().map((entry) => entry.text)).toEqual(['second']);
	});

	test('a stop holds the queue, and sending now releases it', async () => {
		const { onStop, onSubmit, view } = mount({
			behavior: 'queue',
			isStreaming: true,
		});

		act(() => {
			view.result.current.dispatchSubmit({
				segments: [{ kind: 'text', text: 'waiting' }],
				text: 'waiting',
			});
		});
		await act(async () => {
			await view.result.current.handleStop();
		});
		expect(onStop).toHaveBeenCalledTimes(1);
		act(() => view.rerender({ streaming: false }));
		await waitFor(() => expect(view.result.current.queueStalled).toBe(true));
		expect(onSubmit).not.toHaveBeenCalled();

		act(() => view.result.current.flushQueueNow());

		await waitFor(() => expect(prompts(onSubmit)).toEqual(['waiting']));
	});
});

describe('the draft a failed send was carrying', () => {
	test('is put back in the composer rather than lost', async () => {
		// onSubmit reports failure by returning an error, never by rejecting, so a
		// pipeline that only restored in a catch would drop the message silently.
		const { editorRef, onSubmit, send } = mount({
			behavior: 'steer',
			isStreaming: false,
		});
		onSubmit.mockImplementation(() =>
			Promise.resolve({ error: 'session closed' }),
		);

		send('precious');

		await waitFor(() =>
			expect(editorRef.current?.setText).toHaveBeenCalledWith('precious'),
		);
	});
});
