import {
	type KeyboardEvent,
	type PointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import {
	clampZoom,
	type DiagramViewport,
	fitViewport,
	IDENTITY_VIEWPORT,
	panViewport,
	wheelZoom,
	ZOOM,
	zoomAbout,
} from '@/renderer/lib/architecture-diagram/viewport';
import type { DiagramSize } from '@/shared/architecture-diagram';

/** How far one arrow-key press moves the drawing. */
const KEYBOARD_PAN_PX = 48;

/** Middle mouse button, which pans from anywhere including over a node. */
const MIDDLE_BUTTON = 1;

/** Everything the canvas needs to be pannable, zoomable, and framable. */
export interface DiagramViewportControls {
	fitToView: () => void;
	isPanning: boolean;
	onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void;
	onPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
	paneRef: RefObject<HTMLDivElement | null>;
	reset: () => void;
	setZoom: (zoom: number) => void;
	view: DiagramViewport;
}

/**
 * Tracks the pane's own size, which framing the drawing needs and which changes
 * whenever the user drags the panel divider.
 * @param paneRef - The element the diagram is drawn into
 * @returns The measured size, zero until the first observation lands
 */
function usePaneSize(paneRef: RefObject<HTMLDivElement | null>): {
	height: number;
	width: number;
} {
	const [size, setSize] = useState({ height: 0, width: 0 });
	useEffect(() => {
		const pane = paneRef.current;
		if (!pane) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.contentRect;
			if (box) {
				setSize({ height: box.height, width: box.width });
			}
		});
		observer.observe(pane);
		return () => observer.disconnect();
	}, [paneRef]);
	return size;
}

/**
 * Binds the wheel listener natively rather than through React's `onWheel`.
 *
 * React attaches wheel handlers passively at the root, so `preventDefault` in
 * one is ignored — and without it a ⌘-wheel is swallowed by Electron's own
 * page zoom and a two-finger scroll rubber-bands the pane instead of panning
 * the drawing.
 * @param paneRef - The element to listen on
 * @param onWheel - The handler, kept in a ref so the listener binds once
 */
function useNonPassiveWheel(
	paneRef: RefObject<HTMLDivElement | null>,
	onWheel: (event: WheelEvent) => void,
): void {
	const handlerRef = useRef(onWheel);
	handlerRef.current = onWheel;
	useEffect(() => {
		const pane = paneRef.current;
		if (!pane) {
			return;
		}
		const listener = (event: WheelEvent) => handlerRef.current(event);
		pane.addEventListener('wheel', listener, { passive: false });
		return () => pane.removeEventListener('wheel', listener);
	}, [paneRef]);
}

/**
 * Pan and zoom state for the diagram canvas: drag to pan, two-finger scroll to
 * pan, pinch or ⌘-wheel to zoom at the pointer, plus fit and reset.
 *
 * The drawing is moved by a transform rather than by scrolling an oversized
 * element, which is what makes dragging it possible at all — and what lets a
 * zoom keep the point under the cursor still.
 * @param viewBox - The compiled canvas size, which framing measures against
 * @returns The viewport, its handlers, and the ref to put on the pane
 */
export function useDiagramViewport(
	viewBox: DiagramSize,
): DiagramViewportControls {
	const paneRef = useRef<HTMLDivElement>(null);
	const paneSize = usePaneSize(paneRef);
	const [view, setView] = useState<DiagramViewport>(IDENTITY_VIEWPORT);
	const [isPanning, setIsPanning] = useState(false);
	const hasFramedRef = useRef(false);

	const fitToView = useCallback(() => {
		setView(fitViewport(viewBox, paneSize));
	}, [paneSize, viewBox]);

	// Frame the drawing once the pane has a measured size, so a diagram taller
	// than the pane opens whole rather than cropped at its top-left corner.
	useEffect(() => {
		if (hasFramedRef.current || paneSize.width <= 0) {
			return;
		}
		hasFramedRef.current = true;
		setView(fitViewport(viewBox, paneSize));
	}, [paneSize, viewBox]);

	const focusOf = useCallback((clientX: number, clientY: number) => {
		const box = paneRef.current?.getBoundingClientRect();
		return {
			x: clientX - (box?.left ?? 0),
			y: clientY - (box?.top ?? 0),
		};
	}, []);

	useNonPassiveWheel(
		paneRef,
		useCallback(
			(event: WheelEvent) => {
				event.preventDefault();
				// macOS reports a trackpad pinch as a wheel event carrying ctrlKey;
				// ⌘ is the explicit zoom modifier for a mouse wheel.
				const isZoom = event.ctrlKey || event.metaKey;
				if (!isZoom) {
					setView((current) =>
						panViewport(current, -event.deltaX, -event.deltaY),
					);
					return;
				}
				const focus = focusOf(event.clientX, event.clientY);
				setView((current) =>
					zoomAbout(
						current,
						wheelZoom(
							current.zoom,
							event.deltaY,
							event.ctrlKey ? 'pinch' : 'wheel',
						),
						focus,
					),
				);
			},
			[focusOf],
		),
	);

	const onPointerDown = useCallback((event: PointerEvent<SVGSVGElement>) => {
		const isBackground = event.currentTarget === event.target;
		if (
			event.button !== MIDDLE_BUTTON &&
			!(event.button === 0 && isBackground)
		) {
			return;
		}
		event.preventDefault();
		const target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		setIsPanning(true);
		let last = { x: event.clientX, y: event.clientY };

		const move = (moved: globalThis.PointerEvent) => {
			const dx = moved.clientX - last.x;
			const dy = moved.clientY - last.y;
			last = { x: moved.clientX, y: moved.clientY };
			setView((current) => panViewport(current, dx, dy));
		};
		const stop = () => {
			target.releasePointerCapture?.(event.pointerId);
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', stop);
			target.removeEventListener('pointercancel', stop);
			setIsPanning(false);
		};
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', stop);
		target.addEventListener('pointercancel', stop);
	}, []);

	const setZoom = useCallback(
		(zoom: number) => {
			setView((current) =>
				zoomAbout(current, clampZoom(zoom), {
					x: paneSize.width / 2,
					y: paneSize.height / 2,
				}),
			);
		},
		[paneSize],
	);

	const reset = useCallback(() => setView(IDENTITY_VIEWPORT), []);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<SVGSVGElement>) => {
			const pan: Record<string, [number, number]> = {
				ArrowDown: [0, -KEYBOARD_PAN_PX],
				ArrowLeft: [KEYBOARD_PAN_PX, 0],
				ArrowRight: [-KEYBOARD_PAN_PX, 0],
				ArrowUp: [0, KEYBOARD_PAN_PX],
			};
			const step = pan[event.key];
			if (step) {
				event.preventDefault();
				setView((current) => panViewport(current, step[0], step[1]));
				return;
			}
			if (event.key === '0') {
				event.preventDefault();
				fitToView();
				return;
			}
			if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				setZoom(view.zoom + ZOOM.step);
				return;
			}
			if (event.key === '-') {
				event.preventDefault();
				setZoom(view.zoom - ZOOM.step);
			}
		},
		[fitToView, setZoom, view.zoom],
	);

	return {
		fitToView,
		isPanning,
		onKeyDown,
		onPointerDown,
		paneRef,
		reset,
		setZoom,
		view,
	};
}
