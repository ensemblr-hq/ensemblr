import type { ConversationScrollOffset } from '@/renderer/types/chat';

/**
 * Distance from the bottom that still counts as following the stream. Mirrors
 * use-stick-to-bottom's own `STICK_TO_BOTTOM_OFFSET_PX` so a viewport the
 * library treats as locked is treated as locked here too.
 */
const NEAR_BOTTOM_THRESHOLD_PX = 70;

/**
 * Sub-pixel slack, so a viewport the browser has clamped to its own end is not
 * read as a pixel short of it.
 */
const AT_END_TOLERANCE_PX = 1;

/** Sub-pixel drift is measurement noise, not a row that moved. */
const ANCHOR_DRIFT_TOLERANCE_PX = 1;

/** The computed `overflow-y` values that make an element a scroll container. */
const SCROLLING_OVERFLOW_Y = ['auto', 'scroll'];

/**
 * The computed `overscroll-behavior-y` values that stop a gesture chaining out
 * of an element once it has nothing left to scroll.
 */
const CONTAINING_OVERSCROLL_Y = ['contain', 'none'];

/**
 * How far a viewport sits above the end of its own content.
 * @param viewport - The scrolling element
 * @returns Pixels between the visible bottom edge and the end of the content.
 */
function distanceFromBottom(viewport: HTMLElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

/**
 * The furthest a scrolling element can currently be scrolled. Content that
 * shrinks mid-stream lowers this, which is what puts a position the user chose
 * temporarily out of reach rather than making it wrong.
 * @param element - The scrolling element
 * @returns The largest offset the browser will accept.
 */
export function maxScrollTop(element: Element): number {
	return Math.max(0, element.scrollHeight - element.clientHeight);
}

/**
 * Whether a viewport parked at some offset would count as following the newest
 * message. The offset need not be the current one, so an offset the content has
 * already shrunk past — which the library reads as being at the end, and re-arms
 * its lock for — is recognised as one of these too.
 * @param viewport - The scrolling element
 * @param scrollTop - The offset to judge
 * @returns True when that offset sits within the near-bottom threshold of the end.
 */
export function wouldFollowNewest(
	viewport: HTMLElement,
	scrollTop: number,
): boolean {
	return followsNewestAt({
		clientHeight: viewport.clientHeight,
		scrollHeight: viewport.scrollHeight,
		scrollTop,
	});
}

/**
 * Whether a viewport of a given height, parked at a given offset over content of
 * a given length, would count as following the newest message. Taking the height
 * as an argument rather than reading it is what lets a resize ask the question
 * of the height the viewport had *before* it — the one measurement a resize
 * destroys, and the only one that says whether the user was at the bottom when
 * the composer grew underneath them.
 * @param metrics - The three measurements that place a viewport over its content
 * @returns True when that arrangement sits within the near-bottom threshold of the end.
 */
export function followsNewestAt({
	clientHeight,
	scrollHeight,
	scrollTop,
}: {
	clientHeight: number;
	scrollHeight: number;
	scrollTop: number;
}): boolean {
	return (
		Math.max(0, scrollHeight - clientHeight) - scrollTop <=
		NEAR_BOTTOM_THRESHOLD_PX
	);
}

/**
 * Whether a viewport sits close enough to its end to count as following the
 * newest message.
 * @param viewport - The scrolling element
 * @returns True while the stream is effectively in view.
 */
function isFollowingNewest(viewport: HTMLElement): boolean {
	return wouldFollowNewest(viewport, viewport.scrollTop);
}

/**
 * Whether an element can still scroll the way a gesture is pushing it.
 * @param element - The scrolling element
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when it has content left to reach in that direction.
 */
function hasRoomToScroll(element: Element, deltaY: number): boolean {
	return deltaY < 0
		? element.scrollTop > 0
		: element.scrollTop < maxScrollTop(element);
}

/**
 * Whether a wheel gesture stops at an element rather than chaining out of it. A
 * pane that can still move the way the gesture is pushing takes it; one already
 * at that limit takes it only when its `overscroll-behavior` blocks the chain,
 * and otherwise the gesture passes through to whatever encloses it.
 * @param element - The element to judge
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when the gesture goes no further out than here.
 */
function consumesWheel(element: Element, deltaY: number): boolean {
	const style = getComputedStyle(element);
	if (
		!SCROLLING_OVERFLOW_Y.includes(style.overflowY) ||
		element.scrollHeight <= element.clientHeight
	) {
		return false;
	}
	return (
		hasRoomToScroll(element, deltaY) ||
		CONTAINING_OVERSCROLL_Y.includes(style.overscrollBehaviorY)
	);
}

/**
 * Whether a wheel gesture belongs to the conversation viewport itself rather
 * than to a pane scrolling inside it — a tool panel, a code surface, a table.
 * A pane that consumes the gesture leaves the transcript still, so treating one
 * as a transcript scroll would drop the stick-to-bottom lock while nothing
 * moved; a pane the gesture chains out of does move the transcript, and the
 * lock has to go with it.
 *
 * The library's own version of this test reads the `overflow` shorthand, which
 * Radix's viewport computes as `hidden scroll`; matching on `overflow-y` is what
 * makes it recognise this viewport at all.
 * @param viewport - The scrolling element the conversation owns
 * @param target - What the wheel event was dispatched on
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when the gesture reaches the viewport rather than stopping inside it.
 */
export function ownsWheelGesture(
	viewport: HTMLElement,
	target: EventTarget | null,
	deltaY: number,
): boolean {
	let element = target instanceof Element ? target : null;
	while (element !== null && element !== viewport) {
		if (consumesWheel(element, deltaY)) {
			return false;
		}
		element = element.parentElement;
	}
	return element === viewport;
}

/**
 * Whether a viewport is parked exactly at the end of its content — as opposed
 * to {@link isFollowingNewest}, which allows the stream a margin. A transcript
 * that still fits its tab is always at its end, having nowhere to scroll.
 * @param viewport - The scrolling element
 * @returns True when there is nothing below the visible area.
 */
function isAtEnd(viewport: HTMLElement): boolean {
	return distanceFromBottom(viewport) <= AT_END_TOLERANCE_PX;
}

/**
 * Pull a row back to the top edge it was measured at before the content around
 * it resized, so a disclosure unfolds under the heading the user clicked.
 *
 * Growth that pushes the end of the transcript out of view releases the
 * stick-to-bottom lock first: left armed, it would read the growth as new
 * output and scroll to the newest message, undoing the correction on the next
 * animation frame.
 * @param input - The scrolling element, the row to hold still, the top edge it sat at before the resize, and the escape hatch out of the stick-to-bottom lock
 */
export function anchorRowTop({
	previousTop,
	releaseFollow,
	row,
	viewport,
}: {
	previousTop: number;
	releaseFollow: () => void;
	row: HTMLElement;
	viewport: HTMLElement;
}): void {
	if (!isAtEnd(viewport)) {
		releaseFollow();
	}
	const drift = row.getBoundingClientRect().top - previousTop;
	if (Math.abs(drift) >= ANCHOR_DRIFT_TOLERANCE_PX) {
		viewport.scrollTop += drift;
	}
}

/**
 * Snapshot a viewport's current position.
 * @param viewport - The scrolling element
 * @returns Its scroll offset, flagged when it is still following the stream.
 */
export function readScrollOffset(
	viewport: HTMLElement,
): ConversationScrollOffset {
	return {
		scrollTop: viewport.scrollTop,
		stuckToBottom: isFollowingNewest(viewport),
	};
}

/**
 * How long after a key press or a wheel notch a viewport move still counts as
 * that gesture's doing.
 */
const USER_INPUT_WINDOW_MS = 300;

/** The `data-slot` Radix's scroll-area root carries for a conversation. */
export const CONVERSATION_SCROLL_AREA_SLOT = 'conversation-scroll-area';

/**
 * The input events that mean the user, rather than a streaming turn, is moving
 * the transcript. `scroll` is deliberately absent: a turn being written fires it
 * about sixty times a second, so counting it as input would make a viewport look
 * busy while nobody is touching it.
 */
const USER_INPUT_EVENTS = [
	'wheel',
	'pointerdown',
	'keydown',
	'touchstart',
] as const;

/** The events that end a drag, wherever the pointer happens to be released. */
const POINTER_RELEASE_EVENTS = [
	'pointerup',
	'pointercancel',
	'touchend',
	'touchcancel',
] as const;

/**
 * The scroll-area root enclosing a conversation viewport — the box that holds
 * the scrollbar as well, so a drag on it counts as a gesture on the transcript.
 * @param viewport - The scrolling element the conversation owns
 * @returns The enclosing scroll area, or the viewport when it is rendered alone.
 */
export function scrollAreaOf(viewport: HTMLElement): HTMLElement {
	const root = viewport.closest(
		`[data-slot="${CONVERSATION_SCROLL_AREA_SLOT}"]`,
	);
	return root instanceof HTMLElement ? root : viewport;
}

/**
 * Call `onInput` for every gesture that means a user is driving the interface,
 * in the capture phase so nothing along the way can hide one, and passively so
 * a wheel listener cannot hold up a scroll.
 * @param target - What to listen on — an element to scope the watch, or `window` to catch input anywhere
 * @param onInput - Called with each gesture
 * @returns The teardown, which removes every listener this added.
 */
export function observeUserInput(
	target: EventTarget,
	onInput: (event: Event) => void,
): () => void {
	for (const type of USER_INPUT_EVENTS) {
		target.addEventListener(type, onInput, { capture: true, passive: true });
	}
	return () => {
		for (const type of USER_INPUT_EVENTS) {
			target.removeEventListener(type, onInput, { capture: true });
		}
	};
}

/**
 * Watch a scroll area for the gestures that move a transcript by hand — a wheel,
 * a scrollbar drag, a key press — so a scroll arriving while one is live can be
 * told apart from one the library or a resize produced.
 *
 * use-stick-to-bottom answers this question in its own `handleScroll`, which
 * gives up whenever `resizeDifference` is set; a turn being written keeps that
 * set continuously, so during a stream it never recognises a keyboard scroll or
 * a scrollbar drag and the user is pulled back to the newest message.
 * @param root - The scroll area to watch, scrollbar included
 * @returns Whether a gesture is currently driving the viewport, and the teardown.
 */
export function observeUserScrollIntent(root: HTMLElement): {
	isActive: () => boolean;
	dispose: () => void;
} {
	let pointerHeld = false;
	let lastInputAt = Number.NEGATIVE_INFINITY;

	/**
	 * Record a gesture, latching the ones that keep driving the viewport for as
	 * long as the pointer stays down.
	 * @param event - The input event that landed in the scroll area
	 */
	const noteInput = (event: Event) => {
		lastInputAt = performance.now();
		if (event.type === 'pointerdown' || event.type === 'touchstart') {
			pointerHeld = true;
		}
	};

	/** Ends a drag once the pointer comes up, inside the scroll area or outside it. */
	const releasePointer = () => {
		pointerHeld = false;
	};

	const stopWatchingInput = observeUserInput(root, noteInput);
	for (const type of POINTER_RELEASE_EVENTS) {
		window.addEventListener(type, releasePointer, true);
	}

	return {
		/**
		 * Whether a gesture is driving the viewport right now.
		 * @returns True while the pointer is down or a key or wheel just fired.
		 */
		isActive: () =>
			pointerHeld || performance.now() - lastInputAt < USER_INPUT_WINDOW_MS,
		/** Detaches every listener this tracker attached. */
		dispose: () => {
			stopWatchingInput();
			for (const type of POINTER_RELEASE_EVENTS) {
				window.removeEventListener(type, releasePointer, true);
			}
		},
	};
}

/**
 * Whether the user is holding a text selection inside a viewport. A selection is
 * a reading position of its own, so scrolling away from one throws away what
 * they were part way through copying.
 * @param viewport - The scrolling element
 * @returns True while a non-empty selection sits inside it.
 */
export function hasSelectionInside(viewport: HTMLElement): boolean {
	const selection = window.getSelection();
	if (
		selection === null ||
		selection.rangeCount === 0 ||
		selection.isCollapsed
	) {
		return false;
	}
	return viewport.contains(selection.getRangeAt(0).commonAncestorContainer);
}
