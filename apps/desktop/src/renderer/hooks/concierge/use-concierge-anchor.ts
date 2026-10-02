import { useAtom } from 'jotai';
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from 'react';
import { readWindowChromeInsetsPx } from '@/renderer/lib/window-chrome';
import {
	CONCIERGE_UNPLACED,
	type ConciergePoint,
	conciergeAnchorAtom,
} from '@/renderer/state/concierge';

/** A Concierge surface's own width and height, in pixels. */
export interface ConciergeSurfaceSize {
	height: number;
	width: number;
}

/** What a Concierge surface needs to place and drag itself. */
export interface ConciergeAnchoredSurface<T extends HTMLElement> {
	/**
	 * Whether the press in flight has travelled far enough to count as a drag.
	 * A getter rather than a value because the gesture never re-renders: a click
	 * handler has to read it at the moment the click arrives.
	 */
	isDragging: () => boolean;
	onPointerDown: (event: { clientX: number; clientY: number }) => void;
	ref: RefObject<T | null>;
}

/** Distance a pointer must travel before a press counts as a drag, in pixels. */
const DRAG_THRESHOLD = 4;

/** Margin kept between a Concierge surface and the viewport edge, in pixels. */
const EDGE_MARGIN = 8;

/** Distance the anchor keeps from the viewport's right edge initially. */
const DOCK_MARGIN_X = 16;

/**
 * Distance the anchor keeps from the viewport's bottom edge initially. Taller
 * than the side margin because the bottom-right corner is already occupied:
 * `src/renderer/components/ui/sonner.tsx` leaves sonner on its default
 * bottom-right stack, which starts 24px up, and the Setup pane floats its rerun
 * control in the same corner — both of which an undragged bubble would sit on
 * top of.
 *
 * It lifts the panel by the same amount, because the two surfaces share one
 * corner by design: the panel opens where the bubble was, so a launcher-only
 * margin would make opening it jump.
 */
const DOCK_MARGIN_Y = 96;

/** A drag in flight: where it started, and where it has reached. */
interface DragSession {
	moved: boolean;
	pointer: ConciergePoint;
	point: ConciergePoint;
	start: ConciergePoint;
}

/**
 * The bottom-right corner the Concierge hangs from before the user has moved it.
 * @returns The default anchor.
 */
function dockedAnchor(): ConciergePoint {
	return {
		x: window.innerWidth - DOCK_MARGIN_X,
		y: window.innerHeight - DOCK_MARGIN_Y,
	};
}

/**
 * The highest a Concierge surface may reach, in pixels. A dragged surface is
 * positioned against the viewport rather than against the padded document, so
 * where Ensemblr draws its own title bar the margin alone would let the panel's
 * own header slide underneath it and out of reach.
 * @returns The top edge the drag stops at.
 */
export function conciergeTopBound(): number {
	return readWindowChromeInsetsPx().top + EDGE_MARGIN;
}

/**
 * Clamps a top-left point so the surface it positions stays reachable, which
 * also covers a window that has since been resized around a stored anchor.
 * @param point - The proposed top-left corner.
 * @param size - The surface's own width and height.
 * @returns The point clamped inside the viewport.
 */
function clampToViewport(
	point: ConciergePoint,
	size: ConciergeSurfaceSize,
): ConciergePoint {
	const minY = conciergeTopBound();
	const maxX = Math.max(
		EDGE_MARGIN,
		window.innerWidth - size.width - EDGE_MARGIN,
	);
	const maxY = Math.max(minY, window.innerHeight - size.height - EDGE_MARGIN);
	return {
		x: Math.min(Math.max(point.x, EDGE_MARGIN), maxX),
		y: Math.min(Math.max(point.y, minY), maxY),
	};
}

/**
 * Where a surface of the given size sits so that its bottom-right corner lands
 * on the shared anchor.
 * @param anchor - The stored anchor, or the unplaced sentinel.
 * @param size - The surface's own width and height.
 * @returns The surface's clamped top-left corner.
 */
function topLeftFor(
	anchor: ConciergePoint,
	size: ConciergeSurfaceSize,
): ConciergePoint {
	const isPlaced =
		anchor.x !== CONCIERGE_UNPLACED.x || anchor.y !== CONCIERGE_UNPLACED.y;
	const corner = isPlaced ? anchor : dockedAnchor();
	return clampToViewport(
		{ x: corner.x - size.width, y: corner.y - size.height },
		size,
	);
}

/**
 * Places a Concierge surface against the shared anchor and makes it draggable.
 *
 * Both surfaces hang their bottom-right corner from one persisted point, so the
 * launcher bubble and the panel that replaces it stay in the same place: drag
 * either and the other has already moved. Two positions could not do that — a
 * bubble dragged to the top-left opened a panel still docked bottom-right.
 *
 * The gesture writes `left`/`top` straight onto the node and commits to the atom
 * only on pointer-up. Persisting each move meant a `localStorage` write and a
 * React render per pointer event, which is what left the bubble trailing the
 * cursor; the surface now moves in the same frame as the pointer.
 *
 * That direct write is why the placement is applied in a layout effect rather
 * than through `style`: the panel re-renders while the agent streams, and a
 * `left` React owned would snap back to the last committed anchor mid-drag.
 * A surface that is also resizable hands in the ref it already owns and a
 * `suspended` getter: a resize writes `left`/`top` of its own to hold the
 * opposite corner still, and the placement below would otherwise overwrite them
 * on the next render the streaming transcript causes.
 * @param size - The surface's width and height, for the anchor offset and the clamp.
 * @param enabled - False while the surface is positioned by something else, as the maximized panel is.
 * @param externalRef - Node ref to place, when the caller already holds one; a ref of its own otherwise.
 * @param suspended - Reports a gesture that owns the node's offsets right now.
 * @returns The node ref to attach, the drag handler, and the click-suppression getter.
 */
export function useConciergeAnchor<T extends HTMLElement>({
	enabled = true,
	externalRef,
	size,
	suspended,
}: {
	enabled?: boolean;
	externalRef?: RefObject<T | null>;
	size: ConciergeSurfaceSize;
	suspended?: () => boolean;
}): ConciergeAnchoredSurface<T> {
	const [anchor, setAnchor] = useAtom(conciergeAnchorAtom);
	const ownRef = useRef<T | null>(null);
	const ref = externalRef ?? ownRef;
	const session = useRef<DragSession | null>(null);
	const dragged = useRef(false);
	const endDrag = useRef<(() => void) | null>(null);

	const applyAnchoredPosition = useCallback(() => {
		const node = ref.current;
		if (!node || !enabled || session.current || suspended?.()) {
			return;
		}
		const point = topLeftFor(anchor, size);
		node.style.left = `${point.x}px`;
		node.style.top = `${point.y}px`;
	}, [anchor, enabled, ref, size, suspended]);

	useLayoutEffect(applyAnchoredPosition);

	useEffect(() => {
		window.addEventListener('resize', applyAnchoredPosition);
		return () => window.removeEventListener('resize', applyAnchoredPosition);
	}, [applyAnchoredPosition]);

	// A gesture can outlive the surface it moves: ⌘, opens Settings from the
	// keyboard with the pointer still down, and the listeners it left on the
	// window would then write offsets onto a detached node.
	useEffect(() => () => endDrag.current?.(), []);

	const onPointerDown = useCallback(
		(event: { clientX: number; clientY: number }) => {
			const node = ref.current;
			if (!enabled || !node) {
				return;
			}
			const start = topLeftFor(anchor, size);
			session.current = {
				moved: false,
				point: start,
				pointer: { x: event.clientX, y: event.clientY },
				start,
			};

			const handleMove = (move: PointerEvent) => {
				const drag = session.current;
				if (!drag) {
					return;
				}
				const dx = move.clientX - drag.pointer.x;
				const dy = move.clientY - drag.pointer.y;
				if (
					!drag.moved &&
					Math.abs(dx) < DRAG_THRESHOLD &&
					Math.abs(dy) < DRAG_THRESHOLD
				) {
					return;
				}
				drag.moved = true;
				dragged.current = true;
				drag.point = clampToViewport(
					{ x: drag.start.x + dx, y: drag.start.y + dy },
					size,
				);
				node.style.left = `${drag.point.x}px`;
				node.style.top = `${drag.point.y}px`;
			};

			const handleEnd = () => {
				window.removeEventListener('pointercancel', handleEnd);
				window.removeEventListener('pointermove', handleMove);
				window.removeEventListener('pointerup', handleEnd);
				endDrag.current = null;
				const drag = session.current;
				session.current = null;
				// Cleared on the next frame so the click this pointer-up produces
				// still sees the drag and can suppress itself.
				requestAnimationFrame(() => {
					dragged.current = false;
				});
				if (!drag?.moved) {
					return;
				}
				setAnchor({
					x: drag.point.x + size.width,
					y: drag.point.y + size.height,
				});
			};

			endDrag.current = handleEnd;
			window.addEventListener('pointercancel', handleEnd);
			window.addEventListener('pointermove', handleMove);
			window.addEventListener('pointerup', handleEnd);
		},
		[anchor, enabled, ref, setAnchor, size],
	);

	return {
		isDragging: useCallback(() => dragged.current, []),
		onPointerDown,
		ref,
	};
}
