import { useAtom, useSetAtom, useStore } from 'jotai';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '@/renderer/state/workspace';

const RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH = 1024;
const RIGHT_SIDEBAR_DEFAULT_SIZE_PERCENT = 34;
const RIGHT_SIDEBAR_MAX_SIZE_PERCENT = 68;
const RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT = 1;
const RIGHT_SIDEBAR_SIZE_COMMIT_DELAY_MS = 250;

/**
 * The one query every viewport test here goes through, read positively for wide
 * and negated for narrow. It mirrors Tailwind's `lg` (64rem), which
 * `panel-layout.tsx` gates the resizable rail on — a separate `max-width:
 * 1023px` query would leave a fractional-width band where both read false and
 * the rail was neither panel nor sheet.
 */
const RIGHT_SIDEBAR_WIDE_VIEWPORT_QUERY = `(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`;

/** The width the right sidebar collapses to, shared with the panel that renders it. */
export const RIGHT_SIDEBAR_COLLAPSED_SIZE = '0rem';

/** True when the viewport is wide enough to seat the rail beside the content. */
function isWideViewport() {
	return window.matchMedia(RIGHT_SIDEBAR_WIDE_VIEWPORT_QUERY).matches;
}

/**
 * Subscribes to changes in the wide-viewport query.
 * @param onStoreChange - Callback invoked when the match state flips.
 * @returns A teardown function that removes the listener.
 */
function subscribeToViewportWidthChanges(onStoreChange: () => void) {
	const wideViewportQuery = window.matchMedia(
		RIGHT_SIDEBAR_WIDE_VIEWPORT_QUERY,
	);

	wideViewportQuery.addEventListener('change', onStoreChange);
	return () => wideViewportQuery.removeEventListener('change', onStoreChange);
}

/** Snapshot for {@link useSyncExternalStore}: the negation of the wide query. */
function getNarrowViewportSnapshot() {
	return !isWideViewport();
}

/** Clamps a sidebar size percentage to the supported range, defaulting on NaN. */
function getClampedRightSidebarSizePercent(sizePercent: number) {
	if (!Number.isFinite(sizePercent)) {
		return RIGHT_SIDEBAR_DEFAULT_SIZE_PERCENT;
	}

	return Math.min(
		RIGHT_SIDEBAR_MAX_SIZE_PERCENT,
		Math.max(
			RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT,
			Math.round(sizePercent * 100) / 100,
		),
	);
}

/** True when the viewport is wide enough to persist user-driven sidebar sizes. */
function canPersistRightSidebarResize() {
	return isWideViewport();
}

/** Right-sidebar collapse/expand state and handlers returned by {@link useRightSidebarController}. */
interface RightSidebarController {
	collapseRightSidebar: () => void;
	expandRightSidebar: () => void;
	handleRightSidebarResize: (size: PanelSize) => void;
	initialRightSidebarSize: string;
	/** True below the breakpoint the resizable rail needs, where it is a sheet. */
	isNarrowViewport: boolean;
	/** Whether the rail is hidden — the sheet while narrow, the panel while wide. */
	isRightSidebarCollapsed: boolean;
	isRightSidebarSheetOpen: boolean;
	rightSidebarPanelRef: React.RefObject<PanelImperativeHandle | null>;
	setRightSidebarSheetOpen: (open: boolean) => void;
}

/**
 * Owns the right-sidebar collapse/expand state, viewport-driven auto-collapse,
 * and the imperative panel ref.
 *
 * Below {@link RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH} the rail has no room beside the
 * content, so expanding opens it as a sheet over the content instead of widening
 * the user's window. The persisted collapse preference and width describe the
 * wide layout only: opening and closing the sheet never writes either, so a
 * window narrowed for an afternoon comes back to the layout it left.
 */
export function useRightSidebarController(): RightSidebarController {
	const store = useStore();
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightSidebarCollapsedByViewportRef = useRef(false);
	const [storedRightSidebarCollapsed, setStoredRightSidebarCollapsed] = useAtom(
		rightSidebarCollapsedAtom,
	);
	// react-resizable-panels re-registers a panel — tearing down and relaying out
	// the whole group — whenever `defaultSize` changes, so the persisted layout is
	// read once at mount rather than subscribed to and tracked through a drag.
	const [initialRightSidebarLayout] = useState(() => {
		const sizePercent = getClampedRightSidebarSizePercent(
			store.get(rightSidebarSizePercentAtom),
		);

		return {
			size: store.get(rightSidebarCollapsedAtom)
				? RIGHT_SIDEBAR_COLLAPSED_SIZE
				: `${sizePercent}%`,
			sizePercent,
		};
	});
	const setRightSidebarSizePercent = useSetAtom(rightSidebarSizePercentAtom);
	const rightSidebarCollapsedPreferenceRef = useRef(
		storedRightSidebarCollapsed,
	);
	const rightSidebarSizePercentRef = useRef(
		initialRightSidebarLayout.sizePercent,
	);
	const pendingRightSidebarSizePercentRef = useRef<number | null>(null);
	const rightSidebarSizeCommitTimerRef = useRef<number | null>(null);
	const [isRightSidebarPanelCollapsed, setIsRightSidebarPanelCollapsed] =
		useState(storedRightSidebarCollapsed);
	const [isRightSidebarSheetOpen, setRightSidebarSheetOpen] = useState(false);
	const isNarrowViewport = useSyncExternalStore(
		subscribeToViewportWidthChanges,
		getNarrowViewportSnapshot,
		() => false,
	);

	useEffect(() => {
		rightSidebarCollapsedPreferenceRef.current = storedRightSidebarCollapsed;
	}, [storedRightSidebarCollapsed]);

	// Both toggles read the live query rather than the rendered snapshot: a click
	// can land in the frame between a viewport change and the re-render it
	// schedules, and hiding the panel when the sheet is the visible host — or the
	// reverse — leaves the user's click doing nothing at all.
	/** Hides the rail: the sheet while narrow, the panel and its preference while wide. */
	const collapseRightSidebar = () => {
		if (!isWideViewport()) {
			setRightSidebarSheetOpen(false);
			return;
		}

		rightSidebarCollapsedByViewportRef.current = false;
		rightSidebarPanelRef.current?.collapse();
		rightSidebarCollapsedPreferenceRef.current = true;
		setIsRightSidebarPanelCollapsed(true);
		setStoredRightSidebarCollapsed(true);
	};
	/** Shows the rail: the sheet over the content while narrow, the panel while wide. */
	const expandRightSidebar = () => {
		if (!isWideViewport()) {
			setRightSidebarSheetOpen(true);
			return;
		}

		rightSidebarCollapsedByViewportRef.current = false;

		window.requestAnimationFrame(() => {
			rightSidebarPanelRef.current?.expand();
			rightSidebarPanelRef.current?.resize(
				`${rightSidebarSizePercentRef.current}%`,
			);
			rightSidebarCollapsedPreferenceRef.current = false;
			setIsRightSidebarPanelCollapsed(false);
			setStoredRightSidebarCollapsed(false);
		});
	};
	/** Writes whatever width the drag last reported and drops the queued commit. */
	const flushRightSidebarSizePercent = useCallback(() => {
		if (rightSidebarSizeCommitTimerRef.current !== null) {
			window.clearTimeout(rightSidebarSizeCommitTimerRef.current);
			rightSidebarSizeCommitTimerRef.current = null;
		}

		const pendingSizePercent = pendingRightSidebarSizePercentRef.current;

		if (pendingSizePercent === null) {
			return;
		}

		pendingRightSidebarSizePercentRef.current = null;
		setRightSidebarSizePercent(pendingSizePercent);
	}, [setRightSidebarSizePercent]);
	/** Defers the storage write until the drag settles, keeping frames free. */
	const scheduleRightSidebarSizePercentCommit = (sizePercent: number) => {
		pendingRightSidebarSizePercentRef.current = sizePercent;

		if (rightSidebarSizeCommitTimerRef.current !== null) {
			window.clearTimeout(rightSidebarSizeCommitTimerRef.current);
		}

		rightSidebarSizeCommitTimerRef.current = window.setTimeout(
			flushRightSidebarSizePercent,
			RIGHT_SIDEBAR_SIZE_COMMIT_DELAY_MS,
		);
	};
	/** Persists user-driven resizes and toggles the collapsed flag. */
	const handleRightSidebarResize = (size: PanelSize) => {
		const isCollapsed =
			size.asPercentage <= RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT;

		setIsRightSidebarPanelCollapsed(isCollapsed);

		if (!canPersistRightSidebarResize()) {
			return;
		}

		if (rightSidebarCollapsedPreferenceRef.current !== isCollapsed) {
			rightSidebarCollapsedPreferenceRef.current = isCollapsed;
			setStoredRightSidebarCollapsed(isCollapsed);
		}

		if (isCollapsed) {
			return;
		}

		const nextSizePercent = getClampedRightSidebarSizePercent(
			size.asPercentage,
		);

		if (nextSizePercent === rightSidebarSizePercentRef.current) {
			return;
		}

		rightSidebarSizePercentRef.current = nextSizePercent;
		scheduleRightSidebarSizePercentCommit(nextSizePercent);
	};

	// Quitting tears the renderer down without unmounting React, so the unmount
	// cleanup alone would drop a width the user dragged to moments before.
	useEffect(() => {
		window.addEventListener('pagehide', flushRightSidebarSizePercent);

		return () => {
			window.removeEventListener('pagehide', flushRightSidebarSizePercent);
			flushRightSidebarSizePercent();
		};
	}, [flushRightSidebarSizePercent]);

	useEffect(() => {
		const wideViewportQuery = window.matchMedia(
			RIGHT_SIDEBAR_WIDE_VIEWPORT_QUERY,
		);
		let restoreFrame: number | null = null;
		const syncRightSidebarWithViewport = () => {
			if (!wideViewportQuery.matches) {
				if (restoreFrame !== null) {
					window.cancelAnimationFrame(restoreFrame);
					restoreFrame = null;
				}

				const wasAlreadyCollapsed =
					rightSidebarPanelRef.current?.isCollapsed() ||
					isRightSidebarPanelCollapsed;

				rightSidebarPanelRef.current?.collapse();
				setIsRightSidebarPanelCollapsed(true);

				if (!wasAlreadyCollapsed) {
					rightSidebarCollapsedByViewportRef.current = true;
				}
				return;
			}

			// The panel is about to seat the rail beside the content, so the sheet
			// holding it must let go first or both would show it at once.
			setRightSidebarSheetOpen(false);

			if (
				rightSidebarCollapsedByViewportRef.current &&
				!rightSidebarCollapsedPreferenceRef.current
			) {
				restoreFrame = window.requestAnimationFrame(() => {
					rightSidebarPanelRef.current?.expand();
					rightSidebarPanelRef.current?.resize(
						`${rightSidebarSizePercentRef.current}%`,
					);
					setIsRightSidebarPanelCollapsed(false);
					rightSidebarCollapsedByViewportRef.current = false;
					restoreFrame = null;
				});
				return;
			}

			rightSidebarCollapsedByViewportRef.current = false;
		};

		syncRightSidebarWithViewport();
		wideViewportQuery.addEventListener('change', syncRightSidebarWithViewport);

		return () => {
			if (restoreFrame !== null) {
				window.cancelAnimationFrame(restoreFrame);
			}
			wideViewportQuery.removeEventListener(
				'change',
				syncRightSidebarWithViewport,
			);
		};
	}, [isRightSidebarPanelCollapsed]);

	return {
		collapseRightSidebar,
		expandRightSidebar,
		handleRightSidebarResize,
		initialRightSidebarSize: initialRightSidebarLayout.size,
		isNarrowViewport,
		isRightSidebarCollapsed: isNarrowViewport
			? !isRightSidebarSheetOpen
			: isRightSidebarPanelCollapsed,
		isRightSidebarSheetOpen,
		rightSidebarPanelRef,
		setRightSidebarSheetOpen,
	};
}
