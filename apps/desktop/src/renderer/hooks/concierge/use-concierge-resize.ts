import { useAtom, useSetAtom } from 'jotai';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
} from 'react';
import {
	CONCIERGE_MIN_PANEL_SIZE,
	type ConciergeSize,
	conciergeAnchorAtom,
	conciergePanelSizeAtom,
} from '@/renderer/state/concierge';

import { conciergeTopBound } from './use-concierge-anchor';

/** Which edges a resize gesture moves. */
export type ConciergeResizeEdge =
	| 'bottom'
	| 'bottom-left'
	| 'bottom-right'
	| 'left'
	| 'right'
	| 'top'
	| 'top-left'
	| 'top-right';

/**
 * Which edge each axis of a grip moves: `-1` the leading one, `1` the trailing
 * one, `0` neither.
 *
 * One table rather than a string test per question, because every part of the
 * gesture asks the same thing in a different form — which edge stays still,
 * which way the pointer grows the panel, which arrow key grows it, and whether
 * the corner the panel hangs from has moved.
 */
const EDGE_AXES: Record<ConciergeResizeEdge, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> =
	{
		bottom: { x: 0, y: 1 },
		'bottom-left': { x: -1, y: 1 },
		'bottom-right': { x: 1, y: 1 },
		left: { x: -1, y: 0 },
		right: { x: 1, y: 0 },
		top: { x: 0, y: -1 },
		'top-left': { x: -1, y: -1 },
		'top-right': { x: 1, y: -1 },
	};

/** What a resizable Concierge surface needs to draw and drive its handles. */
export interface ConciergeResizableSurface {
	/**
	 * Whether a resize gesture is in flight, as a getter so the gesture never
	 * re-renders: the placement effect reads it on every render to know that the
	 * offsets on the node are the gesture's and not its own to overwrite.
	 */
	isResizing: () => boolean;
	/** Grows or shrinks the panel from a focused handle, one step per press. */
	nudge: (edge: ConciergeResizeEdge, event: ReactKeyboardEvent) => void;
	/** The node being resized, which is also the node the anchor places. */
	ref: RefObject<HTMLElement | null>;
	/** The size the panel renders at, already clamped to the viewport. */
	size: ConciergeSize;
	/** Begins a pointer resize from one of the panel's edges or corners. */
	start: (
		edge: ConciergeResizeEdge,
		event: { clientX: number; clientY: number },
	) => void;
}

/** Margin kept between the panel and the viewport edge, in pixels. */
const EDGE_MARGIN = 8;

/** How far one arrow-key press moves an edge, in pixels. */
const NUDGE_STEP = 32;

/** The panel's rectangle in viewport coordinates. */
interface PanelRect {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

/** A resize in flight: the rectangle it started from, and where it has reached. */
interface ResizeSession {
	edge: ConciergeResizeEdge;
	pointer: { x: number; y: number };
	rect: PanelRect;
	size: ConciergeSize;
	start: PanelRect;
}

/**
 * Holds a proposed size between the shipped minimum and what the window can
 * show, so a stored size survives the window being made smaller around it.
 * @param size - The proposed width and height.
 * @returns The size clamped to the minimum and the viewport.
 */
function clampSize(size: ConciergeSize): ConciergeSize {
	return {
		height: clampSpan(
			size.height,
			CONCIERGE_MIN_PANEL_SIZE.height,
			window.innerHeight - conciergeTopBound() - EDGE_MARGIN,
		),
		width: clampSpan(
			size.width,
			CONCIERGE_MIN_PANEL_SIZE.width,
			window.innerWidth - EDGE_MARGIN * 2,
		),
	};
}

/**
 * Holds one span between its floor and a ceiling, with the floor winning when a
 * window too small to show the panel would otherwise invert the two.
 *
 * Rounded because a gesture measures the panel with `getBoundingClientRect`,
 * which reports the sub-pixel offsets a drag leaves behind — stored unrounded
 * they accumulate across resizes and put the panel's border on a half-pixel.
 * @param span - The proposed width or height.
 * @param minimum - The shipped floor for that axis.
 * @param maximum - What the window can currently show on that axis.
 * @returns The clamped span, in whole pixels.
 */
function clampSpan(span: number, minimum: number, maximum: number): number {
	return Math.round(
		Math.min(Math.max(span, minimum), Math.max(minimum, maximum)),
	);
}

/**
 * Resolves the rectangle a pointer move proposes, with the edges the grip does
 * not move left exactly where they were.
 *
 * The moving edge is re-derived from the clamped span rather than from the
 * pointer, so a drag that hits the minimum stops that edge dead instead of
 * letting it carry on and drag the fixed one along with it.
 * @param resize - The gesture in flight.
 * @param move - Where the pointer has reached.
 * @returns The proposed rectangle and the size it implies.
 */
function resolveResize(
	resize: ResizeSession,
	move: { clientX: number; clientY: number },
): { rect: PanelRect; size: ConciergeSize } {
	const axes = EDGE_AXES[resize.edge];
	const { start } = resize;
	const dx = move.clientX - resize.pointer.x;
	const dy = move.clientY - resize.pointer.y;

	const width = clampSpan(
		axes.x === 0 ? start.right - start.left : spanAlong(start, axes.x, dx, 'x'),
		CONCIERGE_MIN_PANEL_SIZE.width,
		axes.x === -1
			? start.right - EDGE_MARGIN
			: window.innerWidth - EDGE_MARGIN - start.left,
	);
	const height = clampSpan(
		axes.y === 0 ? start.bottom - start.top : spanAlong(start, axes.y, dy, 'y'),
		CONCIERGE_MIN_PANEL_SIZE.height,
		axes.y === -1
			? start.bottom - conciergeTopBound()
			: window.innerHeight - EDGE_MARGIN - start.top,
	);

	const left = axes.x === -1 ? start.right - width : start.left;
	const top = axes.y === -1 ? start.bottom - height : start.top;
	return {
		rect: { bottom: top + height, left, right: left + width, top },
		size: { height, width },
	};
}

/**
 * The span a pointer delta proposes along one axis, before clamping.
 * @param start - The rectangle the gesture opened on.
 * @param direction - `-1` when the leading edge moves, `1` when the trailing one does.
 * @param delta - How far the pointer has travelled on that axis.
 * @param axis - Which axis is being measured.
 * @returns The proposed width or height.
 */
function spanAlong(
	start: PanelRect,
	direction: -1 | 1,
	delta: number,
	axis: 'x' | 'y',
): number {
	const span =
		axis === 'x' ? start.right - start.left : start.bottom - start.top;
	return span + delta * direction;
}

/**
 * Makes the docked Concierge panel resizable from any edge or corner.
 *
 * The gesture writes `width`/`height` straight onto the node — along with the
 * `left`/`top` that keep the opposite edges still — and commits to the atoms
 * only on pointer-up, for the same reason the drag does: a `localStorage` write
 * and a React render per pointer event is what makes a surface trail the cursor.
 * The panel re-renders while the agent streams, so `isResizing` is what stops
 * the anchor's placement effect from snapping the node back to the committed
 * size mid-gesture.
 *
 * A grip that moves the trailing edges commits the anchor too, because that is
 * the corner the whole Concierge hangs from: resized from the bottom-right and
 * left alone, the panel would snap back to where its old corner put it on the
 * very next render. A grip that moves only the leading edges deliberately does
 * not, so a panel the user has never dragged keeps re-docking to the window's
 * corner rather than being pinned by a resize.
 * @param enabled - False while the panel is positioned by something else, as the maximized one is.
 * @returns The node ref to attach, the handle drivers, and the size to render at.
 */
export function useConciergeResize({
	enabled = true,
}: {
	enabled?: boolean;
} = {}): ConciergeResizableSurface {
	const [stored, setStored] = useAtom(conciergePanelSizeAtom);
	const setAnchor = useSetAtom(conciergeAnchorAtom);
	const ref = useRef<HTMLElement | null>(null);
	const session = useRef<ResizeSession | null>(null);
	const endResize = useRef<(() => void) | null>(null);
	const size = clampSize(stored);

	// A gesture can outlive the surface it resizes — ⌘, opens Settings from the
	// keyboard with the pointer still down — and the listeners it left on the
	// window would then write offsets onto a detached node.
	useEffect(() => () => endResize.current?.(), []);

	useEffect(() => {
		const reclamp = () => setStored((current) => clampSize(current));
		window.addEventListener('resize', reclamp);
		return () => window.removeEventListener('resize', reclamp);
	}, [setStored]);

	const start = useCallback(
		(
			edge: ConciergeResizeEdge,
			event: { clientX: number; clientY: number },
		) => {
			const node = ref.current;
			if (!enabled || !node) {
				return;
			}
			const box = node.getBoundingClientRect();
			const opening: PanelRect = {
				bottom: box.bottom,
				left: box.left,
				right: box.right,
				top: box.top,
			};
			session.current = {
				edge,
				pointer: { x: event.clientX, y: event.clientY },
				rect: opening,
				size: { height: box.height, width: box.width },
				start: opening,
			};

			const handleMove = (move: PointerEvent) => {
				const resize = session.current;
				if (!resize) {
					return;
				}
				const next = resolveResize(resize, move);
				resize.rect = next.rect;
				resize.size = next.size;
				node.style.height = `${next.size.height}px`;
				node.style.left = `${next.rect.left}px`;
				node.style.top = `${next.rect.top}px`;
				node.style.width = `${next.size.width}px`;
			};

			const handleEnd = () => {
				window.removeEventListener('pointercancel', handleEnd);
				window.removeEventListener('pointermove', handleMove);
				window.removeEventListener('pointerup', handleEnd);
				endResize.current = null;
				const resize = session.current;
				session.current = null;
				if (!resize) {
					return;
				}
				setStored(resize.size);
				commitAnchorFor(resize.edge, resize.rect, setAnchor);
			};

			endResize.current = handleEnd;
			window.addEventListener('pointercancel', handleEnd);
			window.addEventListener('pointermove', handleMove);
			window.addEventListener('pointerup', handleEnd);
		},
		[enabled, setAnchor, setStored],
	);

	const nudge = useCallback(
		(edge: ConciergeResizeEdge, event: ReactKeyboardEvent) => {
			const node = ref.current;
			const step = nudgeStep(edge, event.key);
			if (!enabled || !node || (step.height === 0 && step.width === 0)) {
				return;
			}
			event.preventDefault();
			const box = node.getBoundingClientRect();
			const next = clampSize({
				height: box.height + step.height,
				width: box.width + step.width,
			});
			setStored(next);
			commitAnchorFor(
				edge,
				{
					bottom: box.top + next.height,
					left: box.left,
					right: box.left + next.width,
					top: box.top,
				},
				setAnchor,
			);
		},
		[enabled, setAnchor, setStored],
	);

	return {
		isResizing: useCallback(() => session.current !== null, []),
		nudge,
		ref,
		size,
		start,
	};
}

/**
 * Moves the corner the Concierge hangs from, but only when the grip that was
 * used actually moved it.
 * @param edge - The grip the gesture came from.
 * @param rect - Where the panel ended up.
 * @param setAnchor - Writer for the shared anchor.
 */
function commitAnchorFor(
	edge: ConciergeResizeEdge,
	rect: PanelRect,
	setAnchor: (point: { x: number; y: number }) => void,
): void {
	const axes = EDGE_AXES[edge];
	if (axes.x === 1 || axes.y === 1) {
		setAnchor({ x: rect.right, y: rect.bottom });
	}
}

/**
 * How far one arrow press moves the panel's edges, signed so every grip grows
 * when the key points away from the panel.
 * @param edge - The grip that has focus.
 * @param key - The key that was pressed.
 * @returns The width and height deltas, both zero for a key the grip ignores.
 */
function nudgeStep(edge: ConciergeResizeEdge, key: string): ConciergeSize {
	const axes = EDGE_AXES[edge];
	const horizontal = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
	const vertical = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
	return {
		height: vertical * axes.y * NUDGE_STEP,
		width: horizontal * axes.x * NUDGE_STEP,
	};
}
