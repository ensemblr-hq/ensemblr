import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { useConversationViewport } from '@/renderer/components/conversation/viewport-context';

/**
 * Keeps a timeline row still while opening or closing it resizes the
 * conversation around it.
 *
 * Expanding a row grows the transcript, which the stick-to-bottom lock reads as
 * new output and answers by scrolling to the newest message — so the row the
 * user just opened slides off the top of the screen, and a transcript that used
 * to fit its tab starts scrolling for the first time. Capturing an anchor
 * releases that lock for the resize that follows and pins the row's top edge
 * where it was, so the body unfolds under the heading the user clicked.
 * Scrolling back down re-arms the follow, as does closing a row that leaves the
 * viewport back at the end of the transcript.
 *
 * `captureAnchor` belongs in the click handler, next to the state change it
 * accompanies: a row that changes state on its own — the global expand-all, a
 * turn that settles mid-stream — has no clicked heading to hold still, and is
 * left to the conversation's own scroll behaviour. Capturing schedules the
 * commit that consumes it rather than waiting on the row's own state, so an
 * anchor cannot survive a toggle the row refused and reposition some later,
 * unrelated resize.
 * @returns The ref to put on the row and the capture to call before toggling it.
 */
export function useScrollAnchor(): {
	anchorRef: RefObject<HTMLDivElement | null>;
	captureAnchor: () => void;
} {
	const conversation = useConversationViewport();
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const anchoredTopRef = useRef<number | null>(null);
	const [capturesTaken, setCapturesTaken] = useState(0);

	const captureAnchor = useCallback(() => {
		anchoredTopRef.current =
			anchorRef.current?.getBoundingClientRect().top ?? null;
		setCapturesTaken((taken) => taken + 1);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: capturesTaken is the trigger, not an input — it schedules the commit that consumes the anchor, and the body measures the DOM rather than reading it.
	useLayoutEffect(() => {
		const anchoredTop = anchoredTopRef.current;
		anchoredTopRef.current = null;
		const row = anchorRef.current;
		if (anchoredTop === null || row === null) {
			return;
		}
		conversation?.holdRowStill(row, anchoredTop);
	}, [capturesTaken, conversation]);

	return { anchorRef, captureAnchor };
}

/**
 * Open/close state for a timeline row that owns its own disclosure, anchored so
 * opening it never moves the row. See {@link useScrollAnchor} for what the
 * anchoring holds still.
 * @returns The disclosure state, the ref to put on the row, and its toggle.
 */
export function useAnchoredDisclosure(): {
	isOpen: boolean;
	rowRef: RefObject<HTMLDivElement | null>;
	toggle: () => void;
} {
	const [isOpen, setIsOpen] = useState(false);
	const { anchorRef, captureAnchor } = useScrollAnchor();

	const toggle = useCallback(() => {
		captureAnchor();
		setIsOpen((open) => !open);
	}, [captureAnchor]);

	return { isOpen, rowRef: anchorRef, toggle };
}
