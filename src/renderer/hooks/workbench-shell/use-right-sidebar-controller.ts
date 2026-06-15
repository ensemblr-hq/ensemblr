import { useAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '@/renderer/state/workspace';

const RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH = 1024;
const RIGHT_SIDEBAR_DEFAULT_SIZE_PERCENT = 34;
const RIGHT_SIDEBAR_MAX_SIZE_PERCENT = 68;
const RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT = 1;

/** Asks the main process to grow the window to fit the right sidebar minimum. */
async function ensureWindowCanShowRightSidebar() {
	if (
		window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
			.matches
	) {
		return;
	}

	await window.ensemble?.ensureWindowWidth(RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH);
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

export interface RightSidebarController {
	collapseRightSidebar: () => void;
	expandRightSidebar: () => Promise<void>;
	handleRightSidebarResize: (size: PanelSize) => void;
	isRightSidebarCollapsed: boolean;
	rightSidebarPanelRef: React.RefObject<PanelImperativeHandle | null>;
	rightSidebarSizePercent: number;
}

/**
 * Owns the right-sidebar collapse/expand state, viewport-driven auto-collapse,
 * and the imperative panel ref.
 */
export function useRightSidebarController(): RightSidebarController {
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightSidebarCollapsedByViewportRef = useRef(false);
	const [storedRightSidebarCollapsed, setStoredRightSidebarCollapsed] = useAtom(
		rightSidebarCollapsedAtom,
	);
	const [rightSidebarSizePercent, setRightSidebarSizePercent] = useAtom(
		rightSidebarSizePercentAtom,
	);
	const preferredRightSidebarSizePercent = getClampedRightSidebarSizePercent(
		rightSidebarSizePercent,
	);
	const rightSidebarCollapsedPreferenceRef = useRef(
		storedRightSidebarCollapsed,
	);
	const rightSidebarSizePercentRef = useRef(preferredRightSidebarSizePercent);
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(
		storedRightSidebarCollapsed,
	);

	useEffect(() => {
		rightSidebarCollapsedPreferenceRef.current = storedRightSidebarCollapsed;
	}, [storedRightSidebarCollapsed]);
	useEffect(() => {
		rightSidebarSizePercentRef.current = preferredRightSidebarSizePercent;
	}, [preferredRightSidebarSizePercent]);

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
	/** Persists user-driven resizes and toggles the collapsed flag. */
	const handleRightSidebarResize = (size: PanelSize) => {
		const isCollapsed =
			size.asPercentage <= RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT;

		setIsRightSidebarCollapsed(isCollapsed);

		if (!canPersistRightSidebarResize()) {
			return;
		}

		setStoredRightSidebarCollapsed(isCollapsed);
		rightSidebarCollapsedPreferenceRef.current = isCollapsed;

		if (!isCollapsed) {
			const nextSizePercent = getClampedRightSidebarSizePercent(
				size.asPercentage,
			);
			rightSidebarSizePercentRef.current = nextSizePercent;
			setRightSidebarSizePercent(nextSizePercent);
		}
	};

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
		isRightSidebarCollapsed,
		rightSidebarPanelRef,
		rightSidebarSizePercent: preferredRightSidebarSizePercent,
	};
}
