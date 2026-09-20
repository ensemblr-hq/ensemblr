import { type RefObject, useEffect } from 'react';
import type { ScrollToBottom } from 'use-stick-to-bottom';
import {
	hasSelectionInside,
	observeUserInput,
} from '@/renderer/lib/conversation/viewport';

/**
 * How long a transcript the user scrolled away from sits untouched before it
 * goes back to following the newest message. Long enough that reading a code
 * block or a long tool result does not trip it, short enough that a chat left
 * mid-scroll is showing the end of the conversation by the time anyone looks
 * back at it.
 */
const FOLLOW_REARM_IDLE_MS = 60_000;

/**
 * How often the pause is measured. One handle checking a deadline replaces a
 * chain of timeouts rescheduled on every keystroke: it cannot drift, and the
 * effect's cleanup provably owns the only allocation it made.
 */
const IDLE_POLL_MS = 5_000;

/**
 * Lets a stick-to-bottom escape expire. Scrolling up is a decision about the
 * message in front of the user, not a standing preference — but nothing in
 * use-stick-to-bottom ever takes it back, so a transcript abandoned mid-scroll
 * stays parked there however long the agent goes on writing, and coming back to
 * it shows the middle of a conversation that has since moved on.
 *
 * The pause is measured from real input only — a wheel, a pointer, a key. A
 * `scroll` event is no evidence of a user at all: a turn being written fires
 * roughly sixty a second through the library's own animation, so counting those
 * would keep the transcript looking busy while the room is empty.
 *
 * Input counts wherever in the window it lands, not only inside the transcript.
 * Someone who scrolled up to quote an earlier message and is now typing the
 * reply is the clearest case: the composer is a sibling of the scroll area, so
 * a scoped listener would hear none of it and would pull away the very message
 * they scrolled up for, a minute into writing about it.
 *
 * A live text selection holds the transcript where it is for as long as it
 * lasts. Somebody part way through copying a command has a position that
 * matters more than the newest message, and clicking away to end the selection
 * is itself the input that starts the next pause.
 *
 * Nothing runs while the lock is armed: the effect only subscribes once the
 * user has actually escaped it.
 * @param input - Whether the lock is currently escaped, and the viewport handles from the stick-to-bottom context
 */
export function useConversationIdleFollow({
	escapedFromLock,
	scrollRef,
	scrollToBottom,
}: {
	escapedFromLock: boolean;
	scrollRef: RefObject<HTMLElement | null>;
	scrollToBottom: ScrollToBottom;
}): void {
	useEffect(() => {
		const viewport = scrollRef.current;
		if (!escapedFromLock || !viewport) {
			return;
		}

		let pausedSince = Date.now();
		let followedThisPause = false;

		const startPause = () => {
			pausedSince = Date.now();
			followedThisPause = false;
		};

		const followWhenIdle = () => {
			if (
				followedThisPause ||
				Date.now() - pausedSince < FOLLOW_REARM_IDLE_MS ||
				hasSelectionInside(viewport)
			) {
				return;
			}
			followedThisPause = true;
			scrollToBottom();
		};

		const ticker = setInterval(followWhenIdle, IDLE_POLL_MS);
		const stopWatchingInput = observeUserInput(window, startPause);

		return () => {
			clearInterval(ticker);
			stopWatchingInput();
		};
	}, [escapedFromLock, scrollRef, scrollToBottom]);
}
