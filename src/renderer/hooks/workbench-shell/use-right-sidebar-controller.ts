import { useAtom, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** The width the right sidebar collapses to, shared with the panel that renders it. */
export const RIGHT_SIDEBAR_COLLAPSED_SIZE = '0rem';

/** Asks the main process to grow the window to fit the right sidebar minimum. */
async function ensureWindowCanShowRightSidebar() {
	if (
		window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
			.matches
	) {
		return;
	}

	await window.ensemblr?.ensureWindowWidth(RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH);
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
	return window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
		.matches;
}

/** Right-sidebar collapse/expand state and handlers returned by {@link useRightSidebarController}. */
interface RightSidebarController {
	collapseRightSidebar: () => void;
	expandRightSidebar: () => Promise<void>;
	handleRightSidebarResize: (size: PanelSize) => void;
	initialRightSidebarSize: string;
	isRightSidebarCollapsed: boolean;
	rightSidebarPanelRef: React.RefObject<PanelImperativeHandle | null>;
}

/**
 * Owns the right-sidebar collapse/expand state, viewport-driven auto-collapse,
 * and the imperative panel ref.
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
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(
		storedRightSidebarCollapsed,
	);

	useEffect(() => {
		rightSidebarCollapsedPreferenceRef.current = storedRightSidebarCollapsed;
	}, [storedRightSidebarCollapsed]);

	/** Collapses the right sidebar and persists the preference. */
	const collapseRightSidebar = () => {
		rightSidebarCollapsedByViewportRef.current = false;
		rightSidebarPanelRef.current?.collapse();
		rightSidebarCollapsedPreferenceRef.current = true;
		setIsRightSidebarCollapsed(true);
		setStoredRightSidebarCollapsed(true);
	};
	/** Asks the window to widen if needed, then expands the right sidebar. */
	const expandRightSidebar = async () => {
		rightSidebarCollapsedByViewportRef.current = false;
		await ensureWindowCanShowRightSidebar();

		window.requestAnimationFrame(() => {
			rightSidebarPanelRef.current?.expand();
			rightSidebarPanelRef.current?.resize(
				`${rightSidebarSizePercentRef.current}%`,
			);
			rightSidebarCollapsedPreferenceRef.current = false;
			setIsRightSidebarCollapsed(false);
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

		setIsRightSidebarCollapsed(isCollapsed);

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
		const narrowViewportQuery = window.matchMedia(
			`(max-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH - 1}px)`,
		);
		let restoreFrame: number | null = null;
		const syncRightSidebarWithViewport = () => {
			if (narrowViewportQuery.matches) {
				if (restoreFrame !== null) {
					window.cancelAnimationFrame(restoreFrame);
					restoreFrame = null;
				}

				const wasAlreadyCollapsed =
					rightSidebarPanelRef.current?.isCollapsed() ||
					isRightSidebarCollapsed;

				rightSidebarPanelRef.current?.collapse();
				setIsRightSidebarCollapsed(true);

				if (!wasAlreadyCollapsed) {
					rightSidebarCollapsedByViewportRef.current = true;
				}
				return;
			}

			if (
				rightSidebarCollapsedByViewportRef.current &&
				!rightSidebarCollapsedPreferenceRef.current
			) {
				restoreFrame = window.requestAnimationFrame(() => {
					rightSidebarPanelRef.current?.expand();
					rightSidebarPanelRef.current?.resize(
						`${rightSidebarSizePercentRef.current}%`,
					);
					setIsRightSidebarCollapsed(false);
					rightSidebarCollapsedByViewportRef.current = false;
					restoreFrame = null;
				});
				return;
			}

			rightSidebarCollapsedByViewportRef.current = false;
		};

		syncRightSidebarWithViewport();
		narrowViewportQuery.addEventListener(
			'change',
			syncRightSidebarWithViewport,
		);

		return () => {
			if (restoreFrame !== null) {
				window.cancelAnimationFrame(restoreFrame);
			}
			narrowViewportQuery.removeEventListener(
				'change',
				syncRightSidebarWithViewport,
			);
		};
	}, [isRightSidebarCollapsed]);

	return {
		collapseRightSidebar,
		expandRightSidebar,
		handleRightSidebarResize,
		initialRightSidebarSize: initialRightSidebarLayout.size,
		isRightSidebarCollapsed,
		rightSidebarPanelRef,
	};
}
